import { renderActivityInspector, statusLabels } from "../activity/activity-inspector.js";
import { initializeBranding } from "../branding/brand.js";
import { createComposer } from "../composer/composer.js";
import { renderConversation } from "../conversation/conversation.js";
import { renderCoordination } from "../coordination/coordination-view.js";
import { renderExtensionCenter } from "../extensions/extension-center.js";
import { renderScheduleCenter } from "../scheduler/schedule-center.js";
import { renderSessionList } from "../sessions/session-list.js";
import { createProviderSettings } from "../providers/provider-settings.js";
import { renderTokenPulse } from "../telemetry/token-pulse.js";
import { renderWorkspacePanel } from "../workspaces/workspace-panel.js";
import { createTitlebar } from "./titlebar.js";
import { setActionButtonPresentation } from "../ui/action-button.js";
import { renderCompositionCenter } from "../composition/composition-center.js";
import { renderChangeDrawer } from "../changes/change-drawer.js";
import {
  engineIdForSession,
  isEmptyConversationSession,
  preferredEmptySession,
  preferredStartupSession,
} from "../sessions/agent-session-selection.js";

const api = window.agentDesktop;
const $ = (selector) => document.querySelector(selector);
for (const button of document.querySelectorAll("button.icon-button[aria-label]")) {
  const label = button.getAttribute("aria-label");
  if (label) {
    button.title ||= label;
    button.dataset.tooltip ||= label;
  }
}
for (const [id, label, icon] of [
  ["runtimeArchivePreviewButton", "预览导入", "eye"],
  ["runtimeDiagnosticsButton", "预览当前诊断字段", "eye"],
  ["runtimeUpdateCheckButton", "检查更新", "refresh"],
  ["runtimeUpdateDownloadButton", "准备下载", "download"],
]) {
  const button = document.getElementById(id);
  if (button) setActionButtonPresentation(button, label, { icon, iconOnly: true });
}
initializeBranding();
ensureScheduleTimeZoneField();
let state = null;
let sessionDialogContext = null;
let sessionPage = null;
let selectedEngineId = "viniper";

const workspaceGrid = $("#workspaceGrid");
const scrim = $("#scrim");
const activityButton = $("#changeDrawerButton");
const sessionsButton = $("#sessionsButton");
const settingsButton = $("#titlebarSettingsButton");
const settingsDialog = $("#settingsDialog");
const productSettingsButton = $("#productSettingsButton");
const productSettingsDialog = $("#productSettingsDialog");
const runtimeCenterDialog = $("#runtimeCenterDialog");
const sessionDialog = $("#sessionDialog");
const sessionTitleInput = $("#sessionTitleInput");
const sessionTitleField = $("#sessionTitleField");
const sessionDialogError = $("#sessionDialogError");
const confirmSessionDialogButton = $("#confirmSessionDialogButton");
const coordinationDialog = $("#coordinationDialog");
const schedulerDialog = $("#schedulerDialog");
const extensionsDialog = $("#extensionsDialog");
const tokenUsageDialog = $("#tokenUsageDialog");
const tokenUsageButton = $("#tokenUsageButton");
const composerTokenButton = $("#composerTokenButton");
const memoryDialog = $("#memoryDialog");
const memoryButton = $("#memorySettingsButton");
const memoryList = $("#memoryList");
const buildIndexButton = $("#buildIndexButton");
const smartRoutingToggle = $("#smartRoutingToggle");
const smartRoutingStrategy = $("#smartRoutingStrategy");
const sessionProjectFilter = $("#sessionProjectFilter");
const sessionStatusFilter = $("#sessionStatusFilter");
const sessionProviderFilter = $("#sessionProviderFilter");
const agentSwitches = [...document.querySelectorAll("[data-agent-engine]")];
const agentView = $("#agentView");
const agentViewButton = $("#agentViewButton");
const terminalViewButton = $("#terminalViewButton");
const compositionCenter = $("#compositionCenter");
const sessionTitleButton = $("#sessionTitleButton");
const sessionTitleInlineInput = $("#sessionTitleInlineInput");
let inlineRenameSessionId = null;

function ensureManagedExtensionList() {
  const existing = $("#managedExtensionList");
  if (existing) return existing;
  const section = document.createElement("section");
  section.className = "extension-managed-section";
  const heading = document.createElement("h3");
  heading.textContent = "当前受管扩展";
  const list = document.createElement("div");
  list.id = "managedExtensionList";
  list.className = "extension-list";
  section.append(heading, list);
  $("[data-extension-pane='plugins']")?.append(section);
  return list;
}

const coordinationElements = {
  constellation: $("#sessionConstellation"),
  compact: $("#compactConstellation"),
  target: $("#coordinationTarget"),
  inbox: $("#coordinationInbox"),
  waitState: $("#coordinationWaitState"),
  cancelWait: $("#cancelWaitButton"),
};

const schedulerElements = {
  target: $("#scheduleTarget"),
  model: $("#scheduleModel"),
  list: $("#scheduleList"),
  history: $("#scheduleHistory"),
};

const extensionElements = {
  search: $("#extensionSearch"),
  managed: ensureManagedExtensionList(),
  skills: $("#skillList"),
  plugins: $("#pluginList"),
};

const settingsElements = {
  search: $("#providerSearch"),
  categories: $("#providerCategories"),
  list: $("#providerProfileList"),
  detail: $("#providerProfileDetail"),
  message: $("#providerActionMessage"),
};

const providerSettings = createProviderSettings(settingsElements, {
  saveSecret: (profileId, fieldId, value) => api.saveProviderSecret(profileId, fieldId, value),
  deleteSecret: (profileId, fieldId) => api.deleteProviderSecret(profileId, fieldId),
  setEndpoint: (profileId, endpoint) => api.setProviderEndpoint(profileId, endpoint),
  setManualModel: (profileId, model) => api.setProviderManualModel(profileId, model),
  setCustomOptions: (input) => api.setCustomProviderOptions(input),
  setCapabilities: (profileId, capabilities) => api.setProviderCapabilities(profileId, capabilities),
  testConnection: (profileId) => api.testProviderConnection(profileId),
  useForSession: (profileId, model) => {
    const session = activeSession();
    return session && model ? api.setProviderModel(session.id, profileId, model) : false;
  },
});

