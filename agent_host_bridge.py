"""Claude Code host-hook bridge for Viniper Agent runs.

The renderer never receives the raw hook envelope.  A run-private file channel
transports one normalized request to the server and one official hook response
back to the same waiting Claude Code process.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import shlex
import sys
import time
import uuid
from pathlib import Path
from typing import Any


BRIDGE_PROTOCOL_VERSION = 1
DEFAULT_HOOK_TIMEOUT_SECONDS = 60 * 60 * 8
PERMISSION_PROMPT_MCP_SERVER = "viniper_interaction"
PERMISSION_PROMPT_MCP_TOOL = "permission_prompt"
PERMISSION_PROMPT_MCP_QUALIFIED_TOOL = "mcp__viniper_interaction__permission_prompt"
MCP_RESPONSE_ACK_STAGE = "mcp_response_written_and_flushed"
ACK_STAGES = (
    "response_committed",
    "response_read",
    "stdout_written_and_flushed",
    "hook_exit",
    MCP_RESPONSE_ACK_STAGE,
    "cli_tool_result",
)


def _short_text(value: Any, limit: int = 320) -> str:
    text = " ".join(str(value or "").replace("\x00", "").split()).strip()
    if len(text) > limit:
        return text[: limit - 1].rstrip() + "…"
    return text


def _answer_map(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    return {
        str(key): ", ".join(str(item) for item in answer) if isinstance(answer, list) else answer
        for key, answer in value.items()
    }


def _permission_display(tool_input: dict[str, Any], description: str = "") -> dict[str, str]:
    display: dict[str, str] = {}
    for key in ("command", "file_path", "path", "url"):
        value = _short_text(tool_input.get(key))
        if value:
            display[key] = value
    summary = _short_text(tool_input.get("description") or description)
    if summary:
        display["description"] = summary
    return display


def _permission_context(raw: dict[str, Any]) -> dict[str, Any]:
    """Retain SDK context fields without attempting to serialize live signals."""
    nested = raw.get("context") if isinstance(raw.get("context"), dict) else {}
    result: dict[str, Any] = {}
    for key in (
        "blocked_path", "decision_reason", "decision_reason_type", "title",
        "display_name", "description", "agent_id", "signal", "abort",
    ):
        if key in raw:
            result[key] = copy.deepcopy(raw.get(key))
        elif key in nested:
            result[key] = copy.deepcopy(nested.get(key))
    return result


def normalize_hook_request(raw: Any, *, bridge_request_id: str) -> dict[str, Any] | None:
    """Normalize only official PreToolUse AskUserQuestion/PermissionRequest input."""
    if not isinstance(raw, dict):
        return None
    event = str(raw.get("hook_event_name") or "").strip()
    tool_name = str(raw.get("tool_name") or "").strip()
    tool_input = copy.deepcopy(raw.get("tool_input") if isinstance(raw.get("tool_input"), dict) else {})
    session_id = str(raw.get("session_id") or "").strip()
    cwd = _short_text(raw.get("cwd"), 512)

    if event == "PreToolUse" and tool_name.casefold() == "askuserquestion":
        questions = copy.deepcopy(tool_input.get("questions") if isinstance(tool_input.get("questions"), list) else [])
        if not questions:
            return None
        request_id = str(raw.get("tool_use_id") or bridge_request_id).strip()
        return {
            "type": "interaction_request",
            "kind": "question",
            "request_id": request_id,
            "tool_use_id": request_id,
            "bridge_request_id": str(bridge_request_id),
            "session_id": session_id,
            "workdir": cwd,
            "tool_name": "AskUserQuestion",
            "agent_id": copy.deepcopy(raw.get("agent_id")),
            "response": copy.deepcopy(raw.get("response")),
            "questions": questions,
            "display_payload": {},
            "allowed_actions": ["answer", "skip"],
            "_hook_event_name": event,
            "_original_questions": questions,
            "_permission_suggestions": [],
        }

    if event == "PermissionRequest" and tool_name:
        raw_suggestions = raw.get("permission_suggestions")
        suggestions = copy.deepcopy(raw_suggestions if isinstance(raw_suggestions, list) else [])
        actions = ["deny", "allow_once"]
        if suggestions:
            actions.append("allow_always")
        context = _permission_context(raw)
        return {
            "type": "interaction_request",
            "kind": "permission",
            "request_id": str(raw.get("tool_use_id") or bridge_request_id),
            "tool_use_id": str(raw.get("tool_use_id") or bridge_request_id),
            "bridge_request_id": str(bridge_request_id),
            "session_id": session_id,
            "workdir": cwd,
            "tool_name": tool_name,
            "questions": [],
            "display_payload": _permission_display(tool_input),
            "allowed_actions": actions,
            "_hook_event_name": event,
            "_original_questions": [],
            "_permission_suggestions": suggestions,
            "_tool_input": tool_input,
            "context": context,
            **context,
        }
    return None


def normalize_permission_prompt_request(raw: Any, *, bridge_request_id: str) -> dict[str, Any] | None:
    """Normalize Claude Code's documented MCP permission-prompt tool input."""
    if not isinstance(raw, dict):
        return None
    tool_name = str(raw.get("tool_name") or "").strip()
    tool_use_id = str(raw.get("tool_use_id") or "").strip()
    tool_input = copy.deepcopy(raw.get("input") if isinstance(raw.get("input"), dict) else {})
    if not tool_name or not tool_use_id:
        return None
    if tool_name.casefold() == "askuserquestion":
        questions = copy.deepcopy(tool_input.get("questions") if isinstance(tool_input.get("questions"), list) else [])
        if not questions:
            return None
        return {
            "type": "interaction_request",
            "kind": "question",
            "request_id": tool_use_id,
            "tool_use_id": tool_use_id,
            "bridge_request_id": str(bridge_request_id),
            "session_id": "",
            "workdir": "",
            "tool_name": "AskUserQuestion",
            "agent_id": copy.deepcopy(raw.get("agent_id")),
            "response": copy.deepcopy(raw.get("response")),
            "questions": questions,
            "display_payload": {},
            "allowed_actions": ["answer", "skip"],
            "_transport": "permission_prompt_mcp",
            "_original_questions": questions,
            "_permission_suggestions": [],
        }

    suggestions_raw = raw.get("permission_suggestions")
    if not isinstance(suggestions_raw, list):
        suggestions_raw = raw.get("suggestions")
    suggestions = copy.deepcopy(suggestions_raw if isinstance(suggestions_raw, list) else [])
    actions = ["deny", "allow_once"]
    if suggestions:
        actions.append("allow_always")
    context = _permission_context(raw)
    return {
        "type": "interaction_request",
        "kind": "permission",
        "request_id": tool_use_id,
        "tool_use_id": tool_use_id,
        "bridge_request_id": str(bridge_request_id),
        "session_id": "",
        "workdir": "",
        "tool_name": tool_name,
        "questions": [],
        "display_payload": _permission_display(tool_input),
        "allowed_actions": actions,
        "_transport": "permission_prompt_mcp",
        "_original_questions": [],
        "_permission_suggestions": suggestions,
        "_tool_input": tool_input,
        "context": context,
        **context,
    }


