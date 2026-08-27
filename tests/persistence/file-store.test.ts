import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { PRODUCT_VERSION, RuntimeEvent } from "../../src/core/contracts";
import { createSessionSnapshot } from "../../src/features/sessions/session-factory";
import { FileStore } from "../../src/platform/persistence/file-store";

test("file storage separates session snapshot from append-only event journal", async () => {
  const outputRoot = join(process.cwd(), "codex", "运行残留");
  await mkdir(outputRoot, { recursive: true });
  const root = await mkdtemp(join(outputRoot, "persistence-test-"));
  try {
    const store = new FileStore(root);
    const { events: _events, ...session } = createSessionSnapshot("D:\\Agent", 100);
    await store.saveSnapshot({ schemaVersion: 3, productVersion: PRODUCT_VERSION, activeSessionId: session.id, sessions: [session] });
    const event: RuntimeEvent = { id: "e1", sessionId: session.id, type: "run.started", timestamp: 101, payload: { runId: "r1" } };
    await store.appendEvent(event);

    const loaded = await store.load();
    assert.equal(loaded?.application.sessions[0].workingDirectory, "D:\\Agent");
    assert.equal(Object.prototype.hasOwnProperty.call(loaded?.application.sessions[0] ?? {}, "mode"), false);
    assert.equal(loaded?.events[0].id, "e1");
    assert.equal((await readFile(store.eventJournalPath, "utf8")).trim().split(/\r?\n/u).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("schema v1 Preview sessions migrate forward without losing conversation data", async () => {
  const outputRoot = join(process.cwd(), "codex", "运行残留");
  await mkdir(outputRoot, { recursive: true });
  const root = await mkdtemp(join(outputRoot, "migration-test-"));
  try {
    const store = new FileStore(root);
    const { events: _events, selectedProviderId: _provider, ...session } = createSessionSnapshot("D:\\Agent", 100);
    const { profileGeneration: _generation, ...cachePlan } = session.cachePlan;
    await writeFile(store.snapshotPath, JSON.stringify({
      schemaVersion: 1,
      productVersion: PRODUCT_VERSION,
      activeSessionId: session.id,
      sessions: [{
        ...session,
        title: "Phase 1 恢复",
        messages: [{ id: "m1", role: "user", text: "保留内容", createdAt: 101, status: "completed" }],
        cachePlan: {
          ...cachePlan,
          stableSegments: cachePlan.stableSegments
            .filter((segment) => segment.name !== "skills")
            .map((segment) => ({ ...segment, name: segment.name === "tool-schemas" ? "tool-contract" : segment.name })),
        },
      }],
    }), "utf8");
    const loaded = await store.load();
    assert.equal(loaded?.application.schemaVersion, 3);
    assert.equal(loaded?.application.sessions[0].selectedProviderId, "demo");
    assert.equal(loaded?.application.sessions[0].cachePlan.profileGeneration, 1);
    assert.equal(loaded?.application.sessions[0].messages[0].text, "保留内容");
    assert.equal(loaded?.application.sessions[0].providerHistory[0].items[0].type, "text");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy shell sessions map does not enter the Runtime snapshot migrator", async () => {
  const outputRoot = join(process.cwd(), "codex", "运行残留");
  await mkdir(outputRoot, { recursive: true });
  const root = await mkdtemp(join(outputRoot, "legacy-shell-snapshot-test-"));
  try {
    const store = new FileStore(root);
    await writeFile(store.snapshotPath, JSON.stringify({
      "4b5e0dea": { mode: "viniper", messages: [] },
    }), "utf8");
    assert.equal(await store.load(), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
