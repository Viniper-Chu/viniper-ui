"""Bounded startup for the Claude Code bidirectional SDK protocol."""
from __future__ import annotations

import asyncio
import json
import time
import re
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
    # The Agent tool result owns child output. Forwarding child text into this
    # flat parent stream duplicates it and merges independent assistants.
    await write(build_native_initialize_request(request_id, forward_subagent_text=False))
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
