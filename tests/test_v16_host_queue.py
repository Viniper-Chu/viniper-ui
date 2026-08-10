"""v16 red/green contracts for official host hooks and queued Agent input."""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import server
from agent_host_bridge import HostInteractionChannel
from agent_run_coordinator import AgentRunCoordinator
from agent_runtime import AgentRunSpec, WslAgentRuntime
from agent_runtime import RuntimeCapabilities, RuntimeProbe


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures" / "v16"
V162_FIXTURES = ROOT / "tests" / "fixtures" / "v162"


class OfficialHookContractTests(unittest.TestCase):
    def setUp(self) -> None:
        from agent_host_bridge import build_hook_response, build_hook_settings, normalize_hook_request

        self.build_hook_response = build_hook_response
        self.build_hook_settings = build_hook_settings
        self.normalize_hook_request = normalize_hook_request

    def fixture(self, name: str) -> dict:
        return json.loads((FIXTURES / name).read_text(encoding="utf-8"))

    def test_pretooluse_question_preserves_original_input_and_builds_official_answer(self) -> None:
        raw = self.fixture("pretooluse-askuserquestion.json")
        request = self.normalize_hook_request(raw, bridge_request_id="bridge-question")

        self.assertEqual(request["kind"], "question")
        self.assertEqual(request["request_id"], "toolu_v16_ask_fixture")
        self.assertEqual(request["questions"], raw["tool_input"]["questions"])
        self.assertNotIn("transcript_path", request["display_payload"])

        response = self.build_hook_response(
            request,
            "answer",
            answers={
                "选择实现路径？": "方案二",
                "选择验证项？": ["单元测试", "界面测试"],
            },
        )
        output = response["hookSpecificOutput"]
        self.assertEqual(output["hookEventName"], "PreToolUse")
        self.assertEqual(output["permissionDecision"], "allow")
        self.assertEqual(output["updatedInput"]["questions"], raw["tool_input"]["questions"])
        self.assertEqual(output["updatedInput"]["answers"]["选择实现路径？"], "方案二")
        self.assertEqual(output["updatedInput"]["answers"]["选择验证项？"], "单元测试, 界面测试")

    def test_permission_requests_expose_safe_fields_and_echo_only_real_suggestions(self) -> None:
        write_raw = self.fixture("permissionrequest-write.json")
        write = self.normalize_hook_request(write_raw, bridge_request_id="bridge-write")
        self.assertEqual(write["kind"], "permission")
        self.assertEqual(write["request_id"], "bridge-write")
        self.assertEqual(write["display_payload"]["file_path"], write_raw["tool_input"]["file_path"])
        self.assertNotIn("content", write["display_payload"])
        self.assertEqual(write["allowed_actions"], ["deny", "allow_once", "allow_always"])

        once = self.build_hook_response(write, "allow_once")
        once_decision = once["hookSpecificOutput"]["decision"]
        self.assertEqual(once_decision, {"behavior": "allow"})

        always = self.build_hook_response(write, "allow_always")
        always_decision = always["hookSpecificOutput"]["decision"]
        self.assertEqual(always_decision["behavior"], "allow")
        self.assertEqual(always_decision["updatedPermissions"], write_raw["permission_suggestions"])

        bash_raw = self.fixture("permissionrequest-bash.json")
        bash = self.normalize_hook_request(bash_raw, bridge_request_id="bridge-bash")
        self.assertEqual(bash["display_payload"]["command"], "printf fixture-ok")
        self.assertEqual(bash["allowed_actions"], ["deny", "allow_once"])
        denied = self.build_hook_response(bash, "deny")
        self.assertEqual(denied["hookSpecificOutput"]["decision"]["behavior"], "deny")

    def test_settings_intercept_only_questions_pretool_and_real_permission_requests(self) -> None:
        settings = self.build_hook_settings(
            script_path="/mnt/d/Viniper/agent_host_bridge.py",
            channel_path="/mnt/c/viniper/run-private-channel",
        )
        hooks = settings["hooks"]
        self.assertEqual([item["matcher"] for item in hooks["PreToolUse"]], ["AskUserQuestion"])
        self.assertEqual([item["matcher"] for item in hooks["PermissionRequest"]], ["*"])
        self.assertNotIn("PostToolUse", hooks)

    def test_runtime_injects_settings_and_package_contains_both_v16_modules(self) -> None:
        runtime = WslAgentRuntime()
        spec = AgentRunSpec(
            session_id="A",
            claude_session_id="00000000-0000-4000-8000-000000000016",
            session_name="fixture-a",
            workdir=str(ROOT),
            model="fixture-model",
            permission_mode="default",
            resume=False,
            settings_file=str(ROOT / "codex" / "运行残留" / "hook-settings.json"),
        )
        command = runtime.build_command(spec)
        settings_index = command.index("--settings")
        self.assertTrue(command[settings_index + 1].endswith("/codex/运行残留/hook-settings.json"))
        self.assertNotIn("--permission-prompt-tool", command)
        self.assertNotIn("stdio", command)
        self.assertIn("--include-hook-events", command)
        package = json.loads((ROOT / "desktop" / "package.json").read_text(encoding="utf-8"))
        filters = package["build"]["extraResources"][0]["filter"]
        self.assertIn("agent_host_bridge.py", filters)
        self.assertIn("agent_queue.py", filters)


