"""Projection seam for Claude Code native cross-session messaging.

This module never stores or transports messages itself.  It validates the
native ListAgents/SendMessage tool surfaces, intersects that capability with
Viniper-owned active runs, and projects explicit structured CLI events for the
renderer.  ``claude agents --json`` is Agent View lifecycle data and is never a
peer registry here.
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from typing import Any, Mapping, Protocol, Sequence


MINIMUM_PEER_VERSION = (2, 1, 224)
_INCOMING_RE = re.compile(
    r'^<cross-session-message\b(?P<attrs>[^>]*)>\n?(?P<body>.*?)\n?</cross-session-message>$',
    re.DOTALL,
)
_FROM_RE = re.compile(r'\bfrom="(?P<sender>[^"]+)"')


def _version_tuple(value: str) -> tuple[int, int, int]:
    match = re.search(r"(?<!\d)(\d+)\.(\d+)\.(\d+)(?!\d)", str(value or ""))
    return tuple(int(part) for part in match.groups()) if match else (0, 0, 0)


def _text(value: Any, limit: int = 8000) -> str:
    result = str(value or "").replace("\x00", "").strip()
    return result if len(result) <= limit else result[: limit - 1].rstrip() + "…"


def _content_text(block: Mapping[str, Any]) -> str:
    raw = block.get("content")
    if isinstance(raw, Mapping):
        nested = raw.get("data") if isinstance(raw.get("data"), Mapping) else {}
        return _text(raw.get("listing") or nested.get("listing") or raw.get("text") or "", 24000)
    if isinstance(raw, list):
        return "\n".join(
            _text(item.get("text") if isinstance(item, Mapping) else item, 24000)
            for item in raw
        ).strip()
    text = _text(raw, 24000)
    try:
        parsed = json.loads(text)
    except (TypeError, json.JSONDecodeError):
        return text
    if isinstance(parsed, Mapping):
        nested = parsed.get("data") if isinstance(parsed.get("data"), Mapping) else {}
        return _text(parsed.get("listing") or nested.get("listing") or parsed.get("text") or text, 24000)
    return text


def parse_list_agents_listing(value: str) -> set[str]:
    """Extract exact peer addresses from Claude's human-readable listing."""

    peers: set[str] = set()
    for raw_line in str(value or "").splitlines():
        line = raw_line.strip().lstrip("-• ").strip()
        if not line or line.casefold().startswith(("peer sessions", "no peer", "no active")):
            continue
        address = line.split(" ·", 1)[0].strip()
        address = re.sub(r"\s+\[[^\]]+\]\s*$", "", address).strip()
        if address and len(address) <= 96 and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]*", address):
            peers.add(address)
    return peers


@dataclass(frozen=True)
class PeerCapability:
    available: bool
    version_ok: bool
    agent_registry: bool
    send_message: bool
    list_agents_tool: bool
    discovery: str
    reason: str = ""

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def evaluate_peer_capability(
    cli_version: str,
    init_payload: Mapping[str, Any] | None,
    *,
    registry_supported: bool,
) -> PeerCapability:
    """Evaluate only native evidence from the current CLI process.

    A peer gate opens only when the current structured CLI process explicitly
    exposes both ListAgents and SendMessage.  Agent View's ``agents`` command
    is a different product surface and cannot satisfy this gate.
    """

    init_payload = init_payload if isinstance(init_payload, Mapping) else {}
    tools = {str(item) for item in init_payload.get("tools", []) if isinstance(item, str)}
    version_ok = _version_tuple(cli_version) >= MINIMUM_PEER_VERSION
    send_message = "SendMessage" in tools
    list_agents_tool = "ListAgents" in tools
    agent_registry = bool(list_agents_tool)
    discovery = "ListAgents" if list_agents_tool else "unavailable"
    available = bool(version_ok and send_message and agent_registry)
    missing: list[str] = []
    if not version_ok:
        missing.append("Claude Code 版本低于 2.1.224")
    if not send_message:
        missing.append("当前 stream-json 会话未暴露 SendMessage")
    if not agent_registry:
        missing.append("当前 CLI 未暴露原生活跃会话发现")
    return PeerCapability(
        available=available,
        version_ok=version_ok,
        agent_registry=agent_registry,
        send_message=send_message,
        list_agents_tool=list_agents_tool,
        discovery=discovery,
        reason="；".join(missing),
    )


def reachable_peer_targets(
    registry_entries: Sequence[Mapping[str, Any]],
    viniper_runs: Mapping[str, Mapping[str, Any]],
    *,
    current_session_id: str,
) -> list[dict[str, str]]:
    """Return only active native agents that also belong to Viniper runs."""

    native_by_session = {
        str(item.get("sessionId") or ""): item
        for item in registry_entries
        if isinstance(item, Mapping) and str(item.get("sessionId") or "")
    }
    targets: list[dict[str, str]] = []
    for session_id, run in viniper_runs.items():
        if str(session_id) == str(current_session_id):
            continue
        claude_session_id = str(run.get("claude_session_id") or "")
        peer_name = str(run.get("peer_name") or "")
        native = native_by_session.get(claude_session_id)
        if not native or str(native.get("name") or "") != peer_name:
            continue
        targets.append({
            "session_id": str(session_id),
            "claude_session_id": claude_session_id,
            "peer_name": peer_name,
            "display_name": str(run.get("display_name") or peer_name),
            "kind": str(native.get("kind") or "interactive"),
        })
    return sorted(targets, key=lambda item: (item["display_name"].casefold(), item["session_id"]))


