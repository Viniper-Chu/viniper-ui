"""v16.3 red/green contracts for the real run-private MCP interaction owner."""

from __future__ import annotations

import json
import asyncio
import queue
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import agent_host_bridge
import server
from agent_runtime import AgentRunSpec, WslAgentRuntime


class V163McpInteractionContracts(unittest.TestCase):
    def test_managed_command_uses_real_mcp_prompt_owner(self) -> None:
        runtime = WslAgentRuntime()
        spec = AgentRunSpec(
            session_id="A",
            claude_session_id="11111111-1111-4111-8111-111111111111",
            session_name="session-a",
            workdir=str(ROOT),
            model="deepseek-v4-pro[1m]",
            permission_mode="default",
            resume=False,
            settings_file=str(ROOT / "codex" / "运行残留" / "runtime-settings.json"),
            mcp_config_file=str(ROOT / "codex" / "运行残留" / "mcp-config.json"),
            permission_prompt_tool="mcp__viniper_interaction__permission_prompt",
        )
        command = runtime.build_command(spec)
        self.assertEqual(
            command[command.index("--permission-prompt-tool") + 1],
            "mcp__viniper_interaction__permission_prompt",
        )
        self.assertIn("--mcp-config", command)
        self.assertNotIn("stdio", command)

    def test_mcp_config_is_run_private_and_settings_have_no_interaction_owner(self) -> None:
        with tempfile.TemporaryDirectory(dir=ROOT / "codex" / "运行残留") as temp:
            config = agent_host_bridge.build_permission_prompt_mcp_config(
                script_path="/app/agent_host_bridge.py",
                channel_path=f"{temp}/channel",
            )
            server = config["mcpServers"]["viniper_interaction"]
            self.assertEqual(server["type"], "stdio")
            self.assertIn("--mcp-server", server["args"])
            self.assertIn("--channel", server["args"])
            self.assertEqual(
                agent_host_bridge.build_passive_hook_settings(),
                {"hooks": {}},
            )

    def test_question_prompt_response_preserves_original_questions_and_answers(self) -> None:
        original = [{
            "question": "继续？",
            "header": "确认",
            "options": [{"label": "继续"}, {"label": "停止"}],
            "multiSelect": False,
        }]
        request = agent_host_bridge.normalize_permission_prompt_request({
            "tool_name": "AskUserQuestion",
            "tool_use_id": "toolu-ask",
            "input": {"questions": original},
        }, bridge_request_id="bridge-ask")
        self.assertIsNotNone(request)
        response = agent_host_bridge.build_permission_prompt_response(
            request, "answer", answers={"继续？": "继续"},
        )
        self.assertEqual(response, {
            "behavior": "allow",
            "updatedInput": {"questions": original, "answers": {"继续？": "继续"}},
        })

    def test_write_allow_once_returns_original_input_without_fake_persistence(self) -> None:
        tool_input = {"file_path": "/tmp/example.txt", "content": "fixture"}
        request = agent_host_bridge.normalize_permission_prompt_request({
            "tool_name": "Write",
            "tool_use_id": "toolu-write",
            "input": tool_input,
        }, bridge_request_id="bridge-write")
        self.assertIsNotNone(request)
        response = agent_host_bridge.build_permission_prompt_response(request, "allow_once")
        self.assertEqual(response, {"behavior": "allow", "updatedInput": tool_input})
        self.assertNotIn("updatedPermissions", json.dumps(response))

    def test_invalid_prompt_schema_fails_closed(self) -> None:
        self.assertIsNone(agent_host_bridge.normalize_permission_prompt_request(
            {"tool_name": "AskUserQuestion", "tool_use_id": "toolu-missing", "input": {}},
            bridge_request_id="bridge-missing",
        ))
        self.assertIsNone(agent_host_bridge.normalize_permission_prompt_request(
            {"tool_name": "", "tool_use_id": "toolu-empty", "input": {}},
            bridge_request_id="bridge-empty",
        ))

    def test_real_mcp_process_waits_for_broker_and_requires_matching_tool_result(self) -> None:
        with tempfile.TemporaryDirectory(dir=ROOT / "codex" / "运行残留") as temp:
            channel = agent_host_bridge.HostInteractionChannel(Path(temp) / "channel", session_id="A", run_id="run-A")
            process = subprocess.Popen(
                [
                    sys.executable,
                    str(ROOT / "agent_host_bridge.py"),
                    "--mcp-server",
                    "--channel",
                    str(channel.root),
                    "--timeout",
                    "10",
                ],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
            )
            self.addCleanup(lambda: process.kill() if process.poll() is None else None)
            assert process.stdin is not None and process.stdout is not None

            def send(payload: dict) -> dict:
                process.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
                process.stdin.flush()
                return json.loads(process.stdout.readline())

            init = send({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {}},
            })
            self.assertEqual(init["result"]["serverInfo"]["name"], "viniper-interaction")
            listed = send({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
            self.assertEqual(listed["result"]["tools"][0]["name"], "permission_prompt")

            process.stdin.write(json.dumps({
                "jsonrpc": "2.0", "id": 3, "method": "tools/call",
                "params": {"name": "permission_prompt", "arguments": {
                    "tool_name": "AskUserQuestion",
                    "tool_use_id": "toolu-mcp-process",
                    "input": {"questions": [{"question": "继续？", "options": [{"label": "继续"}]}]},
                }},
            }, ensure_ascii=False) + "\n")
            process.stdin.flush()
            request = None
            for _ in range(100):
                pending = channel.pending()
                if pending:
                    request = pending[0]
                    break
                time.sleep(0.02)
            self.assertIsNotNone(request)
            broker = server.AgentInteractionBroker()
            run = {"pending_interaction": "toolu-mcp-process"}
            card = broker.create_host_request("A", "process-A", request, channel, run=run)
            self.assertEqual(card["request_id"], "toolu-mcp-process")
            result = asyncio.run(broker.resolve(
                "A", "toolu-mcp-process", "question", "answer",
                process_identity="process-A", answers={"继续？": "继续"},
            ))
            self.assertEqual(result["status"], "awaiting_cli_ack")
            mcp_result = json.loads(process.stdout.readline())
            decision = json.loads(mcp_result["result"]["content"][0]["text"])
            self.assertEqual(decision["updatedInput"]["answers"], {"继续？": "继续"})
            for _ in range(100):
                if channel.acknowledgement(str(request["bridge_request_id"])).get(
                    agent_host_bridge.MCP_RESPONSE_ACK_STAGE
                ):
                    break
                time.sleep(0.01)
            confirmed = broker.confirm_cli_tool_result("A", "toolu-mcp-process", success=True)
            self.assertTrue(confirmed["accepted"], confirmed)
            process.stdin.close()
            process.wait(timeout=5)
            process.stdout.close()
            assert process.stderr is not None
            process.stderr.close()

    def test_mcp_does_not_consume_response_before_commit_marker(self) -> None:
        with tempfile.TemporaryDirectory(dir=ROOT / "codex" / "运行残留") as temp:
            channel = agent_host_bridge.HostInteractionChannel(Path(temp) / "channel", session_id="A", run_id="run-A")
            process = subprocess.Popen(
                [
                    sys.executable,
                    str(ROOT / "agent_host_bridge.py"),
                    "--mcp-server",
                    "--channel",
                    str(channel.root),
                    "--timeout",
                    "10",
                ],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
            )
            self.addCleanup(lambda: process.kill() if process.poll() is None else None)
            assert process.stdin is not None and process.stdout is not None

            def send(payload: dict) -> dict:
                process.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
                process.stdin.flush()
                return json.loads(process.stdout.readline())

            send({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {}},
            })
            process.stdin.write(json.dumps({
                "jsonrpc": "2.0", "id": 2, "method": "tools/call",
                "params": {"name": "permission_prompt", "arguments": {
                    "tool_name": "AskUserQuestion",
                    "tool_use_id": "toolu-commit-order",
                    "input": {"questions": [{"question": "继续？", "options": [{"label": "继续"}]}]},
                }},
            }, ensure_ascii=False) + "\n")
            process.stdin.flush()
            request = None
            for _ in range(100):
                pending = channel.pending()
                if pending:
                    request = pending[0]
                    break
                time.sleep(0.02)
            self.assertIsNotNone(request)
            bridge_id = str(request["bridge_request_id"])
            response = agent_host_bridge.build_permission_prompt_response(
                request, "answer", answers={"继续？": "继续"},
            )
            agent_host_bridge._atomic_json(
                channel.responses / f"{bridge_id}.json", response, create_only=True,
            )
            output: queue.Queue[str] = queue.Queue()
            reader = threading.Thread(target=lambda: output.put(process.stdout.readline()), daemon=True)
            reader.start()
            time.sleep(0.2)
            self.assertTrue(output.empty(), "MCP consumed an uncommitted response file")

            channel.respond(bridge_id, response, action="answer")
            line = output.get(timeout=2)
            decision = json.loads(json.loads(line)["result"]["content"][0]["text"])
            self.assertEqual(decision["updatedInput"]["answers"], {"继续？": "继续"})
            process.stdin.close()
            process.wait(timeout=5)
            process.stdout.close()
            assert process.stderr is not None
            process.stderr.close()


if __name__ == "__main__":
    unittest.main()
