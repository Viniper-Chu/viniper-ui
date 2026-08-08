"""Synthetic S1 checks for session pin ordering and window-pin separation."""

from __future__ import annotations

import asyncio
import atexit
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_ROOT = ROOT / "codex" / "运行残留"
RUNTIME_ROOT.mkdir(parents=True, exist_ok=True)
TEST_DATA_DIR = Path(tempfile.mkdtemp(prefix="session-ordering-", dir=RUNTIME_ROOT))
os.environ["VINIPER_UI_DATA_DIR"] = str(TEST_DATA_DIR)
os.environ["VINIPER_UI_OPEN_BROWSER"] = "0"
sys.path.insert(0, str(ROOT))

import server  # noqa: E402


@atexit.register
def cleanup_test_data() -> None:
    shutil.rmtree(TEST_DATA_DIR, ignore_errors=True)


class JsonRequest:
    def __init__(self, payload: dict):
        self.payload = payload

    async def json(self) -> dict:
        return self.payload


def session(session_id: str, *, pinned: bool = False, updated: float = 0, created: float = 0, messages=None) -> dict:
    return {
        "id": session_id,
        "messages": list(messages or []),
        "created": created,
        "updated": updated,
        "name": session_id,
        "workdir": str(ROOT),
        "pinned": pinned,
        "claude_session_id": session_id,
        "claude_initialized": False,
        "summary": "",
    }


class SessionOrderingTests(unittest.TestCase):
    def setUp(self) -> None:
        server.sessions.clear()

    def tearDown(self) -> None:
        server.sessions.clear()

    def test_pinned_group_precedes_unpinned_with_deterministic_ties(self) -> None:
        records = {
            "zeta": session("zeta", updated=30, created=1),
            "pinned-late": session("pinned-late", pinned=True, updated=20, created=2),
            "pinned-early": session("pinned-early", pinned=True, updated=20, created=1),
            "alpha": session("alpha", updated=30, created=1),
        }
        ordered = [sid for sid, _ in sorted(records.items(), key=server.session_sort_key)]
        self.assertEqual(ordered, ["pinned-early", "pinned-late", "alpha", "zeta"])

    def test_missing_pin_is_legacy_false(self) -> None:
        normalized = server.normalize_session("legacy", {"messages": [{"role": "user", "content": "keep"}]})
        self.assertFalse(normalized["pinned"])
        self.assertEqual(normalized["messages"][0]["content"], "keep")

    def test_pin_update_persists_without_refreshing_updated_timestamp(self) -> None:
        server.sessions["a"] = session("a", updated=42, messages=[{"role": "user", "content": "keep"}])
        with patch.object(server, "save_sessions_to_disk"):
            result = asyncio.run(server.update_session("a", JsonRequest({"pinned": True})))
        self.assertTrue(result["session"]["pinned"])
        self.assertEqual(result["session"]["updated"], 42)
        self.assertEqual(result["session"]["messages"][0]["content"], "keep")

    def test_list_route_exposes_sorted_pin_state(self) -> None:
        server.sessions.update(
            {
                "unfixed": session("unfixed", updated=100),
                "fixed": session("fixed", pinned=True, updated=1),
            }
        )
        payload = asyncio.run(server.list_sessions())
        self.assertEqual([item["id"] for item in payload["sessions"]], ["fixed", "unfixed"])
        self.assertTrue(payload["sessions"][0]["pinned"])

    def test_window_and_session_controls_are_distinct(self) -> None:
        app_js = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        index_html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        self.assertIn("data-session-pin", app_js)
        self.assertNotIn("data-window-pin", app_js)
        self.assertIn("setSessionPinned", app_js)
        self.assertIn('id="always-on-top-btn"', index_html)
        self.assertIn("toggleAlwaysOnTop", app_js)


if __name__ == "__main__":
    unittest.main()
