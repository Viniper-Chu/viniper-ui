"""Offline Application Port envelope tests; no provider or desktop process."""

import asyncio
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "resources" / "viniper-ui"))
import harness_application_port as port_module


def event(sid, event_type, payload=None):
    return {
        "type": "runtime.event", "native_session_id": sid,
        "event": {"type": event_type, "sessionId": "harness-" + sid, "engineId": "viniper", "payload": payload or {}},
    }


def completed(sid):
    return {"type": "runtime.completed", "native_session_id": sid, "status": "run.completed"}


class FixturePort(port_module.HarnessApplicationPort):
    def __init__(self, scripts):
        super().__init__()
        self._bridge_process = SimpleNamespace(returncode=None)
        self.scripts = scripts
        self.producers = []
        self.cancelled = []
        self.terminated = 0
        self.heartbeats = 0
        self.pending = {}
        self.heartbeat_failed = False

    async def _ensure_bridge(self):
        pass

    async def _send(self, message):
        sid = message["native_session_id"]
        if message["op"] == "cancel":
            self.cancelled.append(sid)
            stopped = self._run_stopped.get(sid)
            if stopped is not None and not stopped.done():
                stopped.set_result(completed(sid))
            return
        if message["op"] != "run":
            raise AssertionError("unexpected control write")

        async def produce():
            for delay, envelope in self.scripts.get(sid, []):
                await asyncio.sleep(delay)
                raw = envelope.get("event", {})
                if raw.get("type") == "interaction.requested":
                    self.pending[sid] = raw["payload"]["callId"]
                elif raw.get("type") == "interaction.resolved":
                    self.pending.pop(sid, None)
                queue = self._run_queues.get(sid)
                if queue is not None:
                    await queue.put(envelope)

        self.producers.append(asyncio.create_task(produce()))

    async def control(self, operation, **payload):
        self.assert_operation(operation)
        self.heartbeats += 1
        if self.heartbeat_failed:
            raise asyncio.TimeoutError("fixture heartbeat unavailable")
        return {"pending": [{"sessionId": "harness-" + sid, "callId": call} for sid, call in self.pending.items()]}

    @staticmethod
    def assert_operation(operation):
        if operation != "permissions.snapshot":
            raise AssertionError("heartbeat must use a read-only capability")

    async def _terminate_bridge(self):
        self.terminated += 1

    async def close_fixture(self):
        for task in self.producers:
            task.cancel()
        await asyncio.gather(*self.producers, return_exceptions=True)

    async def collect(self, sid):
        return [item async for item in self.stream(session_id=sid, prompt="fixture", model="demo-default", workdir=".", provider_id="demo")]


