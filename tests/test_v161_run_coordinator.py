import asyncio
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from agent_run_coordinator import ActiveRunExists, AgentRunCoordinator
from agent_queue import AgentQueueStore
import server


ROOT = Path(__file__).resolve().parents[1]


class RunCoordinatorContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_subscriber_disconnect_does_not_own_run_and_pending_replays(self) -> None:
        release = asyncio.Event()
        producer_finished = asyncio.Event()

        async def producer():
            try:
                yield {"type": "assistant_start", "session_id": "A"}
                yield {
                    "type": "interaction_request",
                    "kind": "question",
                    "session_id": "A",
                    "request_id": "question-A",
                    "questions": [{"question": "继续吗？", "options": [{"label": "继续"}]}],
                }
                await release.wait()
                yield {"type": "text", "content": "已继续"}
                yield {"type": "done"}
            finally:
                producer_finished.set()

        coordinator = AgentRunCoordinator()
        record = coordinator.start("A", producer)
        first = coordinator.subscribe("A", record.run_id, after_sequence=0)
        start = await anext(first)
        pending = await anext(first)
        self.assertEqual(start["type"], "assistant_start")
        self.assertEqual(pending["request_id"], "question-A")
        self.assertFalse(coordinator.snapshot("A")["input_ready"])
        await first.aclose()
        await asyncio.sleep(0)

        self.assertFalse(producer_finished.is_set(), "closing one subscriber must not close the producer")
        snapshot = coordinator.snapshot("A")
        self.assertTrue(snapshot["active"])
        self.assertEqual(snapshot["status"], "waiting_input")
        self.assertEqual(snapshot["pending_interaction"]["request_id"], "question-A")

        replay = coordinator.subscribe("A", record.run_id, after_sequence=start["sequence"])
        replayed = await anext(replay)
        self.assertEqual(replayed["request_id"], "question-A")
        self.assertEqual(replayed["run_id"], record.run_id)

        release.set()
        tail = [replayed]
        async for event in replay:
            tail.append(event)
        self.assertEqual([item["type"] for item in tail], ["interaction_request", "text", "done"])
        self.assertTrue(producer_finished.is_set())
        terminal = coordinator.snapshot("A")
        self.assertFalse(terminal["active"])
        self.assertTrue(terminal["terminal"])
        self.assertEqual(terminal["status"], "completed")
        self.assertIsNone(terminal["pending_interaction"])
        self.assertFalse(terminal["input_ready"])

    async def test_one_active_run_per_session_but_sessions_are_independent(self) -> None:
        releases = {"A": asyncio.Event(), "B": asyncio.Event()}

        async def producer(session_id: str):
            yield {"type": "assistant_start", "session_id": session_id}
            await releases[session_id].wait()
            yield {"type": "done"}

        coordinator = AgentRunCoordinator()
        run_a = coordinator.start("A", lambda: producer("A"))
        with self.assertRaises(ActiveRunExists):
            coordinator.start("A", lambda: producer("A"))
        run_b = coordinator.start("B", lambda: producer("B"))
        self.assertNotEqual(run_a.run_id, run_b.run_id)
        self.assertTrue(coordinator.snapshot("A")["active"])
        self.assertTrue(coordinator.snapshot("B")["active"])
        releases["A"].set()
        await run_a.task
        self.assertFalse(coordinator.snapshot("A")["active"])
        self.assertTrue(coordinator.snapshot("B")["active"])
        releases["B"].set()
        await run_b.task


