"""Host-owned Application Port for the native Viniper page.

The renderer never calls this module.  A single long-lived Node bridge owns
the copied Harness application and its SQLite-backed session/event state.
Native session IDs are mapped to durable Harness session IDs, so restarting
the Python host does not silently create a new conversation.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import uuid
from collections.abc import AsyncIterable
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


_PROXY_ENV_KEYS = ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY")
_LOOPBACK_NO_PROXY = ("localhost", "127.0.0.1", "::1")


def _merge_no_proxy_values(*values: object) -> str:
    """Preserve caller/system bypass entries and always keep host loopback local."""

    merged: list[str] = []
    for raw in values:
        for token in str(raw or "").replace(";", ",").split(","):
            value = token.strip()
            if value and value != "<local>" and value not in merged:
                merged.append(value)
    for value in _LOOPBACK_NO_PROXY:
        if value not in merged:
            merged.append(value)
    return ",".join(merged)


def _normalize_proxy_url(value: object) -> str | None:
    """Return a safe HTTP(S) proxy URL or ``None`` for a malformed value.

    The value is passed only to the host-owned bridge environment.  It is
    never logged or returned in an evidence payload, and credentials (if a
    user explicitly configured them) remain inside the child environment.
    """

    raw = str(value or "").strip()
    if not raw or any(ord(character) < 0x20 for character in raw):
        return None
    candidate = raw if "://" in raw else f"http://{raw}"
    try:
        parsed = urlsplit(candidate)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError:
        return None
    if parsed.scheme.lower() not in {"http", "https"} or not hostname or port is None:
        return None
    if not 1 <= port <= 65535 or parsed.query or parsed.fragment:
        return None
    return parsed.geturl()


def _read_windows_system_proxy() -> dict[str, str]:
    """Read the current user's WinINET proxy without invoking a network call.

    WinHTTP and WinINET are separate stores.  The packaged desktop process
    needs the user's WinINET route when no explicit proxy environment exists,
    while PAC-only or malformed values remain disabled rather than guessed.
    """

    if os.name != "nt":
        return {}
    try:
        import winreg

        key_path = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings"
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path) as key:
            enabled = winreg.QueryValueEx(key, "ProxyEnable")[0]
            server = winreg.QueryValueEx(key, "ProxyServer")[0]
            override = winreg.QueryValueEx(key, "ProxyOverride")[0]
    except (ImportError, OSError, TypeError, ValueError):
        return {}
    try:
        if not bool(int(enabled)):
            return {}
    except (TypeError, ValueError):
        return {}
    raw_server = str(server or "").strip()
    if not raw_server:
        return {}

    parsed: dict[str, str] = {}
    for entry in raw_server.split(";"):
        item = entry.strip()
        if not item:
            continue
        if "=" in item:
            scheme, address = item.split("=", 1)
            scheme = scheme.strip().lower()
        else:
            scheme, address = "default", item
        proxy = _normalize_proxy_url(address)
        if proxy is not None and scheme in {"default", "http", "https"}:
            parsed[scheme] = proxy
    http_proxy = parsed.get("http") or parsed.get("default") or parsed.get("https")
    https_proxy = parsed.get("https") or parsed.get("default") or parsed.get("http")
    if not http_proxy and not https_proxy:
        return {}

    return {
        "HTTP_PROXY": http_proxy or https_proxy or "",
        "HTTPS_PROXY": https_proxy or http_proxy or "",
        "ALL_PROXY": parsed.get("default") or https_proxy or http_proxy or "",
        "NO_PROXY": _merge_no_proxy_values(override),
    }


class HarnessTerminalTimeoutError(TimeoutError):
    """Raised when an owned Harness run stops reporting activity."""

    code = "terminal-timeout"

    def __init__(self, timeout_seconds: float) -> None:
        self.timeout_seconds = max(0.0, float(timeout_seconds))
        super().__init__(f"Harness run stopped reporting activity ({self.timeout_seconds:g}s idle deadline)")


async def await_run_queue_message(
    queue: asyncio.Queue[dict[str, Any]],
    timeout_seconds: float,
    on_timeout: Any,
) -> dict[str, Any]:
    """Wait for one run envelope and cancel the owned run on deadline.

    Keeping this small helper at the Application Port seam gives the host a
    deterministic bound even when the Node bridge/provider stalls.  The
    callback is deliberately host-owned so cancellation cannot be faked by
    renderer state or by clearing a queue.
    """

    try:
        return await asyncio.wait_for(queue.get(), timeout=max(0.001, float(timeout_seconds)))
    except asyncio.TimeoutError as error:
        await on_timeout()
        raise HarnessTerminalTimeoutError(timeout_seconds) from error


def _terminal_timeout_seconds() -> float:
    """Resolve the run's inactivity deadline; total task duration is unbounded."""

    raw_value = os.environ.get("VINIPER_HARNESS_TERMINAL_TIMEOUT_SECONDS", "90")
    try:
        value = float(raw_value)
    except (TypeError, ValueError):
        value = 90.0
    if value <= 0:
        value = 90.0
    return min(value, 900.0)


