import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { PRODUCT_VERSION, RuntimeEvent } from "../../src/core/contracts";
import { CoordinationEnvelope } from "../../src/core/coordination-contracts";
import { PersistedExtensionMetadata } from "../../src/core/extension-contracts";
import { ScheduleDefinition, ScheduleHistoryRecord } from "../../src/core/scheduler-contracts";
import { ProviderConnectionSettings } from "../../src/core/security-contracts";
import { RunUsageSnapshot } from "../../src/core/telemetry-contracts";
import { WorkspaceSnapshot } from "../../src/core/programming-contracts";
import { createSessionSnapshot } from "../../src/features/sessions/session-factory";
import { createHarnessApplication } from "../../src/platform/bootstrap/create-harness-application";
import { FileStore } from "../../src/platform/persistence/file-store";
import { SQLiteStore } from "../../src/platform/persistence/sqlite-store";
import { UnavailableSecretVault } from "../../src/platform/security/unavailable-secret-vault";

const outputRoot = join(process.cwd(), "codex", "运行残留");

test("deleted schedule history and a missing target do not block application restart", async () => {
  const root = await freshRoot("sqlite-schedule-target-");
  const options = { dataRoot: root, workingDirectory: root, assetsRoot: process.cwd(), secretVault: new UnavailableSecretVault(), externalScheduleDispatch: true };
  let bundle = await createHarnessApplication(options);
  try {
    const session = await bundle.runtime.createSession(root);
    const draft = { name: "restart", prompt: "do not run", schedule: { kind: "interval" as const, everyMs: 60_000 }, target: { kind: "existing-session" as const, sessionId: session.id } };
    const deleted = await bundle.application.createSchedule(draft) as ScheduleDefinition;
    const active = await bundle.application.createSchedule(draft) as ScheduleDefinition;
    await bundle.application.deleteSchedule(deleted.id);
    assert.equal(await bundle.runtime.deleteSession(session.id), true);
    await bundle.application.dispose();
    bundle = await createHarnessApplication(options);
    const definitions = (await bundle.storage.loadSchedules()).definitions;
    assert.equal(definitions.find(d => d.id === deleted.id)?.status, "deleted");
    const stopped = definitions.find(d => d.id === active.id)!;
    assert.equal(stopped.status, "project-invalid");
    assert.equal(stopped.enabled, false);
    assert.equal(await bundle.application.restoreSchedule(deleted.id), false);
    assert.equal(await bundle.application.setScheduleEnabled(active.id, true), false);
    assert.ok(bundle.runtime.listSessions().length);
  } finally {
    await bundle.application.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("fresh SQLite store creates structured tables and rolls back an orphan event", async () => {
  const root = await freshRoot("sqlite-fresh-");
  try {
    const store = new SQLiteStore(root);
    await store.initialize();
    const database = new DatabaseSync(store.databasePath, { readOnly: true });
    const tables = (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>)
      .map((row) => row.name);
    database.close();
    for (const expected of ["schema_meta", "sessions", "messages", "runs", "events", "coordination", "usage", "provider_settings", "extension_metadata", "file_references", "runtime_leases", "memory_entries", "context_summary_generations", "project_index_snapshots"]) {
      assert.ok(tables.includes(expected), `missing table ${expected}`);
    }

    const session = createSessionSnapshot("D:\\fixture", 100);
    const { events: _events, ...persisted } = session;
    await store.saveSnapshot({ schemaVersion: 3, productVersion: PRODUCT_VERSION, activeSessionId: session.id, sessions: [persisted] });
    const valid: RuntimeEvent = { id: "event-valid", sessionId: session.id, type: "run.started", timestamp: 101, payload: { runId: "run-1" } };
    await store.appendEvent(valid);
    const orphan: RuntimeEvent = { id: "event-orphan", sessionId: "missing-session", type: "run.started", timestamp: 102, payload: { runId: "run-2" } };
    await assert.rejects(store.appendEvent(orphan), /DATA_REFERENCE_MISSING/u);
    const loaded = await store.load();
    assert.equal(loaded?.events.length, 1);
    assert.equal(loaded?.events[0].id, valid.id);
    await store.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an older SQLite schema upgrades in place without creating a second database", async () => {
  const root = await freshRoot("sqlite-upgrade-");
  let store: SQLiteStore | undefined;
  try {
    const databasePath = join(root, "harness.sqlite");
    const legacyDatabase = new DatabaseSync(databasePath);
    legacyDatabase.exec("PRAGMA user_version = 0; CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO schema_meta (key, value) VALUES ('storage_schema_version', '0');");
    legacyDatabase.close();
    store = new SQLiteStore(root);
    await store.initialize();
    const upgraded = new DatabaseSync(databasePath, { readOnly: true });
    const version = (upgraded.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    const sessionsTable = upgraded.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").get();
    upgraded.close();
    assert.equal(version, 2);
    assert.ok(sessionsTable);
    await store.close();
    store = undefined;
  } finally {
    await store?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("SQLite state survives restart across formal application persistence ports", async () => {
  const root = await freshRoot("sqlite-restart-");
  try {
    const first = new SQLiteStore(root);
    await first.initialize();
    const session = createSessionSnapshot("D:\\fixture", 200);
    const { events: _events, ...persisted } = session;
    await first.saveSnapshot({ schemaVersion: 3, productVersion: PRODUCT_VERSION, activeSessionId: session.id, sessions: [persisted] });
    const coordination: CoordinationEnvelope = {
      id: "coord-1", revision: 1, sourceSessionId: session.id, targetSessionId: session.id,
      type: "message", status: "sent", body: "fixture", createdAt: 201, updatedAt: 201,
    };
    const usage: RunUsageSnapshot = {
      runId: "run-1", sessionId: session.id,
      usage: { input: 3, cacheHitInput: null, cacheMissInput: 3, cacheWriteInput: null, output: 2, reasoning: 0, toolUse: 0, total: 5, source: "estimated" },
      status: "estimating", startedAt: 201, updatedAt: 201,
    };
    const schedule: ScheduleDefinition = {
      id: "schedule-1", name: "fixture", prompt: "local", schedule: { kind: "once", runAt: 400 },
      target: { kind: "existing-session", sessionId: session.id }, enabled: true, createdAt: 201, updatedAt: 201,
    };
    const history: ScheduleHistoryRecord = { id: "history-1", scheduleId: schedule.id, sessionId: session.id, triggeredAt: 202, source: "manual", status: "accepted", detail: "ok" };
    const extensions: PersistedExtensionMetadata = { enabledSkillsBySession: { [session.id]: ["built-in.skill"] } };
    const settings: ProviderConnectionSettings = { schemaVersion: 2, profiles: {} };
    await first.appendCoordination(coordination);
    await first.appendUsage(usage);
    await first.saveSchedules([schedule]);
    await first.appendScheduleHistory(history);
    await first.saveExtensionMetadata(extensions);
    await first.saveProviderSettings(settings);
    await first.saveSecretReferences([{ id: "provider.demo.api-key", configured: true, updatedAt: 203 }]);
    await first.saveTrustedProjectRoots(["D:\\fixture"]);
    await first.close();

    const second = new SQLiteStore(root);
    await second.initialize();
    assert.equal((await second.load())?.application.sessions[0].id, session.id);
    assert.deepEqual(await second.loadCoordination(), [coordination]);
    assert.deepEqual(await second.loadUsage(), [usage]);
    assert.deepEqual((await second.loadSchedules()).definitions, [schedule]);
    assert.deepEqual((await second.loadSchedules()).history, [history]);
    assert.deepEqual(await second.loadExtensionMetadata(), extensions);
    assert.deepEqual(await second.loadProviderSettings(), settings);
    assert.deepEqual(await second.loadSecretReferences(), [{ id: "provider.demo.api-key", configured: true, updatedAt: 203 }]);
    assert.deepEqual(await second.loadTrustedProjectRoots(), ["D:\\fixture"]);
    await second.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SQLite coordination revisions upsert one current row without losing its sequence", async () => {
  const root = await freshRoot("sqlite-coordination-revision-");
  let store: SQLiteStore | undefined;
  try {
    store = new SQLiteStore(root);
    await store.initialize();
    const source = createSessionSnapshot("D:\\source-fixture", 300);
    const target = createSessionSnapshot("D:\\target-fixture", 301);
    const snapshots = [source, target].map(({ events: _events, ...persisted }) => persisted);
    await store.saveSnapshot({ schemaVersion: 3, productVersion: PRODUCT_VERSION, activeSessionId: source.id, sessions: snapshots });

    const sent: CoordinationEnvelope = {
      id: "coord-revision-1", revision: 1, sourceSessionId: source.id, targetSessionId: target.id,
      type: "delegation", status: "sent", body: "revision-1", createdAt: 300, updatedAt: 300,
    };
    const delivered = { ...sent, revision: 2, status: "delivered" as const, body: "revision-2", updatedAt: 301 };
    const completed = { ...delivered, revision: 3, status: "completed" as const, body: "revision-3", updatedAt: 302 };
    await store.appendCoordination(sent);

    const database = new DatabaseSync(store.databasePath, { readOnly: true });
    const firstRow = database.prepare("SELECT sequence_no FROM coordination WHERE id = ?").get(sent.id) as { sequence_no: number };
    database.close();

    await store.appendCoordination(delivered);
    await store.appendCoordination(completed);
    const loaded = await store.loadCoordination();
    assert.deepEqual(loaded, [completed]);

    const finalDatabase = new DatabaseSync(store.databasePath, { readOnly: true });
    const rows = finalDatabase.prepare("SELECT sequence_no, source_session_id, target_session_id, type, status, payload_json FROM coordination WHERE id = ?").all(sent.id) as Array<{
      sequence_no: number;
      source_session_id: string;
      target_session_id: string;
      type: string;
      status: string;
      payload_json: string;
    }>;
    finalDatabase.close();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sequence_no, firstRow.sequence_no);
    assert.equal(rows[0].source_session_id, source.id);
    assert.equal(rows[0].target_session_id, target.id);
    assert.equal(rows[0].type, "delegation");
    assert.equal(rows[0].status, "completed");
    assert.deepEqual(JSON.parse(rows[0].payload_json), completed);
  } finally {
    await store?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("schema v1/v2/v3 legacy data imports idempotently with one rollback copy", async () => {
  for (const version of [1, 2, 3] as const) {
    const root = await freshRoot(`sqlite-migrate-v${version}-`);
    try {
      await writeLegacyFixture(root, version);
      const before = await readFile(join(root, "sessions.json"), "utf8");
      const first = new SQLiteStore(root);
      await first.initialize();
      const loaded = await first.load();
      assert.equal(loaded?.application.schemaVersion, 3);
      assert.equal(loaded?.application.sessions[0].messages[0].text, `legacy-${version}`);
      assert.equal(loaded?.events[0].id, `legacy-event-${version}`);
      assert.equal((await first.loadWorkspaces())[0].id, `legacy-workspace-${version}`);
      await first.close();
      const rollbackRoots = (await readdir(join(root, "migration-rollback"), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory());
      assert.equal(rollbackRoots.length, 1);
      assert.equal(await readFile(join(root, "sessions.json"), "utf8"), before);

      const second = new SQLiteStore(root);
      await second.initialize();
      assert.equal((await second.load())?.events.length, 1);
      await second.close();
      const rollbackRootsAfterRestart = (await readdir(join(root, "migration-rollback"), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory());
      assert.equal(rollbackRootsAfterRestart.length, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("migration failure keeps legacy files authoritative and interrupted import recovers", async () => {
  const root = await freshRoot("sqlite-migrate-failure-");
  try {
    await writeLegacyFixture(root, 3);
    const snapshotPath = join(root, "sessions.json");
    const before = await readFile(snapshotPath, "utf8");
    const failed = new SQLiteStore(root, { migrationFailure: "after-import" });
    await assert.rejects(failed.initialize(), /MIGRATION_INTERRUPTED/u);
    assert.equal(await readFile(snapshotPath, "utf8"), before);
    assert.equal(await fileExists(join(root, "harness.sqlite")), false);

    const recovered = new SQLiteStore(root);
    await recovered.initialize();
    assert.equal((await recovered.load())?.events[0].id, "legacy-event-3");
    await recovered.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing legacy association aborts migration without creating an empty database", async () => {
  const root = await freshRoot("sqlite-migrate-reference-");
  try {
    await writeLegacyFixture(root, 3);
    await writeFile(join(root, "events.ndjson"), JSON.stringify({
      id: "orphan", sessionId: "no-such-session", type: "run.started", timestamp: 1, payload: {},
    }) + "\n", "utf8");
    const store = new SQLiteStore(root);
    await assert.rejects(store.initialize(), /DATA_REFERENCE_MISSING/u);
    assert.equal(await fileExists(join(root, "harness.sqlite")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("provider and secret reference persistence never stores secret plaintext", async () => {
  const root = await freshRoot("sqlite-secret-");
  try {
    const store = new SQLiteStore(root);
    await store.initialize();
    await store.saveProviderSettings({ schemaVersion: 2, profiles: {} });
    await store.saveSecretReferences([{ id: "provider.demo.api-key", configured: true, updatedAt: 1 }]);
    await store.close();
    const raw = (await readFile(join(root, "harness.sqlite"))).toString("utf8");
    assert.equal(raw.includes("secret-plaintext-must-not-persist"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("snapshot replacement removes an explicitly deleted session without resurrecting it on restart", async () => {
  const root = await freshRoot("sqlite-delete-");
  try {
    const store = new SQLiteStore(root);
    await store.initialize();
    const first = createSessionSnapshot("D:\\one", 1);
    const second = createSessionSnapshot("D:\\two", 2);
    const { events: ignoredFirst, ...persistedFirst } = first;
    const { events: ignoredSecond, ...persistedSecond } = second;
    await store.saveSnapshot({ schemaVersion: 3, productVersion: PRODUCT_VERSION, activeSessionId: first.id, sessions: [persistedFirst, persistedSecond] });
    await store.appendEvent({ id: "delete-event", sessionId: second.id, type: "run.completed", timestamp: 3, payload: { runId: "delete-run" } });
    await store.saveSnapshot({ schemaVersion: 3, productVersion: PRODUCT_VERSION, activeSessionId: first.id, sessions: [persistedFirst] });
    assert.deepEqual((await store.load())?.application.sessions.map((session) => session.id), [first.id]);
    await store.close();
    const restarted = new SQLiteStore(root);
    await restarted.initialize();
    assert.deepEqual((await restarted.load())?.application.sessions.map((session) => session.id), [first.id]);
    assert.deepEqual((await restarted.load())?.events, []);
    await restarted.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop and CLI application consumers share SQLite without a second JSON truth", async () => {
  const root = await freshRoot("sqlite-application-");
  try {
    const first = await createHarnessApplication({
      dataRoot: root,
      workingDirectory: process.cwd(),
      assetsRoot: process.cwd(),
      secretVault: new UnavailableSecretVault(),
      demoDelayMs: 1,
    });
    const created = await first.application.createSession();
    const firstSnapshot = first.application.snapshot();
    assert.equal(firstSnapshot.sessions.some((session) => session.id === (created as { id: string }).id), true);
    assert.equal(await fileExists(join(root, "sessions.json")), false);
    assert.equal(await fileExists(join(root, "events.ndjson")), false);
    await first.application.dispose();

    const second = await createHarnessApplication({
      dataRoot: root,
      workingDirectory: process.cwd(),
      assetsRoot: process.cwd(),
      secretVault: new UnavailableSecretVault(),
      demoDelayMs: 1,
    });
    assert.equal(second.application.snapshot().sessions.length, firstSnapshot.sessions.length);
    assert.equal(second.application.snapshot().sessions.some((session) => session.id === (created as { id: string }).id), true);
    await second.application.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeLegacyFixture(root: string, version: 1 | 2 | 3): Promise<void> {
  const legacy = new FileStore(root);
  const session = createSessionSnapshot("D:\\legacy-fixture", 100 + version);
  const { events: _events, ...persisted } = session;
  const base = {
    ...persisted,
    messages: [{ id: `legacy-message-${version}`, role: "user" as const, text: `legacy-${version}`, createdAt: 101, status: "completed" as const }],
  };
  const application = version === 1
    ? {
      schemaVersion: 1 as const, productVersion: PRODUCT_VERSION, activeSessionId: session.id, sessions: [{
        ...base, selectedProviderId: undefined, cachePlan: { ...base.cachePlan, profileGeneration: undefined, stableSegments: base.cachePlan.stableSegments.map((segment) => ({ ...segment, name: segment.name === "tool-schemas" ? "tool-contract" : segment.name })) },
      }],
    }
    : version === 2
      ? { schemaVersion: 2 as const, productVersion: PRODUCT_VERSION, activeSessionId: session.id, sessions: [{ ...base, providerHistory: undefined }] }
      : { schemaVersion: 3 as const, productVersion: PRODUCT_VERSION, activeSessionId: session.id, sessions: [base] };
  await mkdir(root, { recursive: true });
  await writeFile(legacy.snapshotPath, JSON.stringify(application), "utf8");
  await writeFile(legacy.eventJournalPath, JSON.stringify({ id: `legacy-event-${version}`, sessionId: session.id, type: "run.completed", timestamp: 102, payload: { runId: `run-${version}` } }) + "\n", "utf8");
  const workspace: WorkspaceSnapshot = {
    id: `legacy-workspace-${version}`,
    runId: `run-${version}`,
    projectRoot: "D:\\legacy-fixture",
    root: "D:\\legacy-fixture",
    mode: "shared",
    status: "retained",
    ownedPaths: [],
    checksPassed: false,
    mergeStatus: "not-requested",
    reason: "legacy",
    createdAt: 101,
    updatedAt: 102,
  };
  await mkdir(join(root, "workspaces"), { recursive: true });
  await writeFile(join(root, "workspaces", "records.json"), JSON.stringify([workspace]), "utf8");
}

async function freshRoot(prefix: string): Promise<string> {
  await mkdir(outputRoot, { recursive: true });
  return mkdtemp(join(outputRoot, prefix));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
