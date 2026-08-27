import { AppSnapshot, AgentIntent, PermissionMode, RunSnapshot, SessionSnapshot } from "../../core/contracts";
import { AgentEngineId, DEFAULT_AGENT_ENGINE } from "../../core/agent-engine-contracts";
import { ArtifactReadInput, ArtifactReadResult } from "../../core/artifact-contracts";
import { CoordinationEnvelopeType } from "../../core/coordination-contracts";
import { ScheduleDraft } from "../../core/scheduler-contracts";
import { ProviderEnabledCapabilities } from "../../core/provider-contracts";
import { PermissionAccessSelection, ToolApprovalDecision } from "../../core/permission-contracts";
import { CoordinationService } from "../../features/coordination/coordination-service";
import { PluginCatalog } from "../../features/plugins/plugin-catalog";
import { ProviderSettingsService } from "../../features/providers/provider-settings-service";
import { AgentRuntime } from "../../features/runs/agent-runtime";
import { SchedulerService } from "../../features/scheduler/scheduler-service";
import { SecretService } from "../../features/secrets/secret-service";
import { SkillCatalog } from "../../features/skills/skill-catalog";
import { TokenLedger } from "../../features/telemetry/token-ledger";
import { TerminalOutputInput, TerminalOutputResult } from "../../features/terminal/contracts";
import { TerminalService } from "../../features/terminal/terminal-service";
import { WorkspaceService } from "../../features/workspaces/workspace-service";
import { GitService } from "../../features/git/contracts";
import { ReviewService } from "../../features/review/review-service";
import { MemoryService } from "../../features/memory/memory-service";
import { ContextCompactionService } from "../../features/runs/context-compaction-service";
import { SmartRoutingService } from "../../features/providers/model-routing-service";
import { ProjectIndexService } from "../../features/project-indexing/project-index-service";
import { SessionQuery, SessionQueryResult } from "../../core/session-query-contracts";
import { MemoryCreateInput } from "../../core/memory-contracts";
import { SmartRoutingStrategy } from "../../core/routing-contracts";
import { ArtifactRetentionService } from "../../features/artifact-retention/artifact-retention-service";
import { ManagedArtifactService } from "../../features/tool-output/managed-artifact-service";
import { NotificationService } from "../../features/notifications/notification-service";
import { ExtensionManager } from "../../features/extensions/extension-manager";
import { ExtensionStageInput } from "../../features/extensions/extension-package-manager";
import { ExtensionSnapshot, StagedExtensionPackage } from "../../core/extension-contracts";
import { LocalModelService } from "../../features/local-models/local-model-service";
import { DataTransferService } from "../../features/data-transfer/data-transfer-service";
import { CredentialBundleService } from "../../features/credential-transfer/credential-bundle-service";
import { DiagnosticsService } from "../../features/diagnostics/diagnostics-service";
import { UpdateService } from "../../features/updates/update-service";
import { ProductSettingsService } from "../../features/settings/product-settings-service";
import { ArchiveScope, DiagnosticPreview, ProductSettingsSnapshot, UpdateChannel } from "../../core/cp7-contracts";
import { ToolRegistry } from "../../features/tools/tool-registry";
import { CompositionPreset, CompositionCenterSnapshot } from "../../core/composition-contracts";
import { CompositionService } from "../../features/composition/composition-service";
import { LspRequest, LspResult } from "../../core/lsp-contracts";
import { SubagentRequest, SubagentReceipt, WorkflowDefinition, WorkflowRunInput, WorkflowRunSnapshot } from "../../core/workflow-contracts";
import { LspService } from "../../features/lsp/lsp-service";
import { SubagentService } from "../../features/workflows/subagent-service";
import { WorkflowService } from "../../features/workflows/workflow-service";
import { AgentEngineCatalog } from "../../features/agent-engines/agent-engine-catalog";

export type ApplicationListener = (snapshot: AppSnapshot) => void;

