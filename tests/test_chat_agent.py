"""Synthetic v3 checks for Chat/Agent routing, cancellation and local skills."""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_ROOT = ROOT / "codex" / "运行残留"
RUNTIME_ROOT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT))

import server  # noqa: E402


def chat_session(session_id: str) -> dict:
    return {
        "id": session_id,
        "mode": "chat",
        "messages": [],
        "created": 1,
        "updated": 1,
        "name": session_id,
        "workdir": str(ROOT),
        "pinned": False,
        "claude_session_id": session_id,
        "claude_initialized": False,
        "summary": "",
    }


class ChatAgentTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        server.sessions.clear()
        server._active_runs.clear()
        server._chat_tasks.clear()
        self.session_id = "chat-test"
        server.sessions[self.session_id] = chat_session(self.session_id)

    def tearDown(self) -> None:
        server.sessions.clear()
        server._active_runs.clear()
        server._chat_tasks.clear()

    async def test_chat_fake_provider_has_text_only_payload_and_no_subprocess(self) -> None:
        captured: list[dict] = []

        async def provider(_cfg, payload):
            captured.append(payload)
            # A thinking block may begin without any thinking_delta; the
            # transport must still close it when visible text arrives.
            yield {"type": "content_block_start", "content_block": {"type": "thinking"}}
            yield {"type": "text", "content": "普通文字：请运行这个命令 /goal C:\\项目 [Claude Code 工具]"}

        transport = server.ChatTransport(provider_request=provider)
        with (
            patch.object(server, "provider_config", return_value={"model": "fake-model", "api_key": "fake", "base_url": "http://fake", "label": "fake"}),
            patch.object(server, "save_sessions_to_disk"),
            patch.object(server.asyncio, "create_subprocess_exec", side_effect=AssertionError("Chat must not spawn")),
            patch.object(server.asyncio, "create_subprocess_shell", side_effect=AssertionError("Chat must not spawn")),
        ):
            events = [event async for event in transport.stream(self.session_id, "/goal 请运行命令", "fake-model")]

        self.assertEqual(captured[0]["model"], "fake-model")
        self.assertTrue(captured[0]["stream"])
        self.assertNotIn("tools", captured[0])
        self.assertNotIn("tool_choice", captured[0])
        self.assertEqual([event["type"] for event in events], ["assistant_start", "thinking_start", "thinking_complete", "text", "done"])
        self.assertFalse(any(segment.get("type") in {"tool_start", "tool_result"} for message in server.sessions[self.session_id]["messages"] for segment in message.get("segments", [])))

    async def test_chat_cancel_cleans_pending_closes_provider_and_reuses_lock(self) -> None:
        started = asyncio.Event()
        closed = asyncio.Event()
        release = asyncio.Event()

        async def provider(_cfg, _payload):
            started.set()
            try:
                await release.wait()
                yield {"type": "text", "content": "不会到达"}
            finally:
                closed.set()

        transport = server.ChatTransport(provider_request=provider)
        original_transport = server.CHAT_TRANSPORT
        server.CHAT_TRANSPORT = transport

        async def consume() -> list[str]:
            return [chunk async for chunk in server.stream_chat(self.session_id, "取消我", model="fake-model")]

        try:
            with (
                patch.object(server, "provider_config", return_value={"model": "fake-model", "api_key": "fake", "base_url": "http://fake", "label": "fake"}),
                patch.object(server, "save_sessions_to_disk"),
            ):
                task = asyncio.create_task(consume())
                await started.wait()
                self.assertIn(self.session_id, server._active_runs)
                result = await server.cancel_chat(self.session_id)
                self.assertTrue(result["cancelled"])
                with self.assertRaises(asyncio.CancelledError):
                    await task
                await asyncio.wait_for(closed.wait(), timeout=1)
        finally:
            server.CHAT_TRANSPORT = original_transport
            release.set()

        messages = server.sessions[self.session_id]["messages"]
        self.assertFalse(any(message.get("pending") for message in messages))
        self.assertTrue(messages[-1].get("cancelled"))
        self.assertNotIn(self.session_id, server._active_runs)
        self.assertNotIn(self.session_id, server._chat_tasks)
        lock = server.session_lock(self.session_id)
        await asyncio.wait_for(lock.acquire(), timeout=1)
        lock.release()

    async def test_chat_endpoint_rejects_agent_fields_and_last_session_is_mode_scoped(self) -> None:
        class Request:
            def __init__(self, body):
                self.body = body

            async def json(self):
                return self.body

        with self.assertRaises(server.HTTPException):
            await server.chat(self.session_id, Request({"message": "x", "permission_mode": "default"}))
        server.sessions["agent-test"] = {**chat_session("agent-test"), "mode": "agent", "updated": 99, "messages": [{"role": "user", "content": "agent"}]}
        latest = await server.last_session("chat")
        self.assertEqual(latest["session"]["session_id"], self.session_id)
        self.assertEqual(server.normalize_session("legacy", {"messages": []})["mode"], "agent")

    def test_default_session_names_are_mode_specific(self) -> None:
        server.sessions.update({
            "chat-default": {"mode": "chat", "name": "新建聊天（1）"},
            "agent-default": {"mode": "agent", "name": "新建会话（1）"},
        })
        self.assertEqual(server.next_session_name("chat"), "新建聊天（2）")
        self.assertEqual(server.next_session_name("agent"), "新建会话（2）")