def _track_pending_user_input(pending: dict[str, dict[str, Any]], event: dict[str, Any]) -> None:
    """Track explicit user decisions, not internal locks or automatic tools."""
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    event_type = str(event.get("type") or "")
    aliases = {str(payload.get(key) or "") for key in ("id", "activityId", "callId", "request_id", "requestId")}
    aliases.discard("")
    if event_type in {"interaction.resolved", "question.resolved", "user.input.resolved"}:
        for key, record in tuple(pending.items()):
            if aliases.intersection(record["aliases"]):
                pending.pop(key, None)
        return
    if event_type not in {"interaction.requested", "question.requested", "user.input.requested", "tool.requested"}:
        return
    status = str(payload.get("status") or "waiting")
    if status not in {"waiting", "pending", "waiting_input", "running"}:
        return
    tool_input = payload.get("input") if isinstance(payload.get("input"), dict) else {}
    tool_name = str(payload.get("toolName") or payload.get("tool_name") or "").replace("_", "").casefold()
    question = (
        event_type in {"question.requested", "user.input.requested"}
        or str(payload.get("kind") or "") in {"question", "questions", "request_user_input"}
        or tool_name in {"askuserquestion", "requestuserinput", "questions"}
        or bool(payload.get("questions") or tool_input.get("questions"))
    )
    permission = event_type == "interaction.requested" and _is_permission_interaction(payload)
    if not aliases or not (permission or question):
        return
    call_id = str(payload.get("callId") or payload.get("request_id") or payload.get("requestId") or payload.get("id") or "")
    pending[call_id] = {
        "aliases": aliases,
        "call_id": call_id,
        "session_id": str(event.get("sessionId") or payload.get("sessionId") or ""),
        "permission": permission and not question,
    }