export interface DesktopApplicationServices {
  runtime: AgentRuntime;
  coordination: CoordinationService;
  telemetry: TokenLedger;
  scheduler: SchedulerService;
  skills: SkillCatalog;
  plugins: PluginCatalog;
  secrets: SecretService;
  providerSettings: ProviderSettingsService;
  terminal: TerminalService;
  workspaceService: WorkspaceService;
  gitService: GitService;
  reviewService: ReviewService;
  memory: MemoryService;
  compaction: ContextCompactionService;
  routing: SmartRoutingService;
  projectIndex: ProjectIndexService;
  artifacts: ManagedArtifactService;
  retention: ArtifactRetentionService;
  notifications: NotificationService;
  localModels: LocalModelService;
  extensionManager?: ExtensionManager;
  toolRegistry?: ToolRegistry;
  lspService?: LspService;
  subagentService?: SubagentService;
  workflowService?: WorkflowService;
  compositionService?: CompositionService;
  dataTransfer?: DataTransferService;
  credentialTransfer?: CredentialBundleService;
  diagnostics?: DiagnosticsService;
  updates?: UpdateService;
  settings?: ProductSettingsService;
  storage?: { close(): Promise<void> };
  previewFullAccessDefaults?: boolean;
  agentEngines: AgentEngineCatalog;
}

export class DesktopApplication {
  private readonly listeners = new Set<ApplicationListener>();
  private readonly unsubscribers: Array<() => void> = [];
  private publishTimer?: NodeJS.Timeout;
  private disposePromise?: Promise<void>;
  private readonly seenRuntimeEvents = new Set<string>();
  private readonly seenScheduleHistory = new Set<string>();
  private readonly seenCoordinationEnvelopes = new Set<string>();

  constructor(private readonly services: DesktopApplicationServices) {}

  async initialize(): Promise<void> {
    await this.services.telemetry.initialize();
    await this.services.compositionService?.initialize();
    await this.services.memory.initialize();
    await this.services.compaction.initialize();
    await this.services.routing.initialize();
    await this.services.projectIndex.initialize();
    await this.services.artifacts.initialize();
    await this.services.secrets.initialize();
    await this.services.providerSettings.initialize();
    await this.services.providerSettings.refreshStaleModelCatalogs();
    await this.services.localModels.initialize();
    await this.services.extensionManager?.initialize();
    await this.services.diagnostics?.initialize();
    await this.services.settings?.initialize();
    if (this.services.settings && this.services.diagnostics) {
      this.services.diagnostics.setConsent(this.services.settings.snapshot().diagnosticsConsent);
    }
    if (this.services.settings) {
      await this.services.runtime.setMaxConcurrentRuns(this.services.settings.snapshot().maxConcurrentRuns);
      this.services.notifications.setPreferences(this.services.settings.snapshot());
      this.services.updates?.setChannel(this.services.settings.snapshot().updateChannel);
    }
    await this.services.skills.initialize();
    await this.services.runtime.initialize();
    await this.services.coordination.initialize();
    await this.services.subagentService?.initialize();
    await this.services.workflowService?.initialize();
    await this.services.plugins.initialize();
    this.syncExtensionTools();
    await this.services.scheduler.initialize();
    for (const session of this.services.runtime.snapshot().sessions) {
      for (const event of session.events) this.seenRuntimeEvents.add(event.id);
    }
    for (const record of this.services.scheduler.snapshot().history) this.seenScheduleHistory.add(record.id);
    for (const envelope of this.services.coordination.snapshot().envelopes) this.seenCoordinationEnvelopes.add(envelope.id);
    this.unsubscribers.push(
      this.services.runtime.subscribe((snapshot) => { void this.observeRuntime(snapshot).then(() => this.requestPublish()); }),
      this.services.coordination.subscribe((snapshot) => { void this.observeCoordination(snapshot).then(() => this.requestPublish()); }),
      this.services.telemetry.subscribe(() => this.requestPublish()),
      this.services.scheduler.subscribe((snapshot) => { void this.observeSchedules(snapshot).then(() => this.requestPublish()); }),
      this.services.skills.subscribe(() => this.requestPublish()),
      this.services.secrets.subscribe(() => this.requestPublish()),
      this.services.providerSettings.subscribe(() => this.requestPublish()),
    );
    this.publishNow();
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    if (this.publishTimer) clearTimeout(this.publishTimer);
    this.listeners.clear();
    this.services.coordination.dispose();
    this.services.scheduler.dispose();
    const terminalDispose = this.services.terminal.dispose();
    this.services.workflowService?.dispose();
    this.services.subagentService?.dispose();
    const runtimeFlush = this.services.runtime.flushPersistence();
    const diagnosticsFlush = this.services.diagnostics?.flush() ?? Promise.resolve();
    this.disposePromise = Promise.all([terminalDispose, runtimeFlush, diagnosticsFlush])
      .then(() => this.services.extensionManager?.dispose())
      .then(() => this.services.storage?.close() ?? Promise.resolve())
      .then(() => undefined);
    return this.disposePromise;
  }

