"""v17 release asset closure regressions.

These tests stay entirely inside codex/运行残留 and never publish or contact
GitHub.  They exercise the actual release builder and verifier seams.
"""

from __future__ import annotations

import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
RESIDUE = ROOT / "codex" / "运行残留"


def load_script(name: str, relative: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {relative}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ReleaseBuilderInstallerManifestTests(unittest.TestCase):
    def setUp(self) -> None:
        RESIDUE.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="v17-release-builder-", dir=RESIDUE)
        self.root = Path(self.temp.name)
        (self.root / "server.py").write_text("print('fixture')\n", encoding="utf-8")
        (self.root / "VERSION").write_text("5.0.0\n", encoding="utf-8")
        (self.root / "RELEASE_REVISION").write_text("1\n", encoding="utf-8")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def run_builder(self, *, with_installers: bool) -> dict[str, object]:
        if with_installers:
            release = self.root / "desktop" / "release"
            release.mkdir(parents=True)
            (release / "Viniper.Setup.5.0.0.exe").write_bytes(b"windows-installer")
            (release / "Viniper.Setup.5.0.0.exe.blockmap").write_bytes(b"windows-map")
            (release / "Viniper.5.0.0-arm64-mac.zip").write_bytes(b"mac-arm64-installer")
            (release / "Viniper.5.0.0-arm64-mac.zip.blockmap").write_bytes(b"mac-arm64-map")
            (release / "Viniper.5.0.0-x64-mac.zip").write_bytes(b"mac-x64-installer")
            (release / "Viniper.5.0.0-x64-mac.zip.blockmap").write_bytes(b"mac-x64-map")

        builder = load_script("v17_build_release_fixture", "scripts/build_release.py")
        builder.ROOT = self.root
        builder.DIST = self.root / "dist"
        builder.BUILD = builder.DIST / "build"
        builder.APP_FILES = ["server.py", "VERSION", "RELEASE_REVISION"]
        builder.APP_DIRS = []
        with mock.patch.object(
            sys,
            "argv",
            ["build_release.py", "--repo", "owner/repo", "--notes", "fixture"],
        ):
            self.assertEqual(builder.main(), 0)
        return json.loads((builder.DIST / "latest.json").read_text(encoding="utf-8"))

    def test_exact_version_installers_are_written_to_manifest(self) -> None:
        manifest = self.run_builder(with_installers=True)
        assets = manifest["assets"]
        windows = self.root / "desktop" / "release" / "Viniper.Setup.5.0.0.exe"
        macos_arm64 = self.root / "desktop" / "release" / "Viniper.5.0.0-arm64-mac.zip"
        macos_x64 = self.root / "desktop" / "release" / "Viniper.5.0.0-x64-mac.zip"
        self.assertEqual(
            assets["installer_windows"],
            {
                "name": windows.name,
                "url": f"https://github.com/owner/repo/releases/latest/download/{windows.name}",
                "size": windows.stat().st_size,
            },
        )
        self.assertEqual(
            assets["installer_macos"],
            {
                "name": macos_arm64.name,
                "url": f"https://github.com/owner/repo/releases/latest/download/{macos_arm64.name}",
                "size": macos_arm64.stat().st_size,
            },
        )
        self.assertEqual(assets["installer_macos_arm64"], assets["installer_macos"])
        self.assertEqual(
            assets["installer_macos_x64"],
            {
                "name": macos_x64.name,
                "url": f"https://github.com/owner/repo/releases/latest/download/{macos_x64.name}",
                "size": macos_x64.stat().st_size,
            },
        )

    def test_app_only_manifest_remains_valid_without_installers(self) -> None:
        manifest = self.run_builder(with_installers=False)
        self.assertEqual(set(manifest["assets"]), {"app"})

    def test_manifest_carries_non_display_release_revision(self) -> None:
        manifest = self.run_builder(with_installers=False)
        self.assertEqual(manifest["version"], "5.0.0")
        self.assertEqual(manifest["release_revision"], 1)

    def test_release_builder_fails_closed_when_required_source_is_missing(self) -> None:
        builder = load_script("v17_build_release_missing_fixture", "scripts/build_release.py")
        builder.ROOT = self.root
        builder.DIST = self.root / "dist"
        builder.BUILD = builder.DIST / "build"
        builder.APP_FILES = ["server.py", "missing-runtime.py"]
        builder.APP_DIRS = []
        with mock.patch.object(sys, "argv", ["build_release.py"]), self.assertRaises(SystemExit):
            builder.main()


