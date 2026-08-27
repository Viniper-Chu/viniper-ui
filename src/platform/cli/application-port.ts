import { AgentIntent, AppSnapshot, PermissionMode, RunSnapshot } from "../../core/contracts";
import { ArtifactReadInput, ArtifactReadResult } from "../../core/artifact-contracts";
import { CoordinationEnvelopeType } from "../../core/coordination-contracts";
import { PermissionAccessSelection } from "../../core/permission-contracts";
import { TerminalOutputInput, TerminalOutputResult } from "../../features/terminal/contracts";
import { SessionQuery, SessionQueryResult } from "../../core/session-query-contracts";
import { MemoryCreateInput } from "../../core/memory-contracts";
import { SmartRoutingStrategy } from "../../core/routing-contracts";
import { StagedExtensionPackage } from "../../core/extension-contracts";
import { ExtensionStageInput } from "../../features/extensions/extension-package-manager";
import { ArchiveScope, DiagnosticPreview, ProductSettingsSnapshot, UpdateChannel } from "../../core/cp7-contracts";
import { ScheduleDraft } from "../../core/scheduler-contracts";
import { ProviderEnabledCapabilities } from "../../core/provider-contracts";
import { LocalModelRegistration } from "../../core/local-model-contracts";
import { LspRequest, LspResult, LspSnapshot } from "../../core/lsp-contracts";
import { SubagentReceipt, SubagentRequest, SubagentSnapshot, WorkflowDefinition, WorkflowRunInput, WorkflowRunSnapshot, WorkflowSnapshot } from "../../core/workflow-contracts";
import { CompositionCenterSnapshot, CompositionPreset } from "../../core/composition-contracts";
import { AgentEngineId } from "../../core/agent-engine-contracts";

export interface CliSendResult {
  accepted: boolean;
  queued: boolean;
  reason?: string;
}

