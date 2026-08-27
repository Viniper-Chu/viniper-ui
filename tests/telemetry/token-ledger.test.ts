import assert from "node:assert/strict";
import { test } from "node:test";
import { FileStore } from "../../src/platform/persistence/file-store";
import { TokenLedger } from "../../src/features/telemetry/token-ledger";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

test("estimated usage is reconciled in place, survives restart, and stays isolated per Agent session", async () => {
  const outputRoot = join(process.cwd(), "codex", "运行残留");
  await mkdir(outputRoot, { recursive: true });
  const root = await mkdtemp(join(outputRoot, "telemetry-test-"));
  try {
    const store = new FileStore(root);
    const ledger = new TokenLedger(store, () => 100);
    await ledger.initialize();
    await ledger.start("run-a", "session-a", "一段输入");
    ledger.updateEstimate("run-a", { input: 8, cacheHitInput: 0, cacheMissInput: 8, cacheWriteInput: 0, output: 3, reasoning: 0, toolUse: 0, total: 11, source: "estimated" });
    await ledger.reconcile("run-a", { input: 10, cacheHitInput: 6, cacheMissInput: 4, cacheWriteInput: 2, output: 5, reasoning: 2, toolUse: 1, total: 15, source: "provider" });
    await ledger.start("run-b", "session-b", "另一段输入");
    await ledger.finishUnreconciled("run-b");

    const snapshot = ledger.snapshot();
    const first = snapshot.sessions.find((session) => session.sessionId === "session-a")!;
    const second = snapshot.sessions.find((session) => session.sessionId === "session-b")!;
    assert.equal(first.latestRun?.status, "reconciled");
    assert.deepEqual(first.cumulative, { input: 10, cacheHitInput: 6, cacheMissInput: 4, cacheWriteInput: 2, output: 5, reasoning: 2, toolUse: 1, total: 15, source: "provider" });
    assert.equal(second.latestRun?.status, "unreconciled");
    assert.notEqual(first.cumulative.total, second.cumulative.total);

    const restored = new TokenLedger(store);
    await restored.initialize();
    assert.equal(restored.snapshot().sessions.find((session) => session.sessionId === "session-a")?.latestRun?.usage.total, 15);
    assert.equal(restored.snapshot().sessions.find((session) => session.sessionId === "session-b")?.latestRun?.status, "unreconciled");
    assert.equal(restored.snapshot().sessions.filter((session) => ["session-a", "session-b"].includes(session.sessionId)).length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
