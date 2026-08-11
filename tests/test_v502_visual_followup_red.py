"""Red-first contracts for the Claude-style 5.0.2 visual follow-up.

These deliberately exercise the smallest seams needed for turn-token totals,
the single-colour context ring, and compact activity rows before production
code is changed.
"""

from __future__ import annotations

import importlib
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class VisualFollowupRedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.app = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        cls.css = (ROOT / "static" / "style.css").read_text(encoding="utf-8")
        cls.server = (ROOT / "server.py").read_text(encoding="utf-8")
        cls.daily_usage = importlib.import_module("daily_usage")

    def test_turn_usage_merges_nested_message_usage_idempotently(self) -> None:
        merge = getattr(self.daily_usage, "merge_turn_usage", None)
        self.assertTrue(callable(merge), "PRODUCT_FAIL: no pure turn-usage accumulator")
        first = merge(None, {"message": {"usage": {
            "input_tokens": 51,
            "output_tokens": 1393,
            "cache_read_input_tokens": 109184,
        }}})
        repeated = merge(first, {"usage": {
            "input_tokens": 51,
            "output_tokens": 1393,
            "cache_read_input_tokens": 109184,
        }})
        self.assertEqual(repeated["input_tokens"], 51)
        self.assertEqual(repeated["cache_read_input_tokens"], 109184)
        self.assertEqual(repeated["total_tokens"], 110628)

    def test_assistant_footer_receives_turn_usage_and_formats_tokens(self) -> None:
        template = self.app[self.app.index("function messageTemplate"): self.app.index("function attachmentKind")]
        self.assertRegex(template, r"turnUsage|turn_usage", "PRODUCT_FAIL: messageTemplate drops persisted turn usage")
        self.assertRegex(self.app, r"formatCompactTokenCount|compact.*tokens|tokens.*compact", "PRODUCT_FAIL: no compact token footer formatter")
        self.assertRegex(self.app, r"['\"] tokens['\"]", "PRODUCT_FAIL: assistant footer has no token label")

    def test_stream_persists_and_publishes_turn_usage(self) -> None:
        self.assertIn("merge_turn_usage", self.server, "PRODUCT_FAIL: stream does not consume turn usage frames")
        self.assertIn('"type": "turn_usage"', self.server, "PRODUCT_FAIL: stream has no turn-usage SSE event")
        self.assertIn('message["turn_usage"]', self.server, "PRODUCT_FAIL: assistant turn usage is not persisted")

    def test_context_ring_is_single_colour_clockwise_from_twelve(self) -> None:
        final_ring = self.css[self.css.rfind("/* v5.0.2 Claude surface"):]
        self.assertRegex(final_ring, r"conic-gradient\(from\s+0deg", "PRODUCT_FAIL: context ring has no explicit 12 o'clock start")
        self.assertNotRegex(final_ring, r"var\(--(?:yellow|red)\)", "PRODUCT_FAIL: warning classes still recolour the ring")
        self.assertNotRegex(final_ring, r"contextPulse|animation\s*:\s*(?!none\b)\S+", "PRODUCT_FAIL: context ring still pulses/changes colour")

    def test_activity_rows_are_compact_and_non_card_like(self) -> None:
        activity = self.css[self.css.rfind("/* v5.0.2 Claude surface") :]
        self.assertRegex(activity, r"\.tool-summary[^\{]*\{[^}]*min-height:\s*(?:1[0-9]|2[0-4])px", "PRODUCT_FAIL: tool rows remain too tall")
        self.assertNotRegex(activity, r"toolSummaryPulse|box-shadow:\s*var\(--shadow", "PRODUCT_FAIL: activity rows retain heavy card/pulse styling")


if __name__ == "__main__":
    unittest.main()
