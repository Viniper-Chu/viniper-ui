import { AgentIntent, PermissionMode, RunCompletion, RunSnapshot, SessionSnapshot } from "./contracts";
import { TokenUsage } from "./telemetry-contracts";

export type WorkflowMode =
  | "prompt-chaining"
  | "routing"
  | "parallelisation"
  | "orchestrator-workers"
  | "evaluator-optimiser";

export type WorkflowStepKind = "prompt" | "route" | "parallel" | "delegate" | "evaluate";
export type WorkflowStepStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "skipped" | "unknown";

export interface WorkflowSchema {
  type: "object";
  properties?: Record<string, { type: "string" | "number" | "boolean" | "object" | "array" }>;
  required?: string[];
}

export interface WorkflowStepDefinition {
  id: string;
  kind: WorkflowStepKind;
  prompt: string;
  targetSessionId?: string;
  dependsOn?: string[];
  retryLimit?: number;
  /** Explicit input names used by routing/evaluation, never inferred from UI text. */
  inputKey?: string;
  routeBranches?: Array<{ when: string; stepId: string }>;
  defaultBranchStepId?: string;
  evaluateStepId?: string;
  improvementStepId?: string;
}

export interface WorkflowDefinition {
  id: string;
  revision: number;
  name: string;
  mode: WorkflowMode;
  inputSchema: WorkflowSchema;
  outputSchema: WorkflowSchema;
  steps: WorkflowStepDefinition[];
}

export interface WorkflowStepSnapshot {
  id: string;
  kind: WorkflowStepKind;
  status: WorkflowStepStatus;
  attempts: number;
  runId?: string;
  output?: string;
  input?: string;
  selectedBranch?: string;
  error?: string;
  updatedAt: number;
}

export interface WorkflowUsageSummary {
  estimatedTokens: number;
  provider?: TokenUsage;
  cacheRead: number | null;
  cacheMiss: number | null;
}

export interface WorkflowRunSnapshot {
  id: string;
  workflowId: string;
  workflowRevision: number;
  sessionId: string;
  mode: WorkflowMode;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "unknown";
  steps: WorkflowStepSnapshot[];
  output?: string;
  usage: WorkflowUsageSummary;
  artifactIds: string[];
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export interface WorkflowSnapshot {
  revision: number;
  definitions: WorkflowDefinition[];
  runs: WorkflowRunSnapshot[];
}

export interface WorkflowRunInput {
  definition: WorkflowDefinition;
  sessionId: string;
  permissionMode: PermissionMode;
  input: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface WorkflowPersistence {
  load(): Promise<WorkflowSnapshot | undefined>;
  save(snapshot: WorkflowSnapshot): Promise<void>;
}

export interface WorkflowRuntimePort {
  send(intent: AgentIntent): Promise<{ accepted: boolean; queued: boolean; runId?: string; reason?: string }>;
  onRunCompleted(listener: (completion: RunCompletion) => void | Promise<void>): () => void;
  listRuns(sessionId?: string): RunSnapshot[];
  cancelRun(runId: string): Promise<boolean>;
  getSession(sessionId: string): SessionSnapshot | undefined;
}

export interface SubagentRequest {
  parentSessionId: string;
  targetSessionId: string;
  prompt: string;
  permissionMode: PermissionMode;
  signal?: AbortSignal;
}

export interface SubagentReceipt {
  id: string;
  parentSessionId: string;
  targetSessionId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "rejected";
  runId?: string;
  output?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SubagentSnapshot {
  maxConcurrent: number;
  active: SubagentReceipt[];
  recent: SubagentReceipt[];
}

export interface SubagentPersistence {
  load(): Promise<SubagentSnapshot | undefined>;
  save(snapshot: SubagentSnapshot): Promise<void>;
}
