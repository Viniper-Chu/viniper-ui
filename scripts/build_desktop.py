#!/usr/bin/env python3
"""Build the Viniper UI desktop app for the current platform."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DESKTOP = ROOT / "desktop"
KEEP_RELEASE_VERSIONS = 2
DIST = ROOT / "dist"


def version_tuple(value: str) -> tuple[int, int, int]:
    match = re.search(r"(\d+)\.(\d+)\.(\d+)", value)
    if not match:
        return (0, 0, 0)
    return tuple(int(part) for part in match.groups())


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


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_version() -> str:
    return (ROOT / "VERSION").read_text(encoding="utf-8").strip()


def release_download_url(manifest: dict, asset_name: str) -> str:
    assets = manifest.get("assets", {})
    app_url = ""
    if isinstance(assets, dict):
        for key in ("app", "portable", "source", "zip"):
            item = assets.get(key)
            if isinstance(item, dict) and item.get("url"):
                app_url = str(item.get("url") or "")
                break
    marker = "/download/"
    if marker in app_url:
        return app_url.split(marker, 1)[0] + marker + asset_name
    return asset_name


def update_latest_manifest() -> None:
    manifest_path = DIST / "latest.json"
    if not manifest_path.exists():
        return
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assets = manifest.setdefault("assets", {})
    version = read_version()
    release_dir = DESKTOP / "release"

    candidates = {
        "windows": release_dir / f"Viniper.UI.Setup.{version}.exe",
        "macos": release_dir / f"Viniper.UI.{version}-arm64-mac.zip",
    }
    has_platform_installer = any(path.exists() for path in candidates.values())
    for key, path in candidates.items():
        if path.exists():
            # Keep the small app package as the default in-app update target.
            # Installers stay in the manifest under non-preferred keys for
            # manual download surfaces and future explicit installer updates.
            assets[f"installer_{key}"] = {
                "name": path.name,
                "url": release_download_url(manifest, path.name),
                "sha256": sha256_file(path),
                "size": path.stat().st_size,
            }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def rcedit_tool() -> Path:
    candidates = [
        DESKTOP / "node_modules" / "rcedit" / "bin" / "rcedit-x64.exe",
        DESKTOP / "node_modules" / "rcedit" / "bin" / "rcedit.exe",
        DESKTOP / "node_modules" / "electron-winstaller" / "vendor" / "rcedit.exe",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    found = shutil.which("rcedit")
    if found:
        return Path(found)
    raise SystemExit("rcedit was not found. Run npm install in desktop first.")


def patch_windows_icon() -> None:
    if sys.platform != "win32":
        return
    exe_path = DESKTOP / "release" / "win-unpacked" / "Viniper UI.exe"
    icon_path = ROOT / "static" / "assets" / "viniper-icon.ico"
    if not exe_path.exists():
        raise SystemExit(f"missing packaged executable: {exe_path}")
    if not icon_path.exists():
        raise SystemExit(f"missing icon file: {icon_path}")
    run([
        str(rcedit_tool()),
        str(exe_path),
        "--set-icon",
        str(icon_path),
        "--set-version-string",
        "ProductName",
        "Viniper UI",
        "--set-version-string",
        "FileDescription",
        "Viniper UI",
        "--set-version-string",
        "InternalName",
        "Viniper UI",
        "--set-version-string",
        "OriginalFilename",
        "Viniper UI.exe",
    ], timeout=60)


def prepare_macos_icon() -> None:
    if sys.platform != "darwin":
        return
    source = ROOT / "static" / "assets" / "viniper-icon.png"
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


def prune_desktop_artifacts(keep: int = KEEP_RELEASE_VERSIONS) -> None:
    release_dir = DESKTOP / "release"
    if not release_dir.exists():
        return
    versioned: dict[str, list[Path]] = {}
    for pattern in [
        "Viniper.UI.Setup.*.exe",
        "Viniper.UI.Setup.*.exe.blockmap",
        "Viniper UI Setup *.exe",
        "Viniper UI Setup *.exe.blockmap",
        "Viniper.UI.*-mac.zip",
        "Viniper.UI.*-mac.zip.blockmap",
    ]:
        for path in release_dir.glob(pattern):
            match = re.search(r"(\d+\.\d+\.\d+)", path.name)
            if match:
                versioned.setdefault(match.group(1), []).append(path)
    ordered = sorted(versioned, key=version_tuple, reverse=True)
    for version, paths in versioned.items():
        has_stable_windows_name = any(path.name.startswith("Viniper.UI.Setup.") for path in paths)
        if has_stable_windows_name:
            for path in paths:
                if path.name.startswith("Viniper UI Setup "):
                    try:
                        path.unlink()
                    except FileNotFoundError:
                        pass
    for version in ordered[keep:]:
        for path in versioned.get(version, []):
            try:
                path.unlink()
            except FileNotFoundError:
                pass


def ensure_update_source() -> None:
    """Write update_source.json from env or repo slug so the desktop shell can auto-update."""
    source_path = ROOT / "update_source.json"
    if source_path.exists():
        return
    repo = os.environ.get("GITHUB_REPOSITORY", "").strip()
    if not repo:
        repo = "Viniper-Chu/viniper-ui"
    config = {
        "repository": repo,
        "manifest_url": f"https://github.com/{repo}/releases/latest/download/latest.json",
        "channel": "stable",
    }
    source_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {source_path}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Viniper UI desktop package.")
    parser.add_argument("--target", choices=["current", "win", "mac", "dir"], default="current")
    parser.add_argument("--skip-install", action="store_true", help="Skip npm install.")
    args = parser.parse_args()

    ensure_update_source()

    npm = tool("npm")
    os.environ.setdefault("ELECTRON_MIRROR", "https://npmmirror.com/mirrors/electron/")
    os.environ.setdefault("ELECTRON_BUILDER_BINARIES_MIRROR", "https://npmmirror.com/mirrors/electron-builder-binaries/")

    if not args.skip_install:
        run([npm, "install"], cwd=DESKTOP, timeout=300)

    run([npm, "run", "check"], cwd=DESKTOP, timeout=60)

    if args.target == "dir":
        run([npm, "run", "pack"], cwd=DESKTOP, timeout=600)
        patch_windows_icon()
    elif args.target == "win":
        run([npm, "run", "pack"], cwd=DESKTOP, timeout=600)
        patch_windows_icon()
        prepackaged = DESKTOP / "release" / "win-unpacked"
        run([npm, "run", "dist", "--", "--win", "nsis", "--prepackaged", str(prepackaged)], cwd=DESKTOP, timeout=900)
    elif args.target == "mac":
        if sys.platform != "darwin":
            raise SystemExit("macOS desktop packages must be built on macOS.")
        prepare_macos_icon()
        run([npm, "run", "dist", "--", "--mac"], cwd=DESKTOP, timeout=900)
    else:
        if sys.platform == "win32":
            run([npm, "run", "pack"], cwd=DESKTOP, timeout=600)
            patch_windows_icon()
            prepackaged = DESKTOP / "release" / "win-unpacked"
            run([npm, "run", "dist", "--", "--win", "nsis", "--prepackaged", str(prepackaged)], cwd=DESKTOP, timeout=900)
        elif sys.platform == "darwin":
            prepare_macos_icon()
            run([npm, "run", "dist", "--", "--mac"], cwd=DESKTOP, timeout=900)
        else:
            run([npm, "run", "pack"], cwd=DESKTOP, timeout=600)

    prune_desktop_artifacts()
    update_latest_manifest()
    print(f"Desktop artifacts are in {DESKTOP / 'release'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
