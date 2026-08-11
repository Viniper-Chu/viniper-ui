"""Red/green contract for the Agent message trace rail.

The rail is a navigation projection inside the existing chat scroll owner;
it is not the sidebar session history and must not introduce a second owner.
This first seam intentionally fails on the pre-feature baseline.
"""

from __future__ import annotations

import re
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class MessageTraceRailContractTests(unittest.TestCase):
    def test_agent_trace_rail_has_real_dom_and_render_seam(self) -> None:
        index = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        style = (ROOT / "static" / "style.css").read_text(encoding="utf-8")

        self.assertIn('id="message-trace-rail"', index)
        self.assertIn('id="message-trace-track"', index)
        self.assertIn('id="message-trace-preview"', index)
        self.assertIn('role="tooltip"', index)
        self.assertRegex(app, r"function\s+(?:render|update)MessageTraceRail\s*\(")
        self.assertIn("showMessageTracePreview", app)
        self.assertIn("pointerenter", app)
        self.assertIn("focus", app)
        self.assertIn("message-trace-preview-title", app)
        self.assertIn("data-trace-index", app)
        self.assertIn("message-trace-tick", app)
        self.assertIn("SessionScrollRegistry.beginProjection", app)
        self.assertIn("message-trace-rail", style)
        self.assertIn("message-trace-tick", style)
        self.assertIn("message-trace-preview", style)
        trace_rules = re.findall(r"\.message-trace-tick:hover,\s*\.message-trace-tick:focus-visible,\s*\.message-trace-tick\.active\s*\{([^}]*)\}", style, flags=re.S)
        self.assertTrue(trace_rules, "PRODUCT_FAIL: trace active rule is missing")
        self.assertNotIn("var(--accent)", trace_rules[-1], "PRODUCT_FAIL: trace active state still uses brand orange")
        focus_rules = re.findall(r"#composer:focus-within\s*\{([^}]*)\}", style, flags=re.S)
        self.assertTrue(focus_rules, "PRODUCT_FAIL: composer focus rule is missing")
        self.assertRegex(focus_rules[-1], r"box-shadow\s*:\s*0\s+0\s+0\s+2px", "PRODUCT_FAIL: final composer focus rule is not the Claude-style subtle ring")

    def test_trace_is_agent_only_and_clickable_without_second_scroll_owner(self) -> None:
        index = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        self.assertIn('aria-label="消息追溯"', index)
        self.assertRegex(app, r"sessionMode\s*===\s*[\"']agent[\"']")
        self.assertRegex(app, r"scrollIntoView(?:\?\.)?\(\s*\{[^}]*block:\s*[\"']center[\"']")
        self.assertNotIn('id="message-trace-rail"', index.split('id="chat-container"', 1)[0])
        rail_css = re.search(r"message-trace-rail[^}]*\}", (ROOT / "static" / "style.css").read_text(encoding="utf-8"), re.S)
        self.assertIsNotNone(rail_css)
        self.assertNotRegex(rail_css.group(0), r"overflow(?:-y)?\s*:\s*(?:auto|scroll)")

    def test_real_electron_agent_trace_click_and_chat_projection(self) -> None:
        evidence_parent = ROOT / "codex" / "运行残留"
        evidence_parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="v502-message-trace-", dir=evidence_parent) as temp:
            evidence = Path(temp)
            env = os.environ.copy()
            env["VINIPER_V502_TRACE_EVIDENCE_ROOT"] = str(evidence)
            env["VINIPER_UI_OPEN_BROWSER"] = "0"
            env.pop("ELECTRON_RUN_AS_NODE", None)
            electron = ROOT / "desktop" / "node_modules" / "electron" / "dist" / "electron.exe"
            harness = ROOT / "tests" / "v502_message_trace_harness.js"
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
            result_path = evidence / "message-trace-result.json"
            self.assertTrue(result_path.exists(), "HARNESS_FAIL: Electron did not emit message-trace-result.json")
            payload = json.loads(result_path.read_text(encoding="utf-8"))
            self.assertNotIn("__harnessError", payload, f"HARNESS_FAIL: {payload.get('__harnessError')}")
            self.assertEqual(completed.returncode, 0, "HARNESS_FAIL: Electron exited non-zero")
            for name, item in payload.get("viewports", {}).items():
                before = item["before"]
                rail = before["rail"]
                chat = before["chatRect"]
                self.assertEqual(rail["ariaHidden"], "false", f"PRODUCT_FAIL {name}: Agent trace rail is hidden")
                self.assertNotEqual(rail["display"], "none", f"PRODUCT_FAIL {name}: Agent trace rail has no layout")
                self.assertEqual(before["tickCount"], before["messageCount"], f"PRODUCT_FAIL {name}: trace ticks do not map messages")
                self.assertTrue(rail["rect"]["left"] >= chat["left"] - 1, f"PRODUCT_FAIL {name}: rail crosses chat left edge")
                self.assertTrue(rail["rect"]["right"] <= chat["right"] + 1, f"PRODUCT_FAIL {name}: rail crosses chat right edge")
                self.assertNotIn(before["overflowY"], {"auto", "scroll"}, f"PRODUCT_FAIL {name}: rail became a second scroll owner")
                after_click = item["afterClick"]
                self.assertEqual(after_click["pointer"]["target"], str(after_click["targetIndex"]), f"PRODUCT_FAIL {name}: native pointer did not hit target tick")
                self.assertNotEqual(after_click["scrollTop"], after_click["beforeScrollTop"], f"PRODUCT_FAIL {name}: native pointer click did not move scroll position")
                self.assertEqual(after_click["activeIndex"], after_click["targetIndex"], f"PRODUCT_FAIL {name}: native pointer click did not activate target tick")
                self.assertLess(abs(after_click["targetCenter"] - after_click["viewportCenter"]), after_click["chatHeight"] * 0.2, f"PRODUCT_FAIL {name}: target message is not centered after native click")
                focus_click = item["focusAndDomClick"]
                self.assertEqual(focus_click["focused"]["ariaHidden"], "false", f"PRODUCT_FAIL {name}: keyboard focus did not open trace preview")
                self.assertNotEqual(focus_click["focused"]["display"], "none", f"PRODUCT_FAIL {name}: keyboard focus preview has no layout")
                self.assertTrue(focus_click["focused"]["title"], f"PRODUCT_FAIL {name}: trace preview has no safe title")
                self.assertTrue(focus_click["focused"]["summary"], f"PRODUCT_FAIL {name}: trace preview has no summary")
                self.assertTrue(focus_click["focused"]["withinViewport"], f"PRODUCT_FAIL {name}: trace preview escapes viewport")
                self.assertFalse(focus_click["focused"]["overlapsComposer"], f"PRODUCT_FAIL {name}: trace preview overlaps composer")
                self.assertFalse(focus_click["focused"]["overlapsInteractionDock"], f"PRODUCT_FAIL {name}: trace preview overlaps interaction dock")
                self.assertTrue(focus_click["focused"]["aboveComposer"], f"PRODUCT_FAIL {name}: trace preview is below composer boundary")
                focused_preview = focus_click["focused"]
                self.assertEqual(focused_preview["afterPointerLeave"]["display"], "none", f"PRODUCT_FAIL {name}: pointer leave did not hide trace preview")
                self.assertEqual(focused_preview["afterEscape"]["display"], "none", f"PRODUCT_FAIL {name}: Escape did not hide trace preview")
                self.assertTrue(focused_preview["edgePreview"]["withinViewport"], f"PRODUCT_FAIL {name}: edge preview escapes viewport")
                self.assertFalse(focused_preview["edgePreview"]["overlapsComposer"], f"PRODUCT_FAIL {name}: edge preview overlaps composer")
                self.assertFalse(focused_preview["edgePreview"]["overlapsInteractionDock"], f"PRODUCT_FAIL {name}: edge preview overlaps interaction dock")
                focus_styles = focus_click["focused"]["focusStyles"]
                self.assertEqual(focus_styles["userInputOutlineWidth"], "0px", f"PRODUCT_FAIL {name}: composer textarea has a heavy focus outline")
                self.assertLessEqual(focus_styles["composerRingWidth"], 2, f"PRODUCT_FAIL {name}: composer focus ring is heavier than Claude-style subtle ring")
                # Chromium may serialize color-mix/oklab shadows differently;
                # assert the actual zero-offset spread rather than relying only
                # on a color-specific parser.
                self.assertTrue(focus_styles["composerBoxShadow"], f"PRODUCT_FAIL {name}: composer focus ring has no computed shadow")
                self.assertNotRegex(focus_styles["composerBoxShadow"], r"0px\s+0px\s+0px\s+[3-9](?:\.\d+)?px", f"PRODUCT_FAIL {name}: composer focus ring is visibly heavy")
                trace_styles = focus_click["focused"]["traceStyles"]
                self.assertGreater(trace_styles["activeWidth"], trace_styles["defaultWidth"], f"PRODUCT_FAIL {name}: active trace tick is not longer")
                self.assertGreater(trace_styles["targetWidth"], trace_styles["defaultWidth"], f"PRODUCT_FAIL {name}: focused trace tick is not longer")
                self.assertFalse(trace_styles["activeIsAccent"], f"PRODUCT_FAIL {name}: active trace tick is still orange")
                self.assertFalse(trace_styles["targetIsAccent"], f"PRODUCT_FAIL {name}: focused trace tick is still orange")
                self.assertEqual(focus_click["after"]["activeIndex"], 12, f"PRODUCT_FAIL {name}: Enter/DOM click did not activate the target tick")
                self.assertEqual(focus_click["after"]["previewDisplay"], "none", f"PRODUCT_FAIL {name}: click did not close trace preview")
                projection = item["chatProjection"]
                self.assertEqual(projection["display"], "none", f"PRODUCT_FAIL {name}: Chat still exposes Agent trace rail")
                self.assertEqual(projection["tickCount"], 0, f"PRODUCT_FAIL {name}: Chat retained Agent trace ticks")


if __name__ == "__main__":
    unittest.main()