class LocalSkillsTests(unittest.IsolatedAsyncioTestCase):
    async def test_nested_skill_ids_are_stable_and_details_are_isolated(self) -> None:
        root = Path(tempfile.mkdtemp(prefix="skills-v3-", dir=RUNTIME_ROOT))
        try:
            claude = root / "claude"
            agents = root / "agents"
            (claude / "shared").mkdir(parents=True)
            (agents / "shared").mkdir(parents=True)
            (claude / "shared" / "SKILL.md").write_text("# Claude shared\nclaude detail", encoding="utf-8")
            (agents / "shared" / "SKILL.md").write_text("# Agents shared\nagents detail", encoding="utf-8")
            old_sources = server.SKILL_SOURCE_ROOTS
            old_dirs = server.PROJECT_SKILLS_DIRS
            old_cache = server._skills_cache
            server.SKILL_SOURCE_ROOTS = [("claude", claude), ("agents", agents)]
            server.PROJECT_SKILLS_DIRS = [claude, agents]
            server._skills_cache = {"time": 0.0, "items": []}
            try:
                items = server.get_skills()
                self.assertEqual(len(items), 2)
                self.assertEqual(len({item["id"] for item in items}), 2)
                self.assertEqual({item["source"] for item in items}, {"claude", "agents"})
                for item in items:
                    self.assertEqual(server.skill_file_from_record(item).name, "SKILL.md")
                    detail = await server.read_skill(item["id"])
                    self.assertIn("detail", detail["content"])
                    self.assertEqual(detail["id"], item["id"])
            finally:
                server.SKILL_SOURCE_ROOTS = old_sources
                server.PROJECT_SKILLS_DIRS = old_dirs
                server._skills_cache = old_cache
        finally:
            shutil.rmtree(root, ignore_errors=True)


class FrontendContractTests(unittest.TestCase):
    def test_fetch_body_and_activity_timeline_contracts(self) -> None:
        script = r'''
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync("static/app.js", "utf8") + "\nthis.__api = { buildChatRequestBody, renderMessageSegments, formatDuration };";
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
const chat = context.__api.buildChatRequestBody("chat", "/goal 请运行命令", "fake", "bypassPermissions", [{name:"x.txt"}]);
const agent = context.__api.buildChatRequestBody("agent", "任务", "fake", "default", [{name:"x.txt"}]);
const timeline = context.__api.renderMessageSegments([
  {type:"thinking", content:"", showEmpty:true, activeThinking:false, elapsed_seconds:2},
  {type:"tool_start", tool_id:"t1", name:"读取", status:"running"},
  {type:"tool_result", tool_id:"t1", status:"完成", content:"已完成"},
  {type:"text", content:"最终回复"}
], {totalElapsedSeconds:4});
process.stdout.write(JSON.stringify({chat, agent, timeline, duration: context.__api.formatDuration(4)}));
'''
        result = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["chat"], {"message": "/goal 请运行命令", "model": "fake"})
        self.assertEqual(payload["agent"]["permission_mode"], "default")
        self.assertIn('data-activity="tool_summary"', payload["timeline"])
        self.assertNotIn('data-activity="tool_start"', payload["timeline"])
        self.assertNotIn('data-activity="tool_result"', payload["timeline"])
        self.assertIn("已思考", payload["timeline"])
        self.assertNotIn("完成于 4秒", payload["timeline"])
        self.assertNotIn('message-total-time', payload["timeline"])
        self.assertEqual(payload["duration"], "4秒")
        self.assertIn("startThinking", (ROOT / "static" / "app.js").read_text(encoding="utf-8"))
        self.assertIn("completeThinking", (ROOT / "static" / "app.js").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
