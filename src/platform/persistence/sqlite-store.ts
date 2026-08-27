import { copyFile, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, relative } from "node:path";
import { CoordinationEnvelope } from "../../core/coordination-contracts";
import {
  PersistedApplication,
  PersistedSessionSnapshot,
  RuntimeEvent,
  PRODUCT_VERSION,
} from "../../core/contracts";
import { PersistedExtensionMetadata } from "../../core/extension-contracts";
import {
  CoordinationPersistence,
  ExtensionPersistence,
  PermissionAccessPersistence,
  ProviderSettingsPersistence,
  RuntimePersistence,
  RuntimeCommitReceipt,
  Phase8Cp3Persistence,
  ArtifactPersistence,
  SchedulerPersistence,
  SecretReferencePersistence,
  TelemetryPersistence,
  WorkspacePersistence,
  LocalModelPersistence,
} from "../../core/ports";
import { ScheduleDefinition, ScheduleHistoryRecord } from "../../core/scheduler-contracts";
import { LegacyProviderConnectionSettings, ProviderConnectionSettings, SecretReference } from "../../core/security-contracts";
import { RunUsageSnapshot } from "../../core/telemetry-contracts";
import { WorkspaceSnapshot } from "../../core/programming-contracts";
import { MemoryEntry } from "../../core/memory-contracts";
import { ContextSummaryGeneration } from "../../core/compaction-contracts";
import { ProjectIndexSnapshot } from "../../core/project-index-contracts";
import { RoutingSnapshot } from "../../core/routing-contracts";
import { ManagedArtifactRecord } from "../../core/artifact-contracts";
import { FileStore } from "./file-store";
import { LocalModelRecord } from "../../core/local-model-contracts";

export type MigrationFailurePoint = "after-copy" | "after-import";

export interface SQLiteStoreOptions {
  migrationFailure?: MigrationFailurePoint;
}

type DatabaseRow = Record<string, unknown>;

interface LegacyData {
  application: PersistedApplication | null;
  events: RuntimeEvent[];
  coordination: CoordinationEnvelope[];
  usage: RunUsageSnapshot[];
  schedules: { definitions: ScheduleDefinition[]; history: ScheduleHistoryRecord[] };
  extensions: PersistedExtensionMetadata;
  secretReferences: SecretReference[];
  providerSettings: ProviderConnectionSettings | LegacyProviderConnectionSettings | null;
  trustedProjects: string[];
  workspaces: WorkspaceSnapshot[];
}

const STORAGE_SCHEMA_VERSION = 2;
const LEGACY_RELATIVE_PATHS = [
  "sessions.json",
  "events.ndjson",
  "coordination.ndjson",
  "usage.ndjson",
  "schedules.json",
  "schedule-history.ndjson",
  "extensions.json",
  "secret-references.json",
  "provider-settings.json",
  "trusted-projects.json",
  "workspaces/records.json",
] as const;

export class SQLiteStoreError extends Error {}

/**
 * The single structured persistence implementation used by the application
 * bootstrap.  Large output files remain outside this class; this store keeps
 * their relative references and lifecycle metadata only.
 */
