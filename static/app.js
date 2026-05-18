const state = {
  sessionId: null,
  sessionName: "",
  workdir: "",
  messages: [],
  isStreaming: false,
  contextFiles: [],
  skills: [],
  activeSkillCategory: "all",
  currentSkill: null,
  status: null,
  selectedModel: "deepseek-v4-pro[1m]",
  permissionMode: "ask",
  theme: "light",
  language: "zh-CN",
  accent: "husky",
  settings: null,
  updateInfo: null,
  abortController: null,
  cancelRequested: false,
  pendingPermissionResolver: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const STORAGE_PREFIX = "viniper-ui:";
const LAST_SESSION_KEY = `${STORAGE_PREFIX}last-session-id`;
const MODEL_KEY = `${STORAGE_PREFIX}selected-model`;
const PERMISSION_KEY = `${STORAGE_PREFIX}permission-mode`;
const THEME_KEY = `${STORAGE_PREFIX}theme`;
const LANGUAGE_KEY = `${STORAGE_PREFIX}language`;
const ACCENT_KEY = `${STORAGE_PREFIX}accent`;
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

function storageGet(key) {
  return localStorage.getItem(key);
}

function storageSet(key, value) {
  localStorage.setItem(key, value);
}

// Token estimation: ~3 chars per token for mixed Chinese/English text
// Context window limits (approximate for DeepSeek V4 models):
const CONTEXT_LIMITS = {
  "deepseek-v4-pro[1m]": 200000,  // DeepSeek V4 Pro
  "deepseek-v4-flash": 128000,    // DeepSeek V4 Flash
};
const DEFAULT_CONTEXT_LIMIT = 128000;
const COMPRESS_THRESHOLD = 0.65;  // Compress when history tokens reach 65% of limit
const CONTEXT_CRITICAL_THRESHOLD = 0.82;
const PERMISSION_MODES = [
  {
    id: "ask",
    label: "需要时确认",
    description: "普通聊天直接执行；本地文件、命令、程序操作前确认"
  },
  {
    id: "auto",
    label: "自动",
    description: "交给 Claude Code 自动处理权限"
  },
  {
    id: "bypassPermissions",
    label: "完全允许",
    description: "已信任环境下跳过权限确认"
  }
];
const PERMISSION_ACTION_RE = /(打开|运行|执行|安装|删除|修改|修复|编辑|写入|新建|创建|转换|导出|保存|移动|复制|重命名|启动|停止|读取|扫描|部署|提交|克隆|下载)/i;
const PERMISSION_TARGET_RE = /(文件|目录|文件夹|项目|仓库|网页|网站|浏览器|桌面|快捷方式|程序|应用|服务|word|excel|pdf|docx|xlsx|ppt|pptx|powershell|cmd|bash|npm|pnpm|yarn|pip|python|node|git|github|skill|app|端口|服务器)/i;
const PERMISSION_DIRECT_RE = /([a-z]:[\\/]|\\\\|\\.(docx|xlsx|pptx|pdf|zip|exe|bat|cmd|ps1|html|css|json|md)\\b|powershell\\s+-|cmd\\.exe|npm\\s+|pnpm\\s+|yarn\\s+|pip\\s+|git\\s+(clone|pull|push|commit|status|checkout|merge|fetch)|github|skill)/i;
const I18N = {
  "zh-CN": {
    newChat: "新建会话",
    skills: "技能库",
    settings: "设置",
    model: "模型",
    permission: "权限",
    directory: "目录",
    inputPlaceholder: "输入消息",
    attach: "添加附件",
    stop: "停止当前任务",
    send: "发送",
    themeLight: "浅色",
    themeDark: "深色",
    themeSystem: "系统",
    connected: "已连接",
    waitingKey: "等待配置 API key",
    thinking: "正在生成",
    update: "更新"
  },
  "en-US": {
    newChat: "New chat",
    skills: "Skills",
    settings: "Settings",
    model: "Model",
    permission: "Permission",
    directory: "Directory",
    inputPlaceholder: "Message",
    attach: "Attach file",
    stop: "Stop current task",
    send: "Send",
    themeLight: "Light",
    themeDark: "Dark",
    themeSystem: "System",
    connected: "connected",
    waitingKey: "Waiting for API key",
    thinking: "Generating",
    update: "Update"
  }
};

function estimateTokens(text) {
  return Math.ceil((text || "").length / 3);
}

function totalHistoryTokens() {
  let total = 0;
  for (const msg of state.messages) {
    total += estimateTokens(msg.content) + estimateTokens(msg.thinking);
  }
  return total;
}

function getContextLimit() {
  const model = (state.status?.models || []).find((item) => item.id === state.selectedModel);
  if (model?.context) return Number(model.context) || DEFAULT_CONTEXT_LIMIT;
  return CONTEXT_LIMITS[state.selectedModel] || DEFAULT_CONTEXT_LIMIT;
}

function applySettingsFromServer(settings) {
  if (!settings || typeof settings !== "object") return;
  state.settings = settings;
  const appearance = settings.appearance || {};
  applyLanguage(appearance.language || state.language);
  applyAccent(appearance.accent || state.accent);
  applyTheme(appearance.theme || state.theme);
}

function getInitialTheme() {
  const savedTheme = storageGet(THEME_KEY);
  return ["system", "light", "dark"].includes(savedTheme) ? savedTheme : "system";
}

function applyTheme(theme) {
  state.theme = ["system", "light", "dark"].includes(theme) ? theme : "system";
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = state.theme === "system"
    ? (prefersDark ? "dark" : "light")
    : state.theme;
  storageSet(THEME_KEY, state.theme);
  updateThemeButton();
}

function getInitialLanguage() {
  const savedLanguage = storageGet(LANGUAGE_KEY);
  return savedLanguage === "en-US" ? "en-US" : "zh-CN";
}

function applyLanguage(language) {
  state.language = language === "en-US" ? "en-US" : "zh-CN";
  document.documentElement.lang = state.language;
  storageSet(LANGUAGE_KEY, state.language);
  translateChrome();
}

function getInitialAccent() {
  const savedAccent = storageGet(ACCENT_KEY);
  return ["husky", "blue", "green", "rose"].includes(savedAccent) ? savedAccent : "husky";
}

function applyAccent(accent) {
  state.accent = ["husky", "blue", "green", "rose"].includes(accent) ? accent : "husky";
  document.documentElement.dataset.accent = state.accent;
  storageSet(ACCENT_KEY, state.accent);
}

function t(key) {
  return (I18N[state.language] || I18N["zh-CN"])[key] || I18N["zh-CN"][key] || key;
}

function translateChrome() {
  $("#new-chat-btn").title = t("newChat");
  $("#new-chat-btn").setAttribute("aria-label", t("newChat"));
  $("#toggle-skills-btn").textContent = t("skills");
  $("#settings-btn").textContent = t("settings");
  $(".model-picker span").textContent = t("model");
  $(".permission-picker span").textContent = t("permission");
  $("#change-workdir-btn").textContent = t("directory");
  $("#user-input").placeholder = t("inputPlaceholder");
  $("#file-btn").title = t("attach");
  $("#file-btn").setAttribute("aria-label", t("attach"));
  $("#stop-btn").title = t("stop");
  $("#stop-btn").setAttribute("aria-label", t("stop"));
  $("#send-btn").title = t("send");
  $("#send-btn").setAttribute("aria-label", t("send"));
  $("#thinking span:last-child").textContent = t("thinking");
  updateThemeButton();
  updateModelLabels();
  renderUpdateButton();
}

function updateThemeButton() {
  const button = $("#theme-toggle-btn");
  if (!button) return;

  const applied = document.documentElement.dataset.theme;
  $("#theme-toggle-icon").textContent = state.theme === "system" ? "◐" : (applied === "dark" ? "☾" : "☀");
  $("#theme-toggle-text").textContent = state.theme === "system"
    ? t("themeSystem")
    : (applied === "dark" ? t("themeDark") : t("themeLight"));
  button.title = t("themeSystem");
  button.setAttribute("aria-label", button.title);
}

function toggleTheme() {
  const order = ["light", "dark", "system"];
  const index = order.indexOf(state.theme);
  applyTheme(order[(index + 1) % order.length]);
}

document.addEventListener("DOMContentLoaded", async () => {
  applyAccent(getInitialAccent());
  applyTheme(getInitialTheme());
  applyLanguage(getInitialLanguage());
  bindEvents();
  await loadStatus();
  await loadSkills();
  await restoreLastSession();
  checkForUpdates({ silent: true });
});

function bindEvents() {
  const input = $("#user-input");

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
    if (event.ctrlKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openNewSessionModal();
    }
  });

  input.addEventListener("input", () => autoResize(input));

  $("#send-btn").addEventListener("click", () => sendMessage());
  $("#stop-btn").addEventListener("click", cancelCurrentTask);
  $("#file-btn").addEventListener("click", () => $("#file-input").click());
  $("#file-input").addEventListener("change", handleFileAttach);
  $("#new-chat-btn").addEventListener("click", openNewSessionModal);
  $("#toggle-skills-btn").addEventListener("click", toggleSkillsPanel);
  $("#close-skills-btn").addEventListener("click", () => $("#skills-panel").classList.add("hidden"));
  $("#skill-search").addEventListener("input", renderSkillList);
  $("#back-to-skills").addEventListener("click", showSkillList);
  $("#use-skill-btn").addEventListener("click", useSkill);
  $("#change-workdir-btn").addEventListener("click", changeWorkdir);
  $("#update-btn").addEventListener("click", () => checkForUpdates({ silent: false }));
  $("#cancel-update-btn").addEventListener("click", closeUpdateModal);
  $("#install-update-btn").addEventListener("click", installUpdate);
  $("#theme-toggle-btn").addEventListener("click", toggleTheme);
  $("#settings-btn").addEventListener("click", openSettingsModal);
  $("#close-settings-btn").addEventListener("click", closeSettingsModal);
  $("#cancel-settings-btn").addEventListener("click", closeSettingsModal);
  $("#save-settings-btn").addEventListener("click", saveSettings);
  $("#run-diagnostics-btn").addEventListener("click", runDiagnostics);
  $("#settings-models").addEventListener("input", renderSettingsModelSelect);
  $("#model-select").addEventListener("change", (event) => {
    state.selectedModel = event.target.value;
    storageSet(MODEL_KEY, state.selectedModel);
    updateModelLabels();
    renderCurrentSession();
    updateContextMeter();
  });
  $("#permission-select").addEventListener("change", (event) => {
    state.permissionMode = sanitizePermissionMode(event.target.value);
    storageSet(PERMISSION_KEY, state.permissionMode);
    renderPermissionSelect();
  });
  $("#context-compress-btn").addEventListener("click", compressCurrentContext);
  $("#cancel-session-btn").addEventListener("click", closeNewSessionModal);
  $("#create-session-btn").addEventListener("click", createNamedSession);
  $("#deny-permission-btn").addEventListener("click", () => closePermissionModal(false));
  $("#allow-once-btn").addEventListener("click", () => closePermissionModal(true));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closePermissionModal(false);
      closeNewSessionModal();
      closeSettingsModal();
      $("#skills-panel").classList.add("hidden");
    }
  });

  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (state.theme === "system") applyTheme("system");
    });
  }

  document.addEventListener("click", (event) => {
    const copyButton = event.target.closest("[data-copy]");
    if (copyButton) {
      navigator.clipboard.writeText(copyButton.dataset.copy || "").then(() => {
        const old = copyButton.textContent;
        copyButton.textContent = "已复制";
        setTimeout(() => {
          copyButton.textContent = old;
        }, 1200);
      });
    }

    const promptButton = event.target.closest("[data-prompt]");
    if (promptButton) {
      $("#user-input").value = promptButton.dataset.prompt || "";
      autoResize($("#user-input"));
      $("#user-input").focus();
      sendMessage();
    }
  });
}

