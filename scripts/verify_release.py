#!/usr/bin/env python3
"""Verify Viniper UI source and release artifacts."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


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
        if path.suffix.lower() in {".zip", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico"}:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        if pattern.search(text):
            raise SystemExit(f"secret-looking token found in {path}")


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
            "requirements.txt",
            "VERSION",
            "desktop/package.json",
            "desktop/package-lock.json",
            "desktop/main.js",
            "desktop/preload.js",
            "static/assets/viniper-husky.ico",
            "static/assets/viniper-husky.png",
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


def main() -> int:
    run([sys.executable, "-m", "py_compile", str(ROOT / "server.py")])
    run([sys.executable, str(ROOT / "scripts" / "verify_desktop.py")])
    if shutil.which("node"):
        run(["node", "--check", str(ROOT / "static" / "app.js")])
    scan_for_secrets([path for path in ROOT.rglob("*") if path.is_file() and "data" not in path.parts and "dist" not in path.parts])

    manifest_path = DIST / "latest.json"
    if not manifest_path.exists():
        raise SystemExit("dist/latest.json missing; run scripts/build_release.py first")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    asset = manifest.get("assets", {}).get("app", {})
    zip_name = asset.get("name")
    if not zip_name:
        raise SystemExit("latest.json missing assets.app.name")
    zip_path = DIST / zip_name
    if not zip_path.exists():
        raise SystemExit(f"release zip missing: {zip_path}")
    verify_zip(zip_path)
    print("Viniper UI release verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
