import {
  AppSnapshot,
  RuntimeEvent,
  SessionSnapshot,
  SessionStatus,
} from "../../core/contracts";
import { TokenUsage } from "../../core/telemetry-contracts";
import { MemoryCreateInput } from "../../core/memory-contracts";
import { ScheduleDraft } from "../../core/scheduler-contracts";
import { LocalModelRegistration } from "../../core/local-model-contracts";
import { ProviderEnabledCapabilities } from "../../core/provider-contracts";
import { CliApplicationPort } from "./application-port";
import {
  CLI_EVENT_SCHEMA_VERSION,
  CLI_EXIT_CODE,
  CliCommand,
  CliCommandOutcome,
  CliEvent,
  CliEventType,
  CliExitCode,
  CliInvocation,
  CliPresenter,
} from "./contracts";
import { CLI_HELP_COMMANDS, parseCliLine } from "./parser";

type RunTerminalStatus = "completed" | "cancelled" | "failed";

interface RunTerminal {
  status: RunTerminalStatus;
  runId: string;
  detail?: string;
}

interface RunWaiter {
  sessionId: string;
  prompt: string;
  candidateRunIds: string[];
  runId?: string;
  settled: boolean;
  resolve(terminal: RunTerminal): void;
}

export class CliController {
  private snapshot?: AppSnapshot;
  private unsubscribe?: () => void;
  private readonly seenRuntimeEvents = new Set<string>();
  private readonly activeRuns = new Map<string, string>();
  private readonly runWaiters = new Set<RunWaiter>();
  private initialized = false;
  private interruptArmed = false;

  constructor(
    private readonly port: CliApplicationPort,
    private readonly presenter: CliPresenter,
    private readonly now: () => number = Date.now,
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const initial = await this.port.getSnapshot();
    this.captureInitialSnapshot(initial);
    this.unsubscribe = this.port.subscribe((snapshot) => this.acceptSnapshot(snapshot));
    this.initialized = true;
    // Close the small read/subscribe race without requiring a platform-specific
    // subscription primitive. Runtime event IDs make this replay idempotent.
    this.acceptSnapshot(await this.port.getSnapshot());
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.initialized = false;
  }

  async executeInvocation(invocation: CliInvocation): Promise<CliCommandOutcome> {
    await this.ensureInitialized();
    if (invocation.kind === "interactive") {
      this.emit("ready", { productBadge: this.snapshot?.productBadge ?? "v1.8.3 · Stable（稳定版）" });
      return { exitRequested: false };
    }
    if (invocation.kind === "help") {
      this.presentHelp();
      return { exitRequested: true, exitCode: CLI_EXIT_CODE.completed };
    }
    const exitCode = await this.runPrompt(invocation.prompt, true);
    return { exitRequested: true, exitCode };
  }

  async executeLine(input: string): Promise<CliCommandOutcome> {
    await this.ensureInitialized();
    const parsed = parseCliLine(input);
    if (!parsed.ok) {
      this.error(parsed.code, parsed.message);
      return { exitRequested: false };
    }
    return this.executeCommand(parsed.value);
  }

  async executeCommand(command: CliCommand): Promise<CliCommandOutcome> {
    await this.ensureInitialized();
    try {
      switch (command.kind) {
        case "empty": return { exitRequested: false };
        case "help":
          this.presentHelp();
          return { exitRequested: false };
        case "new":
          await this.createSession(command.name);
          return { exitRequested: false };
        case "sessions":
          await this.listSessions(command.query, command.filters);
          return { exitRequested: false };
        case "session-delete":
          await this.deleteSession(command.sessionId);
          return { exitRequested: false };
        case "routing":
          await this.showRouting();
          return { exitRequested: false };
        case "capabilities":
          await this.showCapabilities();
          return { exitRequested: false };
        case "preset":
          await this.handlePreset(command.preset, command.name);
          return { exitRequested: false };
        case "preset-copy":
          await this.copyPreset(command.source, command.name);
          return { exitRequested: false };
        case "preset-toggle":
          await this.togglePresetCapability(command.name, command.capabilityId, command.enabled);
          return { exitRequested: false };
        case "preset-order":
          await this.orderPreset(command.name, command.order);
          return { exitRequested: false };
        case "preset-restore":
          await this.restorePreset();
          return { exitRequested: false };
        case "steer":
          await this.steerRun(command.runId, command.message);
          return { exitRequested: false };
        case "workflow":
          await this.handleWorkflow(command.workflowId, command.input);
          return { exitRequested: false };
        case "workflow-cancel":
          await this.cancelWorkflow(command.workflowRunId);
          return { exitRequested: false };
        case "workflow-recover":
          await this.recoverWorkflow(command.workflowRunId, command.decision);
          return { exitRequested: false };
        case "memory":
          await this.showMemory();
          return { exitRequested: false };
        case "memory-create":
          await this.createMemory(command.scope, command.text);
          return { exitRequested: false };
        case "memory-update":
          await this.updateMemory(command.id, command.text);
          return { exitRequested: false };
        case "memory-enable":
          await this.enableMemory(command.id, command.enabled);
          return { exitRequested: false };
        case "memory-delete":
          await this.deleteMemory(command.id);
          return { exitRequested: false };
        case "index":
          await this.handleIndex(command.action, command.value);
          return { exitRequested: false };
        case "runs":
          await this.listRuns();
          return { exitRequested: false };
        case "run-select":
          await this.selectRun(command.runId);
          return { exitRequested: false };
        case "run-cancel":
          await this.cancelRun(command.runId);
          return { exitRequested: false };
        case "use":
          await this.useSession(command.session);
          return { exitRequested: false };
        case "rename":
          await this.renameSession(command.name);
          return { exitRequested: false };
        case "run":
          await this.runPrompt(command.prompt, false);
          return { exitRequested: false };
        case "cancel":
          await this.cancelCurrent();
          return { exitRequested: false };
        case "tokens":
          await this.showTokens();
          return { exitRequested: false };
        case "inbox":
          await this.showInbox();
          return { exitRequested: false };
        case "send":
          await this.sendMessage(command.target, command.message);
          return { exitRequested: false };
        case "delegate":
          await this.delegate(command.target, command.task);
          return { exitRequested: false };
        case "wait":
          await this.waitForMessage(command.source);
          return { exitRequested: false };
        case "schedules":
          await this.showSchedules();
          return { exitRequested: false };
        case "schedule-create":
          await this.createSchedule(command.draft);
          return { exitRequested: false };
        case "schedule-enable":
          await this.setScheduleEnabled(command.id, command.enabled);
          return { exitRequested: false };
        case "schedule-run":
          await this.runSchedule(command.id);
          return { exitRequested: false };
        case "schedule-delete":
          await this.deleteSchedule(command.id);
          return { exitRequested: false };
        case "schedule-restore":
          await this.restoreSchedule(command.id);
          return { exitRequested: false };
        case "notifications":
          await this.showNotifications();
          return { exitRequested: false };
        case "artifacts":
          await this.showArtifacts();
          return { exitRequested: false };
        case "artifact-read":
          await this.readArtifact(command.input);
          return { exitRequested: false };
        case "skills":
          await this.showSkills();
          return { exitRequested: false };
        case "extensions":
          await this.showExtensions();
          return { exitRequested: false };
        case "extension-stage":
          await this.stageExtension(command.location, command.source);
          return { exitRequested: false };
        case "extension-install":
          await this.installExtension(command.stagingId);
          return { exitRequested: false };
        case "extension-trust":
          await this.trustExtension(command.id, command.version);
          return { exitRequested: false };
        case "extension-enable":
          await this.enableExtension(command.id, command.enabled);
          return { exitRequested: false };
        case "extension-update":
          await this.requestExtensionUpdate(command.id, command.stagingId);
          return { exitRequested: false };
        case "extension-update-confirm":
          await this.confirmExtensionUpdate(command.id);
          return { exitRequested: false };
        case "extension-rollback":
          await this.requestExtensionRollback(command.id);
          return { exitRequested: false };
        case "extension-rollback-confirm":
          await this.confirmExtensionRollback(command.id);
          return { exitRequested: false };
        case "mcp-config":
          await this.configureMcp(command.id, command.endpoint);
          return { exitRequested: false };
        case "mcp-connect":
          await this.connectMcp(command.id);
          return { exitRequested: false };
        case "providers":
          await this.showProviders();
          return { exitRequested: false };
        case "provider":
          await this.selectProvider(command.profile, command.model);
          return { exitRequested: false };
        case "provider-endpoint":
          await this.setProviderEndpoint(command.profile, command.endpoint);
          return { exitRequested: false };
        case "provider-manual-model":
          await this.setProviderManualModel(command.profile, command.model);
          return { exitRequested: false };
        case "provider-capabilities":
          await this.setProviderCapabilities(command.profile, command.capabilities);
          return { exitRequested: false };
        case "local-models":
          await this.showLocalModels();
          return { exitRequested: false };
        case "local-model-register":
          await this.registerLocalModel(command.registration);
          return { exitRequested: false };
        case "local-model-confirm":
          await this.confirmLocalModel(command.id, command.version);
          return { exitRequested: false };
        case "local-model-update":
          await this.requestLocalModelUpdate(command.id, command.version);
          return { exitRequested: false };
        case "local-model-update-confirm":
          await this.confirmLocalModelUpdate(command.id);
          return { exitRequested: false };
        case "permission":
          await this.selectPermission(command.selection);
          return { exitRequested: false };
        case "restore":
          await this.restoreProjectChange(command.receiptId);
          return { exitRequested: false };
        case "terminal-output":
          await this.readTerminalOutput(command);
          return { exitRequested: false };
        case "workspace":
          await this.showWorkspace();
          return { exitRequested: false };
        case "review":
          await this.showReview();
          return { exitRequested: false };
        case "settings":
          await this.showSettings();
          return { exitRequested: false };
        case "diagnostics":
          await this.showDiagnostics(command.runId);
          return { exitRequested: false };
        case "diagnostics-consent":
          await this.setDiagnosticsConsent(command.enabled);
          return { exitRequested: false };
        case "updates":
          await this.showUpdates(command.channel);
          return { exitRequested: false };
        case "update-download":
          await this.downloadUpdate();
          return { exitRequested: false };
        case "update-install":
          await this.confirmUpdateInstall();
          return { exitRequested: false };
        case "setting":
          await this.setSetting(command.key, command.value);
          return { exitRequested: false };
        case "archive-export":
          await this.exportArchive(command.path);
          return { exitRequested: false };
        case "archive-import":
          await this.previewArchiveImport(command.path);
          return { exitRequested: false };
        case "credential-export":
          await this.credentialBoundary("export", command.path);
          return { exitRequested: false };
        case "credential-import":
          await this.credentialBoundary("import", command.path);
          return { exitRequested: false };
        case "quit":
          return this.quitIfIdle();
      }
    } catch (error) {
      const failure = controllerFailure(error);
      this.error(failure.code, failure.message);
      return { exitRequested: false };
    }
  }