async function loadStatus() {
  try {
    const response = await fetch("/api/status");
    state.status = await response.json();
    applySettingsFromServer(state.status.settings);
    const rememberedModel = storageGet(MODEL_KEY);
    const available = (state.status.models || []).map((model) => model.id);
    state.selectedModel = available.includes(rememberedModel)
      ? rememberedModel
      : (state.status.model || "deepseek-v4-pro[1m]");
    state.permissionMode = sanitizePermissionMode(storageGet(PERMISSION_KEY) || "ask");
    renderModelSelect();
    renderPermissionSelect();
    updateModelLabels();
    updateContextMeter();
    renderUpdateButton();
    translateChrome();
  } catch {
    $("#status-line").textContent = "服务未就绪";
  }
}

function renderUpdateButton() {
  const button = $("#update-btn");
  if (!button) return;

  const version = state.status?.version ? `v${state.status.version}` : t("update");
  if (state.updateInfo?.update_available) {
    button.textContent = `更新 ${state.updateInfo.latest_version || ""}`.trim();
    button.classList.add("update-available");
    button.title = `发现新版本 ${state.updateInfo.latest_version}`;
  } else {
    button.textContent = version;
    button.classList.remove("update-available");
    const configured = state.status?.update?.configured;
    button.title = configured ? "检查更新" : "未配置更新源";
  }
}

