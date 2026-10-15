"""Project only an application-owned Claude conversation after a TUI handoff.

The CLI stays the owner of its transcript and checkpoints. We append new
visible records to the desktop journal without rewriting existing messages.
No account configuration, credentials or other conversations are inspected.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any
from uuid import UUID

MAX_READ = 16 * 1024 * 1024
MAX_TEXT = 128 * 1024


def transcript_path(workdir: str, session_id: str, config_dir: str = "") -> Path:
    session_id = str(UUID(session_id))
    root = Path(config_dir).expanduser() if config_dir else Path.home() / ".claude"
    project = re.sub(r"[^A-Za-z0-9]", "-", str(Path(workdir).expanduser().resolve()))
    path = root / "projects" / project / f"{session_id}.jsonl"
    if path.resolve().is_relative_to((root / "projects").resolve()):
        return path
    raise ValueError("原生会话文件路径越界")


def checkpoint(workdir: str, session_id: str, config_dir: str = "") -> dict[str, Any]:
    path = transcript_path(workdir, session_id, config_dir)
    marker = {"path": str(path), "offset": 0, "session_id": str(UUID(session_id))}
    if path.is_file():
        info = path.stat()
        marker.update(offset=info.st_size, file_id=(info.st_dev, info.st_ino))
        with path.open("rb") as stream:
            stream.seek(max(0, info.st_size - MAX_READ))
            if info.st_size > MAX_READ:
                stream.readline()
            content = stream.read(MAX_READ)
        # A bounded literal tail detects truncation-and-rewrite even when the
        # replacement is longer and retains the same inode. This stays private
        # in the handoff marker; no transcript text is exposed in API status.
        marker["tail"] = content[-256:]
        known = []
        for line in content.splitlines():
            try:
                row = json.loads(line)
            except (ValueError, UnicodeDecodeError):
                continue
            if isinstance(row, dict) and row.get("sessionId") == marker["session_id"] and row.get("uuid"):
                known.append(str(row["uuid"]))
        marker["known_uuids"] = known
    return marker


def _text(value: Any) -> str:
    if isinstance(value, str):
        return value[:MAX_TEXT]
    if isinstance(value, list):
        return "\n".join(str(item.get("text") or "") for item in value
                         if isinstance(item, dict) and item.get("type") == "text")[:MAX_TEXT]
    return ""


def project_since(marker: dict[str, Any]) -> dict[str, Any]:
    path = Path(marker["path"])
    if not path.is_file():
        return {"messages": [], "exists": False, "truncated": False, "model": ""}
    info = path.stat()
    size = info.st_size
    offset = int(marker.get("offset") or 0)
    rewritten = size < offset or ("file_id" in marker and tuple(marker["file_id"]) != (info.st_dev, info.st_ino))
    tail = marker.get("tail")
    if offset and tail and not rewritten:
        with path.open("rb") as stream:
            stream.seek(offset - len(tail))
            rewritten = stream.read(len(tail)) != tail
    if rewritten:
        offset = 0
    truncated = size - offset > MAX_READ
    if truncated:
        offset = size - MAX_READ
    messages: list[dict[str, Any]] = []
    seen = set(marker.get("known_uuids") or [])
    model = ""
    with path.open("rb") as stream:
        stream.seek(offset)
        if truncated:
            stream.readline()
        for line in stream.read(MAX_READ).splitlines():
            try:
                row = json.loads(line)
            except (ValueError, UnicodeDecodeError):
                continue
            if not isinstance(row, dict) or row.get("sessionId") != marker["session_id"] or row.get("isSidechain"):
                continue
            identity = str(row.get("uuid") or "")
            if identity and identity in seen:
                continue
            if identity:
                seen.add(identity)
            role = row.get("type")
            message = row.get("message")
            if role not in {"user", "assistant"} or not isinstance(message, dict):
                continue
            content = message.get("content")
            blocks = content if isinstance(content, list) else [{"type": "text", "text": str(content or "")}]
            segments: list[dict[str, Any]] = []
            plain: list[str] = []
            tool_results = False
            for block in blocks:
                if not isinstance(block, dict):
                    continue
                kind = block.get("type")
                if kind in {"text", "thinking"}:
                    value = str(block.get("text" if kind == "text" else "thinking") or "")[:MAX_TEXT]
                    if value:
                        segments.append({"type": kind, "content": value})
                        if kind == "text":
                            plain.append(value)
                elif kind == "tool_use":
                    arguments = block.get("input") if isinstance(block.get("input"), dict) else {}
                    segments.append({"type": "tool_start", "tool_id": str(block.get("id") or ""),
                                     "name": str(block.get("name") or "工具"), "input": arguments,
                                     "detail": str(arguments.get("file_path") or arguments.get("command") or "")[:2000]})
                elif kind == "tool_result":
                    tool_results = True
                    segments.append({"type": "tool_result", "tool_id": str(block.get("tool_use_id") or ""),
                                     "content": _text(block.get("content")), "status": "error" if block.get("is_error") else "success"})
            if not segments:
                continue
            if role == "assistant" and message.get("model"):
                model = str(message["model"])
            if tool_results and not plain and messages and messages[-1]["role"] == "assistant":
                messages[-1]["segments"].extend(segments)
                continue
            messages.append({"role": "assistant" if tool_results else role,
                             "content": "\n".join(plain), "segments": segments,
                             "source": "claude-native-terminal", "native_uuid": str(row.get("uuid") or ""),
                             "model": str(message.get("model") or ""), "created_at": row.get("timestamp", "")})
    return {"messages": messages, "exists": size > 0, "truncated": truncated,
            "rewritten": rewritten, "model": model}
