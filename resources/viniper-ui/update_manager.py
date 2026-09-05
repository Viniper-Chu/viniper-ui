"""Bounded, official-release-only desktop update download and handoff.

The installer owns the final application replacement. Downloading an asset or
opening its wizard is deliberately not reported as a completed update.
"""

from __future__ import annotations

import http.client
import json
import re
import struct
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable


OFFICIAL_REPOSITORY = "Viniper-Chu/viniper-ui"
OFFICIAL_MANIFEST_URL = f"https://github.com/{OFFICIAL_REPOSITORY}/releases/latest/download/latest.json"
MAX_INSTALLER_BYTES = 4 * 1024 * 1024 * 1024
MAX_MANIFEST_BYTES = 1024 * 1024
_VERSION = re.compile(r"^v?(\d+\.\d+\.\d+)$")
_INSTALLER_NAME = re.compile(r"^Viniper(?:-workstation|UI)[A-Za-z0-9._ -]*\.exe$", re.IGNORECASE)
_RELEASE_HOSTS = {"github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"}


def official_manifest_url(url: str = "") -> str:
    selected = str(url or OFFICIAL_MANIFEST_URL).strip()
    if selected != OFFICIAL_MANIFEST_URL:
        raise ValueError("更新源必须为 Viniper 官方 GitHub 正式发布源。")
    return selected


def validate_release_response_url(url: str) -> None:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname not in _RELEASE_HOSTS or parsed.username or parsed.password:
        raise ValueError("更新下载重定向到了非官方地址。")
    if parsed.port not in (None, 443):
        raise ValueError("更新下载地址端口无效。")


