"""Synthetic S4 checks for profile values and create-only preview promotion."""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts import build_preview  # noqa: E402


class ProfileAndPreviewSafetyTests(unittest.TestCase):
    def test_approved_profiles_are_centralized(self) -> None:
        profiles = json.loads((ROOT / "profiles.json").read_text(encoding="utf-8"))
        formal = profiles["formal"]
        preview = profiles["preview"]
        legacy = profiles["legacy_read_only"]
        self.assertEqual(formal["app_id"], "com.viniper.desktop")
        self.assertEqual(formal["product_name"], "Viniper")
        self.assertEqual(formal["install_dir"], "D:\\Viniper")
        self.assertEqual(preview["app_id"], "com.viniper.desktop.preview")
        self.assertEqual(preview["product_name"], "Viniper Preview")
        self.assertEqual(preview["port"], 17946)
        self.assertEqual(preview["data_dir_name"], "Viniper Preview")
        self.assertIn("no formal or legacy import", preview["compatibility_read_boundary"])
        self.assertFalse(legacy["writable"])
        self.assertEqual(legacy["ports"], [])
        self.assertIn("read-only", legacy["compatibility_read_boundary"])

    def test_formal_runtime_package_remains_legacy_until_release_migration(self) -> None:
        package = json.loads((ROOT / "desktop" / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["build"]["appId"], "com.viniper.ui.desktop")
        self.assertEqual(package["build"]["productName"], "Viniper UI")
        self.assertEqual(package["viniperProfile"], "formal-runtime")

    def test_builder_has_no_protected_release_cleaner(self) -> None:
        source = (ROOT / "scripts" / "build_preview.py").read_text(encoding="utf-8")
        self.assertIn("STAGING_ROOT", source)
        self.assertIn("OWNERSHIP.json", source)
        self.assertIn("install target already exists", source)
        self.assertIn("D:/Viniper UI Preview", source)
        self.assertIn('ROOT / "desktop" / "release-preview"', source)
        self.assertNotIn("PREVIEW_RELEASE", source)
        self.assertNotIn("PREVIEW_MARKER", source)

    def test_preview_name_is_runtime_bound_without_changing_formal_identity(self) -> None:
        html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        desktop = (ROOT / "desktop" / "main.js").read_text(encoding="utf-8")
        server = (ROOT / "server.py").read_text(encoding="utf-8")
        self.assertIn("__APP_TITLE__", html)
        self.assertIn("const DISPLAY_NAME = IS_PREVIEW", desktop)
        self.assertIn('APP_TITLE = str(PREVIEW_PROFILE.get("product_name")', server)
        self.assertIn('data_dir_name = str(PREVIEW_PROFILE.get("data_dir_name")', server)

    def test_synthetic_staging_promotes_only_to_new_target(self) -> None:
        staging, _ = build_preview.create_owned_staging("test-s4-ownership")
        temp_parent = Path(tempfile.mkdtemp(prefix="preview-target-", dir=ROOT / "codex" / "运行残留"))
        target = temp_parent / "Viniper Preview"
        try:
            source = staging / "release" / "win-unpacked"
            source.mkdir(parents=True)
            (source / "Viniper Preview.exe").write_text("synthetic", encoding="utf-8")
            build_preview.copy_preview_app(staging, target)
            self.assertEqual((target / "Viniper Preview.exe").read_text(encoding="utf-8"), "synthetic")
            with self.assertRaises(SystemExit):
                build_preview.copy_preview_app(staging, target)
            self.assertEqual((target / "Viniper Preview.exe").read_text(encoding="utf-8"), "synthetic")
        finally:
            shutil.rmtree(target, ignore_errors=True)
            shutil.rmtree(temp_parent, ignore_errors=True)
            shutil.rmtree(staging, ignore_errors=True)

    def test_reused_staging_id_is_rejected(self) -> None:
        staging, _ = build_preview.create_owned_staging("test-s4-duplicate")
        try:
            with self.assertRaises(SystemExit):
                build_preview.create_owned_staging("test-s4-duplicate")
        finally:
            shutil.rmtree(staging, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