  subscribe(listener: ApplicationListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): AppSnapshot {
    const managedExtensions = this.services.extensionManager?.snapshot();
    return clone({
      ...this.services.runtime.snapshot(),
      agentEngines: this.services.agentEngines.snapshot(),
      coordination: this.services.coordination.snapshot(),
      telemetry: this.services.telemetry.snapshot(),
      scheduler: this.services.scheduler.snapshot(),
      extensions: {
        skills: this.services.skills.list(),
        plugins: this.services.plugins.list(),
        unknownCodePolicy: "not-executed" as const,
        ...(managedExtensions ? {
          records: managedExtensions.records,
          staged: managedExtensions.staged,
          mcpConnections: managedExtensions.mcpConnections,
        } : {}),
      },
      secrets: this.services.secrets.snapshot(),
      providerSettings: this.services.providerSettings.snapshot(),
      providerCatalog: this.services.providerSettings.catalogSnapshot(),
      projectIndexes: [this.services.projectIndex.snapshot()],
      artifacts: this.services.artifacts.snapshot(),
      notifications: this.services.notifications.snapshot(),
      localModels: this.services.localModels.snapshot(),
      ...(this.services.lspService ? { lsp: this.services.lspService.snapshot() } : {}),
      ...(this.services.workflowService ? { workflows: this.services.workflowService.snapshot() } : {}),
      ...(this.services.subagentService ? { subagents: this.services.subagentService.snapshot() } : {}),
      ...(this.services.compositionService ? { compositionCenter: this.services.compositionService.centerSnapshot("desktop") } : {}),
      ...(this.services.diagnostics ? { diagnostics: this.services.diagnostics.snapshot() } : {}),
      ...(this.services.updates ? { updates: this.services.updates.snapshot() } : {}),
      ...(this.services.settings ? { settings: this.services.settings.snapshot() } : {}),
    });
  }

  exportArchive(input: { targetPath: string; scope: ArchiveScope }): Promise<unknown> {
    return this.requiredService(this.services.dataTransfer, "数据归档服务").exportArchive(input);
  }
  stageArchiveImport(sourcePath: string): Promise<unknown> {
    return this.requiredService(this.services.dataTransfer, "数据归档服务").stageImport(sourcePath);
  }
  previewArchiveImport(stagingId: string): Promise<unknown> {
    return this.requiredService(this.services.dataTransfer, "数据归档服务").previewImport(stagingId);
  }
  mergeArchiveImport(stagingId: string, confirmed: boolean): Promise<unknown> {
    return this.requiredService(this.services.dataTransfer, "数据归档服务").mergeImport(stagingId, confirmed);
  }
  exportCredentialBundle(input: { targetPath: string; entryIds: string[]; password: string }): Promise<void> {
    return this.requiredService(this.services.credentialTransfer, "密钥包服务").exportBundle(input);
  }
  importCredentialBundle(input: { sourcePath: string; password: string; confirm: boolean; overwrite?: boolean }): Promise<unknown> {
    return this.requiredService(this.services.credentialTransfer, "密钥包服务").importBundle(input);
  }
  getDiagnosticsPreview(runId?: string): DiagnosticPreview {
    return this.requiredService(this.services.diagnostics, "诊断服务").previewExport(runId);
  }
  async setDiagnosticsConsent(enabled: boolean): Promise<boolean> {
    const service = this.requiredService(this.services.diagnostics, "诊断服务");
    service.setConsent(enabled);
    if (this.services.settings) await this.services.settings.update({ diagnosticsConsent: enabled });
    this.requestPublish();
    return true;
  }
  beginDetailedDiagnostics(runId: string): boolean {
    return this.requiredService(this.services.diagnostics, "诊断服务").beginDetailed(runId);
  }
  endDetailedDiagnostics(runId: string): void {
    this.requiredService(this.services.diagnostics, "诊断服务").endRun(runId);
    this.requestPublish();
  }
  checkUpdates(channel: UpdateChannel): Promise<unknown> {
    const service = this.requiredService(this.services.updates, "更新服务");
    return service.check(channel).then((result) => { this.requestPublish(); return result; });
  }
  downloadUpdate(): Promise<unknown> {
    const service = this.requiredService(this.services.updates, "更新服务");
    service.setActiveRunCount(this.services.runtime.listRuns().filter((run) => !["completed", "cancelled", "failed"].includes(run.status)).length);
    return service.download().then((result) => { this.requestPublish(); return result; });
  }
  confirmUpdateInstall(): Promise<unknown> {
    const service = this.requiredService(this.services.updates, "更新服务");
    return service.confirmInstall().then((result) => { this.requestPublish(); return result; });
  }
  getProductSettings(): ProductSettingsSnapshot {
    return this.requiredService(this.services.settings, "设置服务").snapshot();
  }
  setProductSetting(key: string, value: unknown): Promise<ProductSettingsSnapshot> {
    const settings = this.requiredService(this.services.settings, "设置服务");
    return settings.update({ [key]: value } as Partial<ProductSettingsSnapshot>).then(async (result) => {
      if (key === "diagnosticsConsent" && typeof value === "boolean") this.services.diagnostics?.setConsent(value);
      if (key === "maxConcurrentRuns" && typeof value === "number") await this.services.runtime.setMaxConcurrentRuns(value);
      if (key === "notificationsEnabled" || key === "soundEnabled") this.services.notifications.setPreferences({ [key]: value } as { notificationsEnabled?: boolean; soundEnabled?: boolean });
      this.requestPublish();
      return result;
    });
  }

