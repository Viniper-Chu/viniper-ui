"""Bounded startup for the Claude Code bidirectional SDK protocol."""
from __future__ import annotations

import asyncio
import json
import time
import re
import copy
from typing import Any

from native_commands import build_native_initialize_request, parse_native_initialize_response


class NativeStartupError(RuntimeError):
    """A native error result received before the caller sends user input."""

    def __init__(self, detail: str):
        self.detail = str(detail or "Claude Code 初始化失败")
        super().__init__(native_failure_message(self.detail))


async def initialize_native_stream(reader, write, request_id: str, *, cancelled=lambda: False, timeout: float = 20.0):
    """Initialize before sending user input, preserving unrelated buffered events.

    A missing ACK is a startup failure, not an indefinitely running model task.
    No user message or semantic retry is performed here.
    """
    # The host projects child messages into their own parent_tool_use_id lane.
    await write(build_native_initialize_request(request_id, forward_subagent_text=True))
    deadline = time.monotonic() + timeout
    pending: list[bytes] = []
    size = 0
    while True:
        if cancelled():
            raise RuntimeError("Claude Code 初始化已取消；未发送本轮消息。")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError("Claude Code 初始化超时；未发送本轮消息，请检查运行环境后重试。")
        try:
            raw = await reader.readline(min(0.2, remaining))
        except asyncio.TimeoutError:
            continue
        if not raw:
            raise RuntimeError("Claude Code 在初始化完成前退出；未发送本轮消息。")
        try:
            payload = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            payload = None
        if isinstance(payload, dict) and payload.get("type") == "result" and (
            payload.get("is_error") or str(payload.get("subtype") or "").startswith("error")
        ):
            errors = payload.get("errors")
            detail = "\n".join(item for item in errors if isinstance(item, str)) if isinstance(errors, list) else ""
            raise NativeStartupError(detail or str(payload.get("result") or "Claude Code 初始化失败"))
        metadata = parse_native_initialize_response(payload, request_id)
        if metadata is not None:
            return metadata, pending
        size += len(raw)
        if size > 2_000_000:
            raise RuntimeError("Claude Code 初始化输出异常；未发送本轮消息。")
        pending.append(raw)


def native_control_success(request_id: str, response: dict[str, Any]) -> dict[str, Any]:
    """The SDK correlation ID is nested inside the control response."""
    return {"type": "control_response", "response": {
        "subtype": "success", "request_id": request_id, "response": response,
    }}


def native_control_error(request_id: str, detail: str) -> dict[str, Any]:
    return {"type": "control_response", "response": {
        "subtype": "error", "request_id": str(request_id), "error": str(detail),
    }}


def native_failure_message(detail: str) -> str:
    """Show actionable failure, not raw native stderr or provider credentials."""
    text = str(detail or "")
    if re.search(r"\b401\b|unauthorized|authentication_error|invalid.api.key", text, re.I):
        return "模型服务认证失败（401）。请检查 Claude code 设置中的 API Key 和接口地址；本轮已结束，可以修改设置后重新发送。"
    if re.search(r"\b429\b|rate.limit", text, re.I):
        return "模型服务请求过于频繁或额度受限（429）。本轮已结束，请稍后重试或检查服务额度。"
    if re.search(r"\b403\b|permission_denied", text, re.I):
        return "模型服务拒绝访问（403）。请检查该密钥的模型权限；本轮已结束。"
    if re.search(r"timed?\s*out|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|Connection error", text, re.I):
        return "模型服务连接失败或超时。请检查接口地址、网络与代理；本轮已结束，可以重试。"
    if "\x00" in text:
        text = text[text.find("[claude-code:"):] if "[claude-code:" in text else "Claude Code 运行异常，请在设置中打开诊断。"
    text = re.sub(r"\x1b\[[0-9;]*m", "", text)
    text = re.sub(r"sk-[A-Za-z0-9_-]+|Bearer\s+\S+", "[已隐藏凭据]", text, flags=re.I)
    return text[:1200] or "Claude Code 未能完成本轮任务，请在设置中检查运行环境。"


def _public_text(value: Any, limit: int = 4000) -> str:
    text = str(value or "").replace("\x00", "")
    text = re.sub(r"sk-[A-Za-z0-9_-]+|Bearer\s+\S+", "[已隐藏凭据]", text, flags=re.I)
    return text[:limit]


def _usage(value: Any) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    return {key: max(0, int(value[key])) for key in ("total_tokens", "tool_uses", "duration_ms")
            if isinstance(value.get(key), (int, float)) and not isinstance(value[key], bool)}


