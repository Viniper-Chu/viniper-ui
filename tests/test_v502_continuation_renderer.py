"""Two-size Electron evidence for the v5.0.2 continuation fixes."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ContinuationRendererTests(unittest.TestCase):
    def test_real_electron_rail_duration_and_running_hint(self) -> None:
        evidence_parent = ROOT / "codex" / "运行残留"
        evidence_parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="v502-continuation-electron-", dir=evidence_parent) as temp:
            evidence = Path(temp)
            env = os.environ.copy()
            env["VINIPER_V502_CONTINUATION_EVIDENCE_ROOT"] = str(evidence)
            env["VINIPER_UI_OPEN_BROWSER"] = "0"
            env.pop("ELECTRON_RUN_AS_NODE", None)
            electron = ROOT / "desktop" / "node_modules" / "electron" / "dist" / "electron.exe"
            harness = ROOT / "tests" / "v502_continuation_renderer_harness.js"
            self.assertTrue(electron.exists(), "HARNESS_FAIL: bundled Electron executable is missing")
            completed = subprocess.run(
                [
                    str(electron),
                    f"--user-data-dir={evidence / 'electron-user-data'}",
                    str(harness),
                ],
                cwd=ROOT,
                env=env,
                capture_output=True,
                text=True,
                timeout=120,
                check=False,
            )
            (evidence / "stdout.log").write_text(completed.stdout or "", encoding="utf-8")
            (evidence / "stderr.log").write_text(completed.stderr or "", encoding="utf-8")
            result_path = evidence / "continuation-renderer-result.json"
            self.assertTrue(result_path.exists(), "HARNESS_FAIL: continuation Electron result is missing")
            payload = json.loads(result_path.read_text(encoding="utf-8"))
            self.assertNotIn("__harnessError", payload, f"HARNESS_FAIL: {payload.get('__harnessError')}")
            self.assertEqual(completed.returncode, 0, "HARNESS_FAIL: continuation Electron exited non-zero")
            for name, item in payload["viewports"].items():
                self.assertTrue(item["railStayedInViewport"], f"PRODUCT_FAIL {name}: rail moved with chat scroll")
                self.assertEqual(item["baseline"]["active"], 1, f"PRODUCT_FAIL {name}: trace rail has more than one active tick")
                self.assertEqual(item["baseline"]["ticks"], 64, f"PRODUCT_FAIL {name}: long-session rail did not map all messages")
                self.assertNotIn(item["baseline"]["overflowY"], {"auto", "scroll"}, f"PRODUCT_FAIL {name}: rail owns a second scroll container")
                self.assertTrue(item["duration"]["hasTurnTotal"], f"PRODUCT_FAIL {name}: 1649s turn was not rendered as 27分29秒")
                self.assertTrue(item["duration"]["hasTokens"], f"PRODUCT_FAIL {name}: completed footer omitted the real turn token total")
                self.assertFalse(item["duration"]["hasThinkingOnlyLabel"], f"PRODUCT_FAIL {name}: thinking-only duration leaked into total row")
                self.assertTrue(item["duration"]["thinkingBodyHidden"], f"PRODUCT_FAIL {name}: completed thinking body remained visible")
                active = item["duration"]["active"]
                self.assertIn("before", active, f"HARNESS_FAIL {name}: active timer probe returned incomplete payload: {active}")
                self.assertTrue(active["before"]["present"], f"PRODUCT_FAIL {name}: active turn has no live bottom total node")
                self.assertTrue(active["before"]["hasTokens"], f"PRODUCT_FAIL {name}: active footer omitted the current turn token total")
                self.assertTrue(active["after"]["present"], f"PRODUCT_FAIL {name}: active total node disappeared while waiting")
                self.assertTrue(active["before"]["base"], f"PRODUCT_FAIL {name}: active total missing elapsed base")
                self.assertTrue(active["before"]["renderedAt"], f"PRODUCT_FAIL {name}: active total missing rendered-at timestamp")
                self.assertEqual(active["after"]["liveCount"], 1, f"PRODUCT_FAIL {name}: active turn rendered duplicate total nodes")
                self.assertTrue(active["after"]["atBottom"], f"PRODUCT_FAIL {name}: active total is not the final row in the turn")
                self.assertFalse(active["after"]["overlapsComposer"], f"PRODUCT_FAIL {name}: active total overlaps composer")
                self.assertFalse(active["after"]["overlapsDock"], f"PRODUCT_FAIL {name}: active total overlaps interaction dock")
                self.assertTrue(active["textChanged"], f"PRODUCT_FAIL {name}: active total did not advance without a new SSE/render call")
                self.assertTrue(active["after"]["hasTokens"], f"PRODUCT_FAIL {name}: active footer lost the current turn token total")
                self.assertGreaterEqual(active["waitMs"], 1100, f"HARNESS_FAIL {name}: active timer wait was too short")
                self.assertTrue(item["duration"]["completed"]["hasTurnTotal"], f"PRODUCT_FAIL {name}: completed active turn lost persisted total")
                self.assertTrue(item["duration"]["completed"]["hasTokens"], f"PRODUCT_FAIL {name}: completed active turn lost persisted token total")
                self.assertFalse(item["duration"]["completed"]["hasLiveTotal"], f"PRODUCT_FAIL {name}: completed turn kept live timer node")
                self.assertFalse(item["duration"]["completed"]["pending"], f"PRODUCT_FAIL {name}: completed turn remains pending")
                self.assertTrue(item["duration"]["completed"]["atBottom"], f"PRODUCT_FAIL {name}: completed total is not the final row in the turn")
                self.assertFalse(item["duration"]["completed"]["overlapsComposer"], f"PRODUCT_FAIL {name}: completed total overlaps composer")
                self.assertFalse(item["duration"]["completed"]["overlapsDock"], f"PRODUCT_FAIL {name}: completed total overlaps interaction dock")
                for status, hint in item["hints"].items():
                    self.assertIn("Enter 排队", hint["placeholder"], f"PRODUCT_FAIL {name}/{status}: missing running placeholder")
                    self.assertIn("Ctrl+Enter 引导", hint["shortcut"], f"PRODUCT_FAIL {name}/{status}: missing guidance shortcut")
                    self.assertIn("Shift+Enter 换行", hint["shortcut"], f"PRODUCT_FAIL {name}/{status}: missing newline shortcut")


if __name__ == "__main__":
    unittest.main()