async function checkForUpdates({ silent = false } = {}) {
  const button = $("#update-btn");
  if (button) button.disabled = true;
  try {
    const response = await fetch("/api/update/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const data = await response.json();
    state.updateInfo = data;
    renderUpdateButton();

    if (data.update_available) {
      showUpdateModal(data);
      return data;
    }
    if (!silent) {
      alert(data.message || (data.configured === false ? "还没有配置更新源。" : "当前已经是最新版本。"));
    }
    return data;
  } catch (error) {
    if (!silent) alert(`检查更新失败：${error.message}`);
    return null;
  } finally {
    if (button) button.disabled = false;
  }
}

function showUpdateModal(info) {
  const modal = $("#update-modal");
  if (!modal) return;
  $("#update-summary").textContent = `当前版本 v${info.current_version || "?"}，最新版本 v${info.latest_version || "?"}。`;
  $("#update-notes").textContent = info.notes || "这个版本包含最新修复和功能更新。";
  modal.classList.remove("hidden");
  $("#install-update-btn").focus();
}

function closeUpdateModal() {
  const modal = $("#update-modal");
  if (modal) modal.classList.add("hidden");
}

async function installUpdate() {
  const info = state.updateInfo?.update_available ? state.updateInfo : await checkForUpdates({ silent: true });
  if (!info?.update_available) {
    alert("当前没有可安装的新版本。");
    return;
  }

  const button = $("#install-update-btn");
  const oldText = button.textContent;
  button.disabled = true;
  $("#cancel-update-btn").disabled = true;
  button.textContent = "更新中";

  try {
    const response = await fetch("/api/update/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const data = await response.json();
    if (!response.ok || data.ok === false) {
      throw new Error(data.detail || data.message || `更新失败: ${response.status}`);
    }
    $("#update-notes").textContent = data.message || "更新已安装，请重启 UI。";
    button.textContent = "已安装";
    renderUpdateButton();
    alert(data.message || "更新已安装，请重新打开 Viniper UI。");
  } catch (error) {
    $("#update-notes").textContent = `更新失败：${error.message}`;
    button.textContent = oldText;
    button.disabled = false;
    $("#cancel-update-btn").disabled = false;
  }
}

function modelsToText(models = []) {
  return models.map((model) => [
    model.id || "",
    model.label || model.id || "",
    model.context || ""
  ].join(" | ")).join("\n");
}

function parseModelsText(text) {
  const models = [];
  const seen = new Set();
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split("|").map((part) => part.trim());
    const id = parts[0];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const context = Number(parts[2] || DEFAULT_CONTEXT_LIMIT);
    models.push({
      id,
      label: parts[1] || id,
      description: "",
      context: Number.isFinite(context) ? Math.max(context, 8192) : DEFAULT_CONTEXT_LIMIT
    });
  }
  return models.length ? models : [
    { id: "deepseek-v4-pro[1m]", label: "DeepSeek V4 Pro", description: "", context: 200000 },
    { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", description: "", context: 128000 }
  ];
}

function renderSettingsOptions(select, options, selected) {
  select.innerHTML = options.map((item) => `
    <option value="${escapeAttr(item.id)}"${item.available === false ? " disabled" : ""}>
      ${escapeHtml(item.label || item.id)}
    </option>
  `).join("");
  select.value = selected;
}

function renderSettingsModelSelect() {
  const select = $("#settings-provider-model");
  if (!select) return;
  const previous = select.value || state.settings?.provider?.model || state.selectedModel;
  const models = parseModelsText($("#settings-models").value);
  select.innerHTML = models.map((model) => `
    <option value="${escapeAttr(model.id)}">${escapeHtml(model.label || model.id)}</option>
  `).join("");
  select.value = models.some((model) => model.id === previous) ? previous : models[0]?.id || "";
}

async function openSettingsModal() {
  try {
    const response = await fetch("/api/settings");
    const data = await response.json();
    if (data.settings) {
      state.settings = data.settings;
      state.status = {
        ...(state.status || {}),
        shells: data.shells,
        languages: data.languages,
        themes: data.themes,
        accents: data.accents,
        models: data.models
      };
    }
  } catch {}

  const settings = state.settings || state.status?.settings || {};
  const account = settings.account || {};
  const appearance = settings.appearance || {};
  const shell = settings.shell || {};
  const provider = settings.provider || {};

  $("#settings-display-name").value = account.display_name || "";
  $("#settings-signed-in").checked = Boolean(account.signed_in);
  renderSettingsOptions($("#settings-language"), state.status?.languages || [], appearance.language || state.language);
  renderSettingsOptions($("#settings-theme"), state.status?.themes || [], appearance.theme || state.theme);
  renderSettingsOptions($("#settings-accent"), state.status?.accents || [], appearance.accent || state.accent);
  renderSettingsOptions($("#settings-shell"), state.status?.shells || [], shell.id || "claude-code");
  $("#settings-provider-label").value = provider.label || "DeepSeek";
  $("#settings-base-url").value = provider.base_url || "";
  $("#settings-api-key").value = "";
  $("#settings-api-key").placeholder = provider.api_key_configured ? "已保存，留空保持不变" : "输入 API Key";
  $("#settings-models").value = modelsToText(provider.models || state.status?.models || []);
  renderSettingsModelSelect();
  $("#settings-provider-model").value = provider.model || state.selectedModel;
  $("#diagnostics-panel").innerHTML = "";
  $("#settings-modal").classList.remove("hidden");
  $("#settings-display-name").focus();
}

function closeSettingsModal() {
  const modal = $("#settings-modal");
  if (modal) modal.classList.add("hidden");
}

async function saveSettings() {
  const models = parseModelsText($("#settings-models").value);
  const apiKey = $("#settings-api-key").value.trim();
  const settings = {
    account: {
      display_name: $("#settings-display-name").value.trim() || "Viniper 用户",
      signed_in: $("#settings-signed-in").checked
    },
    appearance: {
      language: $("#settings-language").value,
      theme: $("#settings-theme").value,
      accent: $("#settings-accent").value
    },
    shell: {
      id: $("#settings-shell").value
    },
    provider: {
      label: $("#settings-provider-label").value.trim() || "DeepSeek",
      base_url: $("#settings-base-url").value.trim(),
      model: $("#settings-provider-model").value || models[0].id,
      models
    }
  };
  if (apiKey) settings.provider.api_key = apiKey;

  const button = $("#save-settings-btn");
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = "保存中";
  try {
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings })
    });
    const data = await response.json();
    if (!response.ok || data.ok === false) {
      throw new Error(data.detail || "保存失败");
    }
    state.settings = data.settings;
    state.status = { ...(state.status || {}), models: data.models, settings: data.settings };
    applySettingsFromServer(data.settings);
    renderModelSelect();
    state.selectedModel = data.settings.provider?.model || state.selectedModel;
    storageSet(MODEL_KEY, state.selectedModel);
    renderModelSelect();
    updateModelLabels();
    updateContextMeter();
    closeSettingsModal();
  } catch (error) {
    $("#diagnostics-panel").innerHTML = `<div class="diagnostic-row fail"><strong>失败</strong><span>${escapeHtml(error.message)}</span></div>`;
  } finally {
    button.disabled = false;
    button.textContent = oldText;
  }
}

