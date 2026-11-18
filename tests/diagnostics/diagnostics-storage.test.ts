import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DiagnosticsService, type DiagnosticsPersistence } from "../../src/features/diagnostics/diagnostics-service";
import { SQLiteStore } from "../../src/platform/persistence/sqlite-store";
import type { DiagnosticEntry } from "../../src/core/cp7-contracts";

test("recent diagnostics span legacy and appended rows; exports survive a restart and a failed append", async () => {
  const root = await mkdtemp(join(tmpdir(), "diagnostics-history-"));
  const store = new SQLiteStore(root);
  try {
    await store.initialize();
    const legacy: DiagnosticEntry[] = Array.from({length: 120}, (_, timestamp) => ({
      timestamp, code: "run.started", level: "info", runId: timestamp % 2 ? "odd" : "even",
    }));
    await store.saveSetting("cp7.diagnostics", legacy);
    let fail = false;
    const writes: number[] = [];
    const persistence: DiagnosticsPersistence = {
      read: (limit, runId) => store.readDiagnosticEntries(limit, runId),
      count: () => store.countDiagnosticEntries(),
      append: entries => {
        writes.push(entries.length);
        if (fail) throw new Error("store busy");
        store.appendDiagnosticEntries(entries);
      },
    };
    const service = new DiagnosticsService({persistence});
    await service.initialize();
    fail = true;
    service.record({timestamp: 120, code: "run.started", runId: "even"});
    assert.equal(service.snapshot(0).persistenceError, "store busy");
    assert.equal(service.previewExport("even").fields.at(-1)?.timestamp, 120);
    fail = false;
    service.record({timestamp: 121, code: "run.started", runId: "odd"});
    await service.flush();
    assert.deepEqual(writes, [1, 2]);
    assert.equal(service.snapshot(100).totalEntries, 122);
    assert.equal(service.snapshot(100).entries[0].timestamp, 22);
    assert.equal(service.snapshot(110).entries[0].timestamp, 12);
    assert.equal(service.snapshot(0).persistenceError, undefined);
    assert.deepEqual(await store.loadSetting("cp7.diagnostics"), legacy);
    await store.close(); await store.initialize();
    const restored = new DiagnosticsService({persistence});
    await restored.initialize();
    assert.deepEqual(restored.snapshot(100), service.snapshot(100));
    assert.deepEqual(restored.previewExport("even").fields.map(e => e.timestamp),
      Array.from({length: 61}, (_, i) => i * 2));
    assert.equal(restored.previewExport().fields.length, 122);
  } finally {
    await store.close(); await rm(root, {recursive: true, force: true});
  }
});