export interface CliApplicationPort {
  getSnapshot(): Promise<AppSnapshot>;
  subscribe(listener: (snapshot: AppSnapshot) => void): () => void;
  createSession(engineId?: AgentEngineId): Promise<unknown>;
  createProjectSession(path: string): Promise<unknown>;
  openProjectSession(path: string): Promise<unknown>;
  setActiveSession(sessionId: string): Promise<boolean>;
  deleteSession(sessionId: string): Promise<boolean>;
  listRuns(sessionId?: string): Promise<RunSnapshot[]>;
  selectRun(runId: string): Promise<boolean>;
  cancelRun(runId: string): Promise<boolean>;
  renameSession(sessionId: string, title: string): Promise<boolean>;
  steer?(runId: string, message: string): Promise<unknown>;
  inject?(runId: string, context: Record<string, unknown>): Promise<unknown>;
  clearSteering?(runId: string): Promise<unknown>;
  listSteering?(runId?: string): Promise<unknown[]>;
  querySessions?(query?: SessionQuery): Promise<SessionQueryResult>;
  setSmartRoutingEnabled?(enabled: boolean): Promise<boolean>;
  setSmartRoutingStrategy?(strategy: SmartRoutingStrategy): Promise<boolean>;
  createMemory?(input: MemoryCreateInput): Promise<unknown>;
  updateMemory?(id: string, text: string): Promise<boolean>;
  setMemoryEnabled?(id: string, enabled: boolean): Promise<boolean>;
  deleteMemory?(id: string): Promise<boolean>;
  buildProjectIndex?(sessionId: string): Promise<unknown>;
  searchProjectIndex?(sessionId: string, query: string): Promise<unknown>;
  setProjectIndexSemantic?(enabled: boolean): Promise<unknown>;
  createSchedule?(draft: ScheduleDraft): Promise<unknown>;
  setScheduleEnabled?(id: string, enabled: boolean): Promise<boolean>;
  runScheduleNow?(id: string): Promise<boolean>;
  deleteSchedule?(id: string): Promise<boolean>;
  restoreSchedule?(id: string): Promise<boolean>;
  setProviderModel(sessionId: string, providerId: string, model: string): Promise<boolean>;
  setPermissionMode(sessionId: string, permissionMode: PermissionMode): Promise<boolean>;
  setPermissionAccess(sessionId: string, selection: PermissionAccessSelection): Promise<boolean>;
  restoreProjectChange(sessionId: string, receiptId: string): Promise<unknown>;
  readTerminalOutput(sessionId: string, input: TerminalOutputInput): Promise<TerminalOutputResult>;
  readArtifact?(input: ArtifactReadInput): Promise<ArtifactReadResult>;
  send(intent: AgentIntent): Promise<CliSendResult>;
  cancel(sessionId: string): Promise<boolean>;
  sendMessage(sourceSessionId: string, targetSessionId: string, text: string): Promise<unknown>;
  delegateTask(sourceSessionId: string, targetSessionId: string, text: string): Promise<unknown>;
  waitForMessage(
    sessionId: string,
    filter: { fromSessionId?: string; envelopeType?: CoordinationEnvelopeType; correlationId?: string; timeoutMs?: number },
  ): Promise<unknown>;
  cancelWait(sessionId: string, waitId?: string): Promise<boolean>;
  getWorkspaceSnapshot?(workspaceId?: string): Promise<unknown>;
  requestSharedCommit?(workspaceId: string): Promise<boolean>;
  commitShared?(workspaceId: string, message: string, paths?: string[]): Promise<boolean>;
  mergeWorkspace?(workspaceId: string): Promise<boolean>;
  restoreWorkspace?(workspaceId: string): Promise<boolean>;
  runReview?(workspaceId: string): Promise<unknown>;
  stageExtension?(input: ExtensionStageInput): Promise<StagedExtensionPackage>;
  installExtension?(stagingId: string): Promise<unknown>;
  trustExtension?(id: string, version: string): Promise<boolean>;
  enableExtension?(id: string, enabled: boolean): Promise<boolean>;
  setSkillEnabled?(sessionId: string, skillId: string, enabled: boolean): Promise<boolean>;
  requestExtensionUpdate?(id: string, stagingId: string): Promise<boolean>;
  confirmExtensionUpdate?(id: string): Promise<boolean>;
  requestExtensionRollback?(id: string): Promise<boolean>;
  confirmExtensionRollback?(id: string): Promise<boolean>;
  configureMcp?(input: { id: string; endpoint: string }): Promise<unknown>;
  connectMcp?(id: string): Promise<unknown>;
  setProviderEndpoint?(profileId: string, endpoint: string): Promise<boolean>;
  setProviderManualModel?(profileId: string, model: string): Promise<boolean>;
  setProviderCapabilities?(profileId: string, capabilities: Partial<ProviderEnabledCapabilities>): Promise<boolean>;
  registerLocalModel?(input: LocalModelRegistration): Promise<boolean>;
  confirmLocalModel?(id: string, versionId: string): Promise<boolean>;
  requestLocalModelUpdate?(id: string, versionId: string): Promise<boolean>;
  confirmLocalModelUpdate?(id: string): Promise<boolean>;
  exportArchive?(input: { targetPath: string; scope: ArchiveScope }): Promise<unknown>;
  stageArchiveImport?(sourcePath: string): Promise<unknown>;
  previewArchiveImport?(stagingId: string): Promise<unknown>;
  mergeArchiveImport?(stagingId: string, confirmed: boolean): Promise<unknown>;
  exportCredentialBundle?(input: { targetPath: string; entryIds: string[]; password: string }): Promise<void>;
  importCredentialBundle?(input: { sourcePath: string; password: string; confirm: boolean; overwrite?: boolean }): Promise<unknown>;
  getDiagnosticsPreview?(runId?: string): Promise<DiagnosticPreview>;
  setDiagnosticsConsent?(enabled: boolean): Promise<boolean>;
  checkUpdates?(channel: UpdateChannel): Promise<unknown>;
  downloadUpdate?(): Promise<unknown>;
  confirmUpdateInstall?(): Promise<unknown>;
  getProductSettings?(): Promise<ProductSettingsSnapshot>;
  setProductSetting?(key: string, value: unknown): Promise<ProductSettingsSnapshot>;
  getLspSnapshot?(): Promise<LspSnapshot>;
  navigateLsp?(input: Omit<LspRequest, "projectRoot"> & { projectRoot?: string }): Promise<LspResult>;
  listWorkflows?(): Promise<WorkflowSnapshot>;
  registerWorkflow?(definition: WorkflowDefinition): Promise<WorkflowDefinition>;
  runWorkflow?(input: WorkflowRunInput): Promise<WorkflowRunSnapshot>;
  cancelWorkflow?(id: string): Promise<boolean>;
  recoverWorkflow?(id: string, decision?: "reconfirm"): Promise<WorkflowRunSnapshot>;
  getSubagentSnapshot?(): Promise<SubagentSnapshot>;
  spawnSubagent?(input: SubagentRequest): Promise<SubagentReceipt>;
  cancelSubagent?(id: string): Promise<boolean>;
  getCompositionCenter?(): Promise<CompositionCenterSnapshot>;
  setCompositionPreset?(preset: CompositionPreset): Promise<CompositionCenterSnapshot>;
  selectCustomComposition?(name: string): Promise<CompositionCenterSnapshot>;
  copyCompositionPreset?(source: CompositionPreset, name: string): Promise<CompositionCenterSnapshot>;
  setCompositionCapability?(name: string, id: string, enabled: boolean): Promise<CompositionCenterSnapshot>;
  reorderComposition?(name: string, order: string[]): Promise<CompositionCenterSnapshot>;
  restoreDefaultComposition?(): Promise<CompositionCenterSnapshot>;
}