async function runDiagnostics() {
  const panel = $("#diagnostics-panel");
  panel.innerHTML = `<div class="diagnostic-row"><strong>检查</strong><span>正在运行自检...</span></div>`;
  try {
    const response = await fetch("/api/diagnostics");
    const data = await response.json();
    panel.innerHTML = (data.checks || []).map((item) => `
      <div class="diagnostic-row ${item.ok ? "ok" : "fail"}">
        <strong>${item.ok ? "通过" : "失败"}</strong>
        <span>${escapeHtml(item.label)}：${escapeHtml(item.detail || "")}</span>
      </div>
    `).join("");
  } catch (error) {
    panel.innerHTML = `<div class="diagnostic-row fail"><strong>失败</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

function renderModelSelect() {
  const select = $("#model-select");
  const models = state.status?.models || [
    { id: "deepseek-v4-pro[1m]", label: "DeepSeek V4 Pro", description: "复杂推理" },
    { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", description: "快速响应" }
  ];

  select.innerHTML = models.map((model) => `
    <option value="${escapeAttr(model.id)}" title="${escapeAttr(model.description || "")}">
      ${escapeHtml(model.label)}
    </option>
  `).join("");
  if (!models.some((model) => model.id === state.selectedModel)) {
    state.selectedModel = models[0]?.id || state.selectedModel;
  }
  select.value = state.selectedModel;
}

function permissionModeOptions() {
  return PERMISSION_MODES;
}

function sanitizePermissionMode(mode) {
  const value = String(mode || "");
  return permissionModeOptions().some((item) => item.id === value) ? value : "ask";
}

function renderPermissionSelect() {
  const select = $("#permission-select");
  if (!select) return;

  const modes = permissionModeOptions();
  if (!modes.some((item) => item.id === state.permissionMode)) {
    state.permissionMode = "ask";
  }

  select.innerHTML = modes.map((mode) => `
    <option value="${escapeAttr(mode.id)}" title="${escapeAttr(mode.description || "")}">
      ${escapeHtml(mode.label)}
    </option>
  `).join("");
  select.value = state.permissionMode;
}

function updateModelLabels() {
  const option = getSelectedModelOption();
  $("#status-line").textContent = state.status?.configured
    ? `${option.label} ${t("connected")}`
    : t("waitingKey");
}

function getSelectedModelOption() {
  const models = state.status?.models || [];
  return models.find((model) => model.id === state.selectedModel) || {
    id: state.selectedModel,
    label: state.selectedModel,
    description: ""
  };
}

async function createSession({ silent = false, name = "", workdir = "" } = {}) {
  const response = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, workdir })
  });
  const data = await response.json();
  state.sessionId = data.session_id;
  state.sessionName = data.name || "";
  state.workdir = data.workdir || "";
  state.messages = [];
  state.contextFiles = [];
  renderCurrentSession();
  renderWelcome();
  renderContextFiles();
  updateContextMeter();
  rememberSession(state.sessionId);
  await loadSessionList();
  if (!silent) $("#user-input").focus();
}

async function restoreLastSession() {
  const remembered = storageGet(LAST_SESSION_KEY);
  if (remembered) {
    const ok = await switchSession(remembered, { quiet: true });
    if (ok) return;
  }

  try {
    const response = await fetch("/api/sessions/last");
    const data = await response.json();
    if (data.session?.session_id) {
      applySession(data.session.session_id, data.session);
      rememberSession(data.session.session_id);
      await loadSessionList();
      scrollBottom();
      return;
    }
  } catch {}

  await createSession({ silent: true });
}

function openNewSessionModal() {
  $("#new-session-name").value = "";
  $("#new-session-workdir").value = "";
  $("#new-session-modal").classList.remove("hidden");
  $("#new-session-name").focus();
}

function closeNewSessionModal() {
  $("#new-session-modal").classList.add("hidden");
}

async function createNamedSession() {
  await createSession({
    name: $("#new-session-name").value.trim(),
    workdir: $("#new-session-workdir").value.trim()
  });
  closeNewSessionModal();
}

async function loadSessionList() {
  const response = await fetch("/api/sessions");
  const data = await response.json();
  const sessions = data.sessions || [];
  const list = $("#session-list");

  if (!sessions.length) {
    list.innerHTML = `<div class="empty-list">暂无会话</div>`;
    return;
  }

  list.innerHTML = sessions.map((session) => {
    const active = session.id === state.sessionId ? " active" : "";
    const title = session.name || session.id;
    const meta = [shortenPath(session.workdir), session.count ? `${session.count} 条消息` : ""]
      .filter(Boolean)
      .join(" · ");
    return `
      <div class="session-item${active}" data-session="${escapeAttr(session.id)}">
        <button class="session-main" data-open-session="${escapeAttr(session.id)}">
          <span class="session-name">${escapeHtml(title)}</span>
          <span class="session-meta">${escapeHtml(meta)}</span>
        </button>
        <button class="mini-button" title="重命名" data-rename-session="${escapeAttr(session.id)}">✎</button>
        <button class="mini-button danger" title="删除" data-delete-session="${escapeAttr(session.id)}">×</button>
      </div>
    `;
  }).join("");

  $$("[data-open-session]").forEach((button) => {
    button.addEventListener("click", () => switchSession(button.dataset.openSession));
  });

  $$("[data-delete-session]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.deleteSession;
      const item = button.closest(".session-item");
      const title = item?.querySelector(".session-name")?.textContent?.trim() || id;
      if (!window.confirm(`删除会话“${title}”？`)) return;
      await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (id === state.sessionId) {
        await createSession({ silent: true });
      } else {
        await loadSessionList();
      }
    });
  });

  $$("[data-rename-session]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.renameSession;
      const currentName = id === state.sessionId ? state.sessionName : "";
      const nextName = window.prompt("新的会话名称", currentName);
      if (nextName === null) return;
      await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName.trim() })
      });
      if (id === state.sessionId) state.sessionName = nextName.trim();
      renderCurrentSession();
      await loadSessionList();
    });
  });
}

async function switchSession(sessionId, { quiet = false } = {}) {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
  if (!response.ok) return false;
  const data = await response.json();
  applySession(sessionId, data);
  rememberSession(sessionId);
  await loadSessionList();
  scrollBottom();
  if (!quiet) $("#user-input").focus();
  return true;
}

function applySession(sessionId, data) {
  state.sessionId = sessionId;
  state.sessionName = data.name || "";
  state.workdir = data.workdir || "";
  state.messages = data.messages || [];
  renderCurrentSession();
  renderAllMessages();
  renderContextFiles();
  updateContextMeter();
}

function rememberSession(sessionId) {
  if (sessionId) storageSet(LAST_SESSION_KEY, sessionId);
}

async function changeWorkdir() {
  const next = window.prompt("工作目录", state.workdir || "");
  if (next === null) return;
  state.workdir = next.trim();
  await fetch(`/api/sessions/${encodeURIComponent(state.sessionId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workdir: state.workdir })
  });
  renderCurrentSession();
  await loadSessionList();
}

