"""Persistent, session-scoped FIFO for messages queued behind Agent runs."""

from __future__ import annotations

import copy
import json
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any


class AgentQueueStore:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self._lock = threading.RLock()
        self._drain_tokens: dict[str, dict[str, str]] = {}
        self._data = self._load()
        changed = False
        for items in self._data["sessions"].values():
            for item in items:
                if item.get("status") in {"queued", "dispatching"}:
                    item["status"] = "paused"
                    changed = True
        if changed:
            self._save()

    def _load(self) -> dict[str, Any]:
        if not self.path.exists():
            return {"version": 1, "sessions": {}}
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {"version": 1, "sessions": {}}
        sessions = payload.get("sessions") if isinstance(payload, dict) else None
        if not isinstance(sessions, dict):
            sessions = {}
        return {
            "version": 1,
            "sessions": {
                str(session_id): [copy.deepcopy(item) for item in items if isinstance(item, dict)]
                for session_id, items in sessions.items() if isinstance(items, list)
            },
        }

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_name(f".{self.path.name}.{uuid.uuid4().hex}.tmp")
        temp.write_text(json.dumps(self._data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        os.replace(temp, self.path)

    def list(self, session_id: str) -> list[dict[str, Any]]:
        with self._lock:
            return copy.deepcopy(self._data["sessions"].get(str(session_id), []))

    def enqueue(
        self,
        session_id: str,
        text: str,
        *,
        model: str = "",
        permission_mode: str = "",
        attachments: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        sid = str(session_id or "").strip()
        content = str(text or "").strip()
        if not sid or not content:
            raise ValueError("session_id and text are required")
        item = {
            "id": uuid.uuid4().hex,
            "session_id": sid,
            "text": content,
            "attachments": copy.deepcopy(attachments or []),
            "model": str(model or ""),
            "permission_mode": str(permission_mode or ""),
            "status": "queued",
            "created_at": time.time(),
            "updated_at": time.time(),
        }
        with self._lock:
            self._data["sessions"].setdefault(sid, []).append(item)
            self._save()
            return copy.deepcopy(item)

    def edit(self, session_id: str, item_id: str, text: str) -> dict[str, Any]:
        content = str(text or "").strip()
        if not content:
            raise ValueError("queued text is required")
        with self._lock:
            item = self._find(session_id, item_id)
            if item.get("status") == "dispatching":
                raise ValueError("dispatching item cannot be edited")
            item["text"] = content
            item["updated_at"] = time.time()
            self._save()
            return copy.deepcopy(item)

    def cancel(self, session_id: str, item_id: str) -> dict[str, Any]:
        sid = str(session_id)
        with self._lock:
            items = self._data["sessions"].get(sid, [])
            for index, item in enumerate(items):
                if str(item.get("id")) == str(item_id):
                    if item.get("status") == "dispatching":
                        raise ValueError("dispatching item cannot be cancelled")
                    removed = items.pop(index)
                    self._save()
                    return copy.deepcopy(removed)
        raise KeyError("queued item not found")

    def _find(self, session_id: str, item_id: str) -> dict[str, Any]:
        for item in self._data["sessions"].get(str(session_id), []):
            if str(item.get("id")) == str(item_id):
                return item
        raise KeyError("queued item not found")

    def authorize_drain(self, session_id: str, run_id: str, outcome: str) -> str | None:
        sid = str(session_id)
        if str(outcome) != "done":
            return None
        with self._lock:
            if not any(item.get("status") in {"queued", "paused"} for item in self._data["sessions"].get(sid, [])):
                return None
            token = uuid.uuid4().hex
            self._drain_tokens[sid] = {"token": token, "run_id": str(run_id)}
            return token

    def has_drain_authorization(self, session_id: str) -> bool:
        with self._lock:
            return str(session_id) in self._drain_tokens

    def claim_authorized(self, session_id: str, token: str) -> dict[str, Any] | None:
        sid = str(session_id)
        with self._lock:
            authorization = self._drain_tokens.get(sid)
            if not authorization or authorization.get("token") != str(token):
                return None
            self._drain_tokens.pop(sid, None)
            for item in self._data["sessions"].get(sid, []):
                if item.get("status") in {"queued", "paused"}:
                    item["status"] = "dispatching"
                    item["updated_at"] = time.time()
                    self._save()
                    return copy.deepcopy(item)
            return None

    def mark_started(self, session_id: str, item_id: str) -> dict[str, Any]:
        sid = str(session_id)
        with self._lock:
            items = self._data["sessions"].get(sid, [])
            for index, item in enumerate(items):
                if str(item.get("id")) == str(item_id) and item.get("status") == "dispatching":
                    removed = items.pop(index)
                    self._save()
                    return copy.deepcopy(removed)
        raise KeyError("dispatching item not found")

    def pause_dispatch(self, session_id: str, item_id: str) -> dict[str, Any]:
        with self._lock:
            item = self._find(session_id, item_id)
            if item.get("status") == "dispatching":
                item["status"] = "paused"
                item["updated_at"] = time.time()
                self._save()
            return copy.deepcopy(item)

    def pause_pending(self, session_id: str) -> list[dict[str, Any]]:
        sid = str(session_id)
        changed = False
        with self._lock:
            self._drain_tokens.pop(sid, None)
            for item in self._data["sessions"].get(sid, []):
                if item.get("status") in {"queued", "dispatching"}:
                    item["status"] = "paused"
                    item["updated_at"] = time.time()
                    changed = True
            if changed:
                self._save()
            return copy.deepcopy(self._data["sessions"].get(sid, []))

    def clear_authorization(self, session_id: str) -> None:
        with self._lock:
            self._drain_tokens.pop(str(session_id), None)


__all__ = ["AgentQueueStore"]
