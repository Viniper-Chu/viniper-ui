from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

import agent_host_bridge
import agent_run_coordinator as coordinator_module
import server


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures" / "v16"


def fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class DurableInteractionProtocolTests(unittest.TestCase):
    def store(self, path: Path):
        store_type = getattr(coordinator_module, "DurableInteractionStore", None)
        self.assertIsNotNone(store_type, "server-authoritative durable interaction store is required")
        return store_type(path)

    def test_multi_question_unknown_fields_answers_and_four_stage_ack_survive_restart(self) -> None:
        matrix = fixture("askuserquestion-protocol-matrix.json")
        normalized = agent_host_bridge.normalize_permission_prompt_request({
            "tool_name": matrix["tool_name"],
            "tool_use_id": matrix["tool_use_id"],
            "input": matrix["input"],
            "agent_id": matrix["agent_id"],
            "response": matrix["response"],
        }, bridge_request_id=matrix["bridge_request_id"])
        self.assertIsNotNone(normalized)
        self.assertEqual(normalized["questions"], matrix["input"]["questions"])

        residue = ROOT / "codex" / "运行残留"
        residue.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=residue) as temp:
            path = Path(temp) / "interaction-state.json"
            store = self.store(path)
            created = store.create({
                **normalized,
                "session_id": matrix["session_id"],
                "run_id": matrix["run_id"],
                "process_identity": matrix["process_identity"],
                "host_channel": str(Path(temp) / "channel"),
            })
            self.assertEqual(created["state"], "created")
            pending = store.mark_pending(matrix["session_id"], matrix["tool_use_id"])
            self.assertEqual(pending["state"], "pending")

            public = store.public_for_session(matrix["session_id"])
            self.assertEqual(public["tool_name"], "AskUserQuestion")
            self.assertEqual(public["tool_use_id"], matrix["tool_use_id"])
            self.assertEqual(public["run_id"], matrix["run_id"])
            self.assertEqual(public["questions"], matrix["input"]["questions"])
            self.assertEqual(public["questions"][0]["preview"], "首题安全预览")
            self.assertEqual(public["questions"][0]["futureQuestionField"], {"version": 1, "enabled": True})
            self.assertEqual(public["questions"][0]["options"][0]["preview"], "保留当前模块边界")
            self.assertEqual(public["questions"][0]["options"][0]["futureOptionField"], "safe-option-extension")
            self.assertEqual(public["agent_id"], matrix["agent_id"])
            self.assertEqual(public["response"], matrix["response"])

            store.begin_answer(matrix["session_id"], matrix["tool_use_id"])
            response = agent_host_bridge.build_permission_prompt_response(
                normalized, "answer", answers=matrix["answers"],
            )
            self.assertEqual(response["updatedInput"]["questions"], matrix["input"]["questions"])
            self.assertEqual(response["updatedInput"]["answers"]["选择验证项？"], "单元测试, 界面测试")
            self.assertEqual(response["updatedInput"]["answers"]["补充说明？"], "保留用户输入的自由文本")
            committed = store.commit_response(
                matrix["session_id"], matrix["tool_use_id"], action="answer", response=response,
            )
            self.assertEqual(committed["state"], "response_committed")
            store.mark_awaiting_cli_ack(matrix["session_id"], matrix["tool_use_id"])

            restarted = self.store(path)
            self.assertEqual(restarted.public_for_session(matrix["session_id"])["interaction_state"], "awaiting_cli_ack")
            for stage in matrix["expected_ack_stages"]:
                restarted.record_ack(
                    matrix["session_id"], matrix["tool_use_id"], stage,
                    success=True if stage == "cli_tool_result" else None,
                )
            terminal = restarted.latest_for_session(matrix["session_id"])
            self.assertEqual(terminal["state"], "accepted")
            self.assertIsNone(restarted.public_for_session(matrix["session_id"]))
            self.assertEqual(terminal["ack_stages"], matrix["expected_ack_stages"])

            second_request = {**normalized, "request_id": "call_matrix_ask_deny", "tool_use_id": "call_matrix_ask_deny"}
            store.create({
                **second_request,
                "session_id": "matrix-session-deny",
                "run_id": "matrix-run-deny",
                "process_identity": "matrix-process-deny",
            })
            store.mark_pending("matrix-session-deny", "call_matrix_ask_deny")
            denied = store.commit_response(
                "matrix-session-deny", "call_matrix_ask_deny",
                action="deny", response=matrix["deny_result"],
            )
            self.assertEqual(denied["response"], matrix["deny_result"])

    def test_permission_safe_payload_real_traces_and_idempotency_are_fail_closed(self) -> None:
        matrix = fixture("permission-protocol-matrix.json")
        residue = ROOT / "codex" / "运行残留"
        residue.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=residue) as temp:
            store = self.store(Path(temp) / "interaction-state.json")
            for index, item in enumerate(matrix["tool_inputs"]):
                request_id = f"permission-{index}"
                raw = {
                    "tool_name": item["tool_name"],
                    "tool_use_id": request_id,
                    "input": item["input"],
                    "permission_suggestions": matrix["permission_suggestions"] if item["tool_name"] == "Write" else [],
                    **matrix["permission_context"],
                }
                normalized = agent_host_bridge.normalize_permission_prompt_request(raw, bridge_request_id=f"bridgepermission{index}")
                created = store.create({
                    **normalized,
                    "session_id": f"P{index}",
                    "run_id": f"run-P{index}",
                    "process_identity": f"process-P{index}",
                    "risk": item["risk"],
                })
                self.assertEqual(created["state"], "created")
                store.mark_pending(f"P{index}", request_id)
                public = store.public_for_session(f"P{index}")
                public_text = json.dumps(public, ensure_ascii=False)
                self.assertEqual(public["tool_name"], item["tool_name"])
                self.assertEqual(public["risk"], item["risk"])
                self.assertEqual(public["blocked_path"], matrix["permission_context"]["blocked_path"])
                self.assertEqual(public["decision_reason"], matrix["permission_context"]["decision_reason"])
                self.assertEqual(public["title"], matrix["permission_context"]["title"])
                self.assertEqual(public["display_name"], matrix["permission_context"]["display_name"])
                self.assertEqual(public["agent_id"], matrix["permission_context"]["agent_id"])
                self.assertNotIn("MUST_NOT_REACH_RENDERER", public_text)
                self.assertNotIn("SECRET_OLD", public_text)
                self.assertNotIn("SECRET_NEW", public_text)
                self.assertNotIn('"env"', public_text)

            write = store.latest_for_session("P1")
            self.assertEqual(write["private"]["tool_input"], matrix["tool_inputs"][1]["input"])
            self.assertEqual(write["private"]["permission_suggestions"], matrix["permission_suggestions"])
            self.assertEqual(write["private"]["context"]["signal"], {"present": True, "aborted": False})
            store.begin_answer("P1", "permission-1")
            response = agent_host_bridge.build_permission_prompt_response(
                agent_host_bridge.normalize_permission_prompt_request({
                    "tool_name": "Write",
                    "tool_use_id": "permission-1",
                    "input": matrix["tool_inputs"][1]["input"],
                    "permission_suggestions": matrix["permission_suggestions"],
                }, bridge_request_id="bridgepermission1"),
                "allow_always",
            )
            first = store.commit_response("P1", "permission-1", action="allow_always", response=response)
            second = store.commit_response("P1", "permission-1", action="allow_always", response=response)
            self.assertEqual(first, second, "same submit must be idempotent")
            with self.assertRaises(ValueError):
                store.commit_response(
                    "P1", "permission-1", action="deny",
                    response={"behavior": "deny", "message": "conflict"},
                )
            self.assertEqual(first["response"]["updatedPermissions"], matrix["permission_suggestions"])
            self.assertEqual(
                [item for item in matrix["permission_update_destinations"]],
                ["userSettings", "projectSettings", "localSettings", "session", "cliArg"],
            )
            self.assertEqual(matrix["permission_results"]["allow"]["toolUseID"], "permission-1")
            self.assertEqual(matrix["permission_results"]["deny"]["interrupt"], False)

            ask_trace = matrix["real_ask_trace"]
            self.assertTrue((ROOT / ask_trace["source_evidence"]).exists())
            self.assertEqual(ask_trace["stages"], [
                "response_committed", "response_read", "mcp_response_written_and_flushed", "cli_tool_result",
            ])
            self.assertTrue(ask_trace["cli_tool_result_success"])
            self.assertTrue((ROOT / matrix["real_write_trace"]["source_evidence"]).exists())
            self.assertEqual(matrix["real_write_trace"]["stages"], ["response_committed"])

            denied_event = matrix["permission_denied_event"]
            denied = store.record_permission_denied(denied_event)
            self.assertEqual(denied["state"], "denied")
            self.assertEqual(denied["tool_use_id"], denied_event["tool_use_id"])
            self.assertEqual(denied["agent_id"], denied_event["agent_id"])
            self.assertEqual(denied["matching_tool_result"], denied_event["tool_result"])
            self.assertIsNone(store.public_for_session(denied_event["session_id"]), "system permission_denied is a terminal event, not a card")

    def test_orphan_interaction_remains_visible_as_failed_and_never_auto_allows(self) -> None:
        trace = fixture("permission-protocol-matrix.json")["orphan_write_trace"]
        residue = ROOT / "codex" / "运行残留"
        residue.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=residue) as temp:
            store = self.store(Path(temp) / "interaction-state.json")
            normalized = agent_host_bridge.normalize_permission_prompt_request({
                "tool_name": trace["tool_name"],
                "tool_use_id": trace["request_id"],
                "input": trace["input"],
            }, bridge_request_id="orphanbridge01")
            store.create({
                **normalized,
                "session_id": trace["session_id"],
                "run_id": trace["run_id"],
                "process_identity": "orphan-process",
            })
            store.mark_pending(trace["session_id"], trace["request_id"])
            failed = store.fail_owner(
                trace["session_id"], trace["run_id"],
                reason="运行 owner 已失效；请求未执行",
            )
            self.assertEqual(failed["state"], "failed")
            public = self.store(Path(temp) / "interaction-state.json").public_for_session(trace["session_id"])
            self.assertEqual(public["interaction_state"], "failed")
            self.assertTrue(public["terminal"])
            self.assertEqual(public["allowed_actions"], [])
            self.assertIn("未执行", public["failure_message"])
            self.assertNotIn("response", failed)
            self.assertFalse(trace["target_created"])
            self.assertEqual(trace["responses"], 0)
            self.assertEqual(trace["acks"], 0)

    def test_runtime_state_comes_from_durable_interaction_after_backend_restart(self) -> None:
        matrix = fixture("askuserquestion-protocol-matrix.json")
        residue = ROOT / "codex" / "运行残留"
        residue.mkdir(parents=True, exist_ok=True)
        original_data_dir = server.DATA_DIR
        original_coordinator = server._agent_run_coordinator
        original_runs = dict(server._active_runs)
        with tempfile.TemporaryDirectory(dir=residue) as temp:
            root = Path(temp)
            try:
                server.DATA_DIR = root
                server._agent_run_coordinator = None
                server._active_runs.clear()
                normalized = agent_host_bridge.normalize_permission_prompt_request({
                    "tool_name": matrix["tool_name"],
                    "tool_use_id": matrix["tool_use_id"],
                    "input": matrix["input"],
                }, bridge_request_id=matrix["bridge_request_id"])
                store = server.durable_interaction_store()
                store.create({
                    **normalized,
                    "session_id": matrix["session_id"],
                    "run_id": matrix["run_id"],
                    "process_identity": matrix["process_identity"],
                })
                store.mark_pending(matrix["session_id"], matrix["tool_use_id"])
                self.assertEqual(server.session_runtime_state(matrix["session_id"], {}), "waiting_input")
                store.fail_owner(matrix["session_id"], matrix["run_id"], reason="任务中断；请求未执行")
                self.assertEqual(server.session_runtime_state(matrix["session_id"], {}), "failed")
            finally:
                server.DATA_DIR = original_data_dir
                server._agent_run_coordinator = original_coordinator
                server._active_runs.clear()
                server._active_runs.update(original_runs)

    def test_plain_hello_does_not_create_an_interaction(self) -> None:
        residue = ROOT / "codex" / "运行残留"
        residue.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=residue) as temp:
            store = self.store(Path(temp) / "interaction-state.json")
            self.assertIsNone(agent_host_bridge.normalize_permission_prompt_request({
                "tool_name": "",
                "tool_use_id": "",
                "input": {"text": "你好"},
            }, bridge_request_id="hello01"))
            self.assertEqual(store.active(), [])

    def test_permission_denied_projection_persists_the_same_terminal_tool_result(self) -> None:
        event = fixture("permission-protocol-matrix.json")["permission_denied_event"]
        residue = ROOT / "codex" / "运行残留"
        residue.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=residue) as temp:
            store = self.store(Path(temp) / "interaction-state.json")
            projected = server.project_permission_denied_event(
                event,
                session_id=event["session_id"],
                run_id="permission-denied-run",
                store=store,
            )
            terminal = store.latest_for_session(event["session_id"])
            self.assertEqual(projected["type"], "tool_result")
            self.assertEqual(projected["tool_id"], event["tool_use_id"])
            self.assertTrue(projected["is_error"])
            self.assertEqual(terminal["state"], "denied")
            self.assertEqual(terminal["matching_tool_result"]["tool_use_id"], event["tool_use_id"])
            self.assertEqual(terminal["matching_tool_result"]["content"], projected["content"])
            self.assertTrue(terminal["matching_tool_result"]["is_error"])
            self.assertIsNone(store.public_for_session(event["session_id"]))