function renderCurrentSession() {
  $("#session-title").textContent = state.sessionName || "新会话";
  $("#workdir-display").textContent = shortenPath(state.workdir);
  if ($("#model-select").value !== state.selectedModel) {
    $("#model-select").value = state.selectedModel;
  }
  updateContextMeter();
}

function renderWelcome() {
  $("#messages").innerHTML = `
    <div class="welcome">
      <h1>准备好了</h1>
      <p>当前模型：${escapeHtml(getSelectedModelOption().label)}</p>
      <div class="quick-actions">
        <button class="quick-btn" data-prompt="帮我检查这个网页还有哪些可以改进">检查网页</button>
        <button class="quick-btn" data-prompt="帮我整理今天的任务">整理任务</button>
        <button class="quick-btn" data-prompt="帮我写一个清晰的执行计划">制定计划</button>
      </div>
    </div>
  `;
}

function renderAllMessages() {
  if (!state.messages.length) {
    renderWelcome();
    return;
  }

  $("#messages").innerHTML = state.messages.map((message) => {
    const roleClass = message.role === "system" ? "system" : message.role;
    const label = message.role === "user"
      ? "你"
      : (message.role === "system" ? "上下文摘要" : assistantLabel(message.model));
    const content = message.content;
    return messageTemplate(roleClass, label, content, message.thinking || "");
  }).join("");
}

function addMessage(role, content) {
  const welcome = $(".welcome");
  if (welcome) welcome.remove();

  const roleClass = role;
  const label = role === "user" ? "你" : assistantLabel(state.selectedModel);
  $("#messages").insertAdjacentHTML("beforeend", messageTemplate(roleClass, label, content));
  scrollBottom();
  return $("#messages .message:last-child .msg-content");
}

function assistantLabel(modelId) {
  const option = (state.status?.models || []).find((model) => model.id === modelId);
  return option ? `小伍 · ${option.label}` : "小伍";
}

function messageTemplate(roleClass, label, content, thinking = "") {
  const displayContent = repairTextForDisplay(content);
  const displayThinking = repairTextForDisplay(thinking);
  const body = roleClass === "assistant" || roleClass === "error"
    ? renderMarkdown(displayContent)
    : escapeHtml(displayContent);
  return `
    <article class="message ${roleClass}">
      <header class="msg-header">${escapeHtml(label)}</header>
      ${displayThinking && roleClass === "assistant" ? renderThinkingPanel(displayThinking) : ""}
      <div class="msg-content">${body}</div>
    </article>
  `;
}

function needsPermissionForPrompt(text, files = []) {
  if (files.length) return true;
  const value = String(text || "");
  return PERMISSION_DIRECT_RE.test(value)
    || (PERMISSION_ACTION_RE.test(value) && PERMISSION_TARGET_RE.test(value));
}

async function resolvePermissionMode(text, files = []) {
  if (state.permissionMode === "bypassPermissions") {
    return "bypassPermissions";
  }

  if (state.permissionMode === "auto") {
    return "auto";
  }

  if (!needsPermissionForPrompt(text, files)) {
    return "default";
  }

  const summary = files.length
    ? `${text}\n\n附件：${files.map((file) => `${file.name} (${formatBytes(file.size)})`).join("，")}`
    : text;
  const allowed = await showPermissionModal(summary);
  return allowed ? "bypassPermissions" : null;
}

function showPermissionModal(text) {
  const modal = $("#permission-modal");
  const summary = $("#permission-summary");
  const workdir = $("#permission-workdir");

  summary.textContent = String(text || "").slice(0, 420);
  workdir.textContent = state.workdir || "当前工作区";
  modal.classList.remove("hidden");
  $("#allow-once-btn").focus();

  return new Promise((resolve) => {
    state.pendingPermissionResolver = resolve;
  });
}

function closePermissionModal(allowed) {
  const modal = $("#permission-modal");
  if (modal) modal.classList.add("hidden");

  if (state.pendingPermissionResolver) {
    const resolve = state.pendingPermissionResolver;
    state.pendingPermissionResolver = null;
    resolve(Boolean(allowed));
  }
}

