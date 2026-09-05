import { PermissionMode, ToolRequest } from "../../core/contracts";
import { newId } from "../../core/ids";
import { PermissionAccessPersistence } from "../../core/ports";
import { win32 } from "node:path";
import {
  ApprovalHostMode,
  FullAccessLevel,
  PermissionAccessGrantSnapshot,
  PermissionAccessSelection,
  PermissionSnapshot,
  ToolApprovalDecision,
  ToolApprovalRequest,
  ToolApprovalResolutionRecord,
  ToolAuthorization,
  ToolAuthorizationInput,
  ToolAuthorizationResolution,
} from "../../core/permission-contracts";
import { sessionAgentEngine } from "../../core/agent-engine-contracts";
import { engineScopeOf, engineScopedId } from "../../core/engine-identity";

export type PermissionDecision =
  | { allowed: true; reason: "auto-read-only" | "auto-approved" | "review-read-only" | "review-project-approved" | "full-access" | "project-full-access" | "computer-full-access" }
  | { allowed: false; reason: "approval-required" | "review-risk-rejected" | "plan-read-only"; message?: string };

interface EffectiveAccess {
  level: FullAccessLevel;
  projectRoot?: string;
}

export function decideToolPermission(
  permissionMode: PermissionMode,
  tool: ToolRequest,
  _access?: EffectiveAccess,
  _projectRoot?: string,
): PermissionDecision {
  if (permissionMode === "full") return { allowed: true, reason: "full-access" };
  if (permissionMode === "review") {
    if (tool.readOnly) return { allowed: true, reason: "review-read-only" };
    if (_access?.level === "project-full" && tool.scope === "project" && isReviewProjectActionAllowed(tool, _projectRoot)) {
      return { allowed: true, reason: "review-project-approved" };
    }
    return { allowed: false, reason: "review-risk-rejected", message: "规划自动审核拒绝了越界或高风险动作；未请求人工批准。" };
  }
  if (permissionMode === "auto") {
    if (tool.readOnly) return { allowed: true, reason: "auto-read-only" };
    if (_access?.level === "project-full" && tool.scope === "project") return { allowed: true, reason: "project-full-access" };
    if (_access?.level === "computer-full") return { allowed: true, reason: "computer-full-access" };
    // Accept-edits semantics: project mutations may proceed automatically,
    // while computer/file writes and terminal commands still require a
    // one-shot approval. External coordination remains non-local and keeps its
    // historic auto approval behavior.
    if (tool.name.startsWith("file.") || tool.name.startsWith("terminal.")) {
      return { allowed: false, reason: "approval-required" };
    }
    return { allowed: true, reason: "auto-approved" };
  }
  return { allowed: false, reason: "approval-required" };
}

/**
 * Review mode is intentionally input-sensitive for terminal.run. Project
 * scope alone is not an execution authorization: only a small, auditable set
 * of single-command diagnostics and project lifecycle checks may auto-run.
 * Everything unknown, chained, traversing, or outside the selected project
 * fails closed before a process is started.
 */
