import { contextBridge, ipcRenderer } from "electron";
import { AppSnapshot } from "../../core/contracts";
import { AgentDesktopApi } from "./api-contract";

const api: AgentDesktopApi = {
  getSnapshot: () => ipcRenderer.invoke("agent:snapshot"),
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot) => listener(snapshot);
    ipcRenderer.on("agent:update", handler);
    return () => ipcRenderer.removeListener("agent:update", handler);
  },
  createSession: (engineId) => ipcRenderer.invoke("agent:create-session", engineId),
  chooseProjectSession: (engineId) => ipcRenderer.invoke("agent:choose-project-session", engineId),
  openExternalTerminal: (sessionId) => ipcRenderer.invoke("window:open-external-terminal", sessionId),
  setActiveSession: (sessionId) => ipcRenderer.invoke("agent:set-active", sessionId),
  renameSession: (sessionId, title) => ipcRenderer.invoke("agent:rename-session", sessionId, title),
  togglePinned: (sessionId) => ipcRenderer.invoke("agent:toggle-pinned", sessionId),
  deleteSession: (sessionId) => ipcRenderer.invoke("agent:delete-session", sessionId),
  querySessions: (query) => ipcRenderer.invoke("agent:query-sessions", query),
  setSmartRoutingEnabled: (enabled) => ipcRenderer.invoke("agent:set-smart-routing", enabled),
  setSmartRoutingStrategy: (strategy) => ipcRenderer.invoke("agent:set-routing-strategy", strategy),
  createMemory: (input) => ipcRenderer.invoke("agent:create-memory", input),
  updateMemory: (id, text) => ipcRenderer.invoke("agent:update-memory", id, text),
  setMemoryEnabled: (id, enabled) => ipcRenderer.invoke("agent:set-memory-enabled", id, enabled),
  deleteMemory: (id) => ipcRenderer.invoke("agent:delete-memory", id),
  buildProjectIndex: (sessionId) => ipcRenderer.invoke("agent:build-index", sessionId),
  searchProjectIndex: (sessionId, query) => ipcRenderer.invoke("agent:search-index", sessionId, query),
  setProjectIndexSemantic: (enabled) => ipcRenderer.invoke("agent:set-index-semantic", enabled),
  setModel: (sessionId, model) => ipcRenderer.invoke("agent:set-model", sessionId, model),
  setProviderModel: (sessionId, providerId, model) =>
    ipcRenderer.invoke("agent:set-provider-model", sessionId, providerId, model),
  setPermissionMode: (sessionId, permissionMode) =>
    ipcRenderer.invoke("agent:set-permission", sessionId, permissionMode),
  setPermissionAccess: (sessionId, selection) =>
    ipcRenderer.invoke("agent:set-permission-access", sessionId, selection),
  restoreProjectChange: (sessionId, receiptId) =>
    ipcRenderer.invoke("agent:restore-project-change", sessionId, receiptId),
  readTerminalOutput: (sessionId, input) =>
    ipcRenderer.invoke("agent:terminal-output", sessionId, input),
  send: (intent) => ipcRenderer.invoke("agent:send", intent),
  cancel: (sessionId) => ipcRenderer.invoke("agent:cancel", sessionId),
  listRuns: (sessionId) => ipcRenderer.invoke("agent:list-runs", sessionId),
  cancelRun: (runId) => ipcRenderer.invoke("agent:cancel-run", runId),
  steer: (runId, message) => ipcRenderer.invoke("agent:steer", runId, message),
  inject: (runId, context) => ipcRenderer.invoke("agent:inject", runId, context),
  clearSteering: (runId) => ipcRenderer.invoke("agent:clear-steering", runId),
  listSteering: (runId) => ipcRenderer.invoke("agent:list-steering", runId),
  resolveToolApproval: (sessionId, runId, callId, decision) =>
    ipcRenderer.invoke("agent:resolve-tool-approval", sessionId, runId, callId, decision),
  sendMessage: (sourceSessionId, targetSessionId, text) =>
    ipcRenderer.invoke("coordination:send-message", sourceSessionId, targetSessionId, text),
  delegateTask: (sourceSessionId, targetSessionId, text) =>
    ipcRenderer.invoke("coordination:delegate", sourceSessionId, targetSessionId, text),
  waitForMessage: (sessionId, filter) => ipcRenderer.invoke("coordination:wait", sessionId, filter),
  cancelWait: (sessionId) => ipcRenderer.invoke("coordination:cancel-wait", sessionId),
  markRead: (sessionId, envelopeId) => ipcRenderer.invoke("coordination:mark-read", sessionId, envelopeId),
  createSchedule: (draft) => ipcRenderer.invoke("scheduler:create", draft),
  setScheduleEnabled: (id, enabled) => ipcRenderer.invoke("scheduler:set-enabled", id, enabled),
  runScheduleNow: (id) => ipcRenderer.invoke("scheduler:run-now", id),
  deleteSchedule: (id) => ipcRenderer.invoke("scheduler:delete", id),
  restoreSchedule: (id) => ipcRenderer.invoke("scheduler:restore", id),
  markNotificationRead: (id) => ipcRenderer.invoke("notifications:mark-read", id),
  readArtifact: (input) => ipcRenderer.invoke("artifacts:read", input),
  setSkillEnabled: (sessionId, skillId, enabled) =>
    ipcRenderer.invoke("extensions:set-skill", sessionId, skillId, enabled),
  stageExtension: (input) => ipcRenderer.invoke("extensions:stage", input),
  installExtension: (stagingId) => ipcRenderer.invoke("extensions:install", stagingId),
  trustExtension: (id, version) => ipcRenderer.invoke("extensions:trust", id, version),
  enableExtension: (id, enabled) => ipcRenderer.invoke("extensions:enable", id, enabled),
  requestExtensionUpdate: (id, stagingId) => ipcRenderer.invoke("extensions:request-update", id, stagingId),
  confirmExtensionUpdate: (id) => ipcRenderer.invoke("extensions:confirm-update", id),
  requestExtensionRollback: (id) => ipcRenderer.invoke("extensions:request-rollback", id),
  confirmExtensionRollback: (id) => ipcRenderer.invoke("extensions:confirm-rollback", id),
  configureMcp: (input) => ipcRenderer.invoke("extensions:configure-mcp", input),
  connectMcp: (id) => ipcRenderer.invoke("extensions:connect-mcp", id),
  saveProviderSecret: (profileId, fieldId, value) => ipcRenderer.invoke("providers:save-secret", profileId, fieldId, value),
  deleteProviderSecret: (profileId, fieldId) => ipcRenderer.invoke("providers:delete-secret", profileId, fieldId),
  setProviderEndpoint: (profileId, endpoint) => ipcRenderer.invoke("providers:set-endpoint", profileId, endpoint),
  setProviderManualModel: (profileId, model) => ipcRenderer.invoke("providers:set-manual-model", profileId, model),
  setCustomProviderOptions: (input) => ipcRenderer.invoke("providers:set-custom-options", input),
  setProviderCapabilities: (profileId, capabilities) => ipcRenderer.invoke("providers:set-capabilities", profileId, capabilities),
  testProviderConnection: (profileId) => ipcRenderer.invoke("providers:test-connection", profileId),
  getWorkspaceSnapshot: (workspaceId) => ipcRenderer.invoke("workspace:snapshot", workspaceId),
  requestSharedCommit: (workspaceId) => ipcRenderer.invoke("workspace:request-shared-commit", workspaceId),
  commitShared: (workspaceId, message, paths) => ipcRenderer.invoke("workspace:commit-shared", workspaceId, message, paths),
  mergeWorkspace: (workspaceId) => ipcRenderer.invoke("workspace:merge", workspaceId),
  restoreWorkspace: (workspaceId) => ipcRenderer.invoke("workspace:restore", workspaceId),
  runReview: (workspaceId) => ipcRenderer.invoke("review:run", workspaceId),
  getWindowState: () => ipcRenderer.invoke("window:state"),
  subscribeWindowState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: { maximized: boolean }) => listener(state);
    ipcRenderer.on("window:state-changed", handler);
    return () => ipcRenderer.removeListener("window:state-changed", handler);
  },
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  exportArchive: (input) => ipcRenderer.invoke("transfer:export-archive", input),
  stageArchiveImport: (sourcePath) => ipcRenderer.invoke("transfer:stage-archive", sourcePath),
  previewArchiveImport: (stagingId) => ipcRenderer.invoke("transfer:preview-archive", stagingId),
  mergeArchiveImport: (stagingId, confirmed) => ipcRenderer.invoke("transfer:merge-archive", stagingId, confirmed),
  exportCredentialBundle: (input) => ipcRenderer.invoke("transfer:export-credentials", input),
  importCredentialBundle: (input) => ipcRenderer.invoke("transfer:import-credentials", input),
  getDiagnosticsPreview: (runId) => ipcRenderer.invoke("diagnostics:preview", runId),
  setDiagnosticsConsent: (enabled) => ipcRenderer.invoke("diagnostics:set-consent", enabled),
  checkUpdates: (channel) => ipcRenderer.invoke("updates:check", channel),
  downloadUpdate: () => ipcRenderer.invoke("updates:download"),
  confirmUpdateInstall: () => ipcRenderer.invoke("updates:confirm-install"),
  getProductSettings: () => ipcRenderer.invoke("settings:snapshot"),
  setProductSetting: (key, value) => ipcRenderer.invoke("settings:set", key, value),
  getCompositionCenter: () => ipcRenderer.invoke("composition:center"),
  setCompositionPreset: (preset) => ipcRenderer.invoke("composition:set-preset", preset),
  selectCustomComposition: (name) => ipcRenderer.invoke("composition:select-custom", name),
  copyCompositionPreset: (source, name) => ipcRenderer.invoke("composition:copy-preset", source, name),
  setCompositionCapability: (name, id, enabled) => ipcRenderer.invoke("composition:set-capability", name, id, enabled),
  reorderComposition: (name, order) => ipcRenderer.invoke("composition:reorder", name, order),
  restoreDefaultComposition: () => ipcRenderer.invoke("composition:restore-default"),
};

contextBridge.exposeInMainWorld("agentDesktop", api);