  async createSession(engineId: AgentEngineId = DEFAULT_AGENT_ENGINE): Promise<SessionSnapshot> {
    return this.enablePreviewDefaults(await this.services.runtime.createSession(undefined, undefined, engineId));
  }
  async createProjectSession(path: string, engineId: AgentEngineId = DEFAULT_AGENT_ENGINE): Promise<SessionSnapshot> {
    return this.enablePreviewDefaults(await this.services.runtime.createProjectSession(path, "desktop-picker", engineId));
  }
  async createCliProjectSession(path: string): Promise<SessionSnapshot> {
    return this.enablePreviewDefaults(await this.services.runtime.createProjectSession(path, "cli-explicit"));
  }
  async openProjectSession(path: string): Promise<SessionSnapshot> {
    return this.enablePreviewDefaults(await this.services.runtime.ensureProjectSession(path));
  }
  setActiveSession(sessionId: string): Promise<boolean> { return this.services.runtime.setActiveSession(sessionId); }
  renameSession(sessionId: string, title: string): Promise<boolean> { return this.services.runtime.renameSession(sessionId, title); }
  togglePinned(sessionId: string): Promise<boolean> { return this.services.runtime.togglePinned(sessionId); }
  deleteSession(sessionId: string): Promise<boolean> { return this.services.runtime.deleteSession(sessionId); }
  querySessions(query: SessionQuery = {}): SessionQueryResult { return this.services.runtime.querySessions(query); }
  setModel(sessionId: string, model: string): Promise<boolean> { return this.services.runtime.setModel(sessionId, model); }
  setProviderModel(sessionId: string, providerId: string, model: string): Promise<boolean> {
    return this.services.runtime.setProviderModel(sessionId, providerId, model);
  }

