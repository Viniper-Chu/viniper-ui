"""Static S3 contract checks; these do not claim real Electron visual proof."""

from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
CSS = (ROOT / "static" / "style.css").read_text(encoding="utf-8")
APP = (ROOT / "static" / "app.js").read_text(encoding="utf-8")


class UiContractTests(unittest.TestCase):
    def test_shell_has_semantic_landmarks_and_status_regions(self) -> None:
        self.assertIn("<aside id=\"sidebar\"", HTML)
        self.assertIn('id="workspace-rail"', HTML)
        self.assertIn('id="tool-area"', HTML)
        self.assertIn('id="artifact-area"', HTML)
        self.assertIn('<main id="main" aria-label="主工作区">', HTML)
        self.assertIn('role="log" aria-live="polite"', HTML)
        self.assertIn('role="status" aria-live="polite"', HTML)
        self.assertIn('id="input-area" aria-label="消息输入"', HTML)

    def test_visual_tokens_and_themes_are_local(self) -> None:
        for token in ("--color-canvas", "--color-surface", "--color-ink", "--color-divider", "--space-2", "--radius-control"):
            self.assertIn(token, CSS)
        self.assertIn(':root[data-theme="dark"]', CSS)
        self.assertIn("@media (prefers-reduced-motion: reduce)", CSS)
        self.assertNotIn("cdn.", CSS.lower())
        self.assertNotIn("<script src=\"http", HTML.lower())

    def test_narrow_and_standard_layout_contracts_exist(self) -> None:
        self.assertIn("@media (max-width: 900px)", CSS)
        self.assertIn("@media (max-width: 1100px)", CSS)
        self.assertIn("@media (max-width: 720px)", CSS)
        self.assertIn(".window-pin-button", CSS)
        self.assertIn("padding-bottom: 62px", CSS)
        self.assertIn("updateContextMeter({ schedule: false })", APP)

    def test_session_and_window_pin_semantics_remain_distinct(self) -> None:
        self.assertIn('id="always-on-top-btn"', HTML)
        self.assertIn("data-session-pin", APP)
        self.assertNotIn("data-window-pin", APP)
        self.assertIn("setSessionPinned", APP)
        self.assertIn("toggleAlwaysOnTop", APP)

    def test_context_state_is_visible_to_ui_contract(self) -> None:
        self.assertIn('id="context-ring"', HTML)
        self.assertIn('role="status"', HTML)
        self.assertNotIn('id="context-compress-btn"', HTML)
        self.assertNotIn("compressCurrentContext", APP)
        self.assertNotIn("auto = false", APP)
        self.assertNotIn("可手动重试", APP)
        self.assertIn("scheduleContextCompression", APP)
        self.assertIn("contextCompressionBySession", APP)
        self.assertIn("lastAttemptKey", APP)
        self.assertIn('status = "running"', APP)
        self.assertIn('status = "failed"', APP)
        self.assertIn('compressionState', APP)


if __name__ == "__main__":
    unittest.main()
