export const PRODUCT_VERSION = "1.6.0" as const;
/** Stable is the published channel.  Preview builds set VINIPER_UI_RELEASE_STAGE=preview
 * in their isolated launcher and retain their already-built rollback artifact. */
const isPreviewBuild = typeof process !== "undefined"
  && process.env?.VINIPER_UI_RELEASE_STAGE === "preview";
export const RELEASE_STAGE = (isPreviewBuild ? "Preview" : "Stable") as "Preview" | "Stable";
export const PRODUCT_NAME = "Viniper workstation" as const;
export const PRODUCT_BADGE = (isPreviewBuild ? "v1.6.0 · Preview（预览版）" : "v1.6.0 · Stable（稳定版）") as
  "v1.6.0 · Preview（预览版）" | "v1.6.0 · Stable（稳定版）";
export const PRODUCT_TITLE = `${PRODUCT_NAME} · ${PRODUCT_BADGE}` as const;

import { CoordinationSnapshot, CoordinationWait } from "./coordination-contracts";
import { ExtensionSnapshot, LoadedSkill } from "./extension-contracts";
import { ProjectInstructionStatus } from "./instruction-contracts";
import { PermissionSnapshot } from "./permission-contracts";
import { SchedulerSnapshot } from "./scheduler-contracts";
import { ProviderConnectionSettings, SecretSnapshot } from "./security-contracts";
import {
  ProviderCatalogSnapshot,
  ProviderDescriptor,
  ProviderHistoryEntry,
  ProviderToolDefinition,
} from "./provider-contracts";
import { TelemetrySnapshot, TokenUsage } from "./telemetry-contracts";
import { FrozenProviderSnapshot, ReviewPolicy, ReviewResultSummary, WorkspaceMode, WorkspaceSnapshot } from "./programming-contracts";
import { MemorySnapshot } from "./memory-contracts";
import { ContextCompactionSnapshot } from "./compaction-contracts";
import { ProjectIndexSnapshot } from "./project-index-contracts";
import { RoutingSnapshot } from "./routing-contracts";
import { ArtifactSnapshot } from "./artifact-contracts";
import { NotificationSnapshot } from "./notification-contracts";
import { LocalModelSnapshot } from "./local-model-contracts";
import { ProviderAttemptSnapshot } from "./provider-runtime-contracts";
import { DiagnosticsSnapshot, ProductSettingsSnapshot, UpdateSnapshot } from "./cp7-contracts";
import { AgentEngineId, AgentEngineSnapshot } from "./agent-engine-contracts";

/** The only user-facing and runtime permission modes. */
export type PermissionMode = "ask" | "review" | "auto" | "full" | "plan";
export type ToolAuthorizationScope = "project" | "computer" | "external";
export type SessionStatus = "idle" | "running" | "queued" | "waiting" | "cancelled" | "failed";
export type RunStatus =
  | "queued"
  | "running"
  | "waiting_resource"
  | "recovering"
  | "replaying"
  | "completed"
  | "cancelled"
  | "failed";

export interface IntentOrigin {
  kind: "user" | "delegation" | "scheduler";
  envelopeId?: string;
  sourceSessionId?: string;
  scheduleId?: string;
  workflowRunId?: string;
}

export interface RunCompletion {
  engineId?: AgentEngineId;
  runId: string;
  sessionId: string;
  origin: IntentOrigin;
  status: "completed" | "cancelled" | "failed";
  assistantText: string;
}

export interface AgentIntent {
  engineId?: AgentEngineId;
  sessionId: string;
  text: string;
  attachments: string[];
  selectedModel: string;
  permissionMode: PermissionMode;
  origin?: IntentOrigin;
  workspaceMode?: WorkspaceMode;
  reviewPolicy?: ReviewPolicy;
  commitRequested?: boolean;
  routing?: AgentRoutingRequest;
  /** Host-owned per-run memory gate. The renderer never supplies memory bodies. */
  memoryEnabled?: boolean;
}

export type AgentRoutingRequest =
  | { mode: "fixed"; providerId: string; modelId: string }
  | { mode: "smart"; strategy: "quality" | "balanced" | "lightweight" };

export interface AgentMessage {
  id: string;
  engineId?: AgentEngineId;
  sessionId?: string;
  turnId?: string;
  itemId?: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: number;
  status?: "streaming" | "completed" | "cancelled" | "failed";
}

export interface QueuedIntent {
  id: string;
  engineId?: AgentEngineId;
  sessionId?: string;
  text: string;
  createdAt: number;
  origin?: IntentOrigin;
  workspaceMode?: WorkspaceMode;
  reviewPolicy?: ReviewPolicy;
  commitRequested?: boolean;
  memoryEnabled?: boolean;
}

export interface ActivityRecord {
  id: string;
  engineId?: AgentEngineId;
  sessionId?: string;
  itemId?: string;
  kind: "thinking" | "tool" | "interaction" | "error";
  title: string;
  detail: string;
  status: "running" | "waiting" | "completed" | "cancelled" | "failed";
  readOnly?: boolean;
  callId?: string;
  parentCallId?: string;
  toolName?: string;
  presentation?: ToolPresentation;
  runId?: string;
  createdAt: number;
}

