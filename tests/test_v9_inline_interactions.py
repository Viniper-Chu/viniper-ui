"""v9 synthetic contracts for structured inline interactions and transient thinking."""

from __future__ import annotations

import asyncio
import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tests._isolation import configure_server_data_root

configure_server_data_root()
import server  # noqa: E402


class AgentInteractionBrokerTests(unittest.IsolatedAsyncioTestCase):
    async def test_structured_request_pauses_and_same_process_response_is_ndjson(self) -> None:
        broker = server.AgentInteractionBroker()
        request = broker.create_request(
            "session-a",
            process_identity="pid:42",
            payload={
                "type": "control_request",
                "request_id": "req-1",
                "request": {
                    "subtype": "can_use_tool",
                    "tool_name": "Bash",
                    "input": {"command": "echo hi"},
                    "permission_suggestions": ["allow_once"],
                },
            },
        )
        self.assertEqual(request["kind"], "permission")
        self.assertEqual(request["allowed_actions"], ["deny", "allow_once"])
        self.assertNotIn("input", request)

        writes: list[str] = []

        class Writer:
            def write(self, value: bytes) -> None:
                writes.append(value.decode("utf-8"))

            async def drain(self) -> None:
                return None

        resolved = await broker.resolve(
            "session-a",
            request_id="req-1",
            kind="permission",
            action="allow_once",
            stdin=Writer(),
            process_identity="pid:42",
        )
        self.assertEqual(resolved["action"], "allow_once")
        self.assertEqual(json.loads(writes[0])["type"], "control_response")
        self.assertEqual(json.loads(writes[0])["request_id"], "req-1")
        with self.assertRaises(server.InteractionRequestError):
            await broker.resolve(
                "session-a",
                request_id="req-1",
                kind="permission",
                action="allow_once",
                stdin=Writer(),
                process_identity="pid:42",
            )

        question = broker.create_request(
            "session-q",
            process_identity="pid:q",
            payload={"type": "control_request", "request_id": "req-q", "request": {"subtype": "AskUserQuestion", "questions": [{"question": "继续？"}]}},
        )
        question_writes: list[str] = []

        class QuestionWriter(Writer):
            def write(self, value: bytes) -> None:
                question_writes.append(value.decode("utf-8"))

        await broker.resolve(
            "session-q",
            "req-q",
            "question",
            "answer",
            stdin=QuestionWriter(),
            process_identity="pid:q",
            answers={"继续？": "继续"},
        )
        question_response = json.loads(question_writes[0])["response"]
        self.assertEqual(question_response["behavior"], "allow")
        self.assertEqual(question_response["updatedInput"]["answers"]["继续？"], "继续")

    async def test_question_response_preserves_original_questions_and_normalizes_answers(self) -> None:
        broker = server.AgentInteractionBroker()
        original_questions = [
            {
                "question": "选择格式",
                "header": "格式",
                "multiSelect": False,
                "options": [{"label": "摘要", "description": "短"}],
                "preview": {"kind": "fixture"},
            },
            {
                "question": "包含哪些部分",
                "header": "部分",
                "multiSelect": True,
                "options": [{"label": "开头"}, {"label": "结尾"}],
            },
            {"question": "补充说明", "options": []},
        ]
        pending = broker.create_request(
            "session-q-contract",
            process_identity="pid:q-contract",
            payload={"type": "control_request", "request_id": "req-q-contract", "request": {"subtype": "AskUserQuestion", "questions": original_questions}},
        )
        self.assertEqual(pending["questions"][0]["question"], "选择格式")

        writes: list[str] = []

        class Writer:
            def write(self, value: bytes) -> None:
                writes.append(value.decode("utf-8"))

            async def drain(self) -> None:
                return None

        await broker.resolve(
            "session-q-contract",
            "req-q-contract",
            "question",
            "answer",
            stdin=Writer(),
            process_identity="pid:q-contract",
            answers={"选择格式": "摘要", "包含哪些部分": ["开头", "结尾"], "补充说明": "按原文继续"},
        )
        response = json.loads(writes[0])["response"]
        self.assertEqual(response["updatedInput"]["questions"], original_questions)
        self.assertEqual(response["updatedInput"]["answers"], {"选择格式": "摘要", "包含哪些部分": "开头, 结尾", "补充说明": "按原文继续"})
        self.assertNotIn("answers", response)

    async def test_permission_display_is_safe_and_future_rule_is_real(self) -> None:
        permission_update = {
            "type": "addRules",
            "destination": "localSettings",
            "rules": [{"tool": "Bash", "path": "D:\\safe"}],
        }
        broker = server.AgentInteractionBroker()
        pending = broker.create_request(
            "session-permission-contract",
            process_identity="pid:permission-contract",
            payload={
                "type": "control_request",
                "request_id": "req-permission-contract",
                "request": {
                    "subtype": "can_use_tool",
                    "tool_name": "Bash",
                    "description": "运行本次命令",
                    "input": {
                        "command": "echo safe",
                        "description": "打印结果",
                        "file_path": "D:\\safe\\a.txt",
                        "content": "DO_NOT_RENDER_" + ("x" * 5000),
                        "env": {"SECRET_TOKEN": "DO_NOT_RENDER"},
                        "key": "DO_NOT_RENDER",
                    },
                    "permission_suggestions": [permission_update],
                },
            },
            workdir="D:\\safe",
        )
        serialized = json.dumps(pending, ensure_ascii=False)
        self.assertEqual(pending["display"], {"command": "echo safe", "file_path": "D:\\safe\\a.txt", "description": "打印结果"})
        self.assertIn("allow_always", pending["allowed_actions"])
        self.assertNotIn("DO_NOT_RENDER", serialized)
        self.assertNotIn("content", serialized)
        self.assertNotIn("env", serialized)
        self.assertNotIn("key", serialized)

        class Writer:
            def __init__(self) -> None:
                self.writes: list[str] = []

            def write(self, value: bytes) -> None:
                self.writes.append(value.decode("utf-8"))

            async def drain(self) -> None:
                return None

        writer = Writer()
        await broker.resolve(
            "session-permission-contract",
            "req-permission-contract",
            "permission",
            "allow_always",
            stdin=writer,
            process_identity="pid:permission-contract",
        )
        response = json.loads(writer.writes[0])["response"]
        self.assertEqual(response["updatedPermissions"], [permission_update])
        self.assertEqual(response["updatedInput"]["command"], "echo safe")

        string_only = server.normalize_control_request({
            "type": "control_request",
            "request_id": "req-no-rule",
            "request": {"subtype": "can_use_tool", "tool_name": "Bash", "input": {"command": "echo safe"}, "permission_suggestions": ["allow_always"]},
        })
        self.assertEqual(string_only["allowed_actions"], ["deny", "allow_once"])
        self.assertEqual(server.build_control_response_envelope({**string_only, "_permission_updates": []}, "allow_always")["response"]["behavior"], "deny")

    async def test_wrong_stale_duplicate_and_stop_are_rejected_without_auto_allow(self) -> None:
        broker = server.AgentInteractionBroker()
        broker.create_request(
            "session-b",
            process_identity="pid:7",
            payload={"type": "control_request", "request_id": "req-2", "request": {"subtype": "AskUserQuestion", "questions": [{"question": "继续？", "options": [{"label": "是"}, {"label": "否"}]}]}},
        )
        self.assertEqual(broker.pending_for("session-b")["request_id"], "req-2")
        self.assertIsNone(broker.create_request(
            "session-b",
            process_identity="pid:8",
            payload={"type": "control_request", "request_id": "req-2", "request": {"subtype": "AskUserQuestion", "questions": []}},
        ))
        with self.assertRaises(server.InteractionRequestError):
            await broker.resolve("session-b", "wrong", "question", "0", stdin=None, process_identity="pid:7")
        broker.invalidate("session-b", reason="stop")
        self.assertIsNone(broker.pending_for("session-b"))

    def test_control_request_normalizer_does_not_guess_from_plain_text(self) -> None:
        self.assertIsNone(server.normalize_control_request({"type": "assistant", "text": "请运行命令并允许文件"}))
        normalized = server.normalize_control_request({"type": "control_request", "request_id": "q", "request": {"subtype": "ask_user_question", "questions": []}})
        self.assertEqual(normalized["kind"], "question")
        cli_question = server.normalize_control_request({
            "type": "control_request",
            "request_id": "q-cli",
            "request": {
                "subtype": "can_use_tool",
                "tool_name": "AskUserQuestion",
                "input": {"questions": [{"question": "继续吗？", "options": [{"label": "继续"}]}]},
            },
        })
        self.assertEqual(cli_question["kind"], "question")

    async def test_two_fake_cli_sessions_overlap_and_a_resumes_same_process_after_answer(self) -> None:
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
                "claude_session_id": session_id,
                "claude_initialized": False,
                "summary": "",
            }

        script = (
            "import json,sys,time\n"
            "first=json.loads(sys.stdin.readline())\n"
            "prompt=json.dumps(first,ensure_ascii=False)\n"
            "if 'A任务' in prompt:\n"
            " print(json.dumps({'type':'control_request','request_id':'req-A','request':{'subtype':'can_use_tool','tool_name':'Bash','input':{'command':'echo A'}}}),flush=True)\n"
            " answer=json.loads(sys.stdin.readline())\n"
            " print(json.dumps({'type':'assistant','message':{'content':[{'type':'text','text':'A继续'}]}}),flush=True)\n"
            "else:\n"
            " print(json.dumps({'type':'assistant','message':{'content':[{'type':'text','text':'B完成'}]}}),flush=True)\n"
            "print(json.dumps({'type':'result','result':'done'}),flush=True)\n"
        )
        server.sessions.clear()
        server._active_runs.clear()
        server.sessions["A"] = agent_session("A")
        server.sessions["B"] = agent_session("B")

        async def no_orphan(_session_id: str) -> None:
            return None

        cfg = {"model": "fake-model", "api_key": "fake", "base_url": "http://fake", "label": "fake"}
        with (
            patch.object(server, "deepseek_config", return_value=cfg),
            patch.object(server, "_agent_runtime", server.WindowsNativeRuntime([sys.executable, "-u", "-c", script])),
            patch.object(server, "kill_orphaned_claude_session", new=no_orphan),
            patch.object(server, "save_sessions_to_disk"),
        ):
            events_a: list[dict] = []
            events_b: list[dict] = []
            saw_overlapping_processes = False

            async def consume(session_id: str, prompt: str, target: list[dict]) -> None:
                async for event in server.AGENT_TRANSPORT.stream(session_id, prompt, model="fake-model", permission_mode="default"):
                    target.append(event)

            task_a = asyncio.create_task(consume("A", "A任务", events_a))
            task_b = asyncio.create_task(consume("B", "B任务", events_b))
            for _ in range(40):
                if "A" in server._active_runs and "B" in server._active_runs:
                    saw_overlapping_processes = True
                if server.agent_interaction_broker.pending_for("A") and task_b.done():
                    break
                await asyncio.sleep(0.025)
            self.assertTrue(task_b.done(), "B should finish while A waits for input")
            self.assertTrue(saw_overlapping_processes, "A and B must have distinct overlapping process registrations")
            self.assertTrue(server.sessions["B"]["unread"])
            self.assertEqual(server.agent_interaction_broker.pending_for("A")["request_id"], "req-A")
            run_a = server._active_runs["A"]
            await server.agent_interaction_broker.resolve(
                "A", "req-A", "permission", "allow_once",
                stdin=run_a["stdin"], process_identity=run_a["process_identity"],
            )
            await asyncio.wait_for(task_a, timeout=3)

        def decode(events: list[str]) -> list[dict]:
            return [json.loads(item.split("data: ", 1)[1].strip()) for item in events]

        decoded_a = decode(events_a)
        decoded_b = decode(events_b)
        self.assertIn({"type": "text", "content": "A继续"}, decoded_a)
        self.assertIn({"type": "text", "content": "B完成"}, decoded_b)
        self.assertEqual([item["type"] for item in decoded_a if item["type"] == "interaction_request"], ["interaction_request"])
        self.assertNotIn("A", server._active_runs)
        self.assertNotIn("B", server._active_runs)

    async def test_cancel_a_does_not_cancel_b(self) -> None:
        def agent_session(session_id: str) -> dict:
            return {
                "id": session_id, "mode": "agent", "messages": [], "created": 1, "updated": 1,
                "name": session_id, "workdir": str(ROOT), "pinned": False, "unread": False,
                "claude_session_id": session_id, "claude_initialized": False, "summary": "",
            }

        script = (
            "import json,sys,time\n"
            "first=json.loads(sys.stdin.readline())\n"
            "prompt=json.dumps(first,ensure_ascii=False)\n"
            "if 'A任务' in prompt:\n"
            " print(json.dumps({'type':'control_request','request_id':'req-cancel-A','request':{'subtype':'can_use_tool','tool_name':'Bash'}}),flush=True)\n"
            " sys.stdin.readline()\n"
            "else:\n"
            " time.sleep(0.35)\n"
            " print(json.dumps({'type':'assistant','message':{'content':[{'type':'text','text':'B仍在运行'}]}}),flush=True)\n"
            "print(json.dumps({'type':'result','result':'done'}),flush=True)\n"
        )
        server.sessions.clear(); server._active_runs.clear()
        server.sessions["A"] = agent_session("A")
        server.sessions["B"] = agent_session("B")

        async def no_orphan(_session_id: str) -> None:
            return None

        cfg = {"model": "fake-model", "api_key": "fake", "base_url": "http://fake", "label": "fake"}
        with (
            patch.object(server, "deepseek_config", return_value=cfg),
            patch.object(server, "_agent_runtime", server.WindowsNativeRuntime([sys.executable, "-u", "-c", script])),
            patch.object(server, "kill_orphaned_claude_session", new=no_orphan),
            patch.object(server, "save_sessions_to_disk"),
        ):
            async def consume(session_id: str, prompt: str) -> list[str]:
                return [item async for item in server.stream_chat(session_id, prompt, model="fake-model", permission_mode="default")]

            events_a = asyncio.create_task(consume("A", "A任务"))
            events_b = asyncio.create_task(consume("B", "B任务"))
            for _ in range(40):
                if server.agent_interaction_broker.pending_for("A") and "B" in server._active_runs:
                    break
                await asyncio.sleep(0.025)
            self.assertIsNotNone(server.agent_interaction_broker.pending_for("A"))
            await server.cancel_chat("A")
            await asyncio.wait_for(events_a, timeout=3)
            decoded_b = [json.loads(item.split("data: ", 1)[1].strip()) for item in await asyncio.wait_for(events_b, timeout=3)]
            self.assertIn({"type": "text", "content": "B仍在运行"}, decoded_b)
            self.assertNotIn("A", server._active_runs)
            self.assertNotIn("B", server._active_runs)


