"""v10 regressions for structured AskUserQuestion fallback and cold-start settings."""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tests._isolation import configure_server_data_root

configure_server_data_root()
import server  # noqa: E402


def run_v10_renderer_harness(*, force_stdout_epipe: bool = False) -> tuple[dict, dict]:
    def output_text(value: str | bytes | None) -> str:
        if isinstance(value, bytes):
            return value.decode("utf-8", errors="replace")
        return value or ""

    electron = ROOT / "desktop" / "node_modules" / "electron" / "dist" / "electron.exe"
    if not electron.exists():
        raise AssertionError("bundled Electron runtime is required for the renderer contract test")
    residue_root = ROOT / "codex" / "运行残留" / "test-harness-output"
    residue_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="v10-renderer-", dir=residue_root) as temp_dir:
        result_path = Path(temp_dir) / "result.json"
        env = dict(os.environ)
        env.pop("ELECTRON_RUN_AS_NODE", None)
        env["VINIPER_RENDERER_HARNESS_RESULT"] = str(result_path)
        if force_stdout_epipe:
            env["VINIPER_RENDERER_HARNESS_FORCE_EPIPE"] = "1"
        process = subprocess.Popen(
            [str(electron), "--disable-error-dialog", str(ROOT / "tests" / "v10_renderer_harness.js")],
            cwd=ROOT,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
        )
        timed_out = False
        try:
            stdout, stderr = process.communicate(timeout=30)
        except subprocess.TimeoutExpired as exc:
            timed_out = True
            process.terminate()
            try:
                tail_stdout, tail_stderr = process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                tail_stdout, tail_stderr = process.communicate(timeout=5)
            stdout = output_text(exc.output) + output_text(tail_stdout)
            stderr = output_text(exc.stderr) + output_text(tail_stderr)

        file_result = result_path.read_text(encoding="utf-8") if result_path.exists() else ""
        evidence = {
            "returncode": process.returncode,
            "stdout": stdout,
            "stderr": stderr,
            "file_result": file_result,
            "timed_out": timed_out,
        }
        if timed_out:
            raise AssertionError(f"renderer harness timed out after draining output: {evidence}")
        if process.returncode != 0:
            raise AssertionError(f"renderer harness failed: {evidence}")
        if stdout.strip() and file_result.strip() and stdout.strip() != file_result.strip():
            raise AssertionError(f"renderer harness returned conflicting results: {evidence}")
        serialized = file_result.strip() or stdout.strip()
        if not serialized:
            raise AssertionError(f"renderer harness returned no result: {evidence}")
        payload = json.loads(serialized)
        if payload.get("__harnessError"):
            raise AssertionError(payload["__harnessError"])
        return payload, evidence


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


class StructuredAskFallbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_plain_final_result_closes_stream_input_and_finishes(self) -> None:
        script = (
            "import json,sys\n"
            "json.loads(sys.stdin.readline())\n"
            "print(json.dumps({'type':'assistant','message':{'content':[{'type':'text','text':'完成'}]}}),flush=True)\n"
            "print(json.dumps({'type':'result','result':'完成'}),flush=True)\n"
            "sys.stdin.readline()\n"
        )
        server.sessions.clear()
        server._active_runs.clear()
        server.sessions["v11-plain-eof"] = agent_session("v11-plain-eof")

        async def no_orphan(_session_id: str) -> None:
            return None

        cfg = {"model": "fake-model", "api_key": "fake", "base_url": "http://fake", "label": "fake"}
        events: list[str] = []
        with (
            patch.object(server, "deepseek_config", return_value=cfg),
            patch.object(server, "_agent_runtime", server.WindowsNativeRuntime([sys.executable, "-u", "-c", script])),
            patch.object(server, "kill_orphaned_claude_session", new=no_orphan),
            patch.object(server, "save_sessions_to_disk"),
        ):
            async def consume() -> None:
                async for item in server.stream_chat("v11-plain-eof", "完成任务", model="fake-model", permission_mode="default"):
                    events.append(item)

            task = asyncio.create_task(consume())
            try:
                await asyncio.wait_for(task, timeout=1)
            finally:
                if not task.done():
                    await server.cancel_chat("v11-plain-eof")
                    task.cancel()
                server.agent_interaction_broker.invalidate("v11-plain-eof", reason="test-cleanup")

        decoded = [json.loads(item.split("data: ", 1)[1].strip()) for item in events]
        self.assertIn({"type": "text", "content": "完成"}, decoded)
        self.assertIn({"type": "done"}, decoded)
        self.assertNotIn("v11-plain-eof", server._active_runs)

    def test_tool_start_question_normalizes_without_plain_text_guessing(self) -> None:
        questions = [{
            "question": "请选择实现方式",
            "header": "方案",
            "multiSelect": False,
            "options": [
                {"label": "方案一", "description": "保持简单"},
                {"label": "方案二", "description": "扩展能力"},
            ],
        }]
        normalized = server.normalize_control_request({
            "type": "tool_start",
            "tool_id": "ask-tool-1",
            "name": "AskUserQuestion",
            "input": {"questions": questions},
        })
        self.assertIsNotNone(normalized)
        self.assertEqual(normalized["kind"], "question")
        self.assertEqual(normalized["request_id"], "ask-tool-1")
        self.assertEqual(normalized["questions"][0]["question"], "请选择实现方式")
        self.assertEqual(normalized["allowed_actions"], ["answer", "skip"])
        self.assertEqual(normalized["_response_mode"], "continuation")
        self.assertIsNone(server.normalize_control_request({
            "type": "assistant",
            "text": "AskUserQuestion：请选择实现方式",
        }))

    async def test_real_captured_tool_failure_becomes_one_question_and_same_process_continues(self) -> None:
        script = (
            "import json,sys\n"
            "json.loads(sys.stdin.readline())\n"
            "questions=[{'question':'请选择实现方式','header':'方案','multiSelect':False,'options':[{'label':'方案一','description':'保持简单'},{'label':'方案二','description':'扩展能力'}]}]\n"
            "print(json.dumps({'type':'assistant','message':{'content':[{'type':'tool_use','id':'ask-tool-1','name':'AskUserQuestion','input':{'questions':questions}}]}}),flush=True)\n"
            "print(json.dumps({'type':'user','message':{'content':[{'type':'tool_result','tool_use_id':'ask-tool-1','is_error':True,'content':'Answer questions?'}]}}),flush=True)\n"
            "answer=json.loads(sys.stdin.readline())\n"
            "answer_text=json.dumps(answer,ensure_ascii=False)\n"
            "result='收到' if answer.get('type')=='user' and '方案一' in answer_text else '未收到答案'\n"
            "print(json.dumps({'type':'assistant','message':{'content':[{'type':'text','text':result}]}}),flush=True)\n"
            "print(json.dumps({'type':'result','result':result}),flush=True)\n"
        )
        server.sessions.clear()
        server._active_runs.clear()
        server.agent_interaction_broker.invalidate("v10-a", reason="test-reset")
        server.sessions["v10-a"] = agent_session("v10-a")

        async def no_orphan(_session_id: str) -> None:
            return None

        cfg = {"model": "fake-model", "api_key": "fake", "base_url": "http://fake", "label": "fake"}
        events: list[str] = []
        with (
            patch.object(server, "deepseek_config", return_value=cfg),
            patch.object(server, "_agent_runtime", server.WindowsNativeRuntime([sys.executable, "-u", "-c", script])),
            patch.object(server, "kill_orphaned_claude_session", new=no_orphan),
            patch.object(server, "save_sessions_to_disk"),
        ):
            async def consume() -> None:
                async for item in server.stream_chat("v10-a", "提出一个问题", model="fake-model", permission_mode="default"):
                    events.append(item)

            task = asyncio.create_task(consume())
            try:
                pending = None
                for _ in range(60):
                    pending = server.agent_interaction_broker.pending_for("v10-a")
                    if pending:
                        break
                    await asyncio.sleep(0.025)
                self.assertIsNotNone(pending, "structured AskUserQuestion tool_use must create a pending interaction")
                run = server._active_runs["v10-a"]
                await server.agent_interaction_broker.resolve(
                    "v10-a",
                    "ask-tool-1",
                    "question",
                    "answer",
                    answers={"请选择实现方式": "方案一"},
                    stdin=run["stdin"],
                    process_identity=run["process_identity"],
                )
                await asyncio.wait_for(task, timeout=3)
            finally:
                if not task.done():
                    task.cancel()
                    with self.assertRaises(asyncio.CancelledError):
                        await task
                server.agent_interaction_broker.invalidate("v10-a", reason="test-cleanup")

        decoded = [json.loads(item.split("data: ", 1)[1].strip()) for item in events]
        self.assertEqual([item["type"] for item in decoded if item["type"] == "interaction_request"], ["interaction_request"])
        self.assertNotIn("tool_start", [item["type"] for item in decoded])
        self.assertNotIn("tool_result", [item["type"] for item in decoded])
        self.assertNotIn("Answer questions?", json.dumps(decoded, ensure_ascii=False))
        self.assertIn({"type": "text", "content": "收到"}, decoded)

    async def test_fallback_final_result_closes_stream_input_and_finishes(self) -> None:
        script = (
            "import json,sys\n"
            "json.loads(sys.stdin.readline())\n"
            "questions=[{'question':'继续？','header':'确认','multiSelect':False,'options':[{'label':'继续'}]}]\n"
            "print(json.dumps({'type':'assistant','message':{'content':[{'type':'tool_use','id':'ask-eof','name':'AskUserQuestion','input':{'questions':questions}}]}}),flush=True)\n"
            "print(json.dumps({'type':'user','message':{'content':[{'type':'tool_result','tool_use_id':'ask-eof','is_error':True,'content':'Answer questions?'}]}}),flush=True)\n"
            "json.loads(sys.stdin.readline())\n"
            "print(json.dumps({'type':'assistant','message':{'content':[{'type':'text','text':'收到'}]}}),flush=True)\n"
            "print(json.dumps({'type':'result','result':'收到'}),flush=True)\n"
            "sys.stdin.readline()\n"
        )
        server.sessions.clear()
        server._active_runs.clear()
        server.agent_interaction_broker.invalidate("v10-eof", reason="test-reset")
        server.sessions["v10-eof"] = agent_session("v10-eof")

        async def no_orphan(_session_id: str) -> None:
            return None

        cfg = {"model": "fake-model", "api_key": "fake", "base_url": "http://fake", "label": "fake"}
        events: list[str] = []
        with (
            patch.object(server, "deepseek_config", return_value=cfg),
            patch.object(server, "_agent_runtime", server.WindowsNativeRuntime([sys.executable, "-u", "-c", script])),
            patch.object(server, "kill_orphaned_claude_session", new=no_orphan),
            patch.object(server, "save_sessions_to_disk"),
        ):
            async def consume() -> None:
                async for item in server.stream_chat("v10-eof", "提问", model="fake-model", permission_mode="default"):
                    events.append(item)

            task = asyncio.create_task(consume())
            try:
                for _ in range(60):
                    pending = server.agent_interaction_broker.pending_for("v10-eof")
                    if pending:
                        break
                    await asyncio.sleep(0.025)
                self.assertIsNotNone(server.agent_interaction_broker.pending_for("v10-eof"))
                run = server._active_runs["v10-eof"]
                await server.agent_interaction_broker.resolve(
                    "v10-eof",
                    "ask-eof",
                    "question",
                    "answer",
                    answers={"继续？": "继续"},
                    stdin=run["stdin"],
                    process_identity=run["process_identity"],
                )
                run["pending_interaction"] = None
                await asyncio.wait_for(task, timeout=3)
            finally:
                if not task.done():
                    await server.cancel_chat("v10-eof")
                    task.cancel()
                    with self.assertRaises(asyncio.CancelledError):
                        await task
                server.agent_interaction_broker.invalidate("v10-eof", reason="test-cleanup")

        decoded = [json.loads(item.split("data: ", 1)[1].strip()) for item in events]
        self.assertIn({"type": "text", "content": "收到"}, decoded)
        self.assertIn({"type": "done"}, decoded)
        self.assertNotIn("v10-eof", server._active_runs)


