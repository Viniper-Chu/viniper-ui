"""Static guardrails for the v5.0.2 legacy-UI inventory.

The protocol-backed modals and interaction cards remain supported; this guard
only rejects browser-owned feedback and the retired banner/toast shells.
"""

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]


class LegacyUiInventoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.app = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        cls.index = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        cls.style = (ROOT / "static" / "style.css").read_text(encoding="utf-8")

    def test_browser_feedback_and_retired_shells_are_absent(self) -> None:
        self.assertNotRegex(self.app, r"\b(?:alert|confirm|prompt)\s*\(")
        self.assertNotIn("window.alert", self.app)
        self.assertNotIn("window.confirm", self.app)
        self.assertNotIn("window.prompt", self.app)
        self.assertIn("showInlineStatus", self.app)
        self.assertNotIn("context-notice", self.app)
        self.assertNotIn("compressed-banner", self.app)
        self.assertNotIn("liquidBorder", self.style)

    def test_supported_protocol_surfaces_have_current_dom_seams(self) -> None:
        # Supported behavior is intentionally retained, but all entry points
        # use current inline/Claude-style surfaces rather than browser chrome.
        for element_id in (
            "rename-session-modal",
            "text-input-modal",
            "delete-session-modal",
            "settings-modal",
            "folder-picker-modal",
            "interaction-dock",
            "message-trace-rail",
            "session-inline-status",
        ):
            self.assertIn(f'id="{element_id}"', self.index)
        for token in (
            "inline-interaction-card",
            "message-attachment-card",
            "showInlineStatus",
            "startInlineSessionRename",
            "showTextInputModal",
            "updateMessageTraceRail",
        ):
            self.assertIn(token, self.app)

    def test_no_legacy_banner_css_and_interaction_card_style_is_scoped(self) -> None:
        self.assertNotRegex(self.style, r"\.(?:context-notice|compressed-banner)\b")
        self.assertIn(".interaction-dock .inline-interaction-card", self.style)
        self.assertIn(".message-attachment-card", self.style)
        self.assertIn(".session-inline-status", self.style)
        self.assertIn(".message-trace-preview", self.style)


if __name__ == "__main__":
    unittest.main()
