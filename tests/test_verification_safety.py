"""Regression checks for verification and shortcut preservation boundaries."""

from __future__ import annotations

import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch

from scripts import verify_release


ROOT = Path(__file__).resolve().parents[1]


class VerificationSafetyTests(unittest.TestCase):
    def test_local_api_verification_is_forced_into_preview_mode(self) -> None:
        source = (ROOT / "scripts" / "verify_app.py").read_text(encoding="utf-8")
        self.assertIn('env["VINIPER_UI_PREVIEW"] = "1"', source)
        self.assertIn('env["VINIPER_UI_DATA_DIR"] = str(data_dir)', source)
        self.assertIn('ROOT / "codex" / "运行残留"', source)

    def test_shortcut_refresh_saves_only_when_identity_changes(self) -> None:
        source = (ROOT / "server.py").read_text(encoding="utf-8")
        start = source.index("function Update-ViniperShortcut($path)")
        end = source.index("if (Test-Path -LiteralPath $desktop)", start)
        helper = source[start:end]
        self.assertIn("$changed = -not $exists", helper)
        self.assertIn("if ($changed) {{ $shortcut.Save() }}", helper)

    def test_release_source_scan_excludes_local_evidence_and_build_outputs(self) -> None:
        with tempfile.TemporaryDirectory(prefix="release-scan-", dir=ROOT / "codex" / "运行残留") as temp:
            fixture = Path(temp)
            source = fixture / "server.py"
            source.write_text("print('source')\n", encoding="utf-8")
            evidence = fixture / "codex" / "运行残留" / "evidence.txt"
            evidence.parent.mkdir(parents=True)
            evidence.write_text("local evidence\n", encoding="utf-8")
            release_output = fixture / "desktop" / "release" / "artifact.txt"
            release_output.parent.mkdir(parents=True)
            release_output.write_text("artifact\n", encoding="utf-8")
            listed = set(verify_release.release_source_files(fixture))
            self.assertIn(source, listed)
            self.assertNotIn(evidence, listed)
            self.assertNotIn(release_output, listed)

    def test_release_source_scan_never_stats_pruned_codex_entry(self) -> None:
        with tempfile.TemporaryDirectory(prefix="release-prune-", dir=ROOT / "codex" / "运行残留") as temp:
            fixture = Path(temp)
            source = fixture / "server.py"
            source.write_text("print('source')\n", encoding="utf-8")
            ignored = fixture / "codex" / "inaccessible-link"
            ignored.parent.mkdir(parents=True)
            ignored.write_text("ignored\n", encoding="utf-8")
            original = Path.is_file

            def guarded_is_file(path: Path) -> bool:
                if path.name == "inaccessible-link":
                    raise OSError("pruned evidence must not be stat'ed")
                return original(path)

            with patch.object(Path, "is_file", guarded_is_file):
                listed = set(verify_release.release_source_files(fixture))
            self.assertEqual(listed, {source})

    def test_release_source_scan_fails_closed_when_publishable_file_is_inaccessible(self) -> None:
        with tempfile.TemporaryDirectory(prefix="release-fail-closed-", dir=ROOT / "codex" / "运行残留") as temp:
            fixture = Path(temp)
            source = fixture / "server.py"
            source.write_text("print('source')\n", encoding="utf-8")
            original = Path.is_file

            def inaccessible_source(path: Path) -> bool:
                if path == source:
                    raise OSError("source inaccessible")
                return original(path)

            with patch.object(Path, "is_file", inaccessible_source):
                with self.assertRaises(SystemExit):
                    verify_release.release_source_files(fixture)


if __name__ == "__main__":
    unittest.main()
