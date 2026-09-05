"""Read-only desktop file browsing, independent of either agent's index/LSP."""

from __future__ import annotations

from collections import deque
import os
from pathlib import Path, PureWindowsPath
import stat
from typing import Any


ENGINE = "desktop-file-browser"
_EXCLUDED_DIRS = frozenset({
    ".git", ".hg", ".svn", "node_modules", ".venv", "venv", "__pycache__",
    ".mypy_cache", ".pytest_cache", ".ruff_cache", ".next", "dist", "build",
    "coverage", "target", "vendor", "codex", ".codex", ".claude", ".ssh",
    ".aws", ".azure", ".gcloud", ".gnupg", ".kube",
})
_EXCLUDED_FILES = frozenset({
    ".npmrc", ".pypirc", ".git-credentials", "credentials", "credentials.json",
    "secrets.json", "secrets.toml", "auth.json", "auth.toml", "id_rsa", "id_ed25519",
})
_SECRET_SUFFIXES = frozenset({".pem", ".key", ".pfx", ".p12", ".kdbx", ".sqlite", ".sqlite3", ".db"})
_ENV_EXAMPLES = frozenset({".env.example", ".env.sample", ".env.template"})
_REPARSE_POINT = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)


class ProjectBrowserError(ValueError):
    """A selected path is invalid, outside the project, or not previewable."""


def _is_link(info: os.stat_result) -> bool:
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0) & _REPARSE_POINT)


def _excluded_file(name: str) -> bool:
    name = name.casefold()
    return (
        name in _EXCLUDED_FILES
        or Path(name).suffix in _SECRET_SUFFIXES
        or (name.startswith(".env") and name not in _ENV_EXAMPLES)
    )


def _root_path(root: str | Path) -> Path:
    text = str(root or "")
    if not text or any(ord(char) < 32 for char in text):
        raise ProjectBrowserError("请先为此会话选择项目目录")
    path = Path(text)
    if not path.is_absolute():
        raise ProjectBrowserError("项目目录必须是绝对路径")
    try:
        if _is_link(path.lstat()):
            raise ProjectBrowserError("请直接选择实际项目目录，不使用目录链接")
        resolved = path.resolve(strict=True)
        if not resolved.is_dir():
            raise ProjectBrowserError("所选项目目录不存在")
    except OSError as exc:
        raise ProjectBrowserError("所选项目目录无法读取") from exc
    return resolved


def _relative_parts(relative_path: str) -> tuple[str, ...]:
    text = str(relative_path or "")
    windows_path = PureWindowsPath(text)
    if (
        not text or any(ord(char) < 32 for char in text) or ":" in text
        or windows_path.drive or windows_path.root or text.startswith(("/", "\\"))
    ):
        raise ProjectBrowserError("请使用项目内的相对文件路径")
    parts = tuple(text.replace("\\", "/").split("/"))
    if any(part in {"", ".", ".."} or part.rstrip(" .") != part for part in parts):
        raise ProjectBrowserError("文件路径不能越过项目目录")
    if any(part.casefold() in _EXCLUDED_DIRS for part in parts[:-1]) or _excluded_file(parts[-1]):
        raise ProjectBrowserError("此文件属于依赖、运行数据或凭据，不在项目预览范围内")
    return parts


def _contained_file(root: Path, relative_path: str) -> Path:
    current = root
    try:
        for part in _relative_parts(relative_path):
            current = current / part
            if _is_link(current.lstat()):
                raise ProjectBrowserError("文件或目录链接不允许用于项目预览")
        resolved = current.resolve(strict=True)
        if not resolved.is_relative_to(root):
            raise ProjectBrowserError("文件必须位于所选项目内")
        if not resolved.is_file():
            raise ProjectBrowserError("所选路径不是普通文件")
    except OSError as exc:
        raise ProjectBrowserError("文件不存在或无法读取") from exc
    return resolved


