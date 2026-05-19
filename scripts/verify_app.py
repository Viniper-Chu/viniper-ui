#!/usr/bin/env python3
"""Run the full Viniper UI verification suite."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run(command: list[str], cwd: Path = ROOT, timeout: int | None = None) -> None:
    completed = subprocess.run(command, cwd=str(cwd), text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
    if completed.returncode != 0:
        print(completed.stdout)
        raise SystemExit(f"command failed: {' '.join(command)}")


def get_json(url: str, timeout: float = 5.0) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def verify_local_api() -> None:
    data_dir = Path(tempfile.mkdtemp(prefix="viniper-ui-verify-"))
    env = os.environ.copy()
    env["VINIPER_UI_PORT"] = "17401"
    env["VINIPER_UI_OPEN_BROWSER"] = "0"
    env["VINIPER_UI_DATA_DIR"] = str(data_dir)
    proc = subprocess.Popen(
        [sys.executable, "server.py"],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    try:
        base = "http://127.0.0.1:17401"
        for _ in range(30):
            try:
                status = get_json(f"{base}/api/status", timeout=1.0)
                break
            except Exception:
                time.sleep(0.4)
        else:
            raise SystemExit("local API did not start")

        settings = get_json(f"{base}/api/settings")
        diagnostics = get_json(f"{base}/api/diagnostics")
        if not status.get("ok") or not settings.get("ok") or "checks" not in diagnostics:
            raise SystemExit("local API verification failed")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(data_dir, ignore_errors=True)


def main() -> int:
    run([sys.executable, "-m", "py_compile", "server.py", "scripts/build_release.py", "scripts/verify_release.py", "scripts/verify_desktop.py", "scripts/build_desktop.py", "scripts/verify_app.py"])
    if shutil.which("node"):
        run(["node", "--check", "static/app.js"])
        run(["node", "--check", "desktop/main.js"])
        run(["node", "--check", "desktop/preload.js"])
    run([sys.executable, "scripts/verify_desktop.py"])
    verify_local_api()
    print("Viniper UI full verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