class ColdStartSettingsTests(unittest.TestCase):
    def test_saved_key_survives_no_environment_and_public_payload_redacts_it(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            settings_file = data_dir / "settings.json"
            initial = server.normalize_settings({
                "appearance": {"theme": "dark"},
                "provider": {"api_key": "", "model": "deepseek-v4-pro[1m]"},
                "workspace": {"default_root": str(ROOT)},
            })
            with (
                patch.object(server, "DATA_DIR", data_dir),
                patch.object(server, "SETTINGS_FILE", settings_file),
                patch.object(server, "load_claude_settings", return_value={}),
                patch.dict(server.os.environ, {}, clear=True),
            ):
                server.save_app_settings(initial)
                updated = server.merge_dict(server.load_app_settings(), {"provider": {"api_key": "fixture-token"}})
                server.save_app_settings(updated)
                reloaded = server.load_app_settings()
                public = server.public_settings(reloaded)
                self.assertEqual(reloaded["appearance"]["theme"], "dark")
                self.assertEqual(reloaded["provider"]["api_key"], "fixture-token")
                self.assertEqual(public["provider"]["api_key"], "")
                self.assertTrue(public["provider"]["api_key_configured"])
                self.assertEqual(server.provider_config()["api_key"], "fixture-token")
                self.assertFalse(settings_file.with_suffix(".json.tmp").exists())


class OriginalQuestionCardContractTests(unittest.TestCase):
    def test_question_card_has_composer_dock_and_original_desktop_structure(self) -> None:
        html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        css = (ROOT / "static" / "style.css").read_text(encoding="utf-8")
        self.assertIn('id="interaction-dock"', html)
        self.assertLess(html.index('id="interaction-dock"'), html.index('id="composer"'))
        self.assertIn("inline-question-title", app)
        self.assertIn("inline-question-close", app)
        self.assertIn("inline-question-key", app)
        self.assertIn("提交 Enter", app)
        self.assertIn("其他", app)
        self.assertIn(".interaction-dock:empty", css)
        self.assertIn("width: min(860px, 100%)", css)

    def test_real_chromium_question_card_state_machine(self) -> None:
        payload, normal_evidence = run_v10_renderer_harness()
        self.assertTrue(payload["firstClick"])
        self.assertTrue(payload["duplicatePostSuppressed"])
        self.assertTrue(payload["awaitingAckHidden"])
        self.assertTrue(payload["failureRecovered"])
        self.assertEqual(payload["escapeAction"], "skip")
        self.assertTrue(payload["dockCleared"])
        self.assertTrue(normal_evidence["stdout"].strip())

        epipe_payload, epipe_evidence = run_v10_renderer_harness(force_stdout_epipe=True)
        self.assertEqual(epipe_payload, payload)
        self.assertEqual(epipe_evidence["stdout"].strip(), "")
        self.assertEqual(epipe_evidence["stderr"], "")


if __name__ == "__main__":
    unittest.main()
