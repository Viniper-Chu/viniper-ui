"""Persistent daily totals from real Claude Code ``stream-json`` usage frames."""

from __future__ import annotations

import datetime as dt
import json
import os
import threading
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any


SOURCE = "claude-code-stream-json-local"
TOKEN_FIELDS = (
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
)
USAGE_KEYS = {
    "input_tokens": ("input_tokens", "inputTokens"),
    "output_tokens": ("output_tokens", "outputTokens"),
    "cache_creation_input_tokens": (
        "cache_creation_input_tokens",
        "cacheCreationInputTokens",
    ),
    "cache_read_input_tokens": (
        "cache_read_input_tokens",
        "cacheReadInputTokens",
    ),
}


def _has_usage(source: Mapping[str, Any]) -> bool:
    return any(key in source for aliases in USAGE_KEYS.values() for key in aliases)


def _token_count(source: Mapping[str, Any], aliases: tuple[str, ...]) -> int:
    for key in aliases:
        if key not in source:
            continue
        try:
            return max(0, int(source[key] or 0))
        except (TypeError, ValueError):
            return 0
    return 0


def _counts(source: Mapping[str, Any]) -> dict[str, int]:
    return {field: _token_count(source, aliases) for field, aliases in USAGE_KEYS.items()}


def extract_usage(event: Mapping[str, Any]) -> dict[str, int] | None:
    """Extract real token counters from supported top-level stream-json fields.

    ``usage`` is normally the all-model total in Claude Code result frames.
    ``modelUsage`` records are summed across models; when both forms are present,
    the per-field maximum fills partial fields without counting either form twice.
    """

    usage = event.get("usage")
    usage_counts = _counts(usage) if isinstance(usage, Mapping) and _has_usage(usage) else None

    model_usage = event.get("modelUsage")
    if not isinstance(model_usage, Mapping):
        model_usage = event.get("model_usage")
    model_counts: dict[str, int] | None = None
    if isinstance(model_usage, Mapping):
        if _has_usage(model_usage):
            model_counts = _counts(model_usage)
        else:
            totals = {field: 0 for field in TOKEN_FIELDS}
            found = False
            for candidate in model_usage.values():
                if not isinstance(candidate, Mapping) or not _has_usage(candidate):
                    continue
                found = True
                values = _counts(candidate)
                for field in TOKEN_FIELDS:
                    totals[field] += values[field]
            if found:
                model_counts = totals

    if usage_counts is None:
        return model_counts
    if model_counts is None:
        return usage_counts
    return {
        field: max(usage_counts[field], model_counts[field])
        for field in TOKEN_FIELDS
    }


def _default_clock() -> dt.datetime:
    return dt.datetime.now().astimezone()