  async runNonInteractive(prompt: string): Promise<CliExitCode> {
    await this.ensureInitialized();
    return this.runPrompt(prompt, true);
  }

  async handleInterrupt(): Promise<CliCommandOutcome> {
    await this.ensureInitialized();
    await this.refreshSnapshot();
    if (this.interruptArmed) {
      this.emit("quit", { message: "再次收到 Ctrl+C，CLI 正在退出。", forced: true });
      return { exitRequested: true, exitCode: CLI_EXIT_CODE.cancelled };
    }

    const snapshot = this.requiredSnapshot();
    const active = currentSession(snapshot);
    if (isRunning(active)) {
      if (await this.port.cancel(active.id)) {
        this.interruptArmed = true;
        this.emit("cancel.requested", { target: "运行", sessionTitle: active.title }, active.id);
        return { exitRequested: false };
      }
      await this.refreshSnapshot();
    } else if (active.waitingFor) {
      if (await this.port.cancelWait(active.id)) {
        this.interruptArmed = true;
        this.emit("cancel.requested", { target: "等待", sessionTitle: active.title }, active.id);
        return { exitRequested: false };
      }
    }

    const busy = this.requiredSnapshot().sessions.filter(isBusy);
    if (busy.length > 0) {
      this.interruptArmed = true;
      this.error("BACKGROUND_RUNS_ACTIVE", `仍有 ${busy.length} 个会话在运行；切换后取消，或再次 Ctrl+C 退出。`);
      return { exitRequested: false };
    }
    this.emit("quit", { message: "CLI 已退出。", forced: false });
    return { exitRequested: true, exitCode: CLI_EXIT_CODE.completed };
  }

  private async createSession(name?: string): Promise<void> {
    await this.refreshSnapshot();
    const current = currentSession(this.requiredSnapshot());
    if (current.projectAccess?.enabled) await this.port.createProjectSession(current.workingDirectory);
    else await this.port.createSession();
    await this.refreshSnapshot();
    let session = currentSession(this.requiredSnapshot());
    if (name) {
      const renamed = await this.port.renameSession(session.id, name);
      if (!renamed) throw new CliControllerError("SESSION_RENAME_REJECTED", "新会话已创建，但名称未被应用服务接受。");
      await this.refreshSnapshot();
      session = currentSession(this.requiredSnapshot());
    }
    this.emit("session.created", {
      id: session.id,
      title: session.title,
      projectRoot: session.projectAccess?.enabled ? session.workingDirectory : null,
    }, session.id);
  }

  private async listSessions(
    query?: string,
    filters?: Extract<CliCommand, { kind: "sessions" }>["filters"],
  ): Promise<void> {
    await this.refreshSnapshot();
    const snapshot = this.requiredSnapshot();
    const queried = this.port.querySessions
      ? await this.port.querySessions({
        ...(filters?.search || query ? { search: filters?.search ?? query } : {}),
        ...(filters?.project ? { project: filters.project as "open" | "none" } : {}),
        ...(filters?.providerId ? { providerId: filters.providerId } : {}),
        ...(filters?.status ? { status: filters.status as SessionQueryStatus } : {}),
        offset: filters?.offset ?? 0,
        limit: filters?.limit ?? 50,
      })
      : undefined;
    this.emit("sessions", {
      items: (queried?.items ?? snapshot.sessions).map((session) => ({
        id: session.id,
        title: session.title,
        status: session.status,
        active: session.id === snapshot.activeSessionId,
        providerId: session.selectedProviderId,
        model: session.selectedModel,
        projectRoot: session.projectAccess?.enabled ? session.workingDirectory : null,
        queueCount: session.queue.length,
        unread: session.unread,
      })),
      ...(queried ? { total: queried.total, hasMore: queried.hasMore, query: filters?.search ?? query ?? null, offset: queried.offset, limit: queried.limit } : {}),
    });
  }

  private async deleteSession(sessionId: string): Promise<void> {
    await this.refreshSnapshot();
    const snapshot = this.requiredSnapshot();
    const target = snapshot.sessions.find((session) => session.id === sessionId || session.id.startsWith(sessionId));
    if (!target || !await this.port.deleteSession(sessionId)) {
      throw new CliControllerError("SESSION_DELETE_REJECTED", "会话不存在、仍在运行或删除未获应用服务接受。 ");
    }
    await this.refreshSnapshot();
    this.emit("session.deleted", { id: target.id, title: target.title }, snapshot.activeSessionId);
  }

  private async showRouting(): Promise<void> {
    await this.refreshSnapshot();
    this.emit("routing", { state: this.requiredSnapshot().smartRouting ?? { enabled: false, strategy: "balanced" } });
  }

  private async showCapabilities(): Promise<void> {
    const center = await this.port.getCompositionCenter?.();
    if (!center) throw new CliControllerError("CAPABILITIES_UNAVAILABLE", "能力方案服务不可用。 ");
    this.emit("capabilities", { center });
  }

  private async handlePreset(preset?: Extract<CliCommand, { kind: "preset" }>["preset"], name?: string): Promise<void> {
    if (!preset) return this.showCapabilities();
    const center = preset === "custom"
      ? name && await this.port.selectCustomComposition?.(name)
      : await this.port.setCompositionPreset?.(preset);
    if (!center) throw new CliControllerError("CAPABILITIES_UNAVAILABLE", "能力方案服务不可用，或自定义方案不存在。 ");
    this.emit("capabilities.changed", {
      action: preset === "custom" ? "selected-custom" : "selected",
      preset,
      ...(name ? { customName: name } : {}),
      center,
    });
  }

  private async copyPreset(source: Extract<CliCommand, { kind: "preset-copy" }>["source"], name: string): Promise<void> {
    if (!this.port.copyCompositionPreset) throw new CliControllerError("CAPABILITIES_UNAVAILABLE", "能力方案服务不可用。 ");
    const center = await this.port.copyCompositionPreset(source, name);
    this.emit("capabilities.changed", { action: "copied", source, customName: name, center });
  }

  private async togglePresetCapability(name: string, capabilityId: string, enabled: boolean): Promise<void> {
    if (!this.port.setCompositionCapability) throw new CliControllerError("CAPABILITIES_UNAVAILABLE", "能力方案服务不可用。 ");
    const center = await this.port.setCompositionCapability(name, capabilityId, enabled);
    this.emit("capabilities.changed", { action: enabled ? "enabled" : "disabled", customName: name, capabilityId, center });
  }

  private async orderPreset(name: string, order: string[]): Promise<void> {
    if (!this.port.reorderComposition) throw new CliControllerError("CAPABILITIES_UNAVAILABLE", "能力方案服务不可用。 ");
    const center = await this.port.reorderComposition(name, order);
    this.emit("capabilities.changed", { action: "reordered", customName: name, order, center });
  }