def build_permission_prompt_response(
    request: dict[str, Any],
    action: str,
    *,
    answers: Any = None,
    value: Any = None,
) -> dict[str, Any]:
    """Build the JSON decision consumed by Claude's MCP permission prompt tool."""
    kind = str(request.get("kind") or "")
    action = str(action or "")
    if kind == "question":
        if action in {"skip", "deny", "close"}:
            return {"behavior": "deny", "message": "用户跳过了本次询问"}
        original = copy.deepcopy(request.get("_original_questions") or request.get("questions") or [])
        if not original:
            raise ValueError("question response requires original questions")
        return {
            "behavior": "allow",
            "updatedInput": {
                "questions": original,
                "answers": _answer_map(answers if answers is not None else value),
            },
        }
    if kind != "permission":
        raise ValueError("unsupported permission prompt kind")
    if action == "deny":
        return {"behavior": "deny", "message": "用户拒绝了本次操作"}
    if action == "allow_always":
        suggestions = copy.deepcopy(request.get("_permission_suggestions") or [])
        if not suggestions:
            raise ValueError("allow_always requires an upstream permission suggestion")
        return {
            "behavior": "allow",
            "updatedInput": copy.deepcopy(request.get("_tool_input") or {}),
            "updatedPermissions": suggestions,
        }
    if action == "allow_once":
        return {
            "behavior": "allow",
            "updatedInput": copy.deepcopy(request.get("_tool_input") or {}),
        }
    raise ValueError("unsupported permission action")


