"""Native macOS/Linux Claude adapter behind the existing AgentRuntime port.

Discovery and offline capability checks never install, upgrade, log in, or send
a provider request. The application continues to own sessions and credentials.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Awaitable, Callable, Sequence

from agent_runtime import (
    AgentRuntime, AgentRunSpec, RuntimeCapabilities, RuntimeProbe, RuntimeProcess,
    DEFAULT_AUTO_COMPACT_WINDOW, REQUIRED_CLAUDE_FLAGS, _claude_arguments,
    _completed, _permission_modes_from_help, stable_session_name, version_at_least,
    native_auth_projection, native_plugins_projection,
)


def discover_native_claude() -> tuple[str, ...]:
    found = shutil.which("claude")
    candidates = [
        Path(found) if found else None,
        Path.home() / ".local" / "bin" / "claude",
        Path("/opt/homebrew/bin/claude"),
        Path("/usr/local/bin/claude"),
    ]
    for candidate in candidates:
        if candidate and candidate.is_file() and os.access(candidate, os.X_OK):
            return (str(candidate),)
    return ("claude",)


class PosixAgentRuntime(AgentRuntime):
    native_posix = True

    def __init__(
        self,
        launcher: Sequence[str] | None = None,
        *,
        command_runner: Callable[[Sequence[str]], subprocess.CompletedProcess] | None = None,
        process_factory: Callable[..., Awaitable[Any]] | None = None,
    ) -> None:
        self.launcher = tuple(launcher) if launcher else discover_native_claude()
        self._inspection_runner = command_runner
        self.command_runner = command_runner or (lambda command: _completed(command, timeout=15))
        self.process_factory = process_factory or asyncio.create_subprocess_exec
        self._last_probe: RuntimeProbe | None = None
        self._runs: dict[str, RuntimeProcess] = {}

    def probe(self) -> RuntimeProbe:
        try:
            version_result = self.command_runner([*self.launcher, "--version"])
            version = str(version_result.stdout or version_result.stderr or "").strip().splitlines()
            version = version[0] if version else ""
            help_result = self.command_runner([*self.launcher, "--help"])
            help_text = str(help_result.stdout or "")
            missing = [flag for flag in REQUIRED_CLAUDE_FLAGS if flag not in help_text]
            # Some supported flags are hidden from --help. Probe their parser
            # with --help only, so no session or model request can be created.
            with tempfile.TemporaryDirectory(prefix="viniper-capability-") as directory:
                prompt = Path(directory) / "prompt.txt"
                prompt.write_text("Viniper capability probe\n", encoding="utf-8")
                for flag, value in (
                    ("--append-system-prompt-file", str(prompt)),
                    ("--permission-prompt-tool", "mcp__viniper_probe__permission_prompt"),
                ):
                    if flag in missing and self.command_runner([*self.launcher, flag, value, "--help"]).returncode == 0:
                        missing.remove(flag)
            compatible = version_result.returncode == 0 and help_result.returncode == 0 and version_at_least(version) and not missing
            status = "ready" if compatible else "cli_incompatible"
            detail = "macOS 原生 Claude Code 已通过离线能力检查" if sys.platform == "darwin" else "Linux 原生 Claude Code 已通过离线能力检查"
            if not compatible:
                detail = "Claude Code 需要 2.1.224 或更新版本及结构化会话能力"
                if missing:
                    detail += "；缺少参数：" + ", ".join(missing)
            modes = _permission_modes_from_help(help_text)
            capabilities = RuntimeCapabilities(
                stream_json=not any(flag in missing for flag in ("--input-format", "--output-format")),
                structured_input="--input-format" not in missing,
                structured_interactions=not any(flag in missing for flag in ("--input-format", "--settings", "--mcp-config", "--permission-prompt-tool")),
                usage="--output-format" not in missing,
                native_cli=True,
                agent_registry="--agents" in help_text,
                agent_view=bool(re.search(r"(?m)^\s*agents\s", help_text)),
                auto_permission="auto" in modes,
                auto_compact="--autocompact" in help_text,
                effective_context_window=DEFAULT_AUTO_COMPACT_WINDOW,
                permission_modes=modes,
                platform=sys.platform,
                reason="" if compatible else detail,
            )
            self._last_probe = RuntimeProbe(status=status, detail=detail, version=version, distro="", capabilities=capabilities)
        except FileNotFoundError:
            detail = "未找到 Claude Code CLI。请安装 macOS/Linux 原生 Claude Code 后重新检查；Viniper 可独立使用。"
            self._last_probe = RuntimeProbe(status="cli_missing", detail=detail, distro="", capabilities=RuntimeCapabilities(platform=sys.platform, reason=detail))
        except (OSError, subprocess.SubprocessError) as exc:
            detail = f"Claude Code 离线能力检查未完成：{type(exc).__name__}"
            self._last_probe = RuntimeProbe(status="recoverable_error", detail=detail, distro="", capabilities=RuntimeCapabilities(platform=sys.platform, reason=detail))
        return self._last_probe

    def capabilities(self) -> RuntimeCapabilities:
        return (self._last_probe or self.probe()).capabilities

    def cached_probe(self) -> RuntimeProbe | None:
        return self._last_probe

    def _local_json(self, arguments: Sequence[str], *, workdir: str = "") -> Any:
        """Only local CLI inspection commands; no prompt, login or catalogue sync."""
        command = [*self.launcher, *arguments]
        if self._inspection_runner:
            result = self._inspection_runner(command)
        else:
            removed = {"ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"} if arguments[0] == "auth" else set()
            env = {key: value for key, value in os.environ.items() if not key.upper().startswith("VINIPER_HOST_") and key.upper() not in removed}
            result = _completed(command, timeout=8, env=env, cwd=workdir or str(Path.home()))
        if result.returncode != 0 and not (list(arguments[:2]) == ["auth", "status"] and result.returncode == 1):
            raise RuntimeError("Claude Code 本地状态读取失败")
        return json.loads(str(result.stdout or "null"))

    def auth_status(self) -> dict[str, Any]:
        try:
            raw = self._local_json(["auth", "status", "--json"])
            # The CLI also returns email, organization and account IDs. None
            # belongs in renderer status, logs or this adapter's cached result.
            return native_auth_projection(raw)
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
            return {"source": "cli", "configured": False, "status": "unavailable", "method": "cli"}

    def list_agent_view_sessions(self) -> list[dict[str, Any]]:
        try:
            raw = self._local_json(["agents", "--json"])
            rows = raw if isinstance(raw, list) else raw.get("agents", []) if isinstance(raw, dict) else []
            return [{key: item[key] for key in ("id", "session_id", "sessionId", "name", "status", "state", "cwd", "type", "kind", "startedAt", "description")
                     if isinstance(item.get(key), (str, int, bool))}
                    for item in rows[:100] if isinstance(item, dict)]
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
            return []

    def plugin_status(self, workdir: str = "") -> dict[str, Any]:
        try:
            return native_plugins_projection(self._local_json(["plugin", "list", "--json"], workdir=workdir))
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
            return {"status": "unavailable", "plugins": [], "reason": "CLI 未能返回本地插件注册表"}

    def map_path(self, value: str | Path, *, to_linux: bool = True) -> str:
        return str(Path(value).expanduser())

    def runtime_version(self) -> str:
        return (self._last_probe or self.probe()).version

    def build_command(self, spec: AgentRunSpec) -> list[str]:
        caps = self.capabilities()
        return [*self.launcher, *_claude_arguments(
            spec, self.map_path, permission_choices=caps.permission_modes,
            auto_compact_supported=caps.auto_compact,
        )]

    async def spawn_session(self, spec: AgentRunSpec) -> RuntimeProcess:
        if not (self._last_probe or self.probe()).ready:
            raise RuntimeError("Claude Code 原生运行时尚未通过能力检查")
        command = self.build_command(spec)
        process = await self.process_factory(
            *command, cwd=spec.workdir, env=dict(spec.environment),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE, start_new_session=True,
        )
        wrapped = RuntimeProcess(
            session_id=spec.session_id, process=process, runtime=sys.platform,
            process_identity=f"{sys.platform}:{getattr(process, 'pid', 0)}",
            session_key=stable_session_name(spec.session_name, spec.session_id), command=tuple(command),
        )
        self._runs[spec.session_id] = wrapped
        return wrapped

    async def cancel(self, session_id: str) -> bool:
        run = self._runs.pop(str(session_id), None)
        if not run:
            return False
        if run.pid:
            try:
                os.killpg(run.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        return True

    async def cleanup_stale(self, spec: AgentRunSpec) -> bool:
        # A stale journal is not proof that an unrelated/reused PID belongs to us.
        return False

    def mark_finished(self, session_id: str, process: RuntimeProcess | None = None) -> None:
        if process is None or self._runs.get(str(session_id)) is process:
            self._runs.pop(str(session_id), None)

    def active_sessions(self) -> set[str]:
        return set(self._runs)

    async def update_cli(self) -> RuntimeProbe:
        # The native CLI belongs to the user. Startup must not upgrade it.
        return await asyncio.to_thread(self.probe)
