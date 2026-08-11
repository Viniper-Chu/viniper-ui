"""Focused red/green contracts for the v5.0.2 continuation repair.

These checks target the production seams that the formal evidence exposed:
the trace rail's scroll owner, whole-turn duration, running composer status,
and the distinction between an allow-with-CLI-timeout and a real deny.
"""

from __future__ import annotations

import re
import tempfile
import unittest
from pathlib import Path

from agent_run_coordinator import DurableInteractionStore
from server import _unresolved_parallel_tool_count


ROOT = Path(__file__).resolve().parents[1]


class ContinuationRepairRedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.index = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        cls.app = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        cls.server = (ROOT / "server.py").read_text(encoding="utf-8")

    def test_trace_rail_is_not_inside_the_single_chat_scroll_owner(self) -> None:
        chat_start = self.index.index('id="chat-container"')
        chat_end = self.index.index("</section>", chat_start)
        rail = self.index.index('id="message-trace-rail"')
        self.assertFalse(
            chat_start < rail < chat_end,
            "PRODUCT_FAIL: message trace rail is still a descendant of #chat-container",
        )

    def test_completed_assistant_duration_uses_turn_elapsed_not_thinking_elapsed(self) -> None:
        template = self.app[self.app.index("function messageTemplate"): self.app.index("function attachmentKind")]
        self.assertRegex(
            template,
            r"totalElapsedSeconds:\s*meta\?\.elapsed_seconds(?:\s*\?\?\s*meta\?\.elapsedSeconds)?",
            "PRODUCT_FAIL: messageTemplate does not pass persisted whole-turn elapsed_seconds",
        )
        self.assertNotRegex(
            template,
            r"totalElapsedSeconds:\s*meta\?\.thinking_elapsed_seconds",
            "PRODUCT_FAIL: thinking-only duration is still used as turn duration",
        )
        self.assertRegex(
            self.app,
            r"本轮用时|总计",
            "PRODUCT_FAIL: completed assistant turns have no bottom total-duration label",
        )

    def test_active_assistant_duration_has_a_live_bottom_total_contract(self) -> None:
        self.assertIn('replace("data-live-time", "data-live-total")', self.app, "PRODUCT_FAIL: active assistant turns have no live total node")
        self.assertRegex(
            self.app,
            r"data-elapsed-base=.*data-rendered-at",
            "PRODUCT_FAIL: active total does not retain elapsed base/rendered-at",
        )
        self.assertIn("ensureStoredThinkingTimer", self.app, "PRODUCT_FAIL: active total has no timer refresh seam")

    def test_waiting_interaction_keeps_running_composer_hint(self) -> None:
        start = self.app.index("function syncCurrentSessionRuntimeUi")
        end = self.app.index("const APP_TITLE", start)
        sync = self.app[start:end]
        self.assertRegex(
            sync,
            r"(?:runningHint|runtimeHint)\s*=\s*Boolean\(active\s*&&\s*agent\)",
            "PRODUCT_FAIL: runtime hint is still gated by interactionLocked/guidance",
        )
        self.assertRegex(sync, r"placeholder\s*=\s*[^;]*runningHint")
        self.assertRegex(sync, r"shortcut\.textContent\s*=\s*[^;]*runningHint")

    def test_cli_ack_timeout_is_not_projected_as_user_denial_and_mentions_parallel_gap(self) -> None:
        self.assertIn("cli_ack_timeout", self.server)
        self.assertRegex(
            self.server,
            r"用户已允许.{0,80}(?:CLI 未确认|状态未知|请求未执行)",
            "PRODUCT_FAIL: allow + CLI ACK timeout has no distinct user-facing failure text",
        )
        self.assertIn(
            "交互链路未完成，后续并行工具结果未返回",
            self.server,
            "PRODUCT_FAIL: dangling parallel tool starts are not reported as an incomplete chain",
        )

    def test_durable_allow_then_cli_ack_timeout_keeps_allow_decision(self) -> None:
        evidence_root = ROOT / "codex" / "运行残留"
        evidence_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="v502-ack-timeout-", dir=evidence_root) as temp:
            store = DurableInteractionStore(Path(temp) / "interaction-state.json")
            store.create({
                "session_id": "A",
                "run_id": "run-A",
                "request_id": "req-A",
                "tool_use_id": "req-A",
                "kind": "permission",
                "tool_name": "Bash",
                "allowed_actions": ["deny", "allow_once"],
                "input": {"command": "echo fixture"},
            })
            store.mark_pending("A", "req-A")
            store.commit_response(
                "A",
                "req-A",
                action="allow_once",
                response={"behavior": "allow", "updatedInput": {"command": "echo fixture"}},
            )
            store.mark_awaiting_cli_ack("A", "req-A")
            failed = store.fail_owner(
                "A",
                "run-A",
                reason="用户已允许，但 CLI 未确认；请求未执行或状态未知。",
                failure_code="cli_ack_timeout",
            )
            public = store.public_for_session("A")
            self.assertEqual(failed["state"], "failed")
            self.assertEqual(public["failure_code"], "cli_ack_timeout")
            self.assertEqual(public["decision"], "allow")
            self.assertIn("用户已允许", public["failure_message"])
            self.assertNotIn("拒绝", public["failure_message"])

    def test_parallel_tool_gap_is_counted_without_inventing_denials(self) -> None:
        segments = [
            {"type": "tool_start", "tool_id": "git-status"},
            {"type": "tool_start", "tool_id": "hermes-list"},
            {"type": "tool_result", "tool_id": "git-status", "status": "ok"},
        ]
        self.assertEqual(_unresolved_parallel_tool_count(segments), 1)


if __name__ == "__main__":
    unittest.main()
