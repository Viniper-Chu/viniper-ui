import {
  AgentIntent,
  AgentMessage,
  ActivityRecord,
  IntentOrigin,
  PermissionMode,
  PRODUCT_BADGE,
  PRODUCT_VERSION,
  RELEASE_STAGE,
  RunCompletion,
  ToolRequest,
  RuntimeEvent,
  RuntimeEventType,
  RuntimeSnapshot,
  SessionSnapshot,
  RunSnapshot,
  RunStatus,
  RuntimeTurnDiffSnapshot,
} from "../../core/contracts";
import { FrozenProviderSnapshot, ReviewPolicy, WorkspaceMode } from "../../core/programming-contracts";
import { CoordinationWait } from "../../core/coordination-contracts";
import { LoadedSkill } from "../../core/extension-contracts";
import { ProjectInstructionSnapshot } from "../../core/instruction-contracts";
import {
  PermissionAccessSelection,
  ToolApprovalDecision,
  ToolApprovalRequest,
} from "../../core/permission-contracts";
import { newId } from "../../core/ids";
import { RuntimePersistence } from "../../core/ports";
import { ProviderHistoryEntry, ProviderRequest, ProviderToolCallItem } from "../../core/provider-contracts";
import { AgentEngineId, DEFAULT_AGENT_ENGINE, sessionAgentEngine } from "../../core/agent-engine-contracts";
import { TokenUsage } from "../../core/telemetry-contracts";
import {
  buildCachePlan,
  buildContextProfile,
  stableContextSkills,
  stableContextTools,
} from "../cache/cache-plan";
import { ProviderRegistry } from "../providers/provider-registry";
import { enqueueIntent, takeNextIntent } from "../queue/intent-queue";
import { SessionCatalog } from "../sessions/session-catalog";
import { applyRuntimeEvent } from "../sessions/session-reducer";
import { TokenLedger } from "../telemetry/token-ledger";
import { ProjectInstructionLoader } from "../instructions/project-instruction-service";
import { PermissionPolicy } from "../permissions/permission-policy";
import { DemoReadOnlyTool } from "../tools/demo-tool";
import { ToolRegistry } from "../tools/tool-registry";
import { ProjectChangeResult, ProjectFilesystem } from "../programming/contracts";
import { changePresentation } from "../programming/project-tools";
import { ToolResourceCoordinator } from "../tools/resource-lock";
import { dispatchToolCall } from "./tool-loop/agent-tool-loop";
import { ManagedArtifactService } from "../tool-output/managed-artifact-service";
import { projectProviderEvent } from "./provider-event-projector";
import { WorkspaceService } from "../workspaces/workspace-service";
import { ReviewService } from "../review/review-service";
import { GitService } from "../git/contracts";
import { REVIEW_READ_ONLY_TOOLS } from "../review/contracts";
import { MemoryService } from "../memory/memory-service";
import { ContextCompactionService } from "./context-compaction-service";
import { SmartRoutingService } from "../providers/model-routing-service";
import { RoutingDecision } from "../../core/routing-contracts";
import { SessionQuery, SessionQueryResult } from "../../core/session-query-contracts";
import { querySessions } from "../sessions/session-query";
import { ProviderTransportError } from "../providers/protocols/shared/provider-transport";
import type { ExtensionRunSnapshot } from "../extensions/extension-manager";
import { CompositionService } from "../composition/composition-service";
import { freezeRunContext } from "../composition/frozen-run-context";
import { LifecycleInterceptorService } from "../composition/lifecycle-interceptors";
import { RunSteeringService, SteeringReceipt } from "../composition/run-steering";
import { LifecyclePhase } from "../../core/lifecycle-contracts";
import type { CodeSubcallInput, CodeSubcallResult } from "../../core/code-mode-contracts";
import { recoverDanglingToolCalls } from "./provider-history-recovery";
import { CodeRuntimeService } from "../code-mode/code-runtime";
import { createRunCodeTool } from "../code-mode/run-code-tool";
import type { ToolExecutionContext } from "../tools/tool-registry";
import type { FrozenRunContext } from "../../core/composition-contracts";
import { engineScopedId, engineScopeOf } from "../../core/engine-identity";
import { runtimeErrorEnvelope } from "../../core/runtime-error-contracts";
import { ClaudeCodeEngineAdapter, ViniperEngineAdapter } from "../agent-engines/engine-adapters";
import { relevantFileTools, toolsForCurrentTurn } from "./current-turn-tools";

export interface SendResult {
  accepted: boolean;
  queued: boolean;
  reason?: string;
}

export type RuntimeListener = (snapshot: RuntimeSnapshot) => void;
export type RunCompletionListener = (completion: RunCompletion) => void | Promise<void>;

interface RunControl {
  runId: string;
  controller: AbortController;
  origin: IntentOrigin;
  text: string;
  userText?: string;
  status: RunStatus;
  createdAt: number;
  recovery?: boolean;
  workspaceMode?: WorkspaceMode;
  reviewPolicy?: ReviewPolicy;
  commitRequested?: boolean;
  workspaceId?: string;
  providerSnapshot?: FrozenProviderSnapshot;
  routing?: RoutingDecision;
  routingRequest?: AgentIntent["routing"];
  providerAttempt?: import("../../core/provider-runtime-contracts").ProviderAttemptSnapshot;
  frozenContext?: FrozenRunContext;
  memoryEnabled?: boolean;
  planning?: boolean;
}

export interface RunSkillLoader {
  loadForRun(sessionId: string): Promise<LoadedSkill[]>;
}

export interface ProviderRequestLimits {
  review?: number;
  fullAccess?: number;
}

export function resolveProviderRequestLimit(
  permissionMode: PermissionMode,
  overrides?: ProviderRequestLimits,
): number {
  const configured = permissionMode === "review" ? overrides?.review : overrides?.fullAccess;
  if (Number.isInteger(configured) && Number(configured) > 0) return Number(configured);
  return permissionMode === "review" ? 6 : 10;
}

export interface AgentRuntimeOptions {
  persistence: RuntimePersistence;
  defaultWorkingDirectory: string;
  defaultProjectAccess?: SessionSnapshot["projectAccess"];
  tokenLedger: TokenLedger;
  skillLoader?: RunSkillLoader;
  instructionLoader?: ProjectInstructionLoader;
  permissionPolicy?: PermissionPolicy;
  registry: ProviderRegistry;
  toolRegistry: ToolRegistry;
  projectFilesystem?: ProjectFilesystem;
  workspaceService?: WorkspaceService;
  gitService?: GitService;
  reviewService?: ReviewService;
  memoryService?: MemoryService;
  compactionService?: ContextCompactionService;
  routingService?: SmartRoutingService;
  artifactService?: ManagedArtifactService;
  extensionSnapshotProvider?: () => ExtensionRunSnapshot;
  now?: () => number;
  maxConcurrentRuns?: number;
  maxPendingRuns?: number;
  maxSessionQueue?: number;
  /** Host-owned bounded acceptance override. Production defaults remain review=6/fullAccess=10. */
  providerRequestLimits?: ProviderRequestLimits;
  modelAvailability?: (providerId: string, modelId: string) => boolean;
  composition?: CompositionService;
  lifecycle?: LifecycleInterceptorService;
  steering?: RunSteeringService;
  codeRuntime?: CodeRuntimeService;
  viniperEngineAdapter?: ViniperEngineAdapter;
  claudeCodeEngineAdapter?: ClaudeCodeEngineAdapter;
}

export class AgentRuntime {
  private readonly catalog = new SessionCatalog();
  private readonly listeners = new Set<RuntimeListener>();
  private readonly completionListeners = new Set<RunCompletionListener>();
  private readonly runs = new Map<string, RunControl>();
  private readonly sessionRuns = new Map<string, Set<string>>();
  private readonly runSnapshots = new Map<string, RunSnapshot>();
  private readonly pendingRuns: RunControl[] = [];
  private maxConcurrentRuns: number;
  private readonly maxPendingRuns: number;
  private readonly maxSessionQueue: number;
  private readonly registry: ProviderRegistry;
  private readonly toolRegistry: ToolRegistry;
  private readonly now: () => number;
  private readonly permissionPolicy: PermissionPolicy;
  private readonly resourceCoordinator = new ToolResourceCoordinator();
  private persistChain: Promise<void> = Promise.resolve();
  private readonly runTasks = new Map<string, Promise<void>>();
  private readonly turnUsageProjection = new Map<string, { signature: string; projectedAt: number }>();
  private readonly composition: CompositionService;
  private readonly lifecycle: LifecycleInterceptorService;
  private readonly steering: RunSteeringService;
  private readonly codeRuntime: CodeRuntimeService;
  private readonly viniperEngineAdapter: ViniperEngineAdapter;
  private readonly claudeCodeEngineAdapter?: ClaudeCodeEngineAdapter;

  constructor(private readonly options: AgentRuntimeOptions) {
    this.registry = options.registry;
    this.toolRegistry = options.toolRegistry;
    this.now = options.now ?? Date.now;
    this.permissionPolicy = options.permissionPolicy ?? new PermissionPolicy("interactive", options.now ?? Date.now);
    this.composition = options.composition ?? new CompositionService();
    this.lifecycle = options.lifecycle ?? new LifecycleInterceptorService();
    this.steering = options.steering ?? new RunSteeringService(this.now);
    this.codeRuntime = options.codeRuntime ?? new CodeRuntimeService();
    this.viniperEngineAdapter = options.viniperEngineAdapter ?? new ViniperEngineAdapter();
    this.claudeCodeEngineAdapter = options.claudeCodeEngineAdapter;
    if (!this.toolRegistry.has("demo.read-only-preview")) this.toolRegistry.register(new DemoReadOnlyTool());
    if (!this.toolRegistry.has("run_code")) this.toolRegistry.register(createRunCodeTool(this.codeRuntime));
    this.maxConcurrentRuns = Math.min(8, Math.max(1, Math.floor(options.maxConcurrentRuns ?? 3)));
    this.maxPendingRuns = Math.min(512, Math.max(1, Math.floor(options.maxPendingRuns ?? 128)));
    this.maxSessionQueue = Math.min(256, Math.max(1, Math.floor(options.maxSessionQueue ?? 64)));
  }