  private async restorePreset(): Promise<void> {
    if (!this.port.restoreDefaultComposition) throw new CliControllerError("CAPABILITIES_UNAVAILABLE", "能力方案服务不可用。 ");
    const center = await this.port.restoreDefaultComposition();
    this.emit("capabilities.changed", { action: "restored-default", center });
  }

  private async steerRun(runId: string, message: string): Promise<void> {
    if (!this.port.steer) throw new CliControllerError("STEER_UNAVAILABLE", "运行 steer 服务不可用。 ");
    const receipt = await this.port.steer(runId, message);
    this.emit("steering.updated", { action: "queued", runId, message, receipt });
  }

  private async handleWorkflow(workflowId?: string, inputText?: string): Promise<void> {
    const snapshot = await this.port.listWorkflows?.();
    if (!snapshot) throw new CliControllerError("WORKFLOW_UNAVAILABLE", "工作流服务不可用。 ");
    if (!workflowId) {
      this.emit("workflows", { snapshot });
      return;
    }
    const definitions = snapshot.definitions.filter((definition) => definition.id === workflowId || definition.id.startsWith(workflowId));
    if (definitions.length !== 1) throw new CliControllerError("WORKFLOW_NOT_FOUND", `未找到唯一工作流 '${workflowId}'。`);
    if (!this.port.runWorkflow) throw new CliControllerError("WORKFLOW_UNAVAILABLE", "工作流运行服务不可用。 ");
    await this.refreshSnapshot();
    const session = currentSession(this.requiredSnapshot());
    const run = await this.port.runWorkflow({
      definition: definitions[0],
      sessionId: session.id,
      permissionMode: session.permissionMode,
      input: inputText ? parseJson<Record<string, unknown>>(inputText, "工作流输入") : {},
    });
    this.emit("workflow.changed", { action: "started", run }, session.id);
  }

  private async cancelWorkflow(workflowRunId: string): Promise<void> {
    if (!this.port.cancelWorkflow || !await this.port.cancelWorkflow(workflowRunId)) {
      throw new CliControllerError("WORKFLOW_CANCEL_REJECTED", `工作流运行 '${workflowRunId}' 不存在或无法取消。`);
    }
    this.emit("workflow.changed", { action: "cancel-requested", workflowRunId });
  }

  private async recoverWorkflow(workflowRunId: string, decision: "reconfirm"): Promise<void> {
    if (!this.port.recoverWorkflow) throw new CliControllerError("WORKFLOW_UNAVAILABLE", "工作流恢复服务不可用。 ");
    const run = await this.port.recoverWorkflow(workflowRunId, decision);
    this.emit("workflow.changed", { action: "recovered", decision, run });
  }

  private async showMemory(): Promise<void> {
    await this.refreshSnapshot();
    this.emit("memory", { items: this.requiredSnapshot().memories?.entries ?? [], capacityWarning: this.requiredSnapshot().memories?.capacityWarning ?? false });
  }

  private async createMemory(scope: Extract<CliCommand, { kind: "memory-create" }>["scope"], text: string): Promise<void> {
    const snapshot = this.requiredSnapshot();
    const session = currentSession(snapshot);
    // Every /memory-create command is an explicit user action, including a
    // session-scoped memory.  Keep it distinct from automatic assistant
    // captures so the runtime can exclude only duplicated model output from
    // the stable Provider prefix.
    const source: MemoryCreateInput["source"] = scope === "project" ? "project-derived" : "user-explicit";
    const input: MemoryCreateInput = {
      scope,
      source,
      text,
      ...(scope === "session-auto" ? { sessionId: session.id } : {}),
      ...(scope === "project" && session.projectAccess?.enabled ? { projectRoot: session.workingDirectory } : {}),
    };
    if (!this.port.createMemory || !await this.port.createMemory(input)) throw new CliControllerError("MEMORY_CREATE_REJECTED", "记忆服务未接受创建请求。 ");
    await this.refreshSnapshot();
    this.emit("memory.changed", { action: "created", items: this.requiredSnapshot().memories?.entries ?? [] }, session.id);
  }

  private async updateMemory(id: string, text: string): Promise<void> {
    if (!this.port.updateMemory || !await this.port.updateMemory(id, text)) throw new CliControllerError("MEMORY_UPDATE_REJECTED", "记忆不存在或未接受编辑。 ");
    await this.refreshSnapshot();
    this.emit("memory.changed", { action: "updated", items: this.requiredSnapshot().memories?.entries ?? [] });
  }

  private async enableMemory(id: string, enabled: boolean): Promise<void> {
    if (!this.port.setMemoryEnabled || !await this.port.setMemoryEnabled(id, enabled)) throw new CliControllerError("MEMORY_ENABLE_REJECTED", "记忆不存在或未接受状态变更。 ");
    await this.refreshSnapshot();
    this.emit("memory.changed", { action: enabled ? "enabled" : "disabled", items: this.requiredSnapshot().memories?.entries ?? [] });
  }

  private async deleteMemory(id: string): Promise<void> {
    if (!this.port.deleteMemory || !await this.port.deleteMemory(id)) throw new CliControllerError("MEMORY_DELETE_REJECTED", "记忆不存在或未接受删除。 ");
    await this.refreshSnapshot();
    this.emit("memory.changed", { action: "deleted", items: this.requiredSnapshot().memories?.entries ?? [] });
  }

  private async showIndex(): Promise<void> {
    await this.refreshSnapshot();
    const session = currentSession(this.requiredSnapshot());
    this.emit("index", { state: this.requiredSnapshot().projectIndexes?.find((item) => item.projectRoot === session.workingDirectory) ?? this.requiredSnapshot().projectIndexes?.[0] ?? { status: "disabled", explicit: false } });
  }

  private async handleIndex(action?: Extract<CliCommand, { kind: "index" }>["action"], value?: string | boolean): Promise<void> {
    const snapshot = this.requiredSnapshot();
    const session = currentSession(snapshot);
    if (!action) return this.showIndex();
    if (action === "build") {
      if (!this.port.buildProjectIndex) throw new CliControllerError("INDEX_UNAVAILABLE", "项目索引服务不可用。 ");
      await this.port.buildProjectIndex(session.id);
    } else if (action === "search") {
      if (!this.port.searchProjectIndex || typeof value !== "string") throw new CliControllerError("INDEX_UNAVAILABLE", "项目搜索服务不可用。 ");
      const result = await this.port.searchProjectIndex(session.id, value);
      this.emit("index.changed", { action, query: value, result }, session.id);
      return;
    } else if (action === "semantic") {
      if (!this.port.setProjectIndexSemantic || typeof value !== "boolean") throw new CliControllerError("INDEX_UNAVAILABLE", "语义索引服务不可用。 ");
      await this.port.setProjectIndexSemantic(value);
    }
    await this.refreshSnapshot();
    this.emit("index.changed", { action, state: this.requiredSnapshot().projectIndexes?.find((item) => item.projectRoot === session.workingDirectory) ?? null }, session.id);
  }

  private async useSession(reference: string): Promise<void> {
    await this.refreshSnapshot();
    const session = resolveSession(this.requiredSnapshot(), reference);
    if (!await this.port.setActiveSession(session.id)) {
      throw new CliControllerError("SESSION_SWITCH_REJECTED", "应用服务拒绝切换到该会话。");
    }
    await this.refreshSnapshot();
    const selected = currentSession(this.requiredSnapshot());
    this.emit("session.selected", {
      id: selected.id,
      title: selected.title,
      projectRoot: selected.projectAccess?.enabled ? selected.workingDirectory : null,
    }, selected.id);
  }

  private async listRuns(): Promise<void> {
    await this.refreshSnapshot();
    const session = currentSession(this.requiredSnapshot());
    const items = await this.port.listRuns(session.id);
    this.emit("runs", {
      sessionTitle: session.title,
      items: items.map((run) => ({
        runId: run.runId,
        status: run.status,
        origin: run.origin.kind,
        text: run.text,
        queuedReason: run.queuedReason ?? null,
        checkpoint: run.checkpoint ?? null,
        providerAttempt: run.providerAttempt ?? null,
        active: run.status === "running" || run.status === "waiting_resource" || run.status === "recovering" || run.status === "replaying",
      })),
    }, session.id);
  }

  private async selectRun(runId: string): Promise<void> {
    await this.refreshSnapshot();
    const session = currentSession(this.requiredSnapshot());
    const run = (this.requiredSnapshot().runs ?? []).find((item) => item.runId === runId && item.sessionId === session.id);
    if (!run || !await this.port.selectRun(runId)) {
      throw new CliControllerError("RUN_NOT_FOUND", `未找到当前会话运行 '${runId}'。`);
    }
    this.emit("run.selected", { runId: run.runId, status: run.status, text: run.text }, session.id);
  }