class ReleaseVerifierUploadClosureTests(unittest.TestCase):
    def setUp(self) -> None:
        RESIDUE.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="v17-release-verify-", dir=RESIDUE)
        self.root = Path(self.temp.name)
        self.dist = self.root / "dist"
        self.release = self.root / "desktop" / "release"
        (self.root / "RELEASE_REVISION").write_text("1\n", encoding="utf-8")
        self.dist.mkdir(parents=True)
        self.release.mkdir(parents=True)
        self.app = self.dist / "Viniper-v5.0.0.zip"
        self.windows = self.release / "Viniper.Setup.5.0.0.exe"
        self.windows_map = self.release / "Viniper.Setup.5.0.0.exe.blockmap"
        self.macos_arm64 = self.release / "Viniper.5.0.0-arm64-mac.zip"
        self.macos_arm64_map = self.release / "Viniper.5.0.0-arm64-mac.zip.blockmap"
        self.macos_x64 = self.release / "Viniper.5.0.0-x64-mac.zip"
        self.macos_x64_map = self.release / "Viniper.5.0.0-x64-mac.zip.blockmap"
        self.app.write_bytes(b"app")
        self.windows.write_bytes(b"windows")
        self.windows_map.write_bytes(b"windows-map")
        self.macos_arm64.write_bytes(b"macos-arm64")
        self.macos_arm64_map.write_bytes(b"mac-arm64-map")
        self.macos_x64.write_bytes(b"macos-x64")
        self.macos_x64_map.write_bytes(b"mac-x64-map")
        self.manifest = {
            "name": "Viniper",
            "version": "5.0.0",
            "release_revision": 1,
            "assets": {
                "app": self.asset(self.app),
                "installer_windows": self.asset(self.windows),
                "installer_macos": self.asset(self.macos_arm64),
                "installer_macos_arm64": self.asset(self.macos_arm64),
                "installer_macos_x64": self.asset(self.macos_x64),
            },
        }
        (self.dist / "latest.json").write_text(
            json.dumps(self.manifest, ensure_ascii=False), encoding="utf-8"
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    @staticmethod
    def asset(path: Path) -> dict[str, object]:
        return {
            "name": path.name,
            "url": f"https://github.com/owner/repo/releases/latest/download/{path.name}",
            "size": path.stat().st_size,
        }

    def verifier(self):
        return load_script("v17_verify_release_fixture", "scripts/verify_release.py")

    def test_upload_set_contains_app_manifest_installers_and_blockmaps(self) -> None:
        verifier = self.verifier()
        paths = verifier.verify_release_assets(
            self.manifest,
            "5.0.0",
            root=self.root,
            dist=self.dist,
            require_windows=True,
        )
        self.assertEqual(
            set(paths),
            {
                self.app,
                self.dist / "latest.json",
                self.windows,
                self.windows_map,
                self.macos_arm64,
                self.macos_arm64_map,
                self.macos_x64,
                self.macos_x64_map,
            },
        )

    def test_release_revision_must_match_the_packaged_source(self) -> None:
        verifier = self.verifier()
        self.manifest["release_revision"] = 2
        with self.assertRaises(SystemExit):
            verifier.verify_release_assets(
                self.manifest,
                "5.0.0",
                root=self.root,
                dist=self.dist,
                require_windows=True,
            )

    def test_required_macos_arches_fail_closed_when_one_is_missing(self) -> None:
        verifier = self.verifier()
        self.macos_x64.unlink()
        with self.assertRaises(SystemExit):
            verifier.verify_release_assets(
                self.manifest,
                "5.0.0",
                root=self.root,
                dist=self.dist,
                require_windows=True,
                require_macos=True,
            )

    def test_missing_blockmap_and_manifest_mismatch_fail_closed(self) -> None:
        verifier = self.verifier()
        self.windows_map.unlink()
        with self.assertRaises(SystemExit):
            verifier.verify_release_assets(
                self.manifest,
                "5.0.0",
                root=self.root,
                dist=self.dist,
                require_windows=True,
            )
        self.windows_map.write_bytes(b"windows-map")
        self.manifest["assets"]["installer_windows"]["size"] = 1
        with self.assertRaises(SystemExit):
            verifier.verify_release_assets(
                self.manifest,
                "5.0.0",
                root=self.root,
                dist=self.dist,
                require_windows=True,
            )
        self.manifest["assets"]["installer_windows"] = {
            **self.asset(self.windows),
            "name": "Viniper.Setup.4.9.9.exe",
        }
        with self.assertRaises(SystemExit):
            verifier.verify_release_assets(
                self.manifest,
                "5.0.0",
                root=self.root,
                dist=self.dist,
                require_windows=True,
            )


class ReleaseEntryPointContractTests(unittest.TestCase):
    def test_publish_uses_verified_dynamic_upload_set(self) -> None:
        source = (ROOT / "scripts" / "publish_release.ps1").read_text(encoding="utf-8")
        self.assertIn("--print-upload-files", source)
        self.assertIn("--require-windows-installer", source)
        self.assertIn('$GhArgs = @("release", "create", "v$Version") + $UploadFiles', source)
        self.assertIn("& gh @GhArgs", source)

    def test_tag_workflow_finalizes_exact_tag_assets_and_blockmaps(self) -> None:
        source = (ROOT / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")
        self.assertIn("matrix:", source)
        self.assertIn("arch: [x64, arm64]", source)
        self.assertIn('--arch "${{ matrix.arch }}"', source)
        self.assertIn('version = os.environ["RELEASE_TAG"].removeprefix("v")', source)
        self.assertIn("workflow_dispatch:", source)
        self.assertIn("target_release_tag:", source)
        self.assertIn("build_ref:", source)
        self.assertIn("overwrite_files: true", source)
        self.assertIn('required_asset(root / f"Viniper.Setup.{version}.exe")', source)
        self.assertIn('required_asset(root / f"Viniper.Setup.{version}.exe.blockmap")', source)
        self.assertIn('required_asset(root / f"Viniper.{version}-arm64-mac.zip")', source)
        self.assertIn('required_asset(root / f"Viniper.{version}-arm64-mac.zip.blockmap")', source)
        self.assertIn('required_asset(root / f"Viniper.{version}-x64-mac.zip")', source)
        self.assertIn('required_asset(root / f"Viniper.{version}-x64-mac.zip.blockmap")', source)
        self.assertIn('assets["installer_macos_arm64"]', source)
        self.assertIn('assets["installer_macos_x64"]', source)

    def test_macos_builder_requires_an_explicit_architecture(self) -> None:
        source = (ROOT / "scripts" / "build_desktop.py").read_text(encoding="utf-8")
        self.assertIn('parser.add_argument("--arch", choices=["x64", "arm64"])', source)
        self.assertIn('"--mac", f"--{args.arch}"', source)


class FormalDesktopResourceStagingTests(unittest.TestCase):
    def setUp(self) -> None:
        RESIDUE.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="v17-formal-staging-", dir=RESIDUE)
        self.root = Path(self.temp.name)
        self.desktop = self.root / "desktop"
        self.desktop.mkdir()
        (self.root / "server.py").write_text("print('fixture')\n", encoding="utf-8")
        (self.root / "static").mkdir()
        (self.root / "static" / "app.js").write_text("// fixture\n", encoding="utf-8")
        ignored = self.root / "codex" / "运行残留"
        ignored.mkdir(parents=True)
        (ignored / "must-not-be-scanned").write_text("evidence\n", encoding="utf-8")
        package = {
            "build": {
                "productName": "Viniper",
                "appId": "com.viniper.ui.desktop",
                "extraResources": [
                    {
                        "from": "..",
                        "to": "viniper-ui",
                        "filter": ["server.py", "static/**", "!codex/**"],
                    }
                ],
            }
        }
        (self.desktop / "package.json").write_text(
            json.dumps(package, ensure_ascii=False), encoding="utf-8"
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def builder(self):
        return load_script("v17_build_desktop_fixture", "scripts/build_desktop.py")

    def test_formal_builder_uses_explicit_clean_resource_staging(self) -> None:
        builder = self.builder()
        staging = self.root / "staging" / "viniper-ui"
        config_path = builder.prepare_resource_staging(
            staging,
            root=self.root,
            desktop=self.desktop,
        )
        self.assertTrue((staging / "server.py").is_file())
        self.assertTrue((staging / "static" / "app.js").is_file())
        self.assertFalse((staging / "codex").exists())
        config = json.loads(config_path.read_text(encoding="utf-8"))
        resource = config["extraResources"][0]
        self.assertEqual(Path(resource["from"]), staging.resolve())
        self.assertEqual(resource["to"], "viniper-ui")

    def test_formal_staging_fails_closed_when_required_source_is_missing(self) -> None:
        builder = self.builder()
        (self.root / "server.py").unlink()
        with self.assertRaises(SystemExit):
            builder.prepare_resource_staging(
                self.root / "missing-staging" / "viniper-ui",
                root=self.root,
                desktop=self.desktop,
            )

    def test_formal_electron_builder_receives_the_clean_config(self) -> None:
        source = (ROOT / "scripts" / "build_desktop.py").read_text(encoding="utf-8")
        self.assertIn("prepare_resource_staging", source)
        self.assertIn('"--config", str(builder_config)', source)

    def test_formal_executable_metadata_uses_product_version(self) -> None:
        builder = self.builder()
        executable = self.desktop / "release" / "win-unpacked" / "Viniper.exe"
        executable.parent.mkdir(parents=True)
        executable.write_bytes(b"fixture")
        icon = self.root / "static" / "assets" / "viniper-icon.ico"
        icon.parent.mkdir(parents=True)
        icon.write_bytes(b"icon")
        (self.root / "VERSION").write_text("5.0.0\n", encoding="utf-8")

        with (
            mock.patch.object(builder, "DESKTOP", self.desktop),
            mock.patch.object(builder, "ROOT", self.root),
            mock.patch.object(builder.sys, "platform", "win32"),
            mock.patch.object(builder, "rcedit_tool", return_value=self.root / "rcedit.exe"),
            mock.patch.object(builder, "run") as run_mock,
        ):
            builder.patch_windows_icon()

        command = run_mock.call_args.args[0]
        self.assertEqual(command[command.index("--set-file-version") + 1], "5.0.0")
        self.assertEqual(command[command.index("--set-product-version") + 1], "5.0.0")

    def test_command_logging_survives_cp1252_with_unicode_staging_path(self) -> None:
        builder = self.builder()
        sink = io.BytesIO()
        cp1252_stdout = io.TextIOWrapper(sink, encoding="cp1252", errors="strict")
        completed = mock.Mock(stdout="", returncode=0)
        command = [
            "npm",
            "run",
            "pack",
            "--",
            "--config",
            r"D:\repo\codex\运行残留\electron-builder.formal.json",
        ]

        with (
            mock.patch.object(builder.sys, "stdout", cp1252_stdout),
            mock.patch.object(builder.subprocess, "run", return_value=completed) as run_mock,
        ):
            builder.run(command, cwd=self.root)

        cp1252_stdout.flush()
        self.assertIn("运行残留".encode("utf-8"), sink.getvalue())
        run_mock.assert_called_once()
        cp1252_stdout.detach()


if __name__ == "__main__":
    unittest.main()