class ServerProductionChainTests(unittest.IsolatedAsyncioTestCase):
    async def test_explicit_stop_marks_coordinator_cancelled_before_runtime_exits(self) -> None:
        release = asyncio.Event()

        async def producer():
            yield {"type": "assistant_start"}
            await release.wait()
            yield {"type": "done"}

        class Runtime:
            async def cancel(self, session_id):
                self.session_id = session_id
                release.set()
                await asyncio.sleep(0)

        original_sessions = dict(server.sessions)
        original_runs = dict(server._active_runs)
        original_coordinator = server._agent_run_coordinator
        coordinator = AgentRunCoordinator()
        runtime = Runtime()
        residue = ROOT / "codex" / "运行残留"
        residue.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=residue) as temp:
            server.sessions.clear()
            server.sessions["A"] = {
                "id": "A", "mode": "agent", "name": "A", "workdir": str(ROOT),
                "messages": [], "created": 1.0, "updated": 1.0,
            }
            server._active_runs.clear()
            server._active_runs["A"] = {"kind": "agent", "runtime": runtime}
            server._agent_run_coordinator = coordinator
            record = coordinator.start("A", producer)
            try:
                with patch.object(server, "_agent_queue_store", AgentQueueStore(Path(temp) / "queue.json")):
                    result = await server.cancel_chat("A")
                self.assertTrue(result["cancelled"])
                await record.task
                snapshot = coordinator.snapshot("A")
                self.assertTrue(snapshot["cancel_requested"])
                self.assertEqual(snapshot["status"], "cancelled")
                self.assertFalse(snapshot["active"])
                self.assertIsNone(snapshot["pending_interaction"])
            finally:
                await coordinator.shutdown()
                server._agent_run_coordinator = original_coordinator
                server.sessions.clear(); server.sessions.update(original_sessions)
                server._active_runs.clear(); server._active_runs.update(original_runs)
                server._session_locks.pop("A", None)

    async def test_queue_accepts_coordinator_owned_run_before_cli_process_registration(self) -> None:
        release = asyncio.Event()

        async def producer():
            yield {"type": "assistant_start"}
            await release.wait()
            yield {"type": "done"}

        class Request:
            async def json(self):
                return {"message": "紧接着发送", "attachments": []}

        session = {
            "id": "A", "mode": "agent", "name": "A", "workdir": str(ROOT),
            "messages": [], "created": 1.0, "updated": 1.0, "pinned": False,
            "unread": False, "last_run_status": "", "summary": "",
        }
        original_sessions = dict(server.sessions)
        original_runs = dict(server._active_runs)
        original_coordinator = server._agent_run_coordinator
        residue = ROOT / "codex" / "运行残留"
        residue.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=residue) as temp:
            queue = AgentQueueStore(Path(temp) / "queue.json")
            coordinator = AgentRunCoordinator()
            server.sessions.clear(); server.sessions["A"] = session
            server._active_runs.clear()
            server._agent_run_coordinator = coordinator
            coordinator.start(
                "A", producer,
                metadata={"model": "deepseek-v4-pro[1m]", "permission_mode": "default"},
            )
            try:
                with (
                    patch.object(server, "_agent_queue_store", queue),
                    patch.object(server, "save_sessions_to_disk", lambda: None),
                ):
                    result = await server.enqueue_agent_message("A", Request())
                self.assertTrue(result["queued"])
                self.assertEqual(result["item"]["text"], "紧接着发送")
                self.assertEqual(result["item"]["model"], "deepseek-v4-pro[1m]")
                self.assertEqual(server._active_runs, {}, "CLI process table must not own queue admission")
            finally:
                release.set()
                await coordinator.shutdown()
                server._agent_run_coordinator = original_coordinator
                server.sessions.clear(); server.sessions.update(original_sessions)
                server._active_runs.clear(); server._active_runs.update(original_runs)

    async def test_post_disconnect_and_get_reconnect_share_one_production_run(self) -> None:
        release = asyncio.Event()
        producer_finished = asyncio.Event()

        class Request:
            async def json(self):
                return {
                    "message": "等待真实结构化问题",
                    "model": "deepseek-v4-pro[1m]",
                    "permission_mode": "default",
                    "attachments": [],
                }

        class FakeTransport:
            calls = 0

            async def stream(self, session_id, user_msg, *args, **kwargs):
                self.calls += 1
                server._active_runs[session_id] = {
                    "kind": "agent",
                    "pending_interaction": "question-A",
                    "model": "deepseek-v4-pro[1m]",
                    "permission_mode": "default",
                }
                try:
                    yield server.sse({"type": "assistant_start"})
                    yield server.sse({
                        "type": "interaction_request",
                        "kind": "question",
                        "session_id": session_id,
                        "request_id": "question-A",
                        "questions": [{"question": "继续吗？", "options": [{"label": "继续"}, {"label": "停止"}]}],
                        "allowed_actions": ["answer"],
                    })
                    await release.wait()
                    server.sessions[session_id]["last_run_status"] = "completed"
                    yield server.sse({"type": "text", "content": "同一 run 已继续"})
                    yield server.sse({"type": "done"})
                finally:
                    server._active_runs.pop(session_id, None)
                    producer_finished.set()

        def session():
            return {
                "id": "A",
                "mode": "agent",
                "name": "A",
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

        original_sessions = dict(server.sessions)
        original_runs = dict(server._active_runs)
        original_coordinator = server._agent_run_coordinator
        transport = FakeTransport()
        residue = ROOT / "codex" / "运行残留"
        residue.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=residue) as temp:
            server.sessions.clear(); server.sessions["A"] = session()
            server._active_runs.clear()
            server._session_locks.pop("A", None)
            server._agent_run_coordinator = AgentRunCoordinator(decode=server.sse_payloads)
            try:
                with (
                    patch.object(server, "AGENT_TRANSPORT", transport),
                    patch.object(server, "_agent_queue_store", AgentQueueStore(Path(temp) / "queue.json")),
                    patch.object(server, "save_sessions_to_disk", lambda: None),
                ):
                    response = await server.chat("A", Request())
                    first_stream = response.body_iterator
                    first = server.sse_payloads(await anext(first_stream))[0]
                    pending = server.sse_payloads(await anext(first_stream))[0]
                    self.assertEqual([first["type"], pending["type"]], ["assistant_start", "interaction_request"])
                    await first_stream.aclose()
                    await asyncio.sleep(0)
                    self.assertFalse(producer_finished.is_set())
                    self.assertEqual(transport.calls, 1)

                    live = await server.get_session("A")
                    self.assertEqual(live["runtime_state"], "waiting_input")
                    self.assertEqual(live["pending_interaction"]["request_id"], "question-A")
                    self.assertEqual(live["active_run"]["run_id"], first["run_id"])

                    resumed_response = await server.resume_agent_events(
                        "A",
                        run_id=first["run_id"],
                        after_sequence=first["sequence"],
                    )
                    resumed_stream = resumed_response.body_iterator
                    replayed = server.sse_payloads(await anext(resumed_stream))[0]
                    self.assertEqual(replayed["request_id"], "question-A")
                    self.assertEqual(replayed["run_id"], first["run_id"])
                    release.set()
                    tail = [replayed]
                    async for chunk in resumed_stream:
                        tail.extend(server.sse_payloads(chunk))
                    self.assertEqual([item["type"] for item in tail], ["interaction_request", "text", "done"])
                    self.assertEqual(transport.calls, 1, "reconnect must not spawn a second CLI run")
                    self.assertTrue(producer_finished.is_set())
                    terminal = server.coordinated_run_snapshot("A")
                    self.assertFalse(terminal["active"])
                    self.assertIsNone(terminal["pending_interaction"])
            finally:
                await server._agent_run_coordinator.shutdown()
                server._agent_run_coordinator = original_coordinator
                server.sessions.clear(); server.sessions.update(original_sessions)
                server._active_runs.clear(); server._active_runs.update(original_runs)
                server._session_locks.pop("A", None)


