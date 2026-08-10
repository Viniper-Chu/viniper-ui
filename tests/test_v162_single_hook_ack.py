from __future__ import annotations

import asyncio
import json
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import server
from agent_host_bridge import HostInteractionChannel, _record_ack_stage
from agent_run_coordinator import AgentRunCoordinator
from agent_runtime import AgentRunSpec, RuntimeCapabilities, RuntimeProbe, WslAgentRuntime


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures" / "v162"


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
        "last_run_status": "",
        "claude_session_id": "00000000-0000-4000-8000-000000000162",
        "claude_initialized": False,
        "summary": "",
    }


class SingleOwnerRedTests(unittest.TestCase):
    def test_real_mcp_prompt_is_the_only_interaction_owner_in_runtime_argv(self) -> None:
        runtime = WslAgentRuntime()
        spec = AgentRunSpec(
            session_id="A",
            claude_session_id="00000000-0000-4000-8000-000000000162",
            session_name="fixture-a",
            workdir=str(ROOT),
            model="fixture-model",
            permission_mode="default",
            resume=False,
            settings_file=str(ROOT / "codex" / "运行残留" / "hook-settings.json"),
            mcp_config_file=str(ROOT / "codex" / "运行残留" / "mcp-config.json"),
            permission_prompt_tool="mcp__viniper_interaction__permission_prompt",
        )
        command = runtime.build_command(spec)
        self.assertIn("--settings", command)
        self.assertIn("--permission-prompt-tool", command)
        self.assertIn("--mcp-config", command)
        self.assertNotIn("stdio", command)
        self.assertIn("--permission-prompt-tool", server.CLAUDE_REQUIRED_OPTIONS)

    def test_response_commit_remains_unsettled_until_matching_cli_tool_result(self) -> None:
        with tempfile.TemporaryDirectory(dir=ROOT / "codex" / "运行残留") as temp:
            channel = HostInteractionChannel(Path(temp) / "channel")
            request = {
                "type": "interaction_request",
                "kind": "question",
                "request_id": "toolu-red",
                "bridge_request_id": "bridge-red",
                "session_id": "A",
                "questions": [{"question": "继续？", "options": [{"label": "继续"}]}],
                "_original_questions": [{"question": "继续？", "options": [{"label": "继续"}]}],
                "allowed_actions": ["answer", "skip"],
            }
            broker = server.AgentInteractionBroker()
            card = broker.create_host_request("A", "process-A", request, channel, run={"pending_interaction": "toolu-red"})
            result = asyncio.run(broker.resolve(
                "A", card["request_id"], "question", "answer",
                process_identity="process-A", answers={"继续？": "继续"},
            ))
            self.assertEqual(result["status"], "awaiting_cli_ack")
            committed = broker.pending_for("A")
            self.assertIsNotNone(committed, "card remains visible until matching CLI acknowledgement")
            self.assertEqual(committed.get("interaction_state"), "awaiting_cli_ack")
            self.assertEqual(committed.get("allowed_actions"), [])
            self.assertEqual(broker.ack_status_for("A")["stage"], "response_committed")
            self.assertTrue(broker.unsettled_for("A"))

    def test_coordinator_projects_commit_separately_from_cli_ack(self) -> None:
        async def scenario() -> None:
            gate = asyncio.Event()

            async def producer():
                yield {"type": "interaction_request", "request_id": "toolu-red", "kind": "question"}
                await gate.wait()
                yield {"type": "done"}

            coordinator = AgentRunCoordinator()
            record = coordinator.start("A", producer())
            for _ in range(100):
                if coordinator.snapshot("A")["status"] == "waiting_input":
                    break
                await asyncio.sleep(0.01)
            await coordinator.commit_interaction_response("A", "toolu-red")
            committed = coordinator.snapshot("A")
            self.assertEqual(committed["status"], "awaiting_cli_ack")
            self.assertIsNone(committed["pending_interaction"])
            await coordinator.acknowledge_interaction("A", "toolu-red", success=True)
            self.assertEqual(coordinator.snapshot("A")["status"], "running")
            gate.set()
            await record.task

        asyncio.run(scenario())

    def test_ack_timeout_is_bounded_after_response_commit(self) -> None:
        with tempfile.TemporaryDirectory(dir=ROOT / "codex" / "运行残留") as temp:
            channel = HostInteractionChannel(Path(temp) / "channel")
            request = {
                "type": "interaction_request",
                "kind": "permission",
                "request_id": "toolu-timeout",
                "bridge_request_id": "bridge-timeout",
                "session_id": "A",
                "tool_name": "Write",
                "allowed_actions": ["deny", "allow_once"],
            }
            broker = server.AgentInteractionBroker()
            card = broker.create_host_request("A", "process-A", request, channel)
            asyncio.run(broker.resolve(
                "A", card["request_id"], "permission", "allow_once", process_identity="process-A",
            ))
            expired = broker.expire_unacknowledged(now=time.time() + 2, timeout_seconds=1)
            self.assertEqual(expired, [{"session_id": "A", "request_id": "toolu-timeout", "reason": "cli_ack_timeout"}])
            self.assertFalse(broker.unsettled_for("A"))

    def test_cleanup_preserves_sanitized_response_and_terminal_audit(self) -> None:
        with tempfile.TemporaryDirectory(dir=ROOT / "codex" / "运行残留") as temp:
            root = Path(temp) / "channel"
            channel = HostInteractionChannel(root)
            channel.respond("bridge-audit", {"hookSpecificOutput": {"hookEventName": "PreToolUse"}})
            channel.record_cli_tool_result("bridge-audit", "toolu-audit", success=False)
            channel.finalize("cancelled", reason="fixture-stop")
            channel.cleanup()
            audit = json.loads((root / "audit-summary.json").read_text(encoding="utf-8"))
            self.assertEqual(audit["terminal"], "cancelled")
            self.assertEqual(audit["requests"]["bridge-audit"]["stages"], [
                "response_committed", "cli_tool_result",
            ])
            self.assertNotIn("hookSpecificOutput", json.dumps(audit))


