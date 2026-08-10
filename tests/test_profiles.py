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

from scripts import build_installer_candidate, build_preview  # noqa: E402


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
        self.assertEqual(package["build"]["productName"], "Viniper")
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
        self.assertIn("context_usage.py", resource_filter)
        self.assertIn("agent_instructions.py", resource_filter)
        self.assertIn("agent_runtime.py", resource_filter)
        self.assertIn("agent_run_coordinator.py", resource_filter)
        self.assertIn("native_peer.py", resource_filter)
        self.assertIn("skill_sync.py", resource_filter)
        self.assertIn("wsl_runtime.py", resource_filter)
        self.assertIn("RELEASE_REVISION", resource_filter)
        self.assertIn("profiles.json", resource_filter)
        self.assertIn("static/**", resource_filter)
        self.assertIn("!codex/**", resource_filter)
        self.assertIn("!.git/**", resource_filter)
        self.assertIn("!.omx/**", resource_filter)

    def test_cli_promotion_accepts_only_exact_preview_profile_target(self) -> None:
        expected = build_preview.default_install_dir()
        if expected.exists():
            with self.assertRaises(SystemExit):
                build_preview.validate_cli_install_dir(str(expected))
        else:
            self.assertEqual(
                build_preview.validate_cli_install_dir(str(expected)),
                expected.resolve(),
            )

        synthetic_expected = ROOT / "codex" / "运行残留" / "test-exact-preview-target"
        with patch.object(build_preview, "default_install_dir", return_value=synthetic_expected):
            self.assertEqual(
                build_preview.validate_cli_install_dir(str(synthetic_expected)),
                synthetic_expected.resolve(),
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

    def test_formal_brand_keeps_the_existing_desktop_data_identity(self) -> None:
        desktop = (ROOT / "desktop" / "main.js").read_text(encoding="utf-8")
        self.assertIn("function formalUserDataDir()", desktop)
        self.assertIn('return path.join(app.getPath("appData"), "Viniper UI")', desktop)
        self.assertIn('app.setPath("userData", formalUserDataDir())', desktop)
        self.assertIn('app.setPath("userData", previewUserDataDir())', desktop)

    def test_formal_visible_brand_is_viniper_without_ui_suffix(self) -> None:
        package = json.loads((ROOT / "desktop" / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["build"]["productName"], "Viniper")
        self.assertEqual(package["build"]["nsis"]["shortcutName"], "Viniper")
        self.assertEqual(package["build"]["win"]["artifactName"], "Viniper.Setup.${version}.${ext}")
        for relative in (
            "LICENSE",
            "start.bat",
            "scripts/verify_provider_routing.py",
            "scripts/verify_slash_suggestions.py",
        ):
            self.assertNotIn("Viniper UI", (ROOT / relative).read_text(encoding="utf-8"), relative)
        server = (ROOT / "server.py").read_text(encoding="utf-8")
        self.assertIn('"Viniper Goal Mode is a hidden outer controller', server)

    def test_runtime_profile_updates_visible_environment_copy(self) -> None:
        html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        renderer = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        self.assertIn('id="profile-label"', html)
        self.assertIn('id="composer-status"', html)
        self.assertIn("function updateRuntimeProfileChrome()", renderer)
        self.assertIn("updateRuntimeProfileChrome();", renderer)
        script = r'''
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync("static/app.js", "utf8") + "\nthis.__api = { runtimeProfileChromeCopy };";
const context = {
  console, TextDecoder, TextEncoder, WeakMap,
  performance: { now: () => 0 },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: { addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] },
  window: { VINIPER_APP_TITLE: "Viniper" },
  setTimeout, clearTimeout, setInterval, clearInterval
};
vm.createContext(context);
vm.runInContext(source, context);
process.stdout.write(JSON.stringify({formal: context.__api.runtimeProfileChromeCopy(false), preview: context.__api.runtimeProfileChromeCopy(true)}));
'''
        result = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True)
        copy = json.loads(result.stdout)
        self.assertEqual(copy["formal"], {
            "profileLabel": "本地环境",
            "composerStatus": "本地会话 · 数据保存在当前 Viniper 环境",
        })
        self.assertEqual(copy["preview"], {
            "profileLabel": "预览环境",
            "composerStatus": "本地会话 · 数据保存在当前 Preview 环境",
        })

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

    def test_installer_candidate_is_create_only_and_carries_runtime_contract(self) -> None:
        script = (ROOT / "scripts" / "build_installer_candidate.py").read_text(encoding="utf-8")
        main = (ROOT / "desktop" / "main.js").read_text(encoding="utf-8")
        preload = (ROOT / "desktop" / "preload.js").read_text(encoding="utf-8")
        package = json.loads((ROOT / "desktop" / "package.json").read_text(encoding="utf-8"))
        resource_filter = package["build"]["extraResources"][0]["filter"]
        self.assertIn("Viniper.Preview.Setup.${version}.${ext}", script)
        self.assertIn('config.setdefault("nsis", {})["shortcutName"]', script)
        self.assertIn("patch_preview_executable(output", script)
        self.assertIn('"--prepackaged"', script)
        self.assertLess(script.index("patch_preview_executable(output"), script.index('"--prepackaged"'))
        self.assertIn('"promotion": False', script)
        self.assertNotIn("rmtree", script)
        self.assertIn("viniper:enable-wsl-platform", main)
        self.assertIn("viniper:enable-wsl-platform", preload)
        self.assertIn("daily_usage.py", resource_filter)
        self.assertIn('resources / "daily_usage.py"', script)
        self.assertIn("skill_sync.py", resource_filter)
        self.assertIn('resources / "skill_sync.py"', script)

        temp_root = Path(tempfile.mkdtemp(prefix="installer-candidate-", dir=ROOT / "codex" / "运行残留"))
        try:
            with patch.object(build_installer_candidate, "OUTPUT_ROOT", temp_root):
                output, run_id = build_installer_candidate.create_output("contract-fixture")
                self.assertEqual(run_id, "contract-fixture")
                marker = json.loads((output / "OWNERSHIP.json").read_text(encoding="utf-8"))
                self.assertFalse(marker["promotion"])
                with self.assertRaises(SystemExit):
                    build_installer_candidate.create_output("contract-fixture")
        finally:
            shutil.rmtree(temp_root, ignore_errors=True)

    def test_installer_candidate_gate_rejects_missing_daily_usage_module(self) -> None:
        temp_root = Path(tempfile.mkdtemp(prefix="installer-resource-gate-", dir=ROOT / "codex" / "运行残留"))
        try:
            output = temp_root / "candidate"
            resources = output / "win-unpacked" / "resources" / "viniper-ui"
            resources.mkdir(parents=True)
            (output / "Viniper.Preview.Setup.5.0.0.exe").write_bytes(b"fixture")
            for name in (
                "server.py",
                "context_lifecycle.py",
                "agent_runtime.py",
                "agent_host_bridge.py",
                "agent_queue.py",
                "agent_run_coordinator.py",
                "wsl_runtime.py",
                "agent_instructions.py",
                "context_usage.py",
                "native_peer.py",
                "profiles.json",
                "requirements.txt",
                "VERSION",
                "RELEASE_REVISION",
            ):
                (resources / name).write_text("# fixture\n", encoding="utf-8")
            icon = resources / "static" / "assets" / "viniper-icon.ico"
            icon.parent.mkdir(parents=True)
            icon.write_bytes(b"ico")

            with self.assertRaises(SystemExit) as missing:
                build_installer_candidate.verify_candidate(output)
            self.assertIn("daily_usage.py", str(missing.exception))
            self.assertIn("skill_sync.py", str(missing.exception))

            (resources / "daily_usage.py").write_text("# fixture\n", encoding="utf-8")
            (resources / "skill_sync.py").write_text("# fixture\n", encoding="utf-8")
            manifest = build_installer_candidate.verify_candidate(output)
            self.assertTrue(manifest["ok"])
            self.assertIn(
                "win-unpacked\\resources\\viniper-ui\\daily_usage.py",
                manifest["required_resources"],
            )
            self.assertIn(
                "win-unpacked\\resources\\viniper-ui\\skill_sync.py",
                manifest["required_resources"],
            )
            self.assertIn(
                "win-unpacked\\resources\\viniper-ui\\agent_host_bridge.py",
                manifest["required_resources"],
            )
            self.assertIn(
                "win-unpacked\\resources\\viniper-ui\\agent_queue.py",
                manifest["required_resources"],
            )
            self.assertIn(
                "win-unpacked\\resources\\viniper-ui\\agent_run_coordinator.py",
                manifest["required_resources"],
            )
        finally:
            shutil.rmtree(temp_root, ignore_errors=True)

    def test_installer_candidate_uses_clean_resource_staging_not_workspace_root(self) -> None:
        temp_root = Path(tempfile.mkdtemp(prefix="installer-resources-", dir=ROOT / "codex" / "运行残留"))
        try:
            staging = temp_root / "resource-staging"
            config_path = build_installer_candidate.prepare_resource_staging(
                staging,
                build_installer_candidate.preview_profile(),
            )
            config = json.loads(config_path.read_text(encoding="utf-8"))
            resource = config["extraResources"][0]
            self.assertEqual(Path(resource["from"]), staging.resolve())
            self.assertEqual(resource["to"], "viniper-ui")
            self.assertTrue((staging / "server.py").is_file())
            self.assertTrue((staging / "skill_sync.py").is_file())
            self.assertTrue((staging / "static" / "app.js").is_file())
            self.assertFalse((staging / "codex").exists())
            self.assertFalse((staging / ".git").exists())
            self.assertFalse((staging / ".omx").exists())
        finally:
            shutil.rmtree(temp_root, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
