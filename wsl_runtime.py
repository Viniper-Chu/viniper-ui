"""Provisioning and app-version coordinated updates for ViniperRuntime."""

from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Protocol, Sequence

from agent_runtime import (
    MANAGED_DISTRO_NAME,
    MANAGED_DISTRO_USER,
    RuntimeProbe,
    SESSION_HELPER_VERSION,
    WslAgentRuntime,
    version_at_least,
)


UBUNTU_DISTRO = "Ubuntu-24.04"
PROXY_PORT = 7897


def linux_stdin_bytes(value: str | None) -> bytes | None:
    if value is None:
        return None
    return value.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8")


def decode_process_output(value: bytes | str | None) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if value.count(b"\x00") > max(2, len(value) // 5):
        return value.decode("utf-16le", errors="replace")
    return value.decode("utf-8", errors="replace")


@dataclass(frozen=True)
class ProvisionStatus:
    status: str
    detail: str = ""
    recoverable: bool = True
    needs_reboot: bool = False
    version: str = ""
    user: str = ""
    install_location: str = ""
    updated_at: float = 0.0
    previous_version: str = ""

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _atomic_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(dict(payload), ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


class RuntimeLike(Protocol):
    def probe(self) -> RuntimeProbe: ...
    async def update_cli(self) -> RuntimeProbe: ...


class WslRuntimeProvisioner:
    """Single persisted state machine for the dedicated managed distro."""

    def __init__(
        self,
        *,
        runtime: RuntimeLike,
        state_path: Path,
        install_location: Path,
        command_runner: Callable[..., subprocess.CompletedProcess] | None = None,
        proxy_port: int = PROXY_PORT,
    ) -> None:
        self.runtime = runtime
        self.state_path = Path(state_path)
        self.install_location = Path(install_location)
        self.command_runner = command_runner or self._run_subprocess
        self.proxy_port = int(proxy_port)

    @staticmethod
    def _run_subprocess(
        command: Sequence[str],
        *,
        timeout: int = 900,
        input_text: str | None = None,
        env: Mapping[str, str] | None = None,
    ) -> subprocess.CompletedProcess:
        result = subprocess.run(
            [str(item) for item in command],
            input=linux_stdin_bytes(input_text),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
            env=dict(env) if env is not None else None,
        )
        return subprocess.CompletedProcess(
            list(command),
            result.returncode,
            stdout=decode_process_output(result.stdout),
            stderr=decode_process_output(result.stderr),
        )

    def _persist(self, status: ProvisionStatus) -> ProvisionStatus:
        _atomic_json(self.state_path, status.as_dict())
        return status

    def _status_from_probe(self, probe: RuntimeProbe) -> ProvisionStatus:
        status = probe.status
        return ProvisionStatus(
            status=status,
            detail=probe.detail,
            recoverable=status not in {"ready"},
            needs_reboot=status == "reboot_required",
            version=probe.version,
            user=probe.user,
            install_location=str(self.install_location),
            updated_at=time.time(),
        )

    def inspect(self) -> ProvisionStatus:
        return self._persist(self._status_from_probe(self.runtime.probe()))

    def record_platform_result(self, succeeded: bool) -> ProvisionStatus:
        """Persist the resume point after the user-visible elevated WSL action."""
        probe = self.runtime.probe()
        if probe.status != "wsl_missing":
            return self._persist(self._status_from_probe(probe))
        if succeeded:
            return self._persist(ProvisionStatus(
                status="reboot_required",
                detail="WSL platform installation was requested; restart Windows, then continue setup.",
                recoverable=True,
                needs_reboot=True,
                install_location=str(self.install_location),
                updated_at=time.time(),
            ))
        return self._persist(ProvisionStatus(
            status="wsl_missing",
            detail="WSL platform installation was not completed; retry when ready.",
            recoverable=True,
            install_location=str(self.install_location),
            updated_at=time.time(),
        ))

    def _step(self, status: str, detail: str = "") -> ProvisionStatus:
        return self._persist(ProvisionStatus(
            status=status,
            detail=detail,
            recoverable=status not in {"ready"},
            needs_reboot=status == "reboot_required",
            install_location=str(self.install_location),
            updated_at=time.time(),
        ))

    def _run(self, command: Sequence[str], *, timeout: int = 900, input_text: str | None = None, env: Mapping[str, str] | None = None) -> subprocess.CompletedProcess:
        return self.command_runner(command, timeout=timeout, input_text=input_text, env=env)

    def _proxy_host(self) -> str:
        command = [
            "wsl.exe", "--distribution", MANAGED_DISTRO_NAME, "--user", "root", "--exec",
            "bash", "-lc",
            f"for h in 127.0.0.1 $(ip route 2>/dev/null | awk '/default/ {{print $3; exit}}'); do "
            f"if timeout 1 bash -c \"</dev/tcp/$h/{self.proxy_port}\" 2>/dev/null; then echo $h; exit 0; fi; done; exit 1",
        ]
        result = self._run(command, timeout=20)
        if result.returncode != 0:
            return ""
        return str(result.stdout or "").strip().splitlines()[0]

    def _configure_script(self) -> str:
        return r'''set -eu
export DEBIAN_FRONTEND=noninteractive
if ! id viniper >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash viniper
fi
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl file git util-linux
install -d -m 0755 /usr/local/bin
cat >/usr/local/bin/viniper-run-session <<'VINIPER_RUN'
#!/bin/sh
# viniper-runtime-helper=''' + SESSION_HELPER_VERSION + r'''
set -eu
session_key="$1"
shift
case "$session_key" in (*[!a-zA-Z0-9_-]*|'') exit 64;; esac
state_dir="$HOME/.local/state/viniper-runtime/runs"
mkdir -p "$state_dir"
pid_file="$state_dir/$session_key.pid"
export PATH="$HOME/.local/bin:$PATH"
exec setsid --wait sh -c '
  pid_file="$1"
  shift
  echo $$ >"$pid_file"
  trap '\''rm -f "$pid_file"'\'' EXIT HUP INT TERM
  "$@"
  code=$?
  rm -f "$pid_file"
  exit $code
' sh "$pid_file" "$@"
VINIPER_RUN
cat >/usr/local/bin/viniper-cancel-session <<'VINIPER_CANCEL'
#!/bin/sh
# viniper-runtime-helper=''' + SESSION_HELPER_VERSION + r'''
set -eu
session_key="$1"
case "$session_key" in (*[!a-zA-Z0-9_-]*|'') exit 64;; esac
pid_file="$HOME/.local/state/viniper-runtime/runs/$session_key.pid"
[ -f "$pid_file" ] || exit 3
pgid="$(cat "$pid_file")"
case "$pgid" in (*[!0-9]*|'') exit 65;; esac
/usr/bin/kill -TERM -- "-$pgid" 2>/dev/null || true
i=0
while /usr/bin/kill -0 -- "-$pgid" 2>/dev/null && [ "$i" -lt 30 ]; do
  sleep 0.1
  i=$((i + 1))
done
if /usr/bin/kill -0 -- "-$pgid" 2>/dev/null; then
  /usr/bin/kill -KILL -- "-$pgid" 2>/dev/null || true
fi
rm -f "$pid_file"
VINIPER_CANCEL
chmod 0755 /usr/local/bin/viniper-run-session /usr/local/bin/viniper-cancel-session
printf '[user]\ndefault=viniper\n' >/etc/wsl.conf
chown -R viniper:viniper /home/viniper
'''

    def _install_cli(self, proxy_url: str) -> subprocess.CompletedProcess:
        env = os.environ.copy()
        if proxy_url:
            env.update({
                "HTTP_PROXY": proxy_url,
                "HTTPS_PROXY": proxy_url,
                "ALL_PROXY": proxy_url,
                "NO_PROXY": "localhost,127.0.0.1,::1,10.*,172.16.*,172.17.*,172.18.*,172.19.*,172.20.*,172.21.*,172.22.*,172.23.*,172.24.*,172.25.*,172.26.*,172.27.*,172.28.*,172.29.*,172.30.*,172.31.*,192.168.*",
            })
            env["WSLENV"] = ":".join(("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"))
        command = [
            "wsl.exe", "--distribution", MANAGED_DISTRO_NAME, "--user", MANAGED_DISTRO_USER, "--exec",
            "bash", "-lc",
            "set -eu; export PATH=\"$HOME/.local/bin:$PATH\"; "
            "installer=$(mktemp); trap 'rm -f \"$installer\"' EXIT; "
            "curl -fsSL https://claude.ai/install.sh -o \"$installer\"; bash \"$installer\"; claude update",
        ]
        return self._run(command, timeout=1200, env=env)

    def _provision_sync(self) -> ProvisionStatus:
        initial = self.runtime.probe()
        if initial.ready:
            return self._persist(self._status_from_probe(initial))
        if initial.status == "wsl_missing":
            return self._persist(ProvisionStatus(
                status="wsl_missing",
                detail="WSL platform is unavailable; use the product-visible installer action.",
                recoverable=True,
                install_location=str(self.install_location),
                updated_at=time.time(),
            ))
        if initial.status == "reboot_required":
            return self._persist(self._status_from_probe(initial))

        if initial.status == "distro_missing":
            if self.install_location.exists() and any(self.install_location.iterdir()):
                return self._persist(ProvisionStatus(
                    status="recoverable_error",
                    detail="managed runtime location already exists and is not empty",
                    recoverable=True,
                    install_location=str(self.install_location),
                    updated_at=time.time(),
                ))
            self.install_location.parent.mkdir(parents=True, exist_ok=True)
            self._step("installing", "downloading Ubuntu 24.04 for the dedicated managed distro")
            install = self._run([
                "wsl.exe", "--install", UBUNTU_DISTRO,
                "--name", MANAGED_DISTRO_NAME,
                "--location", str(self.install_location),
                "--no-launch", "--version", "2", "--web-download",
            ], timeout=1800)
            if install.returncode != 0:
                detail = str(install.stderr or install.stdout or "WSL distro install failed")[-1200:]
                lowered = detail.casefold()
                if "restart" in lowered or "reboot" in lowered:
                    return self._persist(ProvisionStatus(
                        status="reboot_required", detail=detail, recoverable=True, needs_reboot=True,
                        install_location=str(self.install_location), updated_at=time.time(),
                    ))
                return self._persist(ProvisionStatus(
                    status="recoverable_error", detail=detail, recoverable=True,
                    install_location=str(self.install_location), updated_at=time.time(),
                ))

        self._step("configuring", "creating the non-root runtime user and managed process helpers")
        proxy_host = self._proxy_host()
        proxy_url = f"http://{proxy_host}:{self.proxy_port}" if proxy_host else ""
        env = os.environ.copy()
        if proxy_url:
            env.update({"http_proxy": proxy_url, "https_proxy": proxy_url, "HTTP_PROXY": proxy_url, "HTTPS_PROXY": proxy_url})
            env["WSLENV"] = "http_proxy:https_proxy:HTTP_PROXY:HTTPS_PROXY"
        configured = self._run(
            ["wsl.exe", "--distribution", MANAGED_DISTRO_NAME, "--user", "root", "--exec", "bash", "-s"],
            timeout=1200,
            input_text=self._configure_script(),
            env=env,
        )
        if configured.returncode != 0:
            return self._persist(ProvisionStatus(
                status="recoverable_error",
                detail=str(configured.stderr or configured.stdout or "runtime configuration failed")[-1200:],
                recoverable=True,
                install_location=str(self.install_location),
                updated_at=time.time(),
            ))

        self._run(["wsl.exe", "--terminate", MANAGED_DISTRO_NAME], timeout=30)
        after_configuration = self.runtime.probe()
        if after_configuration.ready:
            return self._persist(ProvisionStatus(
                status="ready",
                detail="managed WSL runtime is ready",
                recoverable=False,
                version=after_configuration.version,
                user=after_configuration.user,
                install_location=str(self.install_location),
                updated_at=time.time(),
            ))
        self._step("cli_installing", "installing Claude Code latest in the non-root runtime user")
        installed = self._install_cli(proxy_url)
        if installed.returncode != 0:
            return self._persist(ProvisionStatus(
                status="recoverable_error",
                detail=str(installed.stderr or installed.stdout or "Claude Code install failed")[-1200:],
                recoverable=True,
                install_location=str(self.install_location),
                updated_at=time.time(),
            ))

        self._step("verifying", "verifying runtime user, Claude version, and required CLI capabilities")
        final = self.runtime.probe()
        if not final.ready:
            return self._persist(self._status_from_probe(final))
        return self._persist(ProvisionStatus(
            status="ready",
            detail="managed WSL runtime is ready",
            recoverable=False,
            version=final.version,
            user=final.user,
            install_location=str(self.install_location),
            updated_at=time.time(),
        ))

    async def provision(self) -> ProvisionStatus:
        return await asyncio.to_thread(self._provision_sync)


class RuntimeUpdateCoordinator:
    """Run one explicit latest-channel compatibility check per app version."""

    def __init__(
        self,
        runtime: RuntimeLike,
        state_path: Path,
        active_sessions: Callable[[], set[str]],
    ) -> None:
        self.runtime = runtime
        self.state_path = Path(state_path)
        self.active_sessions = active_sessions
        self._lock = asyncio.Lock()

    def _status(self, status: str, **values: Any) -> ProvisionStatus:
        payload = ProvisionStatus(status=status, updated_at=time.time(), **values)
        _atomic_json(self.state_path, payload.as_dict())
        return payload

    def status(self) -> dict[str, Any]:
        return _read_json(self.state_path)

    async def ensure_current(self, app_version: str) -> ProvisionStatus:
        async with self._lock:
            before = await asyncio.to_thread(self.runtime.probe)
            if not before.ready:
                return self._status(
                    "runtime_unavailable",
                    detail=before.detail,
                    recoverable=True,
                    version=before.version,
                    user=before.user,
                )
            previous = _read_json(self.state_path)
            if previous.get("app_version") == app_version and version_at_least(before.version):
                status = self._status(
                    "current",
                    detail="runtime already checked for this Viniper version",
                    recoverable=False,
                    version=before.version,
                    user=before.user,
                )
                payload = status.as_dict()
                payload["app_version"] = str(app_version)
                _atomic_json(self.state_path, payload)
                return status
            active = self.active_sessions()
            if active:
                return self._status(
                    "waiting_for_idle",
                    detail=f"waiting for {len(active)} active Agent session(s)",
                    recoverable=True,
                    version=before.version,
                    user=before.user,
                )
            after = await self.runtime.update_cli()
            if not after.ready or not version_at_least(after.version):
                return self._status(
                    "update_failed",
                    detail=after.detail or "Claude Code update or compatibility probe failed",
                    recoverable=True,
                    version=after.version or before.version,
                    user=after.user or before.user,
                    previous_version=before.version,
                )
            status = ProvisionStatus(
                status="compatible",
                detail="Claude Code latest compatibility check passed",
                recoverable=False,
                version=after.version,
                user=after.user,
                previous_version=before.version,
                updated_at=time.time(),
            )
            payload = status.as_dict()
            payload["app_version"] = str(app_version)
            _atomic_json(self.state_path, payload)
            return status


__all__ = [
    "ProvisionStatus",
    "RuntimeUpdateCoordinator",
    "UBUNTU_DISTRO",
    "WslRuntimeProvisioner",
    "linux_stdin_bytes",
]