class WslHostBridgeIntegrationTests(unittest.TestCase):
    @staticmethod
    def _wait_request(channel: HostInteractionChannel, timeout: float = 5) -> dict:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            pending = channel.pending()
            if pending:
                return pending[0]
            time.sleep(0.03)
        raise AssertionError("WSL hook client did not publish a request")

    @staticmethod
    def _start_hook(channel_path: Path, fixture: Path, timeout: int = 10) -> subprocess.Popen:
        runtime = WslAgentRuntime()
        script = runtime.map_path(ROOT / "agent_host_bridge.py")
        channel = runtime.map_path(channel_path)
        process = subprocess.Popen(
            ["wsl.exe", "-d", "ViniperRuntime", "--", "python3", script,
             "--hook-client", "--channel", channel, "--timeout", str(timeout)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        assert process.stdin is not None
        process.stdin.write(fixture.read_bytes())
        process.stdin.close()
        return process

    @staticmethod
    def _output(process: subprocess.Popen, timeout: int = 8) -> dict:
        process.wait(timeout=timeout)
        assert process.stdout is not None
        raw = process.stdout.read()
        process.stdout.close()
        if process.stderr is not None:
            process.stderr.read()
            process.stderr.close()
        return json.loads(raw.decode("utf-8"))

    def test_two_wsl_hook_clients_pause_resume_independently_through_production_broker(self) -> None:
        residue = ROOT / "codex" / "运行残留"
        residue.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=residue) as temp:
            root = Path(temp)
            channel_a = HostInteractionChannel(root / "A")
            channel_b = HostInteractionChannel(root / "B")
            process_a = self._start_hook(channel_a.root, FIXTURES / "pretooluse-askuserquestion.json")
            process_b = self._start_hook(channel_b.root, FIXTURES / "permissionrequest-write.json")
            try:
                request_a = self._wait_request(channel_a)
                request_b = self._wait_request(channel_b)
                broker = server.AgentInteractionBroker()
                card_a = broker.create_host_request("A", f"wsl-fixture:{process_a.pid}", request_a, channel_a)
                card_b = broker.create_host_request("B", f"wsl-fixture:{process_b.pid}", request_b, channel_b)
                self.assertEqual(card_a["kind"], "question")
                self.assertEqual(card_b["display"]["file_path"], "/tmp/viniper-v16-fixture/allowed-output.txt")
                self.assertNotIn("content", card_b["display"])

                asyncio.run(broker.resolve(
                    "B", card_b["request_id"], "permission", "allow_once",
                    process_identity=f"wsl-fixture:{process_b.pid}",
                ))
                output_b = self._output(process_b)
                self.assertEqual(output_b["hookSpecificOutput"]["decision"], {"behavior": "allow"})
                self.assertIsNotNone(broker.pending_for("A"), "A must remain paused while B continues")

                asyncio.run(broker.resolve(
                    "A", card_a["request_id"], "question", "answer",
                    process_identity=f"wsl-fixture:{process_a.pid}",
                    answers={"选择实现路径？": "方案一", "选择验证项？": ["单元测试", "界面测试"]},
                ))
                output_a = self._output(process_a)
                updated = output_a["hookSpecificOutput"]["updatedInput"]
                self.assertEqual(updated["questions"], request_a["questions"])
                self.assertEqual(updated["answers"]["选择验证项？"], "单元测试, 界面测试")
            finally:
                for process in (process_a, process_b):
                    if process.poll() is None:
                        process.terminate()
                        process.wait(timeout=5)
                    if process.stdout is not None and not process.stdout.closed:
                        process.stdout.close()
                    if process.stderr is not None and not process.stderr.closed:
                        process.stderr.close()

    def test_cancelled_and_timed_out_hooks_fail_closed_without_provider(self) -> None:
        residue = ROOT / "codex" / "运行残留"
        residue.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=residue) as temp:
            root = Path(temp)
            cancelled_channel = HostInteractionChannel(root / "cancelled")
            cancelled = self._start_hook(cancelled_channel.root, FIXTURES / "permissionrequest-bash.json")
            self._wait_request(cancelled_channel)
            cancelled_channel.cancel_all("fixture-stop")
            cancelled_output = self._output(cancelled)
            self.assertEqual(cancelled_output["hookSpecificOutput"]["decision"]["behavior"], "deny")

            timeout_channel = HostInteractionChannel(root / "timeout")
            timed_out = self._start_hook(timeout_channel.root, FIXTURES / "pretooluse-askuserquestion.json", timeout=1)
            self._wait_request(timeout_channel)
            timeout_output = self._output(timed_out, timeout=5)
            self.assertEqual(timeout_output["hookSpecificOutput"]["permissionDecision"], "deny")


