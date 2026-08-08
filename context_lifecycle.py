"""Context compression lifecycle and adapter seam.

The lifecycle owns scheduling, per-session de-duplication and result state. It
does not know how a session is persisted; the caller supplies a compare-and-
swap style persistence callback so a stale snapshot cannot replace newer
messages.
"""

from __future__ import annotations

import asyncio
import copy
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Protocol


class ContextAdapterUnavailable(RuntimeError):
    """Raised when an adapter cannot provide a summary in the current runtime."""


class ContextAdapter(Protocol):
    name: str

    def available(self) -> bool:
        ...

    async def summarize(self, messages: list[dict[str, Any]], existing_summary: str) -> str:
        ...


SummaryPersistence = Callable[[str, str, list[dict[str, Any]]], Awaitable[bool] | bool]
SummaryFunction = Callable[[list[dict[str, Any]], str], Awaitable[str] | str]


class NativeContextAdapter:
    """Native Claude Code seam; capability is opt-in until it is observable."""

    name = "native"

    def __init__(self, *, capability: bool = False, summarizer: SummaryFunction | None = None):
        self._capability = bool(capability)
        self._summarizer = summarizer

    def available(self) -> bool:
        return self._capability and self._summarizer is not None

    async def summarize(self, messages: list[dict[str, Any]], existing_summary: str) -> str:
        if not self.available():
            raise ContextAdapterUnavailable("native context compaction capability is unavailable")
        result = self._summarizer(copy.deepcopy(messages), existing_summary)
        if asyncio.iscoroutine(result):
            result = await result
        return str(result or "").strip()


class ExternalSummaryAdapter:
    """Fallback adapter around an explicitly supplied external summarizer."""

    name = "external-summary"

    def __init__(self, summarizer: SummaryFunction):
        self._summarizer = summarizer

    def available(self) -> bool:
        return True

    async def summarize(self, messages: list[dict[str, Any]], existing_summary: str) -> str:
        result = self._summarizer(copy.deepcopy(messages), existing_summary)
        if asyncio.iscoroutine(result):
            result = await result
        summary = str(result or "").strip()
        if not summary:
            raise ContextAdapterUnavailable("summary adapter returned an empty summary")
        return summary


@dataclass
class CompressionResult:
    ok: bool
    compressed: bool = False
    reason: str = ""
    summary: str = ""
    adapter: str = ""
    status: str = "idle"
    deduplicated: bool = False
    stale: bool = False
    revision: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "compressed": self.compressed,
            "reason": self.reason,
            "summary": self.summary[:200],
            "adapter": self.adapter,
            "status": self.status,
            "deduplicated": self.deduplicated,
            "stale": self.stale,
            "revision": self.revision,
        }


@dataclass
class CompressionState:
    status: str = "idle"
    revision: str = ""
    adapter: str = ""
    reason: str = ""


class ContextLifecycle:
    """Run at most one compression for a session revision and preserve CAS."""

    def __init__(
        self,
        native_adapter: ContextAdapter,
        external_adapter: ContextAdapter,
        *,
        threshold: float = 0.65,
    ):
        self.native_adapter = native_adapter
        self.external_adapter = external_adapter
        self.threshold = float(threshold)
        self._tasks: dict[str, asyncio.Task[CompressionResult]] = {}
        self._completed: dict[str, str] = {}
        self._states: dict[str, CompressionState] = {}

    def state(self, session_id: str) -> CompressionState:
        return self._states.setdefault(session_id, CompressionState())

    def _select_adapter(self, external_adapter: ContextAdapter | None = None) -> ContextAdapter:
        if self.native_adapter.available():
            return self.native_adapter
        return external_adapter or self.external_adapter

    async def request(
        self,
        session_id: str,
        revision: str,
        messages: list[dict[str, Any]],
        existing_summary: str,
        usage_ratio: float,
        persist: SummaryPersistence,
        external_adapter: ContextAdapter | None = None,
    ) -> CompressionResult:
        if not messages:
            return CompressionResult(ok=True, reason="no messages", status="idle", revision=revision)
        if usage_ratio < self.threshold:
            return CompressionResult(
                ok=True,
                reason=f"usage {usage_ratio:.3f} below threshold {self.threshold:.3f}",
                status="idle",
                revision=revision,
            )

        previous = self._completed.get(session_id)
        if previous == revision:
            state = self.state(session_id)
            return CompressionResult(
                ok=True,
                reason="revision already compressed",
                status=state.status or "succeeded",
                adapter=state.adapter,
                deduplicated=True,
                revision=revision,
            )

        task = self._tasks.get(session_id)
        if task is not None and not task.done():
            result = await task
            result.deduplicated = True
            return result

        snapshot = copy.deepcopy(messages)
        adapter = self._select_adapter(external_adapter)
        state = self.state(session_id)
        state.status = "scheduled"
        state.revision = revision
        state.adapter = adapter.name
        state.reason = ""
        task = asyncio.create_task(
            self._run(
                session_id,
                revision,
                snapshot,
                existing_summary,
                adapter,
                persist,
            )
        )
        self._tasks[session_id] = task
        return await task

    async def _run(
        self,
        session_id: str,
        revision: str,
        snapshot: list[dict[str, Any]],
        existing_summary: str,
        adapter: ContextAdapter,
        persist: SummaryPersistence,
    ) -> CompressionResult:
        state = self.state(session_id)
        state.status = "running"
        try:
            summary = await adapter.summarize(snapshot, existing_summary)
            if not summary.strip():
                raise ContextAdapterUnavailable("summary adapter returned an empty summary")
            committed = persist(revision, summary, snapshot)
            if asyncio.iscoroutine(committed):
                committed = await committed
            if not committed:
                state.status = "stale"
                state.reason = "context changed while compression was running"
                return CompressionResult(
                    ok=False,
                    reason=state.reason,
                    status=state.status,
                    adapter=adapter.name,
                    stale=True,
                    revision=revision,
                )
            self._completed[session_id] = revision
            state.status = "succeeded"
            state.reason = ""
            return CompressionResult(
                ok=True,
                compressed=True,
                summary=summary,
                status=state.status,
                adapter=adapter.name,
                revision=revision,
            )
        except Exception as exc:
            state.status = "failed"
            state.reason = str(exc)
            return CompressionResult(
                ok=False,
                reason=str(exc),
                status=state.status,
                adapter=adapter.name,
                revision=revision,
            )
        finally:
            current = self._tasks.get(session_id)
            if current is asyncio.current_task():
                self._tasks.pop(session_id, None)