  private async cancelRun(runId: string): Promise<void> {
    await this.refreshSnapshot();
    const session = currentSession(this.requiredSnapshot());
    const run = (this.requiredSnapshot().runs ?? []).find((item) => item.runId === runId && item.sessionId === session.id);
    if (!run || !await this.port.cancelRun(runId)) {
      throw new CliControllerError("RUN_CANCEL_REJECTED", `运行 '${runId}' 不存在、已结束或不属于当前会话。`);
    }
    this.emit("run.cancel.requested", { runId, status: run.status }, session.id);
  }

  private async renameSession(name: string): Promise<void> {
    await this.refreshSnapshot();
    const session = currentSession(this.requiredSnapshot());
    if (!await this.port.renameSession(session.id, name)) {
      throw new CliControllerError("SESSION_RENAME_REJECTED", "当前会话正在运行、名称为空，或会话已不存在。");
    }
    await this.refreshSnapshot();
    const renamed = currentSession(this.requiredSnapshot());
    this.emit("session.renamed", { id: renamed.id, title: renamed.title }, renamed.id);
  }

  private async runPrompt(prompt: string, waitForTerminal: boolean): Promise<CliExitCode> {
    await this.refreshSnapshot();
    const snapshot = this.requiredSnapshot();
    const session = currentSession(snapshot);
    const provider = snapshot.providers.find((item) => item.id === session.selectedProviderId);
    if (!provider?.available) {
      this.error(
        "CONFIGURATION_MISSING",
        `当前 Provider '${session.selectedProviderId}' 尚未配置为可运行；请先在桌面设置中完成连接。`,
        session.id,
      );
      return CLI_EXIT_CODE.configurationMissing;
    }
    if (!provider.models.some((model) => model.id === session.selectedModel)) {
      this.error(
        "CONFIGURATION_MISSING",
        `当前模型 '${session.selectedModel}' 不在 Provider '${provider.name}' 的可用模型中。`,
        session.id,
      );
      return CLI_EXIT_CODE.configurationMissing;
    }

    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      this.error("CLI_USAGE", "任务内容不能为空。", session.id);
      return CLI_EXIT_CODE.usageError;
    }
    const pending = waitForTerminal ? this.createRunWaiter(session.id, normalizedPrompt) : undefined;
    let result;
    try {
      result = await this.port.send({
        sessionId: session.id,
        text: normalizedPrompt,
        attachments: [],
        selectedModel: session.selectedModel,
        permissionMode: session.permissionMode,
      });
    } catch (error) {
      pending?.cancel();
      this.error("RUN_SUBMISSION_FAILED", errorMessage(error), session.id);
      return CLI_EXIT_CODE.runFailed;
    }
    if (!result.accepted) {
      pending?.cancel();
      this.error("RUN_REJECTED", `任务未进入 Agent Runtime：${result.reason ?? "未知原因"}`, session.id);
      return CLI_EXIT_CODE.runFailed;
    }
    if (result.queued) {
      this.emit("run.queued", { sessionTitle: session.title }, session.id);
    }
    if (!pending) return CLI_EXIT_CODE.completed;
    const terminal = await pending.promise;
    if (terminal.status === "completed") return CLI_EXIT_CODE.completed;
    if (terminal.status === "cancelled") return CLI_EXIT_CODE.cancelled;
    return CLI_EXIT_CODE.runFailed;
  }

  private async cancelCurrent(): Promise<void> {
    await this.refreshSnapshot();
    const session = currentSession(this.requiredSnapshot());
    if (isRunning(session) && await this.port.cancel(session.id)) {
      this.emit("cancel.requested", { target: "运行", sessionTitle: session.title }, session.id);
      return;
    }
    if (session.waitingFor && await this.port.cancelWait(session.id)) {
      this.emit("cancel.requested", { target: "等待", sessionTitle: session.title }, session.id);
      return;
    }
    throw new CliControllerError("NOTHING_TO_CANCEL", "当前会话没有可取消的运行或等待。");
  }

  private async showTokens(): Promise<void> {
    await this.refreshSnapshot();
    const snapshot = this.requiredSnapshot();
    const session = currentSession(snapshot);
    const usage = snapshot.telemetry.sessions.find((item) => item.sessionId === session.id);
    const currentEstimate = usage?.currentRun?.status === "estimating"
      ? usageData(usage.currentRun.usage)
      : null;
    const providerFinal = usage?.latestRun?.status === "reconciled" && usage.latestRun.usage.source === "provider"
      ? usageData(usage.latestRun.usage)
      : null;
    this.emit("tokens", {
      sessionTitle: session.title,
      currentEstimate,
      providerFinal,
      sessionCumulative: usage ? usageData(usage.cumulative) : usageData(undefined),
      latestStatus: usage?.latestRun?.status ?? "unavailable",
    }, session.id);
  }

  private async showWorkspace(): Promise<void> {
    await this.refreshSnapshot();
    const session = currentSession(this.requiredSnapshot());
    const workspaces = (this.requiredSnapshot().workspaces ?? []).filter((workspace) => workspace.runId || workspace.projectRoot);
    this.emit("workspace", {
      sessionTitle: session.title,
      items: workspaces.map((workspace) => ({
        id: workspace.id,
        mode: workspace.mode,
        status: workspace.status,
        branchName: workspace.branchName ?? null,
        ownedPaths: workspace.ownedPaths,
        checksPassed: workspace.checksPassed,
        reviewOutcome: workspace.reviewOutcome ?? null,
        mergeStatus: workspace.mergeStatus ?? "not-requested",
      })),
    }, session.id);
  }

  private async showReview(): Promise<void> {
    await this.refreshSnapshot();
    const session = currentSession(this.requiredSnapshot());
    this.emit("review", {
      sessionTitle: session.title,
      items: this.requiredSnapshot().reviews ?? [],
    }, session.id);
  }

  private async showSettings(): Promise<void> {
    const settings = await this.port.getProductSettings?.();
    this.emit("settings", { settings: settings ?? {} });
  }

  private async showDiagnostics(runId?: string): Promise<void> {
    const preview = await this.port.getDiagnosticsPreview?.(runId);
    this.emit("diagnostics", { preview: preview ?? { fields: [] } });
  }

  private async setDiagnosticsConsent(enabled: boolean): Promise<void> {
    if (!this.port.setDiagnosticsConsent || !await this.port.setDiagnosticsConsent(enabled)) throw new CliControllerError("DIAGNOSTICS_CONSENT_REJECTED", "诊断同意状态未被接受。 ");
    this.emit("diagnostics.consent", { enabled, upload: "未配置官方端点时不可用" });
  }

  private async showUpdates(channel: "preview" | "stable"): Promise<void> {
    const result = await this.port.checkUpdates?.(channel);
    this.emit("updates", { state: result ?? { status: "unavailable", officialSourceConfigured: false, channel } });
  }

  private async downloadUpdate(): Promise<void> {
    const result = await this.port.downloadUpdate?.();
    this.emit("update.changed", { action: "download", state: result ?? { status: "unavailable", officialSourceConfigured: false } });
  }

  private async confirmUpdateInstall(): Promise<void> {
    const result = await this.port.confirmUpdateInstall?.();
    this.emit("update.changed", { action: "install", state: result ?? { status: "unavailable", officialSourceConfigured: false } });
  }

  private async setSetting(key: string, valueText: string): Promise<void> {
    if (!this.port.setProductSetting) throw new CliControllerError("SETTINGS_UNAVAILABLE", "设置服务不可用。 ");
    const value = parseScalar(valueText);
    const settings = await this.port.setProductSetting(key, value);
    this.emit("setting.changed", { key, settings });
  }

  private async exportArchive(path: string): Promise<void> {
    const session = currentSession(this.requiredSnapshot());
    const result = await this.port.exportArchive?.({ targetPath: path, scope: { kind: "all" } });
    this.emit("archive.exported", { path, scope: "all", result }, session.id);
  }

  private async previewArchiveImport(path: string): Promise<void> {
    const staged = await this.port.stageArchiveImport?.(path);
    if (!staged || typeof staged !== "object" || typeof (staged as { stagingId?: unknown }).stagingId !== "string") throw new Error("归档暂存失败。");
    const preview = await this.port.previewArchiveImport?.((staged as { stagingId: string }).stagingId);
    this.emit("archive.preview", { path, preview });
  }

  private async credentialBoundary(action: "export" | "import", path: string): Promise<void> {
    this.emit("credential.boundary", {
      action,
      path,
      status: "unavailable",
      message: "CLI 不从命令参数或普通文件读取密钥包密码；请在桌面密钥迁移向导中完成。",
    });
  }

  private async showInbox(): Promise<void> {
    await this.refreshSnapshot();
    const snapshot = this.requiredSnapshot();
    const session = currentSession(snapshot);
    const names = sessionNames(snapshot);
    const items = snapshot.coordination.envelopes
      .filter((envelope) => envelope.targetSessionId === session.id)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((envelope) => ({
        id: envelope.id,
        sourceSessionId: envelope.sourceSessionId,
        sourceTitle: names.get(envelope.sourceSessionId) ?? envelope.sourceSessionId,
        type: envelope.type,
        status: envelope.status,
        body: envelope.body,
        createdAt: envelope.createdAt,
        correlationId: envelope.correlationId ?? null,
      }));
    this.emit("inbox", { sessionTitle: session.title, items }, session.id);
  }

  private async sendMessage(targetReference: string, message: string): Promise<void> {
    await this.refreshSnapshot();
    const snapshot = this.requiredSnapshot();
    const source = currentSession(snapshot);
    const target = resolveSession(snapshot, targetReference);
    const envelope = objectValue(await this.port.sendMessage(source.id, target.id, message));
    this.emit("coordination.sent", {
      envelopeId: stringValue(envelope?.id) || null,
      targetSessionId: target.id,
      targetTitle: target.title,
      status: stringValue(envelope?.status) || "accepted",
    }, source.id);
  }

  private async delegate(targetReference: string, task: string): Promise<void> {
    await this.refreshSnapshot();
    const snapshot = this.requiredSnapshot();
    const source = currentSession(snapshot);
    const target = resolveSession(snapshot, targetReference);
    const envelope = objectValue(await this.port.delegateTask(source.id, target.id, task));
    this.emit("coordination.delegated", {
      envelopeId: stringValue(envelope?.id) || null,
      targetSessionId: target.id,
      targetTitle: target.title,
      status: stringValue(envelope?.status) || "accepted",
    }, source.id);
  }

  private async waitForMessage(sourceReference?: string): Promise<void> {
    await this.refreshSnapshot();
    const snapshot = this.requiredSnapshot();
    const session = currentSession(snapshot);
    const source = sourceReference ? resolveSession(snapshot, sourceReference) : undefined;
    const result = objectValue(await this.port.waitForMessage(session.id, {
      fromSessionId: source?.id,
    }));
    const matchedEnvelopeId = stringValue(result?.matchedEnvelopeId);
    if (matchedEnvelopeId) {
      this.emit("coordination.matched", { envelopeId: matchedEnvelopeId }, session.id);
      return;
    }
    if (result?.waiting !== true) {
      throw new CliControllerError("WAIT_REJECTED", "应用服务未建立等待，也没有匹配到现有消息。");
    }
    this.emit("coordination.waiting", {
      sourceSessionId: source?.id ?? null,
      sourceTitle: source?.title ?? "",
    }, session.id);
  }

  private async showSchedules(): Promise<void> {
    await this.refreshSnapshot();
    const definitions = this.requiredSnapshot().scheduler.definitions;
    this.emit("schedules", {
      runtimeScope: this.requiredSnapshot().scheduler.runtimeScope,
      items: definitions.map((definition) => ({
        id: definition.id,
        name: definition.name,
        enabled: definition.enabled,
        pattern: definition.schedule.kind,
        target: definition.target.kind,
        nextRunAt: definition.nextRunAt ?? null,
        nextRun: definition.nextRunAt === undefined ? "" : new Date(definition.nextRunAt).toISOString(),
        lastRunAt: definition.lastRunAt ?? null,
        status: definition.status ?? (definition.enabled ? "active" : "paused"),
        previews: (this.requiredSnapshot().scheduler.previews?.[definition.id] ?? []).map((preview) => ({
          at: preview.at,
          source: preview.source,
        })),
      })),
      editing: "desktop-only",
    });
  }

  private async createSchedule(draftText: string): Promise<void> {
    if (!this.port.createSchedule) throw new CliControllerError("SCHEDULER_UNAVAILABLE", "调度服务不可用。 ");
    const draft = parseJson<ScheduleDraft>(draftText, "调度 JSON");
    const result = await this.port.createSchedule(draft);
    await this.refreshSnapshot();
    this.emit("schedule.changed", { action: "created", result, scheduler: this.requiredSnapshot().scheduler });
  }

  private async setScheduleEnabled(id: string, enabled: boolean): Promise<void> {
    if (!this.port.setScheduleEnabled || !await this.port.setScheduleEnabled(id, enabled)) throw new CliControllerError("SCHEDULE_CHANGE_REJECTED", "自动任务不存在或状态变更未被接受。 ");
    await this.refreshSnapshot();
    this.emit("schedule.changed", { action: enabled ? "enabled" : "paused", scheduler: this.requiredSnapshot().scheduler });
  }

  private async runSchedule(id: string): Promise<void> {
    if (!this.port.runScheduleNow || !await this.port.runScheduleNow(id)) throw new CliControllerError("SCHEDULE_RUN_REJECTED", "自动任务不存在或未能立即运行。 ");
    await this.refreshSnapshot();
    this.emit("schedule.changed", { action: "run-now", id, scheduler: this.requiredSnapshot().scheduler });
  }

  private async deleteSchedule(id: string): Promise<void> {
    if (!this.port.deleteSchedule || !await this.port.deleteSchedule(id)) throw new CliControllerError("SCHEDULE_DELETE_REJECTED", "自动任务不存在或删除未被接受。 ");
    await this.refreshSnapshot();
    this.emit("schedule.changed", { action: "deleted", id, scheduler: this.requiredSnapshot().scheduler });
  }

  private async restoreSchedule(id: string): Promise<void> {
    if (!this.port.restoreSchedule || !await this.port.restoreSchedule(id)) throw new CliControllerError("SCHEDULE_RESTORE_REJECTED", "自动任务不存在或恢复未被接受。 ");
    await this.refreshSnapshot();
    this.emit("schedule.changed", { action: "restored", id, scheduler: this.requiredSnapshot().scheduler });
  }

  private async showNotifications(): Promise<void> {
    await this.refreshSnapshot();
    const notifications = this.requiredSnapshot().notifications;
    this.emit("notifications", {
      items: notifications?.items ?? [],
      soundEnabled: notifications?.soundEnabled ?? false,
      lockScreenBody: notifications?.lockScreenBody ?? false,
    });
  }

  private async showArtifacts(): Promise<void> {
    await this.refreshSnapshot();
    this.emit("artifacts", {
      items: (this.requiredSnapshot().artifacts?.records ?? []).map((record) => ({
        id: record.id,
        runId: record.runId,
        kind: record.kind,
        state: record.state,
        sizeBytes: record.sizeBytes,
        retention: record.retention,
      })),
    });
  }

  private async showSkills(): Promise<void> {
    await this.refreshSnapshot();
    const snapshot = this.requiredSnapshot();
    const session = currentSession(snapshot);
    this.emit("skills", {
      items: snapshot.extensions.skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        source: skill.source,
        enabled: skill.enabledSessionIds.includes(session.id),
        loaded: skill.loaded,
      })),
      editing: "desktop-only",
    }, session.id);
  }

  private async showExtensions(): Promise<void> {
    await this.refreshSnapshot();
    const extensions = this.requiredSnapshot().extensions;
    this.emit("extensions", {
      items: (extensions.records ?? []).map((record) => ({
        id: record.id,
        name: record.name,
        kind: record.kind,
        source: record.source,
        version: record.current?.version ?? null,
        previous: record.previous?.version ?? null,
        trust: record.trust,
        status: record.status,
        enabled: record.enabled,
        capabilities: record.capabilities,
        pendingUpdate: record.pendingUpdate?.version ?? null,
        pendingRollback: record.pendingRollback === true,
        failure: record.failure ?? null,
      })),
      mcp: (extensions.mcpConnections ?? []).map((connection) => ({
        id: connection.id,
        endpoint: connection.endpoint,
        configured: connection.configured,
        connected: connection.connected,
        lastError: connection.lastError ?? null,
      })),
      policy: "未信任/未知扩展执行次数为 0；更新与回退均需显式确认。",
    });
  }

  private async stageExtension(location: string, source: Extract<CliCommand, { kind: "extension-stage" }>["source"]): Promise<void> {
    if (!this.port.stageExtension) throw new CliControllerError("EXTENSION_UNAVAILABLE", "扩展管理服务不可用。 ");
    const result = await this.port.stageExtension({ source: source ?? "local", location });
    this.emit("extension.changed", {
      action: "staged",
      stagingId: result.stagingId,
      id: result.manifest.id,
      version: result.manifest.version,
      source: result.source,
      entry: result.manifest.entry ?? null,
    });
  }

  private async installExtension(stagingId: string): Promise<void> {
    if (!this.port.installExtension) throw new CliControllerError("EXTENSION_UNAVAILABLE", "扩展管理服务不可用。 ");
    const result = await this.port.installExtension(stagingId);
    await this.refreshSnapshot();
    this.emit("extension.changed", { action: "installed", stagingId, result, extensions: this.requiredSnapshot().extensions });
  }

  private async trustExtension(id: string, version: string): Promise<void> {
    if (!this.port.trustExtension || !await this.port.trustExtension(id, version)) throw new CliControllerError("EXTENSION_TRUST_REJECTED", "扩展信任未被接受。 ");
    await this.refreshSnapshot();
    this.emit("extension.changed", { action: "trusted", id, version, extensions: this.requiredSnapshot().extensions });
  }

  private async enableExtension(id: string, enabled: boolean): Promise<void> {
    if (!this.port.enableExtension || !await this.port.enableExtension(id, enabled)) throw new CliControllerError("EXTENSION_ENABLE_REJECTED", "扩展未找到或启用状态未被接受。 ");
    await this.refreshSnapshot();
    this.emit("extension.changed", { action: enabled ? "enabled" : "disabled", id, extensions: this.requiredSnapshot().extensions });
  }

  private async requestExtensionUpdate(id: string, stagingId: string): Promise<void> {
    if (!this.port.requestExtensionUpdate || !await this.port.requestExtensionUpdate(id, stagingId)) throw new CliControllerError("EXTENSION_UPDATE_REJECTED", "扩展更新请求未被接受。 ");
    await this.refreshSnapshot();
    this.emit("extension.changed", { action: "update-requested", id, stagingId, extensions: this.requiredSnapshot().extensions });
  }

  private async confirmExtensionUpdate(id: string): Promise<void> {
    if (!this.port.confirmExtensionUpdate || !await this.port.confirmExtensionUpdate(id)) throw new CliControllerError("EXTENSION_UPDATE_REJECTED", "扩展更新确认未被接受。 ");
    await this.refreshSnapshot();
    this.emit("extension.changed", { action: "updated", id, extensions: this.requiredSnapshot().extensions });
  }

  private async requestExtensionRollback(id: string): Promise<void> {
    if (!this.port.requestExtensionRollback || !await this.port.requestExtensionRollback(id)) throw new CliControllerError("EXTENSION_ROLLBACK_REJECTED", "扩展回退请求未被接受。 ");
    await this.refreshSnapshot();
    this.emit("extension.changed", { action: "rollback-requested", id, extensions: this.requiredSnapshot().extensions });
  }

  private async confirmExtensionRollback(id: string): Promise<void> {
    if (!this.port.confirmExtensionRollback || !await this.port.confirmExtensionRollback(id)) throw new CliControllerError("EXTENSION_ROLLBACK_REJECTED", "扩展回退确认未被接受。 ");
    await this.refreshSnapshot();
    this.emit("extension.changed", { action: "rolled-back", id, extensions: this.requiredSnapshot().extensions });
  }

  private async configureMcp(id: string, endpoint: string): Promise<void> {
    if (!this.port.configureMcp) throw new CliControllerError("MCP_UNAVAILABLE", "MCP 管理服务不可用。 ");
    const result = await this.port.configureMcp({ id, endpoint });
    await this.refreshSnapshot();
    this.emit("mcp.changed", { action: "configured", id, result, extensions: this.requiredSnapshot().extensions });
  }

  private async connectMcp(id: string): Promise<void> {
    if (!this.port.connectMcp) throw new CliControllerError("MCP_UNAVAILABLE", "MCP 管理服务不可用。 ");
    const result = await this.port.connectMcp(id);
    await this.refreshSnapshot();
    this.emit("mcp.changed", { action: "connected", id, result, extensions: this.requiredSnapshot().extensions });
  }

  private async showProviders(): Promise<void> {
    await this.refreshSnapshot();
    const snapshot = this.requiredSnapshot();
    this.emit("providers", {
      items: snapshot.providers.map((provider) => {
        const profile = snapshot.providerCatalog.profiles.find((item) => item.profile.id === provider.id);
        return {
        id: provider.id,
        name: provider.name,
        protocol: provider.protocol ?? null,
        configuration: provider.configuration,
        available: provider.available,
        realCallsEnabled: provider.realCallsEnabled,
        models: provider.models.map((model) => model.id),
        modelCatalog: profile?.configuration.modelCatalog ?? null,
        network: profile?.network ?? null,
        geminiServerState: profile?.geminiServerState ?? null,
        };
      }),
      realApiStatus: snapshot.providerCatalog.realApiStatus,
      localModels: snapshot.localModels ?? { cloudDefault: true, records: [], maxConcurrency: 1, activeRuns: 0 },
      retryPolicy: "每个逻辑请求最多 5 次；有语义输出、工具调用或外部影响后不重试。",
      editing: "desktop-only",
    });
  }

  private async selectProvider(profileReference: string, model: string): Promise<void> {
    await this.refreshSnapshot();
    const snapshot = this.requiredSnapshot();
    const session = currentSession(snapshot);
    const provider = resolveProvider(snapshot, profileReference);
    if (!provider.available || provider.configuration === "not-connected") {
      throw new CliControllerError("CONFIGURATION_MISSING", "该 Provider 尚未配置；请先在桌面端保存凭据和模型。");
    }
    if (!provider.models.some((item) => item.id === model)) {
      throw new CliControllerError("MODEL_NOT_AVAILABLE", `模型 '${model}' 不在该 Provider 当前可用模型中。`);
    }
    if (!await this.port.setProviderModel(session.id, provider.id, model)) {
      throw new CliControllerError("PROVIDER_SWITCH_REJECTED", "当前会话正在运行，或应用服务拒绝该 Provider/model。");
    }
    await this.refreshSnapshot();
    this.emit("provider.selected", {
      providerId: provider.id,
      providerName: provider.name,
      model,
    }, session.id);
  }

  private async setProviderEndpoint(profileReference: string, endpoint: string): Promise<void> {
    if (!this.port.setProviderEndpoint) throw new CliControllerError("PROVIDER_UNAVAILABLE", "Provider 设置服务不可用。 ");
    const provider = resolveProvider(this.requiredSnapshot(), profileReference);
    if (!await this.port.setProviderEndpoint(provider.id, endpoint)) throw new CliControllerError("PROVIDER_ENDPOINT_REJECTED", "Provider endpoint 未被接受。 ");
    await this.refreshSnapshot();
    this.emit("provider.changed", { action: "endpoint", providerId: provider.id, endpoint: safeEndpoint(endpoint), providers: this.requiredSnapshot().providers });
  }

  private async setProviderManualModel(profileReference: string, model: string): Promise<void> {
    if (!this.port.setProviderManualModel) throw new CliControllerError("PROVIDER_UNAVAILABLE", "Provider 设置服务不可用。 ");
    const provider = resolveProvider(this.requiredSnapshot(), profileReference);
    if (!await this.port.setProviderManualModel(provider.id, model)) throw new CliControllerError("PROVIDER_MODEL_REJECTED", "Provider 手工模型未被接受。 ");
    await this.refreshSnapshot();
    this.emit("provider.changed", { action: "manual-model", providerId: provider.id, model, providers: this.requiredSnapshot().providers });
  }

  private async setProviderCapabilities(profileReference: string, text: string): Promise<void> {
    if (!this.port.setProviderCapabilities) throw new CliControllerError("PROVIDER_UNAVAILABLE", "Provider 设置服务不可用。 ");
    const provider = resolveProvider(this.requiredSnapshot(), profileReference);
    const capabilities = parseCapabilities(text);
    if (!await this.port.setProviderCapabilities(provider.id, capabilities)) throw new CliControllerError("PROVIDER_CAPABILITIES_REJECTED", "Provider 能力开关未被接受。 ");
    await this.refreshSnapshot();
    this.emit("provider.changed", { action: "capabilities", providerId: provider.id, capabilities, providers: this.requiredSnapshot().providers });
  }

  private async showLocalModels(): Promise<void> {
    await this.refreshSnapshot();
    this.emit("local-models", { localModels: this.requiredSnapshot().localModels ?? { cloudDefault: true, records: [], maxConcurrency: 1, activeRuns: 0 } });
  }

  private async registerLocalModel(text: string): Promise<void> {
    if (!this.port.registerLocalModel) throw new CliControllerError("LOCAL_MODEL_UNAVAILABLE", "本地模型服务不可用。 ");
    const registration = parseJson<LocalModelRegistration>(text, "本地模型 JSON");
    if (!await this.port.registerLocalModel(registration)) throw new CliControllerError("LOCAL_MODEL_REGISTER_REJECTED", "本地模型登记未被接受。 ");
    await this.refreshSnapshot();
    this.emit("local-models", { action: "registered", localModels: this.requiredSnapshot().localModels });
  }

  private async confirmLocalModel(id: string, version: string): Promise<void> {
    if (!this.port.confirmLocalModel || !await this.port.confirmLocalModel(id, version)) throw new CliControllerError("LOCAL_MODEL_CONFIRM_REJECTED", "本地模型采用未被接受。 ");
    await this.refreshSnapshot();
    this.emit("local-models", { action: "confirmed", id, version, localModels: this.requiredSnapshot().localModels });
  }

  private async requestLocalModelUpdate(id: string, version: string): Promise<void> {
    if (!this.port.requestLocalModelUpdate || !await this.port.requestLocalModelUpdate(id, version)) throw new CliControllerError("LOCAL_MODEL_UPDATE_REJECTED", "本地模型更新请求未被接受。 ");
    await this.refreshSnapshot();
    this.emit("local-models", { action: "update-requested", id, version, localModels: this.requiredSnapshot().localModels });
  }

  private async confirmLocalModelUpdate(id: string): Promise<void> {
    if (!this.port.confirmLocalModelUpdate || !await this.port.confirmLocalModelUpdate(id)) throw new CliControllerError("LOCAL_MODEL_UPDATE_REJECTED", "本地模型更新确认未被接受。 ");
    await this.refreshSnapshot();
    this.emit("local-models", { action: "updated", id, localModels: this.requiredSnapshot().localModels });
  }

  private async selectPermission(
    selection: Extract<CliCommand, { kind: "permission" }>["selection"],
  ): Promise<void> {
    await this.refreshSnapshot();
    const session = currentSession(this.requiredSnapshot());
    if (!await this.port.setPermissionMode(session.id, selection)) {
      throw new CliControllerError("PERMISSION_CHANGE_REJECTED", "当前会话正在运行，或权限状态未被应用服务接受。");
    }
    await this.refreshSnapshot();
    this.emit("permission.selected", {
      selection,
      message: permissionSelectionLabel(selection),
    }, session.id);
  }

  private async restoreProjectChange(receiptId: string): Promise<void> {
    await this.refreshSnapshot();
    const session = currentSession(this.requiredSnapshot());
    const result = objectValue(await this.port.restoreProjectChange(session.id, receiptId));
    if (result?.ok !== true) {
      const error = objectValue(result?.error);
      throw new CliControllerError(
        stringValue(error?.code) || "RESTORE_FAILED",
        stringValue(error?.message) || "恢复未完成；回执和当前项目均未被隐藏处理。",
      );
    }
    await this.refreshSnapshot();
  }

  private async readTerminalOutput(command: Extract<CliCommand, { kind: "terminal-output" }>): Promise<void> {
    await this.refreshSnapshot();
    const session = currentSession(this.requiredSnapshot());
    const result = await this.port.readTerminalOutput(session.id, {
      executionId: command.executionId,
      stream: command.stream,
      ...(command.offset === undefined ? {} : { offset: command.offset }),
      ...(command.maxBytes === undefined ? {} : { maxBytes: command.maxBytes }),
    });
    if (!result.ok) {
      throw new CliControllerError(result.error?.code ?? "TERMINAL_OUTPUT_FAILED", result.error?.message ?? "终端输出未能读取。");
    }
    this.emit("terminal.output", { ...result }, session.id);
  }

  private async readArtifact(input: Extract<CliCommand, { kind: "artifact-read" }>['input']): Promise<void> {
    if (!this.port.readArtifact) throw new CliControllerError("ARTIFACT_SERVICE_UNAVAILABLE", "受管产物读取服务不可用。 ");
    const result = await this.port.readArtifact(input);
    if (!result.ok) throw new CliControllerError(result.error.code, result.error.message);
    this.emit("artifact.output", {
      artifactId: result.artifactId,
      offset: result.offset,
      bytes: result.bytes,
      totalBytes: result.totalBytes,
      text: result.text,
      nextOffset: result.nextOffset,
      truncated: result.truncated,
      complete: result.complete,
    });
  }

  private async quitIfIdle(): Promise<CliCommandOutcome> {
    await this.refreshSnapshot();
    const busy = this.requiredSnapshot().sessions.filter(isBusy);
    if (busy.length > 0) {
      this.error("RUNS_ACTIVE", `仍有 ${busy.length} 个会话在运行或排队；请先取消后再退出。`);
      return { exitRequested: false };
    }
    this.emit("quit", { message: "CLI 已退出。", forced: false });
    return { exitRequested: true, exitCode: CLI_EXIT_CODE.completed };
  }

  private createRunWaiter(sessionId: string, prompt: string): {
    promise: Promise<RunTerminal>;
    cancel(): void;
  } {
    let waiter!: RunWaiter;
    const promise = new Promise<RunTerminal>((resolve) => {
      waiter = { sessionId, prompt, candidateRunIds: [], settled: false, resolve };
      this.runWaiters.add(waiter);
    });
    return {
      promise,
      cancel: () => {
        waiter.settled = true;
        this.runWaiters.delete(waiter);
      },
    };
  }

  private captureInitialSnapshot(snapshot: AppSnapshot): void {
    this.snapshot = snapshot;
    for (const session of snapshot.sessions) {
      for (const event of session.events) this.seenRuntimeEvents.add(event.id);
      if (session.activeRunId) this.activeRuns.set(session.id, session.activeRunId);
    }
  }

  private acceptSnapshot(snapshot: AppSnapshot): void {
    this.snapshot = snapshot;
    const events = snapshot.sessions
      .flatMap((session, sessionOrder) => session.events.map((event, eventOrder) => ({
        session,
        event,
        sessionOrder,
        eventOrder,
      })))
      .filter(({ event }) => !this.seenRuntimeEvents.has(event.id))
      .sort((left, right) => left.event.timestamp - right.event.timestamp
        || left.sessionOrder - right.sessionOrder
        || left.eventOrder - right.eventOrder);
    for (const { session, event } of events) {
      this.seenRuntimeEvents.add(event.id);
      this.observeRunWaiters(event);
      this.projectRuntimeEvent(session, event);
    }
    for (const session of snapshot.sessions) {
      const activeRunId = session.activeRunIds?.[0] ?? session.activeRunId;
      if (activeRunId && !this.activeRuns.has(session.id)) this.activeRuns.set(session.id, activeRunId);
    }
    if (!snapshot.sessions.some(isBusy)) this.interruptArmed = false;
  }

  private observeRunWaiters(event: RuntimeEvent): void {
    const payload = objectValue(event.payload);
    for (const waiter of [...this.runWaiters]) {
      if (waiter.sessionId !== event.sessionId || waiter.settled) continue;
      if (event.type === "run.started") {
        const runId = stringValue(payload?.runId);
        if (runId) waiter.candidateRunIds.push(runId);
        continue;
      }
      if (event.type === "message.user") {
        const message = objectValue(payload?.message);
        if (!waiter.runId && stringValue(message?.text).trim() === waiter.prompt) {
          waiter.runId = waiter.candidateRunIds.at(-1);
        }
        continue;
      }
      if (event.type !== "run.completed" && event.type !== "run.cancelled" && event.type !== "run.failed") continue;
      const runId = stringValue(payload?.runId);
      if (!waiter.runId || waiter.runId !== runId) continue;
      waiter.settled = true;
      this.runWaiters.delete(waiter);
      const activity = objectValue(payload?.activity);
      waiter.resolve({
        status: event.type.slice("run.".length) as RunTerminalStatus,
        runId,
        detail: stringValue(activity?.detail) || undefined,
      });
    }
  }

  private projectRuntimeEvent(session: SessionSnapshot, event: RuntimeEvent): void {
    const payload = objectValue(event.payload);
    const base = {
      sessionTitle: session.title,
      runId: stringValue(payload?.runId) || this.activeRuns.get(session.id) || session.activeRunId || null,
    };
    switch (event.type) {
      case "message.user": {
        const message = objectValue(payload?.message);
        this.emit("message.user", { ...base, text: stringValue(message?.text) }, session.id, event.timestamp);
        break;
      }
      case "message.delta":
        this.emit("message.delta", { ...base, text: stringValue(payload?.text) }, session.id, event.timestamp);
        break;
      case "message.completed":
        this.emit("message.completed", { ...base, text: stringValue(payload?.text) }, session.id, event.timestamp);
        break;
      case "message.cancelled":
        this.emit("message.cancelled", base, session.id, event.timestamp);
        break;
      case "thinking.started":
        this.emit("thinking.started", {
          ...base,
          activityId: stringValue(payload?.id),
          title: stringValue(payload?.title),
          detail: stringValue(payload?.detail),
        }, session.id, event.timestamp);
        break;
      case "thinking.delta":
        this.emit("thinking.delta", { ...base, text: stringValue(payload?.text) }, session.id, event.timestamp);
        break;
      case "thinking.completed":
        this.emit("thinking.completed", { ...base, activityId: stringValue(payload?.activityId) }, session.id, event.timestamp);
        break;
      case "tool.requested":
        this.emit("tool.requested", {
          ...base,
          activityId: stringValue(payload?.id),
          title: stringValue(payload?.title),
          detail: stringValue(payload?.detail),
          status: stringValue(payload?.status),
          readOnly: payload?.readOnly === true,
          callId: stringValue(payload?.callId),
          toolName: stringValue(payload?.toolName),
        }, session.id, event.timestamp);
        break;
      case "tool.completed":
      case "tool.cancelled":
      case "tool.failed": {
        const activityId = stringValue(payload?.activityId);
        const activity = session.activities.find((item) => item.id === activityId);
        this.emit(event.type, {
          ...base,
          activityId,
          title: activity?.title ?? "工具",
          result: stringValue(payload?.result),
          ...(objectValue(payload?.presentation) ? { presentation: objectValue(payload?.presentation)! } : {}),
        }, session.id, event.timestamp);
        break;
      }
      case "interaction.requested":
        this.emit("interaction.requested", {
          ...base,
          activityId: stringValue(payload?.id),
          title: stringValue(payload?.title),
          detail: stringValue(payload?.detail),
          status: stringValue(payload?.status),
        }, session.id, event.timestamp);
        break;
      case "run.started": {
        const runId = stringValue(payload?.runId);
        if (runId) this.activeRuns.set(session.id, runId);
        this.emit("run.started", { sessionTitle: session.title, runId }, session.id, event.timestamp);
        break;
      }
      case "run.queued":
        this.emit("run.queued", {
          sessionTitle: session.title,
          runId: stringValue(payload?.runId),
          reason: stringValue(payload?.reason),
        }, session.id, event.timestamp);
        break;
      case "run.checkpoint":
        this.emit("run.started", {
          sessionTitle: session.title,
          runId: stringValue(payload?.runId),
          checkpoint: `${stringValue(payload?.phase)}:${stringValue(payload?.status)}`,
        }, session.id, event.timestamp);
        break;
      case "run.completed":
      case "run.cancelled": {
        const runId = stringValue(payload?.runId);
        this.emit(event.type, { sessionTitle: session.title, runId }, session.id, event.timestamp);
        if (this.activeRuns.get(session.id) === runId) this.activeRuns.delete(session.id);
        break;
      }
      case "run.failed": {
        const runId = stringValue(payload?.runId);
        const activity = objectValue(payload?.activity);
        this.emit("run.failed", {
          sessionTitle: session.title,
          runId,
          title: stringValue(activity?.title),
          detail: stringValue(activity?.detail),
        }, session.id, event.timestamp);
        if (this.activeRuns.get(session.id) === runId) this.activeRuns.delete(session.id);
        break;
      }
      case "run.listener-failed": {
        const activity = objectValue(payload?.activity);
        this.emit("run.listener-failed", {
          ...base,
          title: stringValue(activity?.title),
          detail: stringValue(activity?.detail),
        }, session.id, event.timestamp);
        break;
      }
      case "queue.updated":
        this.emit("queue.updated", {
          ...base,
          count: Array.isArray(payload?.queue) ? payload.queue.length : session.queue.length,
        }, session.id, event.timestamp);
        break;
      default:
        break;
    }
  }

  private presentHelp(): void {
    this.emit("help", { commands: CLI_HELP_COMMANDS.map((item) => ({ ...item })) });
  }

  private error(code: string, message: string, sessionId?: string): void {
    this.emit("error", { code, message }, sessionId);
  }

  private emit(type: CliEventType, data: Readonly<Record<string, unknown>>, sessionId?: string, timestamp = this.now()): void {
    const event: CliEvent = {
      schemaVersion: CLI_EVENT_SCHEMA_VERSION,
      type,
      timestamp,
      ...(sessionId ? { sessionId } : {}),
      data,
    };
    this.presenter.present(event);
  }

  private async refreshSnapshot(): Promise<void> {
    this.acceptSnapshot(await this.port.getSnapshot());
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) await this.initialize();
  }

  private requiredSnapshot(): AppSnapshot {
    if (!this.snapshot) throw new CliControllerError("APPLICATION_NOT_READY", "CLI 尚未取得应用快照。");
    return this.snapshot;
  }
}

