"""Checkpoint 1 red tests for Viniper 5.0.1.

These tests deliberately encode the accepted G1-G7 product contract.  They are
expected to fail against the Checkpoint 0 production baseline and must not be
weakened to make that baseline green.
"""

from __future__ import annotations

import copy
import inspect
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parents[1]
EVIDENCE_ROOT = Path(
    os.environ.get(
        "VINIPER_V501_CP1_EVIDENCE_ROOT",
        ROOT / "codex" / "运行残留" / "v501-cp1-red-default",
    )
)
EVIDENCE_ROOT.mkdir(parents=True, exist_ok=True)

# Keep this test process away from both formal and Preview user data even when
# it imports the production server module.
os.environ["VINIPER_UI_DATA_DIR"] = str(EVIDENCE_ROOT / "import-data")
os.environ["VINIPER_UI_OPEN_BROWSER"] = "0"

import agent_runtime  # noqa: E402
import server  # noqa: E402
from agent_runtime import AgentRunSpec, RuntimeCapabilities, _claude_arguments  # noqa: E402
from context_usage import ContextUsageLedger  # noqa: E402


REAL_ASSISTANT_USAGE_FRAME = {
    "type": "assistant",
    "message": {
        "usage": {
            "input_tokens": 51,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 109184,
            "output_tokens": 1393,
        }
    },
}


class JsonRequest:
    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload
        self.headers = {"content-type": "application/json"}

    async def json(self) -> dict[str, object]:
        return self.payload


def agent_session(session_id: str, *, workdir: str, permission_mode: str = "default") -> dict[str, object]:
    return {
        "id": session_id,
        "mode": "agent",
        "messages": [],
        "created": 1.0,
        "updated": 1.0,
        "name": f"会话 {session_id}",
        "workdir": workdir,
        "pinned": False,
        "unread": False,
        "last_run_status": "",
        "claude_session_id": f"00000000-0000-4000-8000-{int(session_id[-1], 36):012d}",
        "claude_initialized": False,
        "summary": "",
        "permission_mode": permission_mode,
    }


def chat_session(session_id: str) -> dict[str, object]:
    return {
        "id": session_id,
        "mode": "chat",
        "messages": [],
        "created": 1.0,
        "updated": 1.0,
        "name": f"聊天 {session_id}",
        "workdir": str(ROOT),
        "pinned": False,
        "unread": False,
        "last_run_status": "",
        "claude_session_id": "",
        "claude_initialized": False,
        "summary": "",
    }


class R1RealContextProtocolRedTests(unittest.TestCase):
    def test_real_message_usage_frame_is_current_window_truth(self) -> None:
        with tempfile.TemporaryDirectory(prefix="r1-real-", dir=EVIDENCE_ROOT) as temp:
            ledger = ContextUsageLedger(Path(temp) / "usage.json")
            snapshot = ledger.update_from_event(
                "A",
                copy.deepcopy(REAL_ASSISTANT_USAGE_FRAME),
                model="deepseek-v4-flash",
                fallback_limit=128000,
            )
            self.assertIsNotNone(
                snapshot,
                "PRODUCT_FAIL R1: current Claude assistant message.usage returned None",
            )
            self.assertEqual(snapshot.used_tokens, 109235)
            self.assertEqual(snapshot.output_tokens, 1393)
            second = ledger.update_from_event(
                "A", copy.deepcopy(REAL_ASSISTANT_USAGE_FRAME), model="m", fallback_limit=128000
            )
            self.assertIsNotNone(second, "PRODUCT_FAIL R1: duplicate real frame was ignored")
            self.assertEqual(second.used_tokens, 109235)
            self.assertNotEqual(second.used_tokens, 109235 + 1393)

    def test_ab_compact_boundary_and_post_compact_usage_are_session_scoped(self) -> None:
        with tempfile.TemporaryDirectory(prefix="r1-ab-", dir=EVIDENCE_ROOT) as temp:
            ledger = ContextUsageLedger(Path(temp) / "usage.json")
            a = ledger.update_from_event(
                "A", copy.deepcopy(REAL_ASSISTANT_USAGE_FRAME), model="m-a", fallback_limit=128000
            )
            b_frame = copy.deepcopy(REAL_ASSISTANT_USAGE_FRAME)
            b_frame["message"]["usage"].update(
                {"input_tokens": 10, "cache_read_input_tokens": 20, "output_tokens": 999}
            )
            b = ledger.update_from_event("B", b_frame, model="m-b", fallback_limit=1000)
            self.assertIsNotNone(a, "PRODUCT_FAIL R1: A real usage was ignored")
            self.assertIsNotNone(b, "PRODUCT_FAIL R1: B real usage was ignored")
            self.assertEqual(b.used_tokens, 30)
            ledger.mark_compact_boundary("A", {"trigger": "auto"}, model="m-a", fallback_limit=128000)
            self.assertTrue(ledger.get("A").compacting)
            self.assertFalse(ledger.get("B").compacting)

            after_frame = copy.deepcopy(REAL_ASSISTANT_USAGE_FRAME)
            after_frame["message"]["usage"].update(
                {"input_tokens": 5, "cache_read_input_tokens": 1000, "output_tokens": 5000}
            )
            after = ledger.update_from_event("A", after_frame, model="m-a", fallback_limit=128000)
            self.assertIsNotNone(after, "PRODUCT_FAIL R1: post-compact real usage was ignored")
            self.assertFalse(after.compacting)
            self.assertEqual(after.used_tokens, 1005)
            self.assertEqual(ledger.get("B").used_tokens, 30)


