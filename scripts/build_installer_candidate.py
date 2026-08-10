#!/usr/bin/env python3
"""Build a create-only Viniper Preview NSIS candidate under codex/工作输出."""

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
OUTPUT_ROOT = ROOT / "codex" / "工作输出" / "installer-candidate"
RESOURCE_STAGING_ROOT = ROOT / "codex" / "运行残留" / "installer-resource-staging"
OPTIONAL_RESOURCE_FILES = {"PREVIEW"}
FORBIDDEN_OUTPUTS = {
    (DESKTOP / "release").resolve(),
    (DESKTOP / "release-preview").resolve(),
    Path("D:/Viniper UI").resolve(),
    Path("D:/Viniper UI Preview").resolve(),
    Path("D:/Viniper Preview").resolve(),
}


def preview_profile() -> dict[str, object]:
    data = json.loads(PROFILE_FILE.read_text(encoding="utf-8"))
    profile = data.get("preview")
    if not isinstance(profile, dict):
        raise SystemExit("profiles.json is missing the preview profile")
    return profile


def network_env() -> dict[str, str]:
    env = os.environ.copy()
    proxy = "http://127.0.0.1:7897"
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
        env.setdefault(key, proxy)
    env.setdefault(
        "NO_PROXY",
        "localhost,127.0.0.1,::1,10.*,172.16.*,172.17.*,172.18.*,172.19.*,172.20.*,172.21.*,172.22.*,172.23.*,172.24.*,172.25.*,172.26.*,172.27.*,172.28.*,172.29.*,172.30.*,172.31.*,192.168.*",
    )
    env.setdefault("ELECTRON_MIRROR", "https://npmmirror.com/mirrors/electron/")
    env.setdefault("ELECTRON_BUILDER_BINARIES_MIRROR", "https://npmmirror.com/mirrors/electron-builder-binaries/")
    return env


def tool(name: str) -> str:
    resolved = shutil.which(name)
    if not resolved and sys.platform == "win32":
        resolved = shutil.which(f"{name}.cmd")
    if not resolved:
        raise SystemExit(f"{name} was not found")
    return resolved