  async initialize(): Promise<void> {
    await this.permissionPolicy.initialize();
    const saved = await this.options.persistence.load();
    if (saved && saved.application.sessions.length > 0) {
      const eventsBySession = new Map<string, RuntimeEvent[]>();
      for (const event of saved.events) {
        const events = eventsBySession.get(event.sessionId) ?? [];
        events.push(event);
        eventsBySession.set(event.sessionId, events);
      }
      let recoveredHistory = false;
      const normalizedSessions = saved.application.sessions.map((session) => {
        const recovery = recoverDanglingToolCalls(session.providerHistory);
        if (recovery.changed) recoveredHistory = true;
        return recovery.changed ? { ...session, providerHistory: recovery.history } : session;
      });
      const recoveryCandidates: Array<{ sessionId: string; runId: string; text: string; origin: IntentOrigin; createdAt: number }> = [];
      const sessions: SessionSnapshot[] = normalizedSessions.map((session) => {
        const persistedEvents = [...(eventsBySession.get(session.id) ?? [])]
          .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
        const engineId = sessionAgentEngine(session.engineId);
        const restored: SessionSnapshot = { ...session, engineId, items: session.items ?? [], events: [] };
        if (session.replayCursor === undefined) {
          restored.events = persistedEvents.map((event) => normalizeRuntimeEvent(event, engineId, session.id));
          restored.replayCursor = Math.max(0, ...restored.events.map((event) => event.sequence ?? 0));
        } else {
          for (const raw of persistedEvents) {
            const event = normalizeRuntimeEvent(raw, engineId, session.id);
            if ((event.sequence ?? 0) <= session.replayCursor) restored.events.push(event);
            else applyRuntimeEvent(restored, event);
          }
        }
        const unfinished = unfinishedRunEntries(restored);
        if (unfinished.length > 0) {
          restored.activeRunIds = unfinished.map((item) => item.runId);
          restored.activeRunId = unfinished[0].runId;
          restored.status = "running";
          recoveryCandidates.push(...unfinished.map((item) => ({ sessionId: restored.id, ...item })));
        } else if (restored.status === "running") {
          delete restored.activeRunId;
          delete restored.activeRunIds;
          restored.status = restored.queue.length ? "queued" : restored.waitingFor ? "waiting" : "idle";
        }
        return restored;
      });
      if (recoveredHistory) {
        await this.options.persistence.saveSnapshot({
          ...saved.application,
          sessions: normalizedSessions,
        });
      }
      this.catalog.restore(sessions, saved.application.activeSessionId);
      this.publish();
      if (recoveryCandidates.length > 0) {
        setTimeout(() => { void this.recoverRuns(recoveryCandidates); }, 0);
      }
      return;
    }

    this.catalog.create(this.options.defaultWorkingDirectory, this.now(), this.options.defaultProjectAccess);
    await this.persistSnapshot();
    this.publish();
  }

  subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  onRunCompleted(listener: RunCompletionListener): () => void {
    this.completionListeners.add(listener);
    return () => this.completionListeners.delete(listener);
  }

  registerLifecycleInterceptor(definition: import("../../core/lifecycle-contracts").LifecycleInterceptorDefinition): () => void {
    return this.lifecycle.register(definition);
  }

  async steer(runId: string, message: string): Promise<SteeringReceipt> {
    const receipt = this.steering.steer(runId, message);
    await this.recordSteeringReceipt(receipt);
    if (receipt.status === "queued") this.steering.interrupt(runId);
    this.publish();
    return clone(receipt);
  }

  async inject(runId: string, context: Record<string, unknown>): Promise<SteeringReceipt> {
    const receipt = this.steering.inject(runId, context);
    await this.recordSteeringReceipt(receipt);
    this.publish();
    return clone(receipt);
  }

  async clearSteering(runId: string): Promise<SteeringReceipt[]> {
    const receipts = this.steering.clear(runId);
    for (const receipt of receipts) await this.recordSteeringReceipt(receipt);
    if (receipts.length) this.publish();
    return clone(receipts);
  }

  listSteering(runId?: string): SteeringReceipt[] {
    return this.steering.snapshot(runId);
  }

  snapshot(): RuntimeSnapshot {
    return clone({
      productVersion: PRODUCT_VERSION,
      releaseStage: RELEASE_STAGE,
      productBadge: PRODUCT_BADGE,
      activeSessionId: this.catalog.getActiveSessionId(),
      sessions: this.catalog.sorted().map((session) => {
        const sessionRuns = this.activeRunIdsForSession(session.id);
        const hasRunning = sessionRuns.some((runId) => {
          const status = this.runs.get(runId)?.status;
          return status === "running" || status === "waiting_resource" || status === "recovering" || status === "replaying";
        });
        const hasQueued = sessionRuns.some((runId) => this.runs.get(runId)?.status === "queued");
        const modelUnavailable = this.options.modelAvailability
          ? !this.options.modelAvailability(session.selectedProviderId, session.selectedModel)
          : session.modelUnavailable;
        const withModelState = modelUnavailable === undefined
          ? session
          : { ...session, modelUnavailable };
        if (hasRunning && session.status !== "running") return { ...withModelState, status: "running" as const };
        if (!hasRunning && hasQueued && session.status === "idle") return { ...withModelState, status: "queued" as const };
        return withModelState;
      }),
      runs: [...this.runSnapshots.values()].sort((left, right) => left.createdAt - right.createdAt),
      providers: this.registry.list(),
      permissions: this.permissionPolicy.snapshot(),
      workspaces: this.options.workspaceService?.list() ?? [],
      reviews: this.options.reviewService?.list() ?? [],
      ...(this.options.routingService ? { smartRouting: this.options.routingService.snapshot() } : {}),
      ...(this.options.memoryService ? { memories: this.options.memoryService.snapshot() } : {}),
      ...(this.options.compactionService ? { contextCompaction: this.options.compactionService.snapshot() } : {}),
      composition: this.composition.snapshot("any"),
      steering: { receipts: this.steering.snapshot() },
      lifecycle: { active: this.lifecycle.snapshot().length },
    });
  }

  getSession(sessionId: string): SessionSnapshot | undefined {
    return clone(this.catalog.get(sessionId));
  }

  listSessions(): SessionSnapshot[] {
    return clone(this.catalog.values());
  }

  querySessions(query: SessionQuery = {}): SessionQueryResult {
    return querySessions(this.catalog.values(), query);
  }

  isRunning(sessionId: string): boolean {
    return this.activeRunIdsForSession(sessionId).some((runId) => this.runs.get(runId)?.status === "running");
  }

  listRuns(sessionId?: string): RunSnapshot[] {
    return clone([...this.runSnapshots.values()]
      .filter((run) => !sessionId || run.sessionId === sessionId)
      .sort((left, right) => left.createdAt - right.createdAt));
  }

  async setMaxConcurrentRuns(value: number): Promise<boolean> {
    if (!Number.isInteger(value) || value < 1 || value > 8) return false;
    this.maxConcurrentRuns = value;
    await this.drainRunQueue();
    this.publish();
    return true;
  }

  hasActiveScheduleRun(scheduleId: string): boolean {
    return [...this.runSnapshots.values()].some((run) => run.origin.scheduleId === scheduleId
      && (run.status === "queued" || run.status === "running" || run.status === "waiting_resource" || run.status === "recovering" || run.status === "replaying"));
  }

  async cancelRun(runId: string): Promise<boolean> {
    const control = this.runs.get(runId);
    if (control?.status === "running") {
      const sessionId = this.runSnapshots.get(runId)?.sessionId;
      const session = sessionId ? this.catalog.get(sessionId) : undefined;
      if (session) await this.recordRun(session, "interrupt.requested", { runId, requestedAt: this.now() }, runId);
      control.controller.abort();
      if (session) await this.recordRun(session, "interrupt.acknowledged", { runId, acknowledgedAt: this.now() }, runId);
      return true;
    }
    const index = this.pendingRuns.findIndex((run) => run.runId === runId);
    if (index < 0) return false;
    const [queued] = this.pendingRuns.splice(index, 1);
    queued.status = "cancelled";
    this.updateRunSnapshot(queued, "cancelled");
    this.runs.delete(runId);
    const sessionId = this.runSnapshots.get(runId)?.sessionId;
    const actualSession = sessionId ? this.catalog.get(sessionId) : undefined;
    if (actualSession) {
      await this.recordRun(actualSession, "interrupt.requested", { runId, requestedAt: this.now() }, runId);
      await this.recordRun(actualSession, "run.cancelled", { runId }, runId);
      await this.recordRun(actualSession, "interrupt.acknowledged", { runId, acknowledgedAt: this.now() }, runId);
    }
    if (sessionId) this.removeSessionRun(sessionId, runId);
    await this.drainRunQueue();
    return true;
  }

  async selectRun(runId: string): Promise<boolean> {
    return this.runSnapshots.has(runId);
  }

  providerRegistry(): ProviderRegistry {
    return this.registry;
  }

  pendingToolApprovals(): ToolApprovalRequest[] {
    return clone(this.permissionPolicy.snapshot().pending);
  }

  async resolveToolApproval(
    sessionId: string,
    runId: string,
    callId: string,
    decision: ToolApprovalDecision,
  ): Promise<boolean> {
    const session = this.catalog.get(sessionId);
    if (!session || sessionAgentEngine(session.engineId) !== "viniper") return false;
    const resolved = this.permissionPolicy.resolve(sessionId, runId, callId, decision);
    if (resolved) this.publish();
    return resolved;
  }

  async createSession(
    workingDirectory = this.options.defaultWorkingDirectory,
    projectAccess?: SessionSnapshot["projectAccess"],
    engineId: AgentEngineId = DEFAULT_AGENT_ENGINE,
  ): Promise<SessionSnapshot> {
    const session = this.catalog.create(workingDirectory, this.now(), projectAccess, engineId);
    await this.persistSnapshot();
    this.publish();
    return clone(session);
  }

  async createProjectSession(
    path: string,
    selectedBy: "desktop-picker" | "cli-explicit" = "desktop-picker",
    engineId: AgentEngineId = DEFAULT_AGENT_ENGINE,
  ): Promise<SessionSnapshot> {
    const projectRoot = await this.canonicalizeProjectRoot(path);
    return this.createSession(projectRoot, { enabled: true, selectedBy }, engineId);
  }

  async enableProjectAccess(
    sessionId: string,
    path: string,
    selectedBy: "desktop-picker" | "cli-explicit" = "cli-explicit",
  ): Promise<SessionSnapshot> {
    const session = this.catalog.get(sessionId);
    if (!session) throw new Error("会话不存在；未改变项目工作目录。");
    if (this.hasSessionRuns(sessionId)) throw new Error("会话正在运行；未改变项目工作目录。");
    const projectRoot = await this.canonicalizeProjectRoot(path);
    if (session.projectAccess?.enabled === true && samePath(session.workingDirectory, projectRoot)) {
      return clone(session);
    }
    await this.advanceContextProfile(session, {
      workingDirectory: projectRoot,
      projectAccess: { enabled: true, selectedBy },
    });
    return clone(session);
  }

