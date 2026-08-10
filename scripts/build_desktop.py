#!/usr/bin/env python3
"""Build the Viniper desktop app for the current platform."""

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
DIST = ROOT / "dist"
RESOURCE_STAGING_ROOT = ROOT / "codex" / "运行残留" / "formal-resource-staging"
OPTIONAL_RESOURCE_FILES = {"PREVIEW"}


def tool(name: str) -> str:
    resolved = shutil.which(name)
    if not resolved and sys.platform == "win32":
        resolved = shutil.which(f"{name}.cmd")
    if not resolved:
        raise SystemExit(f"{name} was not found. Install Node.js first.")
    return resolved


def write_stdout_utf8(text: str) -> None:
    """Write build output without depending on the runner's legacy code page."""
    buffer = getattr(sys.stdout, "buffer", None)
    if buffer is None:
        sys.stdout.write(text)
        sys.stdout.flush()
        return
    buffer.write(text.encode("utf-8", errors="replace"))
    buffer.flush()


def run(command: list[str], cwd: Path = ROOT, timeout: int | None = None) -> None:
    write_stdout_utf8(f"+ {' '.join(command)}\n")
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
        output = completed.stdout
        if not output.endswith("\n"):
            output += "\n"
        write_stdout_utf8(output)
    if completed.returncode != 0:
        raise SystemExit(f"command failed: {' '.join(command)}")


def read_version() -> str:
    return (ROOT / "VERSION").read_text(encoding="utf-8").strip()


