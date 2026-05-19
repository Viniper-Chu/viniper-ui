#!/usr/bin/env python3
"""Build a clean Viniper UI release zip and GitHub update manifest."""

from __future__ import annotations

import argparse
import hashlib
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
    "requirements.txt",
    "VERSION",
    "README.md",
    "LICENSE",
    "start.bat",
    "update_source.example.json",
]
APP_DIRS = [
    "static",
    "scripts",
    "desktop",
]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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
    parser = argparse.ArgumentParser(description="Build Viniper UI release artifacts.")
    parser.add_argument("--version", help="Version to write into VERSION. Defaults to existing VERSION file.")
    parser.add_argument("--repo", default="", help="GitHub repository, for example owner/viniper-ui.")
    parser.add_argument("--notes", default="Viniper UI release.", help="Release notes for latest.json.")
    args = parser.parse_args()

    version = (args.version or (ROOT / "VERSION").read_text(encoding="utf-8").strip()).strip()
    if not version:
        raise SystemExit("version is required")

    write_text(ROOT / "VERSION", f"{version}\n")
    DIST.mkdir(exist_ok=True)
    if BUILD.exists():
        shutil.rmtree(BUILD)
    BUILD.mkdir(parents=True)

    app_root = BUILD / f"ViniperUI-v{version}" / "viniper-ui"
    app_root.mkdir(parents=True)

    for item in APP_FILES:
        source = ROOT / item
        if source.exists():
            shutil.copy2(source, app_root / item)
    for item in APP_DIRS:
        source = ROOT / item
        if source.exists():
            copy_clean_tree(source, app_root / item)

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
    zip_path = DIST / f"ViniperUI-v{version}.zip"
    make_zip(app_root.parent, zip_path)
    digest = sha256_file(zip_path)

    asset_url = f"https://github.com/{args.repo}/releases/latest/download/{zip_path.name}" if args.repo else zip_path.name
    manifest = {
        "name": "Viniper UI",
        "version": version,
        "published_at": datetime.now(timezone.utc).isoformat(),
        "notes": args.notes,
        "assets": {
            "app": {
                "name": zip_path.name,
                "url": asset_url,
                "sha256": digest,
                "size": zip_path.stat().st_size,
            }
        },
    }
    write_text(DIST / "latest.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    write_text(DIST / f"{zip_path.name}.sha256", f"{digest}  {zip_path.name}\n")

    print(f"Built {zip_path}")
    print(f"Built {DIST / 'latest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
