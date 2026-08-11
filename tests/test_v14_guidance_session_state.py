"""v14 same-run guidance and current-session runtime projection contracts."""

from __future__ import annotations

import asyncio
import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from tests._isolation import configure_server_data_root

configure_server_data_root()
import server
from agent_runtime import RuntimeCapabilities, RuntimeProbe, WslAgentRuntime


ROOT = Path(__file__).resolve().parents[1]


class InterleavingWriter:
    """A deterministic writer whose concurrent drains interleave without a lock."""

    def __init__(self) -> None:
        self._pending: dict[asyncio.Task, bytes] = {}
        self.output = bytearray()
        self.closed = False

    def write(self, data: bytes) -> None:
        task = asyncio.current_task()
        if task is None:
            raise RuntimeError("writer requires an asyncio task")
        self._pending[task] = bytes(data)

    async def drain(self) -> None:
        task = asyncio.current_task()
        data = self._pending.pop(task)
        for value in data:
            self.output.append(value)
            await asyncio.sleep(0)

    def is_closing(self) -> bool:
        return self.closed


class ActiveAgentInputChannelTests(unittest.IsolatedAsyncioTestCase):
    async def test_guidance_and_control_response_share_one_run_local_serial_writer(self) -> None:
        channel_type = getattr(server, "ActiveAgentInputChannel", None)
        self.assertIsNotNone(channel_type, "ActiveAgentInputChannel seam is missing")

        runs: dict[str, dict] = {}
        writer_a = InterleavingWriter()
        writer_b = InterleavingWriter()
        run_a = {
            "kind": "agent",
            "stdin": writer_a,
            "process_identity": "proc-a",
            "claude_session_id": "claude-a",
        }
        run_b = {
            "kind": "agent",
            "stdin": writer_b,
            "process_identity": "proc-b",
            "claude_session_id": "claude-b",
        }
        runs.update({"A": run_a, "B": run_b})
        channel = channel_type(lambda: runs)
        broker = server.AgentInteractionBroker(input_channel=channel)
        request = broker.create_request(
            "A",
            "proc-a",
            {
                "type": "control_request",
                "request_id": "permission-a",
                "request": {"subtype": "can_use_tool", "tool_name": "Bash", "input": {"command": "echo ok"}},
            },
            run=run_a,
        )
        self.assertEqual(request["request_id"], "permission-a")

        guidance_result, control_result = await asyncio.gather(
            channel.send_guidance("A", "请先检查测试"),
            broker.resolve(
                "A",
                "permission-a",
                "permission",
                "allow_once",
                run=run_a,
                process_identity="proc-a",
            ),
        )
        self.assertTrue(guidance_result["accepted"])
        self.assertTrue(control_result["ok"])
        lines = [json.loads(line) for line in writer_a.output.decode("utf-8").splitlines()]
        self.assertEqual(len(lines), 2)
        self.assertEqual({line["type"] for line in lines}, {"user", "control_response"})
        guidance = next(line for line in lines if line["type"] == "user")
        self.assertEqual(guidance["session_id"], "claude-a")
        self.assertEqual(guidance["message"]["content"][0]["text"], "请先检查测试")
        self.assertEqual(bytes(writer_b.output), b"")

    async def test_run_ending_while_guidance_waits_does_not_report_accepted(self) -> None:
        channel_type = getattr(server, "ActiveAgentInputChannel", None)
        error_type = getattr(server, "ActiveAgentInputError", RuntimeError)
        self.assertIsNotNone(channel_type, "ActiveAgentInputChannel seam is missing")
        writer = InterleavingWriter()
        run = {
            "kind": "agent",
            "stdin": writer,
            "process_identity": "proc-a",
            "claude_session_id": "claude-a",
            "input_lock": asyncio.Lock(),
        }
        runs = {"A": run}
        channel = channel_type(lambda: runs)
        await run["input_lock"].acquire()
        task = asyncio.create_task(channel.send_guidance("A", "来不及的修正"))
        await asyncio.sleep(0)
        runs.pop("A")
        run["input_lock"].release()
        with self.assertRaises(error_type):
            await task
        self.assertEqual(bytes(writer.output), b"")

    async def test_guidance_endpoint_accepts_only_active_agent_plain_text_and_persists_after_write(self) -> None:
        original_sessions = dict(server.sessions)
        original_runs = dict(server._active_runs)

        class Request:
            def __init__(self, body):
                self.body = body

            async def json(self):
                return self.body

        try:
            server.sessions.clear()
            server._active_runs.clear()
            server.sessions.update({
                "A": {"id": "A", "mode": "agent", "messages": [], "name": "A", "created": 1, "updated": 1},
                "chat": {"id": "chat", "mode": "chat", "messages": [], "name": "Chat", "created": 1, "updated": 1},
            })
            writer = InterleavingWriter()
            server._active_runs["A"] = {
                "kind": "agent",
                "stdin": writer,
                "process_identity": "proc-a",
                "claude_session_id": "claude-a",
            }
            with patch.object(server, "save_sessions_to_disk"):
                result = await server.guide_active_agent("A", Request({"message": "  修正当前步骤  "}))
                self.assertTrue(result["accepted"])
                self.assertEqual(server.sessions["A"]["messages"][-1], {
                    "role": "user", "content": "修正当前步骤", "guidance": True,
                })

                with self.assertRaises(server.HTTPException) as chat_error:
                    await server.guide_active_agent("chat", Request({"message": "越界"}))
                self.assertEqual(chat_error.exception.status_code, 409)

                with self.assertRaises(server.HTTPException) as field_error:
                    await server.guide_active_agent("A", Request({"message": "越界", "model": "other"}))
                self.assertEqual(field_error.exception.status_code, 400)

                with self.assertRaises(server.HTTPException) as legacy_error:
                    await server.chat("A", Request({"message": "不得新开 run", "guidance": True}))
                self.assertEqual(legacy_error.exception.status_code, 400)

                server._active_runs.pop("A")
                before = list(server.sessions["A"]["messages"])
                with self.assertRaises(server.HTTPException) as ended_error:
                    await server.guide_active_agent("A", Request({"message": "任务已结束"}))
                self.assertEqual(ended_error.exception.status_code, 409)
                self.assertEqual(server.sessions["A"]["messages"], before)
        finally:
            server.sessions.clear()
            server.sessions.update(original_sessions)
            server._active_runs.clear()
            server._active_runs.update(original_runs)


class WslGuidanceIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_guidance_reaches_the_same_real_wsl_process_without_a_second_spawn(self) -> None:
        fixture_script = (
            "IFS= read -r first\n"
            "printf '%s\\n' '{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"fixture-start\"}]}}'\n"
            "IFS= read -r guidance\n"
            "case \"$guidance\" in *\"同进程修正\"*) reply=fixture-guidance ;; *) reply=wrong-guidance ;; esac\n"
            "printf '{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"%s\"}]}}\\n' \"$reply\"\n"
            "printf '%s\\n' '{\"type\":\"result\",\"result\":\"fixture-done\"}'\n"
        )

        class FixtureWslRuntime(WslAgentRuntime):
            def __init__(self) -> None:
                super().__init__()
                self.spawn_count = 0

            def probe(self) -> RuntimeProbe:
                return RuntimeProbe(
                    status="ready",
                    detail="v14 offline WSL fixture",
                    version="fixture",
                    capabilities=RuntimeCapabilities(
                        stream_json=True,
                        structured_input=True,
                        structured_interactions=True,
                        native_cli=True,
                        platform="wsl2",
                    ),
                )

            async def cleanup_stale(self, _spec) -> bool:
                return False

            def build_command(self, spec) -> list[str]:
                return [
                    "wsl.exe", "--distribution", self.distro, "--user", self.user,
                    "--cd", self.map_path(spec.workdir), "--exec", "sh", "-lc", fixture_script,
                ]

            async def spawn_session(self, spec):
                self.spawn_count += 1
                return await super().spawn_session(spec)

            def inspect_session_identity(self, _session_key):
                # This legacy fixture deliberately bypasses the managed
                # session helper and therefore has no recoverable pidfile.
                return None

        class Request:
            async def json(self):
                return {"message": "同进程修正"}

        runtime = FixtureWslRuntime()
        original_sessions = dict(server.sessions)
        original_runs = dict(server._active_runs)
        server.sessions.clear()
        server._active_runs.clear()
        server.sessions["wsl-A"] = {
            "id": "wsl-A", "mode": "agent", "messages": [], "created": 1, "updated": 1,
            "name": "WSL A", "workdir": str(ROOT), "pinned": False, "unread": False,
            "claude_initialized": False, "summary": "",
        }
        cfg = {"model": "fake-model", "api_key": "offline-fixture", "base_url": "http://unused", "label": "fixture"}
        events: list[dict] = []

        async def consume() -> None:
            async for chunk in server.stream_chat("wsl-A", "初始任务", model="fake-model", permission_mode="default"):
                events.extend(json.loads(line[6:]) for line in chunk.splitlines() if line.startswith("data: "))

        try:
            with (
                patch.object(server, "deepseek_config", return_value=cfg),
                patch.object(server, "_agent_runtime", runtime),
                patch.object(server, "save_sessions_to_disk"),
                patch.object(server, "prepare_agent_system_prompt", return_value=ROOT / "tests" / "unused-agent-prompt.md"),
                patch.object(server, "cleanup_agent_system_prompt"),
                patch.object(server, "snapshot_watch_files", return_value={}),
                patch.object(server, "changed_watch_files", return_value=[]),
            ):
                task = asyncio.create_task(consume())
                for _ in range(120):
                    if server._active_runs.get("wsl-A"):
                        break
                    await asyncio.sleep(0.025)
                run = server._active_runs.get("wsl-A")
                self.assertIsNotNone(run, "real WSL fixture process did not register")
                pid = run["pid"]
                identity = run["process_identity"]
                claude_session_id = run["claude_session_id"]
                response = await server.guide_active_agent("wsl-A", Request())
                self.assertTrue(response["accepted"])
                self.assertEqual(server._active_runs["wsl-A"]["pid"], pid)
                self.assertEqual(server._active_runs["wsl-A"]["process_identity"], identity)
                self.assertEqual(server._active_runs["wsl-A"]["claude_session_id"], claude_session_id)
                await asyncio.wait_for(task, timeout=10)

            text_events = [str(event.get("content") or "").strip() for event in events if event.get("type") == "text"]
            self.assertIn("fixture-start", text_events)
            self.assertIn("fixture-guidance", text_events)
            self.assertEqual(runtime.spawn_count, 1)
            self.assertNotIn("wsl-A", server._active_runs)
            self.assertIn(
                {"role": "user", "content": "同进程修正", "guidance": True},
                server.sessions["wsl-A"]["messages"],
                "the run finalizer must not erase the accepted guidance marker",
            )
        finally:
            live = server._active_runs.get("wsl-A", {}).get("runtime_process")
            process = getattr(live, "process", None)
            if process is not None and process.returncode is None:
                process.terminate()
                await process.wait()
            server._session_locks.pop("wsl-A", None)
            server.sessions.clear()
            server.sessions.update(original_sessions)
            server._active_runs.clear()
            server._active_runs.update(original_runs)