def _offset_label(value: dt.timedelta | None) -> str:
    total_minutes = int((value or dt.timedelta()).total_seconds() // 60)
    sign = "+" if total_minutes >= 0 else "-"
    hours, minutes = divmod(abs(total_minutes), 60)
    return f"{sign}{hours:02d}:{minutes:02d}"


class DailyUsageLedger:
    """Run-keyed ledger that prevents cumulative frames from being double-counted."""

    def __init__(
        self,
        path: Path,
        *,
        clock: Callable[[], dt.datetime] | None = None,
        timezone: dt.tzinfo | None = None,
    ) -> None:
        self.path = Path(path)
        self._clock = clock or _default_clock
        self._timezone = timezone
        self._lock = threading.RLock()
        self._runs: dict[str, dict[str, Any]] = {}
        self._load()

    def _now(self) -> dt.datetime:
        value = self._clock()
        if not isinstance(value, dt.datetime):
            raise TypeError("daily usage clock must return datetime")
        if value.tzinfo is None:
            value = value.replace(tzinfo=self._timezone) if self._timezone else value.astimezone()
        elif self._timezone is not None:
            value = value.astimezone(self._timezone)
        return value

    def _load(self) -> None:
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        records = payload.get("runs") if isinstance(payload, dict) else None
        if not isinstance(records, dict):
            return
        for run_id, raw in records.items():
            if not isinstance(raw, dict):
                continue
            try:
                day = str(raw.get("date") or "")
                dt.date.fromisoformat(day)
                record = {
                    "run_id": str(run_id),
                    "session_id": str(raw.get("session_id") or ""),
                    "date": day,
                    "first_observed_at": str(raw.get("first_observed_at") or ""),
                    "updated_at": str(raw.get("updated_at") or ""),
                    **{
                        field: max(0, int(raw.get(field) or 0))
                        for field in TOKEN_FIELDS
                    },
                }
            except (TypeError, ValueError):
                continue
            self._runs[str(run_id)] = record

    def _persist(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        payload = {
            "version": 1,
            "source": SOURCE,
            "runs": self._runs,
        }
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, self.path)

    def record_event(
        self,
        run_id: str,
        session_id: str,
        event: Mapping[str, Any],
    ) -> dict[str, Any] | None:
        """Record one usage frame, retaining the per-field maximum for its run."""

        values = extract_usage(event)
        if values is None:
            return None
        local_run_id = str(run_id or "").strip()
        if not local_run_id:
            raise ValueError("run_id is required")
        observed = self._now()
        observed_text = observed.isoformat()
        with self._lock:
            current = self._runs.get(local_run_id)
            is_new = current is None
            if current is None:
                current = {
                    "run_id": local_run_id,
                    "session_id": str(session_id or ""),
                    "date": observed.date().isoformat(),
                    "first_observed_at": observed_text,
                    "updated_at": observed_text,
                    **{field: 0 for field in TOKEN_FIELDS},
                }
            merged = dict(current)
            for field in TOKEN_FIELDS:
                merged[field] = max(int(current.get(field) or 0), values[field])
            changed = is_new or any(
                merged[field] != current.get(field) for field in TOKEN_FIELDS
            )
            if changed:
                merged["updated_at"] = observed_text
                self._runs[local_run_id] = merged
                self._persist()
            return dict(merged)

    def daily(self, days: int = 14) -> dict[str, Any]:
        """Return oldest-to-newest continuous local-date buckets, including zero days."""

        count = max(7, min(90, int(days)))
        now = self._now()
        first_day = now.date() - dt.timedelta(days=count - 1)
        buckets: dict[str, dict[str, Any]] = {}
        for index in range(count):
            day = (first_day + dt.timedelta(days=index)).isoformat()
            buckets[day] = {
                "date": day,
                **{field: 0 for field in TOKEN_FIELDS},
                "total_tokens": 0,
                "run_count": 0,
            }

        with self._lock:
            records = [dict(record) for record in self._runs.values()]
        for record in records:
            bucket = buckets.get(str(record.get("date") or ""))
            if bucket is None:
                continue
            for field in TOKEN_FIELDS:
                bucket[field] += max(0, int(record.get(field) or 0))
            bucket["run_count"] += 1

        for bucket in buckets.values():
            bucket["total_tokens"] = sum(bucket[field] for field in TOKEN_FIELDS)

        totals = {
            field: sum(bucket[field] for bucket in buckets.values())
            for field in TOKEN_FIELDS
        }
        totals["total_tokens"] = sum(totals[field] for field in TOKEN_FIELDS)
        totals["run_count"] = sum(bucket["run_count"] for bucket in buckets.values())
        timezone_payload = {
            "name": now.tzname() or "local",
            "utc_offset": _offset_label(now.utcoffset()),
        }
        return {
            "source": SOURCE,
            "timezone": timezone_payload,
            "days": list(buckets.values()),
            "totals": totals,
            "total_tokens": totals["total_tokens"],
            "run_count": totals["run_count"],
        }


__all__ = ["DailyUsageLedger", "SOURCE", "TOKEN_FIELDS", "extract_usage"]
