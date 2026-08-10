"""Regression checks for verification and shortcut preservation boundaries."""

from __future__ import annotations

import json
import os
import subprocess
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch

from scripts import verify_release


ROOT = Path(__file__).resolve().parents[1]


class VerificationSafetyTests(unittest.TestCase):
    @staticmethod
    def shortcut_app_id(path: Path) -> str:
        escaped = str(path).replace("'", "''")
        script = rf"""
$path = '{escaped}'
$shell = New-Object -ComObject Shell.Application
$folder = $shell.Namespace((Split-Path -Parent $path))
$item = $folder.ParseName((Split-Path -Leaf $path))
[Console]::Out.Write([string]$item.ExtendedProperty('System.AppUserModel.ID'))
"""
        completed = subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        return completed.stdout.strip()

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

    @unittest.skipUnless(os.name == "nt", "Windows shortcut property store is required")
    def test_shortcut_refresh_persists_runtime_app_id(self) -> None:
        import server

        with tempfile.TemporaryDirectory(prefix="shortcut-app-id-", dir=ROOT / "codex" / "运行残留") as temp:
            fixture = Path(temp)
            home = fixture / "home"
            desktop = home / "Desktop"
            appdata = fixture / "appdata"
            start_menu = appdata / "Microsoft" / "Windows" / "Start Menu" / "Programs"
            desktop.mkdir(parents=True)
            start_menu.mkdir(parents=True)
            target = Path(os.environ["SystemRoot"]) / "System32" / "notepad.exe"

            with (
                patch.object(server, "PREVIEW_MODE", False),
                patch.object(server, "current_windows_desktop_exe", return_value=target),
                patch.object(server.Path, "home", return_value=home),
                patch.dict(os.environ, {"APPDATA": str(appdata)}),
            ):
                server.refresh_windows_shortcuts()

            shortcuts = [desktop / "Viniper.lnk", start_menu / "Viniper.lnk"]
            self.assertTrue(all(path.is_file() for path in shortcuts))
            self.assertEqual(
                [self.shortcut_app_id(path) for path in shortcuts],
                ["com.viniper.ui.desktop", "com.viniper.ui.desktop"],
            )

    def test_installer_reapplies_its_configured_app_id_to_both_shortcuts(self) -> None:
        package = json.loads((ROOT / "desktop" / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["build"]["appId"], "com.viniper.ui.desktop")
        self.assertEqual(package["build"]["nsis"]["include"], "build/installer.nsh")
        installer = (ROOT / "desktop" / "build" / "installer.nsh").read_text(encoding="utf-8")
        self.assertIn("$newDesktopLink", installer)
        self.assertIn("$newStartMenuLink", installer)
        self.assertEqual(installer.count("set_shortcut_app_id.ps1"), 2)
        self.assertEqual(installer.count('-AppUserModelId "${APP_ID}"'), 2)
        self.assertEqual(installer.count("Abort \"Viniper"), 2)

    def test_taskbar_fix_is_an_internal_revision_without_visible_version_change(self) -> None:
        package = json.loads((ROOT / "desktop" / "package.json").read_text(encoding="utf-8"))
        self.assertEqual((ROOT / "VERSION").read_text(encoding="utf-8").strip(), "5.0.0")
        self.assertEqual(package["version"], "5.0.0")
        self.assertEqual((ROOT / "RELEASE_REVISION").read_text(encoding="utf-8").strip(), "2")

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