def fetch_official_manifest(*, version: str, url: str = "", timeout: int = 45) -> dict[str, Any]:
    request = urllib.request.Request(official_manifest_url(url), headers={"User-Agent": f"ViniperWorkstation/{version}", "Cache-Control": "no-cache"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        validate_release_response_url(response.geturl())
        payload = response.read(MAX_MANIFEST_BYTES + 1)
    if len(payload) > MAX_MANIFEST_BYTES:
        raise ValueError("更新清单大小异常。")
    manifest = json.loads(payload.decode("utf-8-sig"))
    if not isinstance(manifest, dict):
        raise ValueError("更新清单不是有效对象。")
    validate_installer_manifest(manifest)
    return manifest


def validate_installer_manifest(manifest: dict[str, Any], requested_asset: str | None = None) -> dict[str, Any]:
    match = _VERSION.fullmatch(str(manifest.get("version") or "").strip())
    if not match or manifest.get("prerelease") is True or manifest.get("draft") is True:
        raise ValueError("只能安装正式版本，不能安装预发布或草稿版本。")
    if str(manifest.get("channel") or "stable").lower() != "stable":
        raise ValueError("更新清单不是正式发布通道。")
    assets = manifest.get("assets")
    candidates: list[tuple[str, dict[str, Any]]] = []
    if isinstance(assets, dict):
        candidates = [(str(key), item) for key, item in assets.items() if isinstance(item, dict)]
    elif isinstance(assets, list):
        candidates = [(str(item.get("key") or "installer"), item) for item in assets if isinstance(item, dict)]
    candidates.sort(key=lambda pair: (pair[0] not in ("installer", "windows-installer", "nsis", "setup"), pair[0]))
    for key, item in candidates:
        if requested_asset and key != requested_asset:
            continue
        name = str(item.get("name") or "")
        if not _INSTALLER_NAME.fullmatch(name):
            continue
        url = str(item.get("url") or "")
        parsed = urllib.parse.urlsplit(url)
        path = urllib.parse.unquote(parsed.path)
        prefixes = [f"/{OFFICIAL_REPOSITORY}/releases/download/{tag}/" for tag in (match.group(1), f"v{match.group(1)}")]
        if parsed.scheme != "https" or parsed.netloc != "github.com" or parsed.query or parsed.fragment:
            raise ValueError("安装包地址不是官方 GitHub 发布资产。")
        if not any(path == prefix + name for prefix in prefixes):
            raise ValueError("安装包的仓库、版本或文件名与更新清单不一致。")
        try:
            size = int(item.get("size") or 0)
        except (TypeError, ValueError):
            size = 0
        if size <= 0 or size > MAX_INSTALLER_BYTES:
            raise ValueError("安装包大小无效。")
        return {**item, "key": key, "name": name, "url": url, "size": size}
    raise ValueError("正式更新缺少完整 Windows 安装包；不能用局部源码或便携包替换桌面程序。")


def verify_windows_installer(path: Path, expected_size: int) -> None:
    if path.is_symlink() or not path.is_file() or path.stat().st_size != expected_size:
        raise ValueError("安装包长度校验失败，请重新下载。")
    with path.open("rb") as handle:
        header = handle.read(64)
        if len(header) != 64 or header[:2] != b"MZ":
            raise ValueError("下载内容不是 Windows 安装程序。")
        offset = struct.unpack_from("<I", header, 0x3C)[0]
        if offset < 64 or offset > min(expected_size - 4, 16 * 1024 * 1024):
            raise ValueError("安装程序格式无效。")
        handle.seek(offset)
        if handle.read(4) != b"PE\0\0":
            raise ValueError("安装程序格式无效。")


def download_installer(asset: dict[str, Any], target: Path, *, version: str,
                       progress: Callable[[int, int], None] | None = None,
                       timeout: int = 45, retries: int = 3,
                       chunk_size: int = 1024 * 1024) -> None:
    expected = int(asset["size"])
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(target.suffix + ".part")
    if target.is_symlink() or partial.is_symlink():
        raise ValueError("更新暂存文件不能是符号链接。")
    if target.exists():
        try:
            verify_windows_installer(target, expected)
            if progress:
                progress(expected, expected)
            return
        except ValueError:
            pass
    attempts = max(1, min(5, retries))
    for attempt in range(attempts):
        downloaded = partial.stat().st_size if partial.exists() else 0
        if downloaded >= expected:
            partial.unlink()
            downloaded = 0
        headers = {"User-Agent": f"ViniperWorkstation/{version}"}
        if downloaded:
            headers["Range"] = f"bytes={downloaded}-"
        request = urllib.request.Request(str(asset["url"]), headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                validate_release_response_url(response.geturl())
                status = int(response.status)
                if status not in (200, 206):
                    raise ValueError("安装包下载响应异常。")
                if status == 206:
                    content_range = str(response.headers.get("Content-Range") or "")
                    if content_range != f"bytes {downloaded}-{expected - 1}/{expected}":
                        raise ValueError("断点续传范围与安装包不一致。")
                else:
                    downloaded = 0
                content_length = response.headers.get("Content-Length")
                if content_length and int(content_length) != expected - downloaded:
                    raise ValueError("下载响应长度与官方清单不一致。")
                if progress:
                    progress(downloaded, expected)
                with partial.open("ab" if downloaded else "wb") as handle:
                    while True:
                        incomplete = None
                        try:
                            chunk = response.read(chunk_size)
                        except http.client.IncompleteRead as exc:
                            chunk, incomplete = exc.partial, exc
                        if not chunk:
                            if incomplete:
                                raise incomplete
                            break
                        if downloaded + len(chunk) > expected:
                            raise ValueError("安装包超过官方清单大小，已停止下载。")
                        handle.write(chunk)
                        downloaded += len(chunk)
                        if progress:
                            progress(downloaded, expected)
                        if incomplete:
                            raise incomplete
            verify_windows_installer(partial, expected)
            partial.replace(target)
            return
        except Exception:
            if attempt + 1 >= attempts:
                raise
            time.sleep(min(2 ** attempt, 4))


def installer_command_line(installer: Path, desktop_exe: Path, *, app_dir: Path) -> tuple[str, Path]:
    executable = desktop_exe.resolve(strict=True)
    target = executable.parent
    if executable.name.lower() != "viniper workstation.exe" or not executable.is_file():
        raise ValueError("无法确认当前桌面程序安装位置，请从正式发布页手动安装。")
    if app_dir.resolve() != (target / "resources" / "viniper-ui").resolve():
        raise ValueError("当前服务与桌面程序安装位置不一致，已取消自动安装。")
    setup = installer.resolve(strict=True)
    if any(char in str(path) for path in (setup, target) for char in ('"', "\r", "\n", "\0")):
        raise ValueError("安装路径包含不支持的字符。")
    # NSIS StdUtils re-parses /D. Passing an argv list escapes embedded quotes
    # into backslash-quotes; a raw Windows command line preserves /D="...".
    # /D must be the last argument. Non-silent wizard asks before closing apps.
    return f'"{setup}" /D="{target}"', target


class UpdateState:
    def __init__(self, current_version: str) -> None:
        self._lock = threading.Lock()
        self._values: dict[str, Any] = {"ok": True, "status": "idle", "current_version": current_version,
            "latest_version": "", "downloaded_bytes": 0, "total_bytes": 0,
            "progress_percent": 0, "retryable": False, "ready_to_install": False,
            "installer_opened": False, "message": ""}

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._values)

    def set(self, **values: Any) -> dict[str, Any]:
        with self._lock:
            self._values.update(values)
            self._values["ready_to_install"] = self._values["status"] == "ready"
            self._values["installer_opened"] = self._values["status"] == "installer_opened"
            return dict(self._values)

    def progress(self, downloaded: int, total: int) -> None:
        self.set(downloaded_bytes=downloaded, total_bytes=total,
                 progress_percent=min(100, round(downloaded * 100 / max(1, total), 1)))
