"""Synthetic S2 checks for adapter choice, de-duplication and CAS behavior."""

from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from context_lifecycle import (  # noqa: E402
    ContextLifecycle,
    ExternalSummaryAdapter,
    NativeContextAdapter,
)


class FakeAdapter:
    def __init__(self, name: str, available: bool = True, summary: str = "fake summary", error: Exception | None = None):
        self.name = name
        self._available = available
        self.summary = summary
        self.error = error
        self.calls = 0

    def available(self) -> bool:
        return self._available

    async def summarize(self, messages, existing_summary):
        self.calls += 1
        if self.error:
            raise self.error
        return self.summary


class SlowFakeAdapter(FakeAdapter):
    def __init__(self):
        super().__init__("external-summary")
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def summarize(self, messages, existing_summary):
        self.calls += 1
        self.started.set()
        await self.release.wait()
        return self.summary


class ContextLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_native_adapter_is_selected_when_capability_is_observable(self) -> None:
        native = FakeAdapter("native")
        external = FakeAdapter("external-summary")
        lifecycle = ContextLifecycle(native, external)
        persisted = []

        async def persist(revision, summary, snapshot):
            persisted.append((revision, summary, snapshot))
            return True

        result = await lifecycle.request("session-a", "r1", [{"role": "user", "content": "old"}], "", 0.9, persist)
        self.assertTrue(result.ok)
        self.assertEqual(result.adapter, "native")
        self.assertEqual(native.calls, 1)
        self.assertEqual(external.calls, 0)
        self.assertEqual(persisted[0][0], "r1")

    async def test_native_unavailable_falls_back_to_external(self) -> None:
        native = NativeContextAdapter()
        external = FakeAdapter("external-summary")
        lifecycle = ContextLifecycle(native, external)
        result = await lifecycle.request("session-a", "r1", [{"role": "user", "content": "old"}], "", 0.9, lambda *_: True)
        self.assertTrue(result.ok)
        self.assertEqual(result.adapter, "external-summary")
        self.assertEqual(external.calls, 1)

    async def test_below_threshold_does_not_call_provider(self) -> None:
        native = FakeAdapter("native")
        external = FakeAdapter("external-summary")
        lifecycle = ContextLifecycle(native, external)
        result = await lifecycle.request("session-a", "r1", [{"role": "user", "content": "short"}], "", 0.2, lambda *_: True)
        self.assertTrue(result.ok)
        self.assertFalse(result.compressed)
        self.assertEqual(native.calls, 0)
        self.assertEqual(external.calls, 0)

    async def test_concurrent_same_revision_is_one_call(self) -> None:
        adapter = SlowFakeAdapter()
        lifecycle = ContextLifecycle(NativeContextAdapter(), adapter)
        persist_calls = []

        async def persist(revision, summary, snapshot):
            persist_calls.append(revision)
            return True

        first = asyncio.create_task(
            lifecycle.request("session-a", "r1", [{"role": "user", "content": "old"}], "", 0.9, persist)
        )
        await adapter.started.wait()
        second = asyncio.create_task(
            lifecycle.request("session-a", "r1", [{"role": "user", "content": "old"}], "", 0.9, persist)
        )
        await asyncio.sleep(0)
        adapter.release.set()
        first_result, second_result = await asyncio.gather(first, second)
        self.assertTrue(first_result.ok)
        self.assertTrue(second_result.ok)
        self.assertTrue(second_result.deduplicated)
        self.assertEqual(adapter.calls, 1)
        self.assertEqual(persist_calls, ["r1"])

    async def test_stale_revision_does_not_commit(self) -> None:
        source = [{"role": "user", "content": "newer message"}]
        adapter = FakeAdapter("external-summary")
        lifecycle = ContextLifecycle(NativeContextAdapter(), adapter)
        result = await lifecycle.request("session-a", "old-revision", source, "", 0.9, lambda *_: False)
        self.assertFalse(result.ok)
        self.assertTrue(result.stale)
        self.assertEqual(source[0]["content"], "newer message")

    async def test_failed_summary_preserves_source_and_can_retry(self) -> None:
        source = [{"role": "user", "content": "keep me"}]
        failing = FakeAdapter("external-summary", error=RuntimeError("provider unavailable"))
        lifecycle = ContextLifecycle(NativeContextAdapter(), failing)
        failed = await lifecycle.request("session-a", "r1", source, "", 0.9, lambda *_: True)
        self.assertFalse(failed.ok)
        self.assertEqual(source[0]["content"], "keep me")

        succeeding = FakeAdapter("external-summary", summary="retry summary")
        retried = await lifecycle.request(
            "session-a",
            "r1",
            source,
            "",
            0.9,
            lambda *_: True,
            external_adapter=ExternalSummaryAdapter(succeeding.summarize),
        )
        self.assertTrue(retried.ok)
        self.assertEqual(succeeding.calls, 1)


if __name__ == "__main__":
    unittest.main()
