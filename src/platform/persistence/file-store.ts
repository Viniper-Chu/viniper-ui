import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CoordinationEnvelope } from "../../core/coordination-contracts";
import {
  PersistedApplication,
  PersistedApplicationV1,
  PersistedApplicationV2,
  CachePlan,
  CacheSegment,
  PRODUCT_VERSION,
  RuntimeEvent,
} from "../../core/contracts";
import { PersistedExtensionMetadata } from "../../core/extension-contracts";
import {
  CoordinationPersistence,
  ExtensionPersistence,
  ProviderSettingsPersistence,
  PermissionAccessPersistence,
  RuntimeCommitReceipt,
  RuntimePersistence,
  SchedulerPersistence,
  SecretReferencePersistence,
  TelemetryPersistence,
} from "../../core/ports";
import { ScheduleDefinition, ScheduleHistoryRecord } from "../../core/scheduler-contracts";
import { LegacyProviderConnectionSettings, ProviderConnectionSettings, SecretReference } from "../../core/security-contracts";
import { RunUsageSnapshot } from "../../core/telemetry-contracts";

export class FileStore implements RuntimePersistence, CoordinationPersistence, TelemetryPersistence,
  SchedulerPersistence, ExtensionPersistence, SecretReferencePersistence, ProviderSettingsPersistence,
  PermissionAccessPersistence {
  readonly snapshotPath: string;
  readonly eventJournalPath: string;
  readonly coordinationPath: string;
  readonly usagePath: string;
  readonly schedulesPath: string;
  readonly scheduleHistoryPath: string;
  readonly extensionsPath: string;
  readonly secretReferencesPath: string;
  readonly providerSettingsPath: string;
  readonly trustedProjectsPath: string;

  constructor(private readonly rootDir: string) {
    this.snapshotPath = join(rootDir, "sessions.json");
    this.eventJournalPath = join(rootDir, "events.ndjson");
    this.coordinationPath = join(rootDir, "coordination.ndjson");
    this.usagePath = join(rootDir, "usage.ndjson");
    this.schedulesPath = join(rootDir, "schedules.json");
    this.scheduleHistoryPath = join(rootDir, "schedule-history.ndjson");
    this.extensionsPath = join(rootDir, "extensions.json");
    this.secretReferencesPath = join(rootDir, "secret-references.json");
    this.providerSettingsPath = join(rootDir, "provider-settings.json");
    this.trustedProjectsPath = join(rootDir, "trusted-projects.json");
  }

  async load(): Promise<{ application: PersistedApplication; events: RuntimeEvent[] } | null> {
    try {
      const snapshotRaw = await readFile(this.snapshotPath, "utf8");
      const parsed: unknown = JSON.parse(snapshotRaw);
      // The legacy shell also owns a sessions.json map.  It is not a Runtime
      // snapshot and must not enter the schema migrator (which expects an
      // array).  SQLite migration reads the journal separately in this case.
      if (!isPersistedApplicationShape(parsed)) return null;
      const application = migrateApplication(parsed);
      const events = await readNdjson<RuntimeEvent>(this.eventJournalPath);
      return { application, events };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async saveSnapshot(application: PersistedApplication): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await writeFile(this.snapshotPath, JSON.stringify(application, null, 2), "utf8");
  }

  async appendEvent(event: RuntimeEvent): Promise<void> {
    await this.appendJsonLine(this.eventJournalPath, event);
  }

  async commitEvent(event: RuntimeEvent, application: PersistedApplication): Promise<RuntimeCommitReceipt> {
    const existing = (await readNdjson<RuntimeEvent>(this.eventJournalPath)).find((item) => item.id === event.id);
    if (existing) return { event: existing, duplicate: true };
    const events = await readNdjson<RuntimeEvent>(this.eventJournalPath);
    const committed = { ...event, sequence: Math.max(0, ...events.map((item) => item.sequence ?? 0)) + 1 };
    await this.appendEvent(committed);
    await this.saveSnapshot(withReplayCursor(application, committed));
    return { event: committed, duplicate: false };
  }

  loadCoordination(): Promise<CoordinationEnvelope[]> {
    return readNdjson<CoordinationEnvelope>(this.coordinationPath);
  }

  appendCoordination(envelope: CoordinationEnvelope): Promise<void> {
    return this.appendJsonLine(this.coordinationPath, envelope);
  }

  loadUsage(): Promise<RunUsageSnapshot[]> {
    return readNdjson<RunUsageSnapshot>(this.usagePath);
  }

  appendUsage(usage: RunUsageSnapshot): Promise<void> {
    return this.appendJsonLine(this.usagePath, usage);
  }

  async loadSchedules(): Promise<{ definitions: ScheduleDefinition[]; history: ScheduleHistoryRecord[] }> {
    return {
      definitions: await readJson<ScheduleDefinition[]>(this.schedulesPath, []),
      history: await readNdjson<ScheduleHistoryRecord>(this.scheduleHistoryPath),
    };
  }

  async saveSchedules(definitions: ScheduleDefinition[]): Promise<void> {
    await this.writeJson(this.schedulesPath, definitions);
  }

  appendScheduleHistory(record: ScheduleHistoryRecord): Promise<void> {
    return this.appendJsonLine(this.scheduleHistoryPath, record);
  }

  loadExtensionMetadata(): Promise<PersistedExtensionMetadata> {
    return readJson<PersistedExtensionMetadata>(this.extensionsPath, { enabledSkillsBySession: {} });
  }

  saveExtensionMetadata(metadata: PersistedExtensionMetadata): Promise<void> {
    return this.writeJson(this.extensionsPath, metadata);
  }

  loadSecretReferences(): Promise<SecretReference[]> {
    return readJson<SecretReference[]>(this.secretReferencesPath, []);
  }

  saveSecretReferences(references: SecretReference[]): Promise<void> {
    return this.writeJson(this.secretReferencesPath, references);
  }

  loadProviderSettings(): Promise<ProviderConnectionSettings | LegacyProviderConnectionSettings | null> {
    return readJson<ProviderConnectionSettings | LegacyProviderConnectionSettings | null>(this.providerSettingsPath, null);
  }

  saveProviderSettings(settings: ProviderConnectionSettings): Promise<void> {
    return this.writeJson(this.providerSettingsPath, settings);
  }

  loadTrustedProjectRoots(): Promise<string[]> {
    return readJson<string[]>(this.trustedProjectsPath, []);
  }

  saveTrustedProjectRoots(roots: string[]): Promise<void> {
    return this.writeJson(this.trustedProjectsPath, roots);
  }

  private async appendJsonLine(path: string, value: unknown): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await appendFile(path, `${JSON.stringify(value)}\n`, "utf8");
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await writeFile(path, JSON.stringify(value, null, 2), "utf8");
  }
}