const composer = createComposer(
  {
    form: $("#composerForm"),
    input: $("#composerInput"),
    cancel: $("#cancelButton"),
    send: $("#sendButton"),
    sendLabel: $("#sendLabel"),
    model: $("#modelSelect"),
    permission: $("#permissionSelect"),
    queue: $("#queueIndicator"),
    shortcutHint: $("#composerShortcutHint"),
  },
  {
    send: async (text) => {
      const session = activeSession();
      if (!session) return false;
      const result = await api.send({
        sessionId: session.id,
        text,
        attachments: [],
        selectedModel: session.selectedModel,
        permissionMode: session.permissionMode,
        workspaceMode: composer.currentWorkspaceMode(),
        reviewPolicy: composer.currentReviewPolicy(),
      });
      return Boolean(result?.accepted);
    },
    cancel: () => {
      const session = activeSession();
      if (session) api.cancel(session.id);
    },
    setModel: (providerId, model) => {
      const session = activeSession();
      if (session) api.setProviderModel(session.id, providerId, model);
    },
    setPermission: (permission) => {
      const session = activeSession();
      if (session) api.setPermissionMode(session.id, permission);
    },
  },
);

const titlebar = createTitlebar($("#appTitlebar"), api, {
  "open-project": () => $("#newSessionButton").click(),
  "new-session": () => api.createSession(selectedEngineId),
  settings: () => settingsDialog.showModal(),
  "focus-composer": () => $("#composerInput").focus(),
  "rename-session": beginInlineRename,
  "toggle-sessions": toggleSessions,
  "toggle-context": toggleActivity,
  tokens: () => tokenUsageButton.click(),
  "cancel-run": () => {
    const session = activeSession();
    if (session?.status === "running") api.cancel(session.id);
  },
  schedules: () => schedulerDialog.showModal(),
  extensions: () => openExtensionDialog("plugins"),
  "runtime-center": () => runtimeCenterDialog.showModal(),
  about: () => settingsDialog.showModal(),
});

function activeSession() {
  return state?.sessions.find((session) => session.id === state.activeSessionId) ?? null;
}

function engineIdFor(session) {
  return engineIdForSession(session);
}

function visibleAgentSessions(sessions) {
  return sessions.filter((session) => engineIdFor(session) === selectedEngineId);
}

function renderAgentEngine(session) {
  selectedEngineId = engineIdFor(session);
  const engine = state.agentEngines?.find((item) => item.id === selectedEngineId);
  const claude = state.agentEngines?.find((item) => item.id === "claude-code");
  for (const button of agentSwitches) {
    const active = button.dataset.agentEngine === selectedEngineId;
    const descriptor = state.agentEngines?.find((item) => item.id === button.dataset.agentEngine);
    button.classList.toggle("active", active);
    button.classList.toggle("engine-unavailable", descriptor?.status === "unavailable");
    button.setAttribute("aria-selected", String(active));
    button.title = descriptor?.summary ?? "Agent 状态未提供";
  }
  $("#claudeCodeStatus").textContent = claude?.status === "ready"
    ? claude.version ?? "CLI 已连接"
    : "CLI 未探测";
  $("#currentEngineName").textContent = engine?.name ?? (selectedEngineId === "claude-code" ? "Claude code" : "Viniper");
  $("#currentEngineSummary").textContent = engine?.summary ?? "统一 Application Port";
  $("#sessionEngineBadge").textContent = engine?.name ?? "Viniper";
  $("#agentCapabilitySummary").dataset.status = engine?.status ?? "ready";
  renderAgentSettingsContext(engine);
}

function renderAgentSettingsContext(engine) {
  const name = $("#agentSettingsName");
  const summary = $("#agentSettingsSummary");
  const status = $("#agentSettingsStatus");
  const facts = $("#agentSettingsFacts");
  const note = $("#agentSettingsNote");
  const context = $("#agentSettingsContext");
  if (!name || !summary || !status || !facts || !note || !context) return;

  const isClaude = selectedEngineId === "claude-code";
  const provider = state?.providers?.find((item) => item.id === (isClaude ? "claude-code" : "demo"));
  const claudeApiKeyProfile = state?.providerCatalog?.profiles?.find((item) => item.profile.id === "anthropic");
  const claudeApiKeyReady = claudeApiKeyProfile?.credentialsReady === true;
  const adapterAvailable = engine?.status === "ready" && provider?.available !== false;
  const transportLabels = {
    "application-port": "Application Port",
    "native-cli": "本机 CLI",
    "wsl-cli": "WSL CLI · ViniperRuntime",
    "not-detected": "未探测",
  };
  const factsData = [
    ["运行时", isClaude ? "Claude Code CLI" : "Harness Runtime"],
    ["传输", isClaude ? (transportLabels[engine?.transport] ?? "未探测") : "Application Port"],
    ["版本", isClaude ? (engine?.version ?? "未探测") : "1.9.1 Stable"],
    ["认证模式", isClaude ? "API key · 安全存储" : "本地 Provider"],
    ["浏览器登录", "不使用"],
    ["API-key 状态", isClaude ? (claudeApiKeyReady ? "已配置 · 不回显" : "待配置") : "不适用"],
    ["状态", isClaude
      ? (adapterAvailable ? "CLI 可用" : "不可用 / 未探测")
      : (adapterAvailable ? "Runtime 可用" : "不可用 / 未探测")],
    ["专属", isClaude ? "工具 · 权限 · 取消" : "工具 · 队列"],
  ];

  name.textContent = engine?.name ?? (isClaude ? "Claude code" : "Viniper");
  summary.textContent = isClaude ? "CLI 状态" : "Runtime 状态";
  status.textContent = isClaude
    ? (adapterAvailable ? `CLI 已探测 · ${claudeApiKeyReady ? "API-key 已配置" : "API-key 待配置"}` : "不可用 / 未探测")
    : (adapterAvailable ? "Harness Runtime 可用" : "不可用 / 未探测");
  status.dataset.status = adapterAvailable ? "ready" : "unavailable";
  context.dataset.agent = selectedEngineId;
  facts.replaceChildren();
  for (const [label, value] of factsData) {
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = value;
    facts.append(term, detail);
  }
  note.textContent = "通用 Provider 控件与位置保持一致；专属状态独立。";
}

async function switchAgentEngine(engineId) {
  if (!state || engineId === selectedEngineId) return;
  selectedEngineId = engineId;
  const target = preferredEmptySession(state.sessions, engineId);
  if (target) await api.setActiveSession(target.id);
  else await api.createSession(engineId);
  closeResponsivePanels();
}