  private async enablePreviewDefaults(session: SessionSnapshot): Promise<SessionSnapshot> {
    if (this.services.previewFullAccessDefaults !== true) return session;
    await this.services.runtime.setPermissionMode(session.id, "full");
    for (const skill of this.services.skills.list().filter((item) => item.source === "built-in")) {
      await this.services.skills.setEnabled(session.id, skill.id, true);
    }
    return this.services.runtime.snapshot().sessions.find((item) => item.id === session.id) ?? session;
  }
  async setSmartRoutingEnabled(enabled: boolean): Promise<boolean> {
    await this.services.routing.setEnabled(enabled);
    this.requestPublish();
    return true;
  }
  async setSmartRoutingStrategy(strategy: SmartRoutingStrategy): Promise<boolean> {
    await this.services.routing.setStrategy(strategy);
    this.requestPublish();
    return true;
  }
  createMemory(input: MemoryCreateInput): Promise<unknown> {
    return this.services.memory.create(input).then((entry) => { this.requestPublish(); return entry; });
  }
  updateMemory(id: string, text: string): Promise<boolean> {
    return this.services.memory.update(id, text).then((changed) => { if (changed) this.requestPublish(); return changed; });
  }
  setMemoryEnabled(id: string, enabled: boolean): Promise<boolean> {
    return this.services.memory.setEnabled(id, enabled).then((changed) => { if (changed) this.requestPublish(); return changed; });
  }
  deleteMemory(id: string): Promise<boolean> {
    return this.services.memory.delete(id).then((changed) => { if (changed) this.requestPublish(); return changed; });
  }
  async buildProjectIndex(sessionId: string): Promise<unknown> {
    const session = this.services.runtime.getSession(sessionId);
    const snapshot = await this.services.projectIndex.build(session?.workingDirectory ?? "", session?.projectAccess?.enabled === true);
    this.requestPublish();
    return snapshot;
  }
  async searchProjectIndex(sessionId: string, query: string): Promise<unknown> {
    const session = this.services.runtime.getSession(sessionId);
    if (!session?.projectAccess?.enabled) return { results: [], source: "live-fallback", truncated: false };
    return this.services.projectIndex.search(session.workingDirectory, query);
  }
  async setProjectIndexSemantic(enabled: boolean): Promise<unknown> {
    const snapshot = await this.services.projectIndex.setSemanticEnabled(enabled);
    this.requestPublish();
    return snapshot;
  }
  setPermissionMode(sessionId: string, permissionMode: PermissionMode): Promise<boolean> {
    return this.services.runtime.setPermissionMode(sessionId, permissionMode);
  }
  setPermissionAccess(sessionId: string, selection: PermissionAccessSelection): Promise<boolean> {
    return this.services.runtime.setPermissionAccess(sessionId, selection);
  }
  restoreProjectChange(sessionId: string, receiptId: string): Promise<unknown> {
    return this.services.runtime.restoreProjectChange(sessionId, receiptId);
  }
  readTerminalOutput(sessionId: string, input: TerminalOutputInput): Promise<TerminalOutputResult> {
    return this.services.terminal.outputForSession(input, sessionId);
  }
  send(intent: AgentIntent): Promise<unknown> { return this.services.runtime.send(intent); }
  cancel(sessionId: string): Promise<boolean> { return this.services.runtime.cancel(sessionId); }
  listRuns(sessionId?: string): RunSnapshot[] { return this.services.runtime.listRuns(sessionId); }
  cancelRun(runId: string): Promise<boolean> { return this.services.runtime.cancelRun(runId); }
  selectRun(runId: string): Promise<boolean> { return this.services.runtime.selectRun(runId); }
  steer(runId: string, message: string): Promise<unknown> { return this.services.runtime.steer(runId, message); }
  inject(runId: string, context: Record<string, unknown>): Promise<unknown> { return this.services.runtime.inject(runId, context); }
  clearSteering(runId: string): Promise<unknown> { return this.services.runtime.clearSteering(runId); }
  listSteering(runId?: string): unknown[] { return this.services.runtime.listSteering(runId); }
  resolveToolApproval(sessionId: string, runId: string, callId: string, decision: ToolApprovalDecision): Promise<boolean> {
    return this.services.runtime.resolveToolApproval(sessionId, runId, callId, decision);
  }