class V9PersistenceAndFrontendTests(unittest.TestCase):
    def test_completed_segments_drop_thinking_but_keep_activity_and_text(self) -> None:
        segments = server.finalize_transcript_segments([
            {"type": "thinking", "content": "内部思考"},
            {"type": "tool_start", "tool_id": "t1", "name": "读取"},
            {"type": "tool_result", "tool_id": "t1", "status": "完成"},
            {"type": "artifact", "path": "out.txt"},
            {"type": "text", "content": "最终回复"},
        ])
        self.assertEqual([item["type"] for item in segments], ["tool_start", "tool_result", "artifact", "text"])

    def test_inline_contract_and_no_keyword_permission_path(self) -> None:
        script = r'''
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync("static/app.js", "utf8") + "\nthis.__api = { buildChatRequestBody, normalizeInteractionRequest, renderMessageSegments, renderInteractionCard };";
const context = {
  console, TextDecoder, TextEncoder, WeakMap,
  performance: { now: () => 0 },
  localStorage: { getItem: () => null, setItem: () => {} },
  document: { addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] },
  window: { VINIPER_APP_TITLE: "Viniper Preview" },
  setTimeout, clearTimeout, setInterval, clearInterval
};
vm.createContext(context);
vm.runInContext(source, context);
const request = context.__api.normalizeInteractionRequest({type:"interaction_request", request_id:"q1", kind:"question", questions:[{question:"继续？", options:[{label:"是"}]}]});
const multi = context.__api.renderInteractionCard({type:"interaction_request", request_id:"q2", kind:"question", questions:[{question:"第一题", header:"步骤一", options:[{label:"一"}]},{question:"第二题", header:"步骤二", multiSelect:true, options:[{label:"二"}]}]});
const chat = context.__api.buildChatRequestBody("chat", "请运行命令", "fake", "bypassPermissions", [{name:"secret.txt"}]);
const historical = context.__api.renderMessageSegments([{type:"thinking", content:"不应展示"},{type:"text", content:"正文"}], {hideThinking:true});
process.stdout.write(JSON.stringify({request, multi, chat, historical}));
'''
        result = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["request"]["request_id"], "q1")
        self.assertIn("1 / 2", payload["multi"])
        self.assertIn("data-question-action=\"next\"", payload["multi"])
        self.assertIn("data-question-other", payload["multi"])
        self.assertNotIn("permission_mode", payload["chat"])
        self.assertNotIn("secret.txt", json.dumps(payload["chat"], ensure_ascii=False))
        self.assertNotIn("不应展示", payload["historical"])

    def test_permission_card_renders_only_safe_command_and_path_fields(self) -> None:
        script = r'''
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync("static/app.js", "utf8") + "\nthis.__api = { normalizeInteractionRequest, renderInteractionCard };";
const context = {
  console, TextDecoder, TextEncoder, WeakMap,
  performance: { now: () => 0 },
  localStorage: { getItem: () => null, setItem: () => {} },
  document: { addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] },
  window: { VINIPER_APP_TITLE: "Viniper Preview" },
  setTimeout, clearTimeout, setInterval, clearInterval
};
vm.createContext(context);
vm.runInContext(source, context);
const card = context.__api.normalizeInteractionRequest({type:"interaction_request", request_id:"p-safe", kind:"permission", tool_name:"Bash", display:{command:"echo safe", file_path:"D:\\safe\\a.txt", description:"打印结果", content:"SECRET"}, allowed_actions:["deny","allow_once","allow_later"]});
const html = context.__api.renderInteractionCard({type:"interaction_request", ...card});
process.stdout.write(JSON.stringify({card, html}));
'''
        result = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["card"]["display"], {"command": "echo safe", "file_path": "D:\\safe\\a.txt", "description": "打印结果"})
        self.assertIn("echo safe", payload["html"])
        self.assertIn("D:\\safe\\a.txt", payload["html"])
        self.assertNotIn("SECRET", payload["html"])
        self.assertNotIn('data-interaction-action="allow_later"', payload["html"])

    def test_source_has_no_keyword_permission_guess_or_global_modal(self) -> None:
        app = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("PERMISSION_ACTION_RE", app)
        self.assertNotIn("resolvePermissionMode", app)
        self.assertNotIn('id="permission-modal"', html)

    def test_session_menu_contract_has_only_real_actions_and_single_anchor(self) -> None:
        app = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        self.assertIn("data-session-menu", app)
        self.assertIn("executeSessionMenuAction", app)
        self.assertIn('data-session-action="pin"', html)
        self.assertIn('data-session-action="unread"', html)
        self.assertIn('data-session-action="rename"', html)
        self.assertIn('data-session-action="delete"', html)
        self.assertNotIn("添加到项目", html)
        self.assertNotIn("移动到组", html)
        self.assertNotIn("data-delete-session", app)
        # The legacy pin marker remains only as an inert semantic alias; no legacy
        # direct event selector/handler is retained.
        self.assertNotIn('querySelectorAll("[data-session-pin]")', app)
        self.assertIn('addEventListener("contextmenu"', app)