function providerModelLabel(session) {
  const provider = state.providers.find((item) => item.id === session.selectedProviderId);
  const model = provider?.models.find((item) => item.id === session.selectedModel);
  return `${provider?.name ?? session.selectedProviderId} · ${model?.label ?? session.selectedModel}`;
}

function permissionLabel(session) {
  return { ask: "手动审核", auto: "自动审核", full: "完全访问" }[session.permissionMode] ?? "手动审核";
}

function projectName(projectRoot) {
  const segments = projectRoot.split(/[\\/]+/u).filter(Boolean);
  return segments.at(-1) ?? projectRoot;
}

function beginInlineRename() {
  const session = activeSession();
  if (!session) return;
  inlineRenameSessionId = session.id;
  sessionTitleInlineInput.value = session.title;
  sessionTitleInlineInput.style.width = `${Math.ceil(sessionTitleButton.getBoundingClientRect().width)}px`;
  sessionTitleButton.classList.add("hidden");
  sessionTitleInlineInput.classList.remove("hidden");
  sessionTitleInlineInput.focus();
  sessionTitleInlineInput.select();
}

async function commitInlineRename(cancel = false) {
  const sessionId = inlineRenameSessionId;
  if (!sessionId) return;
  inlineRenameSessionId = null;
  const title = sessionTitleInlineInput.value.trim();
  sessionTitleInlineInput.classList.add("hidden");
  sessionTitleButton.classList.remove("hidden");
  if (!cancel && title) await api.renameSession(sessionId, title);
}

function render(nextState) {
  state = nextState;
  const session = activeSession();
  if (!session) return;
  renderAgentEngine(session);
  if (productSettingsDialog?.open && state.settings) renderProductSettings(state.settings);
  const status = statusLabels[session.status] ?? session.status;
  const pendingApproval = state.permissions?.pending?.some((request) => request.sessionId === session.id);
  const visibleStatus = pendingApproval ? "等待批准" : status;

  $("#productBadge").textContent = state.productBadge;
  $("#sessionCount").textContent = String(visibleAgentSessions(state.sessions).length);
  const unreadNotifications = state.notifications?.items.filter((item) => !item.read).length ?? 0;
  $("#notificationStatus").textContent = unreadNotifications > 0 ? `通知：${unreadNotifications} 条待查看` : "通知：无未读";
  updateSessionProviderFilter();
  $("#sessionTitle").textContent = session.title;
  const hasProject = session.projectAccess?.enabled === true;
  if (inlineRenameSessionId !== session.id) {
    sessionTitleButton.classList.remove("hidden");
    sessionTitleInlineInput.classList.add("hidden");
  }
  $("#sessionPath").textContent = hasProject ? session.workingDirectory : "本地会话";
  $("#sessionPath").title = hasProject ? session.workingDirectory : "没有绑定项目目录";
  $("#currentProjectName").textContent = hasProject ? projectName(session.workingDirectory) : "未打开项目";
  $("#currentProjectName").title = hasProject ? session.workingDirectory : "使用“打开项目”创建明确的项目会话。";
  $("#currentProjectCapability").textContent = hasProject ? "可读 / 可审查变更" : "尚未开放";
  $("#currentDirectory").textContent = hasProject ? session.workingDirectory : "尚未打开项目";
  $("#currentDirectory").title = hasProject ? session.workingDirectory : "project.* 当前不可用";
  const currentModelLabel = providerModelLabel(session);
  $("#currentModel").textContent = session.modelUnavailable
    ? `需重新选择 · ${currentModelLabel}`
    : currentModelLabel;
  $("#currentModel").title = session.modelUnavailable
    ? "当前历史模型已从目录消失；重新选择后才能开始下一次运行。"
    : currentModelLabel;
  $("#currentPermission").textContent = permissionLabel(session);
  $("#currentState").textContent = visibleStatus;
  $("#memoryStatus").textContent = state.memories
    ? `记忆：${state.memories.entries.filter((entry) => entry.status === "active" && !entry.stale).length} 条可注入${state.memories.capacityWarning ? " · 接近容量" : ""}`
    : "记忆：未加载";
  const indexState = state.projectIndexes?.find((index) => index.projectRoot === session.workingDirectory) ?? state.projectIndexes?.[0];
  $("#indexStatus").textContent = indexState?.explicit
    ? `索引：${indexState.status} · ${indexState.records.length} 个文件${indexState.semantic.enabled ? " · 本地语义已开" : ""}`
    : "索引：未打开项目";
  const routing = state.smartRouting;
  if (smartRoutingToggle) smartRoutingToggle.checked = routing?.enabled === true;
  if (smartRoutingStrategy && routing?.strategy) smartRoutingStrategy.value = routing.strategy;
  $("#routingStatus").textContent = routing?.enabled
    ? `模型分配：已开启 · 仅未开始委派${routing.lastDecision ? ` · ${routing.lastDecision.cacheImpact}` : ""}`
    : "模型分配：固定模型";
  $("#routingDetail").textContent = routing?.lastDecision
    ? `${routing.lastDecision.reason} 能力：${routing.lastDecision.capabilities.join("、") || "未声明"}。`
    : "尚未启用智能分配。";
  $("#contextSummaryStatus").textContent = state.contextCompaction?.lastStatus === "generated"
    ? `摘要：已生成 ${state.contextCompaction.generations.length} 代 · usage/cache 单列`
    : state.contextCompaction?.lastStatus === "fallback" ? "摘要：生成失败，已回退原始历史" : "摘要：未生成";
  if (memoryDialog?.open) renderMemoryList();
  $("#runStatusText").textContent = visibleStatus;
  const instructionState = session.projectInstructions;
  $("#currentInstructions").textContent = instructionState?.status === "loaded"
    ? "已加载"
    : instructionState?.status === "error" ? "需要处理" : "未设置";
  $("#currentInstructions").title = instructionState?.message ?? "AGENTS.md 未设置。";
  $("#runStatus").className = `run-status sr-only ${session.status}`;
  $("#inspectorStatus").parentElement.dataset.status = session.status;
  titlebar.render(session.title, visibleStatus);

  renderSessionList($("#sessionList"), visibleAgentSessions(sessionPage?.items ?? state.sessions), state.activeSessionId, {
    activate: async (sessionId) => {
      await api.setActiveSession(sessionId);
      closeResponsivePanels();
    },
    pin: (sessionId) => api.togglePinned(sessionId),
    rename: (target, trigger) => openSessionDialog("rename", target, trigger),
    remove: (target, trigger) => openSessionDialog("delete", target, trigger),
  });
  renderRunStack($("#runStack"), (state.runs ?? []).filter((run) => run.sessionId === session.id));
  const providerLabel = state.providers.find((item) => item.id === session.selectedProviderId)?.name ?? "Agent";
  renderConversation($("#messageList"), $("#emptyState"), session, providerLabel, {
    telemetry: state.telemetry,
    runs: state.runs,
    artifacts: state.artifacts,
  });
  renderActivityInspector({
    status: $("#inspectorStatus"),
    reused: $("#reusedMetric"),
    added: $("#addedMetric"),
    activities: $("#activityList"),
    events: $("#eventList"),
  }, session, state.permissions, {
    resolve: (runId, callId, decision) => api.resolveToolApproval(session.id, runId, callId, decision),
    restore: (receiptId) => api.restoreProjectChange(session.id, receiptId),
    readOutput: (input) => api.readTerminalOutput(session.id, input),
  });
  renderChangeDrawer({
    summary: $("#changeSummary"),
    state: $("#changeWorkspaceState"),
    review: $("#changeReviewState"),
    list: $("#changeList"),
  }, state, session);
  renderWorkspacePanel({
    section: $("#workspaceStatusSection"),
    status: $("#workspaceStatus"),
    review: $("#workspaceReview"),
  }, state, session);
  renderTokenPulse({
    trigger: tokenUsageButton,
    triggerValue: $("#tokenUsageRingValue"),
    triggerSummary: $("#tokenUsageSummary"),
    blocks: [...document.querySelectorAll("#contextUsageBlocks > i")],
    emptyBlocks: [...document.querySelectorAll("#emptyTokenBlocks > i")],
    composerTrigger: composerTokenButton,
    composerRing: $("#composerTokenRing"),
    composerValue: $("#composerTokenRingValue"),
    hero: $("#tokenUsageHero"),
    reconciliation: $("#tokenUsageReconciliation"),
    contextUsed: $("#tokenContextUsed"),
    contextCapacity: $("#tokenContextCapacity"),
    estimateState: $("#tokenEstimateState"),
    estimateInput: $("#tokenEstimateInput"),
    estimateOutput: $("#tokenEstimateOutput"),
    estimateTotal: $("#tokenEstimateTotal"),
    providerState: $("#tokenProviderState"),
    providerInput: $("#tokenProviderInput"),
    providerOutput: $("#tokenProviderOutput"),
    providerTotal: $("#tokenProviderTotal"),
    cacheRead: $("#tokenCacheRead"),
    cacheWrite: $("#tokenCacheWrite"),
    cacheMiss: $("#tokenCacheMiss"),
    sessionTotal: $("#tokenSessionTotal"),
  }, state.telemetry, session.id);
  renderCoordination(coordinationElements, state, {
    activate: (sessionId) => api.setActiveSession(sessionId),
    markRead: (envelopeId) => api.markRead(session.id, envelopeId),
  });
  renderScheduleCenter(schedulerElements, state.scheduler, state.sessions, state.providers, {
    toggle: (id, enabled) => api.setScheduleEnabled(id, enabled),
    runNow: (id) => api.runScheduleNow(id),
    remove: (id) => api.deleteSchedule(id),
    restore: (id) => api.restoreSchedule(id),
  });
  renderExtensionCenter(extensionElements, state.extensions, session.id, {
    setSkill: (skillId, enabled) => api.setSkillEnabled(session.id, skillId, enabled),
    trust: (id, version) => api.trustExtension(id, version),
    enable: (id, enabled) => api.enableExtension(id, enabled),
    requestRollback: (id) => api.requestExtensionRollback(id),
    confirmRollback: (id) => api.confirmExtensionRollback(id),
  });
  renderCompositionCenter(compositionCenter, state.compositionCenter, {
    select: (preset, customName) => customName ? api.selectCustomComposition(customName) : api.setCompositionPreset(preset),
    copy: (source, name) => api.copyCompositionPreset(source, name),
    toggle: (name, id, enabled) => api.setCompositionCapability(name, id, enabled),
    restore: () => api.restoreDefaultComposition(),
  });
  providerSettings.render(state, session);
  composer.render(session, state.providers, state.permissions);
  void refreshSessionPage();
}