  sendMessage(sourceSessionId: string, targetSessionId: string, text: string): Promise<unknown> {
    return this.services.coordination.sendMessage(sourceSessionId, targetSessionId, text);
  }
  delegateTask(sourceSessionId: string, targetSessionId: string, text: string): Promise<unknown> {
    return this.services.coordination.delegateTask(sourceSessionId, targetSessionId, text);
  }
  waitForMessage(sessionId: string, filter: { fromSessionId?: string; envelopeType?: CoordinationEnvelopeType; correlationId?: string; timeoutMs?: number }): Promise<unknown> {
    return this.services.coordination.waitForMessage(sessionId, filter);
  }
  cancelWait(sessionId: string, waitId?: string): Promise<boolean> { return this.services.coordination.cancelWait(sessionId, waitId); }
  navigateLsp(input: Omit<LspRequest, "projectRoot"> & { projectRoot?: string }): Promise<LspResult> {
    const session = this.services.runtime.getSession(input.sessionId);
    if (!session?.projectAccess?.enabled) return Promise.resolve({ ok: false, operation: input.operation, source: "unavailable", status: "unavailable", items: [], error: "需要先明确打开项目会话。" });
    return this.requiredService(this.services.lspService, "语义导航服务").navigate({ ...input, projectRoot: session.workingDirectory });
  }
  getLspSnapshot() { return this.requiredService(this.services.lspService, "语义导航服务").snapshot(); }
  listWorkflows() { return this.requiredService(this.services.workflowService, "工作流服务").snapshot(); }
  getCompositionCenter(): CompositionCenterSnapshot {
    return this.requiredService(this.services.compositionService, "能力方案服务").centerSnapshot("desktop");
  }
  setCompositionPreset(preset: CompositionPreset): CompositionCenterSnapshot {
    this.requiredService(this.services.compositionService, "能力方案服务").setPreset(preset);
    this.requestPublish();
    return this.getCompositionCenter();
  }
  selectCustomComposition(name: string): CompositionCenterSnapshot {
    this.requiredService(this.services.compositionService, "能力方案服务").selectCustom(name);
    this.requestPublish();
    return this.getCompositionCenter();
  }
  copyCompositionPreset(source: CompositionPreset, name: string): Promise<CompositionCenterSnapshot> {
    return this.requiredService(this.services.compositionService, "能力方案服务").copyPreset(source, name).then((result) => { this.requestPublish(); return result; });
  }
  setCompositionCapability(name: string, id: string, enabled: boolean): Promise<CompositionCenterSnapshot> {
    return this.requiredService(this.services.compositionService, "能力方案服务").setCustomCapability(name, id, enabled).then((result) => { this.requestPublish(); return result; });
  }
  reorderComposition(name: string, order: string[]): Promise<CompositionCenterSnapshot> {
    return this.requiredService(this.services.compositionService, "能力方案服务").reorderCustom(name, order).then((result) => { this.requestPublish(); return result; });
  }
  restoreDefaultComposition(): CompositionCenterSnapshot {
    const result = this.requiredService(this.services.compositionService, "能力方案服务").restoreDefault();
    this.requestPublish();
    return result;
  }
  registerWorkflow(definition: WorkflowDefinition): Promise<WorkflowDefinition> {
    return this.requiredService(this.services.workflowService, "工作流服务").register(definition);
  }
  runWorkflow(input: WorkflowRunInput): Promise<WorkflowRunSnapshot> {
    return this.requiredService(this.services.workflowService, "工作流服务").run(input);
  }
  cancelWorkflow(id: string): Promise<boolean> {
    return this.requiredService(this.services.workflowService, "工作流服务").cancel(id);
  }
  recoverWorkflow(id: string, decision?: "reconfirm"): Promise<WorkflowRunSnapshot> {
    return this.requiredService(this.services.workflowService, "工作流服务").recover(id, decision);
  }
  spawnSubagent(input: SubagentRequest): Promise<SubagentReceipt> {
    return this.requiredService(this.services.subagentService, "子 Agent 服务").spawn(input);
  }
  cancelSubagent(id: string): Promise<boolean> {
    return this.requiredService(this.services.subagentService, "子 Agent 服务").cancel(id);
  }
  markRead(sessionId: string, envelopeId: string): Promise<boolean> {
    return this.services.coordination.markRead(sessionId, envelopeId);
  }

  createSchedule(draft: ScheduleDraft): Promise<unknown> { return this.services.scheduler.create(draft); }
  setScheduleEnabled(id: string, enabled: boolean): Promise<boolean> { return this.services.scheduler.setEnabled(id, enabled); }
  runScheduleNow(id: string): Promise<boolean> { return this.services.scheduler.runNow(id); }
  deleteSchedule(id: string): Promise<boolean> { return this.services.scheduler.delete(id); }
  restoreSchedule(id: string): Promise<boolean> { return this.services.scheduler.restore(id); }
  listArtifacts() { return this.services.artifacts.list(); }
  readArtifact(input: ArtifactReadInput): Promise<ArtifactReadResult> { return this.services.artifacts.read(input); }
  cleanupArtifacts() { return this.services.retention.cleanup(); }
  async markNotificationRead(id: string): Promise<boolean> {
    const changed = this.services.notifications.markRead(id);
    if (changed) this.requestPublish();
    return changed;
  }

  async setSkillEnabled(sessionId: string, skillId: string, enabled: boolean): Promise<boolean> {
    const changed = await this.services.skills.setEnabled(sessionId, skillId, enabled);
    if (!changed) return false;
    await this.services.runtime.bumpContextProfile(sessionId);
    return true;
  }

