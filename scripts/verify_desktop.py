#!/usr/bin/env python3
"""Verify the Viniper UI desktop shell scaffold."""

from __future__ import annotations

import json
import shutil
import struct
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DESKTOP = ROOT / "desktop"


def run(command: list[str], cwd: Path = ROOT) -> None:
    completed = subprocess.run(command, cwd=str(cwd), text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if completed.returncode != 0:
        print(completed.stdout)
        raise SystemExit(f"command failed: {' '.join(command)}")


def require(path: Path) -> None:
    if not path.exists():
        raise SystemExit(f"missing required desktop file: {path.relative_to(ROOT)}")


def verify_windows_icon(path: Path) -> None:
    data = path.read_bytes()
    if len(data) < 6:
        raise SystemExit("windows icon file is too small")
    reserved, icon_type, count = struct.unpack_from("<HHH", data, 0)
    if reserved != 0 or icon_type != 1:
        raise SystemExit("windows icon file has an invalid ICO header")
    if count < 5:
        raise SystemExit("windows icon must include multiple sizes for shortcut and taskbar rendering")
    sizes: set[int] = set()
    offset = 6
    for _ in range(count):
        if offset + 16 > len(data):
            raise SystemExit("windows icon directory is truncated")
        width = data[offset] or 256
        height = data[offset + 1] or 256
        sizes.add(min(width, height))
        offset += 16
    required_sizes = {16, 32, 48, 64, 256}
    if not required_sizes.issubset(sizes):
        raise SystemExit(f"windows icon missing sizes: {sorted(required_sizes - sizes)}")


def main() -> int:
    required = [
        DESKTOP / "package.json",
        DESKTOP / "package-lock.json",
        DESKTOP / "main.js",
        DESKTOP / "preload.js",
        DESKTOP / "README.md",
        ROOT / "static" / "assets" / "viniper-icon.ico",
        ROOT / "static" / "assets" / "viniper-icon.png",
    ]
    for path in required:
        require(path)
    verify_windows_icon(ROOT / "static" / "assets" / "viniper-icon.ico")

    package = json.loads((DESKTOP / "package.json").read_text(encoding="utf-8"))
    root_version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    if package.get("version") != root_version:
        raise SystemExit("desktop package version must match VERSION")
    if package.get("build", {}).get("productName") != "Viniper UI":
        raise SystemExit("desktop package productName must be Viniper UI")
    if package.get("build", {}).get("appId") != "com.viniper.ui.desktop":
        raise SystemExit("desktop package appId must match the taskbar AppUserModelID")
    if not package.get("build", {}).get("extraResources"):
        raise SystemExit("desktop package must bundle the local Viniper UI service as extraResources")

    main_js = (DESKTOP / "main.js").read_text(encoding="utf-8")
    if "VINIPER_UI_OPEN_BROWSER" not in main_js:
        raise SystemExit("desktop shell must disable automatic browser launch when it starts the server")
    if "requestSingleInstanceLock" not in main_js:
        raise SystemExit("desktop shell must keep a single running instance")
    if "runDiagnosticsDialog" not in main_js:
        raise SystemExit("desktop shell must expose a self-check action")

    server_py = (ROOT / "server.py").read_text(encoding="utf-8")
    if "VINIPER_UI_OPEN_BROWSER" not in server_py:
        raise SystemExit("server.py must support disabling browser auto-open")

    if shutil.which("node"):
        run(["node", "--check", str(DESKTOP / "main.js")])
        run(["node", "--check", str(DESKTOP / "preload.js")])

    print("Viniper UI desktop scaffold verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