function renderMemoryList() {
  if (!memoryList) return;
  const entries = state?.memories?.entries ?? [];
  memoryList.innerHTML = entries.length === 0 ? "<p>暂无记忆条目。</p>" : entries.map((entry) => `<article class="memory-entry ${entry.stale ? "is-stale" : ""} ${entry.status === "disabled" ? "is-disabled" : ""}" data-memory-id="${escapeHtml(entry.id)}">
    <div class="memory-entry-head"><strong>${escapeHtml(entry.source)} · ${escapeHtml(entry.scope)}</strong><span class="memory-entry-meta">${entry.stale ? `已停注入：${escapeHtml(entry.staleReason ?? "过时")}` : entry.status === "active" ? "可注入" : "已停用"}</span></div>
    <textarea data-memory-text aria-label="记忆内容">${escapeHtml(entry.text)}</textarea>
    <div class="memory-entry-actions"><span class="memory-entry-meta">创建 ${new Date(entry.createdAt).toLocaleString("zh-CN")} · 使用 ${entry.useCount} 次</span><span><button class="quiet-button" type="button" data-memory-toggle>${entry.status === "active" ? "停用" : "启用"}</button><button class="quiet-button" type="button" data-memory-save>保存</button><button class="quiet-button" type="button" data-memory-delete>删除</button></span></div>
  </article>`).join("");
  for (const button of memoryList.querySelectorAll("[data-memory-toggle]")) {
    const entry = entries.find((item) => item.id === button.closest("[data-memory-id]")?.dataset.memoryId);
    setActionButtonPresentation(button, entry?.status === "active" ? "停用记忆" : "启用记忆", { icon: "power", iconOnly: true });
  }
}

