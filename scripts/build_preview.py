#!/usr/bin/env python3
"""Build an isolated Viniper Preview app using create-only staging."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DESKTOP = ROOT / "desktop"
PROFILE_FILE = ROOT / "profiles.json"
STAGING_ROOT = ROOT / "codex" / "工作输出" / "preview-build"
PROTECTED_PATHS = {
    Path("D:/Viniper UI Preview").resolve(),
    Path("D:/Viniper UI").resolve(),
}
PROTECTED_TREE_PATHS = {
    (ROOT / "desktop" / "release-preview").resolve(),
    (ROOT / "desktop" / "release").resolve(),
}


def preview_profile() -> dict[str, object]:
    data = json.loads(PROFILE_FILE.read_text(encoding="utf-8"))
    profile = data.get("preview")
    if not isinstance(profile, dict):
        raise SystemExit("profiles.json is missing the preview profile")
    return profile


def tool(name: str) -> str:
    resolved = shutil.which(name)
    if not resolved and sys.platform == "win32":
        resolved = shutil.which(f"{name}.cmd")
    if not resolved:
        raise SystemExit(f"{name} was not found. Install Node.js first.")
    return resolved


def network_env() -> dict[str, str]:
    env = os.environ.copy()
    proxy = "http://127.0.0.1:7897"
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
        env.setdefault(key, proxy)
    env.setdefault(
        "NO_PROXY",
        "localhost,127.0.0.1,::1,10.*,172.16.*,172.17.*,172.18.*,172.19.*,172.20.*,172.21.*,172.22.*,172.23.*,172.24.*,172.25.*,172.26.*,172.27.*,172.28.*,172.29.*,172.30.*,172.31.*,192.168.*",
    )
    return env


def run(command: list[str], cwd: Path = ROOT, timeout: int | None = None) -> None:
    print(f"+ {' '.join(command)}")
    completed = subprocess.run(
        command,
        cwd=str(cwd),
        env=network_env(),
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
    configured = str(preview_profile().get("install_dir") or "").strip()
    if configured:
        return Path(configured)
    return ROOT.parent / "Viniper Preview"


def validate_cli_install_dir(raw: str) -> Path:
    expected = default_install_dir()
    candidate = Path(raw).expanduser()
    expected_key = os.path.normcase(os.path.normpath(str(expected)))
    candidate_key = os.path.normcase(os.path.normpath(str(candidate)))
    if candidate_key != expected_key:
        raise SystemExit(f"CLI promotion target must exactly match the Preview profile install_dir: {expected}")
    resolved = reject_protected(candidate, "install target")
    if resolved.exists():
        raise SystemExit(f"install target already exists; refusing to overwrite: {resolved}")
    return resolved


def reject_protected(path: Path, label: str) -> Path:
    resolved = path.expanduser().resolve()
    for protected in PROTECTED_PATHS:
        if resolved == protected:
            raise SystemExit(f"{label} is protected: {resolved}")
    for protected in PROTECTED_TREE_PATHS:
        if resolved == protected or protected in resolved.parents:
            raise SystemExit(f"{label} is protected: {resolved}")
    return resolved


def create_owned_staging(requested: str | None = None) -> tuple[Path, str]:
    root = STAGING_ROOT.resolve()
    root.mkdir(parents=True, exist_ok=True)
    run_id = requested or datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f") + f"-p{os.getpid()}"
    staging = (root / run_id).resolve()
    if staging.parent != root:
        raise SystemExit(f"staging must be a direct child of {root}")
    reject_protected(staging, "staging")
    if staging.exists():
        raise SystemExit(f"staging already exists; refusing to reuse: {staging}")
    staging.mkdir()
    ownership = {
        "run_id": run_id,
        "profile": "preview",
        "created_by": "scripts/build_preview.py",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    (staging / "OWNERSHIP.json").write_text(json.dumps(ownership, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return staging, run_id


def require_owned_staging(staging: Path) -> Path:
    staging = staging.resolve()
    if staging.parent != STAGING_ROOT.resolve():
        raise SystemExit(f"staging is outside the owned staging root: {staging}")
    marker = staging / "OWNERSHIP.json"
    if not marker.exists():
        raise SystemExit(f"missing staging ownership record: {marker}")
    return staging


def copy_preview_app(staging: Path, target: Path) -> None:
    staging = require_owned_staging(staging)
    source = staging / "release" / "win-unpacked"
    if not source.is_dir():
        raise SystemExit(f"missing preview build: {source}")
    target = reject_protected(target, "install target")
    if target.exists():
        raise SystemExit(f"install target already exists; refusing to overwrite: {target}")
    if not target.parent.exists():
        raise SystemExit(f"install target parent does not exist: {target.parent}")

    created_target = True
    try:
        shutil.copytree(source, target)
    except Exception:
        if created_target and target.exists():
            shutil.rmtree(target)
        raise


def main() -> int:
    profile = preview_profile()
    parser = argparse.ArgumentParser(description="Build a standalone Viniper Preview app.")
    parser.add_argument("--skip-install", action="store_true", help="Skip npm install.")
    parser.add_argument("--staging-id", default="", help="Use a new, direct child name under codex/工作输出/preview-build.")
    parser.add_argument(
        "--install-dir",
        default="",
        help="Optional create-only promotion target; must exactly equal profiles.json preview.install_dir.",
    )
    args = parser.parse_args()
    target = validate_cli_install_dir(args.install_dir.strip()) if args.install_dir.strip() else None

    staging, run_id = create_owned_staging(args.staging_id.strip() or None)
    release_output = staging / "release"
    npm = tool("npm")
    os.environ.setdefault("ELECTRON_MIRROR", "https://npmmirror.com/mirrors/electron/")
    os.environ.setdefault("ELECTRON_BUILDER_BINARIES_MIRROR", "https://npmmirror.com/mirrors/electron-builder-binaries/")

    if not args.skip_install:
        run([npm, "install"], cwd=DESKTOP, timeout=300)

    run([npm, "run", "check"], cwd=DESKTOP, timeout=60)
    run(
        [
            npm,
            "run",
            "pack",
            "--",
            f"--config.directories.output={release_output}",
            f"--config.productName={profile['product_name']}",
            f"--config.appId={profile['app_id']}",
            "--config.extraMetadata.viniperProfile=preview",
            "--config.win.artifactName=Viniper.Preview.${version}.${ext}",
        ],
        cwd=DESKTOP,
        timeout=600,
    )

    if target is not None:
        copy_preview_app(staging, target)
        print(f"Created isolated preview app at {target}")

    print(f"Preview staging ({run_id}) is in {staging}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
