#!/usr/bin/env python3
"""Build a clean Viniper release zip and GitHub update manifest."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
BUILD = DIST / "build"

APP_FILES = [
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
    "profiles.json",
    "requirements.txt",
    "VERSION",
    "RELEASE_REVISION",
    "README.md",
    "LICENSE",
    "start.bat",
    "skills-lock.json",
    "update_source.example.json",
]
APP_DIRS = [
    ".agents",
    "static",
    "scripts",
    "desktop",
]


def release_asset_url(repo: str, name: str) -> str:
    if repo:
        return f"https://github.com/{repo}/releases/latest/download/{name}"
    return name


def installer_manifest_assets(root: Path, version: str, repo: str) -> dict[str, dict[str, object]]:
    release_dir = root / "desktop" / "release"
    candidates = {
        "installer_windows": release_dir / f"Viniper.Setup.{version}.exe",
        "installer_macos_arm64": release_dir / f"Viniper.{version}-arm64-mac.zip",
        "installer_macos_x64": release_dir / f"Viniper.{version}-x64-mac.zip",
    }
    assets: dict[str, dict[str, object]] = {}
    for key, path in candidates.items():
        if path.is_file():
            assets[key] = {
                "name": path.name,
                "url": release_asset_url(repo, path.name),
                "size": path.stat().st_size,
            }
    default_macos = assets.get("installer_macos_arm64") or assets.get("installer_macos_x64")
    if default_macos:
        assets["installer_macos"] = dict(default_macos)
    return assets


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")


def copy_clean_tree(source: Path, target: Path) -> None:
    def ignore(_dir: str, names: list[str]) -> set[str]:
        ignored = {
            "__pycache__",
            ".venv",
            "venv",
            ".git",
            "data",
            "tmp",
            "dist",
            "node_modules",
            "release",
            "release-preview",
        }
        return {name for name in names if name in ignored or name.endswith(".pyc")}

    shutil.copytree(source, target, ignore=ignore, dirs_exist_ok=True)


def make_zip(source_dir: Path, zip_path: Path) -> None:
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source_dir.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(source_dir.parent))


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Viniper release artifacts.")
    parser.add_argument("--version", help="Version to write into VERSION. Defaults to existing VERSION file.")
    parser.add_argument("--repo", default="", help="GitHub repository, for example owner/viniper-ui.")
    parser.add_argument("--notes", default="Viniper release.", help="Release notes for latest.json.")
    args = parser.parse_args()

    version = (args.version or (ROOT / "VERSION").read_text(encoding="utf-8").strip()).strip()
    if not version:
        raise SystemExit("version is required")
    try:
        release_revision = int((ROOT / "RELEASE_REVISION").read_text(encoding="utf-8").strip())
    except (OSError, ValueError) as exc:
        raise SystemExit("RELEASE_REVISION must be a positive integer") from exc
    if release_revision <= 0:
        raise SystemExit("RELEASE_REVISION must be a positive integer")

    write_text(ROOT / "VERSION", f"{version}\n")
    DIST.mkdir(exist_ok=True)
    if BUILD.exists():
        shutil.rmtree(BUILD)
    BUILD.mkdir(parents=True)

    app_root = BUILD / f"Viniper-v{version}" / "viniper-ui"
    app_root.mkdir(parents=True)

    for item in APP_FILES:
        source = ROOT / item
        try:
            is_file = source.is_file()
        except OSError as exc:
            raise SystemExit(f"required release file is inaccessible: {source}: {exc}") from exc
        if not is_file:
            raise SystemExit(f"required release file missing: {source}")
        try:
            target = app_root / item
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        except OSError as exc:
            raise SystemExit(f"required release file could not be copied: {source}: {exc}") from exc
    for item in APP_DIRS:
        source = ROOT / item
        try:
            is_directory = source.is_dir()
        except OSError as exc:
            raise SystemExit(f"required release directory is inaccessible: {source}: {exc}") from exc
        if not is_directory:
            raise SystemExit(f"required release directory missing: {source}")
        try:
            copy_clean_tree(source, app_root / item)
        except OSError as exc:
            raise SystemExit(f"required release directory could not be copied: {source}: {exc}") from exc

    if args.repo:
        manifest_url = f"https://github.com/{args.repo}/releases/latest/download/latest.json"
        write_text(
            app_root / "update_source.json",
            json.dumps(
                {
                    "repository": args.repo,
                    "manifest_url": manifest_url,
                    "channel": "stable",
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
        )

    # Runtime data is created on first launch; release artifacts intentionally include none.
    zip_path = DIST / f"Viniper-v{version}.zip"
    make_zip(app_root.parent, zip_path)

    asset_url = release_asset_url(args.repo, zip_path.name)
    assets: dict[str, dict[str, object]] = {
        "app": {
            "name": zip_path.name,
            "url": asset_url,
            "size": zip_path.stat().st_size,
        }
    }
    assets.update(installer_manifest_assets(ROOT, version, args.repo))
    manifest = {
        "name": "Viniper",
        "version": version,
        "release_revision": release_revision,
        "published_at": datetime.now(timezone.utc).isoformat(),
        "notes": args.notes,
        "assets": assets,
    }
    write_text(DIST / "latest.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")

    print(f"Built {zip_path}")
    print(f"Built {DIST / 'latest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