/**
 * The shared Harness application service is synchronous for snapshots, while
 * terminal hosts commonly expose an async boundary. This adapter keeps that
 * difference at the platform edge and forwards every mutation unchanged.
 */
export interface CliInjectableApplicationService {
  snapshot(): AppSnapshot;
  subscribe(listener: (snapshot: AppSnapshot) => void): () => void;
  createSession(engineId?: AgentEngineId): Promise<unknown>;
  createCliProjectSession(path: string): Promise<unknown>;
  openProjectSession(path: string): Promise<unknown>;
  setActiveSession(sessionId: string): Promise<boolean>;
  deleteSession(sessionId: string): Promise<boolean>;
  listRuns(sessionId?: string): RunSnapshot[] | Promise<RunSnapshot[]>;
  selectRun(runId: string): Promise<boolean>;
  cancelRun(runId: string): Promise<boolean>;
  renameSession(sessionId: string, title: string): Promise<boolean>;
  steer?(runId: string, message: string): Promise<unknown>;
  inject?(runId: string, context: Record<string, unknown>): Promise<unknown>;
  clearSteering?(runId: string): Promise<unknown>;
  listSteering?(runId?: string): unknown[] | Promise<unknown[]>;
  querySessions?(query?: SessionQuery): SessionQueryResult | Promise<SessionQueryResult>;
  setSmartRoutingEnabled?(enabled: boolean): Promise<boolean>;
  setSmartRoutingStrategy?(strategy: SmartRoutingStrategy): Promise<boolean>;
  createMemory?(input: MemoryCreateInput): Promise<unknown>;
  updateMemory?(id: string, text: string): Promise<boolean>;
  setMemoryEnabled?(id: string, enabled: boolean): Promise<boolean>;
  deleteMemory?(id: string): Promise<boolean>;
  buildProjectIndex?(sessionId: string): Promise<unknown>;
  searchProjectIndex?(sessionId: string, query: string): Promise<unknown>;
  setProjectIndexSemantic?(enabled: boolean): Promise<unknown>;
  createSchedule?(draft: ScheduleDraft): Promise<unknown>;
  setScheduleEnabled?(id: string, enabled: boolean): Promise<boolean>;
  runScheduleNow?(id: string): Promise<boolean>;
  deleteSchedule?(id: string): Promise<boolean>;
  restoreSchedule?(id: string): Promise<boolean>;
  setProviderModel(sessionId: string, providerId: string, model: string): Promise<boolean>;
  setPermissionMode(sessionId: string, permissionMode: PermissionMode): Promise<boolean>;
  setPermissionAccess(sessionId: string, selection: PermissionAccessSelection): Promise<boolean>;
  restoreProjectChange(sessionId: string, receiptId: string): Promise<unknown>;
  readTerminalOutput(sessionId: string, input: TerminalOutputInput): Promise<TerminalOutputResult>;
  readArtifact?(input: ArtifactReadInput): Promise<ArtifactReadResult>;
  send(intent: AgentIntent): Promise<unknown>;
  cancel(sessionId: string): Promise<boolean>;
  sendMessage(sourceSessionId: string, targetSessionId: string, text: string): Promise<unknown>;
  delegateTask(sourceSessionId: string, targetSessionId: string, text: string): Promise<unknown>;
  waitForMessage(
    sessionId: string,
    filter: { fromSessionId?: string; envelopeType?: CoordinationEnvelopeType; correlationId?: string },
  ): Promise<unknown>;
  cancelWait(sessionId: string): Promise<boolean>;
  getWorkspaceSnapshot?(workspaceId?: string): Promise<unknown>;
  requestSharedCommit?(workspaceId: string): Promise<boolean>;
  commitShared?(workspaceId: string, message: string, paths?: string[]): Promise<boolean>;
  mergeWorkspace?(workspaceId: string): Promise<boolean>;
  restoreWorkspace?(workspaceId: string): Promise<boolean>;
  runReview?(workspaceId: string): Promise<unknown>;
  stageExtension?(input: ExtensionStageInput): Promise<StagedExtensionPackage>;
  installExtension?(stagingId: string): Promise<unknown>;
  trustExtension?(id: string, version: string): Promise<boolean>;
  enableExtension?(id: string, enabled: boolean): Promise<boolean>;
  setSkillEnabled?(sessionId: string, skillId: string, enabled: boolean): Promise<boolean>;
  requestExtensionUpdate?(id: string, stagingId: string): Promise<boolean>;
  confirmExtensionUpdate?(id: string): Promise<boolean>;
  requestExtensionRollback?(id: string): Promise<boolean>;
  confirmExtensionRollback?(id: string): Promise<boolean>;
  configureMcp?(input: { id: string; endpoint: string }): Promise<unknown>;
  connectMcp?(id: string): Promise<unknown>;
  setProviderEndpoint?(profileId: string, endpoint: string): Promise<boolean>;
  setProviderManualModel?(profileId: string, model: string): Promise<boolean>;
  setProviderCapabilities?(profileId: string, capabilities: Partial<ProviderEnabledCapabilities>): Promise<boolean>;
  registerLocalModel?(input: LocalModelRegistration): Promise<boolean>;
  confirmLocalModel?(id: string, versionId: string): Promise<boolean>;
  requestLocalModelUpdate?(id: string, versionId: string): Promise<boolean>;
  confirmLocalModelUpdate?(id: string): Promise<boolean>;
  exportArchive?(input: { targetPath: string; scope: ArchiveScope }): Promise<unknown>;
  stageArchiveImport?(sourcePath: string): Promise<unknown>;
  previewArchiveImport?(stagingId: string): Promise<unknown>;
  mergeArchiveImport?(stagingId: string, confirmed: boolean): Promise<unknown>;
  exportCredentialBundle?(input: { targetPath: string; entryIds: string[]; password: string }): Promise<void>;
  importCredentialBundle?(input: { sourcePath: string; password: string; confirm: boolean; overwrite?: boolean }): Promise<unknown>;
  getDiagnosticsPreview?(runId?: string): DiagnosticPreview | Promise<DiagnosticPreview>;
  setDiagnosticsConsent?(enabled: boolean): Promise<boolean>;
  checkUpdates?(channel: UpdateChannel): Promise<unknown>;
  downloadUpdate?(): Promise<unknown>;
  confirmUpdateInstall?(): Promise<unknown>;
  getProductSettings?(): ProductSettingsSnapshot | Promise<ProductSettingsSnapshot>;
  setProductSetting?(key: string, value: unknown): Promise<ProductSettingsSnapshot>;
  getLspSnapshot?(): LspSnapshot | Promise<LspSnapshot>;
  navigateLsp?(input: Omit<LspRequest, "projectRoot"> & { projectRoot?: string }): Promise<LspResult>;
  listWorkflows?(): WorkflowSnapshot | Promise<WorkflowSnapshot>;
  registerWorkflow?(definition: WorkflowDefinition): Promise<WorkflowDefinition>;
  runWorkflow?(input: WorkflowRunInput): Promise<WorkflowRunSnapshot>;
  cancelWorkflow?(id: string): Promise<boolean>;
  recoverWorkflow?(id: string, decision?: "reconfirm"): Promise<WorkflowRunSnapshot>;
  getSubagentSnapshot?(): SubagentSnapshot | Promise<SubagentSnapshot>;
  spawnSubagent?(input: SubagentRequest): Promise<SubagentReceipt>;
  cancelSubagent?(id: string): Promise<boolean>;
  getCompositionCenter?(): CompositionCenterSnapshot | Promise<CompositionCenterSnapshot>;
  setCompositionPreset?(preset: CompositionPreset): CompositionCenterSnapshot | Promise<CompositionCenterSnapshot>;
  selectCustomComposition?(name: string): CompositionCenterSnapshot | Promise<CompositionCenterSnapshot>;
  copyCompositionPreset?(source: CompositionPreset, name: string): Promise<CompositionCenterSnapshot>;
  setCompositionCapability?(name: string, id: string, enabled: boolean): Promise<CompositionCenterSnapshot>;
  reorderComposition?(name: string, order: string[]): Promise<CompositionCenterSnapshot>;
  restoreDefaultComposition?(): CompositionCenterSnapshot | Promise<CompositionCenterSnapshot>;
}

