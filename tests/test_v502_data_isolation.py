"""Regression gate for test-only session storage isolation."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EVIDENCE_ROOT = ROOT / "codex" / "运行残留"


class TestDataIsolation(unittest.TestCase):
    def test_v15_permission_boundary_does_not_write_the_configured_data_root(self) -> None:
        """Run the real ASGI test in a sentinel root and require byte preservation."""
        with tempfile.TemporaryDirectory(prefix="v502-data-isolation-red-", dir=EVIDENCE_ROOT) as temp:
            data_root = Path(temp)
            sentinel = data_root / "sessions.json"
            sentinel.write_text(
                json.dumps(
                    {
                        "sentinel": {
                            "id": "sentinel",
                            "mode": "chat",
                            "messages": [],
                            "created": 1.0,
                            "updated": 1.0,
                        }
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            before = sentinel.read_bytes()
            env = os.environ.copy()
            env.update({
                "VINIPER_UI_DATA_DIR": str(data_root),
                "VINIPER_UI_OPEN_BROWSER": "0",
            })
            completed = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "unittest",
                    "tests.test_v15_daily_usage.PermissionModeRequestBoundaryTests.test_unknown_agent_permission_id_is_rejected_before_stream_start",
                ],
                cwd=ROOT,
                env=env,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            self.assertEqual(completed.returncode, 0, completed.stderr[-2000:])
            self.assertEqual(sentinel.read_bytes(), before)

    def test_formal_sessions_metadata_is_unchanged_by_isolated_test(self) -> None:
        """The suite must not touch the user's formal session file at all."""
        formal = Path(os.environ.get("APPDATA", "")) / "Viniper UI" / "sessions.json"
        if not formal.is_file():
            self.skipTest("formal sessions file is not present on this machine")
        before = formal.stat()
        before_bytes = formal.read_bytes()
        env = os.environ.copy()
        env.update({"VINIPER_UI_OPEN_BROWSER": "0"})
        completed = subprocess.run(
            [
                sys.executable,
                "-m",
                "unittest",
                "tests.test_v15_daily_usage.PermissionModeRequestBoundaryTests.test_unknown_agent_permission_id_is_rejected_before_stream_start",
            ],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        self.assertEqual(completed.returncode, 0, completed.stderr[-2000:])
        after = formal.stat()
        self.assertEqual(after.st_size, before.st_size)
        self.assertEqual(after.st_mtime_ns, before.st_mtime_ns)
        self.assertEqual(formal.read_bytes(), before_bytes)


if __name__ == "__main__":
    unittest.main()
