#!/usr/bin/env python3
"""Verify the Viniper UI desktop shell scaffold."""

from __future__ import annotations

import json
import shutil
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


def main() -> int:
    required = [
        DESKTOP / "package.json",
        DESKTOP / "package-lock.json",
        DESKTOP / "main.js",
        DESKTOP / "preload.js",
        DESKTOP / "README.md",
        ROOT / "static" / "assets" / "viniper-husky.ico",
        ROOT / "static" / "assets" / "viniper-husky.png",
    ]
    for path in required:
        require(path)

    package = json.loads((DESKTOP / "package.json").read_text(encoding="utf-8"))
    if package.get("build", {}).get("productName") != "Viniper UI":
        raise SystemExit("desktop package productName must be Viniper UI")
    if not package.get("build", {}).get("extraResources"):
        raise SystemExit("desktop package must bundle the local Viniper UI service as extraResources")

    main_js = (DESKTOP / "main.js").read_text(encoding="utf-8")
    if "VINIPER_UI_OPEN_BROWSER" not in main_js:
        raise SystemExit("desktop shell must disable automatic browser launch when it starts the server")
    if "requestSingleInstanceLock" not in main_js:
        raise SystemExit("desktop shell must keep a single running instance")

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
