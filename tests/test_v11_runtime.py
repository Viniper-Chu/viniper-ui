"""v11 runtime seam, WSL provisioning, and update coordinator regressions."""

from __future__ import annotations

import asyncio
import json
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import server
from agent_runtime import (
    AgentRunSpec,
    REQUIRED_CLAUDE_FLAGS,
    RuntimeCapabilities,
    RuntimeProbe,
    SESSION_HELPER_VERSION,
    WslAgentRuntime,
    WindowsNativeRuntime,
    stable_session_name,
)
from wsl_runtime import RuntimeUpdateCoordinator, WslRuntimeProvisioner, linux_stdin_bytes


ROOT = Path(__file__).resolve().parents[1]


class FakeProcess:
    def __init__(self, pid: int = 1001) -> None:
        self.pid = pid
        self.stdin = object()
        self.stdout = object()
        self.stderr = object()
        self.returncode = None


class RuntimeSeamTests(unittest.IsolatedAsyncioTestCase):
    def make_spec(self, session_id: str = "session-a") -> AgentRunSpec:
        return AgentRunSpec(
            session_id=session_id,
            claude_session_id=f"claude-{session_id}",
            session_name=stable_session_name("同名会话", session_id),
            workdir=r"D:\Work Area\demo",
            model="deepseek-v4-flash",
            permission_mode="default",
            resume=False,
            add_dirs=(r"D:\Work Area\demo", r"C:\Shared"),
            system_prompt_file=r"C:\Prompt Data\agent-system.md",
            environment={
                "ANTHROPIC_AUTH_TOKEN": "fixture-secret-value",
                "ANTHROPIC_BASE_URL": "https://example.invalid/anthropic",
                "ANTHROPIC_MODEL": "deepseek-v4-flash",
                "HTTP_PROXY": "http://127.0.0.1:7897",
                "HTTPS_PROXY": "http://127.0.0.1:7897",
            },
            bridge_keys=(
                "ANTHROPIC_AUTH_TOKEN",
                "ANTHROPIC_BASE_URL",
                "ANTHROPIC_MODEL",
                "HTTP_PROXY",
                "HTTPS_PROXY",
            ),
        )

    async def test_wsl_runtime_owns_path_command_env_and_spawn(self) -> None:
        spawned: list[tuple[tuple[str, ...], dict]] = []

        async def fake_spawn(*args, **kwargs):
            spawned.append((tuple(str(item) for item in args), kwargs))
            return FakeProcess()

        runtime = WslAgentRuntime(
            process_factory=fake_spawn,
            proxy_resolver=lambda value: value.replace("127.0.0.1", "172.20.0.1"),
        )
        spec = self.make_spec()
        process = await runtime.spawn_session(spec)

        self.assertEqual(runtime.map_path(r"D:\Work Area\demo"), "/mnt/d/Work Area/demo")
        self.assertEqual(runtime.map_path("/mnt/c/Shared", to_linux=False), r"C:\Shared")
        self.assertEqual(process.session_id, "session-a")
        command, kwargs = spawned[0]
        joined = " ".join(command)
        self.assertIn("ViniperRuntime", command)
        self.assertIn("/usr/local/bin/viniper-run-session", command)
        self.assertNotIn("fixture-secret-value", joined)
        self.assertNotIn("ANTHROPIC_AUTH_TOKEN=", joined)
        self.assertEqual(kwargs["cwd"], None)
        self.assertEqual(kwargs["env"]["ANTHROPIC_AUTH_TOKEN"], "fixture-secret-value")
        self.assertEqual(kwargs["env"]["HTTP_PROXY"], "http://172.20.0.1:7897")
        self.assertIn("ANTHROPIC_AUTH_TOKEN", kwargs["env"]["WSLENV"].split(":"))
        self.assertIn("--add-dir", command)
        self.assertIn("/mnt/c/Shared", command)

    async def test_cancel_is_per_session_group_and_never_terminates_distro(self) -> None:
        commands: list[list[str]] = []

        async def fake_spawn(*args, **kwargs):
            return FakeProcess(pid=1001 if "session-a" in args else 1002)

        async def fake_control(command: list[str]) -> subprocess.CompletedProcess:
            commands.append(command)
            return subprocess.CompletedProcess(command, 0, stdout="cancelled", stderr="")

        runtime = WslAgentRuntime(
            process_factory=fake_spawn,
            async_control_runner=fake_control,
            proxy_resolver=lambda value: value,
        )
        await runtime.spawn_session(self.make_spec("session-a"))
        await runtime.spawn_session(self.make_spec("session-b"))
        self.assertTrue(await runtime.cancel("session-a"))
        self.assertIn("session-b", runtime.active_sessions())
        self.assertNotIn("session-a", runtime.active_sessions())
        flattened = " ".join(item for command in commands for item in command).lower()
        self.assertIn("viniper-cancel-session", flattened)
        self.assertNotIn("--terminate", flattened)
        self.assertNotIn("--shutdown", flattened)
        self.assertNotIn("--unregister", flattened)

    def test_native_adapter_is_explicit_migration_only(self) -> None:
        native = WindowsNativeRuntime(["claude"])
        self.assertEqual(native.probe().status, "migration_only")
        self.assertFalse(native.capabilities().peer_messaging)

    def test_session_names_are_stable_unique_and_cli_safe(self) -> None:
        a = stable_session_name("同名会话", "aaaaaaaa-1111")
        b = stable_session_name("同名会话", "bbbbbbbb-2222")
        self.assertNotEqual(a, b)
        self.assertRegex(a, r"^[a-z0-9-]+$")
        self.assertLessEqual(len(a), 48)

    def test_probe_accepts_hidden_documented_prompt_file_variant_without_provider_call(self) -> None:
        help_flags = " ".join(
            flag for flag in REQUIRED_CLAUDE_FLAGS
            if flag != "--append-system-prompt-file"
        )
        output = (
            "__VINIPER_USER__=viniper\n"
            "__VINIPER_UID__=1000\n"
            "__VINIPER_HELPERS__=ready\n"
            "__VINIPER_CLAUDE_PATH__=/home/viniper/.local/bin/claude\n"
            "__VINIPER_NATIVE_CLI__=ready\n"
            "__VINIPER_CLAUDE__=2.1.226 (Claude Code)\n"
            f"__VINIPER_HELP_BEGIN__\n{help_flags}\nagents\n"
            "__VINIPER_APPEND_FILE__=accepted\n"
            "__VINIPER_PERMISSION_PROMPT__=accepted\n"
        )
        commands: list[list[str]] = []

        def fake_run(command):
            commands.append(list(command))
            return subprocess.CompletedProcess(command, 0, stdout=output, stderr="")

        probe = WslAgentRuntime(command_runner=fake_run).probe()
        self.assertTrue(probe.ready)
        self.assertTrue(probe.capabilities.native_cli)
        self.assertTrue(probe.capabilities.agent_view)
        self.assertFalse(probe.capabilities.agent_registry)
        self.assertFalse(probe.capabilities.peer_messaging)
        self.assertIn("--append-system-prompt-file", " ".join(commands[0]))
        self.assertNotIn(" -p ", f" {' '.join(commands[0])} ")
        self.assertNotIn("claude agents --json", " ".join(commands[0]))

    def test_agent_view_lifecycle_rows_are_parsed_without_becoming_peer_addresses(self) -> None:
        payload = json.dumps([
            {"id": "background-a", "state": "running", "cwd": "/mnt/d/work", "kind": "background", "startedAt": "now", "secret": "omit"},
            {"sessionId": "", "name": "bad"},
        ])

        def fake_run(command):
            return subprocess.CompletedProcess(command, 0, stdout=payload, stderr="")

        rows = WslAgentRuntime(command_runner=fake_run).list_agent_view_sessions()
        self.assertEqual(rows, [{
            "id": "background-a", "state": "running", "cwd": "/mnt/d/work",
            "kind": "background", "startedAt": "now",
        }])