class NativeRuntimeProjection:
    """Bounded, durable view of CLI events; never a second task executor.

    Child output stays attached to its parent tool, and metadata uses an
    explicit allowlist instead of forwarding SDK account/configuration objects.
    """

    def __init__(self, snapshot: Any = None) -> None:
        source = snapshot if isinstance(snapshot, dict) else {}
        self.state = {key: copy.deepcopy(source.get(key) or [])[-64:]
                      for key in ("tasks", "subagents", "hooks", "tool_progress", "todos")}
        self.state.update({key: copy.deepcopy(source.get(key) or {})
                           for key in ("status", "rate_limit", "capabilities")})
        self._calls: dict[str, dict[str, Any]] = {}

    def snapshot(self) -> dict[str, Any]:
        return copy.deepcopy(self.state)

    def _row(self, key: str, identity: str, **values: Any) -> dict[str, Any]:
        rows = self.state[key]
        row = next((item for item in rows if item.get("id") == identity), None)
        if row is None:
            row = {"id": identity}
            rows.append(row)
            del rows[:-64]
        row.update(values)
        return row

    def _plan(self) -> dict[str, Any]:
        return {"kind": "plan", "event": {"steps": copy.deepcopy(self.state["todos"])}}

    def finish(self, status: str) -> None:
        self.state["status"]["status"] = status
        if status in {"cancelled", "failed", "interrupted"}:
            for key in ("tasks", "hooks"):
                for row in self.state[key]:
                    if row.get("status") in {"running", "in_progress", "pending"}:
                        row["status"] = "interrupted"

    def observe(self, data: Any) -> list[dict[str, Any]]:
        if not isinstance(data, dict):
            return []
        kind = str(data.get("type") or "")
        subtype = str(data.get("subtype") or "")
        parent = _public_text(data.get("parent_tool_use_id"), 200)
        events: list[dict[str, Any]] = []

        if kind == "system" and subtype == "init":
            capabilities = {
                "model": _public_text(data.get("model"), 120),
                "permission_mode": _public_text(data.get("permissionMode") or data.get("permission_mode"), 64),
                "tools": [_public_text(item, 160) for item in (data.get("tools") or []) if isinstance(item, str)][:300],
                "mcp_servers": [{"name": _public_text(item.get("name"), 160), "status": _public_text(item.get("status"), 64)}
                                for item in (data.get("mcp_servers") or []) if isinstance(item, dict)][:64],
                "plugins": [{key: _public_text(item.get(key), 160) for key in ("name", "version")}
                            for item in (data.get("plugins") or []) if isinstance(item, dict)][:64],
            }
            self.state["capabilities"] = capabilities
            self.state["status"]["permission_mode"] = capabilities["permission_mode"]
            events.append({"kind": "capabilities", "event": capabilities})
        elif kind == "system" and subtype in {"status", "session_state_changed"}:
            status = {"status": _public_text(data.get("status") or data.get("state"), 80),
                      "permission_mode": _public_text(data.get("permissionMode") or data.get("permission_mode") or self.state["status"].get("permission_mode"), 64),
                      "message": _public_text(data.get("message"), 1000)}
            self.state["status"] = status
            events.append({"kind": "status", "event": status})
        elif kind == "system" and subtype in {"task_started", "task_progress", "task_notification", "task_updated"}:
            identity = _public_text(data.get("task_id"), 200)
            if identity:
                patch = data.get("patch") if isinstance(data.get("patch"), dict) else {}
                values = {**data, **patch}
                row = self._row("tasks", identity)
                for key in ("tool_use_id", "description", "summary", "task_type", "subagent_type", "last_tool_name", "status"):
                    if key in values:
                        row[key] = _public_text(values[key], 8000 if key == "summary" else 1000)
                if subtype == "task_notification" and "status" not in values:
                    row["status"] = "completed"
                row.setdefault("status", "running")
                row["parent_tool_use_id"] = parent or row.get("parent_tool_use_id", "")
                if isinstance(values.get("usage"), dict):
                    row["usage"] = _usage(values["usage"])
                events.append({"kind": "task", "event": copy.deepcopy(row)})
        elif kind == "tool_progress":
            identity = _public_text(data.get("tool_use_id"), 200)
            if identity:
                row = self._row("tool_progress", identity, tool_use_id=identity, parent_tool_use_id=parent,
                                tool_name=_public_text(data.get("tool_name"), 160),
                                elapsed_time_seconds=data.get("elapsed_time_seconds") if isinstance(data.get("elapsed_time_seconds"), (int, float)) else 0)
                events.append({"kind": "tool_progress", "event": copy.deepcopy(row)})
        elif kind == "system" and subtype in {"hook_started", "hook_progress", "hook_response"}:
            identity = _public_text(data.get("hook_id") or data.get("uuid"), 200)
            if identity:
                row = self._row("hooks", identity)
                row.update(name=_public_text(data.get("hook_name") or row.get("name"), 160),
                           event=_public_text(data.get("hook_event") or row.get("event"), 160),
                           status=_public_text(data.get("outcome") or ("completed" if subtype == "hook_response" else "running"), 64))
                for stream in ("stdout", "stderr"):
                    if stream in data:
                        row[stream] = _public_text(str(row.get(stream) or "") + str(data[stream] or ""), 4000)
                if isinstance(data.get("exit_code"), int):
                    row["exit_code"] = data["exit_code"]
                events.append({"kind": "hook", "event": copy.deepcopy(row)})
        elif kind == "rate_limit_event":
            raw = data.get("rate_limit_info") if isinstance(data.get("rate_limit_info"), dict) else {}
            status = {"status": _public_text(raw.get("status"), 64),
                      "rate_limit_type": _public_text(raw.get("rateLimitType") or raw.get("rate_limit_type"), 64),
                      "is_using_overage": bool(raw.get("isUsingOverage") or raw.get("is_using_overage"))}
            for field, keys in (("resets_at", ("resetsAt", "resets_at")), ("utilization", ("utilization",))):
                for key in keys:
                    if isinstance(raw.get(key), (int, float)):
                        status[field] = raw[key]
                        break
            self.state["rate_limit"] = status
            events.append({"kind": "rate_limit", "event": status})

        message = data.get("message") if isinstance(data.get("message"), dict) else {}
        blocks = message.get("content") if isinstance(message.get("content"), list) else []
        if parent and kind in {"assistant", "user"}:
            row = self._row("subagents", parent, parent_tool_use_id=parent)
            row.setdefault("text", "")
            row.setdefault("thinking", "")
            row.setdefault("tools", [])
            for block in blocks:
                if not isinstance(block, dict):
                    continue
                block_type = block.get("type")
                if block_type in {"text", "thinking"}:
                    value = _public_text(block.get(block_type), 16000)
                    row[block_type] = _public_text(row[block_type] + value, 24000)
                elif block_type in {"tool_use", "tool_result"}:
                    identity = str(block.get("id") or block.get("tool_use_id") or "")
                    tool = next((item for item in row["tools"] if item.get("id") == identity), None)
                    if tool is None:
                        tool = {"id": identity}
                        row["tools"].append(tool)
                        del row["tools"][:-32]
                    if block_type == "tool_use":
                        tool.update(name=_public_text(block.get("name"), 160), status="running")
                    else:
                        tool.update(status="failed" if block.get("is_error") else "completed", content=_public_text(block.get("content"), 4000))
            events.append({"kind": "subagent", "event": copy.deepcopy(row)})
            return events

        if kind == "assistant":
            for block in blocks:
                if isinstance(block, dict) and block.get("type") == "tool_use" and block.get("name") in {"TaskCreate", "TaskUpdate", "TaskList", "TaskGet"}:
                    self._calls[str(block.get("id") or "")] = copy.deepcopy(block)
        elif kind == "user":
            structured = data.get("tool_use_result") if isinstance(data.get("tool_use_result"), dict) else {}
            for block in blocks:
                if not isinstance(block, dict) or block.get("type") != "tool_result":
                    continue
                call = self._calls.pop(str(block.get("tool_use_id") or ""), None)
                if call is None or block.get("is_error"):
                    continue
                task_input = call.get("input") if isinstance(call.get("input"), dict) else {}
                task = structured.get("task") if isinstance(structured.get("task"), dict) else {}
                if call["name"] in {"TaskCreate", "TaskGet"} and task.get("id"):
                    values = {**task_input, **task}
                    self._row("todos", str(task["id"]), title=_public_text(values.get("subject"), 240),
                              status=str(values.get("status") or "pending"), active_form=_public_text(values.get("activeForm") or values.get("active_form"), 240))
                    events.append(self._plan())
                elif call["name"] == "TaskUpdate":
                    identity = str(task_input.get("taskId") or task_input.get("task_id") or task_input.get("id") or "")
                    if task_input.get("status") == "deleted":
                        self.state["todos"] = [item for item in self.state["todos"] if item.get("id") != identity]
                    elif identity:
                        row = self._row("todos", identity)
                        for source, target in (("subject", "title"), ("status", "status"), ("activeForm", "active_form"), ("active_form", "active_form")):
                            if source in task_input:
                                row[target] = _public_text(task_input[source], 240)
                    events.append(self._plan())
                elif call["name"] == "TaskList" and isinstance(structured.get("tasks"), list):
                    self.state["todos"] = []
                    for task in structured["tasks"][:64]:
                        if isinstance(task, dict) and task.get("id"):
                            self._row("todos", str(task["id"]), title=_public_text(task.get("subject"), 240), status=_public_text(task.get("status") or "pending", 64))
                    events.append(self._plan())
        return events
