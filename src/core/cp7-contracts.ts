export type ArchiveScope =
  | { kind: "all" }
  | { kind: "session"; sessionId: string }
  | { kind: "project"; projectRoot: string };

export interface ArchiveArtifact {
  ref: string;
  content?: string;
  sizeBytes?: number;
}

export interface ArchiveDataset {
  sessions?: unknown[];
  messages?: unknown[];
  events?: unknown[];
  runs?: unknown[];
  coordination?: unknown[];
  scheduler?: unknown;
  usage?: unknown[];
  providerSettings?: unknown;
  extensionMetadata?: unknown;
  memories?: unknown[];
  fileReferences?: unknown[];
  artifacts?: ArchiveArtifact[];
}

export interface ArchiveManifest {
  format: "viniper-harness-archive";
  schemaVersion: 1;
  createdAt: number;
  scope: ArchiveScope;
  artifactRefs: string[];
}

export interface ArchiveFile {
  manifest: ArchiveManifest;
  data: ArchiveDataset;
}

export interface ImportPreview {
  ok: boolean;
  schemaVersion?: number;
  additions: number;
  conflicts: Array<{ kind: string; id: string; action: "keep-local" | "add" }>;
  errors: string[];
}

export interface DiagnosticEntry {
  timestamp: number;
  runId?: string;
  level: "debug" | "info" | "warn" | "error";
  code: string;
  status?: string;
  attempt?: number;
  durationMs?: number;
  count?: number;
  artifactRef?: string;
  detailed?: boolean;
}

export interface DiagnosticsSnapshot {
  entries: DiagnosticEntry[];
  detailedRunId?: string;
  consent: boolean;
  queuedUploads: string[];
  failedUploads: string[];
  persistenceError?: string;
}

export interface DiagnosticPreview {
  runId?: string;
  fields: DiagnosticEntry[];
  containsMessageBodies: false;
  containsCommandBodies: false;
  containsCredentialValues: false;
}

export type UpdateChannel = "preview" | "stable";

export interface UpdateFeed {
  channel: UpdateChannel;
  version: string;
  notes: string;
  asset: string;
}

export type UpdateStatus = "idle" | "unavailable" | "no-update" | "available" | "downloading" | "ready" | "waiting-idle" | "installing" | "installed" | "failed";

export interface UpdateSnapshot {
  channel: UpdateChannel;
  status: UpdateStatus;
  currentVersion: string;
  availableVersion?: string;
  notes?: string;
  officialSourceConfigured: boolean;
  failure?: string;
  activeRunCount: number;
}

export interface ProductSettingsSnapshot {
  closeBehavior: "ask" | "keep_running" | "quit";
  maxConcurrentRuns: number;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  retentionDays: number | "never";
  memoryWarningRatio: number;
  memoryStaleDays: number;
  diagnosticsConsent: boolean;
  providerNetworkMode: "system";
  providerStatusVisible: boolean;
  localModelsEnabled: boolean;
  localModelConcurrency: number;
  updateChannel: UpdateChannel;
  geminiServerStateEnabled: boolean;
}