class RealSettingsHookEmulatorRedTest(unittest.IsolatedAsyncioTestCase):
    async def test_wsl_cli_emulator_executes_generated_settings_hook_and_waits_for_cli_ack(self) -> None:
        class UsageLedger:
            def record_event(self, *_args, **_kwargs):
                return None

        class ContextLedger:
            def update_from_event(self, *_args, **_kwargs):
                return None

        fake_launcher = FIXTURES / "fake-bin" / "claude"

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
        original_sessions = dict(server.sessions)
        original_runs = dict(server._active_runs)
        residue = ROOT / "codex" / "运行残留"
        with tempfile.TemporaryDirectory(dir=residue) as temp:
            temp_root = Path(temp)
            server.sessions.clear(); server.sessions["A"] = agent_session("A")
            server._active_runs.clear(); server._session_locks.pop("A", None)
            events: list[str] = []
            try:
                with (
                    patch.object(server, "DATA_DIR", temp_root),
                    patch.object(server, "deepseek_config", return_value={"model": "fake-model", "api_key": "fixture", "base_url": "http://fixture", "label": "fixture"}),
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
                    async def consume() -> None:
                        async for item in server.AGENT_TRANSPORT.stream(
                            "A", "DIRECT_THEN_HOOK ASK_THEN_PERMISSION",
                            model="fake-model", permission_mode="default",
                        ):
                            events.append(item)

                    task = asyncio.create_task(consume())
                    for _ in range(240):
                        if server.agent_interaction_broker.pending_for("A"):
                            break
                        if task.done():
                            break
                        await asyncio.sleep(0.025)
                    card = server.agent_interaction_broker.pending_for("A")
                    self.assertIsNotNone(card, [payload for item in events for payload in server.sse_payloads(item)])
                    run = server._active_runs["A"]
                    result = await server.agent_interaction_broker.resolve(
                        "A", card["request_id"], "question", "answer",
                        process_identity=run["process_identity"], answers={"继续离线验证？": "继续"},
                    )
                    self.assertEqual(result["status"], "awaiting_cli_ack")
                    permission = None
                    for _ in range(240):
                        candidate = server.agent_interaction_broker.pending_for("A")
                        if candidate and candidate["request_id"] != card["request_id"]:
                            permission = candidate
                            break
                        await asyncio.sleep(0.025)
                    self.assertIsNotNone(permission, [payload for item in events for payload in server.sse_payloads(item)])
                    self.assertEqual(permission["kind"], "permission")
                    permission_result = await server.agent_interaction_broker.resolve(
                        "A", permission["request_id"], "permission", "allow_once",
                        process_identity=run["process_identity"],
                    )
                    self.assertEqual(permission_result["status"], "awaiting_cli_ack")
                    await asyncio.wait_for(task, timeout=10)
                decoded = [payload for item in events for payload in server.sse_payloads(item)]
                self.assertFalse(any(item.get("type") == "control_request" for item in decoded))
                self.assertEqual(
                    [item.get("request_id") for item in decoded if item.get("type") == "interaction_request"],
                    ["toolu_v162_ask", "toolu_v162_write"],
                )
                self.assertIn("真实 MCP prompt 已确认", [item.get("content") for item in decoded if item.get("type") == "text"])
                outputs = list(temp_root.rglob("emulator-output.txt"))
                self.assertEqual(len(outputs), 1)
                self.assertEqual(outputs[0].read_text(encoding="utf-8"), "v16.3 offline MCP accepted\n")
                audits = list((temp_root / "runtime" / "agent-host").rglob("audit-summary.json"))
                self.assertEqual(len(audits), 1)
                audit = json.loads(audits[0].read_text(encoding="utf-8"))
                self.assertEqual(audit["terminal"], "completed")
                self.assertEqual(len(audit["requests"]), 2)
                for request_audit in audit["requests"].values():
                    self.assertEqual(request_audit["stages"], [
                        "response_committed", "response_read",
                        "mcp_response_written_and_flushed", "cli_tool_result",
                    ])
                    self.assertTrue(request_audit["cli_tool_result_success"])
            finally:
                server.agent_interaction_broker.invalidate("A", reason="test-cleanup")
                server.sessions.clear(); server.sessions.update(original_sessions)
                server._active_runs.clear(); server._active_runs.update(original_runs)
                server._session_locks.pop("A", None)

    async def test_emulator_without_matching_tool_result_times_out_fail_closed(self) -> None:
        class UsageLedger:
            def record_event(self, *_args, **_kwargs):
                return None

        class ContextLedger:
            def update_from_event(self, *_args, **_kwargs):
                return None

        fake_launcher = FIXTURES / "fake-bin" / "claude"

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
                stream_json=True, structured_input=True, structured_interactions=True,
                usage=True, native_cli=True, platform="wsl2",
            ),
        )
        original_sessions = dict(server.sessions)
        original_runs = dict(server._active_runs)
        residue = ROOT / "codex" / "运行残留"
        with tempfile.TemporaryDirectory(dir=residue) as temp:
            temp_root = Path(temp)
            server.sessions.clear(); server.sessions["A"] = agent_session("A")
            server._active_runs.clear(); server._session_locks.pop("A", None)
            server.agent_interaction_broker.invalidate("A", reason="test-preflight")
            events: list[str] = []
            try:
                with (
                    patch.object(server, "DATA_DIR", temp_root),
                    patch.object(server, "deepseek_config", return_value={"model": "fake-model", "api_key": "fixture", "base_url": "http://fixture", "label": "fixture"}),
                    patch.object(server, "build_claude_env", return_value={}),
                    patch.object(server, "runtime_bridge_keys", return_value=()),
                    patch.object(server, "read_agent_instructions", return_value=""),
                    patch.object(server, "save_sessions_to_disk"),
                    patch.object(server, "daily_usage_ledger", return_value=UsageLedger()),
                    patch.object(server, "context_usage_ledger", return_value=ContextLedger()),
                    patch.object(server, "_agent_runtime", runtime),
                    patch.object(server, "CLI_INTERACTION_ACK_TIMEOUT_SECONDS", 0.2),
                    patch.object(server, "NO_OUTPUT_TIMEOUT_SECONDS", 10),
                    patch.object(runtime, "probe", return_value=ready),
                    patch.object(runtime, "runtime_version", return_value="2.1.226 (Claude Code)"),
                    patch.object(runtime, "capabilities", return_value=ready.capabilities),
                ):
                    async def consume() -> None:
                        async for item in server.AGENT_TRANSPORT.stream("A", "NO_TOOL_RESULT", model="fake-model", permission_mode="default"):
                            events.append(item)

                    task = asyncio.create_task(consume())
                    for _ in range(240):
                        if server.agent_interaction_broker.pending_for("A"):
                            break
                        await asyncio.sleep(0.025)
                    card = server.agent_interaction_broker.pending_for("A")
                    self.assertIsNotNone(card)
                    run = server._active_runs["A"]
                    await server.agent_interaction_broker.resolve(
                        "A", card["request_id"], "question", "answer",
                        process_identity=run["process_identity"], answers={"继续离线验证？": "继续"},
                    )
                    await asyncio.wait_for(task, timeout=6)
                decoded = [payload for item in events for payload in server.sse_payloads(item)]
                errors = [str(item.get("content") or "") for item in decoded if item.get("type") == "error"]
                self.assertTrue(any("没有返回匹配的工具结果" in item for item in errors), errors)
                self.assertTrue(any(item.get("type") == "done" for item in decoded))
                self.assertFalse(server.agent_interaction_broker.unsettled_for("A"))
                audits = list((temp_root / "runtime" / "agent-host").rglob("audit-summary.json"))
                self.assertEqual(len(audits), 1)
                self.assertEqual(json.loads(audits[0].read_text(encoding="utf-8"))["terminal"], "timeout")
            finally:
                server.agent_interaction_broker.invalidate("A", reason="test-cleanup")
                server.sessions.clear(); server.sessions.update(original_sessions)
                server._active_runs.clear(); server._active_runs.update(original_runs)
                server._session_locks.pop("A", None)

    async def test_stdout_control_request_cannot_become_owner_when_host_hooks_are_enabled(self) -> None:
        class UsageLedger:
            def record_event(self, *_args, **_kwargs):
                return None

        class ContextLedger:
            def update_from_event(self, *_args, **_kwargs):
                return None

        fake_launcher = FIXTURES / "fake-bin" / "claude"

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
                stream_json=True, structured_input=True, structured_interactions=True,
                usage=True, native_cli=True, platform="wsl2",
            ),
        )
        original_sessions = dict(server.sessions)
        original_runs = dict(server._active_runs)
        residue = ROOT / "codex" / "运行残留"
        with tempfile.TemporaryDirectory(dir=residue) as temp:
            temp_root = Path(temp)
            server.sessions.clear(); server.sessions["A"] = agent_session("A")
            server._active_runs.clear(); server._session_locks.pop("A", None)
            server.agent_interaction_broker.invalidate("A", reason="test-preflight")
            events: list[str] = []
            task: asyncio.Task | None = None
            try:
                with (
                    patch.object(server, "DATA_DIR", temp_root),
                    patch.object(server, "deepseek_config", return_value={"model": "fake-model", "api_key": "fixture", "base_url": "http://fixture", "label": "fixture"}),
                    patch.object(server, "build_claude_env", return_value={}),
                    patch.object(server, "runtime_bridge_keys", return_value=()),
                    patch.object(server, "read_agent_instructions", return_value=""),
                    patch.object(server, "save_sessions_to_disk"),
                    patch.object(server, "daily_usage_ledger", return_value=UsageLedger()),
                    patch.object(server, "context_usage_ledger", return_value=ContextLedger()),
                    patch.object(server, "_agent_runtime", runtime),
                    patch.object(server, "HOST_HOOK_COMPATIBILITY_GRACE_SECONDS", 0.1),
                    patch.object(server, "NO_OUTPUT_TIMEOUT_SECONDS", 10),
                    patch.object(runtime, "probe", return_value=ready),
                    patch.object(runtime, "runtime_version", return_value="2.1.226 (Claude Code)"),
                    patch.object(runtime, "capabilities", return_value=ready.capabilities),
                ):
                    async def consume() -> None:
                        async for item in server.AGENT_TRANSPORT.stream(
                            "A", "DIRECT_STDOUT_ONLY", model="fake-model", permission_mode="default",
                        ):
                            events.append(item)

                    task = asyncio.create_task(consume())
                    await asyncio.wait_for(task, timeout=4)
                decoded = [payload for item in events for payload in server.sse_payloads(item)]
                pending = server.agent_interaction_broker.pending_for("A")
                self.assertIsNone(pending)
                self.assertFalse(any(item.get("type") == "interaction_request" for item in decoded), decoded)
                errors = [str(item.get("content") or "") for item in decoded if item.get("type") == "error"]
                self.assertTrue(any("官方交互入口" in item for item in errors), errors)
            finally:
                if task is not None and not task.done():
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)
                await runtime.cancel("A")
                server.agent_interaction_broker.invalidate("A", reason="test-cleanup")
                server.sessions.clear(); server.sessions.update(original_sessions)
                server._active_runs.clear(); server._active_runs.update(original_runs)
                server._session_locks.pop("A", None)


class ServerAndRendererAckProjectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_interaction_endpoint_commits_but_does_not_claim_cli_acceptance(self) -> None:
        class Request:
            async def json(self):
                return {
                    "request_id": "toolu-endpoint",
                    "kind": "question",
                    "action": "answer",
                    "answers": {"继续？": "继续"},
                }

        gate = asyncio.Event()

        async def producer():
            yield {
                "type": "interaction_request",
                "request_id": "toolu-endpoint",
                "kind": "question",
                "questions": [{"question": "继续？", "options": [{"label": "继续"}]}],
            }
            await gate.wait()
            yield {"type": "done"}

        coordinator = AgentRunCoordinator()
        record = coordinator.start("A", producer())
        for _ in range(100):
            if coordinator.snapshot("A")["status"] == "waiting_input":
                break
            await asyncio.sleep(0.01)
        original_coordinator = server._agent_run_coordinator
        original_runs = dict(server._active_runs)
        server.agent_interaction_broker.invalidate("A", reason="test-preflight")
        with tempfile.TemporaryDirectory(dir=ROOT / "codex" / "运行残留") as temp:
            channel = HostInteractionChannel(Path(temp) / "channel")
            run = {
                "kind": "agent",
                "process_identity": "process-endpoint",
                "pending_interaction": "toolu-endpoint",
            }
            request = {
                "type": "interaction_request",
                "kind": "question",
                "request_id": "toolu-endpoint",
                "bridge_request_id": "bridge-endpoint",
                "session_id": "A",
                "questions": [{"question": "继续？", "options": [{"label": "继续"}]}],
                "_original_questions": [{"question": "继续？", "options": [{"label": "继续"}]}],
                "allowed_actions": ["answer", "skip"],
            }
            server._agent_run_coordinator = coordinator
            server._active_runs.clear(); server._active_runs["A"] = run
            server.agent_interaction_broker.create_host_request(
                "A", "process-endpoint", request, channel, run=run,
            )
            try:
                result = await server.answer_chat_interaction("A", Request())
                self.assertEqual(result["status"], "awaiting_cli_ack")
                duplicate = await server.answer_chat_interaction("A", Request())
                self.assertEqual(duplicate["status"], "awaiting_cli_ack")
                self.assertEqual(
                    len(list(channel.responses.glob("bridge-endpoint.json"))), 1,
                    "duplicate API submit must reuse the same committed response",
                )
                snapshot = coordinator.snapshot("A")
                self.assertEqual(snapshot["status"], "awaiting_cli_ack")
                self.assertEqual(snapshot["awaiting_interaction_ack"], {"request_id": "toolu-endpoint"})
                self.assertIsNone(snapshot["pending_interaction"])
                self.assertTrue(server.agent_interaction_broker.unsettled_for("A"))
                pending = server.agent_interaction_broker.pending_for("A")
                self.assertIsNotNone(pending)
                self.assertEqual(pending.get("interaction_state"), "awaiting_cli_ack")
                self.assertEqual(pending.get("allowed_actions"), [])
                self.assertEqual(server.session_runtime_state("A"), "awaiting_cli_ack")
            finally:
                server.agent_interaction_broker.invalidate("A", reason="test-cleanup")
                channel.finalize("cancelled", reason="test-cleanup")
                channel.cleanup()
                gate.set()
                await record.task
                server._agent_run_coordinator = original_coordinator
                server._active_runs.clear(); server._active_runs.update(original_runs)

    async def test_missing_hook_ack_stage_fails_closed_even_with_forged_success_tool_result(self) -> None:
        with tempfile.TemporaryDirectory(dir=ROOT / "codex" / "运行残留") as temp:
            channel = HostInteractionChannel(Path(temp) / "channel")
            request = {
                "type": "interaction_request",
                "kind": "permission",
                "request_id": "toolu-incomplete",
                "bridge_request_id": "bridge-incomplete",
                "session_id": "A",
                "tool_name": "Write",
                "allowed_actions": ["deny", "allow_once"],
            }
            broker = server.AgentInteractionBroker()
            card = broker.create_host_request("A", "process-A", request, channel)
            await broker.resolve(
                "A", card["request_id"], "permission", "allow_once", process_identity="process-A",
            )
            result = broker.confirm_cli_tool_result("A", "toolu-incomplete", success=True)
            self.assertFalse(result["accepted"])
            self.assertEqual(result["reason"], "cli_ack_incomplete")
            self.assertFalse(broker.unsettled_for("A"))

    async def test_nonzero_hook_exit_fails_closed_even_with_matching_success_tool_result(self) -> None:
        with tempfile.TemporaryDirectory(dir=ROOT / "codex" / "运行残留") as temp:
            channel = HostInteractionChannel(Path(temp) / "channel")
            request = {
                "type": "interaction_request",
                "kind": "permission",
                "request_id": "toolu-nonzero",
                "bridge_request_id": "bridge-nonzero",
                "session_id": "A",
                "tool_name": "Bash",
                "allowed_actions": ["deny", "allow_once"],
            }
            broker = server.AgentInteractionBroker()
            card = broker.create_host_request("A", "process-A", request, channel)
            await broker.resolve(
                "A", card["request_id"], "permission", "allow_once", process_identity="process-A",
            )
            _record_ack_stage(channel.root, "bridge-nonzero", "response_read")
            _record_ack_stage(channel.root, "bridge-nonzero", "stdout_written_and_flushed")
            _record_ack_stage(channel.root, "bridge-nonzero", "hook_exit", exit_code=7)
            result = broker.confirm_cli_tool_result("A", "toolu-nonzero", success=True)
            self.assertFalse(result["accepted"])
            self.assertEqual(result["reason"], "cli_ack_incomplete")
            self.assertEqual(result["acknowledgement"]["hook_exit_code"], 7)
            self.assertFalse(broker.unsettled_for("A"))