class FakeRuntime:
    def __init__(self, probes: list[RuntimeProbe]) -> None:
        self.probes = list(probes)
        self.update_calls = 0

    def probe(self) -> RuntimeProbe:
        if len(self.probes) > 1:
            return self.probes.pop(0)
        return self.probes[0]

    async def update_cli(self) -> RuntimeProbe:
        self.update_calls += 1
        return self.probe()


class ProvisionAndUpdateTests(unittest.IsolatedAsyncioTestCase):
    def test_wsl_bash_stdin_is_utf8_lf_without_windows_translation(self) -> None:
        payload = linux_stdin_bytes("set -eu\r\necho ready\r\n")
        self.assertEqual(payload, b"set -eu\necho ready\n")
        self.assertNotIn(b"\r", payload)

    def test_managed_canceller_uses_external_process_group_signals(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            provisioner = WslRuntimeProvisioner(
                runtime=FakeRuntime([RuntimeProbe(status="configuring")]),
                state_path=Path(tmp) / "state.json",
                install_location=Path(tmp) / "runtime",
            )
            script = provisioner._configure_script()
        self.assertIn(f"# viniper-runtime-helper={SESSION_HELPER_VERSION}", script)
        self.assertIn("exec setsid --wait sh -c", script)
        self.assertNotIn("exec setsid sh -c", script)
        self.assertIn('/usr/bin/kill -TERM -- "-$pgid"', script)
        self.assertIn('/usr/bin/kill -0 -- "-$pgid"', script)

    def test_inspect_maps_missing_reboot_ready_without_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "runtime-state.json"
            runtime = FakeRuntime([RuntimeProbe(status="distro_missing")])
            provisioner = WslRuntimeProvisioner(
                runtime=runtime,
                state_path=state_path,
                install_location=Path(tmp) / "distro",
            )
            self.assertEqual(provisioner.inspect().status, "distro_missing")

            runtime.probes = [RuntimeProbe(status="reboot_required", detail="restart required")]
            self.assertEqual(provisioner.inspect().status, "reboot_required")

            runtime.probes = [RuntimeProbe(status="ready", version="2.1.226", user="viniper")]
            ready = provisioner.inspect()
            self.assertEqual(ready.status, "ready")
            self.assertEqual(ready.user, "viniper")
            self.assertEqual(json.loads(state_path.read_text(encoding="utf-8"))["status"], "ready")

    def test_platform_uac_result_persists_exact_resume_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "runtime-state.json"
            runtime = FakeRuntime([RuntimeProbe(status="wsl_missing")])
            provisioner = WslRuntimeProvisioner(
                runtime=runtime,
                state_path=state_path,
                install_location=Path(tmp) / "distro",
            )
            requested = provisioner.record_platform_result(True)
            self.assertEqual(requested.status, "reboot_required")
            self.assertTrue(requested.needs_reboot)
            self.assertEqual(json.loads(state_path.read_text(encoding="utf-8"))["status"], "reboot_required")

            runtime.probes = [RuntimeProbe(status="distro_missing")]
            resumed = provisioner.record_platform_result(True)
            self.assertEqual(resumed.status, "distro_missing")
            self.assertFalse(resumed.needs_reboot)

            runtime.probes = [RuntimeProbe(status="wsl_missing")]
            cancelled = provisioner.record_platform_result(False)
            self.assertEqual(cancelled.status, "wsl_missing")
            self.assertTrue(cancelled.recoverable)

    async def test_update_waits_for_idle_runs_and_is_once_per_app_version(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "update-state.json"
            runtime = FakeRuntime([
                RuntimeProbe(status="ready", version="2.1.225", user="viniper"),
                RuntimeProbe(status="ready", version="2.1.226", user="viniper"),
            ])
            active = {"session-a"}
            coordinator = RuntimeUpdateCoordinator(runtime, state_path, lambda: set(active))

            waiting = await coordinator.ensure_current("5.0.0")
            self.assertEqual(waiting.status, "waiting_for_idle")
            self.assertEqual(runtime.update_calls, 0)

            active.clear()
            updated = await coordinator.ensure_current("5.0.0")
            self.assertEqual(updated.status, "compatible")
            self.assertEqual(runtime.update_calls, 1)

            again = await coordinator.ensure_current("5.0.0")
            self.assertEqual(again.status, "current")
            self.assertEqual(runtime.update_calls, 1)

            after_restart = await coordinator.ensure_current("5.0.0")
            self.assertEqual(after_restart.status, "current")
            self.assertEqual(runtime.update_calls, 1)
            self.assertEqual(coordinator.status()["app_version"], "5.0.0")

    async def test_update_failure_is_recoverable_and_keeps_previous_version(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            runtime = FakeRuntime([
                RuntimeProbe(status="ready", version="2.1.225", user="viniper"),
                RuntimeProbe(status="recoverable_error", version="2.1.225", detail="network unavailable"),
            ])
            coordinator = RuntimeUpdateCoordinator(runtime, Path(tmp) / "update.json", lambda: set())
            result = await coordinator.ensure_current("5.0.1")
            self.assertEqual(result.status, "update_failed")
            self.assertTrue(result.recoverable)
            self.assertEqual(result.previous_version, "2.1.225")

    def test_runtime_migration_manifest_requires_full_installer(self) -> None:
        manifest = {
            "version": "5.0.0",
            "requires_installer": True,
            "assets": {
                "portable": {"name": "Viniper.zip", "url": "https://example.invalid/Viniper.zip"},
                "installer": {"name": "Viniper.Setup.5.0.0.exe", "url": "https://example.invalid/Viniper.Setup.5.0.0.exe"},
            },
        }
        self.assertTrue(server.update_requires_installer(manifest))
        self.assertEqual(server.choose_update_asset(manifest)["key"], "installer")
        with self.assertRaisesRegex(ValueError, "cannot use a portable"):
            server.choose_update_asset(manifest, "portable")

        portable = {"version": "5.0.1", "assets": manifest["assets"]}
        self.assertFalse(server.update_requires_installer(portable))
        self.assertEqual(server.choose_update_asset(portable)["key"], "portable")


class RuntimeProductContractTests(unittest.TestCase):
    def test_model_menu_descriptions_are_product_truth_in_simplified_chinese(self) -> None:
        self.assertEqual(
            [item["description"] for item in server.MODEL_OPTIONS],
            ["复杂编码与长上下文工作", "更快完成日常工作"],
        )
        self.assertEqual(server.SHELL_OPTIONS[1]["label"], "自定义 CLI")
        self.assertTrue(all("Run " not in item["description"] for item in server.SHELL_OPTIONS))

    def test_general_status_uses_cached_runtime_state_without_blocking_wsl_probe(self) -> None:
        class SlowRuntime:
            def cached_probe(self):
                return None

            def probe(self):
                time.sleep(0.4)
                return RuntimeProbe(status="ready", version="2.1.226", user="viniper")

        class Update:
            @staticmethod
            def status():
                return {}

        with patch.object(server, "agent_runtime", return_value=SlowRuntime()), patch.object(
            server, "runtime_update_coordinator", return_value=Update()
        ):
            started = time.perf_counter()
            payload = server.runtime_public_status()
            elapsed = time.perf_counter() - started
        self.assertEqual(payload["status"], "checking")
        self.assertLess(elapsed, 0.1)

    def test_permission_modes_require_real_setting_and_runtime_capability(self) -> None:
        class Runtime:
            def __init__(self, auto: bool) -> None:
                self.auto = auto

            def capabilities(self) -> RuntimeCapabilities:
                return RuntimeCapabilities(auto_permission=self.auto)

        with patch.object(server, "agent_runtime", return_value=Runtime(False)), patch.object(
            server,
            "load_app_settings",
            return_value={"runtime": {"permission_mode": "default", "enable_auto_mode": False, "allow_bypass_permissions": False}},
        ):
            self.assertEqual(server.allowed_permission_mode("default"), "default")
            self.assertEqual(server.allowed_permission_mode("acceptEdits"), "acceptEdits")
            self.assertEqual(server.allowed_permission_mode("plan"), "plan")
            self.assertEqual(server.allowed_permission_mode("auto"), "default")
            self.assertEqual(server.allowed_permission_mode("bypassPermissions"), "default")
            self.assertEqual(server.allowed_permission_mode("dontAsk"), "default")

        enabled = {
            "account": {"signed_in": True},
            "runtime": {"permission_mode": "default", "enable_auto_mode": True, "allow_bypass_permissions": True},
        }
        with (
            patch.object(server, "agent_runtime", return_value=Runtime(True)),
            patch.object(server, "load_app_settings", return_value=enabled),
            patch.object(server, "deepseek_config", return_value={
                "provider": "anthropic", "label": "Anthropic", "base_url": "https://api.anthropic.com", "model": "claude-sonnet-4",
            }),
        ):
            self.assertEqual(server.allowed_permission_mode("auto"), "auto")
            self.assertEqual(server.allowed_permission_mode("bypassPermissions"), "bypassPermissions")

    def test_runtime_setup_has_one_visible_uac_entry_and_recovery_actions(self) -> None:
        main = (ROOT / "desktop" / "main.js").read_text(encoding="utf-8")
        preload = (ROOT / "desktop" / "preload.js").read_text(encoding="utf-8")
        html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        self.assertIn('ipcMain.handle("viniper:enable-wsl-platform"', main)
        self.assertIn("--no-distribution", main)
        self.assertIn("-Verb RunAs", main)
        self.assertIn('enableWslPlatform: () => ipcRenderer.invoke("viniper:enable-wsl-platform")', preload)
        self.assertIn('id="settings-runtime-setup-btn"', html)
        self.assertIn('id="settings-runtime-diagnostics-btn"', html)
        self.assertIn('data-runtime-action="later"', app)
        self.assertIn('data-runtime-action="diagnostics"', app)

        script = r'''
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync("static/app.js", "utf8") + "\nthis.__api = { runtimeSetupViewModel };";
const context = {
  console, TextDecoder, TextEncoder, WeakMap,
  performance: { now: () => 0 },
  localStorage: { getItem: () => null, setItem: () => {} },
  document: { addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] },
  window: { VINIPER_APP_TITLE: "Viniper Preview" },
  setTimeout, clearTimeout, setInterval, clearInterval
};
vm.createContext(context);
vm.runInContext(source, context);
process.stdout.write(JSON.stringify({
  missing: context.__api.runtimeSetupViewModel({status:"wsl_missing"}),
  reboot: context.__api.runtimeSetupViewModel({status:"reboot_required", needs_reboot:true}),
  ready: context.__api.runtimeSetupViewModel({status:"ready", ready:true, version:"2.1.226"})
}));
'''
        result = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["missing"]["canInstall"])
        self.assertIn("UAC", payload["missing"]["detail"])
        self.assertTrue(payload["reboot"]["needsReboot"])
        self.assertFalse(payload["reboot"]["canInstall"])
        self.assertTrue(payload["ready"]["ready"])
        self.assertIn("2.1.226", payload["ready"]["detail"])


if __name__ == "__main__":
    unittest.main()