class WslFakeClaudeRunTests(unittest.IsolatedAsyncioTestCase):
    async def test_two_real_wsl_processes_execute_settings_hooks_and_resume_same_runs(self) -> None:
        class UsageLedger:
            def record_event(self, *_args, **_kwargs):
                return None

        class ContextLedger:
            def update_from_event(self, *_args, **_kwargs):
                return None

        def agent_session(session_id: str) -> dict:
            return {
                "id": session_id,
                "mode": "agent",
                "messages": [],
                "created": 1,
                "updated": 1,
                "name": session_id,
                "workdir": str(ROOT),
                "pinned": False,
                "unread": False,
                "claude_session_id": "00000000-0000-4000-8000-0000000000" + ("0a" if session_id == "A" else "0b"),
                "claude_initialized": False,
                "summary": "",
            }

        residue = ROOT / "codex" / "运行残留"
        residue.mkdir(parents=True, exist_ok=True)
        fake_launcher = V162_FIXTURES / "fake-bin" / "claude"

        class FixtureRuntime(WslAgentRuntime):
            def build_command(self, spec):
                command = super().build_command(spec)
                command[command.index("claude")] = self.map_path(fake_launcher)
                return command

        runtime = FixtureRuntime()
        ready = RuntimeProbe(
            status="ready",
            version="2.1.226 (Claude Code)",
            user="viniper",
            capabilities=RuntimeCapabilities(
                stream_json=True,
                structured_input=True,
                structured_interactions=True,
                usage=True,
                native_cli=True,
                platform="wsl2",
            ),
        )
        cfg = {"model": "fake-model", "api_key": "fixture", "base_url": "http://fixture", "label": "fixture"}
        original_sessions = dict(server.sessions)
        original_runs = dict(server._active_runs)
        with tempfile.TemporaryDirectory(dir=residue) as temp:
            temp_root = Path(temp)
            server.sessions.clear()
            server.sessions.update({"A": agent_session("A"), "B": agent_session("B")})
            server._active_runs.clear()
            server._session_locks.pop("A", None)
            server._session_locks.pop("B", None)
            with (
                patch.object(server, "DATA_DIR", temp_root),
                patch.object(server, "deepseek_config", return_value=cfg),
                patch.object(server, "build_claude_env", return_value={}),
                patch.object(server, "runtime_bridge_keys", return_value=()),
                patch.object(server, "read_agent_instructions", return_value=""),
                patch.object(server, "save_sessions_to_disk"),
                patch.object(server, "daily_usage_ledger", return_value=UsageLedger()),
                patch.object(server, "context_usage_ledger", return_value=ContextLedger()),
                patch.object(server, "_agent_runtime", runtime),
                patch.object(runtime, "probe", return_value=ready),
                patch.object(runtime, "runtime_version", return_value="2.1.226 (Claude Code)"),
                patch.object(runtime, "capabilities", return_value=ready.capabilities),
            ):
                events_a: list[str] = []
                events_b: list[str] = []

                async def consume(session_id: str, prompt: str, target: list[str]) -> None:
                    async for item in server.AGENT_TRANSPORT.stream(
                        session_id, prompt, model="fake-model", permission_mode="default"
                    ):
                        target.append(item)

                task_a = asyncio.create_task(consume("A", "A问答", events_a))
                task_b = asyncio.create_task(consume("B", "B权限", events_b))
                for _ in range(240):
                    if server.agent_interaction_broker.pending_for("A") and server.agent_interaction_broker.pending_for("B"):
                        break
                    await asyncio.sleep(0.025)
                card_a = server.agent_interaction_broker.pending_for("A")
                card_b = server.agent_interaction_broker.pending_for("B")
                self.assertIsNotNone(card_a, events_a)
                self.assertIsNotNone(card_b, events_b)
                with patch.object(server, "NO_OUTPUT_TIMEOUT_SECONDS", 0.1):
                    await asyncio.sleep(0.35)
                    self.assertIsNotNone(server.agent_interaction_broker.pending_for("A"))
                    self.assertIsNotNone(server.agent_interaction_broker.pending_for("B"))
                    self.assertFalse(task_a.done())
                    self.assertFalse(task_b.done())
                run_a = server._active_runs["A"]
                run_b = server._active_runs["B"]
                self.assertNotEqual(run_a["pid"], run_b["pid"])

                await server.agent_interaction_broker.resolve(
                    "B", card_b["request_id"], "permission", "allow_once",
                    process_identity=run_b["process_identity"],
                )
                await asyncio.wait_for(task_b, timeout=8)
                self.assertFalse(task_a.done(), "A must stay paused while B continues")
                await server.agent_interaction_broker.resolve(
                    "A", card_a["request_id"], "question", "answer",
                    process_identity=run_a["process_identity"],
                    answers={"继续离线验证？": "继续"},
                )
                for _ in range(120):
                    if server.agent_interaction_broker.pending_for("A") is None:
                        break
                    await asyncio.sleep(0.025)
                self.assertIsNone(
                    server.agent_interaction_broker.pending_for("A"),
                    "the same tool id must not be re-registered by the structured fallback",
                )
                await asyncio.wait_for(task_a, timeout=8)

                decoded_a = [payload for item in events_a for payload in server.sse_payloads(item)]
                decoded_b = [payload for item in events_b for payload in server.sse_payloads(item)]
                self.assertIn("A问答后继续", [item.get("content") for item in decoded_a if item.get("type") == "text"])
                self.assertIn("B权限后继续", [item.get("content") for item in decoded_b if item.get("type") == "text"])
                self.assertEqual(sum(item.get("type") == "interaction_request" for item in decoded_a), 1)
                self.assertEqual(sum(item.get("type") == "interaction_request" for item in decoded_b), 1)
                self.assertFalse(any(item.get("type") == "tool_result" for item in decoded_a))
                host_root = temp_root / "runtime" / "agent-host"
                audits = list(host_root.rglob("audit-summary.json")) if host_root.exists() else []
                self.assertEqual(len(audits), 2)
                for audit_path in audits:
                    audit = json.loads(audit_path.read_text(encoding="utf-8"))
                    self.assertEqual(audit["terminal"], "completed")
                self.assertEqual(list(host_root.rglob("requests/*.json")), [])
                self.assertEqual(list(host_root.rglob("responses/*.json")), [])
                self.assertEqual(list(host_root.rglob("hook-settings.json")), [])

            server.agent_interaction_broker.invalidate("A", reason="test-cleanup")
            server.agent_interaction_broker.invalidate("B", reason="test-cleanup")
            server._active_runs.clear()
            server._active_runs.update(original_runs)
            server.sessions.clear()
            server.sessions.update(original_sessions)
            server._session_locks.pop("A", None)
            server._session_locks.pop("B", None)


class ThinkingLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_real_delta_is_streamed_and_completion_drops_thinking_before_tool(self) -> None:
        class UsageLedger:
            def record_event(self, *_args, **_kwargs):
                return None

        class ContextLedger:
            def update_from_event(self, *_args, **_kwargs):
                return None

        script = (
            "import json,sys\n"
            "json.loads(sys.stdin.readline())\n"
            "events=["
            "{'type':'stream_event','event':{'type':'content_block_delta','delta':{'type':'thinking_delta','thinking':'真实 delta'}}},"
            "{'type':'assistant','message':{'content':[{'type':'tool_use','id':'tool-1','name':'Bash','input':{'command':'printf ok'}}]}},"
            "{'type':'user','message':{'content':[{'type':'tool_result','tool_use_id':'tool-1','content':'ok'}]}},"
            "{'type':'assistant','message':{'content':[{'type':'text','text':'最终回复'}]}},"
            "{'type':'result','result':'最终回复'}]\n"
            "[print(json.dumps(item,ensure_ascii=False),flush=True) for item in events]\n"
        )
        session = {
            "id": "thinking-A",
            "mode": "agent",
            "name": "thinking-A",
            "messages": [],
            "workdir": str(ROOT),
            "created": 1,
            "updated": 1,
            "claude_initialized": False,
            "claude_session_id": "00000000-0000-4000-8000-000000000016",
            "pinned": False,
            "unread": False,
        }
        cfg = {"model": "fake-model", "api_key": "fixture", "base_url": "http://fixture", "label": "fixture"}
        residue = ROOT / "codex" / "运行残留"
        with tempfile.TemporaryDirectory(dir=residue) as temp:
            original_sessions = dict(server.sessions)
            original_runs = dict(server._active_runs)
            server.sessions.clear()
            server.sessions["thinking-A"] = session
            server._active_runs.clear()
            runtime = server.WindowsNativeRuntime([sys.executable, "-u", "-c", script])
            try:
                with (
                    patch.object(server, "DATA_DIR", Path(temp)),
                    patch.object(server, "deepseek_config", return_value=cfg),
                    patch.object(server, "read_agent_instructions", return_value=""),
                    patch.object(server, "save_sessions_to_disk"),
                    patch.object(server, "daily_usage_ledger", return_value=UsageLedger()),
                    patch.object(server, "context_usage_ledger", return_value=ContextLedger()),
                    patch.object(server, "_agent_runtime", runtime),
                ):
                    chunks = [
                        item
                        async for item in server.AGENT_TRANSPORT.stream(
                            "thinking-A", "fixture", model="fake-model", permission_mode="default"
                        )
                    ]
                decoded = [payload for item in chunks for payload in server.sse_payloads(item)]
                types = [item.get("type") for item in decoded]
                self.assertLess(types.index("thinking_start"), types.index("thinking"))
                self.assertLess(types.index("thinking"), types.index("thinking_complete"))
                self.assertLess(types.index("thinking_complete"), types.index("tool_start"))
                self.assertEqual(
                    [item.get("content") for item in decoded if item.get("type") == "thinking"],
                    ["真实 delta"],
                )
                final = server.sessions["thinking-A"]["messages"][-1]
                self.assertNotIn("thinking", final)
                self.assertNotIn("thinking", [segment.get("type") for segment in final.get("segments", [])])
                self.assertEqual(
                    [segment.get("type") for segment in final.get("segments", [])],
                    ["tool_start", "tool_result", "text"],
                )
            finally:
                server.agent_interaction_broker.invalidate("thinking-A", reason="test-cleanup")
                server.sessions.clear()
                server.sessions.update(original_sessions)
                server._active_runs.clear()
                server._active_runs.update(original_runs)


class AgentQueueStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        from agent_queue import AgentQueueStore

        self.AgentQueueStore = AgentQueueStore

    def test_fifo_is_persistent_session_scoped_and_editable(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "agent-queue.json"
            store = self.AgentQueueStore(path)
            first = store.enqueue("A", "第一条", model="m1", permission_mode="default")
            second = store.enqueue("A", "第二条", model="m2", permission_mode="plan")
            other = store.enqueue("B", "B 的消息", model="m3", permission_mode="default")

            reopened = self.AgentQueueStore(path)
            self.assertEqual([item["id"] for item in reopened.list("A")], [first["id"], second["id"]])
            self.assertEqual([item["id"] for item in reopened.list("B")], [other["id"]])
            self.assertEqual([item["status"] for item in reopened.list("A")], ["paused", "paused"])
            self.assertEqual([item["status"] for item in reopened.list("B")], ["paused"])
            reopened.edit("A", second["id"], "第二条已修改")
            reopened.cancel("A", first["id"])
            self.assertEqual([item["text"] for item in reopened.list("A")], ["第二条已修改"])
            self.assertEqual([item["text"] for item in reopened.list("B")], ["B 的消息"])

    def test_only_normal_done_authorizes_one_fifo_claim_and_restart_does_not_auto_run(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "agent-queue.json"
            store = self.AgentQueueStore(path)
            first = store.enqueue("A", "第一条")
            store.enqueue("A", "第二条")

            self.assertIsNone(store.authorize_drain("A", "run-error", "error"))
            self.assertIsNone(store.authorize_drain("A", "run-cancel", "cancelled"))
            token = store.authorize_drain("A", "run-done", "done")
            self.assertTrue(token)
            claimed = store.claim_authorized("A", token)
            self.assertEqual(claimed["id"], first["id"])
            self.assertIsNone(store.claim_authorized("A", token), "one completion token must not double-dispatch")

            reopened = self.AgentQueueStore(path)
            self.assertFalse(reopened.has_drain_authorization("A"))
            self.assertEqual(reopened.list("A")[0]["status"], "paused")


class AgentQueueServerTests(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def _session(session_id: str = "A") -> dict:
        return {
            "id": session_id,
            "mode": "agent",
            "name": session_id,
            "messages": [],
            "last_run_status": "idle",
            "created": 1,
            "updated": 1,
        }

    async def test_queue_endpoint_snapshots_active_run_and_never_writes_transcript(self) -> None:
        class Request:
            async def json(self):
                return {"message": "排队内容"}

        residue = ROOT / "codex" / "运行残留"
        residue.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=residue) as temp:
            store = self.AgentQueueStore(Path(temp) / "queue.json") if hasattr(self, "AgentQueueStore") else None
            if store is None:
                from agent_queue import AgentQueueStore
                store = AgentQueueStore(Path(temp) / "queue.json")
            original_sessions = dict(server.sessions)
            original_runs = dict(server._active_runs)
            original_coordinator = server._agent_run_coordinator
            release = asyncio.Event()

            async def producer():
                yield {"type": "assistant_start"}
                await release.wait()
                yield {"type": "done"}

            server.sessions.clear()
            server.sessions["A"] = self._session()
            server._active_runs.clear()
            coordinator = AgentRunCoordinator()
            server._agent_run_coordinator = coordinator
            coordinator.start(
                "A", producer,
                metadata={"model": "fixture-model", "permission_mode": "plan"},
            )
            try:
                with patch.object(server, "_agent_queue_store", store):
                    result = await server.enqueue_agent_message("A", Request())
                self.assertTrue(result["queued"])
                self.assertEqual(result["item"]["model"], "fixture-model")
                self.assertEqual(result["item"]["permission_mode"], "plan")
                self.assertEqual(server.sessions["A"]["messages"], [])
            finally:
                release.set()
                await coordinator.shutdown()
                server._agent_run_coordinator = original_coordinator
                server.sessions.clear(); server.sessions.update(original_sessions)
                server._active_runs.clear(); server._active_runs.update(original_runs)

    async def test_pending_interaction_rejects_guidance_without_writing_or_persisting(self) -> None:
        class Request:
            async def json(self):
                return {"message": "不能冒充问题答案"}

        class Writer:
            def __init__(self):
                self.lines = []

            def write(self, value):
                self.lines.append(value)

            async def drain(self):
                return None

            def is_closing(self):
                return False

        writer = Writer()
        original_sessions = dict(server.sessions)
        original_runs = dict(server._active_runs)
        try:
            server.sessions.clear()
            server.sessions["A"] = self._session("A")
            server._active_runs.clear()
            server._active_runs["A"] = {
                "kind": "agent",
                "stdin": writer,
                "process_identity": "fixture:A:run",
                "claude_session_id": "00000000-0000-4000-8000-000000000016",
                "pending_interaction": "question-A",
            }
            with patch.object(server, "save_sessions_to_disk"):
                with self.assertRaises(server.HTTPException) as caught:
                    await server.guide_active_agent("A", Request())
            self.assertEqual(caught.exception.status_code, 409)
            self.assertEqual(writer.lines, [])
            self.assertEqual(server.sessions["A"]["messages"], [])
        finally:
            server.sessions.clear()
            server.sessions.update(original_sessions)
            server._active_runs.clear()
            server._active_runs.update(original_runs)

    async def test_normal_done_drains_fifo_once_but_error_keeps_queue_paused(self) -> None:
        from agent_queue import AgentQueueStore

        class FakeTransport:
            def __init__(self, fail_first: bool = False):
                self.calls = []
                self.fail_first = fail_first

            async def stream(self, session_id, message, _is_guidance, model, permission_mode,
                             attachments, **kwargs):
                self.calls.append({
                    "session_id": session_id,
                    "message": message,
                    "model": model,
                    "permission_mode": permission_mode,
                    "queued_item_id": kwargs.get("queued_item_id", ""),
                })
                yield server.sse({"type": "runtime_started", "session_id": session_id, "run_id": f"run-{len(self.calls)}"})
                if self.fail_first and len(self.calls) == 1:
                    server.sessions[session_id]["last_run_status"] = "failed"
                    yield server.sse({"type": "error", "content": "fixture failure"})
                else:
                    server.sessions[session_id]["last_run_status"] = "completed"
                    yield server.sse({"type": "text", "content": f"完成 {message}"})
                yield server.sse({"type": "done"})

        residue = ROOT / "codex" / "运行残留"
        residue.mkdir(parents=True, exist_ok=True)
        for fail_first in (False, True):
            with tempfile.TemporaryDirectory(dir=residue) as temp:
                store = AgentQueueStore(Path(temp) / "queue.json")
                store.enqueue("A", "第一条", model="m1", permission_mode="default")
                store.enqueue("A", "第二条", model="m2", permission_mode="plan")
                transport = FakeTransport(fail_first=fail_first)
                original_sessions = dict(server.sessions)
                original_runs = dict(server._active_runs)
                server.sessions.clear(); server.sessions["A"] = self._session()
                server._active_runs.clear()
                server._session_locks.pop("A", None)
                try:
                    with (
                        patch.object(server, "_agent_queue_store", store),
                        patch.object(server, "AGENT_TRANSPORT", transport),
                    ):
                        events = [item async for item in server.stream_chat(
                            "A", "当前任务", model="m0", permission_mode="default"
                        )]
                    decoded = [payload for item in events for payload in server.sse_payloads(item)]
                    if fail_first:
                        self.assertEqual([call["message"] for call in transport.calls], ["当前任务"])
                        self.assertEqual([item["text"] for item in store.list("A")], ["第一条", "第二条"])
                        self.assertEqual([item["status"] for item in store.list("A")], ["paused", "paused"])
                        self.assertFalse(any(item.get("type") == "queue_dispatch" for item in decoded))
                    else:
                        self.assertEqual([call["message"] for call in transport.calls], ["当前任务", "第一条", "第二条"])
                        self.assertEqual(store.list("A"), [])
                        self.assertEqual(sum(item.get("type") == "queue_dispatch" for item in decoded), 2)
                        self.assertEqual(sum(item.get("type") == "queue_removed" for item in decoded), 2)
                finally:
                    server.sessions.clear(); server.sessions.update(original_sessions)
                    server._active_runs.clear(); server._active_runs.update(original_runs)
                    server._session_locks.pop("A", None)


class RendererKeyboardContractTests(unittest.TestCase):
    def test_retry_stream_projects_queue_dispatch_and_removal(self) -> None:
        source = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        retry = source.split("async function doRetrySend", 1)[1].split("function normalizeContextUsage", 1)[0]
        self.assertIn('payload.type === "queue_dispatch"', retry)
        self.assertIn('payload.type === "queue_removed"', retry)
        self.assertIn("streamRenderer = createStreamRenderer(runSessionId)", retry)

    def test_active_enter_queues_ctrl_enter_steers_and_shift_enter_only_newlines(self) -> None:
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

        active = payload["activeEnter"]
        self.assertEqual(
            active["allCalls"],
            [{
                "url": "/api/chat/A/queue",
                "method": "POST",
                "body": {"message": "请改用更简洁的方案", "attachments": []},
            }],
        )
        self.assertEqual(active["calls"], [], "ordinary Enter must never use guidance")

        steer = payload["activeCtrlEnter"]
        self.assertEqual(
            steer["calls"],
            [{
                "url": "/api/chat/A/guidance",
                "method": "POST",
                "body": {"message": "请立即修正当前步骤"},
            }],
        )
        self.assertIn("已引导当前任务", steer["markerText"])
        self.assertFalse(steer["renderedAsUserBubble"])
        self.assertEqual(payload["shiftEnter"]["calls"], 0)

    def test_queue_pending_and_thinking_projection_are_session_scoped_in_chromium(self) -> None:
        electron = ROOT / "desktop" / "node_modules" / "electron" / "dist" / "electron.exe"
        result = subprocess.run(
            [str(electron), str(ROOT / "tests" / "v16_renderer_harness.js")],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertNotIn("__harnessError", payload, payload.get("__harnessError"))
        self.assertEqual(payload["aPending"], {"queuePending": True, "sendDisabled": True})
        self.assertEqual(payload["bBefore"], {"queuePending": False, "sendDisabled": False, "dockText": ""})
        self.assertEqual(payload["bothPending"], {"a": True, "b": True})
        self.assertTrue(payload["bResolved"]["a"])
        self.assertFalse(payload["bResolved"]["b"])
        self.assertIn("B 排队", payload["bResolved"]["dockText"])
        self.assertTrue(payload["aBeforeResolve"]["pending"])
        self.assertNotIn("B 排队", payload["aBeforeResolve"]["dockText"])
        self.assertFalse(payload["aResolved"]["pending"])
        self.assertIn("A 排队", payload["aResolved"]["dockText"])
        self.assertEqual(payload["thinkingBeforeTool"]["count"], 1)
        self.assertIn("真实思考 delta", payload["thinkingBeforeTool"]["text"])
        self.assertEqual(payload["thinkingAfterTool"]["count"], 0)
        self.assertIn("Bash", payload["thinkingAfterTool"]["toolText"])
        self.assertFalse(payload["noDeltaWorking"]["hidden"])
        self.assertIn("12 秒", payload["noDeltaWorking"]["label"])
        self.assertEqual(payload["noDeltaWorking"]["thinkingPanels"], 0)
        self.assertEqual(payload["imeEnter"], {"calls": 0, "value": "输入法尚未完成"})
        self.assertEqual(payload["interactionPendingCtrlEnter"], {
            "calls": 0,
            "value": "不能冒充问题答案的引导",
        })
        self.assertEqual(payload["queuedAttachment"], {
            "attachmentCount": 1,
            "name": "fixture.txt",
            "remainingContextFiles": 0,
        })


if __name__ == "__main__":
    unittest.main()
