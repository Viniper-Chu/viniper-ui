#!/usr/bin/env python3
"""Build an isolated Viniper UI preview desktop app."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DESKTOP = ROOT / "desktop"
PREVIEW_MARKER = ROOT / "PREVIEW"
PREVIEW_RELEASE = DESKTOP / "release-preview"


def tool(name: str) -> str:
    resolved = shutil.which(name)
    if not resolved and sys.platform == "win32":
        resolved = shutil.which(f"{name}.cmd")
    if not resolved:
        raise SystemExit(f"{name} was not found. Install Node.js first.")
    return resolved


def run(command: list[str], cwd: Path = ROOT, timeout: int | None = None) -> None:
    print(f"+ {' '.join(command)}")
    completed = subprocess.run(
        command,
        cwd=str(cwd),
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=timeout,
    )
    if completed.stdout:
        sys.stdout.buffer.write(completed.stdout.encode("utf-8", errors="replace"))
        if not completed.stdout.endswith("\n"):
            sys.stdout.buffer.write(b"\n")
    if completed.returncode != 0:
        raise SystemExit(f"command failed: {' '.join(command)}")


def default_install_dir() -> Path:
    if ROOT.drive:
        return Path(f"{ROOT.drive}\\Viniper UI Preview")
    return ROOT.parent / "Viniper UI Preview"


def copy_preview_app(target: Path) -> None:
    source = PREVIEW_RELEASE / "win-unpacked"
    if not source.exists():
        raise SystemExit(f"missing preview build: {source}")
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(source, target)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a standalone Viniper UI preview app.")
    parser.add_argument("--skip-install", action="store_true", help="Skip npm install.")
    parser.add_argument(
        "--install-dir",
        default=str(default_install_dir()) if sys.platform == "win32" else "",
        help="Optional directory to copy the standalone preview app into.",
    )
    args = parser.parse_args()

    npm = tool("npm")
    os.environ.setdefault("ELECTRON_MIRROR", "https://npmmirror.com/mirrors/electron/")
    os.environ.setdefault("ELECTRON_BUILDER_BINARIES_MIRROR", "https://npmmirror.com/mirrors/electron-builder-binaries/")

    if not args.skip_install:
        run([npm, "install"], cwd=DESKTOP, timeout=300)

    if PREVIEW_RELEASE.exists():
        shutil.rmtree(PREVIEW_RELEASE)

    PREVIEW_MARKER.write_text("Viniper UI preview build\n", encoding="utf-8")
    try:
        run([npm, "run", "check"], cwd=DESKTOP, timeout=60)
        run(
            [
                npm,
                "run",
                "pack",
                "--",
                "--config.directories.output=release-preview",
                "--config.productName=Viniper UI Preview",
                "--config.appId=com.viniper.ui.desktop.preview",
                "--config.win.artifactName=Viniper.UI.Preview.${version}.${ext}",
            ],
            cwd=DESKTOP,
            timeout=600,
        )
    finally:
        try:
            PREVIEW_MARKER.unlink()
        except FileNotFoundError:
            pass

    if args.install_dir:
        target = Path(args.install_dir)
        copy_preview_app(target)
        print(f"Copied standalone preview app to {target}")

    print(f"Preview build is in {PREVIEW_RELEASE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