function renderProductSettings(settings) {
  if (!settings) return;
  $("#productCloseBehavior").value = settings.closeBehavior;
  $("#productMaxConcurrentRuns").value = String(settings.maxConcurrentRuns);
  $("#productUpdateChannel").value = settings.updateChannel;
  $("#productMemoryWarningRatio").value = String(settings.memoryWarningRatio);
  $("#productRetentionDays").value = String(settings.retentionDays);
  $("#productLocalModelConcurrency").value = String(settings.localModelConcurrency);
  $("#productNotificationsEnabled").checked = settings.notificationsEnabled;
  $("#productSoundEnabled").checked = settings.soundEnabled;
  $("#productDiagnosticsConsent").checked = settings.diagnosticsConsent;
  $("#productLocalModelsEnabled").checked = settings.localModelsEnabled;
  $("#productGeminiServerState").checked = settings.geminiServerStateEnabled;
}

async function openProductSettings() {
  const settings = await api.getProductSettings();
  renderProductSettings(settings);
  productSettingsDialog.showModal();
  window.setTimeout(() => $("#productCloseBehavior").focus(), 0);
}

async function saveProductSettings() {
  const retentionValue = $("#productRetentionDays").value;
  const values = {
    closeBehavior: $("#productCloseBehavior").value,
    maxConcurrentRuns: Number($("#productMaxConcurrentRuns").value),
    updateChannel: $("#productUpdateChannel").value,
    memoryWarningRatio: Number($("#productMemoryWarningRatio").value),
    retentionDays: retentionValue === "never" ? "never" : Number(retentionValue),
    localModelConcurrency: Number($("#productLocalModelConcurrency").value),
    notificationsEnabled: $("#productNotificationsEnabled").checked,
    soundEnabled: $("#productSoundEnabled").checked,
    diagnosticsConsent: $("#productDiagnosticsConsent").checked,
    localModelsEnabled: $("#productLocalModelsEnabled").checked,
    geminiServerStateEnabled: $("#productGeminiServerState").checked,
  };
  try {
    for (const [key, value] of Object.entries(values)) await api.setProductSetting(key, value);
    $("#productSettingsStatus").textContent = "设置已保存到本地 Runtime；官方更新源仍未配置。";
    productSettingsDialog.close();
  } catch (error) {
    $("#productSettingsStatus").textContent = error instanceof Error ? error.message : "设置保存失败；本次没有继续写入。";
  }
}

async function exportRuntimeArchive() {
  const path = $("#runtimeArchivePath").value.trim();
  const status = $("#runtimeTransferStatus");
  if (!path) { status.textContent = "请输入归档路径；本次没有写入。"; return; }
  try {
    await api.exportArchive({ targetPath: path, scope: { kind: "all" } });
    status.textContent = "非秘密归档已交给 Runtime 导出；秘密正文不会进入普通归档。";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "归档导出未完成。";
  }
}

async function previewRuntimeArchive() {
  const path = $("#runtimeArchivePath").value.trim();
  const status = $("#runtimeTransferStatus");
  if (!path) { status.textContent = "请输入要暂存的归档路径；本次没有写入。"; return; }
  try {
    const staged = await api.stageArchiveImport(path);
    const stagingId = staged && typeof staged === "object" ? staged.stagingId : undefined;
    if (!stagingId) throw new Error("归档暂存未返回受管 stagingId。 ");
    const preview = await api.previewArchiveImport(stagingId);
    const conflicts = preview && typeof preview === "object" && Array.isArray(preview.conflicts) ? preview.conflicts.length : 0;
    status.textContent = `归档已暂存并预览；冲突 ${conflicts} 项，尚未合并。`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "归档预览未完成。";
  }
}

async function previewRuntimeDiagnostics() {
  const status = $("#runtimeDiagnosticsStatus");
  try {
    const preview = await api.getDiagnosticsPreview();
    status.textContent = `字段 ${preview.fields.length} 条；消息正文 ${preview.containsMessageBodies ? "存在" : "未包含"}，命令正文 ${preview.containsCommandBodies ? "存在" : "未包含"}，凭据值 ${preview.containsCredentialValues ? "存在" : "未包含"}。`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "诊断预览未完成。";
  }
}

async function checkRuntimeUpdates() {
  const status = $("#runtimeUpdateStatus");
  try {
    const result = await api.checkUpdates($("#runtimeUpdateChannel").value);
    status.textContent = `更新状态：${result?.status ?? "unavailable"}；官方源${result?.officialSourceConfigured ? "已配置" : "未配置"}。`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "更新检查未完成。";
  }
}

async function prepareRuntimeUpdate() {
  const status = $("#runtimeUpdateStatus");
  try {
    const result = await api.downloadUpdate();
    status.textContent = `下载状态：${result?.status ?? "unavailable"}。`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "更新准备未完成。";
  }
}

async function installRuntimeUpdate() {
  const status = $("#runtimeUpdateStatus");
  try {
    const result = await api.confirmUpdateInstall();
    status.textContent = `安装状态：${result?.status ?? "unavailable"}；Preview 不会静默安装。`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "更新安装未完成。";
  }
}

function sessionQuery() {
  return {
    project: sessionProjectFilter?.value || undefined,
    status: sessionStatusFilter?.value || undefined,
    providerId: sessionProviderFilter?.value || undefined,
    offset: 0,
    limit: 50,
  };
}

function updateSessionProviderFilter() {
  if (!sessionProviderFilter || !state) return;
  const current = sessionProviderFilter.value;
  const options = [`<option value="">全部 Provider</option>`, ...state.providers.map((provider) => `<option value="${escapeHtml(provider.id)}">${escapeHtml(provider.name)}</option>`)].join("");
  sessionProviderFilter.innerHTML = options;
  sessionProviderFilter.value = state.providers.some((provider) => provider.id === current) ? current : "";
}

async function refreshSessionPage() {
  if (!state || !api.querySessions) return;
  sessionPage = await api.querySessions(sessionQuery());
  if (state) renderSessionList($("#sessionList"), visibleAgentSessions(sessionPage.items), state.activeSessionId, {
    activate: async (sessionId) => { await api.setActiveSession(sessionId); closeResponsivePanels(); },
    pin: (sessionId) => api.togglePinned(sessionId),
    rename: (target, trigger) => openSessionDialog("rename", target, trigger),
    remove: (target, trigger) => openSessionDialog("delete", target, trigger),
  });
}