  /**
   * Merge non-conflicting sessions from a validated local archive.  The
   * archive service owns validation; Runtime remains the only writer of the
   * canonical session catalog and deliberately never reactivates imported
   * unfinished runs.
   */
  async importSessions(incoming: SessionSnapshot[]): Promise<number> {
    const existing = new Map(this.catalog.values().map((session) => [session.id, session]));
    let added = 0;
    for (const source of incoming) {
      if (!source?.id || existing.has(source.id)) continue;
      const session = clone(source);
      delete session.activeRunId;
      delete session.activeRunIds;
      session.status = session.queue.length ? "queued" : session.waitingFor ? "waiting" : "idle";
      existing.set(session.id, session);
      added += 1;
    }
    if (added === 0) return 0;
    this.catalog.restore([...existing.values()], this.catalog.getActiveSessionId());
    await this.persistSnapshot();
    this.publish();
    return added;
  }

  async ensureProjectSession(path: string, engineId: AgentEngineId = DEFAULT_AGENT_ENGINE): Promise<SessionSnapshot> {
    const projectRoot = await this.canonicalizeProjectRoot(path);
    const existing = this.catalog.values().find((session) =>
      session.projectAccess?.enabled === true
      && sessionAgentEngine(session.engineId) === engineId
      && samePath(session.workingDirectory, projectRoot));
    if (existing) {
      await this.setActiveSession(existing.id);
      return clone(existing);
    }
    return this.createSession(projectRoot, { enabled: true, selectedBy: "cli-explicit" }, engineId);
  }

  async setActiveSession(sessionId: string): Promise<boolean> {
    if (!this.catalog.setActive(sessionId)) return false;
    const session = this.catalog.get(sessionId)!;
    if (session.unread) await this.record(session, "session.updated", { unread: false });
    else {
      await this.persistSnapshot();
      this.publish();
    }
    return true;
  }

  async renameSession(sessionId: string, title: string): Promise<boolean> {
    const session = this.catalog.get(sessionId);
    const nextTitle = title.trim();
    if (!session || this.hasSessionRuns(sessionId) || !nextTitle) return false;
    await this.record(session, "session.updated", { title: nextTitle });
    return true;
  }

  async togglePinned(sessionId: string): Promise<boolean> {
    const session = this.catalog.get(sessionId);
    if (!session) return false;
    await this.record(session, "session.updated", { pinned: !session.pinned });
    return true;
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    if (!this.catalog.has(sessionId) || this.hasSessionRuns(sessionId)) return false;
    this.catalog.remove(sessionId);
    if (this.catalog.size === 0) {
      this.catalog.create(this.options.defaultWorkingDirectory, this.now(), this.options.defaultProjectAccess);
    }
    await this.persistSnapshot();
    this.publish();
    return true;
  }

  async setModel(sessionId: string, selectedModel: string): Promise<boolean> {
    const session = this.catalog.get(sessionId);
    if (!session || this.hasSessionRuns(sessionId)) return false;
    const provider = this.registry.list().find((item) => item.id === session.selectedProviderId);
    if (!provider?.available || !provider.models.some((model) => model.id === selectedModel)) return false;
    await this.advanceContextProfile(session, { selectedModel });
    return true;
  }