export interface RunCheckpoint {
  phase: "provider" | "tool" | "approval" | "workspace" | "review" | "run";
  status: "started" | "succeeded" | "failed" | "unknown";
  updatedAt: number;
}

export interface RunSnapshot {
  engineId?: AgentEngineId;
  runId: string;
  turnId?: string;
  sessionId: string;
  origin: IntentOrigin;
  text: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  queuedReason?: "capacity" | "resource" | "dependency";
  checkpoint?: RunCheckpoint;
  providerSnapshot?: FrozenProviderSnapshot;
  compositionRevision?: number;
  routing?: import("./routing-contracts").RoutingDecision;
  providerAttempt?: ProviderAttemptSnapshot;
}

export interface ProjectToolPresentation {
  kind: "project-change" | "project-diff" | "project-restore";
  action: "create" | "replace" | "edit" | "move" | "delete" | "diff" | "restore";
  paths: string[];
  summary: string;
  beforeBytes: number;
  afterBytes: number;
  patch?: string;
  patchTruncated?: boolean;
  artifactId?: string;
  nextCursor?: number | null;
  recoveryReceiptId?: string;
  recoveryStatus?: "available" | "restored";
}

export interface TerminalToolPresentation {
  kind: "terminal-run" | "terminal-output";
  executionId: string;
  status: "running" | "completed" | "nonzero" | "not-found" | "timed-out" | "cancelled" | "failed";
  summary: string;
  exitCode: number | null;
  durationMs: number;
  purpose?: "command" | "dependency" | "build" | "test" | "lint" | "typecheck";
  cwd?: string;
  stdout?: {
    preview: string;
    totalBytes: number;
    truncated: boolean;
    ref: string;
  };
  stderr?: {
    preview: string;
    totalBytes: number;
    truncated: boolean;
    ref: string;
  };
  processIdentity?: {
    executable: string;
    edition: "Core" | "Desktop" | "unknown";
    major: number;
  };
  stream?: "stdout" | "stderr";
  offset?: number;
  bytes?: number;
  totalBytes?: number;
  nextOffset?: number | null;
  outputText?: string;
}

export type ToolPresentation = ProjectToolPresentation | TerminalToolPresentation;

export interface CacheSegment {
  name: "tool-schemas" | "system" | "project" | "skills" | "stable-history";
  text: string;
}

export interface ContextProfile {
  generation: number;
  providerId: string;
  modelId: string;
  toolSchemaVersion: string;
  enabledSkills: LoadedSkill[];
  tools: ProviderToolDefinition[];
  history: ProviderHistoryEntry[];
  stableSegments: CacheSegment[];
}

export interface CachePlan {
  stableSegments: CacheSegment[];
  reusablePrefix: string;
  currentTurn: string;
  reusedContextChars: number;
  addedContextChars: number;
  profileGeneration: number;
}

export type RuntimePlanStepStatus = "pending" | "in_progress" | "completed" | "blocked";

export interface RuntimePlanSnapshot {
  explanation?: string;
  steps: Array<{ id: string; step: string; status: RuntimePlanStepStatus }>;
}

export interface RuntimeTurnDiffSnapshot {
  summary: string;
  files: Array<{ path: string; additions: number; deletions: number }>;
  patch?: string;
  truncated?: boolean;
  artifactId?: string;
}

export type RuntimeItemKind = "message" | "reasoning" | "tool" | "interaction" | "plan" | "diff" | "usage" | "error";

export interface RuntimeItemSnapshot {
  id: string;
  engineId: AgentEngineId;
  sessionId: string;
  turnId?: string;
  kind: RuntimeItemKind;
  status: "started" | "completed" | "cancelled" | "failed";
  startedAt: number;
  completedAt?: number;
}

export type RuntimeEventType =
  | "session.updated"
  | "message.user"
  | "message.delta"
  | "message.completed"
  | "message.cancelled"
  | "provider.history.appended"
  | "thinking.started"
  | "thinking.delta"
  | "thinking.completed"
  | "tool.requested"
  | "tool.completed"
  | "tool.cancelled"
  | "tool.failed"
  | "interaction.requested"
  | "interaction.resolved"
  | "run.started"
  | "run.queued"
  | "run.checkpoint"
  | "run.recovering"
  | "run.replaying"
  | "run.completed"
  | "run.cancelled"
  | "run.failed"
  | "run.listener-failed"
  | "queue.updated"
  | "workspace.updated"
  | "review.started"
  | "review.completed"
  | "review.failed"
  | "lifecycle.failed"
  | "lifecycle.rejected"
  | "steering.updated"
  | "plan.updated"
  | "turn.diff.updated"
  | "turn.usage.updated"
  | "runtime.error"
  | "interrupt.requested"
  | "interrupt.acknowledged";