class ChromiumAckProjectionTests(unittest.TestCase):
    def test_answered_card_enters_session_scoped_awaiting_ack_state(self) -> None:
        electron = ROOT / "desktop" / "node_modules" / "electron" / "dist" / "electron.exe"
        self.assertTrue(electron.exists(), "Electron test runtime is missing")
        result = subprocess.run(
            [str(electron), str(ROOT / "tests" / "v162_renderer_harness.js")],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertNotIn("__harnessError", payload, payload.get("__harnessError"))
        self.assertEqual(payload["calls"], [{
            "url": "/api/chat/A/interaction",
            "body": {
                "request_id": "toolu-v162",
                "kind": "permission",
                "action": "allow_once",
                "answers": None,
            },
        }])
        self.assertEqual(payload["committed"], {
            "status": "awaiting_cli_ack",
            "pending": False,
            "inputDisabled": True,
            "sendDisabled": True,
            "composerState": "awaiting_cli_ack",
            "cardCount": 0,
            "interactionState": "",
        })
        self.assertEqual(payload["idleB"], {"inputDisabled": False, "sendDisabled": False, "cardCount": 0})
        self.assertEqual(payload["restored"], {
            "status": "awaiting_cli_ack", "inputDisabled": True, "cardCount": 0,
            "interactionState": "",
        })
        self.assertEqual(payload["accepted"], {
            "status": "running", "inputDisabled": False, "sendDisabled": False,
        })


if __name__ == "__main__":
    unittest.main()
