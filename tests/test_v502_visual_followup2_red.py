"""Red-first contracts for the second v5.0.2 visual follow-up.

These tests intentionally fail on the current implementation.  They pin the
three user-visible seams before production code is changed: equal-index trace
placement, neutral progress/track colours, and content-sized inline rename.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class VisualFollowup2RedTests(unittest.TestCase):
    def test_trace_ticks_use_equal_navigable_index_spacing(self) -> None:
        app = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        body = app[app.index("function updateMessageTraceRail"): app.index("function dailyUsageNumber")]
        self.assertRegex(
            body,
            r"(?:index\s*/\s*\(\s*articles\.length\s*-\s*1\s*\)|traceStep|equal.*spacing)",
            "PRODUCT_FAIL: trace ticks still use message geometry instead of equal navigable-index spacing",
        )
        self.assertRegex(body, r"traceTargetStep\s*=\s*12", "PRODUCT_FAIL: compact trace target spacing is not fixed at 12px")
        self.assertRegex(body, r"Math\.min\(traceTargetStep", "PRODUCT_FAIL: trace spacing can expand to fill the whole rail")
        self.assertNotRegex(
            body,
            r"midpoint\s*=.*offsetTop.*offsetHeight.*percent",
            "PRODUCT_FAIL: trace tick placement is still derived from variable message heights",
        )

    def test_trace_axis_uses_agent_title_with_safe_fallback(self) -> None:
        app = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        style = (ROOT / "static" / "style.css").read_text(encoding="utf-8")
        geometry = app[app.index("function syncMessageTraceGeometry"): app.index("function updateMessageTraceRail")]
        self.assertIn('$("#session-title")', geometry, "PRODUCT_FAIL: trace rail does not read the visible Agent title axis")
        self.assertRegex(geometry, r"titleRect\.left\s*-\s*mainRect\.left\s*-\s*2", "PRODUCT_FAIL: trace tick left edge is not aligned to title text")
        self.assertIn('rail.dataset.axisSource', geometry, "PRODUCT_FAIL: trace axis source is not observable in DOM evidence")
        self.assertRegex(geometry, r"Math\.max\(4,\s*Math\.round\(titleAxisLeft\)\)", "PRODUCT_FAIL: missing non-negative fallback for compact/collapsed layouts")
        self.assertIn('#message-trace-rail { left: var(--message-trace-left, 5px); }', style, "PRODUCT_FAIL: narrow media rule overrides the title-aligned rail")

    def test_context_ring_has_neutral_progress_and_track(self) -> None:
        css = (ROOT / "static" / "style.css").read_text(encoding="utf-8")
        final_css = css[css.rfind("/* v5.0.2 Claude surface"):]
        self.assertRegex(final_css, r"--context-ring-progress\s*:")
        self.assertRegex(final_css, r"--context-ring-track\s*:")
        self.assertRegex(final_css, r"stroke-linecap\s*:\s*round")
        self.assertRegex(final_css, r"stroke-dasharray\s*:")
        self.assertRegex(final_css, r"transform:\s*rotate\(-90deg\)")
        self.assertNotRegex(final_css, r"conic-gradient")
        self.assertNotRegex(final_css, r"--context-ring-progress\s*:\s*var\(--accent\)")
        self.assertRegex(final_css, r"color-mix\(in srgb, var\(--text\)")

    def test_inline_rename_width_is_content_sized_and_capped_by_available_slot(self) -> None:
        app = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        css = (ROOT / "static" / "style.css").read_text(encoding="utf-8")
        self.assertRegex(
            app,
            r"(?:scrollWidth|measureText|session-title-inline-width|fieldSizing)",
            "PRODUCT_FAIL: inline rename has no content-width measurement seam",
        )
        self.assertRegex(
            css[css.rfind("/* v5.0.2 session chrome"):],
            r"field-sizing\s*:\s*content|--session-title-inline-width",
            "PRODUCT_FAIL: inline rename still uses a fixed viewport width",
        )
        self.assertNotRegex(css, r"\.session-title-inline-input\s*\{[^}]*width:\s*min\(3[18]vw", "PRODUCT_FAIL: fixed vw title width remains")

    def test_equal_spacing_electron_fixture_is_a_real_dom_projection(self) -> None:
        evidence_parent = ROOT / "codex" / "运行残留"
        evidence_parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="v502-visual-followup2-red-", dir=evidence_parent) as temp:
            evidence = Path(temp)
            env = os.environ.copy()
            env["VINIPER_V502_VISUAL_FOLLOWUP2_EVIDENCE_ROOT"] = str(evidence)
            env["VINIPER_UI_OPEN_BROWSER"] = "0"
            env.pop("ELECTRON_RUN_AS_NODE", None)
            electron = ROOT / "desktop" / "node_modules" / "electron" / "dist" / "electron.exe"
            harness = ROOT / "tests" / "v502_visual_followup2_full_harness.js"
            self.assertTrue(electron.exists(), "HARNESS_FAIL: bundled Electron executable is missing")
            completed = subprocess.run(
                [str(electron), "--disable-gpu", f"--user-data-dir={evidence / 'electron-user-data'}", str(harness)],
                cwd=ROOT,
                env=env,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=120,
                check=False,
            )
            (evidence / "stdout.log").write_text(completed.stdout or "", encoding="utf-8")
            (evidence / "stderr.log").write_text(completed.stderr or "", encoding="utf-8")
            result_path = evidence / "visual-followup2-full-result.json"
            self.assertTrue(result_path.exists(), "HARNESS_FAIL: visual follow-up DOM result is missing")
            payload = json.loads(result_path.read_text(encoding="utf-8"))
            self.assertNotIn("__harnessError", payload, f"HARNESS_FAIL: {payload.get('__harnessError')}")
            self.assertEqual(completed.returncode, 0, "HARNESS_FAIL: visual follow-up Electron exited non-zero")
            self.assertEqual(set(payload["viewports"]), {"1280x800", "900x700"})
            for viewport in payload["viewports"].values():
                self.assertLessEqual(
                    viewport["maxDeltaError"],
                    1.0,
                    "PRODUCT_FAIL: real DOM rail ticks are not equally spaced",
                )
                contracts = viewport["spacingContracts"]
                self.assertEqual(contracts["compact"]["tickCount"], 3)
                compact_delta = contracts["compact"]["deltas"][0]
                self.assertGreaterEqual(compact_delta, 10.0)
                self.assertLessEqual(compact_delta, 12.0)
                self.assertLessEqual(contracts["dense"]["expected"], 12.0)
                self.assertEqual(viewport["scrollOwnerCount"], 1)
                self.assertEqual(viewport["traceAxis"]["source"], "agent-title")
                self.assertIsNotNone(viewport["traceAxis"]["delta"])
                self.assertLessEqual(viewport["traceAxis"]["delta"], 4.0, "PRODUCT_FAIL: trace tick axis drifts from Agent title")
                self.assertEqual(viewport["ringInfo"]["circleCount"], 2)
                self.assertEqual(viewport["ringInfo"]["progressLinecap"], "round")
                self.assertNotIn("matrix(1, 0, 0, 1", viewport["ringInfo"]["progressTransform"])
                self.assertNotIn("conic-gradient", viewport["ringInfo"]["backgroundImage"])
                self.assertIn("64,000 / 128,000", viewport["ringInfo"]["ariaLabel"])
                self.assertGreater(viewport["inputWidths"]["long"], viewport["inputWidths"]["short"])


if __name__ == "__main__":
    unittest.main()