function isPersistedApplicationShape(
  value: unknown,
): value is PersistedApplication | PersistedApplicationV2 | PersistedApplicationV1 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { schemaVersion?: unknown; sessions?: unknown };
  return (candidate.schemaVersion === 1 || candidate.schemaVersion === 2 || candidate.schemaVersion === 3)
    && Array.isArray(candidate.sessions);
}

function withReplayCursor(application: PersistedApplication, event: RuntimeEvent): PersistedApplication {
  return {
    ...application,
    sessions: application.sessions.map((session) => session.id === event.sessionId
      ? { ...session, replayCursor: event.sequence ?? session.replayCursor }
      : session),
  };
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function readNdjson<T>(path: string): Promise<T[]> {
  try {
    return (await readFile(path, "utf8"))
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function migrateApplication(
  application: PersistedApplication | PersistedApplicationV2 | PersistedApplicationV1,
): PersistedApplication {
  if (application.schemaVersion === 3) return application;
  if (application.schemaVersion === 2) {
    return {
      schemaVersion: 3,
      productVersion: PRODUCT_VERSION,
      activeSessionId: application.activeSessionId,
      sessions: application.sessions.map((session) => ({
        ...session,
        providerHistory: session.messages.map((message) => ({
          id: `migrated-${message.id}`,
          role: message.role === "assistant" ? "assistant" as const : "user" as const,
          items: [{ type: "text" as const, text: message.text }],
        })),
        cachePlan: migrateCachePlan(session.cachePlan),
      })),
    };
  }
  return {
    schemaVersion: 3,
    productVersion: PRODUCT_VERSION,
    activeSessionId: application.activeSessionId,
    sessions: application.sessions.map((session) => ({
      ...session,
      selectedProviderId: "demo",
      providerHistory: session.messages.map((message) => ({
        id: `migrated-${message.id}`,
        role: message.role === "assistant" ? "assistant" as const : "user" as const,
        items: [{ type: "text" as const, text: message.text }],
      })),
      cachePlan: migrateCachePlan({ ...session.cachePlan, profileGeneration: 1 }),
    })),
  };
}

type MigratableCachePlan = Omit<CachePlan, "stableSegments"> & {
  stableSegments: Array<{ name: string; text: string }>;
};

function migrateCachePlan(cachePlan: MigratableCachePlan): CachePlan {
  return {
    ...cachePlan,
    stableSegments: cachePlan.stableSegments.map((segment) => ({
      name: migrateSegmentName(segment.name),
      text: segment.text,
    })),
  };
}

function migrateSegmentName(name: string): CacheSegment["name"] {
  if (name === "tool-contract") return "tool-schemas";
  if (name === "conversation") return "stable-history";
  if (name === "tool-schemas" || name === "system" || name === "project" || name === "skills" || name === "stable-history") return name;
  return "stable-history";
}