def browse_project_files(
    root: str | Path,
    query: str = "",
    *,
    limit: int = 120,
    max_scan_entries: int = 5000,
    max_depth: int = 12,
) -> dict[str, Any]:
    """Return the existing project-index shape, with explicit desktop ownership."""
    project = _root_path(root)
    limit = max(1, min(int(limit), 500))
    scan_limit = max(1, min(int(max_scan_entries), 20000))
    depth_limit = max(1, min(int(max_depth), 32))
    needle = str(query or "").strip().casefold()[:300]
    directories = deque([(project, 0)])
    entries: list[dict[str, Any]] = []
    scanned = 0
    truncated = False
    while directories:
        directory, depth = directories.popleft()
        # Revalidate each queued directory: never follow a link introduced
        # between discovering the directory and walking it.
        try:
            if _is_link(directory.lstat()) or not directory.resolve(strict=True).is_relative_to(project):
                continue
            with os.scandir(directory) as children:
                batch = []
                for child in children:
                    if scanned >= scan_limit:
                        truncated = True
                        break
                    scanned += 1
                    batch.append(child)
            for child in sorted(batch, key=lambda item: item.name.casefold()):
                try:
                    info = child.stat(follow_symlinks=False)
                    if _is_link(info):
                        continue
                    candidate = Path(child.path)
                    if not candidate.resolve(strict=True).is_relative_to(project):
                        continue
                    if stat.S_ISDIR(info.st_mode):
                        if child.name.casefold() in _EXCLUDED_DIRS:
                            continue
                        if depth < depth_limit:
                            directories.append((candidate, depth + 1))
                        else:
                            truncated = True
                    elif stat.S_ISREG(info.st_mode) and not _excluded_file(child.name):
                        relative = candidate.relative_to(project).as_posix()
                        if needle and needle not in relative.casefold():
                            continue
                        if len(entries) >= limit:
                            truncated = True
                            break
                        entries.append({"path": relative, "size": info.st_size, "symbols": []})
                except OSError:
                    continue
        except OSError:
            continue
        if len(entries) >= limit or scanned >= scan_limit:
            truncated = truncated or bool(directories)
            break
    entries.sort(key=lambda item: item["path"].casefold())
    return {
        "ok": True, "status": "ready", "engine": ENGINE, "root": str(project),
        "source": "desktop-directory-listing", "entries": entries,
        "truncated": truncated, "scanned_entries": scanned,
    }


def _opened_path(fd: int, fallback: Path) -> Path:
    """Verify the opened handle too, before reading any bytes (link-swap race)."""
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        import msvcrt
        get_path = ctypes.WinDLL("kernel32", use_last_error=True).GetFinalPathNameByHandleW
        get_path.argtypes = (wintypes.HANDLE, wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD)
        get_path.restype = wintypes.DWORD
        buffer = ctypes.create_unicode_buffer(32768)
        length = get_path(msvcrt.get_osfhandle(fd), buffer, len(buffer), 0)
        if not length or length >= len(buffer):
            raise ProjectBrowserError("无法确认已打开文件的位置")
        value = buffer.value
        if value.startswith("\\\\?\\UNC\\"):
            value = "\\\\" + value[8:]
        elif value.startswith("\\\\?\\"):
            value = value[4:]
        return Path(value).resolve(strict=True)
    fd_path = Path("/proc/self/fd") / str(fd)
    return fd_path.resolve(strict=True) if fd_path.exists() else fallback.resolve(strict=True)


def preview_project_file(root: str | Path, relative_path: str, *, max_bytes: int = 262144) -> dict[str, Any]:
    """Read a bounded text file under the selected root; never write or execute."""
    project = _root_path(root)
    path = _contained_file(project, relative_path)
    maximum = max(1024, min(int(max_bytes), 1048576))
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags)
        with os.fdopen(fd, "rb") as stream:
            opened = _opened_path(stream.fileno(), path)
            info = os.fstat(stream.fileno())
            if not opened.is_relative_to(project) or not stat.S_ISREG(info.st_mode):
                raise ProjectBrowserError("文件必须是所选项目内的普通文件")
            result = {"ok": True, "engine": ENGINE, "root": str(project),
                      "path": path.relative_to(project).as_posix(), "size": info.st_size,
                      "content": "", "encoding": "", "status": "available"}
            if info.st_size > maximum:
                return {**result, "status": "too-large", "reason": f"文件超过 {maximum // 1024} KB，暂不在面板中预览"}
            raw = stream.read(maximum + 1)
    except OSError as exc:
        raise ProjectBrowserError("文件无法读取或已发生变化，请刷新后重试") from exc
    if len(raw) > maximum:
        return {**result, "status": "too-large", "reason": "文件变大了，请在编辑器中打开"}
    encoding = "utf-8-sig"
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        encoding = "utf-16"
    elif b"\0" in raw or sum(byte < 9 or 13 < byte < 32 for byte in raw) > max(2, len(raw) // 50):
        return {**result, "status": "binary", "reason": "此文件为二进制格式，请在对应应用中打开"}
    try:
        text = raw.decode(encoding)
    except UnicodeError:
        try:
            text = raw.decode("gb18030")
            encoding = "gb18030"
        except UnicodeError:
            return {**result, "status": "unsupported-encoding", "reason": "无法识别文件的文本编码"}
    return {**result, "content": text, "encoding": encoding}
