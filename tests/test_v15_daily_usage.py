"""v15 real local daily usage and Claude permission-mode contracts."""

from __future__ import annotations

import datetime as dt
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

import server
from agent_runtime import AgentRunSpec, RuntimeCapabilities, WslAgentRuntime
from daily_usage import DailyUsageLedger, SOURCE, extract_usage


CHINA_TZ = dt.timezone(dt.timedelta(hours=8), name="Asia/Shanghai")


class MutableClock:
    def __init__(self, value: dt.datetime) -> None:
        self.value = value

    def __call__(self) -> dt.datetime:
        return self.value


class DailyUsageLedgerTests(unittest.TestCase):
    def test_snake_and_camel_usage_fields_are_extracted(self) -> None:
        self.assertEqual(
            extract_usage({
                "usage": {
                    "input_tokens": 10,
                    "output_tokens": 4,
                    "cache_creation_input_tokens": 3,
                    "cache_read_input_tokens": 2,
                }
            }),
            {
                "input_tokens": 10,
                "output_tokens": 4,
                "cache_creation_input_tokens": 3,
                "cache_read_input_tokens": 2,
            },
        )
        self.assertEqual(
            extract_usage({
                "usage": {
                    "inputTokens": 20,
                    "outputTokens": 8,
                    "cacheCreationInputTokens": 6,
                    "cacheReadInputTokens": 5,
                }
            }),
            {
                "input_tokens": 20,
                "output_tokens": 8,
                "cache_creation_input_tokens": 6,
                "cache_read_input_tokens": 5,
            },
        )
        self.assertEqual(
            extract_usage({
                "usage": {"input_tokens": 30, "output_tokens": 6},
                "modelUsage": {
                    "claude-a": {
                        "inputTokens": 30,
                        "outputTokens": 6,
                        "cacheCreationInputTokens": 4,
                        "cacheReadInputTokens": 9,
                    }
                },
            }),
            {
                "input_tokens": 30,
                "output_tokens": 6,
                "cache_creation_input_tokens": 4,
                "cache_read_input_tokens": 9,
            },
        )
        self.assertIsNone(extract_usage({"type": "assistant", "message": {"usage": {"input_tokens": 99}}}))

    def test_model_usage_is_summed_across_real_model_records(self) -> None:
        self.assertEqual(
            extract_usage({
                "modelUsage": {
                    "claude-a": {
                        "inputTokens": 100,
                        "outputTokens": 20,
                        "cacheCreationInputTokens": 30,
                        "cacheReadInputTokens": 40,
                    },
                    "claude-b": {
                        "input_tokens": 7,
                        "output_tokens": 8,
                        "cache_creation_input_tokens": 9,
                        "cache_read_input_tokens": 10,
                    },
                }
            }),
            {
                "input_tokens": 107,
                "output_tokens": 28,
                "cache_creation_input_tokens": 39,
                "cache_read_input_tokens": 50,
            },
        )

    def test_same_run_cumulative_frames_take_monotonic_max_and_result_fills_truth(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            clock = MutableClock(dt.datetime(2026, 8, 9, 10, tzinfo=CHINA_TZ))
            ledger = DailyUsageLedger(Path(tmp) / "daily-usage.json", clock=clock)
            ledger.record_event("run-a", "session-a", {
                "type": "stream_event",
                "usage": {"input_tokens": 100, "output_tokens": 5},
            })
            ledger.record_event("run-a", "session-a", {
                "type": "stream_event",
                "usage": {"input_tokens": 100, "output_tokens": 15, "cache_read_input_tokens": 20},
            })
            ledger.record_event("run-a", "session-a", {
                "type": "result",
                "usage": {
                    "input_tokens": 110,
                    "output_tokens": 18,
                    "cache_creation_input_tokens": 9,
                    "cache_read_input_tokens": 20,
                },
            })

            today = ledger.daily(7)["days"][-1]
            self.assertEqual(today["input_tokens"], 110)
            self.assertEqual(today["output_tokens"], 18)
            self.assertEqual(today["cache_creation_input_tokens"], 9)
            self.assertEqual(today["cache_read_input_tokens"], 20)
            self.assertEqual(today["total_tokens"], 157)
            self.assertEqual(today["run_count"], 1)

    def test_distinct_runs_add_no_usage_does_not_and_reload_preserves_history(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "daily-usage.json"
            clock = MutableClock(dt.datetime(2026, 8, 9, 12, tzinfo=CHINA_TZ))
            ledger = DailyUsageLedger(path, clock=clock)
            ledger.record_event("run-a", "session-a", {"usage": {"input_tokens": 10, "output_tokens": 1}})
            ledger.record_event("run-b", "session-b", {"usage": {"input_tokens": 20, "output_tokens": 2}})
            ledger.record_event("run-c", "session-a", {"modelUsage": {"model": {"inputTokens": 30, "outputTokens": 3}}})
            self.assertIsNone(ledger.record_event("run-no-usage", "session-c", {"type": "result"}))

            reloaded = DailyUsageLedger(path, clock=clock)
            payload = reloaded.daily(7)
            self.assertEqual(payload["run_count"], 3)
            self.assertEqual(payload["total_tokens"], 66)
            self.assertEqual(payload["days"][-1]["run_count"], 3)
            self.assertEqual(payload["source"], SOURCE)

    def test_daily_buckets_are_continuous_local_dates_with_zero_days(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            clock = MutableClock(dt.datetime(2026, 8, 7, 23, 30, tzinfo=CHINA_TZ))
            ledger = DailyUsageLedger(Path(tmp) / "daily-usage.json", clock=clock)
            ledger.record_event("run-aug-7", "session-a", {"usage": {"input_tokens": 12}})
            clock.value = dt.datetime(2026, 8, 9, 8, tzinfo=CHINA_TZ)
            payload = ledger.daily(7)

            self.assertEqual(
                [item["date"] for item in payload["days"]],
                ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09"],
            )
            self.assertEqual(payload["days"][4]["total_tokens"], 12)
            self.assertEqual(payload["days"][5]["total_tokens"], 0)
            self.assertEqual(payload["timezone"], {"name": "Asia/Shanghai", "utc_offset": "+08:00"})


class DailyUsageApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_daily_usage_api_contract_and_day_limits(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            clock = MutableClock(dt.datetime(2026, 8, 9, 8, tzinfo=CHINA_TZ))
            ledger = DailyUsageLedger(Path(tmp) / "daily-usage.json", clock=clock)
            ledger.record_event("api-run", "api-session", {"usage": {"input_tokens": 7, "output_tokens": 3}})
            transport = httpx.ASGITransport(app=server.app)
            with patch.object(server, "_daily_usage_ledger", ledger):
                async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                    response = await client.get("/api/usage/daily", params={"days": 7})
                    invalid = await client.get("/api/usage/daily", params={"days": 6})

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["source"], SOURCE)
            self.assertEqual(len(payload["days"]), 7)
            self.assertEqual(payload["total_tokens"], 10)
            self.assertEqual(payload["run_count"], 1)
            self.assertEqual(payload["totals"]["input_tokens"], 7)
            self.assertEqual(invalid.status_code, 422)

    async def test_deleting_session_does_not_delete_daily_usage_history(self) -> None:
        class ContextLedgerStub:
            def remove(self, _session_id: str) -> None:
                return None

        with tempfile.TemporaryDirectory() as tmp:
            clock = MutableClock(dt.datetime(2026, 8, 9, 8, tzinfo=CHINA_TZ))
            ledger = DailyUsageLedger(Path(tmp) / "daily-usage.json", clock=clock)
            ledger.record_event("kept-run", "deleted-session", {"usage": {"input_tokens": 21}})
            server.sessions["deleted-session"] = {
                "id": "deleted-session",
                "mode": "agent",
                "messages": [],
            }
            with (
                patch.object(server, "_daily_usage_ledger", ledger),
                patch.object(server, "context_usage_ledger", return_value=ContextLedgerStub()),
                patch.object(server, "remove_session_runtime_data"),
                patch.object(server, "save_sessions_to_disk"),
            ):
                response = await server.delete_session("deleted-session")

            self.assertTrue(response["deleted"])
            self.assertEqual(ledger.daily(7)["total_tokens"], 21)


class AgentDailyUsageWiringTests(unittest.IsolatedAsyncioTestCase):
    async def test_each_agent_process_gets_one_unique_run_id_and_cumulative_frames_do_not_add(self) -> None:
        class ContextLedgerStub:
            def update_from_event(self, *_args, **_kwargs):
                return None

        class CapturingLedger(DailyUsageLedger):
            def __init__(self, path: Path, *, clock: MutableClock) -> None:
                self.seen_run_ids: list[str] = []
                super().__init__(path, clock=clock)

            def record_event(self, run_id: str, session_id: str, event):
                self.seen_run_ids.append(run_id)
                return super().record_event(run_id, session_id, event)

        def agent_session(session_id: str) -> dict:
            return {
                "id": session_id,
                "mode": "agent",
                "messages": [],
                "created": 1,
                "updated": 1,
                "name": session_id,
                "workdir": str(Path(__file__).resolve().parents[1]),
                "pinned": False,
                "unread": False,
                "claude_session_id": session_id,
                "claude_initialized": False,
                "summary": "",
            }

        script = (
            "import json,sys\n"
            "json.loads(sys.stdin.readline())\n"
            "print(json.dumps({'type':'stream_event','event':{},'usage':{'input_tokens':100,'output_tokens':5}}),flush=True)\n"
            "print(json.dumps({'type':'stream_event','event':{},'usage':{'input_tokens':100,'output_tokens':10}}),flush=True)\n"
            "print(json.dumps({'type':'result','result':'完成','usage':{'input_tokens':100,'output_tokens':15}}),flush=True)\n"
        )
        cfg = {"model": "fake-model", "api_key": "fake", "base_url": "http://fake", "label": "fake"}
        settings = server.default_settings()
        session_ids = ("v15-daily-run-a", "v15-daily-run-b")
        with tempfile.TemporaryDirectory() as tmp:
            prompt_path = Path(tmp) / "system.md"
            ledger = CapturingLedger(
                Path(tmp) / "daily-usage.json",
                clock=MutableClock(dt.datetime(2026, 8, 9, 8, tzinfo=CHINA_TZ)),
            )
            for session_id in session_ids:
                server.sessions[session_id] = agent_session(session_id)
            try:
                with (
                    patch.object(server, "deepseek_config", return_value=cfg),
                    patch.object(server, "load_app_settings", return_value=settings),
                    patch.object(server, "_agent_runtime", server.WindowsNativeRuntime([sys.executable, "-u", "-c", script])),
                    patch.object(server, "daily_usage_ledger", return_value=ledger),
                    patch.object(server, "context_usage_ledger", return_value=ContextLedgerStub()),
                    patch.object(server, "prepare_agent_system_prompt", return_value=prompt_path),
                    patch.object(server, "cleanup_agent_system_prompt"),
                    patch.object(server, "save_sessions_to_disk"),
                ):
                    for session_id in session_ids:
                        async for _item in server.stream_chat(
                            session_id,
                            "本地结构化测试",
                            model="fake-model",
                            permission_mode="default",
                        ):
                            pass
            finally:
                for session_id in session_ids:
                    server.sessions.pop(session_id, None)
                    server._session_locks.pop(session_id, None)

            self.assertEqual(len(set(ledger.seen_run_ids)), 2)
            payload = ledger.daily(7)
            self.assertEqual(payload["run_count"], 2)
            self.assertEqual(payload["total_tokens"], 230)


class PermissionModeContractTests(unittest.TestCase):
    def test_desktop_permission_values_map_to_current_wsl_cli_aliases(self) -> None:
        expected = {
            "default": ("手动", "Claude 在需要权限时暂停并询问"),
            "acceptEdits": ("自动接受编辑", "自动允许文件编辑，其他高风险操作仍会询问"),
            "plan": ("计划", "先规划，减少直接执行动作"),
        }
        options = {item["id"]: item for item in server.PERMISSION_MODE_OPTIONS}
        settings = {
            "runtime": {
                "permission_mode": "default",
                "enable_auto_mode": False,
                "allow_bypass_permissions": False,
            }
        }
        runtime = WslAgentRuntime()
        capabilities = RuntimeCapabilities(permission_modes=("manual", "acceptEdits", "plan", "bypassPermissions", "auto", "dontAsk"))
        with (
            patch.object(server, "load_app_settings", return_value=settings),
            patch.object(runtime, "capabilities", return_value=capabilities),
        ):
            for mode, (label, description) in expected.items():
                with self.subTest(mode=mode):
                    self.assertEqual(server.allowed_permission_mode(mode), mode)
                    self.assertEqual((options[mode]["label"], options[mode]["description"]), (label, description))
                    spec = AgentRunSpec(
                        session_id="session-a",
                        claude_session_id="00000000-0000-4000-8000-000000000001",
                        session_name="session-a",
                        workdir="D:\\work",
                        model="fake-model",
                        permission_mode=server.allowed_permission_mode(mode),
                        resume=False,
                    )
                    command = runtime.build_command(spec)
                    index = command.index("--permission-mode")
                    self.assertEqual(command[index + 1], "manual" if mode == "default" else mode)
            self.assertEqual(server.allowed_permission_mode("auto"), "default")
            self.assertEqual(server.allowed_permission_mode("bypassPermissions"), "default")


class PermissionModeRequestBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_unknown_agent_permission_id_is_rejected_before_stream_start(self) -> None:
        session_id = "v15-invalid-permission"
        server.sessions[session_id] = {
            "id": session_id,
            "mode": "agent",
            "messages": [],
            "name": "权限边界",
            "workdir": str(Path(__file__).resolve().parents[1]),
        }
        started: list[str] = []

        async def fake_stream(*args, **kwargs):
            started.append(str(args[0]))
            yield server.sse({"type": "done"})

        transport = httpx.ASGITransport(app=server.app)
        try:
            with (
                patch.object(server, "stream_chat", fake_stream),
                patch.object(server, "allowed_model", return_value="fake-model"),
            ):
                async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                    responses = []
                    for invalid_mode in ("not-a-real-mode", "ask", "manual"):
                        responses.append(await client.post(
                            f"/api/chat/{session_id}",
                            json={
                                "message": "验证权限边界",
                                "model": "fake-model",
                                "permission_mode": invalid_mode,
                            },
                        ))
        finally:
            server.sessions.pop(session_id, None)
            server._session_locks.pop(session_id, None)

        self.assertEqual([response.status_code for response in responses], [400, 400, 400])
        self.assertTrue(all("permission" in response.json()["detail"].lower() for response in responses))
        self.assertEqual(started, [])


if __name__ == "__main__":
    unittest.main()