class R3PermissionLauncherRedTests(unittest.TestCase):
    def _arguments(self, semantic_mode: str, choices: tuple[str, ...]) -> list[str]:
        spec = AgentRunSpec(
            session_id="A",
            claude_session_id="00000000-0000-4000-8000-000000000501",
            session_name="A",
            workdir=str(ROOT),
            model="fixture-model",
            permission_mode=semantic_mode,
            resume=False,
        )
        signature = inspect.signature(_claude_arguments)
        self.assertIn(
            "permission_choices",
            signature.parameters,
            "PRODUCT_FAIL R3: launcher has no injected CLI permission choices seam",
        )
        return _claude_arguments(
            spec,
            lambda value: value,
            permission_choices=choices,
        )

    def test_cli_choices_map_stable_semantics_and_bypass_flag(self) -> None:
        current_choices = ("manual", "acceptEdits", "plan", "bypassPermissions", "auto", "dontAsk")
        current = self._arguments(
            "default",
            current_choices,
        )
        legacy = self._arguments("default", ("default", "acceptEdits", "plan"))
        self.assertEqual(current[current.index("--permission-mode") + 1], "manual")
        self.assertEqual(legacy[legacy.index("--permission-mode") + 1], "default")
        for semantic, expected_cli in (
            ("acceptEdits", "acceptEdits"),
            ("plan", "plan"),
            ("auto", "auto"),
            ("bypassPermissions", "bypassPermissions"),
        ):
            with self.subTest(semantic=semantic):
                args = self._arguments(semantic, current_choices)
                self.assertEqual(args[args.index("--permission-mode") + 1], expected_cli)
                if semantic == "bypassPermissions":
                    self.assertIn("--allow-dangerously-skip-permissions", args)


