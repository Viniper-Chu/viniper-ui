#!/usr/bin/env python3
"""Run the full Viniper verification suite."""

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
CLAUDE_REQUIRED_OPTIONS = [
    "-p",
    "--output-format",
    "--include-partial-messages",
    "--model",
    "--session-id",
    "--resume",
    "--permission-mode",
    "--fallback-model",
    "--name",
    "--append-system-prompt",
    "--add-dir",
    "--verbose",
]
CLAUDE_REQUIRED_PERMISSION_MODES = [
    "default",
    "acceptEdits",
    "auto",
    "bypassPermissions",
    "dontAsk",
    "plan",
]


def run(command: list[str], cwd: Path = ROOT, timeout: int | None = None) -> None:
    completed = subprocess.run(command, cwd=str(cwd), text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
    if completed.returncode != 0:
        print(completed.stdout)
        raise SystemExit(f"command failed: {' '.join(command)}")


def get_json(url: str, timeout: float = 5.0) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def verify_local_api() -> None:
    residue_root = ROOT / "codex" / "运行残留"
    residue_root.mkdir(parents=True, exist_ok=True)
    data_dir = Path(tempfile.mkdtemp(prefix="viniper-ui-verify-", dir=residue_root))
    env = os.environ.copy()
    # The verification server is disposable and must never refresh the formal
    # desktop/Start Menu shortcuts or use the formal product data profile.
    env["VINIPER_UI_PREVIEW"] = "1"
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
        diagnostics = get_json(f"{base}/api/diagnostics", timeout=20.0)
        if not status.get("ok") or not settings.get("ok") or "checks" not in diagnostics:
            raise SystemExit("local API verification failed")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(data_dir, ignore_errors=True)


def verify_claude_cli_if_available() -> None:
    claude = shutil.which("claude")
    if not claude:
        return
    completed = subprocess.run(
        [claude, "--help"],
        cwd=str(ROOT),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=20,
    )
    if completed.returncode != 0:
        raise SystemExit("claude --help failed")
    help_text = completed.stdout or ""
    missing = [item for item in CLAUDE_REQUIRED_OPTIONS if item not in help_text]
    missing_modes = [item for item in CLAUDE_REQUIRED_PERMISSION_MODES if item not in help_text]
    if missing or missing_modes:
        detail = []
        if missing:
            detail.append(f"missing options: {', '.join(missing)}")
        if missing_modes:
            detail.append(f"missing permission modes: {', '.join(missing_modes)}")
        raise SystemExit("Claude Code CLI compatibility check failed: " + "; ".join(detail))


def verify_thin_shell_behavior() -> None:
    server_py = (ROOT / "server.py").read_text(encoding="utf-8")
    app_js = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
    index_html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")

    if "expand_skill_prompt(prompt)" in server_py:
        raise SystemExit("slash commands must pass through to the configured agent shell")
    if "/api/goals" in server_py or "goal-modal" in index_html or "goal-panel" in index_html:
        raise SystemExit("Viniper goal mode must stay removed; /goal should pass through to Claude Code")
    if 'command: "/goal"' not in app_js:
        raise SystemExit("slash suggestions must include Claude Code native /goal")


def main() -> int:
    run([sys.executable, "-m", "py_compile", "server.py", "scripts/build_release.py", "scripts/verify_release.py", "scripts/verify_desktop.py", "scripts/build_desktop.py", "scripts/verify_app.py", "scripts/verify_slash_suggestions.py", "scripts/verify_provider_routing.py"])
    if shutil.which("node"):
        run(["node", "--check", "static/app.js"])
        run(["node", "--check", "desktop/main.js"])
        run(["node", "--check", "desktop/preload.js"])
    verify_thin_shell_behavior()
    run([sys.executable, "scripts/verify_slash_suggestions.py"])
    run([sys.executable, "scripts/verify_provider_routing.py"])
    run([sys.executable, "scripts/verify_desktop.py"])
    verify_claude_cli_if_available()
    verify_local_api()
    print("Viniper full verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