def build_hook_response(
    request: dict[str, Any],
    action: str,
    *,
    answers: Any = None,
    value: Any = None,
) -> dict[str, Any]:
    """Build the documented Claude Code hook response for one normalized request."""
    kind = str(request.get("kind") or "")
    action = str(action or "")
    if kind == "question":
        if action in {"skip", "deny", "close"}:
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": "用户跳过了本次询问",
                }
            }
        original = copy.deepcopy(request.get("_original_questions") or request.get("questions") or [])
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "allow",
                "updatedInput": {
                    "questions": original,
                    "answers": _answer_map(answers if answers is not None else value),
                },
            }
        }

    if kind != "permission":
        raise ValueError("unsupported host interaction kind")
    if action == "deny":
        decision: dict[str, Any] = {"behavior": "deny", "message": "用户拒绝了本次操作"}
    elif action == "allow_always":
        suggestions = copy.deepcopy(request.get("_permission_suggestions") or [])
        if not suggestions:
            raise ValueError("allow_always requires an upstream permission suggestion")
        decision = {"behavior": "allow", "updatedPermissions": suggestions}
    elif action == "allow_once":
        decision = {"behavior": "allow"}
    else:
        raise ValueError("unsupported permission action")
    return {
        "hookSpecificOutput": {
            "hookEventName": "PermissionRequest",
            "decision": decision,
        }
    }


def build_hook_settings(*, script_path: str, channel_path: str, timeout_seconds: int = DEFAULT_HOOK_TIMEOUT_SECONDS) -> dict[str, Any]:
    command = " ".join((
        "python3",
        shlex.quote(str(script_path)),
        "--hook-client",
        "--channel",
        shlex.quote(str(channel_path)),
        "--timeout",
        str(max(1, int(timeout_seconds))),
    ))
    handler = {"type": "command", "command": command, "timeout": max(1, int(timeout_seconds))}
    return {
        "hooks": {
            "PreToolUse": [{"matcher": "AskUserQuestion", "hooks": [copy.deepcopy(handler)]}],
            "PermissionRequest": [{"matcher": "*", "hooks": [copy.deepcopy(handler)]}],
        }
    }


def build_passive_hook_settings() -> dict[str, Any]:
    """Run-private settings for MCP-owned interactions: no second interactive hook."""
    return {"hooks": {}}


