"""Red/green contracts for the revision-2 bypass-permission gate."""

from __future__ import annotations

import importlib
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx


ROOT = Path(__file__).resolve().parents[1]


class BypassPermissionGateTests(unittest.TestCase):
    def test_settings_exposes_risk_gate_and_live_permission_refresh(self) -> None:
        html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        self.assertIn('id="settings-allow-bypass-permissions"', html)
        self.assertIn("明确理解风险", html)
        self.assertIn('renderPermissionSelect();', app)
        self.assertIn('renderPermissionMenu();', app)
        self.assertIn('runtimePermissionModes.has("bypassPermissions")', app)
        self.assertIn('settingsDraftOpen', app)

    def test_legacy_settings_default_gate_is_false(self) -> None:
        server = importlib.import_module("server")
        normalized = server.normalize_settings({"runtime": {}})
        self.assertIs(normalized["runtime"]["allow_bypass_permissions"], False)

    def test_disabling_gate_downgrades_existing_bypass_sessions_atomically(self) -> None:
        server = importlib.import_module("server")
        sessions = {
            "A": {"id": "A", "mode": "agent", "permission_mode": "bypassPermissions"},
            "B": {"id": "B", "mode": "agent", "permission_mode": "plan"},
        }
        with patch.object(server, "sessions", sessions), patch.object(server, "save_sessions_to_disk") as save:
            changed = server.enforce_bypass_permission_gate({"runtime": {"allow_bypass_permissions": False}})
        self.assertEqual(changed, ["A"])
        self.assertEqual(sessions["A"]["permission_mode"], "default")
        self.assertEqual(sessions["B"]["permission_mode"], "plan")
        save.assert_called_once_with()

    def test_cli_argv_contains_real_bypass_flag_only_for_enabled_mode(self) -> None:
        server = importlib.import_module("server")
        runtime_module = importlib.import_module("agent_runtime")
        spec = runtime_module.AgentRunSpec(
            session_id="A",
            claude_session_id="00000000-0000-4000-8000-000000000099",
            session_name="A",
            workdir=str(ROOT),
            model="fixture-model",
            permission_mode="bypassPermissions",
            resume=True,
        )
        bypass_argv = runtime_module._claude_arguments(spec, lambda value: value)
        self.assertIn("--permission-mode", bypass_argv)
        self.assertIn("--allow-dangerously-skip-permissions", bypass_argv)
        default_argv = runtime_module._claude_arguments(
            runtime_module.AgentRunSpec(**{**spec.__dict__, "permission_mode": "default"}),
            lambda value: value,
        )
        self.assertNotIn("--allow-dangerously-skip-permissions", default_argv)
        with patch.object(server, "load_app_settings", return_value=server.normalize_settings({"runtime": {"allow_bypass_permissions": False}})):
            with self.assertRaises(Exception):
                server.require_permission_mode("bypassPermissions")


class BypassPermissionApiBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_direct_api_bypass_is_rejected_before_provider_and_messages(self) -> None:
        server = importlib.import_module("server")
        runtime_module = importlib.import_module("agent_runtime")
        session_id = "gate-false-api"
        sessions = {
            session_id: {
                "id": session_id,
                "mode": "agent",
                "name": "Gate false",
                "workdir": str(ROOT),
                "messages": [],
                "permission_mode": "bypassPermissions",
            }
        }
        capabilities = runtime_module.RuntimeCapabilities(
            permission_modes=("manual", "acceptEdits", "plan", "bypassPermissions", "dontAsk"),
        )
        started: list[str] = []

        async def fake_stream(*args, **kwargs):
            started.append(str(args[0]))
            yield server.sse({"type": "done"})

        settings = server.normalize_settings({"runtime": {"allow_bypass_permissions": False}})
        with (
            patch.object(server, "sessions", sessions),
            patch.object(server, "load_app_settings", return_value=settings),
            patch.object(server, "agent_runtime") as runtime_factory,
            patch.object(server, "deepseek_config", return_value={"provider": "deepseek", "label": "DeepSeek", "base_url": "", "model": "fixture-model"}),
            patch.object(server, "allowed_model", return_value="fixture-model"),
            patch.object(server, "stream_chat", fake_stream),
        ):
            runtime_factory.return_value.capabilities.return_value = capabilities
            transport = httpx.ASGITransport(app=server.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    f"/api/chat/{session_id}",
                    json={"message": "不应启动", "permission_mode": "bypassPermissions"},
                )
        self.assertIn(response.status_code, {400, 409})
        self.assertFalse(started)
        self.assertEqual(sessions[session_id]["messages"], [])


if __name__ == "__main__":
    unittest.main()