def build_native_send_instruction(peer_name: str, message: str) -> str:
    """Build a user-visible Agent turn that requires Claude's native tool."""

    target = _text(peer_name, 96)
    content = _text(message, 12000)
    return (
        "[Viniper 原生跨会话消息]\n"
        "请先使用当前 Claude Code 会话提供的 ListAgents 工具确认目标会话地址仍在线，"
        "再仅使用 SendMessage 工具完成本次发送；若目标未列出，请明确失败且不要改用替代通道。"
        "不要改用文件、数据库、MCP、网络邮箱或其他替代通道。\n"
        f"目标会话地址：{target}\n"
        f"消息正文：{content}"
    )


def _mapping_result(payload: Mapping[str, Any]) -> tuple[str, str]:
    nested = payload.get("data") if isinstance(payload.get("data"), Mapping) else {}
    status = _text(
        payload.get("status")
        or payload.get("delivery_status")
        or nested.get("status")
        or nested.get("delivery_status"),
        40,
    ).casefold()
    success = nested.get("success") if "success" in nested else payload.get("success")
    if isinstance(success, bool) and not status:
        status = "delivered" if success else "failed"
    detail = _text(
        nested.get("message")
        or nested.get("detail")
        or payload.get("message")
        or payload.get("detail")
        or json.dumps(dict(payload), ensure_ascii=False)
    )
    return status, detail


def _result_payload(block: Mapping[str, Any]) -> tuple[str, str]:
    raw = block.get("content")
    if isinstance(raw, Mapping):
        return _mapping_result(raw)
    if isinstance(raw, list):
        text = "\n".join(
            _text(item.get("text") if isinstance(item, Mapping) else item)
            for item in raw
        ).strip()
    else:
        text = _text(raw)
    try:
        parsed = json.loads(text)
    except (TypeError, json.JSONDecodeError):
        parsed = None
    if isinstance(parsed, Mapping):
        return _mapping_result(parsed)
    return "", text


class NativePeerMessaging(Protocol):
    """Product interface for native Claude cross-session projection."""

    def observe_init(self, session_id: str, cli_version: str, payload: Mapping[str, Any], *, registry_supported: bool) -> PeerCapability: ...
    def capability_for(self, session_id: str) -> PeerCapability: ...
    def roster_observed(self, session_id: str) -> bool: ...
    def reachable_targets(self, session_id: str, viniper_runs: Mapping[str, Mapping[str, Any]], *, current_session_id: str) -> list[dict[str, str]]: ...
    def observe_event(self, session_id: str, event: Mapping[str, Any] | None) -> list[dict[str, Any]] | None: ...


