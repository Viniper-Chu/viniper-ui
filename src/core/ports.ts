import { CoordinationEnvelope } from "./coordination-contracts";
import { PersistedApplication, RuntimeEvent } from "./contracts";
import { ProjectInstructionReadResult } from "./instruction-contracts";
import {
  LoadedSkill,
  PersistedExtensionMetadata,
  PluginRecord,
  SkillMetadata,
  ExtensionVersionState,
} from "./extension-contracts";
import { ScheduleDefinition, ScheduleHistoryRecord } from "./scheduler-contracts";
import { LegacyProviderConnectionSettings, ProviderConnectionSettings, SecretReference } from "./security-contracts";
import { RunUsageSnapshot } from "./telemetry-contracts";
import { WorkspaceSnapshot } from "./programming-contracts";
import { MemoryEntry } from "./memory-contracts";
import { ContextSummaryGeneration } from "./compaction-contracts";
import { ProjectIndexSnapshot } from "./project-index-contracts";
import { RoutingSnapshot } from "./routing-contracts";
import { ManagedArtifactRecord } from "./artifact-contracts";
import { LocalModelRecord } from "./local-model-contracts";

export interface RuntimePersistence {
  load(): Promise<{ application: PersistedApplication; events: RuntimeEvent[] } | null>;
  saveSnapshot(application: PersistedApplication): Promise<void>;
  appendEvent(event: RuntimeEvent): Promise<void>;
  commitEvent(event: RuntimeEvent, application: PersistedApplication): Promise<RuntimeCommitReceipt>;
}

export interface RuntimeCommitReceipt {
  event: RuntimeEvent;
  duplicate: boolean;
}

export interface PermissionAccessPersistence {
  loadTrustedProjectRoots(): Promise<string[]>;
  saveTrustedProjectRoots(roots: string[]): Promise<void>;
}

export interface ProjectInstructionSource {
  readCanonical(workingDirectory: string): Promise<ProjectInstructionReadResult>;
}

export interface CoordinationPersistence {
  loadCoordination(): Promise<CoordinationEnvelope[]>;
  appendCoordination(envelope: CoordinationEnvelope): Promise<void>;
}

export interface TelemetryPersistence {
  loadUsage(): Promise<RunUsageSnapshot[]>;
  appendUsage(usage: RunUsageSnapshot): Promise<void>;
}

export interface SchedulerPersistence {
  loadSchedules(): Promise<{ definitions: ScheduleDefinition[]; history: ScheduleHistoryRecord[] }>;
  saveSchedules(definitions: ScheduleDefinition[]): Promise<void>;
  appendScheduleHistory(record: ScheduleHistoryRecord): Promise<void>;
}

export interface ExtensionPersistence {
  loadExtensionMetadata(): Promise<PersistedExtensionMetadata>;
  saveExtensionMetadata(metadata: PersistedExtensionMetadata): Promise<void>;
}

export interface SecretReferencePersistence {
  loadSecretReferences(): Promise<SecretReference[]>;
  saveSecretReferences(references: SecretReference[]): Promise<void>;
}

export interface ProviderSettingsPersistence {
  loadProviderSettings(): Promise<ProviderConnectionSettings | LegacyProviderConnectionSettings | null>;
  saveProviderSettings(settings: ProviderConnectionSettings): Promise<void>;
}

export interface LocalModelPersistence {
  loadLocalModels(): Promise<LocalModelRecord[]>;
  saveLocalModels(records: LocalModelRecord[]): Promise<void>;
}

/**
 * Canonical persistence for workspace lifecycle records.  The platform
 * implementation may keep large worktrees and patches in managed files, but
 * the structured workspace state stays behind the application port.
 */
export interface WorkspacePersistence {
  loadWorkspaces(): Promise<WorkspaceSnapshot[]>;
  saveWorkspaces(records: WorkspaceSnapshot[]): Promise<void>;
}

/** CP3 state stays behind the same SQLite-backed application boundary. */
export interface Phase8Cp3Persistence {
  loadMemoryEntries(): Promise<MemoryEntry[]>;
  saveMemoryEntries(entries: MemoryEntry[]): Promise<void>;
  loadRoutingSnapshot(): Promise<RoutingSnapshot | null>;
  saveRoutingSnapshot(snapshot: RoutingSnapshot): Promise<void>;
  loadCompactionGenerations(): Promise<ContextSummaryGeneration[]>;
  saveCompactionGeneration(generation: ContextSummaryGeneration): Promise<void>;
  loadProjectIndexSnapshots(): Promise<ProjectIndexSnapshot[]>;
  saveProjectIndexSnapshot(snapshot: ProjectIndexSnapshot): Promise<void>;
}

export interface ArtifactPersistence {
  loadArtifacts(): Promise<ManagedArtifactRecord[]>;
  saveArtifact(record: ManagedArtifactRecord): Promise<void>;
  deleteArtifact(id: string): Promise<void>;
}

export interface ArtifactFileRegistrar {
  registerExistingFile(input: {
    sessionId: string;
    runId: string;
    kind: "terminal-output" | "git-diff" | "project-diff" | "audit";
    absolutePath: string;
    retention?: "7d" | "30d" | "90d" | "never";
  }): Promise<ManagedArtifactRecord>;
}

export interface SecretVault {
  isEncryptionAvailable(): boolean;
  setSecret(id: string, value: string): Promise<void>;
  readSecret(id: string): Promise<string | null>;
  deleteSecret(id: string): Promise<void>;
  isConfigured(id: string): Promise<boolean>;
}

export interface SkillSource {
  listMetadata(): Promise<SkillMetadata[]>;
  load(id: string): Promise<LoadedSkill>;
}

export interface PluginSource {
  discover(): Promise<PluginRecord[]>;
}

export interface ExtensionProcessInvocation {
  extensionId: string;
  version: ExtensionVersionState;
  payload: unknown;
  entryOverride?: string;
  signal?: AbortSignal;
}

export type ExtensionProcessResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export interface ExtensionProcessHost {
  invoke(input: ExtensionProcessInvocation): Promise<ExtensionProcessResult>;
  dispose(): Promise<void>;
}
