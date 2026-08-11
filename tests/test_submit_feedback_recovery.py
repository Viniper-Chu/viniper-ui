from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import agent_run_coordinator as coordinator_module
from tests._isolation import configure_server_data_root

configure_server_data_root()
import server
from agent_run_coordinator import AgentRunCoordinator


ROOT = Path(__file__).resolve().parents[1]


def agent_session(session_id: str = "A") -> dict:
    return {
        "id": session_id,
        "mode": "agent",
        "name": f"Agent {session_id}",
        "workdir": str(ROOT),
        "messages": [],
        "created": 1.0,
        "updated": 1.0,
        "pinned": False,
        "unread": False,
        "last_run_status": "",
        "claude_session_id": "00000000-0000-4000-8000-000000000001",
        "claude_initialized": False,
        "summary": "",
    }


class Request:
    async def json(self) -> dict:
        return {
            "message": "你好",
            "model": "deepseek-v4-flash",
            "permission_mode": "default",
            "attachments": [],
        }


class SubmissionPersistenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_submission_is_durable_before_first_sse_and_preflight_failure_is_visible(self) -> None:
        original_sessions = dict(server.sessions)
        original_coordinator = server._agent_run_coordinator
        coordinator = AgentRunCoordinator(decode=server.sse_payloads)
        server.sessions.clear()
        server.sessions["A"] = agent_session()
        server._agent_run_coordinator = coordinator
        response = None
        chunks: list[str] = []
        try:
            with (
                patch.object(server, "deepseek_config", return_value={
                    "model": "deepseek-v4-flash",
                    "api_key": "",
                    "base_url": "http://fixture.invalid",
                    "label": "DeepSeek",
                }),
                patch.object(server, "save_sessions_to_disk"),
            ):
                response = await server.chat("A", Request())

                immediate = server.sessions["A"]
                self.assertEqual(
                    [item.get("role") for item in immediate["messages"]],
                    ["user", "assistant"],
                    "the accepted turn must be durable before the first SSE event",
                )
                self.assertEqual(immediate["messages"][0]["content"], "你好")
                self.assertTrue(immediate["messages"][1].get("pending"))
                self.assertEqual(immediate["last_run_status"], "running")

                chunks = [item async for item in response.body_iterator]

            payloads = [payload for chunk in chunks for payload in server.sse_payloads(chunk)]
            self.assertEqual([item["type"] for item in payloads], ["error", "done"])
            self.assertFalse(any(item.get("type") == "interaction_request" for item in payloads))

            final = server.sessions["A"]
            self.assertEqual(final["messages"][0]["content"], "你好")
            failure = final["messages"][1]
            self.assertFalse(failure.get("pending", False))
            self.assertTrue(failure.get("error"))
            self.assertIn("API key", failure.get("content", ""))
            self.assertNotIn("thinking", failure)
            self.assertNotIn("thinking", [item.get("type") for item in failure.get("segments", [])])
            self.assertEqual(final["last_run_status"], "failed")
        finally:
            if response is not None and not chunks:
                try:
                    async for _chunk in response.body_iterator:
                        pass
                except Exception:
                    pass
            await coordinator.shutdown()
            server._agent_run_coordinator = original_coordinator
            server.sessions.clear()
            server.sessions.update(original_sessions)
            server._session_locks.pop("A", None)


class OrphanRecoveryTests(unittest.TestCase):
    def test_dead_owner_journal_entry_is_cleaned_fail_closed_and_keeps_failure_explanation(self) -> None:
        journal_type = getattr(coordinator_module, "AgentRunJournal", None)
        self.assertIsNotNone(journal_type, "a durable run journal is required")
        reconcile = getattr(server, "reconcile_orphaned_agent_runs", None)
        self.assertIsNotNone(reconcile, "startup must reconcile journaled runtime owners")

        class Runtime:
            def __init__(self) -> None:
                self.calls: list[tuple[str, int, int]] = []

            def cleanup_orphaned(self, session_key: str, expected_pgid: int, expected_runtime_pid: int) -> bool:
                self.calls.append((session_key, expected_pgid, expected_runtime_pid))
                return True

        sessions = {
            "A": {
                **agent_session(),
                "last_run_status": "running",
                "messages": [
                    {"role": "user", "content": "写入隔离文件"},
                    {
                        "role": "assistant",
                        "content": "",
                        "pending": True,
                        "thinking": "不会持久化的瞬时状态",
                        "segments": [{"type": "thinking", "content": "不会持久化的瞬时状态"}],
                    },
                ],
            }
        }
        runtime = Runtime()
        residue = ROOT / "codex" / "运行残留"
        residue.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=residue) as temp:
            journal = journal_type(Path(temp) / "agent-runs.json")
            journal.begin({
                "session_id": "A",
                "coordinator_run_id": "run-A",
                "owner_pid": 4242,
                "runtime": "wsl2",
                "session_key": "agent-a-A",
                "process_identity": "wsl:ViniperRuntime:agent-a-A:5252",
                "runtime_pid": 5252,
                "runtime_pgid": 6262,
                "interaction_kind": "permission",
                "interaction_request_id": "permission-A",
            })
            result = reconcile(
                sessions,
                journal=journal,
                runtime=runtime,
                owner_alive=lambda _pid: False,
                at=100.0,
            )

            self.assertEqual(runtime.calls, [("agent-a-A", 6262, 5252)])
            self.assertEqual(result[0]["status"], "cleaned")
            self.assertEqual(journal.active(), [])
            self.assertEqual(sessions["A"]["last_run_status"], "failed")
            failure = sessions["A"]["messages"][-1]
            self.assertEqual(failure["role"], "assistant")
            self.assertNotIn("pending", failure)
            self.assertNotIn("thinking", failure)
            self.assertNotIn("thinking", [item.get("type") for item in failure.get("segments", [])])
            self.assertIn("运行 owner 已失效", failure["content"])
            self.assertNotIn("permission-A", json.dumps(sessions, ensure_ascii=False))


class RendererSubmissionFeedbackTests(unittest.TestCase):
    def test_optimistic_turn_survives_reprojection_and_network_failure(self) -> None:
        electron = ROOT / "desktop" / "node_modules" / "electron" / "dist" / "electron.exe"
        self.assertTrue(electron.exists(), "Electron test runtime is missing")
        result = subprocess.run(
            [str(electron), str(ROOT / "tests" / "submit_feedback_renderer_harness.js")],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertNotIn("__harnessError", payload, payload.get("__harnessError"))
        self.assertEqual(payload["immediate"]["userText"], "你好")
        self.assertEqual(payload["immediate"]["stateRoles"], ["user", "assistant"])
        self.assertFalse(payload["immediate"]["thinkingHidden"])
        self.assertIn("正在发送", payload["immediate"]["workingLabel"])
        self.assertEqual(payload["afterReproject"]["userText"], "你好")
        self.assertEqual(payload["afterReproject"]["stateRoles"], ["user", "assistant"])
        self.assertEqual(payload["failed"]["userText"], "你好")
        self.assertIn("连接失败", payload["failed"]["assistantText"])
        self.assertIn("重试", payload["failed"]["retryStatus"])
        self.assertEqual(payload["failed"]["stateRoles"], ["user", "assistant"])
        self.assertFalse(payload["failed"]["hasInteractionCard"])


if __name__ == "__main__":
    unittest.main()