export function resolveSession(snapshot: AppSnapshot, reference: string): SessionSnapshot {
  const normalized = reference.trim().toLocaleLowerCase("zh-CN");
  if (!normalized) throw new CliControllerError("SESSION_REFERENCE_REQUIRED", "请提供会话 ID 或名称。");
  const exact = snapshot.sessions.filter((session) =>
    session.id.toLocaleLowerCase("en-US") === normalized
    || session.title.toLocaleLowerCase("zh-CN") === normalized);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new CliControllerError("SESSION_AMBIGUOUS", "多个会话使用了相同名称，请改用 ID。");
  const prefix = snapshot.sessions.filter((session) => session.id.toLocaleLowerCase("en-US").startsWith(normalized));
  if (prefix.length === 1) return prefix[0];
  if (prefix.length > 1) throw new CliControllerError("SESSION_AMBIGUOUS", "会话 ID 前缀不唯一，请输入更多字符。");
  throw new CliControllerError("SESSION_NOT_FOUND", `未找到会话 '${reference}'。`);
}

function resolveProvider(snapshot: AppSnapshot, reference: string): AppSnapshot["providers"][number] {
  const normalized = reference.trim().toLocaleLowerCase("zh-CN");
  const matches = snapshot.providers.filter((provider) =>
    provider.id.toLocaleLowerCase("en-US") === normalized
    || provider.name.toLocaleLowerCase("zh-CN") === normalized);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new CliControllerError("PROVIDER_AMBIGUOUS", "Provider 名称不唯一，请改用 profile ID。");
  throw new CliControllerError("PROVIDER_NOT_FOUND", `未找到 Provider profile '${reference}'。`);
}