function formatBytes(size) {
  let value = Math.max(Number(size) || 0, 0);
  const units = ["B", "KB", "MB", "GB"];
  for (const unit of units) {
    if (value < 1024 || unit === "GB") {
      return unit === "B" ? `${Math.round(value)} B` : `${value.toFixed(1)} ${unit}`;
    }
    value /= 1024;
  }
  return `${Math.round(value)} B`;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function fileToAttachment(file) {
  const buffer = await file.arrayBuffer();
  return {
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    data: arrayBufferToBase64(buffer)
  };
}

function attachmentDisplayText(text, attachments) {
  if (!attachments.length) return text;
  const lines = attachments.map((item) => `[附件: ${item.name} · ${formatBytes(item.size)} · ${item.type || "application/octet-stream"}]`);
  return `${text}\n\n${lines.join("\n")}`;
}

async function sendMessage() {
  if (state.isStreaming || !state.sessionId) return;

  const input = $("#user-input");
  const text = input.value.trim();
  if (!text) return;

  const files = [...state.contextFiles];
  const tooLarge = files.find((file) => file.size > MAX_ATTACHMENT_BYTES);
  if (tooLarge) {
    alert(`附件过大：${tooLarge.name} 超过 ${formatBytes(MAX_ATTACHMENT_BYTES)}。大文件请直接告诉 Claude Code 文件路径来读取。`);
    return;
  }

  const permissionMode = await resolvePermissionMode(text, files);
  if (!permissionMode) return;

  let attachments = [];
  try {
    attachments = await Promise.all(files.map(fileToAttachment));
  } catch (error) {
    alert(`附件读取失败：${error.message || error}`);
    return;
  }

  if (files.length) {
    state.contextFiles = [];
    renderContextFiles();
  }

  input.value = "";
  autoResize(input);
  state.isStreaming = true;
  state.cancelRequested = false;
  state.abortController = new AbortController();
  setInputEnabled(false);
  showStopButton(true);
  showThinking(true);

  addMessage("user", attachmentDisplayText(text, attachments));
  const assistantContent = addMessage("assistant", "");
  const assistantArticle = assistantContent.closest(".message");
  let fullText = "";
  let thinkingText = "";
  let thinkingBody = null;
  let thinkingPreview = null;
  let receivedDone = false;  // track whether we got a "done" SSE event

  // Long-running notice: keep the input locked while the backend task is alive.
  const safetyTimer = setTimeout(() => {
    if (state.isStreaming) {
      showThinking(false);
      if (!fullText) {
        assistantContent.innerHTML = renderMarkdown("(任务仍在运行，我会继续等待；为避免重复执行，先不要再次提交同一条指令。)");
      }
    }
  }, 120000);  // 2 minutes: show a notice, but do not allow duplicate sends

  try {
    const response = await fetch(`/api/chat/${encodeURIComponent(state.sessionId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, model: state.selectedModel, permission_mode: permissionMode, attachments }),
      signal: state.abortController.signal
    });

    if (!response.ok || !response.body) {
      throw new Error(`请求失败: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    const handleSsePart = (part) => {
      const line = part.split("\n").find((item) => item.startsWith("data: "));
      if (!line) return;

      let payload = null;
      try {
        payload = JSON.parse(line.slice(6));
      } catch {
        return;
      }

      if (typeof payload.content === "string") {
        payload.content = repairTextForDisplay(payload.content);
      }

      if (payload.type === "thinking") {
        showThinking(false);
        thinkingText += payload.content || "";
        if (!thinkingBody || !thinkingPreview) {
          const wrapper = document.createElement("div");
          wrapper.innerHTML = renderThinkingPanel("");
          assistantArticle.insertBefore(wrapper.firstElementChild, assistantContent);
          thinkingBody = assistantArticle.querySelector(".thinking-body");
          thinkingPreview = assistantArticle.querySelector(".thinking-preview");
        }
        thinkingPreview.textContent = previewThinking(thinkingText);
        thinkingBody.innerHTML = renderMarkdown(thinkingText);
        scrollBottom();
      } else if (payload.type === "text") {
        showThinking(false);
        fullText += payload.content || "";
        assistantContent.innerHTML = renderMarkdown(fullText);
        scrollBottom();
      } else if (payload.type === "error") {
        showThinking(false);
        if (state.cancelRequested) {
          fullText = "已停止当前任务，输入已恢复。";
          assistantContent.innerHTML = renderMarkdown(fullText);
        } else {
          fullText = `错误：${payload.content || ""}`;
          assistantContent.innerHTML = renderMarkdown(fullText);
          assistantContent.closest(".message").classList.add("error");
        }
      } else if (payload.type === "heartbeat") {
        showThinking(false);
        if (!fullText) {
          const minutes = Math.max(1, Math.round((Number(payload.elapsed) || 0) / 60));
          const note = payload.action_task
            ? `动作任务仍在运行，已等待约 ${minutes} 分钟。我会继续等；如果你判断它卡住，可以点停止按钮。`
            : `长任务仍在运行，已等待约 ${minutes} 分钟。我会保持连接，不会提前打断。`;
          assistantContent.innerHTML = renderMarkdown(`(${note})`);
        }
      } else if (payload.type === "done") {
        receivedDone = true;
        showThinking(false);
      }
    };

    const consumeSseBuffer = (final = false) => {
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      if (final && buffer.trim()) {
        parts.push(buffer);
        buffer = "";
      }
      for (const part of parts) handleSsePart(part);
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        consumeSseBuffer(true);
        // Stream closed by server, but we may not have received an explicit "done" SSE event
        if (!receivedDone) {
          showThinking(false);
        }
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      consumeSseBuffer();
    }
  } catch (error) {
    showThinking(false);
    if (error.name === "AbortError" || state.cancelRequested) {
      fullText = fullText || "已停止当前任务，输入已恢复。";
      assistantContent.innerHTML = renderMarkdown(fullText);
    } else {
      fullText = `连接失败：${error.message}`;
      assistantContent.innerHTML = renderMarkdown(fullText);
      assistantContent.closest(".message").classList.add("error");
    }
  } finally {
    clearTimeout(safetyTimer);
    // Always re-enable input first, regardless of what happens next
    state.isStreaming = false;
    state.abortController = null;
    state.cancelRequested = false;
    showStopButton(false);
    setInputEnabled(true);
    showThinking(false);
    $("#user-input").focus();

    // Switch session to refresh state — but NEVER block input re-enable on this
    try {
      await switchSession(state.sessionId);
    } catch {
      // Session refresh failed — input is already re-enabled, proceed
    }

    updateContextMeter({ announce: true });
  }
}

function contextStats() {
  const tokens = totalHistoryTokens();
  const limit = getContextLimit();
  const ratio = limit ? Math.min(tokens / limit, 1) : 0;
  return {
    tokens,
    limit,
    ratio,
    percent: Math.round(ratio * 100),
    shouldCompress: ratio >= COMPRESS_THRESHOLD,
    critical: ratio >= CONTEXT_CRITICAL_THRESHOLD
  };
}

function updateContextMeter({ announce = false } = {}) {
  const meter = $("#context-meter");
  if (!meter) return;

  const stats = contextStats();
  $("#context-percent").textContent = `${stats.percent}%`;
  $("#context-fill").style.width = `${stats.percent}%`;
  $("#context-label").textContent = stats.shouldCompress ? "上下文接近上限" : "上下文";

  meter.classList.toggle("warn", stats.shouldCompress && !stats.critical);
  meter.classList.toggle("critical", stats.critical);
  $("#context-compress-btn").classList.toggle("hidden", !stats.shouldCompress);

  if (announce && stats.shouldCompress) {
    showContextNotice(stats);
  } else if (!stats.shouldCompress) {
    hideContextNotice();
  }
}

function showContextNotice(stats = contextStats()) {
  let notice = $(".context-notice");
  if (!notice) {
    notice = document.createElement("div");
    notice.className = "context-notice";
    const messagesEl = $("#messages");
    if (messagesEl) messagesEl.prepend(notice);
  }
  notice.textContent = stats.critical
    ? `上下文已到 ${stats.percent}%，建议现在压缩，否则 Claude Code 可能丢上下文或跑偏。`
    : `上下文已到 ${stats.percent}%，接近上限，可以先压缩再继续。`;
}

function hideContextNotice() {
  const notice = $(".context-notice");
  if (notice) notice.remove();
}

async function compressCurrentContext() {
  if (!state.sessionId || state.isStreaming) return;

  const button = $("#context-compress-btn");
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = "压缩中";
  showContextNotice({ ...contextStats(), critical: true, percent: contextStats().percent });

  try {
    const response = await fetch(`/api/compress/${encodeURIComponent(state.sessionId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: state.selectedModel })
    });
    const data = await response.json();
    if (!response.ok || data.ok === false) {
      throw new Error(data.reason || `压缩失败: ${response.status}`);
    }
    if (data.compressed) {
      await switchSession(state.sessionId, { quiet: true });
      showCompressedBanner("上下文已压缩，底层 Claude Code 会话也已重置并带入摘要。");
    } else {
      showCompressedBanner("当前上下文还不需要压缩。");
    }
  } catch (error) {
    showContextNotice({ ...contextStats(), critical: true, percent: contextStats().percent });
    const notice = $(".context-notice");
    if (notice) notice.textContent = `上下文压缩失败：${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = oldText;
    updateContextMeter();
    $("#user-input").focus();
  }
}

function renderThinkingPanel(thinking) {
  return `
    <details class="thinking-panel">
      <summary>
        <span>思考过程</span>
        <span class="thinking-preview">${escapeHtml(previewThinking(thinking))}</span>
      </summary>
      <div class="thinking-body">${renderMarkdown(thinking)}</div>
    </details>
  `;
}

function previewThinking(thinking) {
  const clean = repairTextForDisplay(thinking).replace(/\s+/g, " ").trim();
  if (!clean) return "正在梳理...";
  return clean.length > 140 ? `${clean.slice(0, 140)}...` : clean;
}

function showThinking(show) {
  $("#thinking").classList.toggle("hidden", !show);
}

async function cancelCurrentTask() {
  if (!state.isStreaming || !state.sessionId) return;

  state.cancelRequested = true;
  try {
    await fetch(`/api/chat/${encodeURIComponent(state.sessionId)}/cancel`, { method: "POST" });
  } catch {}

  if (state.abortController) {
    state.abortController.abort();
  }
}

function showStopButton(show) {
  const stopButton = $("#stop-btn");
  if (stopButton) stopButton.classList.toggle("hidden", !show);
}

function setInputEnabled(enabled) {
  $("#send-btn").disabled = !enabled;
  $("#user-input").disabled = !enabled;
  $("#file-btn").disabled = !enabled;
  $("#update-btn").disabled = !enabled;
}

function autoResize(element) {
  element.style.height = "auto";
  element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
}

function handleFileAttach() {
  state.contextFiles.push(...Array.from($("#file-input").files || []));
  $("#file-input").value = "";
  renderContextFiles();
}

function renderContextFiles() {
  $("#context-files").innerHTML = state.contextFiles.map((file, index) => `
    <span class="ctx-file">
      ${escapeHtml(file.name)} <span class="ctx-file-size">${escapeHtml(formatBytes(file.size))}</span>
      <button type="button" data-remove-file="${index}" aria-label="移除">×</button>
    </span>
  `).join("");

  $$("[data-remove-file]").forEach((button) => {
    button.addEventListener("click", () => {
      state.contextFiles.splice(Number(button.dataset.removeFile), 1);
      renderContextFiles();
    });
  });
}

async function loadSkills() {
  try {
    const response = await fetch("/api/skills");
    const data = await response.json();
    state.skills = data.skills || [];
    renderSkillCategories();
    renderSkillList();
  } catch {
    state.skills = [];
  }
}

function renderSkillCategories() {
  const categories = ["all", ...new Set(state.skills.map((skill) => skill.category))];
  $("#skills-categories").innerHTML = categories.map((category) => `
    <button class="cat-chip${category === state.activeSkillCategory ? " active" : ""}" data-category="${escapeAttr(category)}">
      ${category === "all" ? "全部" : escapeHtml(category)}
    </button>
  `).join("");

  $$(".cat-chip").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeSkillCategory = button.dataset.category;
      renderSkillCategories();
      renderSkillList();
    });
  });
}