function renderRunStack(container, runs) {
  if (!container) return;
  const labels = {
    queued: "排队中",
    running: "运行中",
    waiting_resource: "等待资源",
    recovering: "恢复中",
    replaying: "重放中",
    completed: "已完成",
    cancelled: "已取消",
    failed: "失败",
  };
  if (runs.length === 0) {
    container.innerHTML = "";
    return;
  }
  const active = new Set(["queued", "running", "waiting_resource", "recovering", "replaying"]);
  container.innerHTML = runs.slice(-4).map((run) => {
    const canCancel = active.has(run.status);
    const checkpoint = run.checkpoint ? `${run.checkpoint.phase} · ${run.checkpoint.status}` : "尚未形成检查点";
    const attempt = run.providerAttempt
      ? `请求 ${run.providerAttempt.attempt}/${run.providerAttempt.maxAttempts} · ${run.providerAttempt.status}`
      : "请求次数：尚未开始";
    return `<article class="run-stack-item ${canCancel ? "is-active" : "is-terminal"}">
      <span class="run-stack-mark" aria-hidden="true">—</span>
      <div class="run-stack-copy"><strong>${escapeHtml(labels[run.status] ?? run.status)}</strong><span>${escapeHtml(run.text)}</span><small>${escapeHtml(checkpoint)} · ${escapeHtml(attempt)}</small></div>
      <span class="run-stack-origin">${escapeHtml(run.origin?.kind ?? "user")}</span>
      ${canCancel ? `<button type="button" class="quiet-button run-stack-cancel" data-run-cancel="${escapeHtml(run.runId)}">取消</button>` : ""}
    </article>`;
  }).join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  }[character]));
}

function updateScrim() {
  const overlayOpen = workspaceGrid.classList.contains("inspector-open") || workspaceGrid.classList.contains("sessions-open");
  scrim.classList.toggle("hidden", !overlayOpen || window.innerWidth >= 1180);
}

function toggleActivity() {
  if (window.innerWidth >= 1180) {
    const hidden = workspaceGrid.classList.toggle("inspector-hidden");
    activityButton.setAttribute("aria-expanded", String(!hidden));
  } else {
    const open = workspaceGrid.classList.toggle("inspector-open");
    workspaceGrid.classList.remove("sessions-open");
    activityButton.setAttribute("aria-expanded", String(open));
    sessionsButton.setAttribute("aria-expanded", "false");
  }
  updateScrim();
}

function toggleSessions() {
  if (window.innerWidth >= 1180) {
    const hidden = workspaceGrid.classList.toggle("sidebar-hidden");
    sessionsButton.setAttribute("aria-expanded", String(!hidden));
    updateScrim();
    return;
  }
  const open = workspaceGrid.classList.toggle("sessions-open");
  workspaceGrid.classList.remove("inspector-open");
  sessionsButton.setAttribute("aria-expanded", String(open));
  activityButton.setAttribute("aria-expanded", "false");
  updateScrim();
}

function closeResponsivePanels() {
  workspaceGrid.classList.remove("inspector-open", "sessions-open");
  activityButton.setAttribute("aria-expanded", window.innerWidth >= 1180 ? String(!workspaceGrid.classList.contains("inspector-hidden")) : "false");
  sessionsButton.setAttribute("aria-expanded", "false");
  updateScrim();
}

function selectInspectorPane(name) {
  for (const pane of ["changes", "activity", "coordination"]) {
    $(`#${pane}Pane`).classList.toggle("hidden", pane !== name);
    $(`#${pane}TabButton`).classList.toggle("active", pane === name);
    $(`#${pane}TabButton`).setAttribute("aria-selected", String(pane === name));
  }
}

function openExtensionDialog(mode) {
  const labels = { skills: "Skills", plugins: "插件", composition: "能力模式" };
  extensionsDialog.dataset.extensionMode = mode;
  $("#extensionDialogTitle").textContent = labels[mode] ?? "扩展";
  for (const button of document.querySelectorAll("[data-extension-mode-button]")) {
    button.classList.toggle("active", button.dataset.extensionModeButton === mode);
  }
  for (const pane of document.querySelectorAll("[data-extension-pane]")) {
    pane.classList.toggle("hidden", pane.dataset.extensionPane !== mode);
  }
  $("#extensionSearchField").classList.toggle("hidden", mode === "composition");
  if (!extensionsDialog.open) extensionsDialog.showModal();
}

function openSessionDialog(action, session, trigger) {
  sessionDialogContext = { action, session, trigger };
  sessionDialogError.textContent = "";
  sessionTitleInput.setCustomValidity("");
  if (action === "rename") {
    $("#sessionDialogTitle").textContent = "重命名会话";
    $("#sessionDialogMessage").textContent = "为这个会话选择一个清晰的名称。";
    sessionTitleField.classList.remove("hidden");
    sessionTitleInput.value = session.title;
    confirmSessionDialogButton.textContent = "保存";
  } else {
    $("#sessionDialogTitle").textContent = "删除会话";
    $("#sessionDialogMessage").textContent = `要从本地工作区移除“${session.title}”吗？`;
    sessionTitleField.classList.add("hidden");
    confirmSessionDialogButton.textContent = "删除会话";
  }
  sessionDialog.showModal();
  window.setTimeout(() => (action === "rename" ? sessionTitleInput : confirmSessionDialogButton).focus(), 0);
}

function closeSessionDialog() {
  if (sessionDialog.open) sessionDialog.close();
  const returnFocus = sessionDialogContext?.trigger;
  sessionDialogContext = null;
  if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
  else $("#newSessionButton").focus();
}

function openCoordinationDialog() {
  $("#coordinationError").textContent = "";
  coordinationDialog.showModal();
  window.setTimeout(() => $("#coordinationTarget").focus(), 0);
}

function updateCoordinationAction() {
  const action = $("#coordinationAction").value;
  $("#coordinationTextField").classList.toggle("hidden", action === "wait");
  $("#submitCoordinationButton").textContent = action === "delegation" ? "委派任务" : action === "wait" ? "开始等待" : "发送消息";
}

function updateScheduleFields() {
  const kind = $("#scheduleKind").value;
  const field = $("#scheduleValueField");
  const input = $("#scheduleValue");
  field.classList.toggle("hidden", kind === "daily" || kind === "weekly");
  if (kind === "once") {
    field.firstChild.textContent = "执行时间";
    input.type = "datetime-local";
    if (!input.value || input.type !== "datetime-local") input.value = localDateTime(Date.now() + 60_000);
  } else if (kind === "interval") {
    field.firstChild.textContent = "间隔（分钟）";
    input.type = "number";
    input.min = "1";
    input.value = "5";
  }
}

