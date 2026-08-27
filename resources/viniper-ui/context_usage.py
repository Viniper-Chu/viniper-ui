"""Server-owned Claude context usage snapshots for Viniper Agent sessions."""

from __future__ import annotations

import json
import os
import threading
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Mapping


USAGE_KEYS = {
    "input_tokens": ("input_tokens", "inputTokens"),
    "cache_creation_input_tokens": ("cache_creation_input_tokens", "cacheCreationInputTokens"),
    "cache_read_input_tokens": ("cache_read_input_tokens", "cacheReadInputTokens"),
    "output_tokens": ("output_tokens", "outputTokens"),
}
CONTEXT_LIMIT_KEYS = ("context_window_size", "contextWindowSize", "context_limit", "contextLimit")


def _integer(source: Mapping[str, Any], keys: tuple[str, ...], default: int = 0) -> int:
    for key in keys:
        if key not in source:
            continue
        try:
            return max(0, int(source[key] or 0))
        except (TypeError, ValueError):
            return default
    return default


def _has_usage(source: Mapping[str, Any]) -> bool:
    return any(key in source for aliases in USAGE_KEYS.values() for key in aliases)


def _usage_from_event(event: Mapping[str, Any]) -> tuple[Mapping[str, Any] | None, Mapping[str, Any] | None]:
    """Return the real current-window usage and its optional context metadata."""
    context_window = event.get("context_window") if isinstance(event.get("context_window"), Mapping) else None
    event_usage = event.get("usage") if isinstance(event.get("usage"), Mapping) else None
    if context_window is None and event_usage is not None:
        candidate = event_usage.get("context_window")
        context_window = candidate if isinstance(candidate, Mapping) else None
    if context_window is not None:
        current_usage = context_window.get("current_usage")
        if isinstance(current_usage, Mapping) and _has_usage(current_usage):
            return current_usage, context_window

    message = event.get("message") if isinstance(event.get("message"), Mapping) else None
    message_usage = message.get("usage") if message is not None and isinstance(message.get("usage"), Mapping) else None
    if message_usage is not None and _has_usage(message_usage):
        return message_usage, context_window
    return None, context_window


@dataclass(frozen=True)
class ContextUsageSnapshot:
    session_id: str
    used_tokens: int
    context_limit: int
    ratio: float
    source: str
    updated_at: float
    model: str
    effective_context_window: int = 0
    input_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0
    output_tokens: int = 0
    compacting: bool = False

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