  listExtensions(): ExtensionSnapshot { return this.snapshot().extensions; }
  stageExtension(input: ExtensionStageInput): Promise<StagedExtensionPackage> {
    return this.requiredExtensionManager().stage(input).then((staged) => { this.requestPublish(); return staged; });
  }
  installExtension(stagingId: string): Promise<unknown> {
    return this.requiredExtensionManager().install(stagingId).then(async (record) => {
      await this.services.skills.refresh();
      this.requestPublish();
      return record;
    });
  }
  trustExtension(id: string, version: string): Promise<boolean> {
    return this.requiredExtensionManager().trust(id, version).then(async (changed) => {
      await this.services.skills.refresh();
      this.syncExtensionTools();
      this.requestPublish();
      return changed;
    });
  }
  enableExtension(id: string, enabled: boolean): Promise<boolean> {
    return this.requiredExtensionManager().setEnabled(id, enabled).then(async (changed) => {
      await this.services.skills.refresh();
      this.syncExtensionTools();
      this.requestPublish();
      return changed;
    });
  }
  requestExtensionUpdate(id: string, stagingId: string): Promise<boolean> {
    return this.requiredExtensionManager().requestUpdate(id, stagingId).then((changed) => { this.requestPublish(); return changed; });
  }
  confirmExtensionUpdate(id: string): Promise<boolean> {
    return this.requiredExtensionManager().confirmUpdate(id).then(async (changed) => {
      await this.services.skills.refresh();
      this.syncExtensionTools();
      this.requestPublish();
      return changed;
    });
  }
  requestExtensionRollback(id: string): Promise<boolean> {
    return this.requiredExtensionManager().requestRollback(id).then((changed) => { this.requestPublish(); return changed; });
  }
  confirmExtensionRollback(id: string): Promise<boolean> {
    return this.requiredExtensionManager().confirmRollback(id).then(async (changed) => {
      await this.services.skills.refresh();
      this.syncExtensionTools();
      this.requestPublish();
      return changed;
    });
  }
  configureMcp(input: { id: string; endpoint: string }): Promise<unknown> {
    return this.requiredExtensionManager().configureMcp(input).then((result) => { this.requestPublish(); return result; });
  }
  connectMcp(id: string): Promise<unknown> {
    return this.requiredExtensionManager().connectMcp(id).then((result) => { this.requestPublish(); return result; });
  }

  saveProviderSecret(profileId: string, fieldId: string, value: string): Promise<unknown> {
    return this.services.providerSettings.saveSecret(profileId, fieldId, value);
  }

  deleteProviderSecret(profileId: string, fieldId: string): Promise<unknown> {
    return this.services.providerSettings.deleteSecret(profileId, fieldId);
  }

  setProviderEndpoint(profileId: string, endpoint: string): Promise<boolean> {
    return this.services.providerSettings.setEndpoint(profileId, endpoint);
  }

  setProviderManualModel(profileId: string, model: string): Promise<boolean> {
    return this.services.providerSettings.setManualModel(profileId, model);
  }

  setCustomProviderOptions(input: {
    authMode: "bearer" | "x-api-key" | "api-key";
    capabilities: Partial<ProviderEnabledCapabilities>;
  }): Promise<boolean> {
    return this.services.providerSettings.setCustomOptions(input);
  }

  setProviderCapabilities(profileId: string, capabilities: Partial<ProviderEnabledCapabilities>): Promise<boolean> {
    return this.services.providerSettings.setEnabledCapabilities(profileId, capabilities);
  }

  testProviderConnection(profileId: string): Promise<unknown> {
    return this.services.providerSettings.testConnection(profileId);
  }

  setProviderNetwork(profileId: string, input: Parameters<ProviderSettingsService["setNetworkSettings"]>[1]): Promise<boolean> {
    return this.services.providerSettings.setNetworkSettings(profileId, input);
  }

  setGeminiServerState(profileId: string, input: Parameters<ProviderSettingsService["setGeminiServerState"]>[1]): Promise<boolean> {
    return this.services.providerSettings.setGeminiServerState(profileId, input);
  }

  registerLocalModel(input: Parameters<LocalModelService["registerLoopback"]>[0]): Promise<boolean> {
    return this.services.localModels.registerLoopback(input).then((changed) => { if (changed) this.requestPublish(); return changed; });
  }

  confirmLocalModel(id: string, versionId: string): Promise<boolean> {
    return this.services.localModels.confirmAdoption(id, versionId).then((changed) => { if (changed) this.requestPublish(); return changed; });
  }

  requestLocalModelUpdate(id: string, versionId: string): Promise<boolean> {
    return this.services.localModels.requestUpdate(id, versionId).then((changed) => { if (changed) this.requestPublish(); return changed; });
  }

  confirmLocalModelUpdate(id: string): Promise<boolean> {
    return this.services.localModels.confirmUpdate(id).then((changed) => { if (changed) this.requestPublish(); return changed; });
  }