function updateScheduleModelFields() {
  const mode = $("#scheduleModelMode").value;
  $("#scheduleModelField").classList.toggle("hidden", mode !== "fixed");
  $("#scheduleRoutingStrategyField").classList.toggle("hidden", mode !== "smart");
}

activityButton.addEventListener("click", toggleActivity);
sessionsButton.addEventListener("click", toggleSessions);
agentViewButton?.addEventListener("click", () => agentView?.scrollIntoView({ block: "start" }));
terminalViewButton?.addEventListener("click", async () => {
  const session = activeSession();
  if (!session) return;
  const result = await api.openExternalTerminal(session.id);
  terminalViewButton.title = result.message;
});
document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest("[data-run-cancel]") : null;
  if (target) void api.cancelRun(target.dataset.runCancel);
});
scrim.addEventListener("click", closeResponsivePanels);
$("#changesTabButton").addEventListener("click", () => selectInspectorPane("changes"));
$("#activityTabButton").addEventListener("click", () => selectInspectorPane("activity"));
$("#coordinationTabButton").addEventListener("click", () => selectInspectorPane("coordination"));
$("#closeContextButton").addEventListener("click", () => {
  if (window.innerWidth >= 1180) workspaceGrid.classList.add("inspector-hidden");
  else workspaceGrid.classList.remove("inspector-open");
  activityButton.setAttribute("aria-expanded", "false");
  updateScrim();
});
sessionTitleButton.addEventListener("click", beginInlineRename);
sessionTitleInlineInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void commitInlineRename();
  } else if (event.key === "Escape") {
    event.preventDefault();
    void commitInlineRename(true);
  }
});
sessionTitleInlineInput.addEventListener("blur", () => void commitInlineRename());
$("#newSessionButton").addEventListener("click", async () => {
  const message = $("#projectActionMessage");
  message.textContent = "正在选择项目…";
  const result = await api.chooseProjectSession(selectedEngineId);
  if (result.status === "created") {
    message.textContent = "已新建项目会话。";
    await api.setActiveSession(result.sessionId);
    closeResponsivePanels();
  } else if (result.status === "cancelled") {
    message.textContent = "已取消；当前会话未改变。";
  } else {
    message.textContent = result.message;
  }
});
$("#plainSessionButton").addEventListener("click", async () => {
  await api.createSession(selectedEngineId);
  closeResponsivePanels();
});
for (const button of agentSwitches) {
  button.addEventListener("click", () => void switchAgentEngine(button.dataset.agentEngine));
}
$("#schedulerButton").addEventListener("click", () => schedulerDialog.showModal());
$("#skillsButton").addEventListener("click", () => openExtensionDialog("skills"));
$("#extensionsButton").addEventListener("click", () => openExtensionDialog("plugins"));
$("#compositionButton").addEventListener("click", () => openExtensionDialog("composition"));
for (const button of document.querySelectorAll("[data-extension-mode-button]")) {
  button.addEventListener("click", () => openExtensionDialog(button.dataset.extensionModeButton));
}
settingsButton.addEventListener("click", () => settingsDialog.showModal());
productSettingsButton.addEventListener("click", openProductSettings);
function toggleTokenUsageDialog(trigger) {
  const willOpen = tokenUsageDialog.classList.contains("hidden");
  tokenUsageDialog.classList.toggle("hidden", !willOpen);
  tokenUsageButton.setAttribute("aria-expanded", String(willOpen));
  composerTokenButton?.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) window.setTimeout(() => $("#closeTokenUsageButton").focus(), 0);
  if (trigger) trigger.setAttribute("data-opened-by", trigger.id);
}
tokenUsageButton.addEventListener("click", () => toggleTokenUsageDialog(tokenUsageButton));
composerTokenButton?.addEventListener("click", () => toggleTokenUsageDialog(composerTokenButton));
$("#closeTokenUsageButton").addEventListener("click", () => {
  tokenUsageDialog.classList.add("hidden");
  tokenUsageButton.setAttribute("aria-expanded", "false");
  composerTokenButton?.setAttribute("aria-expanded", "false");
  tokenUsageButton.focus();
});
$("#openCoordinationButton").addEventListener("click", openCoordinationDialog);
$("#coordinationComposeButton").addEventListener("click", openCoordinationDialog);
$("#closeSettingsButton").addEventListener("click", () => settingsDialog.close());
settingsDialog.addEventListener("close", () => settingsButton.focus());
$("#closeProductSettingsButton").addEventListener("click", () => productSettingsDialog.close());
$("#cancelProductSettingsButton").addEventListener("click", () => productSettingsDialog.close());
$("#saveProductSettingsButton").addEventListener("click", () => void saveProductSettings());
productSettingsDialog.addEventListener("close", () => productSettingsButton.focus());
$("#closeRuntimeCenterButton").addEventListener("click", () => runtimeCenterDialog.close());
$("#runtimeArchiveExportButton").addEventListener("click", () => void exportRuntimeArchive());
$("#runtimeArchivePreviewButton").addEventListener("click", () => void previewRuntimeArchive());
$("#runtimeDiagnosticsButton").addEventListener("click", () => void previewRuntimeDiagnostics());
$("#runtimeUpdateCheckButton").addEventListener("click", () => void checkRuntimeUpdates());
$("#runtimeUpdateDownloadButton").addEventListener("click", () => void prepareRuntimeUpdate());
$("#runtimeUpdateInstallButton").addEventListener("click", () => void installRuntimeUpdate());
for (const button of document.querySelectorAll("[data-close-dialog]")) {
  button.addEventListener("click", () => document.getElementById(button.dataset.closeDialog).close());
}

$("#closeSessionDialogButton").addEventListener("click", closeSessionDialog);
$("#cancelSessionDialogButton").addEventListener("click", closeSessionDialog);
sessionDialog.addEventListener("cancel", (event) => { event.preventDefault(); closeSessionDialog(); });
sessionTitleInput.addEventListener("input", () => { sessionTitleInput.setCustomValidity(""); sessionDialogError.textContent = ""; });
confirmSessionDialogButton.addEventListener("click", async () => {
  if (!sessionDialogContext) return;
  const { action, session } = sessionDialogContext;
  if (action === "rename") {
    const title = sessionTitleInput.value.trim();
    if (!title) {
      sessionTitleInput.setCustomValidity("请输入会话名称。");
      sessionDialogError.textContent = "保存前请输入会话名称。";
      sessionTitleInput.reportValidity();
      sessionTitleInput.focus();
      return;
    }
    await api.renameSession(session.id, title);
  } else await api.deleteSession(session.id);
  closeSessionDialog();
});