export interface RuntimeEvent<TPayload = unknown> {
  id: string;
  engineId?: AgentEngineId;
  sessionId: string;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  sequence?: number;
  type: RuntimeEventType;
  timestamp: number;
  payload: TPayload;
}

export interface SessionSnapshot {
  id: string;
  title: string;
  workingDirectory: string;
  /** Defaults to Viniper when reading a pre-0.1.0 session. */
  engineId?: AgentEngineId;
  projectAccess?: {
    enabled: true;
    selectedBy: "desktop-picker" | "cli-explicit";
  };
  selectedModel: string;
  selectedProviderId: string;
  modelUnavailable?: boolean;
  permissionMode: PermissionMode;
  reasoning?: string;
  messages: AgentMessage[];
  providerHistory: ProviderHistoryEntry[];
  queue: QueuedIntent[];
  activities: ActivityRecord[];
  events: RuntimeEvent[];
  items?: RuntimeItemSnapshot[];
  replayCursor?: number;
  plan?: RuntimePlanSnapshot;
  turnDiff?: RuntimeTurnDiffSnapshot;
  status: SessionStatus;
  activeRunId?: string;
  activeRunIds?: string[];
  unread: boolean;
  pinned: boolean;
  waitingFor?: CoordinationWait;
  projectInstructions?: ProjectInstructionStatus;
  createdAt: number;
  updatedAt: number;
  cachePlan: CachePlan;
}

export interface ToolRequest {
  id: string;
  parentCallId?: string;
  name: string;
  summary: string;
  readOnly: boolean;
  scope: ToolAuthorizationScope;
  input?: Record<string, unknown>;
}

export interface RuntimeSnapshot {
  productVersion: typeof PRODUCT_VERSION;
  releaseStage: typeof RELEASE_STAGE;
  productBadge: typeof PRODUCT_BADGE;
  activeSessionId: string;
  sessions: SessionSnapshot[];
  runs?: RunSnapshot[];
  revision?: number;
  providers: ProviderDescriptor[];
  permissions: PermissionSnapshot;
  workspaces?: WorkspaceSnapshot[];
  reviews?: ReviewResultSummary[];
  smartRouting?: RoutingSnapshot;
  memories?: MemorySnapshot;
  contextCompaction?: ContextCompactionSnapshot;
  projectIndexes?: ProjectIndexSnapshot[];
  artifacts?: ArtifactSnapshot;
  notifications?: NotificationSnapshot;
  localModels?: LocalModelSnapshot;
  /** Runtime-owned composition plan consumed by both desktop and CLI. */
  composition?: import("./composition-contracts").CompositionPlan;
  compositionCenter?: import("./composition-contracts").CompositionCenterSnapshot;
  lsp?: import("./lsp-contracts").LspSnapshot;
  workflows?: import("./workflow-contracts").WorkflowSnapshot;
  subagents?: import("./workflow-contracts").SubagentSnapshot;
  steering?: { receipts: Array<{
    id: string;
    runId: string;
    kind: "steer" | "inject";
    status: "queued" | "claimed" | "delivered" | "rejected" | "cleared";
    wakeRequested: boolean;
    payload: string | Record<string, unknown>;
    reason?: string;
    createdAt: number;
    updatedAt: number;
  }> };
  lifecycle?: { active: number };
}

export interface AppSnapshot extends RuntimeSnapshot {
  /** Desktop composition always supplies this; optional keeps old headless fixtures compatible. */
  agentEngines?: AgentEngineSnapshot[];
  coordination: CoordinationSnapshot;
  telemetry: TelemetrySnapshot;
  scheduler: SchedulerSnapshot;
  extensions: ExtensionSnapshot;
  secrets: SecretSnapshot;
  providerSettings: ProviderConnectionSettings;
  providerCatalog: ProviderCatalogSnapshot;
  diagnostics?: DiagnosticsSnapshot;
  updates?: UpdateSnapshot;
  settings?: ProductSettingsSnapshot;
}

export type PersistedSessionSnapshot = Omit<SessionSnapshot, "events">;

export interface PersistedApplication {
  schemaVersion: 3;
  productVersion: typeof PRODUCT_VERSION;
  activeSessionId: string;
  sessions: PersistedSessionSnapshot[];
}

export interface PersistedApplicationV2 {
  schemaVersion: 2;
  productVersion: typeof PRODUCT_VERSION;
  activeSessionId: string;
  sessions: Array<Omit<PersistedSessionSnapshot, "providerHistory">>;
}

export interface PersistedApplicationV1 {
  schemaVersion: 1;
  productVersion: typeof PRODUCT_VERSION;
  activeSessionId: string;
  sessions: Array<Omit<PersistedSessionSnapshot, "selectedProviderId" | "cachePlan"> & {
    cachePlan: Omit<CachePlan, "profileGeneration" | "stableSegments"> & {
      stableSegments: Array<{ name: string; text: string }>;
    };
  }>;
}

export type { ProviderDescriptor } from "./provider-contracts";
export type { ProviderEvent, ProviderRequest } from "./provider-contracts";
