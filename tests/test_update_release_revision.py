"""Internal release revision and fail-closed downgrade regressions."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
RESIDUE = ROOT / "codex" / "运行残留"
RESIDUE.mkdir(parents=True, exist_ok=True)
_MODULE_DATA = tempfile.TemporaryDirectory(prefix="update-revision-module-", dir=RESIDUE)
os.environ["VINIPER_UI_DATA_DIR"] = _MODULE_DATA.name
os.environ["VINIPER_UI_OPEN_BROWSER"] = "0"

import server  # noqa: E402


class UpdateReleaseRevisionTests(unittest.TestCase):
    def test_5_0_0_revision_2_updates_once_to_5_0_1_revision_1(self) -> None:
        manifest = {"version": "5.0.1", "release_revision": 1}
        previous = server.update_decision(manifest, current_version="5.0.0", current_release_revision=2)
        current = server.update_decision(manifest, current_version="5.0.1", current_release_revision=1)
        self.assertTrue(previous["automatic"])
        self.assertEqual(previous["reason"], "newer_version")
        self.assertFalse(current["automatic"])
        self.assertFalse(current["manual_install_required"])
        self.assertEqual(current["reason"], "current")

    def test_same_visible_version_updates_once_by_internal_revision(self) -> None:
        manifest = {"version": "5.0.0", "release_revision": 1}
        older = server.update_decision(manifest, current_version="5.0.0", current_release_revision=0)
        current = server.update_decision(manifest, current_version="5.0.0", current_release_revision=1)
        self.assertTrue(older["automatic"])
        self.assertEqual(older["reason"], "newer_release_revision")
        self.assertFalse(current["automatic"])
        self.assertFalse(current["manual_install_required"])
        self.assertEqual(current["reason"], "current")

    def test_lower_visible_version_never_becomes_an_automatic_downgrade(self) -> None:
        manifest = {"version": "5.0.0", "release_revision": 1}
        decision = server.update_decision(manifest, current_version="5.0.1", current_release_revision=0)
        self.assertFalse(decision["automatic"])
        self.assertTrue(decision["manual_install_required"])
        self.assertEqual(decision["reason"], "manual_downgrade_only")

    def test_failed_app_update_restores_runtime_and_never_touches_user_data(self) -> None:
        allowed_files = [
            "server.py", "context_lifecycle.py", "context_usage.py", "daily_usage.py", "skill_sync.py",
            "agent_instructions.py", "agent_runtime.py", "agent_host_bridge.py",
            "agent_queue.py", "agent_run_coordinator.py", "native_peer.py", "wsl_runtime.py",
        ]
        with tempfile.TemporaryDirectory(prefix="update-rollback-", dir=RESIDUE) as raw:
            root = Path(raw)
            source = root / "source"
            target = root / "target"
            data = root / "data"
            source.mkdir()
            target.mkdir()
            data.mkdir()
            for name in allowed_files:
                (source / name).write_text(f"new:{name}\n", encoding="utf-8")
                (target / name).write_text(f"old:{name}\n", encoding="utf-8")
            (data / "sessions.json").write_text('{"sentinel":"sessions"}\n', encoding="utf-8")
            (data / "settings.json").write_text('{"sentinel":"settings"}\n', encoding="utf-8")

            real_replace = server.os.replace
            failed = False

            def fail_once(source_path, target_path):
                nonlocal failed
                source_value = Path(source_path)
                target_value = Path(target_path)
                if (
                    not failed
                    and "update-staging" in source_value.parts
                    and target_value == target / "context_lifecycle.py"
                ):
                    failed = True
                    raise OSError("fixture apply failure")
                return real_replace(source_path, target_path)

            with mock.patch.object(server, "DATA_DIR", data), mock.patch.object(server.os, "replace", side_effect=fail_once):
                with self.assertRaises(OSError):
                    server.copy_update_tree(source, target)

            self.assertTrue(failed)
            for name in allowed_files:
                self.assertEqual((target / name).read_text(encoding="utf-8"), f"old:{name}\n")
            self.assertEqual((data / "sessions.json").read_text(encoding="utf-8"), '{"sentinel":"sessions"}\n')
            self.assertEqual((data / "settings.json").read_text(encoding="utf-8"), '{"sentinel":"settings"}\n')


if __name__ == "__main__":
    unittest.main()