$("#coordinationAction").addEventListener("change", updateCoordinationAction);
$("#submitCoordinationButton").addEventListener("click", async () => {
  const session = activeSession();
  const target = $("#coordinationTarget").value;
  const action = $("#coordinationAction").value;
  const text = $("#coordinationText").value.trim();
  const error = $("#coordinationError");
  error.textContent = "";
  if (!session || !target) { error.textContent = "请先创建另一个会话。"; return; }
  if (action !== "wait" && !text) { error.textContent = "请输入消息或任务内容。"; return; }
  try {
    if (action === "message") await api.sendMessage(session.id, target, text);
    else if (action === "delegation") await api.delegateTask(session.id, target, text);
    else await api.waitForMessage(session.id, { fromSessionId: target });
    $("#coordinationText").value = "";
    coordinationDialog.close();
  } catch (cause) {
    error.textContent = cause instanceof Error ? cause.message : "协作操作未完成。";
  }
});
$("#cancelWaitButton").addEventListener("click", () => {
  const session = activeSession();
  if (session) api.cancelWait(session.id);
});

$("#scheduleKind").addEventListener("change", updateScheduleFields);
$("#scheduleModelMode").addEventListener("change", updateScheduleModelFields);
$("#scheduleForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("#scheduleError");
  error.textContent = "";
  try {
    const kind = $("#scheduleKind").value;
    const value = $("#scheduleValue").value;
    const [hour, minute] = $("#scheduleTime").value.split(":").map(Number);
    const schedule = kind === "once"
      ? { kind, runAt: new Date(value).getTime() }
      : kind === "interval"
        ? { kind, everyMs: Number(value) * 60_000 }
        : kind === "daily"
          ? { kind, hour, minute, timeZone: $("#scheduleTimeZone")?.value.trim() || undefined }
          : { kind, weekday: Number($("#scheduleWeekday").value), hour, minute, timeZone: $("#scheduleTimeZone")?.value.trim() || undefined };
    const targetValue = $("#scheduleTarget").value;
    const target = targetValue === "new-session"
      ? { kind: "new-session" }
      : { kind: "existing-session", sessionId: targetValue.slice("session:".length) };
    const modelMode = $("#scheduleModelMode").value;
    const modelSelection = modelMode === "fixed"
      ? (() => {
          const { providerId, modelId } = JSON.parse($("#scheduleModel").value);
          return { mode: "fixed", providerId, modelId };
        })()
      : modelMode === "smart"
        ? { mode: "smart", strategy: $("#scheduleRoutingStrategy").value }
        : { mode: "inherit" };
    await api.createSchedule({ name: $("#scheduleName").value, prompt: $("#schedulePrompt").value, schedule, target, modelSelection });
    $("#scheduleName").value = "";
    $("#schedulePrompt").value = "";
  } catch (cause) {
    error.textContent = cause instanceof Error ? cause.message : "自动任务未创建。";
  }
});

$("#extensionSearch").addEventListener("input", () => {
  const session = activeSession();
  if (state && session) renderExtensionCenter(extensionElements, state.extensions, session.id, {
    setSkill: (skillId, enabled) => api.setSkillEnabled(session.id, skillId, enabled),
    trust: (id, version) => api.trustExtension(id, version),
    enable: (id, enabled) => api.enableExtension(id, enabled),
    requestRollback: (id) => api.requestExtensionRollback(id),
    confirmRollback: (id) => api.confirmExtensionRollback(id),
  });
});

window.addEventListener("resize", closeResponsivePanels);
memoryButton?.addEventListener("click", () => { renderMemoryList(); memoryDialog?.showModal(); });
memoryList?.addEventListener("click", async (event) => {
  const target = event.target instanceof Element ? event.target.closest("[data-memory-id]") : null;
  if (!target) return;
  const id = target.dataset.memoryId;
  const entry = state?.memories?.entries.find((item) => item.id === id);
  if (!id || !entry) return;
  if (event.target.closest("[data-memory-toggle]")) await api.setMemoryEnabled(id, entry.status !== "active");
  else if (event.target.closest("[data-memory-save]")) await api.updateMemory(id, target.querySelector("[data-memory-text]").value);
  else if (event.target.closest("[data-memory-delete]")) await api.deleteMemory(id);
});
buildIndexButton?.addEventListener("click", async () => {
  const session = activeSession();
  if (session?.projectAccess?.enabled) {
    buildIndexButton.disabled = true;
    await api.buildProjectIndex(session.id);
    buildIndexButton.disabled = false;
  }
});
smartRoutingToggle?.addEventListener("change", () => api.setSmartRoutingEnabled(smartRoutingToggle.checked));
smartRoutingStrategy?.addEventListener("change", () => api.setSmartRoutingStrategy(smartRoutingStrategy.value));
for (const control of [sessionProjectFilter, sessionStatusFilter, sessionProviderFilter]) {
  control?.addEventListener("input", () => void refreshSessionPage());
  control?.addEventListener("change", () => void refreshSessionPage());
}
updateCoordinationAction();
updateScheduleFields();
updateScheduleModelFields();

function ensureScheduleTimeZoneField() {
  const details = document.querySelector("#scheduleForm details");
  if (!details || document.querySelector("#scheduleTimeZone")) return;
  const label = document.createElement("label");
  label.className = "dialog-field";
  label.textContent = "IANA 时区";
  const input = document.createElement("input");
  input.id = "scheduleTimeZone";
  input.value = "Asia/Shanghai";
  input.placeholder = "例如 America/New_York";
  label.append(input);
  details.append(label);
}
$("#scheduleValue").value = localDateTime(Date.now() + 60_000);

const initialSnapshot = await api.getSnapshot();
const startupTarget = preferredStartupSession(initialSnapshot.sessions, initialSnapshot.activeSessionId);
let startupSnapshot = initialSnapshot;
if (startupTarget && startupTarget.id !== initialSnapshot.activeSessionId) {
  await api.setActiveSession(startupTarget.id);
  startupSnapshot = await api.getSnapshot();
} else if (startupTarget && !isEmptyConversationSession(startupTarget)) {
  await api.createSession(engineIdForSession(startupTarget));
  startupSnapshot = await api.getSnapshot();
}
render(startupSnapshot);
api.subscribe(render);

function localDateTime(timestamp) {
  const date = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 19);
}