function currentSession(snapshot: AppSnapshot): SessionSnapshot {
  const session = snapshot.sessions.find((item) => item.id === snapshot.activeSessionId);
  if (!session) throw new CliControllerError("ACTIVE_SESSION_MISSING", "应用快照没有有效的当前会话。");
  return session;
}

function sessionNames(snapshot: AppSnapshot): Map<string, string> {
  return new Map(snapshot.sessions.map((session) => [session.id, session.title]));
}

function isRunning(session: SessionSnapshot): boolean {
  return (session.activeRunIds?.length ?? (session.activeRunId ? 1 : 0)) > 0 || session.status === "running";
}

function isBusy(session: SessionSnapshot): boolean {
  return isRunning(session) || session.status === "queued" || session.queue.length > 0;
}

function usageData(usage: TokenUsage | undefined): Readonly<Record<string, unknown>> {
  return {
    input: usage?.input ?? 0,
    cacheHitInput: usage?.cacheHitInput ?? null,
    cacheMissInput: usage?.cacheMissInput ?? null,
    cacheWriteInput: usage?.cacheWriteInput ?? null,
    output: usage?.output ?? 0,
    reasoning: usage?.reasoning ?? 0,
    toolUse: usage?.toolUse ?? 0,
    total: usage?.total ?? 0,
    source: usage?.source ?? "estimated",
  };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function permissionSelectionLabel(selection: Extract<CliCommand, { kind: "permission" }>["selection"]): string {
  return {
    ask: "手动审核",
    auto: "自动审核",
    full: "完全访问",
  }[selection];
}

class CliControllerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function controllerFailure(error: unknown): { code: string; message: string } {
  return error instanceof CliControllerError
    ? { code: error.code, message: error.message }
    : { code: "COMMAND_FAILED", message: errorMessage(error) };
}

type SessionQueryStatus = SessionStatus;

function parseJson<T>(text: string, label: string): T {
  try {
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("object-required");
    return value as T;
  } catch {
    throw new CliControllerError("CLI_USAGE", `${label} 必须是一个 JSON 对象。`);
  }
}

function parseScalar(text: string): unknown {
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/u.test(text)) return Number(text);
  if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
    try { return JSON.parse(text) as unknown; } catch { return text; }
  }
  return text;
}

function parseCapabilities(text: string): Partial<ProviderEnabledCapabilities> {
  const result: Partial<ProviderEnabledCapabilities> = {};
  for (const item of text.split(",")) {
    const [rawName, rawValue = "true"] = item.split("=");
    const name = rawName.trim() as keyof ProviderEnabledCapabilities;
    if (!["stream", "tools", "reasoning", "cache", "usage"].includes(name)) continue;
    result[name] = rawValue !== "false";
  }
  if (Object.keys(result).length === 0) throw new CliControllerError("CLI_USAGE", "至少声明一个 stream/tools/reasoning/cache/usage 能力。 ");
  return result;
}

function safeEndpoint(endpoint: string): string {
  try {
    const parsed = new URL(endpoint);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "未提供有效 endpoint";
  }
}
