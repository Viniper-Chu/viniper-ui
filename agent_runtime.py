"""Runtime boundary for Viniper Agent sessions.

The application layer supplies a declarative :class:`AgentRunSpec`.  Runtime
adapters exclusively own platform paths, process creation, environment
bridging, version/capability probes, and per-session cancellation.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import os
import re
import shutil
import subprocess
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from pathlib import Path, PureWindowsPath
from typing import Any, Awaitable, Callable, Iterable, Mapping, Sequence
from urllib.parse import urlsplit, urlunsplit


MANAGED_DISTRO_NAME = "ViniperRuntime"
MANAGED_DISTRO_USER = "viniper"
MINIMUM_CLAUDE_VERSION = (2, 1, 224)
SESSION_RUNNER = "/usr/local/bin/viniper-run-session"
SESSION_CANCELLER = "/usr/local/bin/viniper-cancel-session"
SESSION_HELPER_VERSION = "3"
AUTO_COMPACT_WINDOW_ENV = "CLAUDE_CODE_AUTO_COMPACT_WINDOW"
AUTO_COMPACT_PCT_ENV = "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE"
DEFAULT_AUTO_COMPACT_WINDOW = 128000
REQUIRED_CLAUDE_FLAGS = (
    "-p",
    "--input-format",
    "--output-format",
    "--include-partial-messages",
    "--include-hook-events",
    "--model",
    "--session-id",
    "--resume",
    "--permission-mode",
    "--allow-dangerously-skip-permissions",
    "--name",
    "--append-system-prompt",
    "--append-system-prompt-file",
    "--add-dir",
    "--settings",
    "--mcp-config",
    "--permission-prompt-tool",
    "--verbose",
)
KNOWN_PERMISSION_MODES = (
    "manual",
    "default",
    "acceptEdits",
    "plan",
    "bypassPermissions",
    "auto",
    "dontAsk",
)


def parse_version(value: str) -> tuple[int, int, int]:
    match = re.search(r"(?<!\d)(\d+)\.(\d+)\.(\d+)(?!\d)", str(value or ""))
    if not match:
        return (0, 0, 0)
    return tuple(int(item) for item in match.groups())


def version_at_least(value: str, minimum: tuple[int, int, int] = MINIMUM_CLAUDE_VERSION) -> bool:
    return parse_version(value) >= minimum


def stable_session_name(display_name: str, session_id: str) -> str:
    """Return an ASCII-safe, stable, collision-resistant Claude peer name."""
    display = re.sub(r"[^a-z0-9]+", "-", str(display_name or "").casefold()).strip("-")
    display = display[:30].strip("-") or "session"
    stable_id = re.sub(r"[^a-z0-9]", "", str(session_id or "").casefold())[:10] or "unknown"
    return f"{display}-{stable_id}"[:48].strip("-")


@dataclass(frozen=True)
class RuntimeCapabilities:
    stream_json: bool = False
    structured_input: bool = False
    structured_interactions: bool = False
    usage: bool = False
    peer_messaging: bool = False
    native_cli: bool = False
    agent_view: bool = False
    agent_registry: bool = False
    native_send_message: bool = False
    auto_permission: bool = False
    auto_compact: bool = False
    effective_context_window: int = 0
    permission_modes: tuple[str, ...] = ()
    platform: str = "unknown"
    reason: str = ""

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class RuntimeProbe:
    status: str
    detail: str = ""
    version: str = ""
    user: str = ""
    distro: str = MANAGED_DISTRO_NAME
    capabilities: RuntimeCapabilities = field(default_factory=RuntimeCapabilities)

    @property
    def ready(self) -> bool:
        return self.status == "ready"

    def as_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["ready"] = self.ready
        return payload


@dataclass(frozen=True)
class AgentRunSpec:
    session_id: str
    claude_session_id: str
    session_name: str
    workdir: str
    model: str
    permission_mode: str
    resume: bool
    add_dirs: tuple[str, ...] = ()
    fallback_model: str = ""
    system_prompt_file: str = ""
    settings_file: str = ""
    mcp_config_file: str = ""
    permission_prompt_tool: str = ""
    environment: Mapping[str, str] = field(default_factory=dict)
    bridge_keys: tuple[str, ...] = ()
    effective_context_window: int = 0


@dataclass
class RuntimeProcess:
    session_id: str
    process: Any
    runtime: str
    process_identity: str
    session_key: str
    command: tuple[str, ...]

    @property
    def pid(self) -> int:
        return int(getattr(self.process, "pid", 0) or 0)

    @property
    def stdin(self) -> Any:
        return getattr(self.process, "stdin", None)

    @property
    def stdout(self) -> Any:
        return getattr(self.process, "stdout", None)

    @property
    def stderr(self) -> Any:
        return getattr(self.process, "stderr", None)

    @property
    def returncode(self) -> Any:
        return getattr(self.process, "returncode", None)

    async def wait(self) -> int:
        return await self.process.wait()


class AgentRuntime(ABC):
    @abstractmethod
    def probe(self) -> RuntimeProbe:
        raise NotImplementedError

    @abstractmethod
    def capabilities(self) -> RuntimeCapabilities:
        raise NotImplementedError

    @abstractmethod
    async def spawn_session(self, spec: AgentRunSpec) -> RuntimeProcess:
        raise NotImplementedError

    @abstractmethod
    async def cancel(self, session_id: str) -> bool:
        raise NotImplementedError

    @abstractmethod
    def map_path(self, value: str | Path, *, to_linux: bool = True) -> str:
        raise NotImplementedError

    @abstractmethod
    def runtime_version(self) -> str:
        raise NotImplementedError


def _decode_wsl_output(raw: bytes | str | None) -> str:
    if raw is None:
        return ""
    if isinstance(raw, str):
        return raw
    if not raw:
        return ""
    if raw.count(b"\x00") > max(2, len(raw) // 5):
        return raw.decode("utf-16le", errors="replace")
    return raw.decode("utf-8", errors="replace")


def _completed(command: Sequence[str], timeout: int = 30, env: Mapping[str, str] | None = None) -> subprocess.CompletedProcess:
    result = subprocess.run(
        [str(item) for item in command],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        check=False,
        env=dict(env) if env is not None else None,
    )
    return subprocess.CompletedProcess(
        list(command),
        result.returncode,
        stdout=_decode_wsl_output(result.stdout),
        stderr=_decode_wsl_output(result.stderr),
    )


def _permission_modes_from_help(help_text: str) -> tuple[str, ...]:
    match = re.search(r"--permission-mode\b(?P<body>.*?)(?=\n\s*--|\Z)", str(help_text or ""), re.DOTALL)
    if not match:
        return ()
    body = match.group("body")
    located = [
        (body.find(mode), mode)
        for mode in KNOWN_PERMISSION_MODES
        if body.find(mode) >= 0
    ]
    return tuple(mode for _position, mode in sorted(located))


def resolve_autocompact_window(
    help_text: str,
    environment: Mapping[str, str] | None = None,
    *,
    default: int = DEFAULT_AUTO_COMPACT_WINDOW,
) -> int:
    """Resolve the native Claude compact window without inventing env names.

    Current Claude Code exposes ``--autocompact``.  Older supported clients
    use the official ``CLAUDE_CODE_AUTO_COMPACT_WINDOW`` environment variable;
    callers decide whether to pass the value as an argv flag or that fallback.
    """
    source = environment or {}
    if "--autocompact" in str(help_text or ""):
        try:
            return max(0, int(source.get(AUTO_COMPACT_WINDOW_ENV) or default))
        except (TypeError, ValueError):
            return max(0, int(default))
    try:
        return max(0, int(source.get(AUTO_COMPACT_WINDOW_ENV) or 0))
    except (TypeError, ValueError):
        return 0


def _cli_permission_mode(semantic_mode: str, choices: Sequence[str] | None) -> str:
    semantic = "default" if str(semantic_mode or "") in {"", "ask", "manual"} else str(semantic_mode)
    available = tuple(str(item) for item in (choices or ()))
    if semantic == "default":
        if "manual" in available:
            return "manual"
        if not available or "default" in available:
            return "default"
        raise ValueError("Claude Code does not expose a Manual/default permission mode")
    if available and semantic not in available:
        raise ValueError(f"Claude Code does not expose permission mode {semantic}")
    return semantic


def _claude_arguments(
    spec: AgentRunSpec,
    path_mapper: Callable[[str], str],
    *,
    permission_choices: Sequence[str] | None = None,
    auto_compact_supported: bool | None = None,
) -> list[str]:
    args = [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--include-hook-events",
        "--model",
        spec.model,
        "--resume" if spec.resume else "--session-id",
        spec.claude_session_id,
    ]
    compact_window = max(0, int(getattr(spec, "effective_context_window", 0) or getattr(spec, "autocompact_window", 0) or 0))
    if compact_window and auto_compact_supported is not False:
        args.extend(["--autocompact", str(compact_window)])
    cli_permission_mode = _cli_permission_mode(spec.permission_mode, permission_choices)
    if cli_permission_mode == "bypassPermissions":
        args.append("--allow-dangerously-skip-permissions")
    args.extend(["--permission-mode", cli_permission_mode])
    for directory in spec.add_dirs:
        args.extend(["--add-dir", path_mapper(str(directory))])
    if spec.fallback_model:
        args.extend(["--fallback-model", spec.fallback_model])
    if spec.session_name:
        args.extend(["--name", spec.session_name])
    if spec.system_prompt_file:
        args.extend(["--append-system-prompt-file", path_mapper(spec.system_prompt_file)])
    if spec.settings_file:
        args.extend(["--settings", path_mapper(spec.settings_file)])
    if spec.mcp_config_file:
        args.extend(["--mcp-config", path_mapper(spec.mcp_config_file)])
    if spec.permission_prompt_tool:
        args.extend(["--permission-prompt-tool", spec.permission_prompt_tool])
    return args


class WindowsNativeRuntime(AgentRuntime):
    """Migration/test adapter; never advertises WSL-only peer capability."""

    def __init__(
        self,
        launcher: Sequence[str],
        *,
        process_factory: Callable[..., Awaitable[Any]] | None = None,
    ) -> None:
        self.launcher = tuple(str(item) for item in launcher)
        self.process_factory = process_factory or asyncio.create_subprocess_exec
        self._runs: dict[str, RuntimeProcess] = {}

    def probe(self) -> RuntimeProbe:
        return RuntimeProbe(
            status="migration_only",
            detail="Windows native Claude runtime is retained only for migration diagnostics and tests.",
            capabilities=self.capabilities(),
        )

    def capabilities(self) -> RuntimeCapabilities:
        return RuntimeCapabilities(
            stream_json=True,
            structured_input=True,
            structured_interactions=True,
            usage=True,
            peer_messaging=False,
            native_cli=False,
            agent_view=False,
            agent_registry=False,
            native_send_message=False,
            platform="windows-native",
            reason="Claude cross-session messaging is unavailable on native Windows.",
        )

    def map_path(self, value: str | Path, *, to_linux: bool = True) -> str:
        return str(value)

    def runtime_version(self) -> str:
        result = _completed([*self.launcher, "--version"], timeout=15)
        return str(result.stdout or result.stderr or "").strip().splitlines()[0] if result.returncode == 0 else ""

    async def spawn_session(self, spec: AgentRunSpec) -> RuntimeProcess:
        command = [*self.launcher, *_claude_arguments(spec, lambda value: value)]
        process = await self.process_factory(
            *command,
            cwd=spec.workdir,
            env=dict(spec.environment),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        wrapped = RuntimeProcess(
            session_id=spec.session_id,
            process=process,
            runtime="windows-native",
            process_identity=f"windows:{getattr(process, 'pid', 0)}",
            session_key=stable_session_name(spec.session_name, spec.session_id),
            command=tuple(command),
        )
        self._runs[spec.session_id] = wrapped
        return wrapped

    async def cancel(self, session_id: str) -> bool:
        run = self._runs.pop(str(session_id), None)
        if not run:
            return False
        if os.name == "nt" and run.pid:
            await asyncio.to_thread(
                subprocess.run,
                ["taskkill.exe", "/PID", str(run.pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        else:
            terminate = getattr(run.process, "terminate", None)
            if terminate:
                terminate()
        return True

    async def cleanup_stale(self, spec: AgentRunSpec) -> bool:
        return False

    def mark_finished(self, session_id: str, process: RuntimeProcess | None = None) -> None:
        current = self._runs.get(str(session_id))
        if process is None or current is process:
            self._runs.pop(str(session_id), None)

    def active_sessions(self) -> set[str]:
        return set(self._runs)

class WslAgentRuntime(AgentRuntime):
    """Primary WSL2 adapter for the dedicated ViniperRuntime distro."""

    def __init__(
        self,
        *,
        distro: str = MANAGED_DISTRO_NAME,
        user: str = MANAGED_DISTRO_USER,
        process_factory: Callable[..., Awaitable[Any]] | None = None,
        command_runner: Callable[[Sequence[str]], subprocess.CompletedProcess] | None = None,
        async_control_runner: Callable[[list[str]], Awaitable[subprocess.CompletedProcess] | subprocess.CompletedProcess] | None = None,
        proxy_resolver: Callable[[str], str] | None = None,
    ) -> None:
        self.distro = distro
        self.user = user
        self.process_factory = process_factory or asyncio.create_subprocess_exec
        self.command_runner = command_runner or (lambda command: _completed(command, timeout=30))
        self.async_control_runner = async_control_runner
        self.proxy_resolver = proxy_resolver or self._resolve_proxy_for_wsl
        self._runs: dict[str, RuntimeProcess] = {}
        self._last_probe: RuntimeProbe | None = None
        self._proxy_hosts: dict[int, str] = {}

    def _base(self) -> list[str]:
        return ["wsl.exe", "--distribution", self.distro, "--user", self.user, "--exec"]

    def _run(self, command: Sequence[str]) -> subprocess.CompletedProcess:
        return self.command_runner([str(item) for item in command])

    def probe(self) -> RuntimeProbe:
        if shutil.which("wsl.exe") is None and shutil.which("wsl") is None:
            probe = RuntimeProbe(status="wsl_missing", detail="Windows Subsystem for Linux is not installed.")
            self._last_probe = probe
            return probe
        command = [
            *self._base(),
            "sh",
            "-lc",
            "printf '__VINIPER_USER__=%s\\n' \"$(id -un)\"; "
            "printf '__VINIPER_UID__=%s\\n' \"$(id -u)\"; "
            f"if grep -q '^# viniper-runtime-helper={SESSION_HELPER_VERSION}$' {SESSION_RUNNER} 2>/dev/null "
            f"&& grep -q '^# viniper-runtime-helper={SESSION_HELPER_VERSION}$' {SESSION_CANCELLER} 2>/dev/null; then "
            "printf '__VINIPER_HELPERS__=ready\\n'; fi; "
            "if command -v claude >/dev/null 2>&1; then "
            "claude_path=$(command -v claude); printf '__VINIPER_CLAUDE_PATH__=%s\\n' \"$claude_path\"; "
            "case \"$claude_path\" in /mnt/*) ;; *) "
            "if file -L \"$claude_path\" 2>/dev/null | grep -q 'ELF .* executable'; then printf '__VINIPER_NATIVE_CLI__=ready\\n'; fi;; esac; "
            "printf '__VINIPER_CLAUDE__='; claude --version 2>/dev/null | head -n 1; "
            "printf '__VINIPER_HELP_BEGIN__\\n'; claude --help 2>/dev/null; "
            "prompt_file=$(mktemp); printf 'Viniper capability probe\\n' >\"$prompt_file\"; "
            "if claude --append-system-prompt-file \"$prompt_file\" --help >/dev/null 2>&1; then "
            "printf '__VINIPER_APPEND_FILE__=accepted\\n'; fi; rm -f \"$prompt_file\"; "
            "if claude --permission-prompt-tool mcp__viniper_probe__permission_prompt --help >/dev/null 2>&1; then "
            "printf '__VINIPER_PERMISSION_PROMPT_TOOL__=accepted\\n'; fi; "
            "fi",
        ]
        try:
            result = self._run(command)
        except FileNotFoundError:
            probe = RuntimeProbe(status="wsl_missing", detail="wsl.exe is unavailable.")
            self._last_probe = probe
            return probe
        except Exception as exc:
            probe = RuntimeProbe(status="recoverable_error", detail=f"WSL probe failed: {exc}")
            self._last_probe = probe
            return probe

        output = f"{result.stdout or ''}\n{result.stderr or ''}".strip()
        lowered = output.casefold()
        if result.returncode != 0:
            if any(marker in lowered for marker in ("no distribution", "not found", "does not exist", "wsl_e_distro_not_found")):
                status = "distro_missing"
            elif any(marker in lowered for marker in ("restart", "reboot", "wsl_e_wsl_optional_component_required")):
                status = "reboot_required"
            elif any(marker in lowered for marker in ("user", "getpwnam", "no such file")):
                status = "configuring"
            else:
                status = "recoverable_error"
            probe = RuntimeProbe(status=status, detail=output[-1000:])
            self._last_probe = probe
            return probe

        user_match = re.search(r"^__VINIPER_USER__=(.*)$", output, re.MULTILINE)
        uid_match = re.search(r"^__VINIPER_UID__=(.*)$", output, re.MULTILINE)
        version_match = re.search(r"^__VINIPER_CLAUDE__=(.*)$", output, re.MULTILINE)
        path_match = re.search(r"^__VINIPER_CLAUDE_PATH__=(.*)$", output, re.MULTILINE)
        actual_user = user_match.group(1).strip() if user_match else ""
        uid = uid_match.group(1).strip() if uid_match else ""
        version = version_match.group(1).strip() if version_match else ""
        claude_path = path_match.group(1).strip() if path_match else ""
        native_cli = "__VINIPER_NATIVE_CLI__=ready" in output and not claude_path.startswith("/mnt/")
        helpers_ready = "__VINIPER_HELPERS__=ready" in output
        help_text = output.split("__VINIPER_HELP_BEGIN__", 1)[1] if "__VINIPER_HELP_BEGIN__" in output else ""
        hidden_append_file_supported = "__VINIPER_APPEND_FILE__=accepted" in output
        hidden_permission_prompt_supported = "__VINIPER_PERMISSION_PROMPT_TOOL__=accepted" in output
        agent_view_available = bool(re.search(r"(?<![A-Za-z0-9_-])agents(?![A-Za-z0-9_-])", help_text))
        missing_flags = [
            flag for flag in REQUIRED_CLAUDE_FLAGS
            if flag not in help_text
            and not (flag == "--append-system-prompt-file" and hidden_append_file_supported)
            and not (flag == "--permission-prompt-tool" and hidden_permission_prompt_supported)
        ]
        if actual_user != self.user or uid in {"", "0"}:
            status = "configuring"
            detail = "managed distro default runtime user is not the non-root viniper user"
        elif not helpers_ready:
            status = "configuring"
            detail = "managed per-session runtime helpers need installation or update"
        elif not version:
            status = "cli_missing"
            detail = "Claude Code is not installed in the managed distro"
        elif not native_cli:
            status = "cli_incompatible"
            detail = "Claude Code resolved outside the managed Linux runtime"
        elif not version_at_least(version):
            status = "cli_incompatible"
            detail = f"Claude Code {version} is below the required 2.1.224"
        elif missing_flags:
            status = "cli_incompatible"
            detail = "Claude Code is missing required flags: " + ", ".join(missing_flags)
        else:
            status = "ready"
            detail = "managed WSL runtime is ready"
        permission_modes = _permission_modes_from_help(help_text)
        capabilities = RuntimeCapabilities(
            stream_json=not any(flag in missing_flags for flag in ("--input-format", "--output-format")),
            structured_input="--input-format" not in missing_flags,
            structured_interactions=not any(
                flag in missing_flags
                for flag in ("--input-format", "--settings", "--mcp-config", "--permission-prompt-tool")
            ),
            usage="--output-format" not in missing_flags,
            peer_messaging=False,
            native_cli=native_cli,
            agent_view=agent_view_available,
            agent_registry=False,
            native_send_message=False,
            auto_permission="auto" in permission_modes,
            auto_compact="--autocompact" in help_text,
            effective_context_window=DEFAULT_AUTO_COMPACT_WINDOW,
            permission_modes=permission_modes,
            platform="wsl2",
            reason="" if status == "ready" else detail,
        )
        probe = RuntimeProbe(
            status=status,
            detail=detail,
            version=version,
            user=actual_user,
            distro=self.distro,
            capabilities=capabilities,
        )
        self._last_probe = probe
        return probe

    def capabilities(self) -> RuntimeCapabilities:
        probe = self._last_probe or self.probe()
        return probe.capabilities

    def cached_probe(self) -> RuntimeProbe | None:
        return self._last_probe

    def list_agent_view_sessions(self) -> list[dict[str, Any]]:
        """Read Agent View lifecycle rows; never use them as peer addresses."""

        result = self._run([
            *self._base(),
            "sh",
            "-lc",
            'export PATH="$HOME/.local/bin:$PATH"; claude agents --json',
        ])
        if result.returncode != 0:
            return []
        try:
            payload = json.loads(str(result.stdout or ""))
        except (TypeError, json.JSONDecodeError):
            return []
        if not isinstance(payload, list):
            return []
        allowed = {"id", "state", "cwd", "kind", "startedAt", "sessionId", "name"}
        return [
            {key: item.get(key) for key in allowed if key in item}
            for item in payload
            if isinstance(item, dict)
            and str(item.get("cwd") or "")
            and str(item.get("kind") or "")
            and (str(item.get("id") or "") or str(item.get("sessionId") or ""))
        ]

    def runtime_version(self) -> str:
        probe = self._last_probe or self.probe()
        return probe.version

    def map_path(self, value: str | Path, *, to_linux: bool = True) -> str:
        text = str(value)
        if to_linux:
            if text.startswith("/"):
                return text
            match = re.match(r"^([A-Za-z]):[\\/](.*)$", text)
            if not match:
                return text.replace("\\", "/")
            drive, tail = match.groups()
            return f"/mnt/{drive.casefold()}/{tail.replace(chr(92), '/')}"
        match = re.match(r"^/mnt/([A-Za-z])(?:/(.*))?$", text)
        if not match:
            return text
        drive, tail = match.groups()
        if not tail:
            return f"{drive.upper()}:\\"
        return f"{drive.upper()}:\\{tail.replace('/', chr(92))}"

    def _session_key(self, spec: AgentRunSpec) -> str:
        return stable_session_name(spec.session_name, spec.session_id)

    def _resolve_proxy_for_wsl(self, value: str) -> str:
        parsed = urlsplit(str(value or ""))
        if parsed.hostname not in {"127.0.0.1", "localhost"} or not parsed.port:
            return str(value)
        host = self._proxy_hosts.get(parsed.port, "")
        if not host:
            command = [
                *self._base(),
                "bash",
                "-lc",
                f"for h in 127.0.0.1 $(ip route 2>/dev/null | awk '/default/ {{print $3; exit}}'); do "
                f"if timeout 1 bash -c \"</dev/tcp/$h/{parsed.port}\" 2>/dev/null; then echo $h; exit 0; fi; done; exit 1",
            ]
            result = self._run(command)
            if result.returncode == 0:
                host = str(result.stdout or "").strip().splitlines()[0]
                self._proxy_hosts[parsed.port] = host
        if not host:
            return str(value)
        credentials = ""
        if parsed.username:
            credentials = parsed.username
            if parsed.password:
                credentials += f":{parsed.password}"
            credentials += "@"
        return urlunsplit((parsed.scheme, f"{credentials}{host}:{parsed.port}", parsed.path, parsed.query, parsed.fragment))

    def _bridge_proxy_environment(self, source: Mapping[str, str]) -> dict[str, str]:
        env = dict(source)
        proxy_keys = [key for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY") if env.get(key)]
        for key in proxy_keys:
            env[key] = self.proxy_resolver(str(env[key]))
        bridge_keys = [*proxy_keys, *(["NO_PROXY"] if env.get("NO_PROXY") else [])]
        if bridge_keys:
            existing = [item for item in str(env.get("WSLENV") or "").split(":") if item]
            existing_names = {item.split("/", 1)[0] for item in existing}
            existing.extend(key for key in bridge_keys if key not in existing_names)
            env["WSLENV"] = ":".join(existing)
        return env

    def build_command(self, spec: AgentRunSpec) -> list[str]:
        session_key = self._session_key(spec)
        linux_cwd = self.map_path(spec.workdir)
        claude_args = _claude_arguments(
            spec,
            lambda value: self.map_path(value),
            permission_choices=self.capabilities().permission_modes,
            auto_compact_supported=self.capabilities().auto_compact,
        )
        return [
            "wsl.exe",
            "--distribution",
            self.distro,
            "--user",
            self.user,
            "--cd",
            linux_cwd,
            "--exec",
            SESSION_RUNNER,
            session_key,
            "claude",
            *claude_args,
        ]

    def _bridge_environment(self, spec: AgentRunSpec) -> dict[str, str]:
        env = os.environ.copy()
        allowed_keys = list(dict.fromkeys((*spec.bridge_keys, "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY")))
        bridged: list[str] = []
        for key in allowed_keys:
            value = spec.environment.get(key)
            if value is None:
                continue
            env[key] = self.proxy_resolver(str(value)) if key in {"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"} else str(value)
            bridged.append(key)
        existing = [item for item in str(env.get("WSLENV") or "").split(":") if item]
        existing_names = {item.split("/", 1)[0] for item in existing}
        for key in bridged:
            if key not in existing_names:
                existing.append(key)
        env["WSLENV"] = ":".join(existing)
        return env

    async def spawn_session(self, spec: AgentRunSpec) -> RuntimeProcess:
        if spec.session_id in self._runs:
            raise RuntimeError(f"session already has an active runtime process: {spec.session_id}")
        command = self.build_command(spec)
        process = await self.process_factory(
            *command,
            cwd=None,
            env=self._bridge_environment(spec),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        session_key = self._session_key(spec)
        wrapped = RuntimeProcess(
            session_id=spec.session_id,
            process=process,
            runtime="wsl2",
            process_identity=f"wsl:{self.distro}:{session_key}:{getattr(process, 'pid', 0)}",
            session_key=session_key,
            command=tuple(command),
        )
        self._runs[spec.session_id] = wrapped
        return wrapped

    def mark_finished(self, session_id: str, process: RuntimeProcess | None = None) -> None:
        current = self._runs.get(str(session_id))
        if process is None or current is process:
            self._runs.pop(str(session_id), None)

    def active_sessions(self) -> set[str]:
        return set(self._runs)

    @staticmethod
    def _validated_session_key(session_key: str) -> str:
        value = str(session_key or "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", value):
            raise ValueError("invalid managed runtime session key")
        return value

    def inspect_session_identity(self, session_key: str) -> dict[str, Any] | None:
        key = self._validated_session_key(session_key)
        result = self._run([
            *self._base(),
            "sh",
            "-lc",
            "set -eu; "
            f"pid_file=\"$HOME/.local/state/viniper-runtime/runs/{key}.pid\"; "
            "[ -f \"$pid_file\" ] || exit 3; pgid=$(cat \"$pid_file\"); "
            "case \"$pgid\" in (*[!0-9]*|'') exit 65;; esac; "
            "pids=$(ps -eo pid=,pgid= | awk -v g=\"$pgid\" '$2 == g {print $1}' | paste -sd, -); "
            "[ -n \"$pids\" ] || exit 4; printf '__VINIPER_PGID__=%s\\n__VINIPER_PIDS__=%s\\n' \"$pgid\" \"$pids\"",
        ])
        if result.returncode != 0:
            return None
        pgid_match = re.search(r"^__VINIPER_PGID__=(\d+)$", str(result.stdout or ""), re.MULTILINE)
        pids_match = re.search(r"^__VINIPER_PIDS__=([0-9,]+)$", str(result.stdout or ""), re.MULTILINE)
        if not pgid_match or not pids_match:
            return None
        pids = [int(item) for item in pids_match.group(1).split(",") if item]
        pgid = int(pgid_match.group(1))
        return {"session_key": key, "runtime_pid": pgid, "runtime_pgid": pgid, "pids": pids}

    def cleanup_orphaned(self, session_key: str, expected_pgid: int, expected_runtime_pid: int) -> bool:
        key = self._validated_session_key(session_key)
        pgid = int(expected_pgid or 0)
        runtime_pid = int(expected_runtime_pid or 0)
        if pgid <= 1 or runtime_pid <= 1:
            return False
        identity = self.inspect_session_identity(key)
        if not identity or int(identity.get("runtime_pgid") or 0) != pgid or runtime_pid not in identity.get("pids", []):
            return False
        result = self._run([
            *self._base(),
            "sh",
            "-lc",
            "set -eu; "
            f"pid_file=\"$HOME/.local/state/viniper-runtime/runs/{key}.pid\"; "
            f"[ \"$(cat \"$pid_file\")\" = \"{pgid}\" ] || exit 66; "
            f"ps -eo pid=,pgid= | awk -v p=\"{runtime_pid}\" -v g=\"{pgid}\" '$1 == p && $2 == g {{found=1}} END {{exit found ? 0 : 1}}'; "
            f"kill -TERM -- '-{pgid}' 2>/dev/null || true; "
            "i=0; while kill -0 -- '-" + str(pgid) + "' 2>/dev/null && [ \"$i\" -lt 30 ]; do sleep 0.1; i=$((i + 1)); done; "
            f"if kill -0 -- '-{pgid}' 2>/dev/null; then kill -KILL -- '-{pgid}' 2>/dev/null || true; fi; "
            "rm -f \"$pid_file\"",
        ])
        return result.returncode == 0

    async def _control(
        self,
        command: list[str],
        *,
        env: Mapping[str, str] | None = None,
        timeout: int = 25,
    ) -> subprocess.CompletedProcess:
        if self.async_control_runner is not None:
            result = self.async_control_runner(command)
            if inspect.isawaitable(result):
                return await result
            return result
        return await asyncio.to_thread(_completed, command, timeout, env)

    async def cancel(self, session_id: str) -> bool:
        run = self._runs.get(str(session_id))
        if not run:
            return False
        command = [*self._base(), SESSION_CANCELLER, run.session_key]
        result = await self._control(command)
        if result.returncode == 0:
            self._runs.pop(str(session_id), None)
            return True
        return False

    async def cleanup_stale(self, spec: AgentRunSpec) -> bool:
        command = [*self._base(), SESSION_CANCELLER, self._session_key(spec)]
        result = await self._control(command)
        return result.returncode == 0

    async def update_cli(self) -> RuntimeProbe:
        command = [*self._base(), "sh", "-lc", "export PATH=\"$HOME/.local/bin:$PATH\"; claude update"]
        env = self._bridge_proxy_environment(os.environ)
        result = await self._control(command, env=env, timeout=900)
        self._last_probe = None
        probe = self.probe()
        if result.returncode != 0 and probe.ready:
            return RuntimeProbe(
                status="recoverable_error",
                detail=str(result.stderr or result.stdout or "Claude update failed")[-1000:],
                version=probe.version,
                user=probe.user,
                distro=probe.distro,
                capabilities=probe.capabilities,
            )
        return probe


__all__ = [
    "AgentRunSpec",
    "AgentRuntime",
    "MANAGED_DISTRO_NAME",
    "MANAGED_DISTRO_USER",
    "MINIMUM_CLAUDE_VERSION",
    "RuntimeCapabilities",
    "RuntimeProbe",
    "RuntimeProcess",
    "SESSION_HELPER_VERSION",
    "WindowsNativeRuntime",
    "WslAgentRuntime",
    "stable_session_name",
    "version_at_least",
]