class ContextUsageLedger:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self._lock = threading.RLock()
        self._snapshots: dict[str, ContextUsageSnapshot] = {}
        self._load()

    def _load(self) -> None:
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        records = payload.get("sessions") if isinstance(payload, dict) else None
        if not isinstance(records, dict):
            return
        for session_id, value in records.items():
            if not isinstance(value, dict):
                continue
            try:
                snapshot = ContextUsageSnapshot(
                    session_id=str(session_id),
                    used_tokens=max(0, int(value.get("used_tokens") or 0)),
                    context_limit=max(0, int(value.get("context_limit") or 0)),
                    effective_context_window=max(0, int(value.get("effective_context_window") or value.get("context_limit") or 0)),
                    ratio=max(0.0, min(1.0, float(value.get("ratio") or 0))),
                    source=str(value.get("source") or "unavailable"),
                    updated_at=float(value.get("updated_at") or 0),
                    model=str(value.get("model") or ""),
                    input_tokens=max(0, int(value.get("input_tokens") or 0)),
                    cache_creation_input_tokens=max(0, int(value.get("cache_creation_input_tokens") or 0)),
                    cache_read_input_tokens=max(0, int(value.get("cache_read_input_tokens") or 0)),
                    output_tokens=max(0, int(value.get("output_tokens") or 0)),
                    compacting=bool(value.get("compacting")),
                )
            except (TypeError, ValueError):
                continue
            self._snapshots[str(session_id)] = snapshot

    def _persist(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        payload = {"sessions": {key: value.as_dict() for key, value in self._snapshots.items()}}
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, self.path)

    def get(self, session_id: str, *, model: str = "", context_limit: int = 0) -> ContextUsageSnapshot:
        with self._lock:
            current = self._snapshots.get(str(session_id))
            if current is not None:
                return current
        return ContextUsageSnapshot(
            session_id=str(session_id),
            used_tokens=0,
            context_limit=max(0, int(context_limit or 0)),
            effective_context_window=max(0, int(context_limit or 0)),
            ratio=0.0,
            source="unavailable",
            updated_at=0.0,
            model=str(model or ""),
        )

    def update_from_event(
        self,
        session_id: str,
        event: Mapping[str, Any],
        *,
        model: str,
        fallback_limit: int,
    ) -> ContextUsageSnapshot | None:
        usage, context_window = _usage_from_event(event)
        if usage is None:
            return None
        message = event.get("message") if isinstance(event.get("message"), Mapping) else {}
        selected_model = str(model or event.get("model") or message.get("model") or "")
        values = {name: _integer(usage, aliases) for name, aliases in USAGE_KEYS.items()}
        used_tokens = (
            values["input_tokens"]
            + values["cache_creation_input_tokens"]
            + values["cache_read_input_tokens"]
        )
        context_limit = _integer(context_window or {}, CONTEXT_LIMIT_KEYS, max(0, int(fallback_limit or 0)))
        if not context_limit:
            context_limit = max(0, int(fallback_limit or 0))
        ratio = min(used_tokens / context_limit, 1.0) if context_limit else 0.0
        snapshot = ContextUsageSnapshot(
            session_id=str(session_id),
            used_tokens=used_tokens,
            context_limit=context_limit,
            effective_context_window=context_limit,
            ratio=ratio,
            source="real",
            updated_at=time.time(),
            model=selected_model,
            compacting=False,
            **values,
        )
        with self._lock:
            self._snapshots[str(session_id)] = snapshot
            self._persist()
        return snapshot

    def mark_compact_boundary(
        self,
        session_id: str,
        event: Mapping[str, Any],
        *,
        model: str,
        fallback_limit: int,
    ) -> ContextUsageSnapshot:
        with self._lock:
            current = self._snapshots.get(str(session_id))
            limit = current.context_limit if current is not None else max(0, int(fallback_limit or 0))
            snapshot = ContextUsageSnapshot(
                session_id=str(session_id),
                used_tokens=current.used_tokens if current is not None else 0,
                context_limit=limit,
                effective_context_window=(current.effective_context_window if current is not None else limit) or limit,
                ratio=current.ratio if current is not None else 0.0,
                source=current.source if current is not None else "unavailable",
                updated_at=time.time(),
                model=str(model or (current.model if current is not None else "")),
                input_tokens=current.input_tokens if current is not None else 0,
                cache_creation_input_tokens=current.cache_creation_input_tokens if current is not None else 0,
                cache_read_input_tokens=current.cache_read_input_tokens if current is not None else 0,
                output_tokens=current.output_tokens if current is not None else 0,
                compacting=True,
            )
            self._snapshots[str(session_id)] = snapshot
            self._persist()
            return snapshot

    def record_estimate(
        self,
        session_id: str,
        used_tokens: int,
        *,
        model: str,
        context_limit: int,
    ) -> ContextUsageSnapshot:
        with self._lock:
            current = self._snapshots.get(str(session_id))
            if current is not None and current.source == "real" and current.model == str(model):
                return current
            limit = max(0, int(context_limit or 0))
            used = max(0, int(used_tokens or 0))
            snapshot = ContextUsageSnapshot(
                session_id=str(session_id),
                used_tokens=used,
                context_limit=limit,
                effective_context_window=limit,
                ratio=min(used / limit, 1.0) if limit else 0.0,
                source="estimated",
                updated_at=time.time(),
                model=str(model or ""),
            )
            self._snapshots[str(session_id)] = snapshot
            self._persist()
            return snapshot

    def remove(self, session_id: str) -> None:
        with self._lock:
            if self._snapshots.pop(str(session_id), None) is not None:
                self._persist()


__all__ = ["ContextUsageLedger", "ContextUsageSnapshot"]
