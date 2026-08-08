"""Synthetic S4 checks for profile values and create-only preview promotion."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


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

    def test_preview_package_resources_include_server_root_modules(self) -> None:
        package = json.loads((ROOT / "desktop" / "package.json").read_text(encoding="utf-8"))
        resources = package["build"]["extraResources"]
        resource = next(item for item in resources if item.get("to") == "viniper-ui")
        resource_filter = resource["filter"]
        self.assertIn("server.py", resource_filter)
        self.assertIn("context_lifecycle.py", resource_filter)
        self.assertIn("profiles.json", resource_filter)
        self.assertIn("static/**", resource_filter)

    def test_cli_promotion_accepts_only_exact_preview_profile_target(self) -> None:
        expected = build_preview.default_install_dir()
        self.assertEqual(
            build_preview.validate_cli_install_dir(str(expected)),
            expected.resolve(),
        )
        for rejected in (
            "D:\\Viniper",
            "D:\\Viniper UI",
            "D:\\Viniper UI Preview",
            "D:\\Viniper UI\\source\\viniper-ui\\desktop\\release-preview",
            str(ROOT / "codex" / "运行残留" / "arbitrary-preview-target"),
        ):
            with self.subTest(rejected=rejected), self.assertRaises(SystemExit):
                build_preview.validate_cli_install_dir(rejected)

        for rejected in ("D:\\Viniper", str(ROOT / "codex" / "运行残留" / "arbitrary-preview-target")):
            with self.subTest(cli_rejected=rejected), patch.object(sys, "argv", ["build_preview.py", "--install-dir", rejected]):
                with self.assertRaises(SystemExit):
                    build_preview.main()

    def test_preview_name_is_runtime_bound_without_changing_formal_identity(self) -> None:
        html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        desktop = (ROOT / "desktop" / "main.js").read_text(encoding="utf-8")
        server = (ROOT / "server.py").read_text(encoding="utf-8")
        self.assertIn("__APP_TITLE__", html)
        self.assertIn("const DISPLAY_NAME = IS_PREVIEW", desktop)
        self.assertIn('env.VINIPER_UI_DATA_DIR = app.getPath("userData")', desktop)
        self.assertIn('APP_TITLE = str(PREVIEW_PROFILE.get("product_name")', server)
        self.assertIn('data_dir_name = str(PREVIEW_PROFILE.get("data_dir_name")', server)

    def test_preview_runtime_profile_binds_service_page_and_data_root(self) -> None:
        probe_root = Path(tempfile.mkdtemp(prefix="profile-runtime-", dir=ROOT / "codex" / "运行残留"))
        appdata = probe_root / "AppData"
        env = os.environ.copy()
        env["VINIPER_UI_PREVIEW"] = "1"
        env["APPDATA"] = str(appdata)
        env["PYTHONIOENCODING"] = "utf-8"
        env.pop("VINIPER_UI_DATA_DIR", None)
        probe = """
import asyncio
import json
import server

async def run():
    page = await server.index()
    status = await server.status()
    print(json.dumps({"html": page.body.decode("utf-8"), "status": status}, ensure_ascii=False))

asyncio.run(run())
"""
        try:
            result = subprocess.run(
                [sys.executable, "-c", probe],
                cwd=ROOT,
                env=env,
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=True,
            )
            payload = json.loads(result.stdout.strip().splitlines()[-1])
            status = payload["status"]
            html = payload["html"]
            self.assertEqual(status["active_profile"], "preview")
            self.assertEqual(status["product_name"], "Viniper Preview")
            self.assertTrue(status["preview"])
            self.assertEqual(Path(status["data_dir"]).name, "Viniper Preview")
            self.assertIn("<title>Viniper Preview</title>", html)
            self.assertIn('<div class="brand">Viniper Preview</div>', html)
            self.assertNotIn("Viniper UI", html)
            self.assertFalse(appdata.exists())
        finally:
            shutil.rmtree(probe_root, ignore_errors=True)

    def test_source_and_desktop_versions_are_5_0_0(self) -> None:
        version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
        package = json.loads((ROOT / "desktop" / "package.json").read_text(encoding="utf-8"))
        lockfile = json.loads((ROOT / "desktop" / "package-lock.json").read_text(encoding="utf-8"))
        self.assertEqual(version, "5.0.0")
        self.assertEqual(package["version"], version)
        self.assertEqual(lockfile["version"], version)
        self.assertEqual(lockfile["packages"][""].get("version"), version)

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
