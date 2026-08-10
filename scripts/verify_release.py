#!/usr/bin/env python3
"""Verify Viniper source and release artifacts."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"


def run(command: list[str], cwd: Path = ROOT) -> None:
    completed = subprocess.run(command, cwd=str(cwd), text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if completed.returncode != 0:
        print(completed.stdout)
        raise SystemExit(f"command failed: {' '.join(command)}")


def scan_for_secrets(paths: list[Path]) -> None:
    pattern = re.compile(r"sk-[A-Za-z0-9]{12,}")
    for path in paths:
        if "release" in path.parts and "desktop" in path.parts:
            continue
        if path.suffix.lower() in {".zip", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".exe", ".dll", ".pak", ".bin", ".dat", ".blockmap"}:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        if pattern.search(text):
            raise SystemExit(f"secret-looking token found in {path}")


def release_source_files(root: Path = ROOT) -> list[Path]:
    """Enumerate publishable source inputs without traversing local evidence."""
    skipped_names = {
        ".git", ".omx", ".venv", "__pycache__", "codex", "data", "dist",
        "node_modules", "tmp",
    }
    skipped_relative = {"desktop/release", "desktop/release-preview"}
    result: list[Path] = []

    def fail_walk(error: OSError) -> None:
        raise SystemExit(f"release source tree is inaccessible: {error}")

    for current, directories, filenames in os.walk(root, topdown=True, onerror=fail_walk):
        current_path = Path(current)
        try:
            relative = current_path.relative_to(root).as_posix()
        except ValueError:
            raise SystemExit(f"release source escaped root: {current_path}")
        kept: list[str] = []
        for name in directories:
            child_relative = f"{relative}/{name}".lstrip("./")
            if name in skipped_names or child_relative in skipped_relative:
                continue
            kept.append(name)
        directories[:] = kept
        for filename in filenames:
            path = current_path / filename
            try:
                is_file = path.is_file()
            except OSError as exc:
                raise SystemExit(f"release source is inaccessible: {path}: {exc}") from exc
            if not is_file:
                raise SystemExit(f"release source entry disappeared or is not a file: {path}")
            result.append(path)
    return result


def verify_zip(zip_path: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="viniper-ui-release-check-") as tmp:
        target = Path(tmp)
        with zipfile.ZipFile(zip_path) as archive:
            for item in archive.infolist():
                destination = (target / item.filename).resolve()
                if not str(destination).startswith(str(target.resolve())):
                    raise SystemExit(f"unsafe zip entry: {item.filename}")
            archive.extractall(target)
        app_roots = [path for path in target.rglob("viniper-ui") if (path / "server.py").exists()]
        if not app_roots:
            raise SystemExit("release zip does not contain viniper-ui/server.py")
        app = app_roots[0]
        required = [
            "server.py",
            "context_lifecycle.py",
            "context_usage.py",
            "daily_usage.py",
            "skill_sync.py",
            "agent_instructions.py",
            "agent_runtime.py",
            "agent_host_bridge.py",
            "agent_queue.py",
            "agent_run_coordinator.py",
            "native_peer.py",
            "wsl_runtime.py",
            "requirements.txt",
            "VERSION",
            "desktop/package.json",
            "desktop/package-lock.json",
            "desktop/main.js",
            "desktop/preload.js",
            "static/assets/viniper-icon.ico",
            "static/assets/viniper-icon.png",
            "static/index.html",
            "static/app.js",
            "static/style.css",
        ]
        for item in required:
            if not (app / item).exists():
                raise SystemExit(f"release zip missing {item}")
        forbidden = ["data", "__pycache__", ".venv", "tmp"]
        for name in forbidden:
            if list(app.rglob(name)):
                raise SystemExit(f"release zip includes forbidden runtime path {name}")
        scan_for_secrets([path for path in app.rglob("*") if path.is_file()])


def asset_url_matches_name(value: object, name: str) -> bool:
    url = str(value or "").strip()
    if url == name:
        return True
    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and Path(unquote(parsed.path)).name == name


def require_manifest_asset(assets: dict[str, object], key: str, path: Path) -> None:
    item = assets.get(key)
    if not isinstance(item, dict):
        raise SystemExit(f"latest.json missing assets.{key}")
    if item.get("name") != path.name:
        raise SystemExit(f"latest.json assets.{key}.name mismatch")
    if int(item.get("size") or 0) != path.stat().st_size:
        raise SystemExit(f"latest.json assets.{key}.size mismatch")
    if not asset_url_matches_name(item.get("url"), path.name):
        raise SystemExit(f"latest.json assets.{key}.url mismatch")


def verify_release_assets(
    manifest: dict[str, object],
    version: str,
    *,
    root: Path = ROOT,
    dist: Path = DIST,
    require_windows: bool = False,
    require_macos: bool = False,
) -> list[Path]:
    if manifest.get("version") != version:
        raise SystemExit("latest.json version does not match VERSION")
    assets = manifest.get("assets")
    if not isinstance(assets, dict):
        raise SystemExit("latest.json assets must be an object")

    manifest_path = dist / "latest.json"
    if not manifest_path.is_file():
        raise SystemExit("dist/latest.json missing")
    app_path = dist / f"Viniper-v{version}.zip"
    if not app_path.is_file():
        raise SystemExit(f"release zip missing: {app_path}")
    require_manifest_asset(assets, "app", app_path)
    upload_files = [app_path, manifest_path]

    release_dir = root / "desktop" / "release"
    installers = {
        "installer_windows": release_dir / f"Viniper.Setup.{version}.exe",
        "installer_macos_arm64": release_dir / f"Viniper.{version}-arm64-mac.zip",
        "installer_macos_x64": release_dir / f"Viniper.{version}-x64-mac.zip",
    }
    if require_windows and not installers["installer_windows"].is_file():
        raise SystemExit(f"required Windows installer missing: {installers['installer_windows']}")
    if require_macos:
        for key in ("installer_macos_arm64", "installer_macos_x64"):
            if not installers[key].is_file():
                raise SystemExit(f"required macOS installer missing: {installers[key]}")

    for key, installer in installers.items():
        declared = key in assets
        if not installer.is_file():
            if declared:
                raise SystemExit(f"latest.json declares missing {key}: {installer}")
            continue
        require_manifest_asset(assets, key, installer)
        blockmap = installer.with_name(installer.name + ".blockmap")
        if not blockmap.is_file() or blockmap.stat().st_size <= 0:
            raise SystemExit(f"required blockmap missing or empty: {blockmap}")
        upload_files.extend([installer, blockmap])
    default_macos = (
        installers["installer_macos_arm64"]
        if installers["installer_macos_arm64"].is_file()
        else installers["installer_macos_x64"]
    )
    if "installer_macos" in assets:
        if not default_macos.is_file():
            raise SystemExit("latest.json declares installer_macos without a macOS installer")
        require_manifest_asset(assets, "installer_macos", default_macos)
    return upload_files


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify Viniper release artifacts.")
    parser.add_argument("--print-upload-files", action="store_true")
    parser.add_argument("--require-windows-installer", action="store_true")
    parser.add_argument("--require-macos-installers", action="store_true")
    args = parser.parse_args()
    run([sys.executable, "-m", "py_compile", str(ROOT / "server.py")])
    run([sys.executable, str(ROOT / "scripts" / "verify_desktop.py")])
    if shutil.which("node"):
        run(["node", "--check", str(ROOT / "static" / "app.js")])
    scan_for_secrets(release_source_files())

    manifest_path = DIST / "latest.json"
    if not manifest_path.exists():
        raise SystemExit("dist/latest.json missing; run scripts/build_release.py first")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    upload_files = verify_release_assets(
        manifest,
        version,
        require_windows=args.require_windows_installer,
        require_macos=args.require_macos_installers,
    )
    verify_zip(DIST / f"Viniper-v{version}.zip")
    if args.print_upload_files:
        for path in upload_files:
            print(path.relative_to(ROOT).as_posix())
    else:
        print("Viniper release verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