  getWorkspaceSnapshot(workspaceId?: string): Promise<unknown> {
    return Promise.resolve(workspaceId ? this.services.workspaceService.snapshot(workspaceId) : this.services.workspaceService.list());
  }

  requestSharedCommit(workspaceId: string): Promise<boolean> {
    return this.services.workspaceService.requestSharedCommit(workspaceId);
  }

  commitShared(workspaceId: string, message: string, paths?: string[]): Promise<boolean> {
    return this.services.workspaceService.commitShared(workspaceId, message, paths);
  }

  mergeWorkspace(workspaceId: string): Promise<boolean> {
    return this.services.workspaceService.merge(workspaceId);
  }

  restoreWorkspace(workspaceId: string): Promise<boolean> {
    return this.services.workspaceService.restore(workspaceId);
  }

  runReview(workspaceId: string): Promise<unknown> {
    const workspace = this.services.workspaceService.snapshot(workspaceId);
    if (!workspace) return Promise.resolve(undefined);
    return Promise.resolve(this.services.reviewService.latest());
  }

  private requestPublish(): void {
    if (this.publishTimer) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = undefined;
      this.publishNow();
    }, 240);
  }

  private requiredExtensionManager(): ExtensionManager {
    if (!this.services.extensionManager) throw new Error("EXTENSION_MANAGER_UNAVAILABLE");
    return this.services.extensionManager;
  }

  private syncExtensionTools(): void {
    if (this.services.extensionManager && this.services.toolRegistry) {
      this.services.extensionManager.syncToolRegistry(this.services.toolRegistry);
    }
  }

  private requiredService<T>(service: T | undefined, label: string): T {
    if (!service) throw new Error(`${label}不可用。`);
    return service;
  }

  private publishNow(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private async observeRuntime(snapshot: ReturnType<AgentRuntime["snapshot"]>): Promise<void> {
    this.services.updates?.setActiveRunCount(snapshot.runs?.filter((run) => !["completed", "cancelled", "failed"].includes(run.status)).length ?? 0);
    for (const session of snapshot.sessions) {
      for (const event of session.events) {
        if (this.seenRuntimeEvents.has(event.id)) continue;
        this.seenRuntimeEvents.add(event.id);
        const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
        this.services.diagnostics?.record({
          runId: typeof payload.runId === "string" ? payload.runId : undefined,
          code: event.type,
          level: event.type.endsWith("failed") ? "error" : "info",
          status: event.type.startsWith("run.") ? event.type.slice(4) : undefined,
        });
        if (event.type === "run.completed" || event.type === "run.failed" || event.type === "run.cancelled") {
          if (typeof payload.runId === "string") this.services.diagnostics?.endRun(payload.runId);
        }
        if (event.type === "run.completed" || event.type === "run.failed") {
          await this.services.notifications.notify({
            kind: event.type === "run.completed" ? "completion" : "failure",
            title: event.type === "run.completed" ? "Agent 运行完成" : "Agent 运行失败",
            body: typeof payload.detail === "string" ? payload.detail : undefined,
            sessionId: session.id,
            runId: typeof payload.runId === "string" ? payload.runId : undefined,
          });
        } else if (event.type === "interaction.requested" && payload.status === "waiting") {
          await this.services.notifications.notify({
            kind: "approval-waiting",
            title: "等待本次批准",
            body: typeof payload.detail === "string" ? payload.detail : undefined,
            sessionId: session.id,
            runId: typeof payload.runId === "string" ? payload.runId : undefined,
          });
        }
      }
    }
  }

  private async observeSchedules(snapshot: ReturnType<SchedulerService["snapshot"]>): Promise<void> {
    for (const record of snapshot.history) {
      if (this.seenScheduleHistory.has(record.id)) continue;
      this.seenScheduleHistory.add(record.id);
      await this.services.notifications.notify({
        kind: "automated-result",
        title: record.status === "accepted" ? "自动任务已进入运行时" : "自动任务未完成",
        body: record.detail,
        sessionId: record.sessionId,
      });
    }
  }

  private async observeCoordination(snapshot: ReturnType<CoordinationService["snapshot"]>): Promise<void> {
    for (const envelope of snapshot.envelopes) {
      if (this.seenCoordinationEnvelopes.has(envelope.id)) continue;
      this.seenCoordinationEnvelopes.add(envelope.id);
      if (envelope.type !== "result") continue;
      await this.services.notifications.notify({
        kind: "delegation-result",
        title: "委派结果已到达",
        body: envelope.body,
        sessionId: envelope.targetSessionId,
      });
    }
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