function renderSkillList() {
  const query = ($("#skill-search").value || "").trim().toLowerCase();
  let skills = state.skills;

  if (state.activeSkillCategory !== "all") {
    skills = skills.filter((skill) => skill.category === state.activeSkillCategory);
  }
  if (query) {
    skills = skills.filter((skill) =>
      `${skill.name} ${skill.description} ${skill.category}`.toLowerCase().includes(query)
    );
  }

  $("#skills-list").innerHTML = skills.length
    ? skills.map((skill) => `
      <button class="skill-card" data-skill="${escapeAttr(skill.filename)}">
        <span class="skill-name">${escapeHtml(skill.name)}</span>
        <span class="skill-desc">${escapeHtml(skill.description || "无描述")}</span>
        <span class="skill-cat">${escapeHtml(skill.category)}</span>
      </button>
    `).join("")
    : `<div class="empty-list">没有匹配结果</div>`;

  $$(".skill-card").forEach((card) => {
    card.addEventListener("click", () => showSkillDetail(card.dataset.skill));
  });
}

async function showSkillDetail(filename) {
  state.currentSkill = filename;
  const response = await fetch(`/api/skills/${encodeURIComponent(filename)}`);
  const data = await response.json();
  $("#skill-detail-content").innerHTML = data.content ? renderMarkdown(data.content) : escapeHtml(data.detail || "加载失败");
  $("#skills-list").classList.add("hidden");
  $("#skills-categories").classList.add("hidden");
  $(".skills-search").classList.add("hidden");
  $("#skill-detail").classList.remove("hidden");
}