class DurableBrokerRestartTests(unittest.IsolatedAsyncioTestCase):
    async def test_broker_restart_restores_same_card_and_same_response_is_idempotent(self) -> None:
        matrix = fixture("askuserquestion-protocol-matrix.json")
        residue = ROOT / "codex" / "运行残留"
        residue.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=residue) as temp:
            root = Path(temp)
            store = coordinator_module.DurableInteractionStore(root / "interaction-state.json")
            channel = agent_host_bridge.HostInteractionChannel(
                root / "channel",
                session_id=matrix["session_id"],
                run_id=matrix["run_id"],
            )
            normalized = agent_host_bridge.normalize_permission_prompt_request({
                "tool_name": matrix["tool_name"],
                "tool_use_id": matrix["tool_use_id"],
                "input": matrix["input"],
                "agent_id": matrix["agent_id"],
                "response": matrix["response"],
            }, bridge_request_id=matrix["bridge_request_id"])
            first = server.AgentInteractionBroker(store_factory=store)
            card = first.create_host_request(
                matrix["session_id"],
                matrix["process_identity"],
                normalized,
                channel,
                run={"pending_interaction": matrix["tool_use_id"]},
            )
            self.assertEqual(card["interaction_state"], "pending")
            self.assertEqual(card["questions"], matrix["input"]["questions"])

            restarted = server.AgentInteractionBroker(store_factory=store)
            restored = restarted.pending_for(matrix["session_id"])
            self.assertEqual(restored["request_id"], matrix["tool_use_id"])
            self.assertEqual(restored["run_id"], matrix["run_id"])
            result = await restarted.resolve(
                matrix["session_id"],
                matrix["tool_use_id"],
                "question",
                "answer",
                process_identity=matrix["process_identity"],
                answers=matrix["answers"],
                run={"pending_interaction": matrix["tool_use_id"]},
            )
            self.assertEqual(result["status"], "awaiting_cli_ack")
            response = json.loads((channel.responses / f"{matrix['bridge_request_id']}.json").read_text(encoding="utf-8"))
            self.assertEqual(response["updatedInput"]["questions"], matrix["input"]["questions"])
            self.assertEqual(response["updatedInput"]["answers"]["补充说明？"], "保留用户输入的自由文本")
            self.assertEqual(restarted.pending_for(matrix["session_id"])["interaction_state"], "awaiting_cli_ack")

            duplicate = await restarted.resolve(
                matrix["session_id"],
                matrix["tool_use_id"],
                "question",
                "answer",
                process_identity=matrix["process_identity"],
                answers=matrix["answers"],
                run={"pending_interaction": matrix["tool_use_id"]},
            )
            self.assertEqual(duplicate["status"], "awaiting_cli_ack")
            self.assertEqual(
                len(list(channel.responses.glob(f"{matrix['bridge_request_id']}.json"))),
                1,
                "duplicate submit must not create a second response/tool result",
            )

    async def test_user_deny_accepts_the_matching_error_tool_result_as_protocol_ack(self) -> None:
        matrix = fixture("permission-protocol-matrix.json")
        residue = ROOT / "codex" / "运行残留"
        residue.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=residue) as temp:
            root = Path(temp)
            store = coordinator_module.DurableInteractionStore(root / "interaction-state.json")
            channel = agent_host_bridge.HostInteractionChannel(
                root / "channel", session_id="deny-session", run_id="deny-run",
            )
            normalized = agent_host_bridge.normalize_permission_prompt_request({
                "tool_name": "Write",
                "tool_use_id": "deny-tool-use",
                "input": matrix["tool_inputs"][1]["input"],
            }, bridge_request_id="denybridge01")
            broker = server.AgentInteractionBroker(store_factory=store)
            card = broker.create_host_request(
                "deny-session", "deny-process", normalized, channel,
                run={"pending_interaction": "deny-tool-use"},
            )
            self.assertEqual(card["interaction_state"], "pending")
            result = await broker.resolve(
                "deny-session", "deny-tool-use", "permission", "deny",
                process_identity="deny-process",
            )
            self.assertEqual(result["status"], "awaiting_cli_ack")
            agent_host_bridge._record_ack_stage(channel.root, "denybridge01", "response_read")
            agent_host_bridge._record_ack_stage(
                channel.root, "denybridge01", agent_host_bridge.MCP_RESPONSE_ACK_STAGE,
            )
            confirmed = broker.confirm_cli_tool_result(
                "deny-session", "deny-tool-use", success=False,
            )
            self.assertTrue(confirmed["accepted"], "an expected deny is confirmed by a matching error tool_result")
            self.assertEqual(confirmed["terminal_state"], "denied")
            terminal = store.latest_for_session("deny-session")
            self.assertEqual(terminal["state"], "denied")
            self.assertIsNone(store.public_for_session("deny-session"))