class SessionMenuAndUnreadTests(unittest.IsolatedAsyncioTestCase):
    async def test_session_menu_actions_mutate_only_target_session(self) -> None:
        original = dict(server.sessions)
        try:
            server.sessions.clear()
            server.sessions.update({
                "agent-a": {
                    "id": "agent-a", "mode": "agent", "messages": [], "created": 1,
                    "updated": 2, "name": "原名", "workdir": str(ROOT), "pinned": False,
                    "unread": False,
                },
                "agent-b": {
                    "id": "agent-b", "mode": "agent", "messages": [], "created": 1,
                    "updated": 3, "name": "保留", "workdir": str(ROOT), "pinned": False,
                    "unread": False,
                },
            })

            class Request:
                headers = {"content-type": "application/json"}

                def __init__(self, body):
                    self.body = body

                async def json(self):
                    return self.body

            with patch.object(server, "save_sessions_to_disk"), patch.object(server, "remove_session_runtime_data"):
                await server.update_session("agent-a", Request({"pinned": True}))
                await server.update_session("agent-a", Request({"unread": True}))
                await server.update_session("agent-a", Request({"name": "新名"}))
                self.assertTrue(server.sessions["agent-a"]["pinned"])
                self.assertTrue(server.sessions["agent-a"]["unread"])
                self.assertEqual(server.sessions["agent-a"]["name"], "新名")
                self.assertFalse(server.sessions["agent-b"]["pinned"])
                self.assertFalse(server.sessions["agent-b"]["unread"])

                deleted = await server.delete_session("agent-a")
                self.assertTrue(deleted["deleted"])
                self.assertNotIn("agent-a", server.sessions)
                self.assertIn("agent-b", server.sessions)
        finally:
            server.sessions.clear()
            server.sessions.update(original)

    async def test_unread_defaults_persists_and_open_clears_without_other_session_mutation(self) -> None:
        original = dict(server.sessions)
        try:
            server.sessions.clear()
            server.sessions.update({
                "chat-a": {"id": "chat-a", "mode": "chat", "messages": [], "created": 1, "updated": 2, "name": "A", "workdir": str(ROOT), "pinned": False},
                "chat-b": {"id": "chat-b", "mode": "chat", "messages": [], "created": 1, "updated": 3, "name": "B", "workdir": str(ROOT), "pinned": False, "unread": True},
            })
            with patch.object(server, "save_sessions_to_disk"):
                listing = await server.list_sessions()
                rows = {row["id"]: row for row in listing["sessions"]}
                self.assertFalse(rows["chat-a"]["unread"])
                self.assertEqual(rows["chat-b"]["runtime_state"], "completed_unread")

                class Request:
                    headers = {"content-type": "application/json"}

                    async def json(self):
                        return {"unread": True}

                await server.update_session("chat-a", Request())
                self.assertTrue(server.sessions["chat-a"]["unread"])
                await server.get_session("chat-a")
                self.assertFalse(server.sessions["chat-a"]["unread"])
                self.assertTrue(server.sessions["chat-b"]["unread"])
        finally:
            server.sessions.clear()
            server.sessions.update(original)

    async def test_runtime_state_and_running_delete_are_session_scoped(self) -> None:
        original_sessions = dict(server.sessions)
        original_runs = dict(server._active_runs)
        try:
            server.sessions.clear()
            server._active_runs.clear()
            server.sessions.update({
                "running-a": {"id": "running-a", "mode": "agent", "messages": [], "created": 1, "updated": 2, "name": "A", "workdir": str(ROOT), "pinned": False},
                "failed-b": {"id": "failed-b", "mode": "agent", "messages": [], "created": 1, "updated": 3, "name": "B", "workdir": str(ROOT), "pinned": False, "last_run_status": "failed"},
            })
            server._active_runs["running-a"] = {"kind": "agent", "status": "running"}
            listing = await server.list_sessions()
            rows = {row["id"]: row for row in listing["sessions"]}
            self.assertEqual(rows["running-a"]["runtime_state"], "running")
            self.assertEqual(rows["failed-b"]["runtime_state"], "failed")

            with self.assertRaises(server.HTTPException) as raised:
                await server.delete_session("running-a")
            self.assertEqual(raised.exception.status_code, 409)
            self.assertIn("running-a", server.sessions)
        finally:
            server.sessions.clear()
            server.sessions.update(original_sessions)
            server._active_runs.clear()
            server._active_runs.update(original_runs)