def prepare_resource_staging(
    staging: Path,
    *,
    root: Path = ROOT,
    desktop: Path = DESKTOP,
) -> Path:
    """Create the exact formal extraResources tree without walking local evidence."""
    staging = staging.resolve()
    if staging.exists():
        raise SystemExit(f"resource staging already exists; refusing to reuse: {staging}")
    staging.parent.mkdir(parents=True, exist_ok=True)
    staging.mkdir()

    package_path = desktop / "package.json"
    try:
        package = json.loads(package_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"desktop package configuration is inaccessible: {package_path}: {exc}") from exc
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
            source = root / relative
            try:
                is_directory = source.is_dir()
            except OSError as exc:
                raise SystemExit(f"required resource directory is inaccessible: {source}: {exc}") from exc
            if not is_directory:
                raise SystemExit(f"required resource directory missing: {source}")
            try:
                shutil.copytree(
                    source,
                    staging / relative,
                    ignore=shutil.ignore_patterns(
                        "__pycache__",
                        "*.pyc",
                        "node_modules",
                        "release",
                        "release-preview",
                    ),
                )
            except OSError as exc:
                raise SystemExit(f"required resource directory could not be copied: {source}: {exc}") from exc
            continue
        if "*" in pattern or "?" in pattern:
            raise SystemExit(f"unsupported positive resource glob: {pattern}")
        source = root / pattern
        try:
            is_file = source.is_file()
        except OSError as exc:
            raise SystemExit(f"required resource file is inaccessible: {source}: {exc}") from exc
        if not is_file:
            if pattern in OPTIONAL_RESOURCE_FILES:
                continue
            raise SystemExit(f"required resource file missing: {source}")
        target = staging / pattern
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.copy2(source, target)
        except OSError as exc:
            raise SystemExit(f"required resource file could not be copied: {source}: {exc}") from exc

    config = json.loads(json.dumps(build))
    metadata = config.get("extraMetadata")
    config["extraMetadata"] = {
        **(metadata if isinstance(metadata, dict) else {}),
        "viniperProfile": "formal-runtime",
    }
    config["extraResources"] = [
        {"from": str(staging), "to": "viniper-ui", "filter": filters}
    ]
    config_path = staging.parent / "electron-builder.formal.json"
    config_path.write_text(
        json.dumps(config, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return config_path


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
        "installer_windows": release_dir / f"Viniper.Setup.{version}.exe",
        "installer_macos_arm64": release_dir / f"Viniper.{version}-arm64-mac.zip",
        "installer_macos_x64": release_dir / f"Viniper.{version}-x64-mac.zip",
    }
    for key, path in candidates.items():
        if path.exists():
            # Keep the small app package as the default in-app update target.
            # Installers stay in the manifest under non-preferred keys for
            # manual download surfaces and future explicit installer updates.
            assets[key] = {
                "name": path.name,
                "url": release_download_url(manifest, path.name),
                "size": path.stat().st_size,
            }
    default_macos = assets.get("installer_macos_arm64") or assets.get("installer_macos_x64")
    if default_macos:
        assets["installer_macos"] = dict(default_macos)
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
    exe_path = DESKTOP / "release" / "win-unpacked" / "Viniper.exe"
    icon_path = ROOT / "static" / "assets" / "viniper-icon.ico"
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
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
        "Viniper",
        "--set-version-string",
        "FileDescription",
        "Viniper",
        "--set-version-string",
        "InternalName",
        "Viniper",
        "--set-version-string",
        "OriginalFilename",
        "Viniper.exe",
        "--set-file-version",
        version,
        "--set-product-version",
        version,
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
    parser = argparse.ArgumentParser(description="Build Viniper desktop package.")
    parser.add_argument("--target", choices=["current", "win", "mac", "dir"], default="current")
    parser.add_argument("--arch", choices=["x64", "arm64"])
    parser.add_argument("--skip-install", action="store_true", help="Skip npm install.")
    args = parser.parse_args()

    if args.target == "mac" and not args.arch:
        parser.error("--target mac requires an explicit --arch x64 or --arch arm64")

    ensure_update_source()

    staging_id = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f") + f"-p{os.getpid()}"
    builder_config = prepare_resource_staging(
        RESOURCE_STAGING_ROOT / staging_id / "viniper-ui"
    )

    npm = tool("npm")
    os.environ.setdefault("ELECTRON_MIRROR", "https://npmmirror.com/mirrors/electron/")
    os.environ.setdefault("ELECTRON_BUILDER_BINARIES_MIRROR", "https://npmmirror.com/mirrors/electron-builder-binaries/")

    if not args.skip_install:
        run([npm, "install"], cwd=DESKTOP, timeout=300)

    run([npm, "run", "check"], cwd=DESKTOP, timeout=60)

    if args.target == "dir":
        run([npm, "run", "pack", "--", "--config", str(builder_config)], cwd=DESKTOP, timeout=600)
        patch_windows_icon()
    elif args.target == "win":
        run([npm, "run", "pack", "--", "--config", str(builder_config)], cwd=DESKTOP, timeout=600)
        patch_windows_icon()
        prepackaged = DESKTOP / "release" / "win-unpacked"
        run([npm, "run", "dist", "--", "--win", "nsis", "--prepackaged", str(prepackaged), "--config", str(builder_config)], cwd=DESKTOP, timeout=900)
    elif args.target == "mac":
        if sys.platform != "darwin":
            raise SystemExit("macOS desktop packages must be built on macOS.")
        prepare_macos_icon()
        run([npm, "run", "dist", "--", "--mac", f"--{args.arch}", "--config", str(builder_config)], cwd=DESKTOP, timeout=900)
    else:
        if sys.platform == "win32":
            run([npm, "run", "pack", "--", "--config", str(builder_config)], cwd=DESKTOP, timeout=600)
            patch_windows_icon()
            prepackaged = DESKTOP / "release" / "win-unpacked"
            run([npm, "run", "dist", "--", "--win", "nsis", "--prepackaged", str(prepackaged), "--config", str(builder_config)], cwd=DESKTOP, timeout=900)
        elif sys.platform == "darwin":
            prepare_macos_icon()
            run([npm, "run", "dist", "--", "--mac", "--config", str(builder_config)], cwd=DESKTOP, timeout=900)
        else:
            run([npm, "run", "pack", "--", "--config", str(builder_config)], cwd=DESKTOP, timeout=600)

    update_latest_manifest()
    print(f"Desktop artifacts are in {DESKTOP / 'release'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