export class SQLiteStore implements RuntimePersistence, CoordinationPersistence, TelemetryPersistence,
  SchedulerPersistence, ExtensionPersistence, SecretReferencePersistence, ProviderSettingsPersistence,
  PermissionAccessPersistence, WorkspacePersistence, Phase8Cp3Persistence, ArtifactPersistence, LocalModelPersistence {
  readonly databasePath: string;
  readonly rollbackRoot: string;
  private readonly stagePath: string;
  private database?: DatabaseSync;
  private initialized = false;

  constructor(
    private readonly rootDir: string,
    private readonly options: SQLiteStoreOptions = {},
  ) {
    this.databasePath = join(rootDir, "harness.sqlite");
    this.stagePath = `${this.databasePath}.migration`;
    this.rollbackRoot = join(rootDir, "migration-rollback");
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.rootDir, { recursive: true });
    if (await fileExists(this.databasePath)) {
      await removeIfExists(this.stagePath);
      this.database = openDatabase(this.databasePath);
      ensureSchema(this.database);
      this.initialized = true;
      return;
    }

    const legacyPaths = await existingLegacyPaths(this.rootDir);
    if (legacyPaths.length > 0) {
      await this.migrateLegacy(legacyPaths);
      return;
    }

    this.database = openDatabase(this.databasePath);
    ensureSchema(this.database);
    this.initialized = true;
  }

  async close(): Promise<void> {
    if (!this.database) return;
    this.database.close();
    this.database = undefined;
    this.initialized = false;
  }

  async load(): Promise<{ application: PersistedApplication; events: RuntimeEvent[] } | null> {
    const database = this.requiredDatabase();
    const sessionRows = database.prepare("SELECT * FROM sessions ORDER BY created_at, session_id").all() as DatabaseRow[];
    if (sessionRows.length === 0) return null;
    const messageRows = database.prepare("SELECT * FROM messages ORDER BY session_id, sequence_no").all() as DatabaseRow[];
    const historyRows = database.prepare("SELECT * FROM provider_history ORDER BY session_id, sequence_no").all() as DatabaseRow[];
    const queueRows = database.prepare("SELECT * FROM queue_items ORDER BY session_id, sequence_no").all() as DatabaseRow[];
    const messagesBySession = groupRows(messageRows, "session_id");
    const historyBySession = groupRows(historyRows, "session_id");
    const queueBySession = groupRows(queueRows, "session_id");
    const sessions = sessionRows.map((row) => {
      const payload = parseJson<PersistedSessionSnapshot>(row.payload_json, "sessions.payload_json");
      return {
        ...payload,
        messages: (messagesBySession.get(stringValue(row.session_id)) ?? []).map((item) => parseJson(item.payload_json, "messages.payload_json")),
        providerHistory: (historyBySession.get(stringValue(row.session_id)) ?? []).map((item) => parseJson(item.payload_json, "provider_history.payload_json")),
        queue: (queueBySession.get(stringValue(row.session_id)) ?? []).map((item) => parseJson(item.payload_json, "queue_items.payload_json")),
      } as PersistedSessionSnapshot;
    });
    const state = database.prepare("SELECT active_session_id FROM app_state WHERE id = 1").get() as DatabaseRow | undefined;
    if (!state || typeof state.active_session_id !== "string" || !state.active_session_id) {
      throw new SQLiteStoreError("STORAGE_CORRUPT: app_state.active_session_id is missing");
    }
    const sessionEngines = new Map(sessions.map((session) => [session.id, session.engineId === "claude-code" ? "claude-code" as const : "viniper" as const]));
    const events = (database.prepare("SELECT sequence_no, id, engine_id, session_id, run_id, item_id, type, timestamp, payload_json FROM events ORDER BY sequence_no").all() as DatabaseRow[])
      .map((row) => ({
        sequence: numberValue(row.sequence_no),
        id: stringValue(row.id),
        engineId: row.engine_id === "claude-code" ? "claude-code" as const : sessionEngines.get(stringValue(row.session_id)) ?? "viniper" as const,
        sessionId: stringValue(row.session_id),
        threadId: stringValue(row.session_id),
        ...(typeof row.run_id === "string" && row.run_id ? { turnId: row.run_id } : {}),
        ...(typeof row.item_id === "string" && row.item_id ? { itemId: row.item_id } : {}),
        type: row.type as RuntimeEvent["type"],
        timestamp: numberValue(row.timestamp),
        payload: parseJson(row.payload_json, "events.payload_json"),
      }));
    return {
      application: {
        schemaVersion: 3,
        productVersion: PRODUCT_VERSION,
        activeSessionId: stringValue(state.active_session_id),
        sessions,
      },
      events,
    };
  }

  async saveSnapshot(application: PersistedApplication): Promise<void> {
    const database = this.requiredDatabase();
    inTransaction(database, () => {
      const keep = new Set(application.sessions.map((session) => session.id));
      const existing = database.prepare("SELECT session_id FROM sessions").all() as DatabaseRow[];
      for (const row of existing) {
        const sessionId = stringValue(row.session_id);
        if (keep.has(sessionId)) continue;
        database.prepare("DELETE FROM coordination WHERE source_session_id = ? OR target_session_id = ?").run(sessionId, sessionId);
        database.prepare("DELETE FROM usage WHERE session_id = ?").run(sessionId);
        database.prepare("DELETE FROM recovery_checkpoints WHERE session_id = ?").run(sessionId);
        database.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
      }
      database.prepare("INSERT INTO app_state (id, product_version, active_session_id) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET product_version = excluded.product_version, active_session_id = excluded.active_session_id")
        .run(application.productVersion, application.activeSessionId);
      for (const session of application.sessions) saveSession(database, session);
    });
  }

  async appendEvent(event: RuntimeEvent): Promise<void> {
    const database = this.requiredDatabase();
    inTransaction(database, () => {
      insertEvent(database, event);
      updateRunProjection(database, event);
    });
  }

  async commitEvent(event: RuntimeEvent, application: PersistedApplication): Promise<RuntimeCommitReceipt> {
    const database = this.requiredDatabase();
    return inTransaction(database, () => {
      const existing = database.prepare("SELECT sequence_no, engine_id, session_id, run_id, item_id, type, timestamp, payload_json FROM events WHERE id = ?").get(event.id) as DatabaseRow | undefined;
      if (existing) return { event: eventFromRow(event.id, existing), duplicate: true };
      const committed = insertEvent(database, event);
      saveApplication(database, {
        ...application,
        sessions: application.sessions.map((session) => session.id === committed.sessionId
          ? { ...session, replayCursor: committed.sequence ?? session.replayCursor }
          : session),
      });
      updateRunProjection(database, committed);
      return { event: committed, duplicate: false };
    });
  }

  async loadMemoryEntries(): Promise<MemoryEntry[]> {
    return this.rows("SELECT payload_json FROM memory_entries ORDER BY created_at")
      .map((row) => parseJson<MemoryEntry>(row.payload_json, "memory_entries.payload_json"));
  }

  async saveMemoryEntries(entries: MemoryEntry[]): Promise<void> {
    const database = this.requiredDatabase();
    inTransaction(database, () => {
      database.exec("DELETE FROM memory_entries");
      const statement = database.prepare("INSERT INTO memory_entries (id, scope, status, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
      for (const entry of entries) statement.run(entry.id, entry.scope, entry.status, JSON.stringify(entry), entry.createdAt, entry.updatedAt);
    });
  }

  async loadRoutingSnapshot(): Promise<RoutingSnapshot | null> {
    const row = this.requiredDatabase().prepare("SELECT value_json FROM settings WHERE key = 'cp3.routing'").get() as DatabaseRow | undefined;
    return row ? parseJson<RoutingSnapshot>(row.value_json, "settings.cp3.routing") : null;
  }

  async saveRoutingSnapshot(snapshot: RoutingSnapshot): Promise<void> {
    const database = this.requiredDatabase();
    database.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES ('cp3.routing', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at")
      .run(JSON.stringify(snapshot), Date.now());
  }

  async loadCompactionGenerations(): Promise<ContextSummaryGeneration[]> {
    return this.rows("SELECT payload_json FROM context_summary_generations ORDER BY created_at")
      .map((row) => parseJson<ContextSummaryGeneration>(row.payload_json, "context_summary_generations.payload_json"));
  }

  async saveCompactionGeneration(generation: ContextSummaryGeneration): Promise<void> {
    this.requiredDatabase().prepare("INSERT INTO context_summary_generations (id, session_id, created_at, payload_json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING")
      .run(generation.id, generation.sessionId, generation.createdAt, JSON.stringify(generation));
  }

  async loadProjectIndexSnapshots(): Promise<ProjectIndexSnapshot[]> {
    return this.rows("SELECT payload_json FROM project_index_snapshots ORDER BY revision")
      .map((row) => parseJson<ProjectIndexSnapshot>(row.payload_json, "project_index_snapshots.payload_json"));
  }

  async saveProjectIndexSnapshot(snapshot: ProjectIndexSnapshot): Promise<void> {
    const id = snapshot.projectRoot ?? "disabled";
    this.requiredDatabase().prepare("INSERT INTO project_index_snapshots (id, project_root, revision, payload_json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET project_root = excluded.project_root, revision = excluded.revision, payload_json = excluded.payload_json")
      .run(id, snapshot.projectRoot ?? null, snapshot.revision, JSON.stringify(snapshot));
  }

  async loadCoordination(): Promise<CoordinationEnvelope[]> {
    return this.rows("SELECT payload_json FROM coordination ORDER BY sequence_no")
      .map((row) => parseJson<CoordinationEnvelope>(row.payload_json, "coordination.payload_json"));
  }

  async appendCoordination(envelope: CoordinationEnvelope): Promise<void> {
    const database = this.requiredDatabase();
    inTransaction(database, () => {
      insertCoordination(database, envelope);
    });
  }

  async loadUsage(): Promise<RunUsageSnapshot[]> {
    return this.rows("SELECT payload_json FROM usage ORDER BY sequence_no")
      .map((row) => parseJson<RunUsageSnapshot>(row.payload_json, "usage.payload_json"));
  }

  async appendUsage(usage: RunUsageSnapshot): Promise<void> {
    const database = this.requiredDatabase();
    inTransaction(database, () => {
      insertUsage(database, usage);
    });
  }

  async loadSchedules(): Promise<{ definitions: ScheduleDefinition[]; history: ScheduleHistoryRecord[] }> {
    return {
      definitions: this.rows("SELECT payload_json FROM schedules ORDER BY created_at").map((row) => parseJson<ScheduleDefinition>(row.payload_json, "schedules.payload_json")),
      history: this.rows("SELECT payload_json FROM schedule_history ORDER BY sequence_no").map((row) => parseJson<ScheduleHistoryRecord>(row.payload_json, "schedule_history.payload_json")),
    };
  }

  async saveSchedules(definitions: ScheduleDefinition[]): Promise<void> {
    const database = this.requiredDatabase();
    inTransaction(database, () => {
      database.exec("DELETE FROM schedules");
      for (const definition of definitions) insertSchedule(database, definition);
    });
  }

  async appendScheduleHistory(record: ScheduleHistoryRecord): Promise<void> {
    const database = this.requiredDatabase();
    inTransaction(database, () => {
      insertScheduleHistory(database, record);
    });
  }

  async loadExtensionMetadata(): Promise<PersistedExtensionMetadata> {
    const row = this.requiredDatabase().prepare("SELECT payload_json FROM extension_metadata WHERE id = 1").get() as DatabaseRow | undefined;
    return row ? parseJson<PersistedExtensionMetadata>(row.payload_json, "extension_metadata.payload_json") : { enabledSkillsBySession: {} };
  }

  async saveExtensionMetadata(metadata: PersistedExtensionMetadata): Promise<void> {
    const database = this.requiredDatabase();
    inTransaction(database, () => {
      insertExtensionMetadata(database, metadata);
    });
  }

  async loadSecretReferences(): Promise<SecretReference[]> {
    return (this.requiredDatabase().prepare("SELECT id, configured, updated_at FROM secret_references ORDER BY id").all() as DatabaseRow[])
      .map((row) => ({ id: stringValue(row.id), configured: numberValue(row.configured) === 1, updatedAt: numberValue(row.updated_at) }));
  }

  async saveSecretReferences(references: SecretReference[]): Promise<void> {
    const database = this.requiredDatabase();
    inTransaction(database, () => {
      database.exec("DELETE FROM secret_references");
      for (const reference of references) insertSecretReference(database, reference);
    });
  }

  async loadProviderSettings(): Promise<ProviderConnectionSettings | LegacyProviderConnectionSettings | null> {
    const row = this.requiredDatabase().prepare("SELECT payload_json FROM provider_settings WHERE id = 1").get() as DatabaseRow | undefined;
    return row ? parseJson<ProviderConnectionSettings | LegacyProviderConnectionSettings>(row.payload_json, "provider_settings.payload_json") : null;
  }

  async saveProviderSettings(settings: ProviderConnectionSettings): Promise<void> {
    const database = this.requiredDatabase();
    inTransaction(database, () => {
      insertProviderSettings(database, settings);
    });
  }

  async loadLocalModels(): Promise<LocalModelRecord[]> {
    const row = this.requiredDatabase().prepare("SELECT value_json FROM settings WHERE key = 'cp6.local-models'").get() as DatabaseRow | undefined;
    return row ? parseJson<LocalModelRecord[]>(row.value_json, "settings.cp6.local-models") : [];
  }

  async saveLocalModels(records: LocalModelRecord[]): Promise<void> {
    this.requiredDatabase().prepare("INSERT INTO settings (key, value_json, updated_at) VALUES ('cp6.local-models', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at")
      .run(JSON.stringify(records), Date.now());
  }

  async loadSetting<T>(key: string): Promise<T | undefined> {
    const row = this.requiredDatabase().prepare("SELECT value_json FROM settings WHERE key = ?").get(key) as DatabaseRow | undefined;
    return row ? parseJson<T>(row.value_json, `settings.${key}`) : undefined;
  }

  async saveSetting<T>(key: string, value: T): Promise<void> {
    this.requiredDatabase().prepare("INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at")
      .run(key, JSON.stringify(value), Date.now());
  }

  async loadTrustedProjectRoots(): Promise<string[]> {
    return (this.requiredDatabase().prepare("SELECT root FROM trusted_projects ORDER BY root").all() as DatabaseRow[])
      .map((row) => stringValue(row.root));
  }

  async saveTrustedProjectRoots(roots: string[]): Promise<void> {
    const database = this.requiredDatabase();
    inTransaction(database, () => {
      database.exec("DELETE FROM trusted_projects");
      for (const root of [...new Set(roots)]) insertTrustedProject(database, root);
    });
  }

  async loadWorkspaces(): Promise<WorkspaceSnapshot[]> {
    return this.rows("SELECT payload_json FROM workspaces ORDER BY created_at, id")
      .map((row) => parseJson<WorkspaceSnapshot>(row.payload_json, "workspaces.payload_json"));
  }

  async saveWorkspaces(records: WorkspaceSnapshot[]): Promise<void> {
    const database = this.requiredDatabase();
    inTransaction(database, () => {
      database.exec("DELETE FROM workspaces");
      for (const record of records) insertWorkspace(database, record);
    });
  }

  async loadArtifacts(): Promise<ManagedArtifactRecord[]> {
    return this.rows("SELECT payload_json FROM file_references ORDER BY created_at, id")
      .map((row) => parseJson<ManagedArtifactRecord>(row.payload_json, "file_references.payload_json"));
  }

  async saveArtifact(record: ManagedArtifactRecord): Promise<void> {
    const database = this.requiredDatabase();
    inTransaction(database, () => insertArtifact(database, record));
  }

  async deleteArtifact(id: string): Promise<void> {
    const database = this.requiredDatabase();
    inTransaction(database, () => { database.prepare("DELETE FROM file_references WHERE id = ?").run(id); });
  }

  private rows(sql: string): DatabaseRow[] {
    return this.requiredDatabase().prepare(sql).all() as DatabaseRow[];
  }

  private requiredDatabase(): DatabaseSync {
    if (!this.database || !this.initialized) throw new SQLiteStoreError("SQLiteStore 尚未初始化。");
    return this.database;
  }

  private async migrateLegacy(paths: string[]): Promise<void> {
    await removeIfExists(this.stagePath);
    const rollbackDirectory = await createRollbackCopy(this.rootDir, this.rollbackRoot, paths);
    if (this.options.migrationFailure === "after-copy") {
      throw new SQLiteStoreError(`MIGRATION_INTERRUPTED: rollback copy prepared at ${relative(this.rootDir, rollbackDirectory)}`);
    }

    const legacy = await readLegacyData(this.rootDir);
    let stage: DatabaseSync | undefined;
    let preserveStage = false;
    try {
      stage = openDatabase(this.stagePath);
      ensureSchema(stage);
      inTransaction(stage, () => {
        if (legacy.application) saveApplication(stage!, legacy.application);
        for (const event of legacy.events) insertEvent(stage!, event);
        for (const envelope of legacy.coordination) insertCoordination(stage!, envelope);
        for (const usage of legacy.usage) insertUsage(stage!, usage);
        for (const definition of legacy.schedules.definitions) insertSchedule(stage!, definition);
        for (const record of legacy.schedules.history) insertScheduleHistory(stage!, record);
        if (legacy.extensions) insertExtensionMetadata(stage!, legacy.extensions);
        for (const reference of legacy.secretReferences) insertSecretReference(stage!, reference);
        if (legacy.providerSettings) insertProviderSettings(stage!, legacy.providerSettings);
        for (const root of legacy.trustedProjects) insertTrustedProject(stage!, root);
        for (const record of legacy.workspaces) insertWorkspace(stage!, record);
        stage!.prepare("INSERT INTO schema_meta (key, value) VALUES ('migration_status', 'complete') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
      });
      stage.close();
      stage = undefined;
      if (this.options.migrationFailure === "after-import") {
        preserveStage = true;
        throw new SQLiteStoreError("MIGRATION_INTERRUPTED: staged database retained for startup recovery");
      }
      await rename(this.stagePath, this.databasePath);
      this.database = openDatabase(this.databasePath);
      ensureSchema(this.database);
      this.initialized = true;
    } catch (error) {
      stage?.close();
      if (!preserveStage) await removeIfExists(this.stagePath);
      throw error;
    }
  }
}

function openDatabase(path: string): DatabaseSync {
  const database = new DatabaseSync(path, { timeout: 2500 });
  database.exec("PRAGMA foreign_keys = ON");
  return database;
}

function ensureSchema(database: DatabaseSync): void {
  const existingVersion = Number((database.prepare("PRAGMA user_version").get() as DatabaseRow | undefined)?.user_version ?? 0);
  if (existingVersion > STORAGE_SCHEMA_VERSION) {
    throw new SQLiteStoreError(`SCHEMA_NEWER_UNSUPPORTED: database version ${existingVersion} is newer than ${STORAGE_SCHEMA_VERSION}`);
  }
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      product_version TEXT NOT NULL,
      active_session_id TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      working_directory TEXT NOT NULL,
      project_access_enabled INTEGER NOT NULL DEFAULT 0,
      project_selected_by TEXT,
      selected_model TEXT NOT NULL,
      selected_provider_id TEXT NOT NULL,
      permission_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      active_run_id TEXT,
      unread INTEGER NOT NULL,
      pinned INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      sequence_no INTEGER NOT NULL,
      role TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_session_sequence ON messages(session_id, sequence_no);
    CREATE TABLE IF NOT EXISTS provider_history (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      sequence_no INTEGER NOT NULL,
      role TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS provider_history_session_sequence ON provider_history(session_id, sequence_no);
    CREATE TABLE IF NOT EXISTS queue_items (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      sequence_no INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS queue_session_sequence ON queue_items(session_id, sequence_no);
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      sequence_no INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      engine_id TEXT NOT NULL DEFAULT 'viniper',
      session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      run_id TEXT,
      item_id TEXT,
      type TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_session_sequence ON events(session_id, sequence_no);
    CREATE TABLE IF NOT EXISTS coordination (
      sequence_no INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      source_session_id TEXT NOT NULL REFERENCES sessions(session_id),
      target_session_id TEXT NOT NULL REFERENCES sessions(session_id),
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS schedule_history (
      sequence_no INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      schedule_id TEXT NOT NULL,
      session_id TEXT,
      triggered_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS usage (
      sequence_no INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL UNIQUE,
      session_id TEXT NOT NULL REFERENCES sessions(session_id),
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS provider_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      schema_version INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS secret_references (
      id TEXT PRIMARY KEY,
      configured INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trusted_projects (
      root TEXT PRIMARY KEY
    );
    CREATE TABLE IF NOT EXISTS extension_metadata (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS file_references (
      id TEXT PRIMARY KEY,
      relative_path TEXT NOT NULL,
      kind TEXT NOT NULL,
      state TEXT NOT NULL,
      size_bytes INTEGER,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS recovery_checkpoints (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES sessions(session_id),
      run_id TEXT,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runtime_leases (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      owner_id TEXT NOT NULL,
      state TEXT NOT NULL,
      acquired_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS context_summary_generations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_index_snapshots (
      id TEXT PRIMARY KEY,
      project_root TEXT,
      revision INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
    INSERT INTO schema_meta (key, value) VALUES ('storage_schema_version', '2')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value;
    INSERT INTO schema_meta (key, value) VALUES ('migration_status', 'ready')
      ON CONFLICT(key) DO NOTHING;
  `);
  ensureColumn(database, "events", "engine_id", "TEXT NOT NULL DEFAULT 'viniper'");
  ensureColumn(database, "events", "item_id", "TEXT");
  if (existingVersion < STORAGE_SCHEMA_VERSION) database.exec(`PRAGMA user_version = ${STORAGE_SCHEMA_VERSION}`);
}

function saveApplication(database: DatabaseSync, application: PersistedApplication): void {
  database.prepare("INSERT INTO app_state (id, product_version, active_session_id) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET product_version = excluded.product_version, active_session_id = excluded.active_session_id")
    .run(application.productVersion, application.activeSessionId);
  for (const session of application.sessions) saveSession(database, session);
}

function saveSession(database: DatabaseSync, session: PersistedSessionSnapshot): void {
  const { messages, providerHistory, queue, ...sessionPayload } = session;
  const payload = { ...sessionPayload } as Record<string, unknown>;
  delete payload.events;
  database.prepare(`INSERT INTO sessions (
    session_id, title, working_directory, project_access_enabled, project_selected_by,
    selected_model, selected_provider_id, permission_mode, status, active_run_id,
    unread, pinned, created_at, updated_at, payload_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(session_id) DO UPDATE SET
    title = excluded.title, working_directory = excluded.working_directory,
    project_access_enabled = excluded.project_access_enabled, project_selected_by = excluded.project_selected_by,
    selected_model = excluded.selected_model, selected_provider_id = excluded.selected_provider_id,
    permission_mode = excluded.permission_mode, status = excluded.status, active_run_id = excluded.active_run_id,
    unread = excluded.unread, pinned = excluded.pinned, created_at = excluded.created_at,
    updated_at = excluded.updated_at, payload_json = excluded.payload_json`).run(
    session.id,
    session.title,
    session.workingDirectory,
    session.projectAccess?.enabled ? 1 : 0,
    session.projectAccess?.selectedBy ?? null,
    session.selectedModel,
    session.selectedProviderId,
    session.permissionMode,
    session.status,
    session.activeRunId ?? null,
    session.unread ? 1 : 0,
    session.pinned ? 1 : 0,
    session.createdAt,
    session.updatedAt,
    JSON.stringify(payload),
  );
  database.prepare("DELETE FROM messages WHERE session_id = ?").run(session.id);
  const messageStatement = database.prepare("INSERT INTO messages (id, session_id, sequence_no, role, created_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)");
  for (const [sequence, message] of messages.entries()) {
    messageStatement.run(message.id, session.id, sequence, message.role, message.createdAt, JSON.stringify(message));
  }
  database.prepare("DELETE FROM provider_history WHERE session_id = ?").run(session.id);
  const historyStatement = database.prepare("INSERT INTO provider_history (id, session_id, sequence_no, role, payload_json) VALUES (?, ?, ?, ?, ?)");
  for (const [sequence, entry] of providerHistory.entries()) {
    historyStatement.run(entry.id, session.id, sequence, entry.role, JSON.stringify(entry));
  }
  database.prepare("DELETE FROM queue_items WHERE session_id = ?").run(session.id);
  const queueStatement = database.prepare("INSERT INTO queue_items (id, session_id, sequence_no, created_at, payload_json) VALUES (?, ?, ?, ?, ?)");
  for (const [sequence, item] of queue.entries()) {
    queueStatement.run(item.id, session.id, sequence, item.createdAt, JSON.stringify(item));
  }
  database.prepare("DELETE FROM runs WHERE session_id = ?").run(session.id);
  const activeRunIds = session.activeRunIds ?? (session.activeRunId ? [session.activeRunId] : []);
  for (const runId of activeRunIds) {
    database.prepare("INSERT INTO runs (run_id, session_id, status, updated_at, payload_json) VALUES (?, ?, ?, ?, ?)")
      .run(runId, session.id, session.status, session.updatedAt, JSON.stringify({ sessionId: session.id, runId, status: session.status }));
  }
}

function insertEvent(database: DatabaseSync, event: RuntimeEvent): RuntimeEvent {
  if (!sessionExists(database, event.sessionId)) {
    throw new SQLiteStoreError(`DATA_REFERENCE_MISSING: event ${event.id} references session ${event.sessionId}`);
  }
  const turnId = event.turnId ?? runIdFromPayload(event.payload);
  const engineId = event.engineId ?? "viniper";
  const result = database.prepare("INSERT INTO events (id, engine_id, session_id, run_id, item_id, type, timestamp, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(event.id, engineId, event.sessionId, turnId, event.itemId ?? null, event.type, event.timestamp, JSON.stringify(event.payload));
  return { ...event, engineId, threadId: event.threadId ?? event.sessionId, ...(turnId ? { turnId } : {}), sequence: Number(result.lastInsertRowid) };
}

function insertCoordination(database: DatabaseSync, envelope: CoordinationEnvelope): void {
  if (!sessionExists(database, envelope.sourceSessionId) || !sessionExists(database, envelope.targetSessionId)) {
    throw new SQLiteStoreError(`DATA_REFERENCE_MISSING: coordination ${envelope.id} references an unknown session`);
  }
  database.prepare("INSERT INTO coordination (id, source_session_id, target_session_id, type, status, created_at, updated_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET source_session_id = excluded.source_session_id, target_session_id = excluded.target_session_id, type = excluded.type, status = excluded.status, created_at = excluded.created_at, updated_at = excluded.updated_at, payload_json = excluded.payload_json")
    .run(envelope.id, envelope.sourceSessionId, envelope.targetSessionId, envelope.type, envelope.status, envelope.createdAt, envelope.updatedAt, JSON.stringify(envelope));
}

function insertUsage(database: DatabaseSync, usage: RunUsageSnapshot): void {
  if (!sessionExists(database, usage.sessionId)) {
    throw new SQLiteStoreError(`DATA_REFERENCE_MISSING: usage ${usage.runId} references session ${usage.sessionId}`);
  }
  database.prepare("INSERT INTO usage (run_id, session_id, status, started_at, updated_at, payload_json) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET session_id = excluded.session_id, status = excluded.status, started_at = excluded.started_at, updated_at = excluded.updated_at, payload_json = excluded.payload_json")
    .run(usage.runId, usage.sessionId, usage.status, usage.startedAt, usage.updatedAt, JSON.stringify(usage));
}

function insertSchedule(database: DatabaseSync, definition: ScheduleDefinition): void {
  if (definition.target.kind === "existing-session" && !sessionExists(database, definition.target.sessionId)) {
    throw new SQLiteStoreError(`DATA_REFERENCE_MISSING: schedule ${definition.id} references session ${definition.target.sessionId}`);
  }
  database.prepare("INSERT INTO schedules (id, name, enabled, created_at, updated_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)")
    .run(definition.id, definition.name, definition.enabled ? 1 : 0, definition.createdAt, definition.updatedAt, JSON.stringify(definition));
}

function insertScheduleHistory(database: DatabaseSync, record: ScheduleHistoryRecord): void {
  database.prepare("INSERT INTO schedule_history (id, schedule_id, session_id, triggered_at, status, payload_json) VALUES (?, ?, ?, ?, ?, ?)")
    .run(record.id, record.scheduleId, record.sessionId ?? null, record.triggeredAt, record.status, JSON.stringify(record));
}

function insertExtensionMetadata(database: DatabaseSync, metadata: PersistedExtensionMetadata): void {
  database.prepare("INSERT INTO extension_metadata (id, payload_json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json")
    .run(JSON.stringify(metadata));
}

function insertSecretReference(database: DatabaseSync, reference: SecretReference): void {
  database.prepare("INSERT INTO secret_references (id, configured, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET configured = excluded.configured, updated_at = excluded.updated_at")
    .run(reference.id, reference.configured ? 1 : 0, reference.updatedAt);
}

function insertProviderSettings(database: DatabaseSync, settings: ProviderConnectionSettings | LegacyProviderConnectionSettings): void {
  rejectSecretFields(settings);
  database.prepare("INSERT INTO provider_settings (id, schema_version, payload_json) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET schema_version = excluded.schema_version, payload_json = excluded.payload_json")
    .run("schemaVersion" in settings ? settings.schemaVersion : 1, JSON.stringify(settings));
}

function insertTrustedProject(database: DatabaseSync, root: string): void {
  database.prepare("INSERT INTO trusted_projects (root) VALUES (?) ON CONFLICT(root) DO NOTHING").run(root);
}

function insertWorkspace(database: DatabaseSync, record: WorkspaceSnapshot): void {
  database.prepare("INSERT INTO workspaces (id, run_id, mode, status, created_at, updated_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET run_id = excluded.run_id, mode = excluded.mode, status = excluded.status, created_at = excluded.created_at, updated_at = excluded.updated_at, payload_json = excluded.payload_json")
    .run(record.id, record.runId, record.mode, record.status, record.createdAt, record.updatedAt, JSON.stringify(record));
}

function insertArtifact(database: DatabaseSync, record: ManagedArtifactRecord): void {
  database.prepare(`INSERT INTO file_references (
      id, relative_path, kind, state, size_bytes, created_at, expires_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET relative_path = excluded.relative_path,
      kind = excluded.kind, state = excluded.state, size_bytes = excluded.size_bytes,
      created_at = excluded.created_at, expires_at = excluded.expires_at,
      payload_json = excluded.payload_json`).run(
    record.id,
    record.relativePath,
    record.kind,
    record.state,
    record.sizeBytes,
    record.createdAt,
    record.retention === "never" ? null : record.createdAt + retentionMs(record.retention),
    JSON.stringify(record),
  );
}

function retentionMs(retention: ManagedArtifactRecord["retention"]): number {
  return retention === "7d" ? 7 * 24 * 60 * 60 * 1000 : retention === "30d" ? 30 * 24 * 60 * 60 * 1000 : 90 * 24 * 60 * 60 * 1000;
}

function updateRunProjection(database: DatabaseSync, event: RuntimeEvent): void {
  const runId = event.turnId ?? runIdFromPayload(event.payload);
  if (!runId) return;
  const status = event.type === "run.completed" ? "completed" : event.type === "run.cancelled" ? "cancelled" : event.type === "run.failed" ? "failed" : "running";
  database.prepare("INSERT INTO runs (run_id, session_id, status, updated_at, payload_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at, payload_json = excluded.payload_json")
    .run(runId, event.sessionId, status, event.timestamp, JSON.stringify({ runId, sessionId: event.sessionId, status, eventType: event.type }));
}

function eventFromRow(id: string, row: DatabaseRow): RuntimeEvent {
  return {
    id,
    sequence: numberValue(row.sequence_no),
    engineId: row.engine_id === "claude-code" ? "claude-code" : "viniper",
    sessionId: stringValue(row.session_id),
    threadId: stringValue(row.session_id),
    ...(typeof row.run_id === "string" && row.run_id ? { turnId: row.run_id } : {}),
    ...(typeof row.item_id === "string" && row.item_id ? { itemId: row.item_id } : {}),
    type: row.type as RuntimeEvent["type"],
    timestamp: numberValue(row.timestamp),
    payload: parseJson(row.payload_json, "events.payload_json"),
  };
}

function ensureColumn(database: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as DatabaseRow[];
  if (columns.some((row) => row.name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function runIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>).runId;
  return typeof value === "string" && value ? value : null;
}

function sessionExists(database: DatabaseSync, sessionId: string): boolean {
  return Boolean(database.prepare("SELECT 1 AS present FROM sessions WHERE session_id = ?").get(sessionId));
}

function groupRows(rows: DatabaseRow[], key: string): Map<string, DatabaseRow[]> {
  const grouped = new Map<string, DatabaseRow[]>();
  for (const row of rows) {
    const value = stringValue(row[key]);
    const existing = grouped.get(value) ?? [];
    existing.push(row);
    grouped.set(value, existing);
  }
  return grouped;
}

function parseJson<T = unknown>(value: unknown, source: string): T {
  if (typeof value !== "string") throw new SQLiteStoreError(`STORAGE_CORRUPT: ${source} is not text`);
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new SQLiteStoreError(`STORAGE_CORRUPT: ${source}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function stringValue(value: unknown): string {
  if (typeof value !== "string") throw new SQLiteStoreError("STORAGE_CORRUPT: expected text value");
  return value;
}

function numberValue(value: unknown): number {
  if (typeof value !== "number") throw new SQLiteStoreError("STORAGE_CORRUPT: expected numeric value");
  return value;
}

function inTransaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function rejectSecretFields(value: unknown): void {
  const forbidden = /^(api[-_]?key|secret|token|password|private[-_]?key|credential)$/iu;
  const visit = (current: unknown): void => {
    if (!current || typeof current !== "object") return;
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    for (const [key, item] of Object.entries(current)) {
      if (forbidden.test(key)) throw new SQLiteStoreError("SECRET_PLAINTEXT_REJECTED: secret fields belong in the platform vault");
      visit(item);
    }
  };
  visit(value);
}

async function readLegacyData(rootDir: string): Promise<LegacyData> {
  const legacy = new FileStore(rootDir);
  const workspacePath = join(rootDir, "workspaces", "records.json");
  const loaded = await legacy.load();
  const events = loaded?.events ?? await readLegacyNdjson<RuntimeEvent>(join(rootDir, "events.ndjson"));
  return {
    application: loaded?.application ?? null,
    events,
    coordination: await legacy.loadCoordination(),
    usage: await legacy.loadUsage(),
    schedules: await legacy.loadSchedules(),
    extensions: await legacy.loadExtensionMetadata(),
    secretReferences: await legacy.loadSecretReferences(),
    providerSettings: await legacy.loadProviderSettings(),
    trustedProjects: await legacy.loadTrustedProjectRoots(),
    workspaces: (await fileExists(workspacePath)) ? await parseLegacyWorkspaces(workspacePath) : [],
  };
}

async function readLegacyNdjson<T>(path: string): Promise<T[]> {
  if (!(await fileExists(path))) return [];
  try {
    return (await readFile(path, "utf8"))
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch (error) {
    throw new SQLiteStoreError(`MIGRATION_INVALID: ${relative(process.cwd(), path)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function parseLegacyWorkspaces(path: string): Promise<WorkspaceSnapshot[]> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as WorkspaceSnapshot[];
  } catch (error) {
    throw new SQLiteStoreError(`MIGRATION_INVALID: workspaces/records.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function existingLegacyPaths(rootDir: string): Promise<string[]> {
  const paths: string[] = [];
  for (const relativePath of LEGACY_RELATIVE_PATHS) {
    if (await fileExists(join(rootDir, relativePath))) paths.push(relativePath);
  }
  return paths;
}

async function createRollbackCopy(rootDir: string, rollbackRoot: string, relativePaths: string[]): Promise<string> {
  await mkdir(rollbackRoot, { recursive: true });
  const entries = await readdir(rollbackRoot, { withFileTypes: true });
  const existing = entries.find((entry) => entry.isDirectory());
  const target = existing ? join(rollbackRoot, existing.name) : join(rollbackRoot, `legacy-${Date.now()}`);
  await mkdir(target, { recursive: true });
  for (const relativePath of relativePaths) {
    const source = join(rootDir, relativePath);
    const destination = join(target, relativePath);
    if (await fileExists(destination)) continue;
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  return target;
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

async function removeIfExists(path: string): Promise<void> {
  await rm(path, { force: true, recursive: false });
}