class R3WorkdirPreferenceRedTests(unittest.IsolatedAsyncioTestCase):
    async def test_non_plan_selection_seeds_future_same_workdir_only(self) -> None:
        with tempfile.TemporaryDirectory(prefix="r3-workdir-", dir=EVIDENCE_ROOT) as temp:
            root = Path(temp)
            settings_path = root / "settings.json"
            sessions_path = root / "sessions.json"
            settings_path.write_text(
                json.dumps(
                    server.normalize_settings(
                        {
                            "runtime": {
                                "permission_mode": "default",
                                "enable_auto_mode": False,
                                "allow_bypass_permissions": False,
                            }
                        }
                    ),
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            original_sessions = dict(server.sessions)
            server.sessions.clear()
            try:
                with (
                    patch.object(server, "DATA_DIR", root),
                    patch.object(server, "SETTINGS_FILE", settings_path),
                    patch.object(server, "SESSIONS_FILE", sessions_path),
                ):
                    workdir = str(root / "project-a")
                    other_workdir = str(root / "project-b")
                    server.sessions["A"] = agent_session("A", workdir=workdir)
                    await server.update_session("A", JsonRequest({"permission_mode": "acceptEdits"}))
                    same = await server.new_session(JsonRequest({"mode": "agent", "workdir": workdir}))
                    other = await server.new_session(JsonRequest({"mode": "agent", "workdir": other_workdir}))
                    self.assertEqual(
                        same["permission_mode"],
                        "acceptEdits",
                        "PRODUCT_FAIL R3: same-workdir new session ignored the last non-Plan preference",
                    )
                    self.assertEqual(other["permission_mode"], "default")

                    await server.update_session("A", JsonRequest({"permission_mode": "plan"}))
                    after_plan = await server.new_session(JsonRequest({"mode": "agent", "workdir": workdir}))
                    self.assertEqual(
                        after_plan["permission_mode"],
                        "acceptEdits",
                        "PRODUCT_FAIL R3: Plan must not replace the remembered workdir preference",
                    )
                    self.assertEqual(server.sessions["A"]["permission_mode"], "plan")
                    self.assertEqual(server.sessions[same["session_id"]]["permission_mode"], "acceptEdits")
            finally:
                server.sessions.clear()
                server.sessions.update(original_sessions)


class R4ThinkingElapsedRedTests(unittest.IsolatedAsyncioTestCase):
    async def _run_timed_chat(self, session_id: str, intervals: tuple[int, int, int]) -> tuple[list[dict], dict]:
        clock = {"value": 0.0}
        first_thinking, tool_gap, second_thinking = intervals

        async def provider(_cfg: dict, _payload: dict):
            yield {"type": "content_block_start", "content_block": {"type": "thinking"}}
            clock["value"] += first_thinking
            yield {"type": "text", "content": "第一段正文"}
            clock["value"] += tool_gap
            yield {"type": "thinking", "content": "第二段思考正文"}
            clock["value"] += second_thinking
            yield {"type": "text", "content": "最终正文"}

        transport = server.ChatTransport(provider_request=provider)
        with (
            patch.object(server.time, "monotonic", side_effect=lambda: clock["value"]),
            patch.object(
                server,
                "provider_config",
                return_value={"model": "fake", "api_key": "fixture", "base_url": "http://fixture", "label": "fixture"},
            ),
            patch.object(server, "save_sessions_to_disk"),
        ):
            events = [event async for event in transport.stream(session_id, "合成计时夹具", "fake")]
        return events, server.sessions[session_id]["messages"][-1]

    async def test_two_thinking_intervals_exclude_tool_gap_and_persist_summary(self) -> None:
        original_sessions = dict(server.sessions)
        server.sessions.clear()
        server.sessions["A"] = chat_session("A")
        try:
            events, final = await self._run_timed_chat("A", (2, 5, 3))
            self.assertEqual(
                final.get("thinking_elapsed_seconds"),
                5,
                "PRODUCT_FAIL R4: 2s thinking + 5s non-thinking + 3s thinking must persist as 5s",
            )
            self.assertNotIn("thinking", final)
            self.assertNotIn("thinking", [item.get("type") for item in final.get("segments", [])])
            done = [item for item in events if item.get("type") == "done"][-1]
            self.assertEqual(done.get("thinking_elapsed_seconds"), 5)

            reloaded = json.loads(json.dumps(final, ensure_ascii=False))
            self.assertEqual(reloaded.get("thinking_elapsed_seconds"), 5)
        finally:
            server.sessions.clear()
            server.sessions.update(original_sessions)

    async def test_ab_runs_keep_independent_thinking_totals_and_zero_is_absent(self) -> None:
        original_sessions = dict(server.sessions)
        server.sessions.clear()
        server.sessions["A"] = chat_session("A")
        server.sessions["B"] = chat_session("B")
        try:
            _events_a, final_a = await self._run_timed_chat("A", (2, 5, 3))
            _events_b, final_b = await self._run_timed_chat("B", (1, 9, 1))
            self.assertEqual(final_a.get("thinking_elapsed_seconds"), 5)
            self.assertEqual(final_b.get("thinking_elapsed_seconds"), 2)

            async def plain_provider(_cfg: dict, _payload: dict):
                yield {"type": "text", "content": "无思考正文"}

            server.sessions["C"] = chat_session("C")
            transport = server.ChatTransport(provider_request=plain_provider)
            with (
                patch.object(
                    server,
                    "provider_config",
                    return_value={"model": "fake", "api_key": "fixture", "base_url": "http://fixture", "label": "fixture"},
                ),
                patch.object(server, "save_sessions_to_disk"),
            ):
                _events = [event async for event in transport.stream("C", "无思考", "fake")]
            self.assertNotIn("thinking_elapsed_seconds", server.sessions["C"]["messages"][-1])
        finally:
            server.sessions.clear()
            server.sessions.update(original_sessions)


class R5HistoryUpgradeFixtureTests(unittest.TestCase):
    def test_five_session_fixture_is_idempotent_and_profiles_never_cross(self) -> None:
        with tempfile.TemporaryDirectory(prefix="r5-data-", dir=EVIDENCE_ROOT) as temp:
            root = Path(temp)
            formal = root / "formal"
            preview = root / "preview"
            formal.mkdir()
            preview.mkdir()

            settings = server.normalize_settings({"runtime": {"permission_mode": "acceptEdits"}})
            synthetic_sessions: dict[str, dict] = {}
            for index in range(5):
                sid = f"S{index}"
                item = agent_session(
                    sid,
                    workdir=str(root / f"project-{index}"),
                    permission_mode=("default", "acceptEdits", "plan", "default", "acceptEdits")[index],
                )
                item.update({
                    "updated": float(10 - index),
                    "pinned": index == 2,
                    "unread": index % 2 == 0,
                    "messages": [
                        {
                            "role": "user",
                            "content": f"合成历史 {index}",
                            "attachments": [{"name": f"fixture-{index}.png", "path": f"attachments/{sid}/fixture-{index}.png"}],
                        },
                        {
                            "role": "assistant",
                            "content": "合成回复",
                            "segments": [{"type": "image", "mime_type": "image/png", "data": "aVZCT1I="}],
                        },
                    ],
                    "queue": [{"id": f"q-{index}", "text": "合成排队项"}],
                    "attachments": [{"name": f"fixture-{index}.png"}],
                })
                synthetic_sessions[sid] = item

            (formal / "sessions.json").write_text(json.dumps(synthetic_sessions, ensure_ascii=False, indent=2), encoding="utf-8")
            settings_text = json.dumps(settings, ensure_ascii=False, indent=2)
            (formal / "settings.json").write_text(settings_text, encoding="utf-8")
            (formal / "AGENT.md").write_text("# 合成 AGENT 指令", encoding="utf-8")
            (formal / "daily-usage.json").write_text('{"days":{}}', encoding="utf-8")
            (formal / "context-usage.json").write_text('{"sessions":{"S0":{"used_tokens":25}}}', encoding="utf-8")
            (preview / "sessions.json").write_text(
                json.dumps({"P0": agent_session("P0", workdir=str(root / "preview-project"))}, ensure_ascii=False),
                encoding="utf-8",
            )
            (preview / "settings.json").write_text(settings_text, encoding="utf-8")

            original_sessions = dict(server.sessions)
            try:
                with (
                    patch.object(server, "DATA_DIR", formal),
                    patch.object(server, "SESSIONS_FILE", formal / "sessions.json"),
                    patch.object(server, "SETTINGS_FILE", formal / "settings.json"),
                ):
                    first = server.load_sessions_from_disk()
                    server.sessions.clear()
                    server.sessions.update(first)
                    server.save_sessions_to_disk()
                    second = server.load_sessions_from_disk()

                with (
                    patch.object(server, "DATA_DIR", preview),
                    patch.object(server, "SESSIONS_FILE", preview / "sessions.json"),
                    patch.object(server, "SETTINGS_FILE", preview / "settings.json"),
                ):
                    preview_loaded = server.load_sessions_from_disk()

                self.assertEqual(set(first), {f"S{index}" for index in range(5)})
                self.assertEqual(set(second), set(first))
                self.assertEqual(set(preview_loaded), {"P0"})
                self.assertTrue(set(second).isdisjoint(preview_loaded))
                for sid in first:
                    self.assertEqual(second[sid]["messages"], first[sid]["messages"])
                    self.assertEqual(second[sid]["permission_mode"], first[sid]["permission_mode"])
                    self.assertEqual(second[sid]["workdir"], first[sid]["workdir"])
                    self.assertEqual(second[sid]["queue"], first[sid]["queue"])
                    self.assertEqual(second[sid]["attachments"], first[sid]["attachments"])
                self.assertEqual((formal / "settings.json").read_text(encoding="utf-8"), settings_text)
                self.assertEqual((formal / "AGENT.md").read_text(encoding="utf-8"), "# 合成 AGENT 指令")
                self.assertEqual((formal / "daily-usage.json").read_text(encoding="utf-8"), '{"days":{}}')
                self.assertEqual(
                    (formal / "context-usage.json").read_text(encoding="utf-8"),
                    '{"sessions":{"S0":{"used_tokens":25}}}',
                )
                (EVIDENCE_ROOT / "r5-fixture-metadata.json").write_text(
                    json.dumps(
                        {
                            "formal_session_ids": sorted(second),
                            "formal_message_counts": {sid: len(second[sid]["messages"]) for sid in sorted(second)},
                            "preview_session_ids": sorted(preview_loaded),
                            "second_start_semantically_equal": second == first,
                        },
                        ensure_ascii=False,
                        indent=2,
                    ),
                    encoding="utf-8",
                )
            finally:
                server.sessions.clear()
                server.sessions.update(original_sessions)


def run_renderer_harness() -> dict:
    electron = ROOT / "desktop" / "node_modules" / "electron" / "dist" / "electron.exe"
    if not electron.exists():
        raise AssertionError("HARNESS_FAIL: bundled Electron runtime is missing")
    result_path = EVIDENCE_ROOT / "renderer-result.json"
    process_path = EVIDENCE_ROOT / "renderer-process.json"
    env = dict(os.environ)
    env.pop("ELECTRON_RUN_AS_NODE", None)
    env["VINIPER_V501_CP1_EVIDENCE_ROOT"] = str(EVIDENCE_ROOT)
    user_data_dir = EVIDENCE_ROOT / "electron-user-data"
    completed = subprocess.run(
        [
            str(electron),
            "--disable-error-dialog",
            f"--user-data-dir={user_data_dir}",
            str(ROOT / "tests" / "v501_checkpoint1_renderer_harness.js"),
        ],
        cwd=ROOT,
        env=env,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=70,
        check=False,
    )
    process_path.write_text(
        json.dumps(
            {
                "command": [
                    str(electron),
                    "--disable-error-dialog",
                    f"--user-data-dir={user_data_dir}",
                    str(ROOT / "tests" / "v501_checkpoint1_renderer_harness.js"),
                ],
                "returncode": completed.returncode,
                "stdout": completed.stdout,
                "stderr": completed.stderr,
                "result_exists": result_path.exists(),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    if completed.returncode != 0 or not result_path.exists():
        raise AssertionError(
            "HARNESS_FAIL: Electron renderer harness exited before producing its result; "
            f"see {process_path}"
        )
    payload = json.loads(result_path.read_text(encoding="utf-8"))
    if payload.get("__harnessError"):
        raise AssertionError(f"HARNESS_FAIL: {payload['__harnessError']}")
    if "EPIPE" in completed.stderr or "broken pipe" in completed.stderr.lower():
        raise AssertionError(f"HARNESS_FAIL: Electron emitted a pipe lifecycle error; see {process_path}")
    return payload


class R2R4R5ElectronRedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.payload = run_renderer_harness()

    def test_r2_actual_electron_thumb_drag_and_single_scroll_owner(self) -> None:
        for viewport in ("1280x800", "900x700"):
            with self.subTest(viewport=viewport):
                result = self.payload["viewports"][viewport]
                self.assertTrue(result["layout_ready"], f"HARNESS_FAIL: {viewport} did not overflow")
                self.assertTrue(result["direct_scroll_works"], f"HARNESS_FAIL: {viewport} has no scrollable fixture")
                self.assertEqual(result["visible_scroll_owners"], ["chat-container"])
                self.assertTrue(
                    result["native_thumb_drag_changed_scroll_top"],
                    f"PRODUCT_FAIL R2: native pointer drag did not move the {viewport} conversation thumb",
                )
                self.assertTrue(
                    result["right_edge_2px_dragged"],
                    f"PRODUCT_FAIL R2: the {viewport} scrollbar is not reliably draggable within 2px of the right edge",
                )

    def test_r2_near_bottom_manual_hold_and_ab_follow_are_isolated(self) -> None:
        for viewport in ("1280x800", "900x700"):
            with self.subTest(viewport=viewport):
                result = self.payload["viewports"][viewport]
                self.assertTrue(result["near_bottom_followed"])
                self.assertTrue(result["manual_up_scroll_held"])
                self.assertTrue(result["returned_to_bottom_followed"])
                self.assertTrue(
                    result["follow_isolation"]["bStartedFollowing"],
                    "PRODUCT_FAIL R2: A's manual hold leaked into newly viewed B",
                )
                self.assertFalse(
                    result["follow_isolation"]["aRestoredFollowing"],
                    "PRODUCT_FAIL R2: B's bottom-follow state overwrote A's manual hold",
                )

    def test_r3_policy_order_gates_and_renderer_match(self) -> None:
        expected = [
            ("default", "询问权限"),
            ("acceptEdits", "自动接受编辑"),
            ("plan", "计划模式"),
            ("auto", "自动模式"),
            ("bypassPermissions", "跳过权限"),
            ("dontAsk", "不询问"),
        ]
        self.assertEqual(
            [(item["id"], item["label"]) for item in server.PERMISSION_MODE_OPTIONS],
            expected,
            "PRODUCT_FAIL R3: server policy order/copy differs from the Desktop contract",
        )
        runtime = Mock()
        runtime.capabilities.return_value = RuntimeCapabilities(
            auto_permission=True,
            permission_modes=("manual", "acceptEdits", "plan", "auto", "bypassPermissions", "dontAsk"),
        )
        disabled = server.normalize_settings(
            {"runtime": {"permission_mode": "default", "enable_auto_mode": False, "allow_bypass_permissions": False}}
        )
        with (
            patch.object(server, "load_app_settings", return_value=disabled),
            patch.object(server, "agent_runtime", return_value=runtime),
            patch.object(
                server,
                "deepseek_config",
                return_value={
                    "provider": "deepseek",
                    "label": "DeepSeek",
                    "base_url": "https://api.deepseek.com/anthropic",
                    "model": "deepseek-v4-flash",
                },
            ),
        ):
            self.assertNotIn("auto", server.available_permission_mode_ids())
            self.assertNotIn("bypassPermissions", server.available_permission_mode_ids())
        self.assertEqual(
            self.payload["permission_order"],
            ["default", "acceptEdits", "plan", "auto", "bypassPermissions", "dontAsk"],
            "PRODUCT_FAIL R3: renderer does not preserve official order and CLI dontAsk extension",
        )

    def test_r4_completed_message_has_turn_summary_and_no_thinking_body(self) -> None:
        self.assertTrue(self.payload["thinking_summary"]["bodyRemoved"])
        self.assertTrue(
            self.payload["thinking_summary"]["summaryVisible"],
            "PRODUCT_FAIL R4: persisted whole-turn elapsed has no completed summary",
        )

    def test_r5_sidebar_filters_title_and_workdir_then_reopens(self) -> None:
        history = self.payload["history"]
        self.assertEqual(history["initialRows"], 5, "HARNESS_FAIL: five-session renderer fixture did not load")
        self.assertTrue(history["searchPresent"], "PRODUCT_FAIL R5: sidebar has no history search/filter input")
        self.assertTrue(history["toggleOpened"], "PRODUCT_FAIL R5: the history search cannot be revealed by its real control")
        self.assertEqual(history["titleFilteredIds"], ["S3"])
        self.assertEqual(history["workdirFilteredIds"], ["S4"])
        self.assertEqual(history["reopenedSessionId"], "S4")
        self.assertEqual(history["reopenedWorkdir"], "D:/独特路径/project-four")
        self.assertEqual(history["reopenedMessage"], "合成历史 4")
        self.assertEqual(history["sessionIndexCount"], 5, "PRODUCT_FAIL R5: reopening history created or dropped a session")


if __name__ == "__main__":
    unittest.main(verbosity=2)