class RendererDurableInteractionTests(unittest.TestCase):
    def test_renderer_preserves_unknown_question_fields_and_server_state(self) -> None:
        electron = ROOT / "desktop" / "node_modules" / "electron" / "dist" / "electron.exe"
        self.assertTrue(electron.exists(), "Electron test runtime is missing")
        result = subprocess.run(
            [str(electron), str(ROOT / "tests" / "interaction_durability_renderer_harness.js")],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertNotIn("__harnessError", payload, payload.get("__harnessError"))
        self.assertEqual(payload["pending"]["preview"], "首题安全预览")
        self.assertEqual(payload["pending"]["futureField"], {"version": 1, "enabled": True})
        self.assertEqual(payload["pending"]["optionPreview"], "保留当前模块边界")
        self.assertTrue(payload["pending"]["submitEnabled"])
        self.assertTrue(payload["awaitingAck"]["cardVisible"])
        self.assertFalse(payload["awaitingAck"]["submitEnabled"])
        self.assertIn("等待 Claude 确认", payload["awaitingAck"]["status"])
        self.assertTrue(payload["failed"]["cardVisible"])
        self.assertEqual(payload["failed"]["actionCount"], 0)
        self.assertFalse(payload["failed"]["submitEnabled"])
        self.assertIn("任务中断", payload["failed"]["status"])
        self.assertTrue(payload["failedEvent"]["cardVisible"])
        self.assertEqual(payload["failedEvent"]["actionCount"], 0)
        self.assertEqual(payload["failedEvent"]["interactionState"], "failed")
        self.assertFalse(payload["failedEvent"]["submitEnabled"])
        self.assertIn("未执行", payload["failedEvent"]["status"])
        self.assertTrue(payload["disconnectFailure"]["pending"])
        self.assertEqual(payload["disconnectFailure"]["requestId"], "call_matrix_ask_01")
        self.assertEqual(payload["disconnectFailure"]["status"], "failed")


if __name__ == "__main__":
    unittest.main()