class RendererRecoveryContractTests(unittest.TestCase):
    def test_packaging_includes_run_coordinator(self) -> None:
        package = json.loads((ROOT / "desktop" / "package.json").read_text(encoding="utf-8"))
        self.assertIn("agent_run_coordinator.py", package["build"]["extraResources"][0]["filter"])
        builder = (ROOT / "scripts" / "build_installer_candidate.py").read_text(encoding="utf-8")
        self.assertIn('resources / "agent_run_coordinator.py"', builder)

    def test_latest_switch_wins_and_active_run_snapshot_restores_card(self) -> None:
        electron = ROOT / "desktop" / "node_modules" / "electron" / "dist" / "electron.exe"
        self.assertTrue(electron.exists(), "Electron test runtime is missing")
        result = subprocess.run(
            [str(electron), str(ROOT / "tests" / "v161_renderer_harness.js")],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertNotIn("__harnessError", payload, payload.get("__harnessError"))
        self.assertEqual(payload["afterB"], {"sessionId": "B", "mode": "agent"})
        self.assertEqual(
            payload["afterSlowA"],
            {"sessionId": "B", "mode": "agent", "cardSession": ""},
            "a stale A fetch must not overwrite the newer B selection",
        )
        self.assertEqual(payload["restored"], {
            "runId": "run-R",
            "serverSequence": 3,
            "status": "waiting_input",
            "thinkingHidden": True,
            "cardRequest": "permission-R",
            "cardSession": "R",
        })


if __name__ == "__main__":
    unittest.main()