def _runtime_event_to_provider_event(event: dict[str, Any]) -> dict[str, Any] | None:
    event_type = str(event.get("type") or "")
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    engine_id = str(event.get("engineId") or payload.get("engineId") or "")
    if engine_id and engine_id != "viniper":
        return None
    run_id = str(payload.get("runId") or payload.get("run_id") or "")
    if event_type == "plan.updated":
        plan = payload.get("plan") if isinstance(payload.get("plan"), dict) else {}
        raw_steps = plan.get("steps") if isinstance(plan.get("steps"), list) else []
        steps = [
            {
                "id": str(step.get("id") or f"step-{index + 1}"),
                "title": str(step.get("title") or step.get("step") or f"步骤 {index + 1}"),
                "status": str(step.get("status") or "pending"),
            }
            for index, step in enumerate(raw_steps)
            if isinstance(step, dict)
        ]
        active = next((index + 1 for index, step in enumerate(steps) if step["status"] == "in_progress"), 0)
        completed = sum(1 for step in steps if step["status"] == "completed")
        return {
            "type": "plan",
            "session_id": str(event.get("sessionId") or payload.get("sessionId") or ""),
            "run_id": run_id,
            "explanation": str(plan.get("explanation") or ""),
            "steps": steps,
            "current": active or min(completed + 1, len(steps)),
            "total": len(steps),
        }
    if event_type == "turn.diff.updated":
        diff = payload.get("diff") if isinstance(payload.get("diff"), dict) else {}
        return {
            "type": "turn_diff",
            "turn_diff": diff,
            "run_id": run_id,
            "turn_id": str(event.get("turnId") or run_id),
        }
    if event_type == "turn.usage.updated":
        usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else {}
        source = str(payload.get("source") or usage.get("source") or "estimated")
        projected_usage = {
            "input_tokens": max(0, int(usage.get("input") or usage.get("input_tokens") or 0)),
            "output_tokens": max(0, int(usage.get("output") or usage.get("output_tokens") or 0)),
            "cache_read_input_tokens": max(0, int(usage.get("cacheHitInput") or usage.get("cache_read_input_tokens") or 0)),
            "cache_creation_input_tokens": max(0, int(usage.get("cacheWriteInput") or usage.get("cache_creation_input_tokens") or 0)),
            "total_tokens": max(0, int(usage.get("total") or usage.get("total_tokens") or 0)),
            "source": "provider" if source == "provider" else "estimated",
        }
        return {
            "type": "turn_usage",
            "turn_usage": projected_usage,
            "source": projected_usage["source"],
            "run_id": run_id,
            "turn_id": str(event.get("turnId") or run_id),
        }
    if event_type == "thinking.started":
        return {
            "type": "content_block_start",
            "content_block": {"type": "thinking"},
            "activity_id": str(payload.get("id") or ""),
        }
    if event_type in {"thinking.delta", "reasoning.delta"}:
        return {
            "type": "content_block_delta",
            "delta": {"type": "thinking_delta", "thinking": str(payload.get("text") or "")},
            "activity_id": str(payload.get("activityId") or payload.get("id") or ""),
        }
    if event_type in {"thinking.completed", "reasoning.completed"}:
        return {
            "type": "thinking_complete",
            "activity_id": str(payload.get("activityId") or payload.get("id") or ""),
        }
    if event_type in {"message.delta", "text.delta"}:
        return {"type": "text", "content": str(payload.get("text") or "")}
    if event_type == "tool.requested":
        return {
            "type": "tool_start",
            "tool_name": str(payload.get("toolName") or ""),
            "call_id": str(payload.get("callId") or payload.get("id") or ""),
            "content": str(payload.get("title") or payload.get("detail") or ""),
            "status": str(payload.get("status") or "running"),
            "input": payload.get("input") if isinstance(payload.get("input"), dict) else {},
            "run_id": run_id,
        }
    if event_type == "interaction.requested":
        status = str(payload.get("status") or "waiting")
        if _is_permission_interaction(payload):
            # Plan-mode policy rejections are terminal policy outcomes, not a
            # pending approval; keep the existing permission contract only
            # for actual policy interactions.
            # Only the Harness permission-policy request/rejection is exposed
            # through the permission channel.  Other runtime interactions
            # (tool-loop limits, resource waits, lifecycle failures) must not
            # become a misleading permission card in the renderer.
            if status in {"failed", "rejected"}:
                return {
                    "type": "permission_resolved",
                    "call_id": str(payload.get("callId") or payload.get("id") or ""),
                    "decision": "reject",
                    "content": str(payload.get("detail") or "工具已安全拒绝"),
                    "status": status,
                    "run_id": run_id,
                }
            return {
                "type": "permission_request",
                "call_id": str(payload.get("callId") or payload.get("id") or ""),
                "tool_name": str(payload.get("toolName") or ""),
                "content": str(payload.get("detail") or payload.get("title") or "需要权限"),
                "status": "waiting",
                "run_id": run_id,
                "session_id": str(event.get("sessionId") or payload.get("sessionId") or ""),
                "owner": "viniper",
            }
        if status in {"failed", "rejected"} or str(payload.get("kind") or "") == "error":
            return {
                "type": "runtime_error",
                "content": str(payload.get("detail") or payload.get("title") or "Harness AgentRuntime interaction failed"),
                "status": status,
                "run_id": run_id,
            }
        return None
    if event_type == "interaction.resolved":
        if not _is_permission_resolution(payload):
            return None
        return {
            "type": "permission_resolved",
            "call_id": str(payload.get("callId") or payload.get("id") or ""),
            "decision": str(payload.get("decision") or "reject"),
            "content": str(payload.get("detail") or "权限已处理"),
            "run_id": run_id,
        }
    if event_type in {"tool.completed", "tool.failed", "tool.cancelled"}:
        content = str(payload.get("result") or payload.get("detail") or "")
        reason = str(payload.get("reason") or "")
        if not reason and event_type == "tool.failed" and "review-risk-rejected" in content:
            reason = "review-risk-rejected"
        projected = {
            "type": "tool_result",
            "tool_name": str(payload.get("toolName") or ""),
            "call_id": str(payload.get("callId") or payload.get("activityId") or ""),
            "content": content,
            "status": "success" if event_type == "tool.completed" else "error",
            "run_id": run_id,
        }
        if reason:
            projected["reason"] = reason
            projected["detail"] = str(payload.get("detail") or content)
        return projected
    if event_type in {"run.failed", "run.cancelled"}:
        return {
            "type": "runtime_error" if event_type == "run.failed" else "runtime_cancelled",
            "content": str(payload.get("activity", {}).get("detail") or payload.get("message") or event_type),
            "run_id": run_id,
        }
    if event_type == "runtime.error":
        error = payload.get("error") if isinstance(payload.get("error"), dict) else payload
        return {
            "type": "runtime_error",
            "content": str(error.get("message") or error.get("detail") or "Harness AgentRuntime failed"),
            "code": str(error.get("code") or "runtime_error"),
            "phase": str(error.get("phase") or payload.get("phase") or "runtime"),
            "cause": str(error.get("cause") or ""),
            "retry_after": error.get("retryAfter"),
            "retryable": bool(error.get("retryable", False)),
            "side_effect_committed": bool(error.get("sideEffectCommitted", False)),
            "run_id": run_id,
        }
    if event_type == "interrupt.acknowledged":
        return {
            "type": "interrupt_acknowledged",
            "run_id": run_id,
            "status": str(payload.get("status") or "acknowledged"),
            "requested_at": payload.get("requestedAt"),
            "acknowledged_at": payload.get("acknowledgedAt") or event.get("timestamp"),
        }
    if event_type == "run.completed":
        return {"type": "message_stop"}
    return None