  async setReasoning(sessionId: string, reasoning = "medium"): Promise<boolean> {
    const session = this.catalog.get(sessionId);
    if (!session || this.hasSessionRuns(sessionId) || sessionAgentEngine(session.engineId) !== "viniper") return false;
    if (reasoning !== undefined && !["off", "none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(reasoning)) return false;
    await this.record(session, "session.updated", { reasoning });
    return true;
  }

  async setProviderModel(sessionId: string, providerId: string, selectedModel: string): Promise<boolean> {
    const session = this.catalog.get(sessionId);
    if (!session || this.hasSessionRuns(sessionId)) return false;
    const provider = this.registry.list().find((item) => item.id === providerId);
    if (!provider?.available || !provider.models.some((model) => model.id === selectedModel)) return false;
    await this.advanceContextProfile(session, { selectedProviderId: providerId, selectedModel });
    return true;
  }

  async setPermissionMode(sessionId: string, permissionMode: PermissionMode): Promise<boolean> {
    const session = this.catalog.get(sessionId);
    if (!session || this.hasSessionRuns(sessionId)) return false;
    await this.record(session, "session.updated", { permissionMode });
    return true;
  }

  async setPermissionAccess(sessionId: string, selection: PermissionAccessSelection): Promise<boolean> {
    const session = this.catalog.get(sessionId);
    if (!session || this.hasSessionRuns(sessionId) || sessionAgentEngine(session.engineId) !== "viniper") return false;
    const projectRoot = session.projectAccess?.enabled === true ? session.workingDirectory : undefined;
    const changed = await this.permissionPolicy.setAccess(sessionId, projectRoot, selection);
    if (changed) this.publish();
    return changed;
  }

  async restoreProjectChange(sessionId: string, receiptId: string): Promise<ProjectChangeResult> {
    const session = this.catalog.get(sessionId);
    if (!session?.projectAccess?.enabled || this.hasSessionRuns(sessionId) || !this.options.projectFilesystem) {
      return {
        ok: false,
        action: "restore",
        paths: [],
        beforeBytes: 0,
        afterBytes: 0,
        source: "live",
        error: {
          code: "RECOVERY_NOT_FOUND",
          message: "当前会话未打开项目、正在运行，或恢复服务不可用。",
          sentToModel: false,
        },
      };
    }
    const activityId = newId("restore-activity");
    const callId = newId("restore-call");
    const requested: ActivityRecord = {
      id: activityId,
      kind: "tool",
      title: "恢复项目删除",
      detail: `恢复回执 ${receiptId}`,
      status: "running",
      readOnly: false,
      callId,
      toolName: "project.restore-user-action",
      createdAt: this.now(),
    };
    await this.record(session, "tool.requested", requested);
    const controller = new AbortController();
    const lease = await this.resourceCoordinator.acquire(
      [{ key: session.workingDirectory, access: "write" }],
      controller.signal,
    );
    try {
      const result = await this.options.projectFilesystem.restore(
        session.workingDirectory,
        { receiptId },
        { sessionId, runId: newId("restore-run") },
        controller.signal,
      );
      const display = result.ok
        ? `已从回执 ${receiptId} 恢复 ${result.paths[0]}。`
        : result.error?.message ?? "恢复未完成。";
      if (result.ok) {
        await this.record(session, "tool.completed", {
          activityId,
          result: display,
          presentation: changePresentation(result, display),
        });
      } else {
        await this.record(session, "tool.failed", { activityId, result: display });
      }
      return clone(result);
    } finally {
      lease.release();
    }
  }

  async bumpContextProfile(sessionId: string): Promise<boolean> {
    const session = this.catalog.get(sessionId);
    if (!session || this.hasSessionRuns(sessionId)) return false;
    await this.advanceContextProfile(session, {});
    return true;
  }

  async setCoordinationWait(sessionId: string, wait?: CoordinationWait): Promise<boolean> {
    const session = this.catalog.get(sessionId);
    if (!session) return false;
    if (wait) {
      const engineId = sessionAgentEngine(session.engineId);
      if (wait.sessionId !== sessionId || wait.engineId !== engineId || engineScopeOf(wait.id) !== engineId) return false;
    }
    await this.record(session, "session.updated", { waitingFor: wait });
    return true;
  }

  async send(intent: AgentIntent): Promise<SendResult> {
    const session = this.catalog.get(intent.sessionId);
    const text = intent.text.trim();
    if (!session || !text) return { accepted: false, queued: false, reason: "empty-or-missing-session" };
    const engineId = sessionAgentEngine(session.engineId);
    if (intent.engineId && intent.engineId !== engineId) {
      return { accepted: false, queued: false, reason: "engine-owner-mismatch" };
    }
    if (intent.selectedModel !== session.selectedModel || intent.permissionMode !== session.permissionMode) {
      return { accepted: false, queued: false, reason: "stale-session-controls" };
    }
    if (this.options.modelAvailability && !this.options.modelAvailability(session.selectedProviderId, session.selectedModel)) {
      return { accepted: false, queued: false, reason: "model-unavailable-reselect-required" };
    }

    const origin = intent.origin ?? { kind: "user" as const };
    // Preserve the original implicit same-session queue for ordinary typed input.
    // Explicit origins are scheduler/delegation boundaries and become independent runs.
    if (intent.origin === undefined && this.hasSessionRuns(session.id)) {
      if (session.queue.length >= this.maxSessionQueue) {
        return { accepted: false, queued: false, reason: "session-queue-saturated" };
      }
      const queue = enqueueIntent(session, text, this.now(), origin, {
        workspaceMode: intent.workspaceMode,
        reviewPolicy: intent.reviewPolicy,
        commitRequested: intent.commitRequested,
        memoryEnabled: intent.memoryEnabled,
        planning: intent.planning,
        userText: intent.userText,
      });
      await this.record(session, "queue.updated", { queue });
      return { accepted: true, queued: true };
    }

    if (this.pendingRunCount(engineId) >= this.maxPendingRuns && this.activeRunCount(engineId) >= this.maxConcurrentRuns) {
      return { accepted: false, queued: false, reason: "runtime-queue-saturated" };
    }
    const runId = engineScopedId(engineId, "run", newId("run"));
    const control: RunControl = {
      runId,
      controller: new AbortController(),
      origin,
      text,
      status: "queued",
      createdAt: this.now(),
      workspaceMode: intent.workspaceMode,
      reviewPolicy: intent.reviewPolicy,
      commitRequested: intent.commitRequested,
      routingRequest: intent.routing,
      memoryEnabled: intent.memoryEnabled,
      planning: intent.planning,
      userText: intent.userText,
    };
    this.registerRun(session, control);
    const queued = await this.startOrQueueRun(session, control);
    return { accepted: true, queued };
  }

  async cancel(sessionId: string): Promise<boolean> {
    const run = [...this.runs.values()].find((item) =>
      this.runSnapshots.get(item.runId)?.sessionId === sessionId && item.status === "running");
    if (run) return this.cancelRun(run.runId);
    const queued = this.pendingRuns.find((item) => this.runSnapshots.get(item.runId)?.sessionId === sessionId);
    return queued ? this.cancelRun(queued.runId) : false;
  }

  async flushPersistence(): Promise<void> {
    let firstFailure: unknown;
    while (this.runTasks.size > 0) {
      const tasks = [...this.runTasks.entries()];
      const results = await Promise.allSettled(tasks.map(([, task]) => task));
      await this.persistChain;
      for (const [index, [runId, task]] of tasks.entries()) {
        if (this.runTasks.get(runId) === task) this.runTasks.delete(runId);
        const result = results[index];
        if (result.status === "rejected" && firstFailure === undefined) firstFailure = result.reason;
      }
    }
    await this.persistChain;
    if (firstFailure !== undefined) throw firstFailure;
  }

  async flushRunPersistence(runId: string): Promise<void> {
    // A completed native conversation must not wait for another session's
    // permission card or provider. Global flush remains the shutdown barrier.
    const task = this.runTasks.get(runId);
    if (!task && !this.runSnapshots.has(runId)) throw new Error("Unknown Harness run persistence barrier");
    try {
      if (task) await task;
      await this.persistChain;
    } finally {
      if (task && this.runTasks.get(runId) === task) this.runTasks.delete(runId);
    }
  }

  private launchRun(
    session: SessionSnapshot,
    text: string,
    origin: IntentOrigin,
    controls: { workspaceMode?: WorkspaceMode; reviewPolicy?: ReviewPolicy; commitRequested?: boolean },
    runId: string,
  ): void {
    const task = this.runInput(session, text, origin, controls, runId);
    this.runTasks.set(runId, task);
    // Keep background failures observable through flushPersistence without
    // leaving an unhandled rejection in a host that is still running.
    void task.catch(() => undefined);
  }

  private async runInput(
    session: SessionSnapshot,
    text: string,
    origin: IntentOrigin,
    controls: { workspaceMode?: WorkspaceMode; reviewPolicy?: ReviewPolicy; commitRequested?: boolean } = {},
    runId?: string,
  ): Promise<void> {
    const engineId = sessionAgentEngine(session.engineId);
    const effectiveRunId = runId ?? engineScopedId(engineId, "run", newId("run"));
    const assistantMessageId = engineScopedId(engineId, "item", newId("message"));
    const control = this.runs.get(effectiveRunId) ?? {
      runId: effectiveRunId,
      controller: new AbortController(),
      origin,
      text,
      status: "running" as const,
      createdAt: this.now(),
      ...controls,
    };
    this.runs.set(effectiveRunId, control);
    control.status = "running";
    this.updateRunSnapshot(control, "running");
    if (engineId === "viniper") {
      this.permissionPolicy.freezeRun(
        session.id,
        effectiveRunId,
        session.projectAccess?.enabled ? session.workingDirectory : undefined,
      );
    }
    const extensionSnapshot = this.options.extensionSnapshotProvider?.();
    const routing = control.routing ?? this.options.routingService?.decide({
      origin,
      providerId: session.selectedProviderId,
      modelId: session.selectedModel,
    }, control.routingRequest) ?? {
      mode: "fixed" as const,
      enabled: false,
      eligible: false,
      fallback: false as const,
      providerId: session.selectedProviderId,
      modelId: session.selectedModel,
      label: `${session.selectedProviderId} · ${session.selectedModel}`,
      capabilities: [],
      cacheImpact: "unknown" as const,
      reason: "沿用会话固定 Provider 与模型。",
      frozenAt: this.now(),
    };
    control.routing = routing;
    control.providerSnapshot = control.providerSnapshot ?? {
      providerId: routing.providerId,
      profileId: routing.providerId,
      modelId: routing.modelId,
      permissionMode: session.permissionMode,
      reasoning: session.reasoning,
    } satisfies FrozenProviderSnapshot;
    this.updateRunSnapshot(control, "running");

    let assistantText = "";
    let cancelled = false;
    let failed = false;
    let providerUsage: TokenUsage | undefined;
    let workspaceId: string | undefined;
    let workspaceRoot: string | undefined = session.projectAccess?.enabled ? session.workingDirectory : undefined;
    let providerRequest: ProviderRequest | undefined;
    let providerForReview: ReturnType<ProviderRegistry["get"]> | undefined;
    try {
      if (control.recovery) {
        await this.recordRun(session, "run.recovering", { runId: effectiveRunId, recovery: "crash-replay" }, effectiveRunId);
        await this.recordRun(session, "run.replaying", { runId: effectiveRunId, policy: "unknown-may-repeat" }, effectiveRunId);
      } else {
        await this.recordRun(session, "run.started", {
          runId: effectiveRunId,
          origin,
          inputText: text,
          permissionMode: session.permissionMode,
          projectAccess: session.projectAccess?.enabled === true,
        }, effectiveRunId);
        await this.recordRun(session, "run.checkpoint", { runId: effectiveRunId, phase: "run", status: "started" }, effectiveRunId);
      }
      if (session.projectAccess?.enabled && this.options.workspaceService) {
        const preparation = await this.options.workspaceService.prepare({
          mode: controls.workspaceMode ?? "auto",
          projectRoot: session.workingDirectory,
          runId: effectiveRunId,
          requiresIsolation: controls.workspaceMode === "isolated",
          sharedCommitRequested: controls.commitRequested,
        });
        workspaceId = preparation.workspaceId;
        control.workspaceId = workspaceId;
        workspaceRoot = preparation.root;
        await this.record(session, "workspace.updated", {
          workspaceId,
          runId: effectiveRunId,
          status: preparation.status,
          mode: preparation.mode,
          reason: preparation.reason,
        });
        await this.recordRun(session, "run.checkpoint", {
          runId: effectiveRunId,
          phase: "workspace",
          status: preparation.status === "blocked" ? "failed" : "succeeded",
        }, effectiveRunId);
        if (preparation.status === "blocked") throw new Error(preparation.reason ?? "工作区准备失败。");
      }
      const projectInstructions = await this.loadProjectInstructions(session, workspaceRoot);
      const localPolicy = engineId === "viniper"
        ? this.registry.get(control.providerSnapshot!.providerId).runtimePolicyFor?.(control.providerSnapshot!.modelId)
        : undefined;
      if (projectInstructions.status.status === "error") {
        throw new Error(projectInstructions.status.message);
      }
      const compositionPlan = this.composition.compileForRun({
        host: "any",
        sessionScope: session.projectAccess?.enabled === true ? "project" : "all",
      });
      // Generic Viniper requests receive absolute-path file tools and the
      // native platform terminal. Project/git/workspace/review tools remain
      // project-owned and are advertised only after a project is selected.
      const registeredToolDefinitions = engineId === "viniper"
        ? stableContextTools(
          this.toolRegistry.descriptorsForRun(extensionSnapshot).filter((tool) =>
            session.projectAccess?.enabled === true
            || !isProjectScopedTool(tool.name)
            || tool.name.startsWith("terminal.")),
        )
        : [];
      const availableTools = compositionPlan.enabled.some((item) => item.id === "code-mode.worker")
        ? registeredToolDefinitions
        : registeredToolDefinitions.filter((tool) => tool.name !== "run_code");
      // A follow-up can refer to an earlier document without repeating its
      // filename. Keep its specialized tools for the retained conversation;
      // explicit restrictions still come only from the current user turn.
      const fileContext = session.providerHistory.filter((entry) => entry.role === "user")
        .flatMap((entry) => entry.items.filter((item) => item.type === "text").map((item) => item.text)).join("\n");
      const turnTools = control.planning ? availableTools.filter((tool) => tool.readOnly) : availableTools;
      const toolDefinitions = engineId === "viniper" ? toolsForCurrentTurn(control.userText ?? text, relevantFileTools(`${text}\n${fileContext}`, turnTools, localPolicy?.visionEnabled)) : [];
      const enabledSkills = engineId === "viniper"
        ? stableContextSkills(await (this.options.skillLoader?.loadForRun(session.id) ?? Promise.resolve([])))
        : [];
      if (!localPolicy) await this.options.compactionService?.maybeCompact({
        sessionId: session.id,
        providerId: control.providerSnapshot!.providerId,
        modelId: control.providerSnapshot!.modelId,
        history: session.providerHistory,
      });
      const contextHistory = this.options.compactionService?.projectHistory(session.id, session.providerHistory, control.providerSnapshot!.providerId, control.providerSnapshot!.modelId)
        ?? session.providerHistory;
      const memoryEntries = engineId === "viniper" ? (this.options.memoryService?.selectForInjection({
        sessionId: session.id,
        projectRoot: session.projectAccess?.enabled ? session.workingDirectory : undefined,
        queryText: text,
        enabled: control.memoryEnabled !== false,
        maxEntries: 8,
        maxChars: 4_000,
        excludeAutomaticSessionCapture: true,
      }) ?? []) : [];
      const memoryText = memoryEntries.length > 0
        ? `\n\n可用记忆（来源与作用域已由应用记录）：\n${memoryEntries.map((entry) => `- [${entry.source}/${entry.scope}] ${entry.text}`).join("\n")}`
        : "";
      const contextProfile = buildContextProfile({
        generation: session.cachePlan.profileGeneration,
        providerId: control.providerSnapshot!.providerId,
        modelId: control.providerSnapshot!.modelId,
        tools: toolDefinitions,
        enabledSkills,
        history: contextHistory,
        projectInstructions: `${projectInstructions.text ?? ""}${memoryText}${control.planning ? "\n\n本轮为规划模式：只读调研，给出可执行的方案、取舍和验证方法。不得修改文件、运行有副作用命令或启动其他执行任务。完成方案后等待用户选择开始实施。" : ""}`,
        taskWorkflow: engineId === "viniper",
      });
      const cachePlan = buildCachePlan(text, contextProfile);
      control.providerSnapshot = {
        ...control.providerSnapshot!,
        tools: clone(toolDefinitions),
        cachePlan: clone(cachePlan),
        contextProfile: clone(contextProfile),
      };
      const frozenContext = freezeRunContext({
        runId: effectiveRunId,
        sessionId: session.id,
        provider: clone(control.providerSnapshot),
        composition: compositionPlan,
        toolDescriptors: clone(toolDefinitions),
        skills: enabledSkills.map((skill) => ({
          id: skill.id,
          version: (skill as LoadedSkill & { version?: string }).version ?? "unversioned",
          body: skill.body,
          name: skill.name,
          description: skill.description,
          source: skill.source,
        })),
        extensions: Object.fromEntries(Object.entries(extensionSnapshot ?? {}).map(([id, entry]) => [id, {
          version: entry.version,
          trusted: entry.trusted,
          enabled: entry.enabled,
          tools: [...entry.tools],
        }])),
        projectInstructions: {
          status: projectInstructions.status.status === "loaded"
            ? "loaded"
            : "not-configured",
          text: projectInstructions.text,
          // Canonical provenance stays in the local instruction status. This
          // frozen context also reaches Provider/review adapters and should
          // identify the instruction file without exporting a host path.
          source: projectInstructions.status.canonicalPath ? "AGENTS.md" : undefined,
        },
        permission: { mode: session.permissionMode },
        review: { policy: controls.reviewPolicy ?? "off" },
        cache: {
          stablePrefix: cachePlan.reusablePrefix,
          generation: contextProfile.generation,
          plan: cachePlan,
          profile: contextProfile,
        },
        workflow: { enabled: compositionPlan.enabled.some((item) => item.id === "workflow.engine") },
        steering: { inboxId: effectiveRunId, enabled: true },
      });
      control.frozenContext = frozenContext;
      this.updateRunSnapshot(control, "running");
      await this.record(session, "session.updated", { cachePlan, unread: false });
      await this.options.tokenLedger.start(engineId, effectiveRunId, session.id, cachePlan.reusablePrefix + text);
      if (!control.recovery) {
        const userMessage: AgentMessage = {
          id: engineScopedId(engineId, "item", newId("message")),
          engineId,
          sessionId: session.id,
          role: "user",
          text,
          createdAt: this.now(),
          status: "completed",
        };
        await this.record(session, "message.user", { message: userMessage, origin, runId: effectiveRunId });
        const userHistoryEntry: ProviderHistoryEntry = {
          id: engineScopedId(engineId, "item", newId("provider-user")),
          role: "user",
          items: [{ type: "text", text }],
        };
        await this.record(session, "provider.history.appended", { entries: [userHistoryEntry], runId: effectiveRunId });
      }

      let thinkingActivityId = engineScopedId(engineId, "item", newId("thinking"));
      const provider = engineId === "claude-code"
        ? this.claudeCodeEngineAdapter
        : this.registry.get(control.providerSnapshot!.providerId);
      if (!provider) throw new Error("CLAUDE_CODE_ENGINE_ADAPTER_UNAVAILABLE");
      if (engineId === "viniper") providerForReview = provider as ReturnType<ProviderRegistry["get"]>;
      providerRequest = {
        engineId,
        sessionId: session.id,
        // The native Claude adapter needs a local cwd; cloud Providers do
        // not. Project tools retain their separately authorized root.
        ...(engineId === "claude-code" ? { workingDirectory: workspaceRoot ?? session.workingDirectory } : {}),
        runId: effectiveRunId,
        profileId: control.providerSnapshot!.profileId,
        selectedModel: control.providerSnapshot!.modelId,
        permissionMode: session.permissionMode,
        reasoning: control.providerSnapshot!.reasoning,
        currentUserText: control.userText ?? text,
        history: this.options.compactionService?.projectHistory(session.id, session.providerHistory, control.providerSnapshot!.providerId, control.providerSnapshot!.modelId) ?? session.providerHistory,
        tools: engineId === "viniper" ? toolDefinitions : [],
        cachePlan,
        contextProfile,
        frozenRunContext: frozenContext,
      };
      const onProviderEvent = async (providerEvent: import("../../core/provider-contracts").ProviderEvent): Promise<void> => {
        if (providerEvent.kind === "usage.estimated") {
          this.options.tokenLedger.updateEstimate(engineId, effectiveRunId, providerEvent.usage);
          await this.recordTurnUsage(session, effectiveRunId);
          return;
        }
        if (providerEvent.kind === "usage.completed") {
          providerUsage = addProviderUsage(providerUsage, providerEvent.usage);
          return;
        }
        await projectProviderEvent(providerEvent, {
          session,
          assistantMessageId,
          thinkingActivityId,
          now: this.now,
          providerLabel: provider.descriptor.name,
          appendText: (delta) => {
            assistantText += delta;
            this.options.tokenLedger.estimateOutput(engineId, effectiveRunId, assistantText);
          },
          emit: (type, payload) => this.recordRun(session, type, attachRunId(payload, effectiveRunId), effectiveRunId),
        });
        if (providerEvent.kind === "text.delta") await this.recordTurnUsage(session, effectiveRunId);
      };
      await this.recordRun(session, "run.checkpoint", {
        runId: effectiveRunId,
        phase: "provider",
        status: "started",
        compositionRevision: frozenContext.composition.revision,
      }, effectiveRunId);
      if (engineId === "claude-code") {
        await (provider as ClaudeCodeEngineAdapter).run({
          request: providerRequest,
          signal: control.controller.signal,
          onProviderAttempt: async (ordinal) => {
            control.providerAttempt = { attempt: ordinal, maxAttempts: 1, status: "running" };
            this.updateRunSnapshot(control, "running");
            this.publish();
            await this.recordRun(session, "run.checkpoint", {
              runId: effectiveRunId,
              phase: "provider",
              status: "started",
              providerBudget: { ordinal, limit: 1, remaining: 0 },
            }, effectiveRunId);
          },
          onProviderEvent,
        });
      } else {
        await this.viniperEngineAdapter.run({
        provider: provider as ReturnType<ProviderRegistry["get"]>,
        request: providerRequest,
        toolRegistry: this.toolRegistry,
        projectRoot: workspaceRoot,
        taskDirectory: workspaceRoot ?? session.workingDirectory,
        authorizationProjectRoot: session.projectAccess?.enabled ? session.workingDirectory : undefined,
        workspaceId,
        commitRequested: controls.commitRequested,
        extensionSnapshot,
        frozenRunContext: frozenContext,
        permissionPolicy: this.permissionPolicy,
        lifecycle: this.lifecycle,
        steering: this.steering,
        codeSubcallInvoker: (input) => this.executeCodeSubcall(input, {
          projectRoot: workspaceRoot,
          workspaceId,
          commitRequested: controls.commitRequested,
          providerSnapshot: frozenContext.provider,
          extensionSnapshot,
          frozenRunContext: frozenContext,
        }),
        resourceCoordinator: this.resourceCoordinator,
        artifactService: this.options.artifactService,
        runId: effectiveRunId,
        // Local deployment limits come from its host-owned contract. Explicit
        // acceptance overrides still take precedence; cloud defaults stay bounded.
        ...(localPolicy ? { maxRounds: localPolicy.maxIterations, noProgressLimit: 3, trackReads: true } : {}),
        maxProviderRequests: resolveProviderRequestLimit(
          session.permissionMode,
          { ...(localPolicy ? { review: localPolicy.maxIterations, fullAccess: localPolicy.maxIterations } : {}), ...this.options.providerRequestLimits },
        ),
        ...(session.permissionMode === "review" ? {
          reviewPlan: buildReviewExecutionPlan(effectiveRunId),
        } : {}),
        signal: control.controller.signal,
        now: this.now,
        onProviderAttempt: async (attempt, budget) => {
          // A tool continuation is a new reasoning phase. Reusing a completed
          // activity makes the desktop's replay filter discard genuine deltas.
          thinkingActivityId = engineScopedId(engineId, "item", newId("thinking"));
          control.providerAttempt = { attempt, maxAttempts: 5, status: "running" };
          this.updateRunSnapshot(control, "running");
          this.publish();
          await this.recordRun(session, "run.checkpoint", {
            runId: effectiveRunId,
            phase: "provider",
            status: "started",
            providerBudget: budget,
          }, effectiveRunId);
        },
        onProviderRetry: ({ attempt, error }) => {
          control.providerAttempt = {
            attempt,
            maxAttempts: 5,
            status: "waiting",
            ...(error instanceof ProviderTransportError ? { errorKind: error.kind } : {}),
          };
          this.updateRunSnapshot(control, "running");
          this.publish();
        },
        providerRetryDelayMs: (retryNumber) => 2000 * (2 ** Math.max(0, retryNumber - 1)),
        appendHistory: (entries) => this.record(session, "provider.history.appended", { entries }),
        emit: async (type, payload) => {
          await this.recordRun(session, type, attachRunId(payload, effectiveRunId), effectiveRunId);
          const diff = type === "tool.completed" ? turnDiffFromToolPayload(payload) : undefined;
          if (diff) await this.recordRun(session, "turn.diff.updated", { runId: effectiveRunId, diff }, effectiveRunId);
          if (type === "tool.requested" || type === "interaction.requested") {
            await this.recordRun(session, "run.checkpoint", {
              runId: effectiveRunId,
              phase: type === "tool.requested" ? "tool" : "approval",
              status: "started",
            }, effectiveRunId);
          } else if (type === "tool.completed" || type === "tool.failed" || type === "tool.cancelled" || type === "interaction.resolved") {
            await this.recordRun(session, "run.checkpoint", {
              runId: effectiveRunId,
              phase: type.startsWith("tool") ? "tool" : "approval",
              status: type.endsWith("failed") ? "failed" : "succeeded",
            }, effectiveRunId);
          }
        },
        onProviderEvent,
      });
      }
      control.providerAttempt = {
        ...(control.providerAttempt ?? { attempt: 1, maxAttempts: 5 }),
        status: "succeeded",
      };
      this.updateRunSnapshot(control, "running");
      await this.recordRun(session, "run.checkpoint", { runId: effectiveRunId, phase: "provider", status: "succeeded" }, effectiveRunId);
      if (workspaceId && this.options.workspaceService && providerForReview && providerRequest) {
        await this.finishWorkspaceRun(
          session,
          effectiveRunId,
          workspaceId,
          controls.reviewPolicy ?? "off",
          providerForReview,
          providerRequest,
          control.controller.signal,
          control.frozenContext,
        );
      }
    } catch (error) {
      if (control.controller.signal.aborted) {
        cancelled = true;
      } else {
        failed = true;
        if (control.providerAttempt) {
          control.providerAttempt = {
            ...control.providerAttempt,
            status: "failed",
            ...(error instanceof ProviderTransportError ? { errorKind: error.kind } : {}),
          };
          this.updateRunSnapshot(control, "running");
        }
        await this.recordRun(session, "run.checkpoint", { runId: effectiveRunId, phase: "provider", status: "failed" }, effectiveRunId);
        await this.recordRun(session, "runtime.error", {
          error: runtimeErrorEnvelope(error, {
            code: error instanceof ProviderTransportError ? `PROVIDER_${error.kind.toUpperCase()}` : "RUN_EXECUTION_FAILED",
            phase: "provider",
            retryable: error instanceof ProviderTransportError,
            engineId,
            sessionId: session.id,
            turnId: effectiveRunId,
          }),
        }, effectiveRunId);
        await this.recordRun(session, "run.failed", {
          runId: effectiveRunId,
          activity: {
            id: engineScopedId(engineId, "item", newId("error")),
            engineId,
            sessionId: session.id,
            kind: "error",
            title: `${session.selectedProviderId === "demo" ? "Demo Provider" : "Provider"} 运行失败`,
            detail: error instanceof Error ? error.message : String(error),
            status: "failed",
            runId: effectiveRunId,
            createdAt: this.now(),
          },
        }, effectiveRunId);
      }
    }

    if (providerUsage) await this.options.tokenLedger.reconcile(engineId, effectiveRunId, providerUsage);
    else await this.options.tokenLedger.finishUnreconciled(engineId, effectiveRunId);
    await this.recordTurnUsage(session, effectiveRunId, true);
    await this.dispatchLifecycle(session, effectiveRunId, "run/pre-stop", {
      status: cancelled ? "cancelled" : failed ? "failed" : "completed",
      assistantText,
    });
    if (cancelled) {
      if (assistantText) await this.recordRun(session, "message.cancelled", { messageId: assistantMessageId }, effectiveRunId);
      await this.recordRun(session, "run.cancelled", { runId: effectiveRunId }, effectiveRunId);
    } else if (!failed) {
      await this.recordRun(session, "message.completed", {
        messageId: assistantMessageId,
        text: assistantText,
        createdAt: this.now(),
      }, effectiveRunId);
      if (this.catalog.getActiveSessionId() !== session.id) {
        await this.record(session, "session.updated", { unread: true });
      }
      if (engineId === "viniper" && this.options.memoryService && control.memoryEnabled !== false && assistantText.trim()) {
        try {
          await this.options.memoryService.captureSession(
            session.id,
            session.projectAccess?.enabled ? session.workingDirectory : undefined,
            assistantText.slice(0, 1_000),
          );
        } catch (error) {
          // Automatic capture is a post-run convenience. Its storage failure
          // must remain visible without stranding the completed run's slot or
          // preventing already accepted user intents from leaving the queue.
          await this.recordRun(session, "run.listener-failed", {
            stage: "automatic-memory",
            activity: {
              id: engineScopedId(engineId, "item", newId("memory-error")),
              engineId, sessionId: session.id, runId: effectiveRunId,
              kind: "error", title: "自动记忆保存失败",
              detail: error instanceof Error ? error.message : String(error),
              status: "failed", createdAt: this.now(),
            },
          }, effectiveRunId);
        }
      }
      // Emit terminal completion only after automatic capture has reported
      // success or its nonfatal warning to this run's existing subscribers.
      await this.recordRun(session, "run.completed", { runId: effectiveRunId }, effectiveRunId);
    }
    await this.dispatchLifecycle(session, effectiveRunId, "run/completed", {
      status: cancelled ? "cancelled" : failed ? "failed" : "completed",
      assistantText,
    });

    this.runs.delete(effectiveRunId);
    this.removeSessionRun(session.id, effectiveRunId);
    const terminalStatus: RunStatus = cancelled ? "cancelled" : failed ? "failed" : "completed";
    control.status = terminalStatus;
    this.updateRunSnapshot(control, terminalStatus);
    if (engineId === "viniper") this.permissionPolicy.cancelRun(effectiveRunId);
    this.publish();
    const completion: RunCompletion = {
      engineId,
      runId: effectiveRunId,
      sessionId: session.id,
      origin,
      status: cancelled ? "cancelled" : failed ? "failed" : "completed",
      assistantText,
    };
    const listenerResults = await Promise.allSettled(
      [...this.completionListeners].map((listener) => Promise.resolve().then(() => listener(completion))),
    );
    for (const result of listenerResults) {
      if (result.status === "fulfilled") continue;
      await this.recordRun(session, "run.listener-failed", {
        activity: {
            id: engineScopedId(engineId, "item", newId("listener-error")),
            engineId,
            sessionId: session.id,
          kind: "error",
          title: "运行后续处理失败",
          detail: result.reason instanceof Error ? result.reason.message : String(result.reason),
          status: "failed",
          runId: effectiveRunId,
          createdAt: this.now(),
        },
      }, effectiveRunId);
    }
    const { next, remaining } = takeNextIntent(session);
    if (next) {
      await this.record(session, "queue.updated", { queue: remaining });
      const nextControl: RunControl = {
        runId: engineScopedId(sessionAgentEngine(session.engineId), "run", newId("run")),
        controller: new AbortController(),
        origin: next.origin ?? { kind: "user" },
        text: next.text,
        userText: next.userText,
        status: "queued",
        createdAt: this.now(),
        workspaceMode: next.workspaceMode,
        memoryEnabled: next.memoryEnabled,
        planning: next.planning,
        reviewPolicy: next.reviewPolicy,
        commitRequested: next.commitRequested,
      };
      this.registerRun(session, nextControl);
      await this.startOrQueueRun(session, nextControl);
    }
    await this.drainRunQueue();
  }

  private registerRun(session: SessionSnapshot, control: RunControl): void {
    this.runs.set(control.runId, control);
    const sessionRunIds = this.sessionRuns.get(session.id) ?? new Set<string>();
    sessionRunIds.add(control.runId);
    this.sessionRuns.set(session.id, sessionRunIds);
    this.runSnapshots.set(control.runId, {
      engineId: sessionAgentEngine(session.engineId),
      runId: control.runId,
      turnId: control.runId,
      sessionId: session.id,
      origin: { ...control.origin },
      text: control.text,
      status: control.status,
      createdAt: control.createdAt,
      updatedAt: control.createdAt,
      ...(control.providerSnapshot ? { providerSnapshot: clone(control.providerSnapshot) } : {}),
      ...(control.frozenContext ? { compositionRevision: control.frozenContext.composition.revision } : {}),
      ...(control.routing ? { routing: clone(control.routing) } : {}),
      ...(control.providerAttempt ? { providerAttempt: clone(control.providerAttempt) } : {}),
    });
    this.steering.markRun(control.runId, control.status);
  }

  private async startOrQueueRun(session: SessionSnapshot, control: RunControl): Promise<boolean> {
    const engineId = sessionAgentEngine(session.engineId);
    if (this.activeRunCount(engineId) >= this.maxConcurrentRuns) {
      if (this.pendingRunCount(engineId) >= this.maxPendingRuns) return false;
      control.status = "queued";
      control.createdAt = control.createdAt || this.now();
      this.pendingRuns.push(control);
      this.updateRunSnapshot(control, "queued", "capacity");
      await this.recordRun(session, "run.queued", {
        runId: control.runId,
        origin: control.origin,
        reason: "capacity",
      }, control.runId);
      return true;
    }
    control.status = "running";
    this.updateRunSnapshot(control, "running");
    this.launchRun(session, control.text, control.origin, control, control.runId);
    return false;
  }

  private async recoverRuns(candidates: Array<{ sessionId: string; runId: string; text: string; origin: IntentOrigin; createdAt: number }>): Promise<void> {
    for (const candidate of candidates) {
      const session = this.catalog.get(candidate.sessionId);
      if (!session || this.runSnapshots.has(candidate.runId)) continue;
      const control: RunControl = {
        runId: candidate.runId,
        controller: new AbortController(),
        origin: candidate.origin,
        text: candidate.text,
        status: "recovering",
        createdAt: candidate.createdAt,
        recovery: true,
      };
      this.registerRun(session, control);
      control.status = "recovering";
      this.updateRunSnapshot(control, "recovering");
      this.launchRun(session, control.text, control.origin, control, control.runId);
    }
  }

  private async drainRunQueue(): Promise<void> {
    while (this.pendingRuns.length > 0) {
      const index = this.pendingRuns.findIndex((candidate) => {
        const engineId = this.runSnapshots.get(candidate.runId)?.engineId;
        return engineId !== undefined && this.activeRunCount(engineId) < this.maxConcurrentRuns;
      });
      if (index < 0) return;
      const [control] = this.pendingRuns.splice(index, 1);
      if (!control || control.status === "cancelled") continue;
      const sessionId = this.runSnapshots.get(control.runId)?.sessionId;
      const session = sessionId ? this.catalog.get(sessionId) : undefined;
      if (!session) {
        control.status = "failed";
        this.updateRunSnapshot(control, "failed");
        continue;
      }
      control.status = "running";
      this.updateRunSnapshot(control, "running");
      this.launchRun(session, control.text, control.origin, control, control.runId);
    }
  }

  private activeRunCount(engineId?: AgentEngineId): number {
    return [...this.runs.values()].filter((run) => run.status === "running"
      && (!engineId || this.runSnapshots.get(run.runId)?.engineId === engineId)).length;
  }

  private pendingRunCount(engineId: AgentEngineId): number {
    return this.pendingRuns.filter((run) => this.runSnapshots.get(run.runId)?.engineId === engineId).length;
  }

  private activeRunIdsForSession(sessionId: string): string[] {
    return [...(this.sessionRuns.get(sessionId) ?? [])]
      .filter((runId) => this.runs.has(runId));
  }

  private hasSessionRuns(sessionId: string): boolean {
    return this.activeRunIdsForSession(sessionId).length > 0
      || this.pendingRuns.some((run) => this.runSnapshots.get(run.runId)?.sessionId === sessionId);
  }

  private removeSessionRun(sessionId: string, runId: string): void {
    const ids = this.sessionRuns.get(sessionId);
    if (!ids) return;
    ids.delete(runId);
    if (ids.size === 0) this.sessionRuns.delete(sessionId);
  }

  private updateRunSnapshot(control: RunControl, status: RunStatus, queuedReason?: RunSnapshot["queuedReason"]): void {
    const current = this.runSnapshots.get(control.runId);
    if (!current) return;
    this.runSnapshots.set(control.runId, {
      ...current,
      status,
      updatedAt: this.now(),
      ...(queuedReason ? { queuedReason } : {}),
      ...(queuedReason === undefined && status !== "queued" ? { queuedReason: undefined } : {}),
      ...(control.providerSnapshot ? { providerSnapshot: clone(control.providerSnapshot) } : {}),
      ...(control.frozenContext ? { compositionRevision: control.frozenContext.composition.revision } : {}),
      ...(control.routing ? { routing: clone(control.routing) } : {}),
      ...(control.providerAttempt ? { providerAttempt: clone(control.providerAttempt) } : {}),
    });
    this.steering.markRun(control.runId, status);
  }

  private async recordRun(session: SessionSnapshot, type: RuntimeEventType, payload: unknown, runId: string): Promise<void> {
    if (type === "run.checkpoint") {
      const current = this.runSnapshots.get(runId);
      const checkpointPayload = payload as {
        phase?: NonNullable<RunSnapshot["checkpoint"]>["phase"];
        status?: NonNullable<RunSnapshot["checkpoint"]>["status"];
      };
      if (current && checkpointPayload.phase && checkpointPayload.status) {
        this.runSnapshots.set(runId, {
          ...current,
          checkpoint: { phase: checkpointPayload.phase, status: checkpointPayload.status, updatedAt: this.now() },
          updatedAt: this.now(),
        });
      }
    }
    await this.record(session, type, attachRunId(payload, runId));
  }

  private async recordTurnUsage(session: SessionSnapshot, runId: string, force = false): Promise<void> {
    const engineId = sessionAgentEngine(session.engineId);
    const record = this.options.tokenLedger.getRun(engineId, runId);
    if (!record) return;
    const signature = JSON.stringify({ usage: record.usage, status: record.status });
    const previous = this.turnUsageProjection.get(runId);
    const now = this.now();
    if (previous?.signature === signature) return;
    if (!force && previous && now - previous.projectedAt < 120) return;
    this.turnUsageProjection.set(runId, { signature, projectedAt: now });
    await this.recordRun(session, "turn.usage.updated", {
      runId,
      usage: clone(record.usage),
      status: record.status,
      source: record.usage.source,
      updatedAt: record.updatedAt,
    }, runId);
    if (force) this.turnUsageProjection.delete(runId);
  }

  private async advanceContextProfile(session: SessionSnapshot, patch: Partial<SessionSnapshot>): Promise<void> {
    const cachePlan = { ...session.cachePlan, profileGeneration: session.cachePlan.profileGeneration + 1 };
    await this.record(session, "session.updated", { ...patch, cachePlan });
  }

  private async canonicalizeProjectRoot(path: string): Promise<string> {
    if (!this.options.projectFilesystem) throw new Error("项目文件系统尚未配置；当前会话未改变。");
    return this.options.projectFilesystem.canonicalizeProjectRoot(path);
  }

  private async loadProjectInstructions(session: SessionSnapshot, workingDirectory = session.workingDirectory): Promise<ProjectInstructionSnapshot> {
    const snapshot = session.projectAccess?.enabled === true
      ? this.options.instructionLoader
        ? await this.options.instructionLoader.loadForRun(workingDirectory)
        : {
            status: {
              status: "missing" as const,
              canonicalPath: "AGENTS.md",
              revision: "missing",
              bytes: 0,
              message: "AGENTS.md 未设置。",
              loadedAt: this.now(),
            },
          }
      : {
          status: {
            status: "missing" as const,
            canonicalPath: "AGENTS.md",
            revision: "missing",
            bytes: 0,
            message: "未打开项目；AGENTS.md 未设置且未读取。",
            loadedAt: this.now(),
          },
        };
    const changed = Boolean(
      session.projectInstructions
      && session.projectInstructions.revision !== snapshot.status.revision,
    );
    const cachePlan = changed
      ? { ...session.cachePlan, profileGeneration: session.cachePlan.profileGeneration + 1 }
      : session.cachePlan;
    await this.record(session, "session.updated", {
      projectInstructions: snapshot.status,
      ...(changed ? { cachePlan } : {}),
    });
    return snapshot;
  }

  private async finishWorkspaceRun(
    session: SessionSnapshot,
    runId: string,
    workspaceId: string,
    reviewPolicy: ReviewPolicy,
    provider: ReturnType<ProviderRegistry["get"]>,
    request: ProviderRequest,
    signal: AbortSignal,
    frozenContext?: FrozenRunContext,
  ): Promise<void> {
    const workspaceService = this.options.workspaceService;
    if (!workspaceService) return;
    const facts = workspaceFacts(session, runId);
    if (facts.ownedPaths.length) await workspaceService.recordOwnedPaths(workspaceId, facts.ownedPaths);
    await workspaceService.markCheckResult(workspaceId, facts.checksPassed, facts.changed ? "本 run 已记录项目变更。" : undefined);
    await this.recordRun(session, "workspace.updated", {
      workspaceId,
      runId,
      changed: facts.changed,
      checksPassed: facts.checksPassed,
      ownedPaths: facts.ownedPaths,
    }, runId);

    if (!this.options.reviewService?.shouldRun(reviewPolicy, { changed: facts.changed })) return;
    await this.recordRun(session, "review.started", { workspaceId, runId, policy: reviewPolicy, round: 1 }, runId);
    await this.recordRun(session, "run.checkpoint", { runId, phase: "review", status: "started" }, runId);
    let result;
    try {
      const reviewContext = frozenContext ?? request.frozenRunContext;
      const reviewProviderSnapshot = reviewContext?.provider ?? {
        providerId: request.profileId,
        profileId: request.profileId,
        modelId: request.selectedModel,
        permissionMode: request.permissionMode,
        tools: request.tools,
        cachePlan: request.cachePlan,
        contextProfile: request.contextProfile,
      } satisfies FrozenProviderSnapshot;
      const frozenReviewTools = reviewContext?.toolDescriptors ?? request.tools;
      result = await this.options.reviewService.run({
        policy: reviewPolicy,
        changed: facts.changed,
        round: 1,
        frozenProvider: clone(reviewProviderSnapshot),
        evidence: facts.evidence,
        execute: async ({ allowedToolNames, evidence }) => {
          const reviewTools = frozenReviewTools.filter((tool) => allowedToolNames.some((name) => name === tool.name && tool.readOnly));
          const reviewHistory: ProviderHistoryEntry[] = [{
            id: newId("review-user"),
            role: "user",
            items: [{ type: "text", text: `只读审查本 run 的受管证据：${JSON.stringify(evidence)}。第一行只输出 PASS、ISSUES 或 UNPROVEN。` }],
          }];
          let text = "";
          let usage: TokenUsage | undefined;
          for await (const event of provider.stream({
            ...request,
            profileId: reviewProviderSnapshot.profileId,
            selectedModel: reviewProviderSnapshot.modelId,
            permissionMode: reviewProviderSnapshot.permissionMode ?? request.permissionMode,
            history: reviewHistory,
            tools: reviewTools,
            frozenRunContext: reviewContext,
          }, signal)) {
            if (event.kind === "text.delta") text += event.text;
            if (event.kind === "usage.completed") usage = addProviderUsage(usage, event.usage);
          }
          return {
            text,
            ...(usage ? { usage: { input: usage.input, output: usage.output, total: usage.total } } : {}),
            cache: usage ? { hit: usage.cacheHitInput, miss: usage.cacheMissInput } : undefined,
          };
        },
      });
      await workspaceService.markReviewResult(workspaceId, result.outcome);
      await this.recordRun(session, "review.completed", { workspaceId, runId, result }, runId);
      await this.recordRun(session, "run.checkpoint", { runId, phase: "review", status: "succeeded" }, runId);
      if (workspaceService.canAutoCommit(workspaceId)) {
        const committed = await workspaceService.commitIsolated(workspaceId, `完成 ${session.title} 的受管任务`, facts.ownedPaths);
        await this.record(session, "workspace.updated", { workspaceId, autoCommit: committed });
      }
    } catch (error) {
      await this.recordRun(session, "review.failed", {
        workspaceId,
        runId,
        detail: error instanceof Error ? error.message : String(error),
      }, runId);
      await this.recordRun(session, "run.checkpoint", { runId, phase: "review", status: "failed" }, runId);
    }
  }

  private async record(session: SessionSnapshot, type: RuntimeEventType, payload: unknown): Promise<void> {
    const engineId = sessionAgentEngine(session.engineId);
    const turnId = runIdFromEventPayload(payload);
    const rawItemId = itemIdFromEvent(type, payload);
    const itemId = rawItemId
      ? engineScopeOf(rawItemId) ? rawItemId : engineScopedId(engineId, "item", rawItemId)
      : undefined;
    const event: RuntimeEvent = {
      id: engineScopedId(engineId, "event", newId("event")),
      engineId,
      sessionId: session.id,
      threadId: session.id,
      ...(turnId ? { turnId } : {}),
      ...(itemId ? { itemId } : {}),
      type,
      timestamp: this.now(),
      payload,
    };
    this.persistChain = this.persistChain.then(async () => {
      const projected = clone(session);
      applyRuntimeEvent(projected, event);
      const receipt = await this.options.persistence.commitEvent(event, this.serializeWithSession(projected));
      if (!receipt.duplicate) applyRuntimeEvent(session, receipt.event);
      this.publish();
    }).catch((error) => {
      const envelope = runtimeErrorEnvelope(error, {
        code: "RUNTIME_EVENT_COMMIT_FAILED",
        phase: "persistence",
        retryable: false,
        engineId,
        sessionId: session.id,
        ...(turnId ? { turnId } : {}),
        ...(itemId ? { itemId } : {}),
      });
      throw Object.assign(new Error(envelope.message), { envelope });
    });
    await this.persistChain;
  }

  private async recordSteeringReceipt(receipt: SteeringReceipt): Promise<void> {
    const sessionId = this.runSnapshots.get(receipt.runId)?.sessionId;
    const session = sessionId ? this.catalog.get(sessionId) : undefined;
    if (!session) return;
    await this.recordRun(session, "steering.updated", { receipt }, receipt.runId);
  }

  private async dispatchLifecycle(
    session: SessionSnapshot,
    runId: string,
    phase: LifecyclePhase,
    payload: unknown,
  ): Promise<void> {
    const result = await this.lifecycle.dispatch(phase, { runId, sessionId: session.id, payload });
    if (result.failures.length > 0) {
      await this.recordRun(session, "lifecycle.failed", { phase, failures: result.failures }, runId);
    }
    if (result.decision === "reject") {
      await this.recordRun(session, "lifecycle.rejected", { phase, reason: result.reason }, runId);
    }
  }

  private async executeCodeSubcall(
    input: CodeSubcallInput,
    base: Pick<ToolExecutionContext, "projectRoot" | "workspaceId" | "commitRequested" | "providerSnapshot" | "extensionSnapshot" | "frozenRunContext">,
  ): Promise<CodeSubcallResult> {
    if (input.toolName === "run_code") return { text: "Code Mode 不允许嵌套 run_code。", isError: true };
    const session = this.catalog.get(input.sessionId);
    const providerSnapshot = base.providerSnapshot;
    const frozenTools = [...(base.frozenRunContext?.toolDescriptors ?? providerSnapshot?.tools ?? [])];
    if (!session || !providerSnapshot?.cachePlan || !providerSnapshot.contextProfile) {
      return { text: `Code Mode 未获得本次运行冻结的 Provider 上下文；工具 ${input.toolName} 已安全拒绝。`, isError: true };
    }
    const call: ProviderToolCallItem = {
      type: "tool-call",
      callId: input.callId,
      parentCallId: input.parentCallId,
      name: input.toolName,
      arguments: clone(input.input),
      argumentsText: JSON.stringify(input.input),
      protocolItemId: input.callId,
    };
    const result = await dispatchToolCall(call, {
      request: {
        sessionId: input.sessionId,
        runId: input.runId,
        profileId: providerSnapshot.profileId,
        selectedModel: providerSnapshot.modelId,
        permissionMode: providerSnapshot.permissionMode ?? "ask",
        history: [],
        tools: clone(frozenTools),
        cachePlan: clone(providerSnapshot.cachePlan),
        contextProfile: clone(providerSnapshot.contextProfile),
        reasoning: providerSnapshot.reasoning,
        frozenRunContext: base.frozenRunContext,
      },
      toolRegistry: this.toolRegistry,
      projectRoot: base.projectRoot,
      authorizationProjectRoot: base.projectRoot,
      workspaceId: base.workspaceId,
      commitRequested: base.commitRequested,
      extensionSnapshot: base.extensionSnapshot,
      frozenRunContext: base.frozenRunContext,
      codeSubcallInvoker: (nested) => this.executeCodeSubcall(nested, base),
      signal: input.signal,
      now: this.now,
      lifecycle: this.lifecycle,
      permissionPolicy: this.permissionPolicy,
      resourceCoordinator: this.resourceCoordinator,
      artifactService: this.options.artifactService,
      runId: input.runId,
      emit: async (type, payload) => {
        await this.recordRun(session, type, attachRunId(payload, input.runId), input.runId);
      },
    }, frozenTools);
    return {
      text: result.content,
      isError: result.isError,
    };
  }

  private serialize() {
    return clone({
      schemaVersion: 3 as const,
      productVersion: PRODUCT_VERSION,
      activeSessionId: this.catalog.getActiveSessionId(),
      sessions: this.catalog.values().map(({ events: _events, ...session }) => session),
    });
  }

  private serializeWithSession(projected: SessionSnapshot) {
    const application = this.serialize();
    application.sessions = application.sessions.map((session) => {
      if (session.id !== projected.id) return session;
      const { events: _events, ...persisted } = projected;
      return clone(persisted);
    });
    return application;
  }

  private async persistSnapshot(): Promise<void> {
    const payload = this.serialize();
    this.persistChain = this.persistChain.then(() => this.options.persistence.saveSnapshot(payload));
    await this.persistChain;
  }

  private publish(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

function addProviderUsage(current: TokenUsage | undefined, next: TokenUsage): TokenUsage {
  if (!current) return clone(next);
  return {
    input: current.input + next.input,
    cacheHitInput: addOptional(current.cacheHitInput, next.cacheHitInput),
    cacheMissInput: addOptional(current.cacheMissInput, next.cacheMissInput),
    cacheWriteInput: addOptional(current.cacheWriteInput, next.cacheWriteInput),
    output: current.output + next.output,
    reasoning: current.reasoning + next.reasoning,
    toolUse: current.toolUse + next.toolUse,
    total: current.total + next.total,
    source: "provider",
  };
}

function buildReviewExecutionPlan(runId: string) {
  return {
    id: `review-plan-${runId}`,
    checkpointId: "inspect",
    steps: [
      { id: "inspect", title: "检查当前项目状态与必要上下文", status: "in_progress" as const },
      { id: "execute", title: "执行计划内且风险审核通过的项目动作", status: "pending" as const },
      { id: "verify", title: "核对产物、工具结果与完成条件", status: "pending" as const },
    ],
  };
}

function turnDiffFromToolPayload(payload: unknown): RuntimeTurnDiffSnapshot | undefined {
  const presentation = (payload as { presentation?: Record<string, unknown> })?.presentation;
  const kind = typeof presentation?.kind === "string" ? presentation.kind : "";
  if (!["project-change", "project-diff", "project-restore"].includes(kind)) return undefined;
  const paths = Array.isArray(presentation?.paths)
    ? presentation.paths.filter((path): path is string => typeof path === "string")
    : [];
  const patch = typeof presentation?.patch === "string" ? presentation.patch : undefined;
  const stats = patch ? patchStatsByPath(patch) : new Map<string, { additions: number; deletions: number }>();
  const fallback = patch ? countPatchLines(patch) : { additions: 0, deletions: 0 };
  const files = paths.map((path) => ({
    path,
    ...(stats.get(path.replaceAll("\\", "/")) ?? (paths.length === 1 ? fallback : { additions: 0, deletions: 0 })),
  }));
  return {
    summary: typeof presentation?.summary === "string" ? presentation.summary : `${files.length} 个文件已更新`,
    files,
    ...(patch ? { patch } : {}),
    ...(presentation?.patchTruncated === true ? { truncated: true } : {}),
    ...(typeof presentation?.artifactId === "string" ? { artifactId: presentation.artifactId } : {}),
  };
}

function patchStatsByPath(patch: string): Map<string, { additions: number; deletions: number }> {
  const stats = new Map<string, { additions: number; deletions: number }>();
  let current: string | undefined;
  for (const line of patch.split(/\r?\n/u)) {
    if (line.startsWith("+++ ")) {
      current = line.slice(4).replace(/^b\//u, "").trim();
      if (current !== "/dev/null" && !stats.has(current)) stats.set(current, { additions: 0, deletions: 0 });
      continue;
    }
    if (!current || current === "/dev/null") continue;
    const entry = stats.get(current)!;
    if (line.startsWith("+") && !line.startsWith("+++")) entry.additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) entry.deletions += 1;
  }
  return stats;
}

function countPatchLines(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split(/\r?\n/u)) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

function workspaceFacts(session: SessionSnapshot, runId: string): {
  changed: boolean;
  checksPassed: boolean;
  ownedPaths: string[];
  evidence: Array<{ kind: string; summary: string; relativePaths?: string[] }>;
} {
  const owned = new Set<string>();
  const evidence: Array<{ kind: string; summary: string; relativePaths?: string[] }> = [];
  let changed = false;
  let checksPassed = false;
  for (const event of session.events) {
    if (!["tool.completed", "tool.failed", "tool.cancelled"].includes(event.type)) continue;
    const payload = event.payload as { runId?: string; presentation?: Record<string, unknown>; result?: string };
    if (payload.runId && payload.runId !== runId) continue;
    const presentation = payload.presentation;
    if (!presentation) continue;
    const paths = Array.isArray(presentation.paths)
      ? presentation.paths.filter((path): path is string => typeof path === "string")
      : [];
    const kind = typeof presentation.kind === "string" ? presentation.kind : "tool";
    const action = typeof presentation.action === "string" ? presentation.action : "";
    if (kind === "project-change" && event.type === "tool.completed" && !["diff", "restore"].includes(action)) {
      changed = true;
      for (const path of paths) owned.add(path.replaceAll("\\", "/"));
    }
    if (kind === "terminal-run" && event.type === "tool.completed") {
      const status = presentation.status;
      const purpose = presentation.purpose;
      if (status === "completed" && ["test", "build", "lint", "typecheck"].includes(String(purpose))) checksPassed = true;
    }
    evidence.push({
      kind,
      summary: typeof payload.result === "string" ? payload.result.slice(0, 1000) : kind,
      ...(paths.length ? { relativePaths: paths } : {}),
    });
  }
  return { changed, checksPassed, ownedPaths: [...owned], evidence: evidence.slice(-32) };
}

function normalizeRuntimeEvent(event: RuntimeEvent, engineId: AgentEngineId, sessionId: string): RuntimeEvent {
  const turnId = event.turnId ?? runIdFromEventPayload(event.payload);
  const rawItemId = event.itemId ?? itemIdFromEvent(event.type, event.payload);
  const itemId = rawItemId
    ? engineScopeOf(rawItemId) ? rawItemId : engineScopedId(engineId, "item", rawItemId)
    : undefined;
  return {
    ...event,
    engineId: event.engineId ?? engineId,
    sessionId,
    threadId: event.threadId ?? sessionId,
    ...(turnId ? { turnId } : {}),
    ...(itemId ? { itemId } : {}),
  };
}

function runIdFromEventPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const runId = (payload as Record<string, unknown>).runId;
  return typeof runId === "string" && runId ? runId : undefined;
}

function itemIdFromEvent(type: RuntimeEventType, payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const value = payload as Record<string, unknown>;
  const message = value.message && typeof value.message === "object" ? value.message as Record<string, unknown> : undefined;
  const candidate = value.activityId ?? value.messageId ?? value.approvalId ?? value.itemId ?? value.id ?? message?.id;
  if (typeof candidate === "string" && candidate) return candidate;
  if (["plan.updated", "turn.diff.updated", "turn.usage.updated", "runtime.error"].includes(type)) {
    const runId = runIdFromEventPayload(payload);
    return runId ? `${type}:${runId}` : undefined;
  }
  return undefined;
}

function addOptional(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left + right;
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US")
    : left === right;
}

function isProjectScopedTool(name: string): boolean {
  return name.startsWith("project.")
    || name.startsWith("terminal.")
    || name.startsWith("git.")
    || name.startsWith("workspace.")
    || name.startsWith("review.");
}

function unfinishedRunEntries(session: SessionSnapshot): Array<{ runId: string; text: string; origin: IntentOrigin; createdAt: number }> {
  const entries = new Map<string, { runId: string; text: string; origin: IntentOrigin; createdAt: number }>();
  for (const event of session.events) {
    const payload = event.payload as Record<string, unknown>;
    if (event.type === "run.started" && typeof payload.runId === "string") {
      const origin = isIntentOrigin(payload.origin) ? payload.origin : { kind: "user" as const };
      entries.set(payload.runId, {
        runId: payload.runId,
        text: typeof payload.inputText === "string" ? payload.inputText : "",
        origin,
        createdAt: event.timestamp,
      });
    } else if (event.type === "message.user" && typeof payload.runId === "string") {
      const current = entries.get(payload.runId);
      const message = payload.message as Record<string, unknown> | undefined;
      if (current && !current.text && typeof message?.text === "string") current.text = message.text;
    } else if (["run.completed", "run.cancelled", "run.failed"].includes(event.type) && typeof payload.runId === "string") {
      entries.delete(payload.runId);
    }
  }
  const active = new Set(session.activeRunIds ?? (session.activeRunId ? [session.activeRunId] : []));
  return [...entries.values()].filter((entry) => active.size === 0 || active.has(entry.runId)).filter((entry) => Boolean(entry.text.trim()));
}

function isIntentOrigin(value: unknown): value is IntentOrigin {
  return value !== null
    && typeof value === "object"
    && (value as { kind?: unknown }).kind !== undefined
    && ["user", "delegation", "scheduler"].includes(String((value as { kind: unknown }).kind));
}

function attachRunId(payload: unknown, runId: string): unknown {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  return { ...(payload as Record<string, unknown>), runId };
}