function showSkillList() {
  state.currentSkill = null;
  $("#skill-detail").classList.add("hidden");
  $("#skills-list").classList.remove("hidden");
  $("#skills-categories").classList.remove("hidden");
  $(".skills-search").classList.remove("hidden");
}

function useSkill() {
  if (!state.currentSkill) return;
  const skill = state.skills.find((item) => item.filename === state.currentSkill);
  const fallback = state.currentSkill.replace(/\.md$/i, "").replace(/^[^_]+_/, "");
  const skillName = (skill?.command || fallback).trim();
  $("#user-input").value = `/${skillName} `;
  autoResize($("#user-input"));
  $("#user-input").focus();
  $("#skills-panel").classList.add("hidden");
}

function toggleSkillsPanel() {
  const panel = $("#skills-panel");
  panel.classList.toggle("hidden");
  if (!panel.classList.contains("hidden")) loadSkills();
}

const MOJIBAKE_MARKERS = [
  "\uFFFD", "\u00C2", "\u00C3", "\u00C5", "\u00C6", "\u00C7",
  "\u00C8", "\u00C9", "\u00E2", "\u00E4", "\u00E5", "\u00E6",
  "\u00E7", "\u00E8", "\u00E9", "\u00EF", "\u2018", "\u2019",
  "\u201C", "\u201D", "\u2026", "\u2030"
];
const CP1252_EXTRA_BYTES = new Map([
  ["\u20AC", 0x80], ["\u201A", 0x82], ["\u0192", 0x83], ["\u201E", 0x84],
  ["\u2026", 0x85], ["\u2020", 0x86], ["\u2021", 0x87], ["\u02C6", 0x88],
  ["\u2030", 0x89], ["\u0160", 0x8A], ["\u2039", 0x8B], ["\u0152", 0x8C],
  ["\u017D", 0x8E], ["\u2018", 0x91], ["\u2019", 0x92], ["\u201C", 0x93],
  ["\u201D", 0x94], ["\u2022", 0x95], ["\u2013", 0x96], ["\u2014", 0x97],
  ["\u02DC", 0x98], ["\u2122", 0x99], ["\u0161", 0x9A], ["\u203A", 0x9B],
  ["\u0153", 0x9C], ["\u017E", 0x9E], ["\u0178", 0x9F]
]);

function mojibakeScore(text) {
  const value = String(text || "");
  let score = (value.match(/\uFFFD/g) || []).length * 30;
  score += (value.match(/[\u0080-\u009F]/g) || []).length * 8;
  for (const marker of MOJIBAKE_MARKERS) {
    score += value.split(marker).length - 1;
  }
  return score;
}

function encodeSingleByte(text, encoding) {
  const bytes = [];
  for (const char of String(text || "")) {
    const code = char.codePointAt(0);
    if (code <= 0xFF) {
      bytes.push(code);
    } else if (encoding === "cp1252" && CP1252_EXTRA_BYTES.has(char)) {
      bytes.push(CP1252_EXTRA_BYTES.get(char));
    } else {
      return null;
    }
  }
  return new Uint8Array(bytes);
}

function repairWithSingleByteEncoding(text, encoding) {
  const bytes = encodeSingleByte(text, encoding);
  if (!bytes) return null;
  try {
    const repaired = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return repaired && repaired !== text ? repaired : null;
  } catch {
    return null;
  }
}

function repairTextForDisplay(value) {
  const text = String(value || "");
  const score = mojibakeScore(text);
  if (score < 6) return text;

  const candidates = [text];
  for (const encoding of ["latin1", "cp1252"]) {
    const repaired = repairWithSingleByteEncoding(text, encoding);
    if (repaired) candidates.push(repaired);
  }
  const best = candidates.reduce((winner, candidate) => (
    mojibakeScore(candidate) < mojibakeScore(winner) ? candidate : winner
  ), text);
  return mojibakeScore(best) < score ? best : text;
}

function renderMarkdown(rawText) {
  if (!rawText) return "";

  let text = repairTextForDisplay(rawText);
  const codeBlocks = [];
  text = text.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const index = codeBlocks.length;
    codeBlocks.push({ lang: lang.trim(), code: code.replace(/\n$/, "") });
    return `@@CODE_${index}@@`;
  });

  text = escapeHtml(text);
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  text = text.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  text = text.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  text = text.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");
  text = text.replace(/^\s*[-*] (.+)$/gm, "<li>$1</li>");
  text = text.replace(/(<li>[\s\S]*?<\/li>)(?!(\s*<li>))/g, "<ul>$1</ul>");
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  text = text.split(/\n{2,}/).map((block) => {
    if (/^\s*<(h1|h2|h3|ul|blockquote|pre|table)/.test(block)) return block;
    return `<p>${block.replace(/\n/g, "<br>")}</p>`;
  }).join("");

  codeBlocks.forEach((block, index) => {
    const lang = block.lang ? `<span class="code-lang">${escapeHtml(block.lang)}</span>` : "";
    const escapedCode = escapeHtml(block.code);
    const replacement = `<pre>${lang}<button class="copy-btn" data-copy="${escapeAttr(block.code)}">复制</button><code>${escapedCode}</code></pre>`;
    text = text.replace(`@@CODE_${index}@@`, replacement);
  });

  return text;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function shortenPath(path) {
  if (!path) return "";
  const normalized = String(path).replaceAll("\\", "/");
  const home = "C:/Users/13968";
  const display = normalized.toLowerCase().startsWith(home.toLowerCase())
    ? `~${normalized.slice(home.length)}`
    : normalized;
  return display.length > 56 ? `...${display.slice(-53)}` : display;
}

function scrollBottom() {
  requestAnimationFrame(() => {
    const container = $("#chat-container");
    container.scrollTop = container.scrollHeight;
  });
}

function showCompressedBanner(message = "已压缩上下文") {
  const existing = $(".compressed-banner");
  if (existing) existing.remove();
  const banner = document.createElement("div");
  banner.className = "compressed-banner";
  banner.textContent = message;
  const messagesEl = $("#messages");
  if (messagesEl) messagesEl.appendChild(banner);
  setTimeout(() => banner.remove(), 4000);
}