class RendererSessionRegistryTests(unittest.TestCase):
    def test_registry_switch_keeps_background_runs_and_menu_keyboard_is_real(self) -> None:
        script = r'''
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync("static/app.js", "utf8") + "\nthis.__api = {state, SessionRunRegistry, openSessionMenu, closeSessionMenu, handleSessionMenuKeydown};";
const classList = () => ({
  values: new Set(["hidden"]),
  add(name) { this.values.add(name); },
  remove(name) { this.values.delete(name); },
  contains(name) { return this.values.has(name); },
  toggle(name, force) { if (force === undefined ? !this.values.has(name) : force) this.values.add(name); else this.values.delete(name); }
});
const makeItem = (label) => ({dataset: {sessionAction: label}, disabled: false, focus() { document.activeElement = this; }});
const menu = {
  classList: classList(),
  attrs: {},
  style: {},
  offsetWidth: 160,
  offsetHeight: 120,
  setAttribute(k, v) { this.attrs[k] = String(v); },
  querySelector(selector) {
    if (selector.includes("data-session-action=\"pin\"") || selector.includes("data-session-pin")) return this.pin;
    if (selector.includes("data-session-action=\"unread\"")) return this.unread;
    if (selector === "[role=\"menuitem\"]") return this.items[0];
    return null;
  },
  querySelectorAll(selector) { return selector === '[role="menuitem"]' ? this.items : []; },
  pin: {textContent: "", dataset: {sessionAction: "pin"}, focus() { document.activeElement = this; }},
  unread: {textContent: "", dataset: {sessionAction: "unread"}, focus() { document.activeElement = this; }},
  items: [],
};
menu.items = [menu.pin, menu.unread, makeItem("rename"), makeItem("delete")];
const trigger = {dataset: {sessionMenu: "A"}, attrs: {}, setAttribute(k,v) {this.attrs[k] = String(v);}, getBoundingClientRect() {return {right: 180, bottom: 32};}, focus() {document.activeElement = this;}};
const document = {
  activeElement: null,
  documentElement: {dataset: {}},
  body: {classList: classList()},
  addEventListener() {},
  querySelector(selector) { if (selector === "#session-context-menu") return menu; return null; },
  querySelectorAll(selector) { if (selector === "[data-session-menu]") return [trigger]; return []; }
};
const context = {
  console, TextDecoder, TextEncoder, WeakMap, document,
  performance: {now: () => 0},
  localStorage: {getItem: () => null, setItem: () => {}, removeItem: () => {}},
  window: {VINIPER_APP_TITLE: "Viniper Preview", matchMedia: () => ({matches: false}), addEventListener() {}, innerWidth: 1000, innerHeight: 800},
  setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: (fn) => fn(),
  URL: {createObjectURL: () => "blob:test", revokeObjectURL() {}},
  File, TextDecoderStream: undefined,
  fetch: async () => ({ok: true, json: async () => ({})}),
  alert: () => {},
};
vm.createContext(context);
vm.runInContext(source, context);
const api = context.__api;
api.state.sessionIndex = [{id: "A", mode: "agent", name: "Alpha", pinned: false, unread: false}];
api.state.sessionId = "B";
api.SessionRunRegistry.start("A", {mode: "agent"});
api.SessionRunRegistry.start("B", {mode: "agent"});
api.SessionRunRegistry.update("A", {waitingInput: true, status: "waiting_input"});
if (!api.SessionRunRegistry.get("A").active || !api.SessionRunRegistry.get("B").active) throw new Error("switching must not cancel background runs");
api.state.sessionId = "A";
api.SessionRunRegistry.mirror("A");
if (!api.state.isStreaming || !api.SessionRunRegistry.get("A").waitingInput) throw new Error("current mirror was not restored");
api.openSessionMenu("A", trigger);
if (menu.classList.contains("hidden") || trigger.attrs["aria-expanded"] !== "true" || menu.pin.textContent !== "置顶") throw new Error("menu did not open on the selected session");
context.document.activeElement = menu.items[0];
api.handleSessionMenuKeydown({key: "End", preventDefault() {}});
if (context.document.activeElement !== menu.items[3]) throw new Error("End did not focus the last action");
api.closeSessionMenu({restoreFocus: true});
if (!menu.classList.contains("hidden") || context.document.activeElement !== trigger) throw new Error("menu close did not restore focus");
process.stdout.write(JSON.stringify({aActive: api.SessionRunRegistry.get("A").active, bActive: api.SessionRunRegistry.get("B").active}));
'''
        result = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {"aActive": True, "bActive": True})


if __name__ == "__main__":
    unittest.main()
