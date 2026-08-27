import { CachePlan, ContextProfile, PermissionMode, ToolPresentation } from "./contracts";
import { ProviderToolDefinition } from "./provider-contracts";

export type WorkspaceMode = "auto" | "shared" | "isolated";
export type WorkspaceStatus =
  | "preparing"
  | "shared"
  | "isolated"
  | "blocked"
  | "commit_ready"
  | "committed"
  | "merge_ready"
  | "merged"
  | "conflicted"
  | "retained"
  | "recoverable";

export type ReviewPolicy = "auto" | "on" | "off";
export type ReviewOutcome = "PASS" | "ISSUES" | "UNPROVEN" | "REVIEW_STOPPED";

/**
 * A UI-safe receipt. Absolute roots may remain in host-owned persistence, but
 * they are never part of the Provider projection.
 */
export interface WorkspaceSnapshot {
  id: string;
  runId: string;
  projectRoot?: string;
  root: string;
  mode: WorkspaceMode;
  status: WorkspaceStatus;
  branchName?: string;
  ownedPaths: string[];
  checksPassed: boolean;
  reviewOutcome?: ReviewOutcome;
  commitMessage?: string;
  taskCommit?: string;
  mergeStatus?: "not-requested" | "ready" | "merged" | "conflicted";
  recoveryUntil?: number;
  reason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface FrozenProviderSnapshot {
  providerId: string;
  profileId: string;
  modelId: string;
  permissionMode?: PermissionMode;
  reasoning?: string;
  tools?: ProviderToolDefinition[];
  cachePlan?: CachePlan;
  contextProfile?: ContextProfile;
}

export interface ReviewResultSummary {
  id: string;
  outcome: ReviewOutcome;
  round: number;
  providerId: string;
  profileId: string;
  modelId: string;
  reasoning?: string;
  findings: string[];
  suggestions: string[];
  usage?: { input: number; output: number; total: number };
  cache?: { hit: number | null; miss: number | null };
  executionCounts: {
    write: number;
    terminal: number;
    commit: number;
    merge: number;
  };
  allowedToolNames: string[];
  stoppedReason?: string;
  createdAt: number;
}

export interface WorkspacePreparationInput {
  mode: WorkspaceMode;
  projectRoot: string;
  runId: string;
  taskName?: string;
  requiresIsolation?: boolean;
  sharedCommitRequested?: boolean;
}

export interface WorkspacePreparationResult {
  workspaceId: string;
  mode: "shared" | "isolated";
  root: string;
  status: WorkspaceStatus;
  reason?: string;
}

export interface WorkspaceChangeEvidence {
  paths: string[];
  presentation?: ToolPresentation;
}
