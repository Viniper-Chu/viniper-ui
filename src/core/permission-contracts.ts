import { PermissionMode, ToolRequest } from "./contracts";
import { AgentEngineId } from "./agent-engine-contracts";

export type ToolApprovalDecision = "allow-once" | "reject";
export type ApprovalHostMode = "interactive" | "fail-closed";
export type PermissionAccessSelection =
  | "standard"
  | "project-run"
  | "project-trusted"
  | "computer-run"
  | "computer-runtime";
export type FullAccessLevel = "project-full" | "computer-full";
export type FullAccessDuration = "run" | "trusted-project" | "runtime";

export interface PermissionAccessGrantSnapshot {
  engineId?: AgentEngineId;
  sessionId?: string;
  runId?: string;
  projectRoot?: string;
  level: FullAccessLevel;
  duration: FullAccessDuration;
}

export interface ToolApprovalRequest {
  id: string;
  approvalId: string;
  engineId: AgentEngineId;
  sessionId: string;
  runId: string;
  callId: string;
  targetItemId: string;
  toolName: string;
  summary: string;
  readOnly: boolean;
  permissionMode: PermissionMode;
  status: "pending";
  createdAt: number;
  startedAt: number;
  recoveryOfApprovalId?: string;
}

export interface ToolApprovalResolutionRecord {
  approvalId: string;
  engineId: AgentEngineId;
  sessionId: string;
  runId: string;
  targetItemId: string;
  decision: "allowed" | "rejected" | "cancelled";
  reason: ToolAuthorizationResolution["reason"];
  startedAt: number;
  completedAt: number;
}

export interface PermissionSnapshot {
  approvalHostMode: ApprovalHostMode;
  pending: ToolApprovalRequest[];
  resolved?: ToolApprovalResolutionRecord[];
  access: {
    pendingRuns: PermissionAccessGrantSnapshot[];
    activeRuns: PermissionAccessGrantSnapshot[];
    runtimeSessions: PermissionAccessGrantSnapshot[];
    trustedProjects: string[];
  };
}

export interface ToolAuthorizationInput {
  engineId?: AgentEngineId;
  sessionId: string;
  runId: string;
  permissionMode: PermissionMode;
  projectRoot?: string;
  tool: ToolRequest;
  signal: AbortSignal;
}

export type ToolAuthorizationResolution =
  | { allowed: true; reason: "auto-read-only" | "auto-approved" | "review-read-only" | "review-project-approved" | "allow-once" | "full-access" | "project-full-access" | "computer-full-access" }
  | { allowed: false; reason: "rejected" | "review-risk-rejected" | "host-fail-closed" | "cancelled" | "plan-read-only"; message: string };

export interface ToolAuthorization {
  state: "allowed" | "pending" | "rejected";
  request?: ToolApprovalRequest;
  resolution: Promise<ToolAuthorizationResolution>;
}