class ClaudeCrossSessionAdapter:
    """Ephemeral matcher for native ListAgents, SendMessage and peer events."""

    def __init__(self) -> None:
        self._pending_sends: dict[tuple[str, str], dict[str, str]] = {}
        self._pending_rosters: set[tuple[str, str]] = set()
        self._rosters: dict[str, set[str]] = {}
        self._capabilities: dict[str, PeerCapability] = {}

    def observe_init(
        self,
        session_id: str,
        cli_version: str,
        payload: Mapping[str, Any],
        *,
        registry_supported: bool,
    ) -> PeerCapability:
        capability = evaluate_peer_capability(cli_version, payload, registry_supported=registry_supported)
        self._capabilities[str(session_id)] = capability
        return capability

    def capability_for(self, session_id: str) -> PeerCapability:
        return self._capabilities.get(str(session_id)) or PeerCapability(
            available=False,
            version_ok=False,
            agent_registry=False,
            send_message=False,
            list_agents_tool=False,
            discovery="unavailable",
            reason="当前会话尚未提供原生跨会话能力证据",
        )

    def best_capability(self) -> PeerCapability:
        """Return the strongest capability observed from this managed CLI build.

        Every Viniper Agent process uses the same managed distro and Claude
        executable.  Keeping the last structured init result lets an idle
        sender show whether native messaging was actually observed, without
        inventing a second probe or transport.
        """

        candidates = list(self._capabilities.values())
        if not candidates:
            return self.capability_for("")
        return max(
            candidates,
            key=lambda item: (
                int(item.available),
                int(item.send_message),
                int(item.agent_registry),
                int(item.version_ok),
            ),
        )

    def roster_observed(self, session_id: str) -> bool:
        return str(session_id) in self._rosters

    def reachable_targets(
        self,
        session_id: str,
        viniper_runs: Mapping[str, Mapping[str, Any]],
        *,
        current_session_id: str,
    ) -> list[dict[str, str]]:
        """Expose only Viniper-owned live runs behind a verified native gate.

        The runtime owns the stable ``--name`` used for each run.  ListAgents
        remains the required native discovery tool and the send instruction
        requires Claude to verify that name immediately before SendMessage.
        Agent View rows are deliberately absent from this seam.
        """

        capability = self.capability_for(session_id)
        roster = self._rosters.get(str(session_id))
        if not capability.available or roster is None:
            return []
        targets = []
        for candidate_id, run in viniper_runs.items():
            if str(candidate_id) == str(current_session_id):
                continue
            peer_name = _text(run.get("peer_name"), 96)
            claude_session_id = _text(run.get("claude_session_id"), 96)
            if not peer_name or not claude_session_id or peer_name not in roster:
                continue
            targets.append({
                "session_id": str(candidate_id),
                "claude_session_id": claude_session_id,
                "peer_name": peer_name,
                "display_name": _text(run.get("display_name") or peer_name, 200),
                "kind": "interactive",
            })
        return sorted(targets, key=lambda item: (item["display_name"].casefold(), item["session_id"]))

    def forget(self, session_id: str) -> None:
        sid = str(session_id)
        self._capabilities.pop(sid, None)
        self._rosters.pop(sid, None)
        self._pending_rosters = {item for item in self._pending_rosters if item[0] != sid}
        for key in [item for item in self._pending_sends if item[0] == sid]:
            self._pending_sends.pop(key, None)

    def observe_event(self, session_id: str, event: Mapping[str, Any] | None) -> list[dict[str, Any]] | None:
        if not isinstance(event, Mapping):
            return None
        event_type = str(event.get("type") or "")
        message = event.get("message") if isinstance(event.get("message"), Mapping) else {}
        content = message.get("content")
        blocks = content if isinstance(content, list) else ([{"type": "text", "text": content}] if isinstance(content, str) else [])
        projected: list[dict[str, Any]] = []

        if event_type == "assistant":
            for block in blocks:
                if not isinstance(block, Mapping) or block.get("type") != "tool_use":
                    continue
                tool_id = str(block.get("id") or "").strip()
                tool_name = str(block.get("name") or "")
                if tool_name == "ListAgents" and tool_id:
                    self._pending_rosters.add((str(session_id), tool_id))
                    continue
                if tool_name != "SendMessage":
                    continue
                tool_input = block.get("input") if isinstance(block.get("input"), Mapping) else {}
                target = _text(tool_input.get("to") or tool_input.get("recipient"), 96)
                message_text = _text(tool_input.get("message") or tool_input.get("content"), 12000)
                if not tool_id or not target:
                    continue
                record = {"target": target, "content": message_text}
                self._pending_sends[(str(session_id), tool_id)] = record
                projected.append({
                    "type": "peer_outgoing",
                    "tool_id": tool_id,
                    "target": target,
                    "content": message_text,
                    "status": "sending",
                })

        if event_type == "user":
            for block in blocks:
                if not isinstance(block, Mapping):
                    continue
                if block.get("type") == "tool_result":
                    tool_id = str(block.get("tool_use_id") or "").strip()
                    roster_key = (str(session_id), tool_id)
                    if roster_key in self._pending_rosters:
                        self._pending_rosters.discard(roster_key)
                        if not block.get("is_error"):
                            self._rosters[str(session_id)] = parse_list_agents_listing(_content_text(block))
                        continue
                    record = self._pending_sends.pop((str(session_id), tool_id), None)
                    if not record:
                        continue
                    raw_status, detail = _result_payload(block)
                    if block.get("is_error"):
                        status = "failed"
                    elif raw_status in {"held", "pending", "queued"}:
                        status = "held"
                    elif raw_status in {"refused", "denied"}:
                        status = "refused"
                    elif raw_status in {"delivered", "success", "sent"}:
                        status = "delivered"
                    else:
                        status = "failed"
                    projected.append({
                        "type": "peer_delivery",
                        "tool_id": tool_id,
                        "target": record["target"],
                        "content": record["content"],
                        "status": status,
                        "detail": detail,
                    })
                    continue
                if block.get("type") != "text":
                    continue
                raw_text = _text(block.get("text"), 16000)
                match = _INCOMING_RE.fullmatch(raw_text)
                if not match:
                    continue
                sender_match = _FROM_RE.search(match.group("attrs"))
                sender = _text(sender_match.group("sender") if sender_match else "", 96)
                if not sender:
                    continue
                projected.append({
                    "type": "peer_incoming",
                    "sender": sender,
                    "content": _text(match.group("body"), 12000),
                    "user_authority": False,
                    "can_answer_permission": False,
                    "can_execute_slash": False,
                })

        return projected or None


__all__ = [
    "ClaudeCrossSessionAdapter",
    "MINIMUM_PEER_VERSION",
    "NativePeerMessaging",
    "PeerCapability",
    "build_native_send_instruction",
    "evaluate_peer_capability",
    "parse_list_agents_listing",
    "reachable_peer_targets",
]
