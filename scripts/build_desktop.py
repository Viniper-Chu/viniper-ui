#!/usr/bin/env python3
"""Build the Viniper UI desktop app for the current platform."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DESKTOP = ROOT / "desktop"


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


def prepare_macos_icon() -> None:
    if sys.platform != "darwin":
        return
    source = ROOT / "static" / "assets" / "viniper-husky.png"
    if not source.exists():
        raise SystemExit(f"missing icon source: {source}")
    build_dir = DESKTOP / "build"
    iconset = build_dir / "icon.iconset"
    iconset.mkdir(parents=True, exist_ok=True)
    sizes = [16, 32, 64, 128, 256, 512, 1024]
    for size in sizes:
        target = iconset / f"icon_{size}x{size}.png"
        run(["sips", "-z", str(size), str(size), str(source), "--out", str(target)], timeout=60)
        if size <= 512:
            retina = iconset / f"icon_{size}x{size}@2x.png"
            run(["sips", "-z", str(size * 2), str(size * 2), str(source), "--out", str(retina)], timeout=60)
    run(["iconutil", "-c", "icns", str(iconset), "-o", str(build_dir / "icon.icns")], timeout=60)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Viniper UI desktop package.")
    parser.add_argument("--target", choices=["current", "win", "mac", "dir"], default="current")
    parser.add_argument("--skip-install", action="store_true", help="Skip npm install.")
    args = parser.parse_args()

    npm = tool("npm")
    os.environ.setdefault("ELECTRON_MIRROR", "https://npmmirror.com/mirrors/electron/")
    os.environ.setdefault("ELECTRON_BUILDER_BINARIES_MIRROR", "https://npmmirror.com/mirrors/electron-builder-binaries/")

    if not args.skip_install:
        run([npm, "install"], cwd=DESKTOP, timeout=300)

    run([npm, "run", "check"], cwd=DESKTOP, timeout=60)

    if args.target == "dir":
        run([npm, "run", "pack"], cwd=DESKTOP, timeout=600)
    elif args.target == "win":
        run([npm, "run", "dist", "--", "--win", "nsis"], cwd=DESKTOP, timeout=900)
    elif args.target == "mac":
        if sys.platform != "darwin":
            raise SystemExit("macOS desktop packages must be built on macOS.")
        prepare_macos_icon()
        run([npm, "run", "dist", "--", "--mac"], cwd=DESKTOP, timeout=900)
    else:
        if sys.platform == "win32":
            run([npm, "run", "dist", "--", "--win", "nsis"], cwd=DESKTOP, timeout=900)
        elif sys.platform == "darwin":
            prepare_macos_icon()
            run([npm, "run", "dist", "--", "--mac"], cwd=DESKTOP, timeout=900)
        else:
            run([npm, "run", "pack"], cwd=DESKTOP, timeout=600)

    print(f"Desktop artifacts are in {DESKTOP / 'release'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