def build_permission_prompt_mcp_config(
    *,
    script_path: str,
    channel_path: str,
    timeout_seconds: int = DEFAULT_HOOK_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    return {
        "mcpServers": {
            PERMISSION_PROMPT_MCP_SERVER: {
                "type": "stdio",
                "command": "python3",
                "args": [
                    str(script_path),
                    "--mcp-server",
                    "--channel",
                    str(channel_path),
                    "--timeout",
                    str(max(1, int(timeout_seconds))),
                ],
            }
        }
    }


def _atomic_json(path: Path, payload: Any, *, create_only: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        if create_only:
            os.link(temp, path)
        else:
            os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def _safe_identifier(value: Any) -> str:
    text = str(value or "").strip()
    if not text or any(char not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for char in text):
        raise ValueError("invalid bridge request id")
    return text


def _record_ack_stage(root: Path, bridge_request_id: str, stage: str, **metadata: Any) -> bool:
    bridge_id = _safe_identifier(bridge_request_id)
    if stage not in ACK_STAGES:
        raise ValueError("invalid host acknowledgement stage")
    payload: dict[str, Any] = {
        "protocol_version": BRIDGE_PROTOCOL_VERSION,
        "bridge_request_id": bridge_id,
        "stage": stage,
        "at": time.time(),
    }
    meta_path = root / "channel-meta.json"
    try:
        channel_meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    except (OSError, json.JSONDecodeError):
        channel_meta = {}
    for key in ("session_id", "run_id", "process_identity"):
        value = _short_text(channel_meta.get(key), 200)
        if value:
            payload[key] = value
    interaction_path = root / "interaction-meta" / f"{bridge_id}.json"
    try:
        interaction_meta = json.loads(interaction_path.read_text(encoding="utf-8")) if interaction_path.exists() else {}
    except (OSError, json.JSONDecodeError):
        interaction_meta = {}
    for key in ("request_id", "kind", "tool_name"):
        value = _short_text(interaction_meta.get(key), 160)
        if value:
            payload[key] = value
    request_id = _short_text(metadata.get("request_id"), 160)
    if request_id:
        payload["request_id"] = request_id
    if "success" in metadata:
        payload["success"] = bool(metadata.get("success"))
    if "exit_code" in metadata:
        payload["exit_code"] = int(metadata.get("exit_code") or 0)
    action = _short_text(metadata.get("action"), 80)
    if action:
        payload["action"] = action
    try:
        _atomic_json(root / "acks" / f"{bridge_id}.{stage}.json", payload, create_only=True)
    except FileExistsError:
        return False
    return True


class HostInteractionChannel:
    """Server side of a run-private hook file channel."""

    def __init__(self, root: str | Path, *, session_id: str = "", run_id: str = "") -> None:
        self.root = Path(root)
        self.session_id = str(session_id or "")
        self.run_id = str(run_id or "")
        self.requests = self.root / "requests"
        self.responses = self.root / "responses"
        self.requests.mkdir(parents=True, exist_ok=True)
        self.responses.mkdir(parents=True, exist_ok=True)
        self._seen: set[str] = set()
        if session_id or run_id:
            _atomic_json(self.root / "channel-meta.json", {
                "session_id": _short_text(self.session_id, 160),
                "run_id": _short_text(self.run_id, 160),
                "process_identity": "",
            })

    def bind_process_identity(self, process_identity: str) -> None:
        meta_path = self.root / "channel-meta.json"
        try:
            metadata = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        except (OSError, json.JSONDecodeError):
            metadata = {}
        metadata["process_identity"] = _short_text(process_identity, 200)
        _atomic_json(meta_path, {
            "session_id": _short_text(metadata.get("session_id"), 160),
            "run_id": _short_text(metadata.get("run_id"), 160),
            "process_identity": metadata["process_identity"],
        })

    def record_interaction(self, bridge_request_id: str, request_id: str, kind: str, tool_name: str = "") -> None:
        bridge_id = _safe_identifier(bridge_request_id)
        _atomic_json(self.root / "interaction-meta" / f"{bridge_id}.json", {
            "bridge_request_id": bridge_id,
            "request_id": _short_text(request_id, 160),
            "kind": _short_text(kind, 80),
            "tool_name": _short_text(tool_name, 120),
        }, create_only=True)

    def pending(self) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for path in sorted(self.requests.glob("*.json"), key=lambda item: item.stat().st_mtime_ns):
            bridge_id = path.stem
            if bridge_id in self._seen:
                continue
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if str(raw.get("_transport") or "") == "permission_prompt_mcp":
                normalized = normalize_permission_prompt_request(raw, bridge_request_id=bridge_id)
            else:
                normalized = normalize_hook_request(raw, bridge_request_id=bridge_id)
            self._seen.add(bridge_id)
            if normalized is not None:
                normalized["_channel"] = self
                normalized["_raw_hook"] = raw
                result.append(normalized)
        return result

    def respond(self, bridge_request_id: str, payload: dict[str, Any], *, action: str = "") -> None:
        bridge_id = _safe_identifier(bridge_request_id)
        target = self.responses / f"{bridge_id}.json"
        if target.exists():
            try:
                existing = json.loads(target.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise OSError("existing interaction response is unreadable") from exc
            if existing != payload:
                raise FileExistsError("interaction response already contains a different decision")
        else:
            _atomic_json(target, payload, create_only=True)
        _record_ack_stage(self.root, bridge_id, "response_committed", action=_short_text(action, 80))

    def acknowledgement(self, bridge_request_id: str) -> dict[str, Any]:
        bridge_id = _safe_identifier(bridge_request_id)
        stages: list[str] = []
        result: dict[str, Any] = {
            "bridge_request_id": bridge_id,
            "stage": "",
            **{stage: False for stage in ACK_STAGES},
        }
        for stage in ACK_STAGES:
            path = self.root / "acks" / f"{bridge_id}.{stage}.json"
            if not path.exists():
                continue
            stages.append(stage)
            result[stage] = True
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if stage == "cli_tool_result":
                result["cli_tool_result_success"] = bool(payload.get("success"))
                result["request_id"] = str(payload.get("request_id") or "")
            elif stage == "hook_exit":
                result["hook_exit_code"] = int(payload.get("exit_code") or 0)
        if stages:
            result["stage"] = stages[-1]
        result["stages"] = stages
        return result

    def record_cli_tool_result(self, bridge_request_id: str, request_id: str, *, success: bool) -> bool:
        return _record_ack_stage(
            self.root,
            bridge_request_id,
            "cli_tool_result",
            request_id=_short_text(request_id, 160),
            success=bool(success),
        )

    def finalize(self, terminal: str, *, reason: str = "") -> Path:
        terminal_value = str(terminal or "unknown").strip().lower()
        if terminal_value not in {"completed", "failed", "cancelled", "timeout", "unknown"}:
            terminal_value = "unknown"
        requests: dict[str, dict[str, Any]] = {}
        ack_dir = self.root / "acks"
        if ack_dir.exists():
            for path in sorted(ack_dir.glob("*.json")):
                try:
                    payload = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
                bridge_id = str(payload.get("bridge_request_id") or "")
                stage = str(payload.get("stage") or "")
                if not bridge_id or stage not in ACK_STAGES:
                    continue
                record = requests.setdefault(bridge_id, {"stages": []})
                if stage not in record["stages"]:
                    record["stages"].append(stage)
                if payload.get("request_id"):
                    record["request_id"] = _short_text(payload.get("request_id"), 160)
                for key in ("session_id", "run_id", "process_identity", "kind", "tool_name", "action"):
                    if payload.get(key):
                        record[key] = _short_text(payload.get(key), 200)
                if stage == "cli_tool_result":
                    record["cli_tool_result_success"] = bool(payload.get("success"))
            for record in requests.values():
                record["stages"] = [stage for stage in ACK_STAGES if stage in record["stages"]]
        target = self.root / "audit-summary.json"
        try:
            _atomic_json(target, {
                "protocol_version": BRIDGE_PROTOCOL_VERSION,
                "terminal": terminal_value,
                "reason": _short_text(reason, 120),
                "requests": requests,
                "at": time.time(),
            }, create_only=True)
        except FileExistsError:
            pass
        return target

    def cancel_all(self, reason: str = "run ended") -> None:
        for request in self.pending():
            try:
                action = "skip" if request.get("kind") == "question" else "deny"
                if request.get("_transport") == "permission_prompt_mcp":
                    response = build_permission_prompt_response(request, action)
                else:
                    response = build_hook_response(request, action)
                self.respond(str(request.get("bridge_request_id") or ""), response)
            except (FileExistsError, OSError, ValueError):
                continue
        _atomic_json(self.root / "cancelled.json", {"reason": _short_text(reason), "at": time.time()})

    def cleanup(self) -> None:
        """Remove raw envelopes while retaining the sanitized run audit."""
        for directory in (self.requests, self.responses, self.root / "interaction-meta"):
            try:
                for path in directory.iterdir():
                    if path.is_file():
                        path.unlink(missing_ok=True)
                directory.rmdir()
            except OSError:
                pass
        for name in ("cancelled.json", "hook-settings.json", "mcp-config.json", "channel-meta.json"):
            try:
                (self.root / name).unlink(missing_ok=True)
            except OSError:
                pass
        # ACK markers and audit-summary.json intentionally survive cleanup.


def _run_hook_client(channel_path: str, timeout_seconds: int) -> int:
    raw = json.load(sys.stdin)
    bridge_id = uuid.uuid4().hex
    root = Path(channel_path)
    request = normalize_hook_request(raw, bridge_request_id=bridge_id)
    if request is None:
        return 0
    _atomic_json(root / "requests" / f"{bridge_id}.json", raw, create_only=True)
    response_path = root / "responses" / f"{bridge_id}.json"
    cancelled_path = root / "cancelled.json"
    deadline = time.monotonic() + max(1, int(timeout_seconds))
    while time.monotonic() < deadline:
        if response_path.exists():
            payload = json.loads(response_path.read_text(encoding="utf-8"))
            _record_ack_stage(root, bridge_id, "response_read")
            json.dump(payload, sys.stdout, ensure_ascii=False, separators=(",", ":"))
            sys.stdout.write("\n")
            sys.stdout.flush()
            _record_ack_stage(root, bridge_id, "stdout_written_and_flushed")
            _record_ack_stage(root, bridge_id, "hook_exit", exit_code=0)
            return 0
        if cancelled_path.exists():
            break
        time.sleep(0.05)
    fallback = build_hook_response(request, "skip" if request.get("kind") == "question" else "deny")
    json.dump(fallback, sys.stdout, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write("\n")
    sys.stdout.flush()
    _record_ack_stage(root, bridge_id, "stdout_written_and_flushed")
    _record_ack_stage(root, bridge_id, "hook_exit", exit_code=0)
    return 0


def _mcp_tool_definition() -> dict[str, Any]:
    return {
        "name": PERMISSION_PROMPT_MCP_TOOL,
        "description": "Request one Viniper user decision for a Claude Code tool call.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "tool_name": {"type": "string"},
                "tool_use_id": {"type": "string"},
                "input": {"type": "object"},
                "permission_suggestions": {"type": "array"},
            },
            "required": ["tool_name", "tool_use_id", "input"],
            "additionalProperties": True,
        },
    }


def _mcp_send(payload: dict[str, Any]) -> None:
    json.dump(payload, sys.stdout, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write("\n")
    sys.stdout.flush()


def _mcp_tool_result(request_id: Any, decision: dict[str, Any], *, is_error: bool = False) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "result": {
            "content": [{
                "type": "text",
                "text": json.dumps(decision, ensure_ascii=False, separators=(",", ":")),
            }],
            "isError": bool(is_error),
        },
    }


def _run_mcp_server(channel_path: str, timeout_seconds: int) -> int:
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8", errors="strict")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="strict")
    root = Path(channel_path)
    (root / "requests").mkdir(parents=True, exist_ok=True)
    (root / "responses").mkdir(parents=True, exist_ok=True)
    for line in sys.stdin:
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(request, dict):
            continue
        request_id = request.get("id")
        method = str(request.get("method") or "")
        if method == "initialize":
            params = request.get("params") if isinstance(request.get("params"), dict) else {}
            protocol = str(params.get("protocolVersion") or "2025-06-18")
            _mcp_send({
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "protocolVersion": protocol,
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "viniper-interaction", "version": "1.0.0"},
                },
            })
            continue
        if method == "notifications/initialized":
            continue
        if method == "ping":
            _mcp_send({"jsonrpc": "2.0", "id": request_id, "result": {}})
            continue
        if method == "tools/list":
            _mcp_send({"jsonrpc": "2.0", "id": request_id, "result": {"tools": [_mcp_tool_definition()]}})
            continue
        if method != "tools/call":
            if request_id is not None:
                _mcp_send({
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {"code": -32601, "message": "Method not found"},
                })
            continue

        params = request.get("params") if isinstance(request.get("params"), dict) else {}
        if str(params.get("name") or "") != PERMISSION_PROMPT_MCP_TOOL:
            _mcp_send(_mcp_tool_result(
                request_id,
                {"behavior": "deny", "message": "未知的交互入口"},
                is_error=True,
            ))
            continue
        arguments = copy.deepcopy(params.get("arguments") if isinstance(params.get("arguments"), dict) else {})
        bridge_id = uuid.uuid4().hex
        normalized = normalize_permission_prompt_request(arguments, bridge_request_id=bridge_id)
        if normalized is None:
            _mcp_send(_mcp_tool_result(
                request_id,
                {"behavior": "deny", "message": "交互请求结构无效"},
                is_error=True,
            ))
            continue
        envelope = {"_transport": "permission_prompt_mcp", **arguments}
        try:
            _atomic_json(root / "requests" / f"{bridge_id}.json", envelope, create_only=True)
        except (FileExistsError, OSError):
            _mcp_send(_mcp_tool_result(
                request_id,
                {"behavior": "deny", "message": "交互请求无法提交"},
                is_error=True,
            ))
            continue

        response_path = root / "responses" / f"{bridge_id}.json"
        commit_path = root / "acks" / f"{bridge_id}.response_committed.json"
        cancelled_path = root / "cancelled.json"
        deadline = time.monotonic() + max(1, int(timeout_seconds))
        decision: dict[str, Any] | None = None
        while time.monotonic() < deadline:
            if response_path.exists() and commit_path.exists():
                try:
                    payload = json.loads(response_path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    payload = None
                if isinstance(payload, dict):
                    decision = payload
                    _record_ack_stage(root, bridge_id, "response_read")
                    break
            if cancelled_path.exists():
                break
            time.sleep(0.05)
        if decision is None:
            action = "skip" if normalized.get("kind") == "question" else "deny"
            decision = build_permission_prompt_response(normalized, action)
        _mcp_send(_mcp_tool_result(request_id, decision))
        _record_ack_stage(root, bridge_id, MCP_RESPONSE_ACK_STAGE, exit_code=0)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hook-client", action="store_true")
    parser.add_argument("--mcp-server", action="store_true")
    parser.add_argument("--channel", default="")
    parser.add_argument("--timeout", type=int, default=DEFAULT_HOOK_TIMEOUT_SECONDS)
    args = parser.parse_args()
    if not args.channel or args.hook_client == args.mcp_server:
        parser.error("choose exactly one of --hook-client or --mcp-server and provide --channel")
    if args.mcp_server:
        return _run_mcp_server(args.channel, args.timeout)
    return _run_hook_client(args.channel, args.timeout)


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "HostInteractionChannel",
    "MCP_RESPONSE_ACK_STAGE",
    "PERMISSION_PROMPT_MCP_QUALIFIED_TOOL",
    "build_passive_hook_settings",
    "build_permission_prompt_mcp_config",
    "build_permission_prompt_response",
    "build_hook_response",
    "build_hook_settings",
    "normalize_hook_request",
    "normalize_permission_prompt_request",
]
