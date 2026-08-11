"""High-value v5.0.2 red/green contracts for session chrome and inline status.

The fixture uses the production renderer in a bundled Electron window and never
contacts a provider or the formal/Preview data roots.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class SessionChromeContractTests(unittest.TestCase):
    def test_inline_rename_and_session_scoped_status_seams(self) -> None:
        index = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        style = (ROOT / "static" / "style.css").read_text(encoding="utf-8")
        self.assertIn('id="session-title-button"', index)
        self.assertIn("session-title-inline-input", app)
        self.assertIn("startInlineSessionRename", app)
        self.assertIn("persistSessionName", app)
        self.assertIn('id="session-inline-status"', index)
        self.assertIn("renderSessionInlineStatus", app)
        self.assertIn("session-inline-status", style)
        self.assertIn(".session-title-inline-input.is-editing", style)
        self.assertIn("#2f70d9", style)
        self.assertNotIn('renameSessionRecord(state.sessionId', app)

    def test_product_errors_use_inline_status_not_browser_alert(self) -> None:
        app = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        self.assertNotRegex(app, r"\balert\s*\(")
        self.assertIn("showInlineStatus", app)
        # The left-list rename modal remains a distinct, supported entry point.
        index = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="rename-session-modal"', index)

    def test_real_electron_session_chrome_and_layout_contract(self) -> None:
        evidence_parent = ROOT / "codex" / "运行残留"
        evidence_parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="v502-session-chrome-", dir=evidence_parent) as temp:
            evidence = Path(temp)
            env = os.environ.copy()
            env["VINIPER_V502_SESSION_CHROME_EVIDENCE_ROOT"] = str(evidence)
            env["VINIPER_UI_OPEN_BROWSER"] = "0"
            env.pop("ELECTRON_RUN_AS_NODE", None)
            electron = ROOT / "desktop" / "node_modules" / "electron" / "dist" / "electron.exe"
            harness = ROOT / "tests" / "v502_session_chrome_harness.js"
            self.assertTrue(electron.exists(), "HARNESS_FAIL: bundled Electron executable is missing")
            completed = subprocess.run(
                [str(electron), str(harness)],
                cwd=ROOT,
                env=env,
                capture_output=True,
                text=True,
                timeout=120,
                check=False,
            )
            (evidence / "stdout.log").write_text(completed.stdout or "", encoding="utf-8")
            (evidence / "stderr.log").write_text(completed.stderr or "", encoding="utf-8")
            result_path = evidence / "session-chrome-result.json"
            self.assertTrue(result_path.exists(), "HARNESS_FAIL: Electron did not emit session-chrome-result.json")
            payload = json.loads(result_path.read_text(encoding="utf-8"))
            self.assertNotIn("__harnessError", payload, f"HARNESS_FAIL: {payload.get('__harnessError')}")
            self.assertEqual(completed.returncode, 0, "HARNESS_FAIL: Electron exited non-zero")
            for name, item in payload.get("viewports", {}).items():
                rename = item["rename"]
                self.assertEqual(rename["inputRole"], "textbox", f"PRODUCT_FAIL {name}: title did not become inline input")
                self.assertTrue(rename["selected"], f"PRODUCT_FAIL {name}: inline title was not selected")
                self.assertEqual(rename["activeElement"], "session-title-inline-input", f"PRODUCT_FAIL {name}: inline title input did not retain focus")
                self.assertTrue(rename["blueFocus"], f"PRODUCT_FAIL {name}: inline title focus is not the thin Windows/Claude blue ring")
                self.assertIn("2px", rename["focusBoxShadow"], f"PRODUCT_FAIL {name}: inline title focus ring is missing")
                self.assertTrue(rename["requestBody"]["name"], f"PRODUCT_FAIL {name}: rename did not send a non-empty name")
                self.assertEqual(rename["afterSaveTitle"], rename["requestBody"]["name"], f"PRODUCT_FAIL {name}: title did not sync after save")
                self.assertFalse(rename["savedInputPresent"], f"PRODUCT_FAIL {name}: saved title still has inline editor")
                self.assertNotIn("47, 112, 217", rename["savedButtonShadow"], f"PRODUCT_FAIL {name}: saved title retained blue edit ring")
                self.assertEqual(rename["afterCancelTitle"], "B 会话 / 会議", f"PRODUCT_FAIL {name}: Escape leaked rename into another session")
                self.assertTrue(rename["pointerTarget"], f"HARNESS_FAIL {name}: pointer target was not resolved")
                self.assertEqual(rename["failureRestoredTitle"], "B 会话 / 会議", f"PRODUCT_FAIL {name}: failed rename did not restore title")
                self.assertTrue(rename["failureInlineError"], f"PRODUCT_FAIL {name}: failed rename had no inline error")
                paused = item["paused"]
                self.assertNotEqual(paused["a"]["display"], "none", f"PRODUCT_FAIL {name}: paused A status is not visible")
                self.assertFalse(paused["a"]["inputDisabled"], f"PRODUCT_FAIL {name}: paused status blocks input")
                self.assertFalse(paused["a"]["statusUsageOverlap"], f"PRODUCT_FAIL {name}: paused status overlaps usage card")
                self.assertFalse(paused["a"]["statusMessagesOverlap"], f"PRODUCT_FAIL {name}: paused status overlaps message container")
                self.assertEqual(paused["b"]["display"], "none", f"PRODUCT_FAIL {name}: paused A leaked into B")
                self.assertNotEqual(paused["aRestored"]["display"], "none", f"PRODUCT_FAIL {name}: A pause did not restore")
                self.assertEqual(paused["aCompleted"]["display"], "none", f"PRODUCT_FAIL {name}: completed A retained pause status")
                layout = item["layout"]
                self.assertEqual(layout["chat"]["surface"], "chat-composer", f"PRODUCT_FAIL {name}: Chat composer surface changed")
                self.assertEqual(layout["agent"]["surface"], "agent-composer", f"PRODUCT_FAIL {name}: Agent composer surface changed")
                self.assertTrue(layout["chat"]["messagesCentered"], f"PRODUCT_FAIL {name}: Chat messages are not centered")
                self.assertTrue(layout["chat"]["modelVisible"], f"PRODUCT_FAIL {name}: Chat model control disappeared")
                self.assertEqual(layout["chat"]["agentOnlyVisible"], 0, f"PRODUCT_FAIL {name}: Agent-only controls leaked into Chat")
                self.assertGreater(layout["agent"]["toolsWidth"], 0, f"PRODUCT_FAIL {name}: Agent tool row disappeared")
                shots = item.get("screenshots", {})
                for key in ("renameEdit", "renameSaved", "paused", "chat", "agent"):
                    shot = shots.get(key)
                    self.assertTrue(shot, f"HARNESS_FAIL {name}: missing {key} screenshot path")
                    self.assertTrue((evidence / shot).exists(), f"HARNESS_FAIL {name}: screenshot {shot} missing")
                self.assertEqual(item.get("final", {}).get("titleErrorCount"), 0, f"PRODUCT_FAIL {name}: final frame retains rename error")


if __name__ == "__main__":
    unittest.main()
