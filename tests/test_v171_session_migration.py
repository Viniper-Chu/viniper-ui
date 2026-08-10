from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import server


ROOT = Path(__file__).resolve().parents[1]
RESIDUE = ROOT / "codex" / "运行残留" / "v171-migration-red-green"


class SessionMigrationTests(unittest.TestCase):
    def test_startup_migration_only_adds_missing_agent_permission_mode_and_is_idempotent(self) -> None:
        RESIDUE.mkdir(parents=True, exist_ok=True)
        original_sessions = dict(server.sessions)
        raw_sessions = {
            "agent-legacy": {
                "id": "agent-legacy",
                "mode": "agent",
                "messages": [{"role": "user", "content": "保留消息"}],
                "created": 100.0,
                "updated": 200.0,
                "name": "旧 Agent",
                "workdir": "D:/fixture/agent",
                "pinned": True,
                "unread": False,
                "last_run_status": "completed",
                "claude_session_id": "00000000-0000-4000-8000-000000000171",
                "claude_initialized": True,
                "summary": "保留摘要",
                "queue": [{"id": "queued-1", "text": "保留队列"}],
                "attachments": [{"name": "keep.png", "size": 12}],
            },
            "agent-explicit": {
                "id": "agent-explicit",
                "mode": "agent",
                "messages": [],
                "created": 300.0,
                "updated": 400.0,
                "name": "已有模式",
                "workdir": "D:/fixture/explicit",
                "pinned": False,
                "unread": True,
                "last_run_status": "",
                "claude_session_id": "00000000-0000-4000-8000-000000000172",
                "claude_initialized": False,
                "summary": "",
                "permission_mode": "plan",
            },
            "chat-legacy": {
                "id": "chat-legacy",
                "mode": "chat",
                "messages": [{"role": "user", "content": "保留聊天"}],
                "created": 500.0,
                "updated": 600.0,
                "name": "旧 Chat",
                "workdir": "D:/fixture/chat",
                "pinned": False,
                "unread": False,
                "last_run_status": "completed",
                "claude_session_id": "",
                "claude_initialized": True,
                "summary": "聊天摘要",
            },
        }
        protected_fields = (
            "id", "name", "workdir", "mode", "messages", "created", "updated",
            "claude_session_id", "claude_initialized", "pinned", "unread",
            "last_run_status", "summary", "queue", "attachments",
        )
        try:
            with tempfile.TemporaryDirectory(prefix="migration-", dir=RESIDUE) as temp:
                root = Path(temp)
                sessions_path = root / "sessions.json"
                settings_path = root / "settings.json"
                sessions_path.write_text(json.dumps(raw_sessions, ensure_ascii=False, indent=2), encoding="utf-8")
                settings_text = '{\n  "runtime": {"permission_mode": "acceptEdits"},\n  "sentinel": "settings-must-not-change"\n}\n'
                settings_path.write_text(settings_text, encoding="utf-8")

                with (
                    patch.object(server, "DATA_DIR", root),
                    patch.object(server, "SESSIONS_FILE", sessions_path),
                    patch.object(server, "load_app_settings", return_value={"runtime": {"permission_mode": "acceptEdits"}}),
                    patch.object(server, "reconcile_orphaned_agent_runs", return_value=[]),
                    patch.object(server, "agent_run_journal", return_value=Mock()),
                    patch.object(server, "agent_runtime", return_value=Mock()),
                    patch.object(server, "durable_interaction_store", return_value=Mock()),
                ):
                    server._startup_cleanup()
                    first = json.loads(sessions_path.read_text(encoding="utf-8"))
                    first_text = sessions_path.read_text(encoding="utf-8")
                    server._startup_cleanup()
                    second = json.loads(sessions_path.read_text(encoding="utf-8"))
                    second_text = sessions_path.read_text(encoding="utf-8")

                self.assertEqual(first["agent-legacy"]["permission_mode"], "acceptEdits")
                self.assertEqual(first["agent-explicit"]["permission_mode"], "plan")
                self.assertNotIn("permission_mode", first["chat-legacy"])
                for session_id, before in raw_sessions.items():
                    for field in protected_fields:
                        if field in before:
                            with self.subTest(session=session_id, field=field):
                                self.assertEqual(first[session_id].get(field), before[field])
                self.assertEqual(first, second)
                self.assertEqual(first_text, second_text)
                self.assertEqual(settings_path.read_text(encoding="utf-8"), settings_text)
        finally:
            server.sessions.clear()
            server.sessions.update(original_sessions)


if __name__ == "__main__":
    unittest.main()