function isReviewProjectActionAllowed(tool: ToolRequest, projectRoot?: string): boolean {
  if (tool.name !== "terminal.run") return true;
  if (!projectRoot) return false;
  const command = typeof tool.input?.command === "string" ? tool.input.command.trim() : "";
  if (!command || /[\r\n;|&<>]/u.test(command) || /(^|[\s'"`])\.\.([\\/]|$)/u.test(command)) return false;
  const cwd = typeof tool.input?.cwd === "string" ? tool.input.cwd.trim() : "";
  if (cwd && !isProjectContainedPath(cwd, projectRoot)) return false;
  if (absoluteWindowsPaths(command).some((path) => !isProjectContainedPath(path, projectRoot))) return false;

  if (/^Write-Output(?:\s|$)/iu.test(command)) return true;
  if (/^\[Console\]::Out\.Write(?:Line)?\([^\r\n]*\)$/iu.test(command)) return true;
  if (/^(?:Get-ChildItem|Get-Content|Test-Path|Select-String)(?:\s|$)/iu.test(command)) return true;
  if (/^git\s+(?:status|diff|log)(?:\s|$)/iu.test(command)) return true;

  const purpose = typeof tool.input?.purpose === "string" ? tool.input.purpose : "command";
  if (!["build", "test", "lint", "typecheck"].includes(purpose)) return false;
  return /^(?:npm|pnpm|yarn)(?:\.cmd)?\s+(?:(?:run\s+)?(?:build|test|lint|typecheck|check))(?:\s|$)/iu.test(command);
}

function absoluteWindowsPaths(command: string): string[] {
  return command.match(/(?:[A-Za-z]:[\\/]|\\\\)[^\s'"`;|&<>]*/gu) ?? [];
}

function isProjectContainedPath(candidate: string, projectRoot: string): boolean {
  const normalizedRoot = win32.resolve(projectRoot);
  const normalizedCandidate = win32.isAbsolute(candidate)
    ? win32.resolve(candidate)
    : win32.resolve(normalizedRoot, candidate);
  const relative = win32.relative(normalizedRoot, normalizedCandidate);
  return relative === "" || (!relative.startsWith("..") && !win32.isAbsolute(relative));
}

interface PendingAuthorization {
  request: ToolApprovalRequest;
  resolution: Promise<ToolAuthorizationResolution>;
  resolve: (resolution: ToolAuthorizationResolution) => void;
  removeAbortListener: () => void;
}

interface PendingRunGrant {
  sessionId: string;
  level: FullAccessLevel;
  projectRoot?: string;
}

interface ActiveRunGrant extends PendingRunGrant {
  runId: string;
}

export class PermissionPolicy {
  private readonly pending = new Map<string, PendingAuthorization>();
  private readonly resolved: ToolApprovalResolutionRecord[] = [];
  private readonly pendingRunGrants = new Map<string, PendingRunGrant>();
  private readonly activeRunGrants = new Map<string, ActiveRunGrant>();
  private readonly runtimeSessionGrants = new Map<string, PendingRunGrant>();
  private readonly trustedProjectRoots = new Map<string, string>();
  private initialized = false;

  constructor(
    private readonly approvalHostMode: ApprovalHostMode = "interactive",
    private readonly now: () => number = Date.now,
    private readonly persistence?: PermissionAccessPersistence,
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    for (const root of await (this.persistence?.loadTrustedProjectRoots() ?? Promise.resolve([]))) {
      if (root.trim()) this.trustedProjectRoots.set(normalizePath(root), root.trim());
    }
    this.initialized = true;
  }

  async setAccess(
    sessionId: string,
    projectRoot: string | undefined,
    selection: PermissionAccessSelection,
  ): Promise<boolean> {
    this.pendingRunGrants.delete(sessionId);
    this.runtimeSessionGrants.delete(sessionId);
    if (projectRoot) this.trustedProjectRoots.delete(normalizePath(projectRoot));

    switch (selection) {
      case "standard":
        break;
      case "project-run":
        if (!projectRoot) return false;
        this.pendingRunGrants.set(sessionId, {
          sessionId,
          level: "project-full",
          projectRoot: normalizePath(projectRoot),
        });
        break;
      case "project-trusted":
        if (!projectRoot) return false;
        this.trustedProjectRoots.set(normalizePath(projectRoot), projectRoot);
        break;
      case "computer-run":
        this.pendingRunGrants.set(sessionId, { sessionId, level: "computer-full" });
        break;
      case "computer-runtime":
        this.runtimeSessionGrants.set(sessionId, { sessionId, level: "computer-full" });
        break;
    }
    await this.persistTrustedProjects();
    return true;
  }

  freezeRun(sessionId: string, runId: string, projectRoot?: string): void {
    const pending = this.pendingRunGrants.get(sessionId);
    if (pending) {
      this.pendingRunGrants.delete(sessionId);
      if (pending.level === "project-full" && !samePath(pending.projectRoot, projectRoot)) return;
      this.activeRunGrants.set(runId, { ...pending, runId });
      return;
    }
    const runtime = this.runtimeSessionGrants.get(sessionId);
    if (runtime) {
      this.activeRunGrants.set(runId, { ...runtime, runId });
      return;
    }
    if (projectRoot && this.trustedProjectRoots.has(normalizePath(projectRoot))) {
      this.activeRunGrants.set(runId, {
        sessionId,
        runId,
        level: "project-full",
        projectRoot: normalizePath(projectRoot),
      });
    }
  }

  begin(input: ToolAuthorizationInput): ToolAuthorization {
    if (input.signal.aborted) {
      return {
        state: "rejected",
        resolution: Promise.resolve({ allowed: false, reason: "cancelled", message: "运行已取消，工具未执行。" }),
      };
    }
    if (input.permissionMode === "plan" && !input.tool.readOnly) {
      return {
        state: "rejected",
        resolution: Promise.resolve({
          allowed: false,
          reason: "plan-read-only",
          message: "计划模式只允许只读工具；本次副作用工具未执行。",
        }),
      };
    }
    const decision = decideToolPermission(
      input.permissionMode,
      input.tool,
      this.effectiveAccess(input.sessionId, input.runId, input.projectRoot),
      input.projectRoot,
    );
    if (decision.allowed) return { state: "allowed", resolution: Promise.resolve(decision) };
    if (decision.reason === "review-risk-rejected") {
      return {
        state: "rejected",
        resolution: Promise.resolve({ allowed: false, reason: decision.reason, message: decision.message ?? "规划自动审核拒绝了本次动作。" }),
      };
    }
    if (this.approvalHostMode === "fail-closed") {
      return {
        state: "rejected",
        resolution: Promise.resolve({
          allowed: false,
          reason: "host-fail-closed",
          message: "当前入口不支持交互批准，工具已安全拒绝；请在桌面端使用批准界面。",
        }),
      };
    }

    const engineId = sessionAgentEngine(input.engineId ?? engineScopeOf(input.runId) ?? engineScopeOf(input.sessionId));
    const key = approvalKey(engineId, input.sessionId, input.runId, input.tool.id);
    const existing = this.pending.get(key);
    if (existing) return { state: "pending", request: clone(existing.request), resolution: existing.resolution };
    const rawApprovalId = newId("approval");
    const approvalId = engineScopedId(engineId, "approval", rawApprovalId);
    const startedAt = this.now();
    const request: ToolApprovalRequest = {
      id: approvalId,
      approvalId,
      engineId,
      sessionId: input.sessionId,
      runId: input.runId,
      callId: input.tool.id,
      targetItemId: engineScopeOf(input.tool.id)
        ? input.tool.id
        : engineScopedId(engineId, "item", input.tool.id),
      toolName: input.tool.name,
      summary: input.tool.summary,
      readOnly: input.tool.readOnly,
      permissionMode: input.permissionMode,
      status: "pending",
      createdAt: startedAt,
      startedAt,
    };
    let resolve!: (resolution: ToolAuthorizationResolution) => void;
    const resolution = new Promise<ToolAuthorizationResolution>((complete) => { resolve = complete; });
    const abort = () => this.finish(key, {
      allowed: false,
      reason: "cancelled",
      message: "运行已取消，待批准工具未执行。",
    });
    input.signal.addEventListener("abort", abort, { once: true });
    this.pending.set(key, {
      request,
      resolution,
      resolve,
      removeAbortListener: () => input.signal.removeEventListener("abort", abort),
    });
    if (input.signal.aborted) abort();
    return { state: "pending", request: clone(request), resolution };
  }

  resolve(sessionId: string, runId: string, callId: string, decision: ToolApprovalDecision): boolean {
    const entry = [...this.pending.entries()].find(([, pending]) =>
      pending.request.sessionId === sessionId
      && pending.request.runId === runId
      && pending.request.callId === callId);
    if (!entry) return false;
    const [key] = entry;
    return this.finish(key, decision === "allow-once"
      ? { allowed: true, reason: "allow-once" }
      : { allowed: false, reason: "rejected", message: "用户已拒绝本次工具调用；工具未执行。" });
  }

  snapshot(): PermissionSnapshot {
    return {
      approvalHostMode: this.approvalHostMode,
      pending: [...this.pending.values()]
        .map((entry) => clone(entry.request))
        .sort((left, right) => left.createdAt - right.createdAt),
      resolved: this.resolved.map((record) => clone(record)),
      access: {
        pendingRuns: [...this.pendingRunGrants.values()].map((grant) => snapshotGrant(grant, "run")),
        activeRuns: [...this.activeRunGrants.values()].map((grant) => snapshotGrant(grant, "run")),
        runtimeSessions: [...this.runtimeSessionGrants.values()].map((grant) => snapshotGrant(grant, "runtime")),
        trustedProjects: [...this.trustedProjectRoots.values()].sort((left, right) => left.localeCompare(right, "en")),
      },
    };
  }

  cancelRun(runId: string): void {
    this.activeRunGrants.delete(runId);
    for (const [key, pending] of this.pending.entries()) {
      if (pending.request.runId !== runId) continue;
      this.finish(key, {
        allowed: false,
        reason: "cancelled",
        message: "运行已结束，待批准工具未执行。",
      });
    }
  }

  private effectiveAccess(sessionId: string, runId: string, projectRoot?: string): EffectiveAccess | undefined {
    const run = this.activeRunGrants.get(runId);
    if (run?.sessionId === sessionId) return { level: run.level, projectRoot: run.projectRoot };
    const runtime = this.runtimeSessionGrants.get(sessionId);
    if (runtime) return { level: runtime.level, projectRoot: runtime.projectRoot };
    if (projectRoot && this.trustedProjectRoots.has(normalizePath(projectRoot))) {
      return { level: "project-full", projectRoot: normalizePath(projectRoot) };
    }
    return undefined;
  }

  private async persistTrustedProjects(): Promise<void> {
    await this.persistence?.saveTrustedProjectRoots(
      [...this.trustedProjectRoots.values()].sort((a, b) => a.localeCompare(b, "en")),
    );
  }

  private finish(key: string, resolution: ToolAuthorizationResolution): boolean {
    const pending = this.pending.get(key);
    if (!pending) return false;
    this.pending.delete(key);
    pending.removeAbortListener();
    this.resolved.push({
      approvalId: pending.request.approvalId,
      engineId: pending.request.engineId,
      sessionId: pending.request.sessionId,
      runId: pending.request.runId,
      targetItemId: pending.request.targetItemId,
      decision: resolution.allowed ? "allowed" : resolution.reason === "cancelled" ? "cancelled" : "rejected",
      reason: resolution.reason,
      startedAt: pending.request.startedAt,
      completedAt: this.now(),
    });
    if (this.resolved.length > 128) this.resolved.splice(0, this.resolved.length - 128);
    pending.resolve(resolution);
    return true;
  }
}

function approvalKey(engineId: string, sessionId: string, runId: string, callId: string): string {
  return `${engineId}:${sessionId}:${runId}:${callId}`;
}

function snapshotGrant(
  grant: PendingRunGrant | ActiveRunGrant,
  duration: "run" | "runtime",
): PermissionAccessGrantSnapshot {
  return {
    sessionId: grant.sessionId,
    ...("runId" in grant ? { runId: grant.runId } : {}),
    ...(grant.projectRoot ? { projectRoot: grant.projectRoot } : {}),
    level: grant.level,
    duration,
  };
}

function normalizePath(value: string): string {
  const trimmed = value.trim().replace(/[\\/]+$/u, "");
  return process.platform === "win32" ? trimmed.toLocaleLowerCase("en-US") : trimmed;
}

function samePath(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && normalizePath(left) === normalizePath(right));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
