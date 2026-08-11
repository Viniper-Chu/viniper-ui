"""v12 global AGENT.md and Claude-style settings center regressions."""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tests._isolation import configure_server_data_root

configure_server_data_root()
import server
from agent_instructions import AgentInstructionsStore
from agent_runtime import AgentRunSpec, WslAgentRuntime


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
CSS = (ROOT / "static" / "style.css").read_text(encoding="utf-8")


class JsonRequest:
    def __init__(self, payload: object) -> None:
        self.payload = payload

    async def json(self) -> object:
        return self.payload


class AgentInstructionsTests(unittest.IsolatedAsyncioTestCase):
    def test_store_empty_create_update_and_profile_isolation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            preview = AgentInstructionsStore(root / "preview" / "AGENT.md")
            formal = AgentInstructionsStore(root / "formal" / "AGENT.md")

            self.assertEqual(preview.read().content, "")
            self.assertFalse(preview.read().exists)
            preview.write("# Preview\n仅用于 Agent。")
            self.assertEqual(preview.read().content, "# Preview\n仅用于 Agent。")
            self.assertFalse(formal.read().exists)
            preview.write("更新后的下一回合指令")
            self.assertEqual(preview.read().content, "更新后的下一回合指令")
            self.assertFalse(preview.path.with_suffix(".md.tmp").exists())

    def test_each_agent_turn_reads_latest_and_uses_prompt_file_not_command_text(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = AgentInstructionsStore(Path(tmp) / "AGENT.md")
            store.write("第一回合唯一指令")
            with patch.object(server, "_agent_instructions_store", store):
                first = server.prepare_agent_system_prompt({"id": "turn-a", "summary": ""})
                store.write("第二回合已更新指令")
                second = server.prepare_agent_system_prompt({"id": "turn-a", "summary": ""})
            self.assertIn("第一回合唯一指令", first.read_text(encoding="utf-8"))
            self.assertIn("第二回合已更新指令", second.read_text(encoding="utf-8"))
            self.assertNotEqual(first, second)

            spec = AgentRunSpec(
                session_id="turn-a",
                claude_session_id="claude-a",
                session_name="turn-a",
                workdir=str(ROOT),
                model="fixture-model",
                permission_mode="default",
                resume=False,
                system_prompt_file=str(second),
            )
            command = WslAgentRuntime().build_command(spec)
            joined = " ".join(command)
            self.assertIn("--append-system-prompt-file", command)
            self.assertNotIn("第二回合已更新指令", joined)

    async def test_chat_never_reads_or_injects_agent_md(self) -> None:
        session_id = "v12-chat"
        original = dict(server.sessions)
        server.sessions.clear()
        server.sessions[session_id] = {
            "id": session_id, "mode": "chat", "messages": [], "created": 1, "updated": 1,
            "name": "Chat", "workdir": str(ROOT), "pinned": False, "unread": False,
            "claude_session_id": "chat-a", "claude_initialized": False, "summary": "",
        }

        class Response:
            status_code = 200
            headers = {}

            def raise_for_status(self):
                return None

            async def aiter_lines(self):
                yield 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"收到"}}'

        class Stream:
            async def __aenter__(self):
                return Response()

            async def __aexit__(self, *_args):
                return None

        class Client:
            async def __aenter__(self): return self
            async def __aexit__(self, *_args): return None
            def stream(self, *_args, **_kwargs): return Stream()

        try:
            with (
                patch.object(server, "read_agent_instructions", side_effect=AssertionError("Chat must not read AGENT.md")),
                patch.object(server.httpx, "AsyncClient", return_value=Client()),
                patch.object(server, "deepseek_config", return_value={
                    "provider": "fixture", "label": "Fixture", "api_key": "fixture",
                    "base_url": "http://fixture", "model": "fixture-model",
                }),
                patch.object(server, "save_sessions_to_disk"),
            ):
                events = [event async for event in server.CHAT_TRANSPORT.stream(session_id, "普通聊天", "fixture-model")]
            self.assertIn({"type": "text", "content": "收到"}, events)
        finally:
            server.sessions.clear()
            server.sessions.update(original)

    async def test_agent_instructions_api_returns_path_and_atomic_save(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = AgentInstructionsStore(Path(tmp) / "AGENT.md")
            with patch.object(server, "_agent_instructions_store", store):
                saved = await server.update_agent_instructions(JsonRequest({"content": "只在 Agent 中生效"}))
                loaded = await server.get_agent_instructions()
            self.assertTrue(saved["ok"])
            self.assertTrue(loaded["exists"])
            self.assertEqual(loaded["content"], "只在 Agent 中生效")
            self.assertEqual(loaded["path"], str(store.path))


class SettingsCenterContractTests(unittest.TestCase):
    def test_search_results_expand_without_text_or_neighbor_overlap_at_supported_scales(self) -> None:
        electron = ROOT / "desktop" / "node_modules" / "electron" / "dist" / "electron.exe"
        self.assertTrue(electron.exists(), "bundled Electron runtime is required for geometry checks")
        env = dict(os.environ)
        env.pop("ELECTRON_RUN_AS_NODE", None)
        for scale in (1, 1.25, 1.5):
            for viewport_name, width, height in (("standard", 1320, 900), ("narrow", 960, 680)):
                result = subprocess.run(
                    [
                        str(electron), str(ROOT / "tests" / "v12_settings_geometry_harness.js"),
                        f"--scale={scale}", f"--width={width}", f"--height={height}",
                    ],
                    cwd=ROOT,
                    env=env,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    timeout=30,
                    check=True,
                )
                payload = json.loads(next(line for line in reversed(result.stdout.splitlines()) if line.strip()))
                self.assertAlmostEqual(payload["scale"], scale)
                items = payload["result"]["items"]
                self.assertTrue(items, f"{viewport_name} scale={scale} must render results")
                for item in items:
                    self.assertLessEqual(
                        item["scrollHeight"], item["clientHeight"] + 1,
                        f"content overflow at {viewport_name} scale={scale}: {item['text']}",
                    )
                    self.assertLessEqual(
                        item["contentBottom"], item["bottom"] + 1,
                        f"content escapes row at {viewport_name} scale={scale}: {item['text']}",
                    )
                    if item["nextTop"] is not None:
                        self.assertGreaterEqual(
                            item["nextTop"] + 0.5, item["contentBottom"],
                            f"neighbor overlap at {viewport_name} scale={scale}: {item['text']}",
                        )

    def test_single_center_has_search_grouped_navigation_and_scroll_content(self) -> None:
        self.assertIn('id="settings-modal"', HTML)
        self.assertIn('id="settings-search"', HTML)
        self.assertIn('id="settings-close-btn"', HTML)
        self.assertIn('data-settings-section="general"', HTML)
        self.assertIn('data-settings-section="agent"', HTML)
        self.assertIn('data-settings-section="models"', HTML)
        self.assertIn('data-settings-section="workspace"', HTML)
        self.assertIn('data-settings-section="appearance"', HTML)
        self.assertIn('data-settings-section="diagnostics"', HTML)
        self.assertIn('data-settings-section="agent-md"', HTML)
        self.assertIn('data-settings-section="skills"', HTML)
        self.assertIn('id="agent-md-editor"', HTML)
        self.assertIn("function filterSettingsCenter", APP)
        self.assertIn("function markSettingsDirty", APP)
        self.assertIn("function saveAgentInstructions", APP)
        self.assertIn(".settings-center-content", CSS)
        self.assertIn("overflow-y: auto", CSS)
        self.assertNotIn("Custom CLI", HTML)
        self.assertIn("自定义 CLI", HTML)

    def test_no_fake_claude_commercial_settings(self) -> None:
        visible = HTML.casefold()
        for forbidden in ("claude pro", "升级套餐", "账单", "连接器", "插件商店", "订阅管理"):
            self.assertNotIn(forbidden.casefold(), visible)


if __name__ == "__main__":
    unittest.main()
