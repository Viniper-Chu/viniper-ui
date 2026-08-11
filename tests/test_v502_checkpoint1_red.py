"""Viniper 5.0.2 Checkpoint 1 red tests.

These are deliberately small, isolated contract probes.  They are expected to
show the current 5.0.1 baseline gaps; no production code is changed by this
module and no real provider is contacted.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
EVIDENCE_ROOT = Path(
    os.environ.get(
        "VINIPER_V502_CP1_EVIDENCE_ROOT",
        ROOT / "codex" / "运行残留" / "v502-cp1-red-default",
    )
)
EVIDENCE_ROOT.mkdir(parents=True, exist_ok=True)

# Never import the server against formal or Preview data in this test process.
os.environ["VINIPER_UI_DATA_DIR"] = str(EVIDENCE_ROOT / "import-data")
os.environ["VINIPER_UI_OPEN_BROWSER"] = "0"
os.environ.pop("ELECTRON_RUN_AS_NODE", None)

import agent_runtime  # noqa: E402
import server  # noqa: E402
from agent_runtime import AgentRunSpec, _claude_arguments  # noqa: E402
from context_usage import ContextUsageLedger  # noqa: E402


REAL_MESSAGE_USAGE = {
    "type": "assistant",
    "message": {
        "usage": {
            "input_tokens": 51,
            "cache_creation_input_tokens": 3,
            "cache_read_input_tokens": 109184,
            "output_tokens": 1393,
        }
    },
}


def _session(session_id: str, permission_mode: str) -> dict[str, object]:
    return {
        "id": session_id,
        "mode": "agent",
        "name": f"历史 {session_id}",
        "workdir": f"D:/fixture/{session_id}",
        "messages": [{"role": "user", "content": "fixture"}],
        "attachments": [{"id": f"att-{session_id}", "name": "image.png"}],
        "permission_mode": permission_mode,
        "created": 1.0,
        "updated": 2.0,
    }


class R1ContextWindowRedTests(unittest.TestCase):
    def test_usage_ledger_uses_current_window_and_compact_boundary(self) -> None:
        with tempfile.TemporaryDirectory(prefix="r1-ledger-", dir=EVIDENCE_ROOT) as temp:
            ledger = ContextUsageLedger(Path(temp) / "context-usage.json")
            first = ledger.update_from_event("A", REAL_MESSAGE_USAGE, model="fixture", fallback_limit=128000)
            self.assertIsNotNone(first)
            assert first is not None
            self.assertEqual(first.context_limit, 128000)
            self.assertEqual(first.used_tokens, 51 + 3 + 109184)
            self.assertEqual(first.output_tokens, 1393)
            ledger.mark_compact_boundary("A", {"type": "system", "subtype": "compact_boundary"}, model="fixture", fallback_limit=128000)
            self.assertTrue(ledger.get("A").compacting)
            after = dict(REAL_MESSAGE_USAGE)
            after["message"] = {"usage": {"input_tokens": 7, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 101, "output_tokens": 9999}}
            settled = ledger.update_from_event("A", after, model="fixture", fallback_limit=128000)
            self.assertIsNotNone(settled)
            assert settled is not None
            self.assertFalse(settled.compacting)
            self.assertEqual(settled.used_tokens, 108)

    def test_launcher_status_env_and_ring_share_effective_128k_source(self) -> None:
        """Red seam: one effective window must reach argv, env/status and UI ledger."""
        missing: list[str] = []
        spec = SimpleNamespace(
            session_id="A",
            claude_session_id="00000000-0000-4000-8000-000000005021",
            session_name="A",
            workdir=str(ROOT),
            model="fixture-model",
            permission_mode="default",
            resume=False,
            add_dirs=(),
            fallback_model="",
            system_prompt_file="",
            settings_file="",
            mcp_config_file="",
            permission_prompt_tool="",
            environment={},
            bridge_keys=(),
            autocompact_window=128000,
        )
        try:
            args = _claude_arguments(spec, lambda value: value, permission_choices=("manual", "plan", "dontAsk"))
        except (AttributeError, TypeError) as exc:
            args = []
            missing.append(f"launcher seam rejected autocompact_window: {exc}")
        if "--autocompact" not in args or "128000" not in args:
            missing.append("CLI argv has no --autocompact 128000")

        env = server.build_agent_env(
            {"provider": "fixture", "label": "fixture", "base_url": "", "model": "fixture", "api_key": ""},
            {"id": "A", "workdir": str(ROOT)},
        )
        if "--autocompact" not in args and str(env.get("CLAUDE_CODE_AUTO_COMPACT_WINDOW") or "") != "128000":
            missing.append("legacy CLI fallback env is not official CLAUDE_CODE_AUTO_COMPACT_WINDOW=128000")
        status_payload = server.context_usage_payload("A", "deepseek-v4-flash")
        if status_payload.get("effective_context_window") != 128000:
            missing.append("status context_usage has no effective_context_window=128000 source field")
        renderer_source = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        if "effective_context_window" not in renderer_source:
            missing.append("renderer context ring has no effective_context_window source field")
        if not callable(getattr(agent_runtime, "resolve_autocompact_window", None)):
            missing.append("capability adapter has no current --autocompact/legacy-env resolver")

        self.assertFalse(
            missing,
            "PRODUCT_FAIL R1: effective context window is not one source across argv/env/status/ring: " + "; ".join(missing),
        )

    def test_capability_adapter_supports_current_flag_and_legacy_env_fallback(self) -> None:
        resolver = getattr(agent_runtime, "resolve_autocompact_window", None)
        self.assertTrue(
            callable(resolver),
            "PRODUCT_FAIL R1: no capability adapter for --autocompact or legacy environment fallback",
        )
        current = resolver("claude 2.1.226 --autocompact <auto|tokens>", {})
        legacy = resolver("old claude help", {"CLAUDE_CODE_AUTO_COMPACT_WINDOW": "128000"})
        self.assertEqual(current, 128000)
        self.assertEqual(legacy, 128000)


class R2ElectronScrollRedTests(unittest.TestCase):
    def test_real_chromium_wheel_and_thumb_seam(self) -> None:
        evidence = EVIDENCE_ROOT / "r2-electron"
        evidence.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env["VINIPER_V502_CP1_EVIDENCE_ROOT"] = str(evidence)
        env["VINIPER_UI_DATA_DIR"] = str(evidence / "data")
        env["VINIPER_UI_OPEN_BROWSER"] = "0"
        env.pop("ELECTRON_RUN_AS_NODE", None)
        electron = ROOT / "desktop" / "node_modules" / "electron" / "dist" / "electron.exe"
        harness = ROOT / "tests" / "v502_checkpoint1_renderer_harness.js"
        self.assertTrue(electron.exists(), "HARNESS_FAIL R2: bundled Electron executable is missing")
        completed = None
        try:
            completed = subprocess.run(
                [str(electron), str(harness)],
                cwd=ROOT,
                env=env,
                capture_output=True,
                text=True,
                timeout=100,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            self.fail(f"HARNESS_FAIL R2: Electron harness timed out: {exc}")
        (evidence / "stdout.log").write_text(completed.stdout or "", encoding="utf-8")
        (evidence / "stderr.log").write_text(completed.stderr or "", encoding="utf-8")
        result_path = evidence / "renderer-result.json"
        self.assertTrue(result_path.exists(), "HARNESS_FAIL R2: Electron did not emit renderer-result.json")
        payload = json.loads(result_path.read_text(encoding="utf-8"))
        self.assertNotIn("__harnessError", payload, f"HARNESS_FAIL R2: {payload.get('__harnessError')}")
        self.assertEqual(completed.returncode, 0, "HARNESS_FAIL R2: Electron exited non-zero")
        failures: list[str] = []
        if payload.get("natural_wheel_events", 0) < 2:
            failures.append("HARNESS_FAIL R2: no real wheel events observed")
        if not payload.get("native_thumb_drag_changed"):
            failures.append("PRODUCT_FAIL R2: native scrollbar thumb drag did not move scrollTop")
        if payload.get("follow_after_wheel_up"):
            failures.append("PRODUCT_FAIL R2: natural upward wheel did not release follow")
        if not payload.get("follow_after_wheel_down"):
            failures.append("PRODUCT_FAIL R2: returning to bottom did not restore follow")
        if not payload.get("projection_guard_present"):
            failures.append("PRODUCT_FAIL R2: renderSessionRun lacks a projection guard for natural scroll state")
        permission_dom = payload.get("permission_dom") or {}
        if permission_dom.get("option_ids") != ["default", "acceptEdits", "plan", "auto", "bypassPermissions", "dontAsk"]:
            failures.append("PRODUCT_FAIL R3: real Electron permission menu does not expose the five official modes then CLI dontAsk")
        if not permission_dom.get("cli_divider"):
            failures.append("PRODUCT_FAIL R3: same permission menu has no CLI separator")
        disabled = permission_dom.get("disabled") or {}
        if disabled.get("auto") is not True:
            failures.append("PRODUCT_FAIL R3: DeepSeek Auto is not visibly disabled")
        if disabled.get("bypassPermissions") is not True:
            failures.append("PRODUCT_FAIL R3: gate-off Bypass is not visibly disabled")
        if not permission_dom.get("auto_reason"):
            failures.append("PRODUCT_FAIL R3: disabled Auto has no truthful reason")
        if not permission_dom.get("bypass_reason"):
            failures.append("PRODUCT_FAIL R3: gate-off Bypass has no truthful reason")
        if permission_dom.get("settings_option_ids") != ["default", "acceptEdits", "plan", "auto", "bypassPermissions", "dontAsk"]:
            failures.append("PRODUCT_FAIL R3: settings select is not driven by the same six descriptors")
        settings_disabled = permission_dom.get("settings_disabled") or {}
        if settings_disabled.get("auto") is not True:
            failures.append("PRODUCT_FAIL R3: settings Auto lost server disabled state")
        if settings_disabled.get("bypassPermissions") is not True:
            failures.append("PRODUCT_FAIL R3: settings Bypass lost gate-off disabled state")
        if settings_disabled.get("dontAsk") is not False:
            failures.append("PRODUCT_FAIL R3: settings dontAsk is not selectable when CLI capability is declared")
        if not permission_dom.get("settings_auto_reason") or not permission_dom.get("settings_bypass_reason"):
            failures.append("PRODUCT_FAIL R3: settings disabled modes lost reason/title")
        toggled_disabled = permission_dom.get("settings_after_toggle_disabled") or {}
        if toggled_disabled.get("auto") is not True or toggled_disabled.get("bypassPermissions") is not True:
            failures.append("PRODUCT_FAIL R3: local settings checkbox refresh exposed a mode still rejected by server")
        if toggled_disabled.get("dontAsk") is not False:
            failures.append("PRODUCT_FAIL R3: local gate refresh changed CLI dontAsk availability")
        if permission_dom.get("settings_error"):
            failures.append(f"HARNESS_FAIL R3: settings renderer error: {permission_dom['settings_error']}")
        menu_viewport = permission_dom.get("menu_viewport") or {}
        if not menu_viewport.get("within_viewport"):
            failures.append("PRODUCT_FAIL R3: permission menu escapes the viewport at the tested size")
        if menu_viewport.get("overflow_y") not in {"auto", "scroll"}:
            failures.append("PRODUCT_FAIL R3: permission menu has no bounded vertical overflow")
        if menu_viewport.get("scroll_height", 0) > menu_viewport.get("client_height", 0) and not (menu_viewport.get("dontask_after_scroll") or {}).get("visible_in_menu"):
            failures.append("PRODUCT_FAIL R3: dontAsk is not reachable after scrolling the bounded menu")
        compact_copy = menu_viewport.get("compact_copy") or {}
        for mode in ("auto", "bypassPermissions"):
            if int((compact_copy.get(mode) or {}).get("small_count", 0)) > 1:
                failures.append(f"PRODUCT_FAIL R3: {mode} menu row renders description and disabled reason as duplicate paragraphs")
        session_scroll = payload.get("session_scroll") or {}
        a_after_up = session_scroll.get("a_after_up") or {}
        b_after_down = session_scroll.get("b_after_down") or {}
        a_after_switch = session_scroll.get("a_after_switch") or {}
        if not session_scroll:
            failures.append("HARNESS_FAIL R2: session scroll isolation probe did not emit a result")
        if float(a_after_up.get("scrollTop", 0)) > 2:
            failures.append("HARNESS_FAIL R2: A natural wheel probe did not reach the top")
        if float(b_after_down.get("max", 0)) - float(b_after_down.get("scrollTop", 0)) > 2:
            failures.append("HARNESS_FAIL R2: B natural wheel probe did not reach the bottom")
        if str(a_after_switch.get("session") or "") != "A" or float(a_after_switch.get("scrollTop", 0)) > 2:
            failures.append("PRODUCT_FAIL R2: session switch restored B scroll position into A instead of A's saved top")
        self.assertFalse(failures, "; ".join(failures))


class R3PermissionModesRedTests(unittest.TestCase):
    def test_labels_follow_claude_semantics_and_threshold_is_native(self) -> None:
        expected = {
            "default": "询问权限",
            "acceptEdits": "自动接受编辑",
            "plan": "计划模式",
            "auto": "自动模式",
            "bypassPermissions": "跳过权限",
            "dontAsk": "不询问",
        }
        self.assertEqual({item["id"]: item["label"] for item in server.PERMISSION_MODE_OPTIONS}, expected)
        app = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        self.assertIn("const DEFAULT_AUTO_COMPACT_THRESHOLD = 0.95", app)
        self.assertNotIn("后台整理已排队", app)
        self.assertIn("Claude Code 将在处理新消息时判断", app)

    def test_one_viniper_menu_exposes_six_modes_with_cli_separator_metadata(self) -> None:
        expected = ["default", "acceptEdits", "plan", "auto", "bypassPermissions", "dontAsk"]
        actual = [item.get("id") for item in server.PERMISSION_MODE_OPTIONS]
        self.assertEqual(
            actual,
            expected,
            "PRODUCT_FAIL R3: Viniper permission menu is missing the CLI-only dontAsk entry or wrong order",
        )
        dont_ask = next((item for item in server.PERMISSION_MODE_OPTIONS if item.get("id") == "dontAsk"), {})
        self.assertTrue(dont_ask.get("cli_only"), "PRODUCT_FAIL R3: dontAsk is not marked CLI 模式 / 不询问")
        self.assertTrue(dont_ask.get("separator_before"), "PRODUCT_FAIL R3: dontAsk has no same-menu separator")

    def test_deepseek_auto_and_bypass_are_visible_disabled_with_reasons(self) -> None:
        descriptors = getattr(server, "permission_mode_descriptors", None)
        self.assertTrue(
            callable(descriptors),
            "PRODUCT_FAIL R3: server exposes only an available set; disabled Auto/Bypass descriptors are missing",
        )
        with patch.object(
            server,
            "deepseek_config",
            return_value={"provider": "deepseek", "label": "DeepSeek", "base_url": "https://api.deepseek.com", "model": "deepseek-v4-flash"},
        ):
            items = {item["id"]: item for item in descriptors()}
        self.assertFalse(items["auto"]["enabled"])
        self.assertIn("DeepSeek", str(items["auto"].get("reason") or ""))
        self.assertFalse(items["bypassPermissions"]["enabled"])
        self.assertTrue(items["dontAsk"]["cli_only"])

    def test_renderer_source_declares_six_mode_menu_and_official_order(self) -> None:
        source = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        self.assertIn('id: "dontAsk"', source, "PRODUCT_FAIL R3: renderer mode source has no dontAsk entry")
        self.assertRegex(
            source,
            r'\["default",\s*"acceptEdits",\s*"plan",\s*"auto",\s*"bypassPermissions",\s*"dontAsk"\]',
            "PRODUCT_FAIL R3: renderer official order is not Manual, Accept edits, Plan, Auto, Bypass, dontAsk",
        )

    def test_real_cli_args_cover_dontask_bypass_and_default_alias(self) -> None:
        base = dict(
            session_id="A",
            claude_session_id="00000000-0000-4000-8000-000000005023",
            session_name="A",
            workdir=str(ROOT),
            model="fixture-model",
            resume=False,
        )
        choices = ("manual", "acceptEdits", "plan", "bypassPermissions", "auto", "dontAsk")
        default_args = _claude_arguments(AgentRunSpec(permission_mode="default", **base), lambda value: value, permission_choices=choices)
        dont_args = _claude_arguments(AgentRunSpec(permission_mode="dontAsk", **base), lambda value: value, permission_choices=choices)
        bypass_args = _claude_arguments(AgentRunSpec(permission_mode="bypassPermissions", **base), lambda value: value, permission_choices=choices)
        self.assertEqual(default_args[default_args.index("--permission-mode") + 1], "manual")
        self.assertEqual(dont_args[dont_args.index("--permission-mode") + 1], "dontAsk")
        self.assertIn("--allow-dangerously-skip-permissions", bypass_args)


class R4MigrationAndManifestRedTests(unittest.TestCase):
    def test_isolated_migration_preserves_six_mode_records_and_user_fields(self) -> None:
        modes = ("default", "acceptEdits", "plan", "bypassPermissions", "auto", "dontAsk")
        raw = {mode: _session(mode, mode) for mode in modes}
        normalized = {sid: server.normalize_session(sid, record) for sid, record in raw.items()}
        for sid, record in raw.items():
            current = normalized[sid]
            self.assertEqual(current.get("id"), record["id"])
            self.assertEqual(current.get("name"), record["name"])
            self.assertEqual(current.get("workdir"), record["workdir"])
            self.assertEqual(len(current.get("messages") or []), len(record["messages"]))
            self.assertEqual(len(current.get("attachments") or []), len(record["attachments"]))
            self.assertEqual(
                current.get("permission_mode"),
                record["permission_mode"],
                "PRODUCT_FAIL R4: migration changed a durable permission_mode (including CLI dontAsk)",
            )
            self.assertEqual(server.normalize_session(sid, current), current, "PRODUCT_FAIL R4: second migration is not idempotent")

    def test_local_502_manifest_decision_is_atomic_and_installer_aware(self) -> None:
        with tempfile.TemporaryDirectory(prefix="r4-manifest-", dir=EVIDENCE_ROOT) as temp:
            root = Path(temp)
            manifest = {
                "name": "Viniper",
                "version": "5.0.2",
                "release_revision": 1,
                "requires_installer": True,
                "assets": {
                    "app": {"name": "Viniper-v5.0.2.zip", "url": "http://127.0.0.1:9/Viniper-v5.0.2.zip", "size": 1},
                    "installer": {"name": "Viniper.Setup.5.0.2.exe", "url": "http://127.0.0.1:9/Viniper.Setup.5.0.2.exe", "size": 1},
                },
            }
            (root / "latest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
            loaded = json.loads((root / "latest.json").read_text(encoding="utf-8"))
            decision = server.update_decision(loaded, current_version="5.0.1", current_release_revision=1)
            self.assertTrue(decision["automatic"])
            self.assertTrue(server.update_requires_installer(loaded))
            self.assertEqual(loaded["assets"]["installer"]["size"], 1)


class CP2PermissionBoundaryAddendumTests(unittest.IsolatedAsyncioTestCase):
    async def test_agent_post_rejects_saved_unavailable_mode_before_persist_or_provider(self) -> None:
        session_id = "cp2-gated-agent"
        original = server.sessions.get(session_id)
        server.sessions[session_id] = _session(session_id, "auto")

        class Request:
            def __init__(self, body):
                self.body = body

            async def json(self):
                return self.body

        calls: list[str] = []

        async def forbidden_stream(*args, **kwargs):
            calls.append("provider")
            if False:
                yield None

        descriptors = [
            {"id": "default", "enabled": True},
            {"id": "acceptEdits", "enabled": True},
            {"id": "plan", "enabled": True},
            {"id": "auto", "enabled": False, "reason": "当前 DeepSeek/第三方 Provider 不支持 Claude 原生自动模式"},
            {"id": "bypassPermissions", "enabled": False, "reason": "请先在设置中明确启用跳过权限"},
            {"id": "dontAsk", "enabled": True},
        ]
        try:
            with (
                patch.object(server, "permission_mode_descriptors", return_value=descriptors),
                patch.object(server, "persist_accepted_agent_turn", side_effect=lambda *args, **kwargs: calls.append("persist")),
                patch.object(server, "stream_chat", forbidden_stream),
            ):
                with self.assertRaises(server.HTTPException) as raised:
                    await server.chat(session_id, Request({"message": "不可绕过 gate"}))
            self.assertEqual(raised.exception.status_code, 400)
            self.assertIn("DeepSeek", str(raised.exception.detail))
            self.assertEqual(calls, [], "PRODUCT_FAIL: blocked mode reached persistence or provider")
            self.assertEqual(server.sessions[session_id]["messages"], _session(session_id, "auto")["messages"])
        finally:
            if original is None:
                server.sessions.pop(session_id, None)
            else:
                server.sessions[session_id] = original

    def test_settings_and_session_permission_descriptors_share_disabled_reason_contract(self) -> None:
        source = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        self.assertIn("function permissionModeOptions()", source)
        self.assertIn("function settingsPermissionModeOptions()", source)
        self.assertIn("item.enabled === false", source)
        self.assertIn("mode.reason", source)
        self.assertIn("data-permission-divider=\"cli\"", source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