class IdleDeadlineTests(unittest.IsolatedAsyncioTestCase):
    async def test_local_image_stream_has_bounded_prefill_and_real_output_activity(self):
        sid = "image-stream"
        port = FixturePort({sid: [
            (0, event(sid, "tool.requested", {"toolName": "file.image.analyze", "callId": "image-1"})),
            (0, event(sid, "provider.request.started", {"phase": "local-image", "timeoutSeconds": 0.4, "inputCount": 2048})),
            (0.22, event(sid, "provider.activity", {"phase": "image-output", "receivedCharacters": 12})),
            (0.08, event(sid, "provider.activity", {"phase": "image-output", "receivedCharacters": 40})),
            (0.08, completed(sid)),
        ]})
        try:
            with patch.object(port_module, "_terminal_timeout_seconds", return_value=0.15):
                result = await port.collect(sid)
            self.assertEqual(result[-1]["type"], "runtime.completed")
            statuses = [x["event"].get("content", "") for x in result if x["type"] == "provider.event"]
            self.assertIn("正在读取图片，等待模型输出…", statuses)
            self.assertIn("正在检查图片 · 已生成 40 字符", statuses)
            self.assertEqual(port.cancelled, [])
        finally:
            await port.close_fixture()

    async def test_local_image_without_first_output_still_expires(self):
        sid = "image-stall"
        port = FixturePort({sid: [(0, event(sid, "provider.request.started", {"phase": "local-image", "timeoutSeconds": 0.2}))]})
        try:
            with patch.object(port_module, "_terminal_timeout_seconds", return_value=0.1):
                with self.assertRaises(port_module.HarnessTerminalTimeoutError):
                    await port.collect(sid)
            self.assertEqual(port.cancelled, [sid])
        finally:
            await port.close_fixture()

    async def test_image_cancel_does_not_wait_for_first_output(self):
        sid = "cancel-image"
        port = FixturePort({sid: [(0, event(sid, "provider.request.started", {"phase": "local-image", "timeoutSeconds": 300}))]})
        try:
            task = asyncio.create_task(port.collect(sid))
            await asyncio.sleep(0.03)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await asyncio.wait_for(task, timeout=0.3)
            self.assertEqual(port.cancelled, [sid])
        finally:
            await port.close_fixture()

    async def test_local_prefill_has_its_own_bound_on_each_tool_continuation(self):
        sid = "prefill"
        start = event(sid, "provider.request.started", {"phase": "local-prefill", "timeoutSeconds": 0.45, "inputCount": 12000})
        port = FixturePort({sid: [
            (0, start), (0.25, event(sid, "thinking.delta", {"text": "ready"})),
            (0.01, event(sid, "tool.requested", {"toolName": "file.read", "callId": "read-1"})),
            (0.01, start), (0.25, event(sid, "message.delta", {"text": "done"})), (0, completed(sid)),
        ]})
        try:
            with patch.object(port_module, "_terminal_timeout_seconds", return_value=0.15):
                result = await port.collect(sid)
            statuses = [x["event"].get("content", "") for x in result if x["type"] == "provider.event"]
            self.assertEqual(sum("等待首个输出" in item for item in statuses), 2)
            self.assertEqual(result[-1]["type"], "runtime.completed")
            self.assertEqual(port.cancelled, [])
        finally:
            await port.close_fixture()

    async def test_first_delta_restores_the_normal_stall_deadline(self):
        sid = "after-prefill"
        port = FixturePort({sid: [(0, event(sid, "provider.request.started", {"phase": "local-prefill", "timeoutSeconds": 0.5})),
                                  (0.02, event(sid, "message.delta", {"text": "first"}))]})
        try:
            with patch.object(port_module, "_terminal_timeout_seconds", return_value=0.15):
                with self.assertRaises(port_module.HarnessTerminalTimeoutError) as raised:
                    await port.collect(sid)
            self.assertFalse(raised.exception.first_response)
            self.assertEqual(raised.exception.timeout_seconds, 0.15)
            self.assertEqual(port.cancelled, [sid])
        finally:
            await port.close_fixture()

    async def test_prefill_deadline_is_finite_and_metadata_does_not_extend_it(self):
        sid = "no-first-token"
        port = FixturePort({sid: [(0, event(sid, "provider.request.started", {"phase": "local-prefill", "timeoutSeconds": 0.2}))]
                            + [(0.04, event(sid, "context.budget", {"inputCount": 12000})) for _ in range(8)]})
        try:
            with patch.object(port_module, "_terminal_timeout_seconds", return_value=0.1):
                with self.assertRaises(port_module.HarnessTerminalTimeoutError) as raised:
                    await port.collect(sid)
            self.assertTrue(raised.exception.first_response)
            self.assertEqual(raised.exception.timeout_seconds, 0.2)
            self.assertEqual(port.cancelled, [sid])
        finally:
            await port.close_fixture()

    async def test_user_cancel_does_not_wait_for_the_prefill_deadline(self):
        sid = "cancel-prefill"
        port = FixturePort({sid: [(0, event(sid, "provider.request.started", {"phase": "local-prefill", "timeoutSeconds": 300}))]})
        try:
            task = asyncio.create_task(port.collect(sid))
            await asyncio.sleep(0.03)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await asyncio.wait_for(task, timeout=0.3)
            self.assertEqual(port.cancelled, [sid])
        finally:
            await port.close_fixture()

    async def test_real_tool_input_progress_keeps_run_alive_and_projects_visible_status(self):
        port = FixturePort({"long-tool": [(0.04, event("long-tool", "provider.activity", {"phase": "tool-input", "receivedCharacters": n * 100})) for n in range(1, 9)] + [(0, completed("long-tool"))]})
        try:
            with patch.object(port_module, "_terminal_timeout_seconds", return_value=0.20):
                result = await port.collect("long-tool")
            self.assertEqual(result[-1]["type"], "runtime.completed")
            statuses = [x["event"] for x in result if x["type"] == "provider.event"]
            self.assertEqual(statuses[-1], {"type": "working_status", "content": "正在准备操作内容 · 已接收 800 字符"})
            self.assertEqual(port.cancelled, [])
        finally:
            await port.close_fixture()

    async def test_a_stream_that_stops_sending_tool_fragments_still_times_out(self):
        port = FixturePort({"stalled-tool": [(0, event("stalled-tool", "provider.activity", {"phase": "tool-input", "receivedCharacters": 42}))]})
        try:
            with patch.object(port_module, "_terminal_timeout_seconds", return_value=0.15):
                with self.assertRaises(port_module.HarnessTerminalTimeoutError):
                    await port.collect("stalled-tool")
            self.assertEqual(port.cancelled, ["stalled-tool"])
        finally:
            await port.close_fixture()

    async def test_stopped_tool_result_is_cancelled_instead_of_failed(self):
        source = {"runId": "run-1", "payload": {"toolName": "terminal.run", "callId": "call-1", "result": "Stopped"}}
        self.assertEqual(port_module._runtime_event_to_provider_event({**source, "type": "tool.cancelled"})["status"], "cancelled")
        self.assertEqual(port_module._runtime_event_to_provider_event({**source, "type": "tool.failed"})["status"], "error")

    async def test_active_stream_can_outlive_one_idle_interval(self):
        port = FixturePort({"long": [(0.04, event("long", "message.delta", {"text": "next"})) for _ in range(8)] + [(0, completed("long"))]})
        try:
            with patch.object(port_module, "_terminal_timeout_seconds", return_value=0.20):
                result = await port.collect("long")
            self.assertEqual(result[-1]["type"], "runtime.completed")
            self.assertEqual(port.cancelled, [])
            self.assertEqual(port.terminated, 0)
        finally:
            await port.close_fixture()

    async def test_pending_permission_uses_heartbeat_instead_of_a_user_deadline(self):
        port = FixturePort({"manual": [
            (0, event("manual", "interaction.requested", {"title": "等待工具权限", "callId": "write-1", "status": "waiting"})),
            (0.70, event("manual", "interaction.resolved", {"callId": "write-1", "decision": "allow-once"})),
            (0.01, completed("manual")),
        ]})
        try:
            with patch.object(port_module, "_terminal_timeout_seconds", return_value=0.20):
                result = await port.collect("manual")
            self.assertEqual(result[-1]["type"], "runtime.completed")
            self.assertGreaterEqual(port.heartbeats, 1)
            self.assertEqual(port.cancelled, [])
            self.assertEqual(port.terminated, 0)
        finally:
            await port.close_fixture()

    async def test_one_stalled_session_never_terminates_the_shared_bridge(self):
        port = FixturePort({"healthy": [(0.04, event("healthy", "message.delta", {"text": "active"})) for _ in range(8)] + [(0, completed("healthy"))]})
        try:
            with patch.object(port_module, "_terminal_timeout_seconds", return_value=0.15):
                stalled, healthy = await asyncio.gather(port.collect("stalled"), port.collect("healthy"), return_exceptions=True)
            self.assertIsInstance(stalled, port_module.HarnessTerminalTimeoutError)
            self.assertIsInstance(healthy, list)
            self.assertEqual(healthy[-1]["type"], "runtime.completed")
            self.assertEqual(port.cancelled, ["stalled"])
            self.assertEqual(port.terminated, 0)
        finally:
            await port.close_fixture()

    async def test_a_dead_permission_heartbeat_still_ends_the_owned_run(self):
        port = FixturePort({"manual": [(0, event("manual", "interaction.requested", {"title": "等待工具权限", "callId": "write-2", "status": "waiting"}))]})
        port.heartbeat_failed = True
        try:
            with patch.object(port_module, "_terminal_timeout_seconds", return_value=0.15):
                with self.assertRaises(port_module.HarnessTerminalTimeoutError):
                    await port.collect("manual")
            self.assertEqual(port.heartbeats, 1)
            self.assertEqual(port.cancelled, ["manual"])
            self.assertEqual(port.terminated, 0)
        finally:
            await port.close_fixture()

    async def test_question_wait_is_suspended_until_the_user_answers(self):
        port = FixturePort({"question": [
            (0, event("question", "interaction.requested", {"id": "question-1", "callId": "question-1", "kind": "questions", "toolName": "request_user_input", "questions": [{"question": "Which directory?"}]})),
            (0.65, event("question", "interaction.resolved", {"activityId": "question-1", "decision": "answer"})),
            (0.01, completed("question")),
        ]})
        try:
            with patch.object(port_module, "_terminal_timeout_seconds", return_value=0.20):
                result = await port.collect("question")
            self.assertEqual(result[-1]["type"], "runtime.completed")
            self.assertGreaterEqual(port.heartbeats, 1)
            self.assertEqual(port.cancelled, [])
            self.assertEqual(port.terminated, 0)
        finally:
            await port.close_fixture()

    async def test_broken_cancel_channel_does_not_kill_other_sessions(self):
        port = FixturePort({})

        async def broken_send(message):
            raise BrokenPipeError("fixture closing channel")

        port._send = broken_send
        await port._cancel_owned_process(port._bridge_process, "only-this-session")
        self.assertEqual(port.terminated, 0)

    async def test_resource_locks_do_not_masquerade_as_user_questions(self):
        pending = {}
        port_module._track_pending_user_input(pending, event("locked", "interaction.requested", {
            "id": "resource-1", "title": "等待项目资源", "kind": "interaction", "status": "waiting", "toolName": "project.write", "callId": "write-1",
        })["event"])
        self.assertEqual(pending, {})


if __name__ == "__main__":
    unittest.main(verbosity=2)