def _runtime_usage_to_provider_event(message: dict[str, Any]) -> dict[str, Any] | None:
    """Project the bridge's host-owned TokenLedger snapshot without raw telemetry."""
    usage = message.get("usage") if isinstance(message.get("usage"), dict) else {}
    if not usage:
        return None
    source = "provider" if str(message.get("source") or usage.get("source")) == "provider" else "estimated"
    projected = dict(usage)
    projected["source"] = source
    return {
        "type": "turn_usage",
        "turn_usage": projected,
        "source": source,
        "run_id": str(message.get("run_id") or ""),
        "session_id": str(message.get("session_id") or ""),
    }


def _is_permission_interaction(payload: dict[str, Any]) -> bool:
    """Recognize only the Harness permission-policy interaction seam."""
    if payload.get("permission") is True or payload.get("permissionRequest") is True:
        return True
    title = str(payload.get("title") or "")
    return title in {"等待工具权限", "工具已安全拒绝"}


def _is_permission_resolution(payload: dict[str, Any]) -> bool:
    """Resource-lock and other internal resolutions have no tool identity."""
    return bool(payload.get("callId") or payload.get("toolName") or payload.get("permission") is True)


class HarnessApplicationPort:
    """Stable host boundary for the copied Harness AgentRuntime."""

    contract_id = "harness-application-port.v2"

    def __init__(self, runtime_script: Path | None = None, runtime_data_root: Path | None = None) -> None:
        self.runtime_script = (runtime_script or Path(__file__).with_name("harness_runtime_bridge.js")).resolve()
        configured_root = runtime_data_root or Path(
            os.environ.get("VINIPER_HARNESS_DATA_ROOT", "")
            or Path(os.environ.get("VINIPER_UI_DATA_DIR", Path(__file__).with_name("data"))).as_posix()
        )
        self.runtime_data_root = Path(configured_root).expanduser().resolve() / "harness-runtime"
        self._bridge_process: asyncio.subprocess.Process | None = None
        self._bridge_reader_task: asyncio.Task[None] | None = None
        self._bridge_stderr_task: asyncio.Task[None] | None = None
        self._bridge_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._run_queues: dict[str, asyncio.Queue[dict[str, Any]]] = {}
        self._bridge_lock = asyncio.Lock()
        self._control_lock = asyncio.Lock()
        self._control_waiters: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self._active_runs: dict[str, asyncio.subprocess.Process] = {}

    def active_run(self, session_id: str) -> bool:
        process = self._active_runs.get(str(session_id))
        return process is not None and process.returncode is None

    @staticmethod
    def _child_environment(
        *,
        environ: dict[str, str] | None = None,
        system_proxy: dict[str, str] | None = None,
        platform: str | None = None,
    ) -> dict[str, str]:
        allowed = {
            "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "TEMP", "TMP",
            "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA",
            "VINIPER_DEMO_FIXTURE", "VINIPER_HARNESS_ALLOW_EXTERNAL_NETWORK",
            "VINIPER_HARNESS_REVIEW_PROVIDER_LIMIT",
            "NODE_USE_ENV_PROXY", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
        }
        source = os.environ if environ is None else environ
        normalized = {str(key).upper(): str(value) for key, value in source.items()}
        env = {key: normalized[key] for key in allowed if key in normalized}
        explicit_proxy = any(normalized.get(key) for key in _PROXY_ENV_KEYS)
        if explicit_proxy:
            env["NO_PROXY"] = _merge_no_proxy_values(normalized.get("NO_PROXY", ""))
            env["NODE_USE_ENV_PROXY"] = "1"
            return env
        if (platform or os.name) != "nt":
            return env

        fallback = system_proxy if system_proxy is not None else _read_windows_system_proxy()
        fallback_normalized = {str(key).upper(): str(value) for key, value in fallback.items()}
        fallback_proxies = {
            key: _normalize_proxy_url(fallback_normalized.get(key))
            for key in _PROXY_ENV_KEYS
        }
        if not fallback_proxies["ALL_PROXY"]:
            fallback_proxies["ALL_PROXY"] = fallback_proxies["HTTPS_PROXY"] or fallback_proxies["HTTP_PROXY"]
        if not any(fallback_proxies.values()):
            return env
        for key, value in fallback_proxies.items():
            if value:
                env[key] = value
        env["NO_PROXY"] = _merge_no_proxy_values(
            normalized.get("NO_PROXY", ""),
            fallback_normalized.get("NO_PROXY", ""),
        )
        env["NODE_USE_ENV_PROXY"] = "1"
        return env

    def _environment(self) -> dict[str, str]:
        env = self._child_environment()
        env["VINIPER_HARNESS_DATA_ROOT"] = str(self.runtime_data_root)
        # The copied Harness package owns plugins/ and skills/ below the
        # harness-runtime directory. Pointing at viniper-ui made discovery
        # silently return an empty catalog in packaged/formal launches.
        env["VINIPER_HARNESS_ASSETS_ROOT"] = str(self.runtime_script.parent / "harness-runtime")
        env["VINIPER_HARNESS_WORKDIR"] = str(self.runtime_script.parent.parent)
        return env

    async def _read_stdout(self, process: asyncio.subprocess.Process) -> None:
        assert process.stdout is not None
        async for raw_line in process.stdout:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(message, dict):
                if message.get("type") == "control.response":
                    request_id = str(message.get("request_id") or "")
                    waiter = self._control_waiters.get(request_id)
                    if waiter is not None and not waiter.done():
                        waiter.set_result(message)
                        continue
                native_session_id = str(message.get("native_session_id") or "")
                run_queue = self._run_queues.get(native_session_id)
                if native_session_id and run_queue is not None:
                    await run_queue.put(message)
                    continue
                await self._bridge_queue.put(message)

    async def _drain_stderr(self, process: asyncio.subprocess.Process) -> None:
        if process.stderr is None:
            return
        async for _ in process.stderr:
            # Node/Electron diagnostics stay owned by the host and are not
            # copied into renderer logs or report artifacts.
            continue

    async def _ensure_bridge(self) -> None:
        async with self._bridge_lock:
            if self._bridge_process is not None and self._bridge_process.returncode is None:
                return
            node = shutil.which("node")
            if not node:
                raise RuntimeError("Harness AgentRuntime requires Node.js")
            if not self.runtime_script.is_file():
                raise RuntimeError(f"Harness AgentRuntime bridge missing: {self.runtime_script}")
            self.runtime_data_root.mkdir(parents=True, exist_ok=True)
            process = await asyncio.create_subprocess_exec(
                node,
                str(self.runtime_script),
                cwd=str(self.runtime_script.parent),
                env=self._environment(),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                # Capability snapshots are host-owned JSON projections.  A
                # long-lived install can legitimately exceed asyncio's
                # 64-KiB readline limit; keep the stream framing intact
                # without falling back to renderer-side state or truncation.
                limit=8 * 1024 * 1024,
            )
            self._bridge_process = process
            self._bridge_reader_task = asyncio.create_task(self._read_stdout(process))
            self._bridge_stderr_task = asyncio.create_task(self._drain_stderr(process))
            ready = await asyncio.wait_for(self._bridge_queue.get(), timeout=30.0)
            if ready.get("type") != "bridge.ready":
                raise RuntimeError(str(ready.get("message") or "Harness bridge failed to initialize"))

    async def _send(self, message: dict[str, Any]) -> None:
        process = self._bridge_process
        if process is None or process.returncode is not None or process.stdin is None:
            raise RuntimeError("Harness bridge is not running")
        process.stdin.write((json.dumps(message, ensure_ascii=False) + "\n").encode("utf-8"))
        await process.stdin.drain()

    async def _terminate_bridge(self) -> None:
        process = self._bridge_process
        if process is None or process.returncode is not None:
            return
        if process.stdin is not None:
            process.stdin.close()
        try:
            await asyncio.wait_for(process.wait(), timeout=4.0)
        except asyncio.TimeoutError:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=2.0)
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
        self._bridge_process = None

    async def shutdown(self) -> None:
        await self._terminate_bridge()
        for task in (self._bridge_reader_task, self._bridge_stderr_task):
            if task is not None and not task.done():
                task.cancel()
        self._bridge_reader_task = None
        self._bridge_stderr_task = None

    async def control(self, operation: str, **payload: Any) -> dict[str, Any]:
        """Invoke a non-renderer Harness Application Port operation."""
        concurrent_controls = {
            "permission.resolve", "collaboration.snapshot", "collaboration.send",
            "collaboration.delegate", "collaboration.wait", "collaboration.cancel-wait",
            "collaboration.mark-read", "subagent.spawn", "subagent.cancel",
            "subagents.snapshot", "capabilities.snapshot", "sessions.ensure", "permissions.snapshot",
        }
        if operation not in concurrent_controls and any(self.active_run(session_id) for session_id in tuple(self._active_runs)):
            raise RuntimeError("Harness control operations are unavailable while a run owns the Application Port")
        await self._ensure_bridge()
        request_id = str(uuid.uuid4())
        async with self._control_lock:
            loop = asyncio.get_running_loop()
            waiter: asyncio.Future[dict[str, Any]] = loop.create_future()
            self._control_waiters[request_id] = waiter
            try:
                await self._send({"op": str(operation), "request_id": request_id, **payload})
                message = await asyncio.wait_for(waiter, timeout=20.0)
            finally:
                self._control_waiters.pop(request_id, None)
            if not message.get("ok"):
                raise RuntimeError(str(message.get("error") or "Harness control operation failed"))
            data = message.get("data")
            return data if isinstance(data, dict) else {}

    async def session_snapshot(self) -> dict[str, Any]:
        """Return the redacted session projection owned by Harness Runtime."""
        return await self.control("sessions.snapshot")

    async def delete_session(self, native_session_id: str) -> dict[str, Any]:
        """Delete a Shell-owned Harness session and its durable native mapping."""
        return await self.control("sessions.delete", native_session_id=str(native_session_id))

    async def cleanup_session_artifacts(self, native_session_id: str, run_ids: list[str] | None = None) -> dict[str, Any]:
        """Remove run-owned workspace/artifact/memory rows through the Harness owner."""
        return await self.control(
            "harness.operation",
            target="session.cleanup-artifacts",
            args={"native_session_id": str(native_session_id), "run_ids": [str(value) for value in (run_ids or [])]},
            native_session_id=str(native_session_id),
        )

    async def permissions_snapshot(self) -> dict[str, Any]:
        """Return pending host-owned approvals without exposing credentials."""
        return await self.control("permissions.snapshot")

    async def resolve_permission(self, session_id: str, run_id: str, call_id: str, decision: str) -> dict[str, Any]:
        return await self.control(
            "permission.resolve",
            session_id=str(session_id),
            run_id=str(run_id),
            call_id=str(call_id),
            decision="allow-once" if decision == "allow-once" else "reject",
        )

    async def _cancel_owned_process(self, process: asyncio.subprocess.Process, session_id: str = "") -> None:
        if process is not self._bridge_process or process.returncode is not None:
            return
        try:
            await self._send({"op": "cancel", "native_session_id": str(session_id)})
        except (BrokenPipeError, ConnectionError, RuntimeError):
            # A run cancellation never owns the shared bridge process. Other
            # sessions must not be terminated because this channel is closing.
            pass

    async def stream(
        self,
        *,
        session_id: str,
        prompt: str,
        model: str,
        workdir: str,
        permission_mode: str = "auto",
        provider_id: str | None = None,
        base_url: str = "",
        host_secret_value: str = "",
        agent: str = "viniper",
        memory_enabled: bool = True,
    ) -> AsyncIterable[dict[str, Any]]:
        sid = str(session_id)
        if self.active_run(sid):
            raise RuntimeError("Harness Application Port already owns this session run")
        await self._ensure_bridge()
        run_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._run_queues[sid] = run_queue
        self._active_runs[sid] = self._bridge_process  # type: ignore[assignment]
        selected_provider = str(provider_id or ("demo" if str(model).startswith("demo-") else "deepseek"))
        request = {
            "op": "run",
            "native_session_id": sid,
            "agent": str(agent),
            "prompt": str(prompt),
            "model": str(model),
            "provider_id": selected_provider,
            "base_url": str(base_url or ""),
            "workdir": str(workdir),
            "permission_mode": str(permission_mode),
            "memory_enabled": bool(memory_enabled),
        }
        # Host-only secret value is sent over stdin and is never emitted back.
        if host_secret_value:
            request["host_secret_value"] = str(host_secret_value)
        loop = asyncio.get_running_loop()
        terminal_timeout_seconds = _terminal_timeout_seconds()
        idle_deadline = loop.time() + terminal_timeout_seconds
        pending_user_inputs: dict[str, dict[str, Any]] = {}
        try:
            await self._send(request)
            # Runtime activity ids and provider call ids are not guaranteed to
            # be the same. Keep both aliases mapped to one canonical id so the
            # native renderer can merge each request/result pair.
            tool_names: dict[str, str] = {}
            tool_calls: dict[str, str] = {}
            while True:
                remaining_seconds = (
                    min(15.0, terminal_timeout_seconds)
                    if pending_user_inputs
                    else max(0.001, idle_deadline - loop.time())
                )
                try:
                    message = await asyncio.wait_for(run_queue.get(), timeout=remaining_seconds)
                except asyncio.TimeoutError as error:
                    if pending_user_inputs:
                        try:
                            # Waiting for a person has no deadline, but the
                            # owner must still answer a bounded read-only ping.
                            if self._bridge_process is None or self._bridge_process.returncode is not None:
                                raise RuntimeError("Harness bridge exited while waiting for user input")
                            state = await asyncio.wait_for(self.control("permissions.snapshot"), timeout=20.0)
                            approvals = state.get("pending") if isinstance(state.get("pending"), list) else []
                            for key, pending in tuple(pending_user_inputs.items()):
                                if pending["permission"] and not any(
                                    str(item.get("callId") or "") == pending["call_id"]
                                    and str(item.get("sessionId") or "") == pending["session_id"]
                                    for item in approvals if isinstance(item, dict)
                                ):
                                    pending_user_inputs.pop(key, None)
                            idle_deadline = loop.time() + terminal_timeout_seconds
                            continue
                        except (asyncio.TimeoutError, ConnectionError, RuntimeError):
                            pass
                    if self._bridge_process is not None:
                        await self._cancel_owned_process(self._bridge_process, sid)
                    raise HarnessTerminalTimeoutError(terminal_timeout_seconds) from error
                message_type = str(message.get("type") or "")
                native_message_id = str(message.get("native_session_id") or "")
                if native_message_id and native_message_id != sid:
                    continue
                idle_deadline = loop.time() + terminal_timeout_seconds
                if message_type == "runtime.event" and isinstance(message.get("event"), dict):
                    runtime_event = message["event"]
                    runtime_type = str(runtime_event.get("type") or "")
                    _track_pending_user_input(pending_user_inputs, runtime_event)
                    yield {"type": "runtime.event", "event": runtime_event}
                    projected = _runtime_event_to_provider_event(runtime_event)
                    if projected is not None:
                        if runtime_event.get("type") == "tool.requested":
                            payload = runtime_event.get("payload") if isinstance(runtime_event.get("payload"), dict) else {}
                            tool_name = str(payload.get("toolName") or "")
                            canonical_call_id = str(payload.get("callId") or payload.get("id") or "")
                            for key in (payload.get("id"), payload.get("callId")):
                                if key:
                                    key_text = str(key)
                                    if canonical_call_id:
                                        tool_calls[key_text] = canonical_call_id
                                    if tool_name:
                                        tool_names[key_text] = tool_name
                        elif projected.get("type") == "tool_result":
                            payload = runtime_event.get("payload") if isinstance(runtime_event.get("payload"), dict) else {}
                            candidates = [
                                projected.get("call_id"),
                                payload.get("activityId"),
                                payload.get("callId"),
                                payload.get("id"),
                            ]
                            direct_name = str(payload.get("toolName") or "")
                            projected["tool_name"] = direct_name or next(
                                (tool_names.get(str(candidate), "") for candidate in candidates if candidate),
                                "",
                            )
                            resolved_call_id = next(
                                (tool_calls.get(str(candidate), "") for candidate in candidates if candidate),
                                "",
                            )
                            if resolved_call_id:
                                projected["call_id"] = resolved_call_id
                        yield {"type": "provider.event", "event": projected}
                    continue
                if message_type in {"runtime.started", "runtime.completed"}:
                    finalization_deadline = None
                    yield {**message, "contract": self.contract_id}
                    if message_type == "runtime.completed":
                        return
                    continue
                if message_type == "runtime.usage":
                    projected_usage = _runtime_usage_to_provider_event(message)
                    if projected_usage is not None:
                        yield {"type": "provider.event", "event": projected_usage}
                    continue
                if message_type in {"runtime.failed", "bridge.failed"}:
                    yield {**message, "contract": self.contract_id}
                    raise RuntimeError(str(message.get("message") or "Harness AgentRuntime failed"))
        except asyncio.CancelledError:
            process = self._bridge_process
            if process is not None:
                await self._cancel_owned_process(process, sid)
            yield {
                "type": "runtime.cancelled",
                "engine": "harness-runtime",
                "contract": self.contract_id,
                "session_id": sid,
            }
            raise
        finally:
            if self._active_runs.get(sid) is self._bridge_process:
                self._active_runs.pop(sid, None)
            self._run_queues.pop(sid, None)