class RendererProjectionTests(unittest.TestCase):
    def test_real_electron_projects_only_current_session_and_ctrl_enter_guides(self) -> None:
        electron = ROOT / "desktop" / "node_modules" / "electron" / "dist" / "electron.exe"
        self.assertTrue(electron.exists(), "Electron test runtime is missing")
        result = subprocess.run(
            [str(electron), str(ROOT / "tests" / "v14_renderer_harness.js")],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertNotIn("__harnessError", payload, payload.get("__harnessError"))
        self.assertEqual(
            payload["projection"],
            {
                "thinkingHidden": True,
                "stopHidden": True,
                "inputDisabled": False,
                "sendDisabled": False,
                "hint": "Enter 发送 · Shift+Enter 换行",
                "placeholder": "输入任务，或使用 / 命令",
            },
        )
        self.assertTrue(payload["activeEnter"]["runActive"])
        self.assertEqual(payload["activeEnter"]["calls"], [])
        self.assertEqual(len(payload["activeEnter"]["allCalls"]), 1)
        call = payload["activeEnter"]["allCalls"][0]
        self.assertTrue(call["url"].endswith("/api/chat/A/queue"))
        self.assertEqual(call["body"], {"message": "请改用更简洁的方案", "attachments": []})
        self.assertEqual(payload["activeEnter"]["inputValue"], "")
        self.assertEqual(len(payload["activeCtrlEnter"]["calls"]), 1)
        self.assertTrue(payload["activeCtrlEnter"]["calls"][0]["url"].endswith("/api/chat/A/guidance"))
        self.assertEqual(payload["activeCtrlEnter"]["calls"][0]["body"], {"message": "请立即修正当前步骤"})
        self.assertEqual(payload["activeCtrlEnter"]["inputValue"], "")
        self.assertEqual(payload["bRunning"], {
            "thinkingHidden": False,
            "stopHidden": False,
            "inputDisabled": False,
            "hint": "Enter 排队 · Ctrl+Enter 引导 · Shift+Enter 换行",
            "placeholder": "输入后按 Enter 排队，Ctrl+Enter 引导当前任务",
        })
        self.assertTrue(payload["backgroundUnchanged"])
        self.assertEqual(payload["stopB"], {
            "aActive": True,
            "bActive": False,
            "stopHidden": True,
            "inputDisabled": False,
        })
        self.assertEqual(len(payload["rejectedEnter"]["calls"]), 1)
        self.assertTrue(payload["rejectedEnter"]["calls"][0]["url"].endswith("/api/chat/A/queue"))
        self.assertEqual(payload["rejectedEnter"]["inputValue"], "失败后必须保留")
        self.assertFalse(payload["rejectedEnter"]["inputDisabled"])
        overlap = payload["overlapGuidance"]
        self.assertEqual(overlap["aStarted"], {"pending": True, "sendDisabled": True, "calls": 1})
        self.assertEqual(overlap["bBeforeSubmit"], {
            "pending": False,
            "sendDisabled": False,
            "guidanceDataset": None,
        })
        self.assertEqual(len(overlap["bothPending"]["calls"]), 2)
        self.assertTrue(overlap["bothPending"]["calls"][0]["url"].endswith("/api/chat/A/guidance"))
        self.assertTrue(overlap["bothPending"]["calls"][1]["url"].endswith("/api/chat/B/guidance"))
        self.assertEqual(overlap["bothPending"]["calls"][0]["body"], {"message": "A 的运行中修正"})
        self.assertEqual(overlap["bothPending"]["calls"][1]["body"], {"message": "B 的独立运行中修正"})
        self.assertTrue(overlap["bothPending"]["aPending"])
        self.assertTrue(overlap["bothPending"]["bPending"])
        self.assertTrue(overlap["bothPending"]["sendDisabled"])
        self.assertEqual(overlap["aWhileBothPending"], {
            "pending": True,
            "sendDisabled": True,
            "inputValue": "A pending 时的新草稿",
        })
        self.assertEqual(overlap["afterBResolvesOnA"], {
            "aPending": True,
            "bPending": False,
            "sendDisabled": True,
            "inputValue": "A pending 时的新草稿",
        })
        self.assertEqual(overlap["afterAResolvesOnB"], {
            "aPending": False,
            "bPending": False,
            "sendDisabled": False,
            "inputValue": "B 完成后的新草稿",
        })
        self.assertEqual(overlap["finalA"], {"pending": False, "sendDisabled": False})
        self.assertEqual(overlap["beforeStaleFinally"], {
            "distinctRun": True,
            "replacementPending": True,
            "sendDisabled": True,
        })
        self.assertEqual(overlap["afterStaleFinally"], {
            "replacementIsCurrent": True,
            "replacementPending": True,
            "sendDisabled": True,
        })
        self.assertEqual(payload["shiftEnter"]["calls"], 0)
        self.assertIn("\n", payload["shiftEnter"]["value"])


if __name__ == "__main__":
    unittest.main()