export function createCliApplicationPort(service: CliInjectableApplicationService): CliApplicationPort {
  return {
    getSnapshot: async () => service.snapshot(),
    subscribe: (listener) => service.subscribe(listener),
    createSession: (engineId) => service.createSession(engineId),
    createProjectSession: (path) => service.createCliProjectSession(path),
    openProjectSession: (path) => service.openProjectSession(path),
    setActiveSession: (sessionId) => service.setActiveSession(sessionId),
    deleteSession: (sessionId) => service.deleteSession(sessionId),
    listRuns: async (sessionId) => service.listRuns(sessionId),
    selectRun: (runId) => service.selectRun(runId),
    cancelRun: (runId) => service.cancelRun(runId),
    renameSession: (sessionId, title) => service.renameSession(sessionId, title),
    steer: (runId, message) => service.steer?.(runId, message) ?? Promise.reject(new Error("steer 服务不可用。")),
    inject: (runId, context) => service.inject?.(runId, context) ?? Promise.reject(new Error("inject 服务不可用。")),
    clearSteering: (runId) => service.clearSteering?.(runId) ?? Promise.reject(new Error("steering 服务不可用。")),
    listSteering: async (runId) => service.listSteering?.(runId) ?? [],
    querySessions: (query) => Promise.resolve(service.querySessions?.(query) ?? {
      items: [], total: 0, offset: query?.offset ?? 0, limit: query?.limit ?? 50, hasMore: false,
    }),
    setSmartRoutingEnabled: (enabled) => service.setSmartRoutingEnabled?.(enabled) ?? Promise.resolve(false),
    setSmartRoutingStrategy: (strategy) => service.setSmartRoutingStrategy?.(strategy) ?? Promise.resolve(false),
    createMemory: (input) => service.createMemory?.(input) ?? Promise.reject(new Error("记忆服务不可用。")),
    updateMemory: (id, text) => service.updateMemory?.(id, text) ?? Promise.resolve(false),
    setMemoryEnabled: (id, enabled) => service.setMemoryEnabled?.(id, enabled) ?? Promise.resolve(false),
    deleteMemory: (id) => service.deleteMemory?.(id) ?? Promise.resolve(false),
    buildProjectIndex: (sessionId) => service.buildProjectIndex?.(sessionId) ?? Promise.resolve(undefined),
    searchProjectIndex: (sessionId, query) => service.searchProjectIndex?.(sessionId, query) ?? Promise.resolve({ results: [], source: "live-fallback", truncated: false }),
    setProjectIndexSemantic: (enabled) => service.setProjectIndexSemantic?.(enabled) ?? Promise.resolve(undefined),
    createSchedule: (draft) => service.createSchedule?.(draft) ?? Promise.reject(new Error("调度服务不可用。")),
    setScheduleEnabled: (id, enabled) => service.setScheduleEnabled?.(id, enabled) ?? Promise.resolve(false),
    runScheduleNow: (id) => service.runScheduleNow?.(id) ?? Promise.resolve(false),
    deleteSchedule: (id) => service.deleteSchedule?.(id) ?? Promise.resolve(false),
    restoreSchedule: (id) => service.restoreSchedule?.(id) ?? Promise.resolve(false),
    setProviderModel: (sessionId, providerId, model) => service.setProviderModel(sessionId, providerId, model),
    setPermissionMode: (sessionId, permissionMode) => service.setPermissionMode(sessionId, permissionMode),
    setPermissionAccess: (sessionId, selection) => service.setPermissionAccess(sessionId, selection),
    restoreProjectChange: (sessionId, receiptId) => service.restoreProjectChange(sessionId, receiptId),
    readTerminalOutput: (sessionId, input) => service.readTerminalOutput(sessionId, input),
    readArtifact: (input) => service.readArtifact?.(input) ?? Promise.reject(new Error("受管产物读取服务不可用。")),
    send: async (intent) => normalizeSendResult(await service.send(intent)),
    cancel: (sessionId) => service.cancel(sessionId),
    sendMessage: (sourceSessionId, targetSessionId, text) =>
      service.sendMessage(sourceSessionId, targetSessionId, text),
    delegateTask: (sourceSessionId, targetSessionId, text) =>
      service.delegateTask(sourceSessionId, targetSessionId, text),
    waitForMessage: (sessionId, filter) => service.waitForMessage(sessionId, filter),
    cancelWait: (sessionId) => service.cancelWait(sessionId),
    getWorkspaceSnapshot: (workspaceId) => service.getWorkspaceSnapshot?.(workspaceId) ?? Promise.resolve(undefined),
    requestSharedCommit: (workspaceId) => service.requestSharedCommit?.(workspaceId) ?? Promise.resolve(false),
    commitShared: (workspaceId, message, paths) => service.commitShared?.(workspaceId, message, paths) ?? Promise.resolve(false),
    mergeWorkspace: (workspaceId) => service.mergeWorkspace?.(workspaceId) ?? Promise.resolve(false),
    restoreWorkspace: (workspaceId) => service.restoreWorkspace?.(workspaceId) ?? Promise.resolve(false),
    runReview: (workspaceId) => service.runReview?.(workspaceId) ?? Promise.resolve(undefined),
    stageExtension: (input) => service.stageExtension?.(input) ?? Promise.reject(new Error("扩展管理服务不可用。")),
    installExtension: (stagingId) => service.installExtension?.(stagingId) ?? Promise.reject(new Error("扩展管理服务不可用。")),
    trustExtension: (id, version) => service.trustExtension?.(id, version) ?? Promise.resolve(false),
    enableExtension: (id, enabled) => service.enableExtension?.(id, enabled) ?? Promise.resolve(false),
    setSkillEnabled: (sessionId, skillId, enabled) => service.setSkillEnabled?.(sessionId, skillId, enabled) ?? Promise.resolve(false),
    requestExtensionUpdate: (id, stagingId) => service.requestExtensionUpdate?.(id, stagingId) ?? Promise.resolve(false),
    confirmExtensionUpdate: (id) => service.confirmExtensionUpdate?.(id) ?? Promise.resolve(false),
    requestExtensionRollback: (id) => service.requestExtensionRollback?.(id) ?? Promise.resolve(false),
    confirmExtensionRollback: (id) => service.confirmExtensionRollback?.(id) ?? Promise.resolve(false),
    configureMcp: (input) => service.configureMcp?.(input) ?? Promise.reject(new Error("MCP 管理服务不可用。")),
    connectMcp: (id) => service.connectMcp?.(id) ?? Promise.reject(new Error("MCP 管理服务不可用。")),
    setProviderEndpoint: (profileId, endpoint) => service.setProviderEndpoint?.(profileId, endpoint) ?? Promise.resolve(false),
    setProviderManualModel: (profileId, model) => service.setProviderManualModel?.(profileId, model) ?? Promise.resolve(false),
    setProviderCapabilities: (profileId, capabilities) => service.setProviderCapabilities?.(profileId, capabilities) ?? Promise.resolve(false),
    registerLocalModel: (input) => service.registerLocalModel?.(input) ?? Promise.resolve(false),
    confirmLocalModel: (id, versionId) => service.confirmLocalModel?.(id, versionId) ?? Promise.resolve(false),
    requestLocalModelUpdate: (id, versionId) => service.requestLocalModelUpdate?.(id, versionId) ?? Promise.resolve(false),
    confirmLocalModelUpdate: (id) => service.confirmLocalModelUpdate?.(id) ?? Promise.resolve(false),
    exportArchive: (input) => service.exportArchive?.(input) ?? Promise.reject(new Error("数据归档服务不可用。")),
    stageArchiveImport: (sourcePath) => service.stageArchiveImport?.(sourcePath) ?? Promise.reject(new Error("数据归档服务不可用。")),
    previewArchiveImport: (stagingId) => service.previewArchiveImport?.(stagingId) ?? Promise.reject(new Error("数据归档服务不可用。")),
    mergeArchiveImport: (stagingId, confirmed) => service.mergeArchiveImport?.(stagingId, confirmed) ?? Promise.reject(new Error("数据归档服务不可用。")),
    exportCredentialBundle: (input) => service.exportCredentialBundle?.(input) ?? Promise.reject(new Error("密钥包服务不可用。")),
    importCredentialBundle: (input) => service.importCredentialBundle?.(input) ?? Promise.reject(new Error("密钥包服务不可用。")),
    getDiagnosticsPreview: (runId) => Promise.resolve(service.getDiagnosticsPreview?.(runId) ?? { fields: [], containsMessageBodies: false, containsCommandBodies: false, containsCredentialValues: false }),
    setDiagnosticsConsent: (enabled) => service.setDiagnosticsConsent?.(enabled) ?? Promise.resolve(false),
    checkUpdates: (channel) => service.checkUpdates?.(channel) ?? Promise.resolve({ status: "unavailable", officialSourceConfigured: false }),
    downloadUpdate: () => service.downloadUpdate?.() ?? Promise.resolve({ status: "unavailable", officialSourceConfigured: false }),
    confirmUpdateInstall: () => service.confirmUpdateInstall?.() ?? Promise.resolve({ status: "unavailable", officialSourceConfigured: false }),
    getProductSettings: () => Promise.resolve(service.getProductSettings?.() ?? {
      closeBehavior: "ask", maxConcurrentRuns: 3, notificationsEnabled: true, soundEnabled: false,
      retentionDays: "never", memoryWarningRatio: 0.8, memoryStaleDays: 90, diagnosticsConsent: false,
      providerNetworkMode: "system", providerStatusVisible: true, localModelsEnabled: true,
      localModelConcurrency: 1, updateChannel: "preview", geminiServerStateEnabled: false,
    }),
    setProductSetting: (key, value) => service.setProductSetting?.(key, value) ?? Promise.reject(new Error("设置服务不可用。")),
    getLspSnapshot: () => Promise.resolve(service.getLspSnapshot?.() ?? { explicit: false, provider: "unavailable", status: "unavailable" }),
    navigateLsp: (input) => service.navigateLsp?.(input) ?? Promise.reject(new Error("语义导航服务不可用。")),
    listWorkflows: () => Promise.resolve(service.listWorkflows?.() ?? { revision: 0, definitions: [], runs: [] }),
    registerWorkflow: (definition) => service.registerWorkflow?.(definition) ?? Promise.reject(new Error("工作流服务不可用。")),
    runWorkflow: (input) => service.runWorkflow?.(input) ?? Promise.reject(new Error("工作流服务不可用。")),
    cancelWorkflow: (id) => service.cancelWorkflow?.(id) ?? Promise.resolve(false),
    recoverWorkflow: (id, decision) => service.recoverWorkflow?.(id, decision) ?? Promise.reject(new Error("工作流服务不可用。")),
    getSubagentSnapshot: () => Promise.resolve(service.getSubagentSnapshot?.() ?? { maxConcurrent: 0, active: [], recent: [] }),
    spawnSubagent: (input) => service.spawnSubagent?.(input) ?? Promise.reject(new Error("子 Agent 服务不可用。")),
    cancelSubagent: (id) => service.cancelSubagent?.(id) ?? Promise.resolve(false),
    getCompositionCenter: () => Promise.resolve(service.getCompositionCenter?.() ?? { current: { revision: 0, preset: "standard", host: "cli", sessionScope: "all", enabled: [], blocked: [], order: [], presentation: { label: "能力组合", summary: "未加载", enabledCount: 0, blockedCount: 0 } }, presets: [], custom: [] }),
    setCompositionPreset: (preset) => Promise.resolve(service.setCompositionPreset?.(preset) ?? { current: { revision: 0, preset, host: "cli", sessionScope: "all", enabled: [], blocked: [], order: [], presentation: { label: "能力组合", summary: "未加载", enabledCount: 0, blockedCount: 0 } }, presets: [], custom: [] }),
    selectCustomComposition: (name) => Promise.resolve(service.selectCustomComposition?.(name) ?? Promise.reject(new Error("能力方案服务不可用。"))),
    copyCompositionPreset: (source, name) => service.copyCompositionPreset?.(source, name) ?? Promise.reject(new Error("能力方案服务不可用。")),
    setCompositionCapability: (name, id, enabled) => service.setCompositionCapability?.(name, id, enabled) ?? Promise.reject(new Error("能力方案服务不可用。")),
    reorderComposition: (name, order) => service.reorderComposition?.(name, order) ?? Promise.reject(new Error("能力方案服务不可用。")),
    restoreDefaultComposition: () => Promise.resolve(service.restoreDefaultComposition?.() ?? { current: { revision: 0, preset: "standard", host: "cli", sessionScope: "all", enabled: [], blocked: [], order: [], presentation: { label: "能力组合", summary: "未加载", enabledCount: 0, blockedCount: 0 } }, presets: [], custom: [] }),
  };
}

function normalizeSendResult(value: unknown): CliSendResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("正式应用服务返回了无效的运行提交结果。");
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.accepted !== "boolean" || typeof candidate.queued !== "boolean") {
    throw new Error("正式应用服务缺少 accepted/queued 运行提交字段。");
  }
  return {
    accepted: candidate.accepted,
    queued: candidate.queued,
    ...(typeof candidate.reason === "string" ? { reason: candidate.reason } : {}),
  };
}