def rcedit_tool() -> Path:
    candidates = [
        DESKTOP / "node_modules" / "rcedit" / "bin" / "rcedit-x64.exe",
        DESKTOP / "node_modules" / "rcedit" / "bin" / "rcedit.exe",
        DESKTOP / "node_modules" / "electron-winstaller" / "vendor" / "rcedit.exe",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    found = shutil.which("rcedit")
    if found:
        return Path(found)
    raise SystemExit("rcedit was not found. Reuse the installed desktop dependencies.")


def create_output(requested: str = "") -> tuple[Path, str]:
    root = OUTPUT_ROOT.resolve()
    root.mkdir(parents=True, exist_ok=True)
    run_id = requested or datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f") + f"-p{os.getpid()}"
    output = (root / run_id).resolve()
    if output.parent != root or output in FORBIDDEN_OUTPUTS:
        raise SystemExit(f"candidate output must be a direct child of {root}")
    if output.exists():
        raise SystemExit(f"candidate output already exists; refusing to reuse: {output}")
    output.mkdir()
    ownership = {
        "run_id": run_id,
        "profile": "preview",
        "created_by": "scripts/build_installer_candidate.py",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "promotion": False,
    }
    (output / "OWNERSHIP.json").write_text(
        json.dumps(ownership, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return output, run_id


def prepare_resource_staging(staging: Path, profile: dict[str, object]) -> Path:
    """Create an explicit clean extraResources tree for electron-builder."""
    staging = staging.resolve()
    if staging.exists():
        raise SystemExit(f"resource staging already exists; refusing to reuse: {staging}")
    staging.parent.mkdir(parents=True, exist_ok=True)
    staging.mkdir()

    package = json.loads((DESKTOP / "package.json").read_text(encoding="utf-8"))
    build = package.get("build")
    if not isinstance(build, dict):
        raise SystemExit("desktop/package.json is missing build configuration")
    resources = build.get("extraResources")
    if not isinstance(resources, list):
        raise SystemExit("desktop/package.json is missing extraResources")
    resource = next(
        (item for item in resources if isinstance(item, dict) and item.get("to") == "viniper-ui"),
        None,
    )
    if not isinstance(resource, dict) or not isinstance(resource.get("filter"), list):
        raise SystemExit("desktop/package.json is missing the viniper-ui resource filter")

    filters = [str(item) for item in resource["filter"]]
    for pattern in filters:
        if pattern.startswith("!"):
            continue
        if pattern.endswith("/**"):
            relative = pattern[:-3]
            source = ROOT / relative
            if not source.is_dir():
                raise SystemExit(f"required resource directory missing: {source}")
            shutil.copytree(
                source,
                staging / relative,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "node_modules", "release", "release-preview"),
            )
            continue
        if "*" in pattern or "?" in pattern:
            raise SystemExit(f"unsupported positive resource glob: {pattern}")
        source = ROOT / pattern
        if not source.is_file():
            if pattern in OPTIONAL_RESOURCE_FILES:
                continue
            raise SystemExit(f"required resource file missing: {source}")
        target = staging / pattern
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)

    config = json.loads(json.dumps(build))
    config["productName"] = str(profile["product_name"])
    config["appId"] = str(profile["app_id"])
    config["extraMetadata"] = {
        **(config.get("extraMetadata") if isinstance(config.get("extraMetadata"), dict) else {}),
        "viniperProfile": "preview",
    }
    config["extraResources"] = [{"from": str(staging), "to": "viniper-ui", "filter": filters}]
    config.setdefault("win", {})["artifactName"] = "Viniper.Preview.Setup.${version}.${ext}"
    config.setdefault("nsis", {})["shortcutName"] = str(profile["product_name"])
    config_path = staging / "electron-builder.preview.json"
    config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return config_path


def run(command: list[str], *, cwd: Path, timeout: int) -> None:
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
        raise SystemExit(f"command failed with exit code {completed.returncode}: {command[0]}")


def patch_preview_executable(output: Path, profile: dict[str, object]) -> dict[str, str]:
    product_name = str(profile["product_name"])
    executable = output / "win-unpacked" / f"{product_name}.exe"
    icon = ROOT / "static" / "assets" / "viniper-icon.ico"
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    if not executable.is_file():
        raise SystemExit(f"missing unpacked Preview executable: {executable}")
    if not icon.is_file():
        raise SystemExit(f"missing original Viniper icon: {icon}")
    run(
        [
            str(rcedit_tool()),
            str(executable),
            "--set-icon",
            str(icon),
            "--set-version-string",
            "ProductName",
            product_name,
            "--set-version-string",
            "FileDescription",
            product_name,
            "--set-version-string",
            "InternalName",
            product_name,
            "--set-version-string",
            "OriginalFilename",
            executable.name,
            "--set-file-version",
            version,
            "--set-product-version",
            version,
        ],
        cwd=ROOT,
        timeout=60,
    )
    return {
        "product_name": product_name,
        "file_description": product_name,
        "original_filename": executable.name,
        "icon": str(icon.relative_to(ROOT)),
    }


def verify_candidate(output: Path) -> dict[str, object]:
    installers = sorted(output.glob("Viniper.Preview.Setup.*.exe"))
    unpacked = output / "win-unpacked"
    resources = unpacked / "resources" / "viniper-ui"
    required = [
        resources / "server.py",
        resources / "context_lifecycle.py",
        resources / "agent_runtime.py",
        resources / "agent_host_bridge.py",
        resources / "agent_queue.py",
        resources / "agent_run_coordinator.py",
        resources / "wsl_runtime.py",
        resources / "agent_instructions.py",
        resources / "context_usage.py",
        resources / "daily_usage.py",
        resources / "skill_sync.py",
        resources / "native_peer.py",
        resources / "profiles.json",
        resources / "requirements.txt",
        resources / "VERSION",
        resources / "RELEASE_REVISION",
        resources / "static" / "assets" / "viniper-icon.ico",
    ]
    missing = [str(path.relative_to(output)) for path in required if not path.is_file()]
    if len(installers) != 1 or not unpacked.is_dir() or missing:
        raise SystemExit(
            "installer candidate is incomplete: "
            + json.dumps({"installers": [item.name for item in installers], "missing": missing}, ensure_ascii=False)
        )
    installer = installers[0]
    return {
        "ok": True,
        "profile": "preview",
        "installer": {"name": installer.name, "size": installer.stat().st_size},
        "unpacked": str(unpacked),
        "required_resources": [str(path.relative_to(output)) for path in required],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build an isolated Viniper Preview Windows installer candidate.")
    parser.add_argument("--skip-install", action="store_true", help="Reuse the existing desktop node_modules.")
    parser.add_argument("--staging-id", default="", help="Create this new direct child under the candidate output root.")
    args = parser.parse_args()
    profile = preview_profile()
    output, run_id = create_output(args.staging_id.strip())
    staging = (RESOURCE_STAGING_ROOT.resolve() / run_id).resolve()
    if staging.parent != RESOURCE_STAGING_ROOT.resolve():
        raise SystemExit("resource staging must be a direct child of the staging root")
    builder_config = prepare_resource_staging(staging, profile)
    npm = tool("npm")
    if not args.skip_install:
        run([npm, "install"], cwd=DESKTOP, timeout=300)
    run([npm, "run", "check"], cwd=DESKTOP, timeout=90)
    common_config = [
        "--config",
        str(builder_config),
        f"--config.directories.output={output}",
    ]
    run(
        [
            npm,
            "run",
            "pack",
            "--",
            *common_config,
        ],
        cwd=DESKTOP,
        timeout=1200,
    )
    executable_brand = patch_preview_executable(output, profile)
    run(
        [
            npm,
            "run",
            "dist",
            "--",
            "--win",
            "nsis",
            "--prepackaged",
            str(output / "win-unpacked"),
            *common_config,
        ],
        cwd=DESKTOP,
        timeout=1200,
    )
    manifest = verify_candidate(output)
    manifest["run_id"] = run_id
    manifest["executable_brand"] = executable_brand
    (output / "CANDIDATE.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(manifest, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
