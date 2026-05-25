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
  accent: "viniper",
  settings: null,
  updateInfo: null,
  abortController: null,
  cancelRequested: false,
  followOutput: true,
  folderPicker: {
    targetSelector: "",
    currentPath: "",
    parentPath: "",
    defaultRoot: "",
    roots: []
  },
  pendingPermissionResolver: null,
  pendingDeleteResolver: null,
  pendingRenameResolver: null,
  retrySend: { count: 0, max: 3, delayMs: 3000 },
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
const LAUNCH_SPLASH_MIN_MS = 1150;
const launchSplashStarted = performance.now();
let modelPersistTimer = null;

function storageGet(key) {
  return localStorage.getItem(key);
}

function storageSet(key, value) {
  localStorage.setItem(key, value);
}

// Token estimation: ~3 chars per token for mixed Chinese/English text
// Context window limits (approximate for DeepSeek V4 models):
const CONTEXT_LIMITS = {
  "deepseek-v4-pro[1m]": 1000000,  // DeepSeek V4 Pro 1M
  "deepseek-v4-flash": 128000,    // DeepSeek V4 Flash
};
const DEFAULT_CONTEXT_LIMIT = 128000;
const COMPRESS_THRESHOLD = 0.65;  // Compress when history tokens reach 65% of limit
const CONTEXT_CRITICAL_THRESHOLD = 0.82;
const PERMISSION_MODES = [
  {
    id: "ask",
    label: "需要时确认",
    description: "涉及本地文件、命令、程序、附件等操作时先在网页端确认"
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
const PERMISSION_ACTION_RE = /(打开|运行|执行|安装|删除|修改|修复|编辑|写入|新建|创建|转换|导出|保存|移动|复制|重命名|启动|停止|读取|扫描|部署|提交|克隆|下载|生成|制作|整理|处理|编译|跑)/i;
const PERMISSION_TARGET_RE = /(文件|目录|文件夹|项目|仓库|网页|网站|浏览器|桌面|快捷方式|程序|应用|服务|文档|资料|试卷|图片|截图|附件|压缩包|word|excel|pdf|docx|xlsx|ppt|pptx|powershell|cmd|bash|npm|pnpm|yarn|pip|python|node|git|github|skill|app|端口|服务器)/i;
const PERMISSION_DIRECT_RE = /([a-z]:[\\/]|\\\\|\\.(txt|tex|csv|docx|xlsx|pptx|pdf|zip|tar\\.gz|7z|rar|exe|bat|cmd|ps1|html|css|js|jsx|ts|tsx|json|md|py|png|jpe?g|webp)\\b|powershell\\s+-|cmd\\.exe|npm\\s+|pnpm\\s+|yarn\\s+|pip\\s+|git\\s+(clone|pull|push|commit|status|checkout|merge|fetch)|github|skill)/i;
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
  return ["viniper", "blue", "green", "rose"].includes(savedAccent) ? savedAccent : "viniper";
}

function applyAccent(accent) {
  state.accent = ["viniper", "blue", "green", "rose"].includes(accent) ? accent : "viniper";
  document.documentElement.dataset.accent = state.accent;
  storageSet(ACCENT_KEY, state.accent);
}

function t(key) {
  return (I18N[state.language] || I18N["zh-CN"])[key] || I18N["zh-CN"][key] || key;
}

function translateChrome() {
  $("#new-chat-btn").title = t("newChat");
  $("#new-chat-btn").setAttribute("aria-label", t("newChat"));
  if ($("#toggle-skills-btn")) $("#toggle-skills-btn").textContent = t("skills");
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
  try {
    applyAccent(getInitialAccent());
    applyTheme(getInitialTheme());
    applyLanguage(getInitialLanguage());
    bindEvents();
    await loadStatus();
    if ($("#skills-panel")) await loadSkills();
    await restoreLastSession();
    checkForUpdates({ silent: true });
  } finally {
    hideLaunchSplash();
  }
});

function hideLaunchSplash() {
  const splash = $("#launch-splash");
  if (!splash) return;
  const remaining = Math.max(0, LAUNCH_SPLASH_MIN_MS - (performance.now() - launchSplashStarted));
  setTimeout(() => {
    splash.classList.add("is-hiding");
    setTimeout(() => splash.remove(), 620);
  }, remaining);
}

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
  $("#chat-container").addEventListener("scroll", () => {
    if (state.isStreaming) state.followOutput = isNearChatBottom();
  });

  $("#send-btn").addEventListener("click", () => sendMessage());
  $("#stop-btn").addEventListener("click", cancelCurrentTask);
  $("#file-btn").addEventListener("click", () => $("#file-input").click());
  $("#file-input").addEventListener("change", handleFileAttach);
  $("#new-chat-btn").addEventListener("click", openNewSessionModal);
  if ($("#toggle-skills-btn")) $("#toggle-skills-btn").addEventListener("click", toggleSkillsPanel);
  if ($("#close-skills-btn")) $("#close-skills-btn").addEventListener("click", () => $("#skills-panel").classList.add("hidden"));
  if ($("#skill-search")) $("#skill-search").addEventListener("input", renderSkillList);
  if ($("#back-to-skills")) $("#back-to-skills").addEventListener("click", showSkillList);
  if ($("#use-skill-btn")) $("#use-skill-btn").addEventListener("click", useSkill);
  $("#change-workdir-btn").addEventListener("click", changeWorkdir);
  $("#update-btn").addEventListener("click", () => checkForUpdates({ silent: false }));
  $("#cancel-update-btn").addEventListener("click", closeUpdateModal);
  $("#install-update-btn").addEventListener("click", installUpdate);
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
    persistSelectedModel();
  });
  $("#permission-select").addEventListener("change", (event) => {
    state.permissionMode = sanitizePermissionMode(event.target.value);
    storageSet(PERMISSION_KEY, state.permissionMode);
  });
  $("#context-compress-btn").addEventListener("click", compressCurrentContext);
  $("#cancel-session-btn").addEventListener("click", closeNewSessionModal);
  $("#create-session-btn").addEventListener("click", createNamedSession);
  $("#cancel-delete-session-btn").addEventListener("click", () => closeDeleteSessionModal(false));
  $("#confirm-delete-session-btn").addEventListener("click", () => closeDeleteSessionModal(true));
  $("#cancel-workdir-btn").addEventListener("click", () => $("#workdir-modal").classList.add("hidden"));
  $("#save-workdir-btn").addEventListener("click", saveWorkdir);
  $("#browse-workdir-btn").addEventListener("click", () => openFolderPicker("#workdir-input", $("#workdir-input").value || state.workdir));
  $("#create-workdir-btn").addEventListener("click", () => createDefaultFolderForInput("#workdir-input"));
  $("#browse-new-session-workdir-btn").addEventListener("click", () => openFolderPicker("#new-session-workdir", $("#new-session-workdir").value));
  $("#create-new-session-workdir-btn").addEventListener("click", () => createDefaultFolderForInput("#new-session-workdir"));
  $("#browse-settings-default-root-btn").addEventListener("click", () => openFolderPicker("#settings-default-root", $("#settings-default-root").value));
  $("#folder-picker-parent-btn").addEventListener("click", () => {
    if (state.folderPicker.parentPath) loadFolderPickerPath(state.folderPicker.parentPath);
  });
  $("#folder-picker-refresh-btn").addEventListener("click", () => loadFolderPickerPath(state.folderPicker.currentPath));
  $("#folder-picker-new-btn").addEventListener("click", createFolderInPicker);
  $("#folder-picker-cancel-btn").addEventListener("click", closeFolderPicker);
  $("#folder-picker-use-btn").addEventListener("click", usePickedFolder);
  $("#workdir-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") saveWorkdir();
  });
  $("#cancel-rename-session-btn").addEventListener("click", () => closeRenameSessionModal(null));
  $("#confirm-rename-session-btn").addEventListener("click", () => {
    closeRenameSessionModal($("#rename-session-name").value.trim());
  });
  $("#rename-session-name").addEventListener("keydown", (event) => {
    if (event.key === "Enter") closeRenameSessionModal($("#rename-session-name").value.trim());
  });
  $("#create-desktop-shortcut-btn").addEventListener("click", createDesktopShortcut);
  $("#deny-permission-btn").addEventListener("click", () => closePermissionModal(false));
  $("#allow-once-btn").addEventListener("click", () => closePermissionModal(true));

  document.addEventListener("keydown", (event) => {
    const permissionModal = $("#permission-modal");
    if (permissionModal && !permissionModal.classList.contains("hidden")) {
      if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        closePermissionModal(true);
        return;
      }
    }
    if (event.key === "Escape") {
      closePermissionModal(false);
      closeFolderPicker();
      closeNewSessionModal();
      closeDeleteSessionModal(false);
      closeRenameSessionModal(null);
      closeSettingsModal();
      if ($("#skills-panel")) $("#skills-panel").classList.add("hidden");
    }
  });

  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (state.theme === "system") applyTheme("system");
    });
  }

  window.renameSession = async function(button, event = null) {
    if (event) event.stopPropagation();
    const id = button.dataset.renameSession;
    const item = button.closest(".session-item");
    const currentName = item?.querySelector(".session-name")?.textContent?.trim() || (id === state.sessionId ? state.sessionName : "");
    const nextName = await showRenameSessionModal(currentName);
    if (nextName === null) return;
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName || currentName || id })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(data.detail || `HTTP ${response.status}`);
      }
      if (id === state.sessionId) state.sessionName = data.session?.name || nextName || currentName;
      renderCurrentSession();
      await loadSessionList();
    } catch (err) {
      alert(`重命名失败：${err.message}`);
    }
  };

  document.addEventListener("click", (event) => {
    const renameButton = event.target.closest("[data-rename-session]");
    if (renameButton) renameSession(renameButton, event);
  });

  document.addEventListener("click", async (event) => {
    const fileButton = event.target.closest("[data-file-action]");
    if (fileButton) {
      try {
        await openArtifactPath(fileButton.dataset.filePath || "", fileButton.dataset.fileAction || "open");
      } catch (error) {
        alert(`打开文件失败：${error.message}`);
      }
      return;
    }

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
    if (data.restarting) {
      button.textContent = "正在重启...";
      await waitForAppRestart(info.latest_version || data.version || "");
      return;
    }
    renderUpdateButton();
    if (!data.restarting) {
      alert(data.message || "更新已安装，请重新打开 Viniper UI。");
    }
  } catch (error) {
    $("#update-notes").textContent = `更新失败：${error.message}`;
    button.textContent = oldText;
    button.disabled = false;
    $("#cancel-update-btn").disabled = false;
  }
}

async function waitForAppRestart(expectedVersion = "") {
  const started = Date.now();
  const deadline = started + 90000;
  $("#update-notes").textContent = "更新已安装，正在自动关闭旧服务并重启窗口。";
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1800));
    try {
      const response = await fetch(`/api/status?restart_probe=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) continue;
      const status = await response.json();
      if (!expectedVersion || status.version === expectedVersion) {
        location.reload();
        return;
      }
      $("#update-notes").textContent = `服务已恢复，等待新版本生效：当前 v${status.version}，目标 v${expectedVersion}`;
    } catch {
      $("#update-notes").textContent = "旧服务已关闭，等待新服务启动。";
    }
  }
  $("#update-notes").textContent = "更新已安装，但自动刷新超时。请手动重新打开 Viniper UI。";
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
    { id: "deepseek-v4-pro[1m]", label: "DeepSeek V4 Pro", description: "", context: 1000000 },
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
  const workspace = settings.workspace || {};

  $("#settings-display-name").value = account.display_name || "";
  $("#settings-signed-in").checked = Boolean(account.signed_in);
  renderSettingsOptions($("#settings-language"), state.status?.languages || [], appearance.language || state.language);
  renderSettingsOptions($("#settings-theme"), state.status?.themes || [], appearance.theme || state.theme);
  renderSettingsOptions($("#settings-accent"), state.status?.accents || [], appearance.accent || state.accent);
  renderSettingsOptions($("#settings-shell"), state.status?.shells || [], shell.id || "claude-code");
  $("#settings-default-root").value = workspace.default_root || "";
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
    workspace: {
      default_root: $("#settings-default-root").value.trim()
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

function workspaceDefaultRoot() {
  return state.settings?.workspace?.default_root
    || state.status?.settings?.workspace?.default_root
    || state.workdir
    || "";
}

async function fetchFolderRoots() {
  const response = await fetch("/api/filesystem/roots");
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.detail || "无法读取磁盘列表");
  state.folderPicker.roots = data.roots || [];
  state.folderPicker.defaultRoot = data.default_root || workspaceDefaultRoot();
  return data;
}

function renderFolderRoots() {
  const container = $("#folder-picker-roots");
  const roots = state.folderPicker.roots || [];
  container.innerHTML = roots.map((root) => `
    <button class="ghost-button" type="button" title="${escapeAttr(root.path)}" data-folder-root="${escapeAttr(root.path)}">
      ${escapeHtml(root.name || root.path)}
    </button>
  `).join("");
  container.querySelectorAll("[data-folder-root]").forEach((button) => {
    button.addEventListener("click", () => loadFolderPickerPath(button.dataset.folderRoot || ""));
  });
}

async function openFolderPicker(targetSelector, startPath = "") {
  state.folderPicker.targetSelector = targetSelector;
  $("#folder-picker-modal").classList.remove("hidden");
  $("#folder-picker-list").innerHTML = `<div class="folder-empty">正在读取文件夹</div>`;
  try {
    await fetchFolderRoots();
    renderFolderRoots();
    await loadFolderPickerPath(startPath || workspaceDefaultRoot() || state.folderPicker.defaultRoot);
  } catch (error) {
    $("#folder-picker-list").innerHTML = `<div class="folder-empty">读取失败：${escapeHtml(error.message)}</div>`;
  }
}

function closeFolderPicker() {
  $("#folder-picker-modal").classList.add("hidden");
  state.folderPicker.targetSelector = "";
}

async function loadFolderPickerPath(path) {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  $("#folder-picker-list").innerHTML = `<div class="folder-empty">正在读取文件夹</div>`;
  const response = await fetch(`/api/filesystem/children${query}`);
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.detail || "无法读取文件夹");
  state.folderPicker.currentPath = data.path || "";
  state.folderPicker.parentPath = data.parent || "";
  $("#folder-picker-current").textContent = state.folderPicker.currentPath || "当前目录";
  $("#folder-picker-parent-btn").disabled = !state.folderPicker.parentPath;

  const directories = data.directories || [];
  $("#folder-picker-list").innerHTML = directories.length
    ? directories.map((item) => `
        <button class="folder-item" type="button" title="${escapeAttr(item.path)}" data-folder-path="${escapeAttr(item.path)}">
          <span>${escapeHtml(item.name || item.path)}</span>
          <span class="subtle">打开</span>
        </button>
      `).join("")
    : `<div class="folder-empty">这个目录下没有子文件夹</div>`;
  $("#folder-picker-list").querySelectorAll("[data-folder-path]").forEach((button) => {
    button.addEventListener("click", () => loadFolderPickerPath(button.dataset.folderPath || ""));
  });
}

function usePickedFolder() {
  const target = state.folderPicker.targetSelector ? $(state.folderPicker.targetSelector) : null;
  if (target) target.value = state.folderPicker.currentPath || "";
  closeFolderPicker();
}

async function createFolder(parent, name) {
  const response = await fetch("/api/filesystem/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parent, name })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.detail || "新建文件夹失败");
  return data.path || "";
}

async function createFolderInPicker() {
  const name = prompt("新建文件夹名称");
  if (!name) return;
  try {
    const path = await createFolder(state.folderPicker.currentPath || state.folderPicker.defaultRoot, name);
    await loadFolderPickerPath(path);
  } catch (error) {
    alert(`新建文件夹失败：${error.message}`);
  }
}

async function createDefaultFolderForInput(targetSelector) {
  const name = prompt("新建文件夹名称");
  if (!name) return;
  try {
    const data = await fetchFolderRoots();
    const path = await createFolder(data.default_root || workspaceDefaultRoot(), name);
    const target = $(targetSelector);
    if (target) target.value = path;
  } catch (error) {
    alert(`新建文件夹失败：${error.message}`);
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

async function createDesktopShortcut() {
  const button = $("#create-desktop-shortcut-btn");
  const panel = $("#diagnostics-panel");
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = "创建中";
  try {
    const response = await fetch("/api/desktop/shortcut", { method: "POST" });
    const data = await response.json();
    if (!response.ok || data.ok === false) {
      throw new Error(data.detail || data.message || `HTTP ${response.status}`);
    }
    button.textContent = "已创建";
    panel.innerHTML = `<div class="diagnostic-row ok"><strong>通过</strong><span>${escapeHtml(data.message || "桌面快捷方式已创建")}</span></div>`;
    setTimeout(() => {
      button.textContent = oldText;
      button.disabled = false;
    }, 1200);
  } catch (error) {
    button.textContent = oldText;
    button.disabled = false;
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

function persistSelectedModel() {
  clearTimeout(modelPersistTimer);
  modelPersistTimer = setTimeout(async () => {
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { provider: { model: state.selectedModel } } })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) return;
      if (data.settings) {
        state.settings = data.settings;
        state.status = {
          ...(state.status || {}),
          models: data.models || state.status?.models || [],
          settings: data.settings
        };
      }
    } catch {
      // The current send still uses the selected model; persistence retries on the next change.
    }
  }, 250);
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

function storageRemove(key) {
  localStorage.removeItem(key);
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
  let sessions;
  try {
    const response = await fetch("/api/sessions");
    const data = await response.json();
    sessions = data.sessions || [];
  } catch {
    return;
  }
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
        <button class="mini-button" type="button" title="重命名" data-rename-session="${escapeAttr(session.id)}">✎</button>
        <button class="mini-button danger" type="button" title="删除" data-delete-session="${escapeAttr(session.id)}">×</button>
      </div>
    `;
  }).join("");

  $$("[data-open-session]").forEach((button) => {
    button.addEventListener("click", () => switchSession(button.dataset.openSession));
  });

  $$("[data-delete-session]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const id = button.dataset.deleteSession;
      const item = button.closest(".session-item");
      const title = item?.querySelector(".session-name")?.textContent?.trim() || id;
      if (!(await showDeleteSessionModal(title))) return;
      try {
        const resp = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        if (id === state.sessionId) {
          if (storageGet(LAST_SESSION_KEY) === id) storageRemove(LAST_SESSION_KEY);
          const latest = await fetch("/api/sessions/last").then((r) => r.json()).catch(() => null);
          if (latest?.session?.session_id) {
            applySession(latest.session.session_id, latest.session);
            rememberSession(latest.session.session_id);
            await loadSessionList();
          } else {
            await createSession({ silent: true });
          }
        } else {
          await loadSessionList();
        }
      } catch (err) {
        alert(`删除失败：${err.message}`);
        await loadSessionList();
      }
    });
  });

  $$("[data-rename-session]").forEach((button) => {
    button.addEventListener("click", (event) => renameSession(button, event));
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

function showDeleteSessionModal(title) {
  const modal = $("#delete-session-modal");
  $("#delete-session-copy").textContent = `确定删除“${title}”？这个操作只删除该会话的记录和附件，不会影响其他会话。`;
  modal.classList.remove("hidden");
  $("#cancel-delete-session-btn").focus();
  return new Promise((resolve) => {
    state.pendingDeleteResolver = resolve;
  });
}

function closeDeleteSessionModal(confirmed) {
  const modal = $("#delete-session-modal");
  if (modal) modal.classList.add("hidden");
  if (state.pendingDeleteResolver) {
    const resolve = state.pendingDeleteResolver;
    state.pendingDeleteResolver = null;
    resolve(Boolean(confirmed));
  }
}

function showRenameSessionModal(currentName) {
  const modal = $("#rename-session-modal");
  const input = $("#rename-session-name");
  input.value = currentName || "";
  modal.classList.remove("hidden");
  input.focus();
  input.select();
  return new Promise((resolve) => {
    state.pendingRenameResolver = resolve;
  });
}

function closeRenameSessionModal(value) {
  const modal = $("#rename-session-modal");
  if (modal) modal.classList.add("hidden");
  if (state.pendingRenameResolver) {
    const resolve = state.pendingRenameResolver;
    state.pendingRenameResolver = null;
    resolve(value);
  }
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

function changeWorkdir() {
  $("#workdir-input").value = state.workdir || "";
  $("#workdir-modal").classList.remove("hidden");
  $("#workdir-input").focus();
}

async function saveWorkdir() {
  const next = $("#workdir-input").value.trim();
  $("#workdir-modal").classList.add("hidden");
  if (!state.sessionId) return;
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(state.sessionId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workdir: next })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.detail || `HTTP ${response.status}`);
    }
    state.workdir = data.session?.workdir || next;
    renderCurrentSession();
    await loadSessionList();
  } catch (error) {
    alert(`目录切换失败：${error.message}`);
  }
}

function renderCurrentSession() {
  $("#session-title").textContent = state.sessionName || "新会话";
  $("#workdir-display").textContent = shortenPath(state.workdir);
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
    return messageTemplate(roleClass, label, content, message.thinking || "", message.segments || []);
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

function messageTemplate(roleClass, label, content, thinking = "", segments = []) {
  const displayContent = repairTextForDisplay(content);
  const displayThinking = repairTextForDisplay(thinking);
  const displaySegments = Array.isArray(segments) ? segments : [];
  const body = roleClass === "assistant" && displaySegments.length
    ? renderMessageSegments(displaySegments)
    : (roleClass === "assistant" || roleClass === "error"
      ? renderAssistantContentHtml(displayContent)
      : escapeHtml(displayContent));
  return `
    <article class="message ${roleClass}" data-role="${escapeAttr(roleClass)}">
      <header class="msg-header">${escapeHtml(label)}</header>
      ${displayThinking && roleClass === "assistant" && !displaySegments.length ? renderThinkingPanel(displayThinking) : ""}
      <div class="msg-content">${body}</div>
    </article>
  `;
}

function renderMessageSegments(segments = []) {
  return segments.map((segment) => {
    const type = segment?.type === "thinking" ? "thinking" : "text";
    const content = repairTextForDisplay(segment?.content || "");
    if (!content.trim()) return "";
    return type === "thinking"
      ? renderThinkingPanel(content)
      : `<div class="msg-text-segment">${renderAssistantContentHtml(content)}</div>`;
  }).join("");
}

function renderAssistantContentHtml(text) {
  const value = repairTextForDisplay(text || "");
  return `${renderMarkdown(value)}${renderArtifactCards(value)}`;
}

function createStreamRenderer(article) {
  const container = article.querySelector(".msg-content");
  const segments = [];

  const sync = () => {
    container.innerHTML = renderMessageSegments(segments);
    scrollBottom();
  };

  return {
    append(type, content) {
      const normalizedType = type === "thinking" ? "thinking" : "text";
      const value = repairTextForDisplay(content || "");
      if (!value) return;
      const last = segments[segments.length - 1];
      if (last && last.type === normalizedType) {
        last.content += value;
      } else {
        segments.push({ type: normalizedType, content: value });
      }
      sync();
    },
    replaceWithText(content) {
      segments.length = 0;
      if (content) segments.push({ type: "text", content: repairTextForDisplay(content) });
      sync();
    }
  };
}

const ARTIFACT_EXTENSIONS = "pdf|docx|xlsx|pptx|txt|md|csv|tex|html|png|jpe?g|webp|zip|tar\\.gz";

function normalizeArtifactPath(value) {
  return String(value || "")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[，。；、,;:)）\]]+$/g, "");
}

function extractArtifactPaths(text) {
  const source = String(text || "").replace(/```[\s\S]*?```/g, "");
  const patterns = [
    new RegExp(String.raw`[A-Za-z]:[\\/][^\n\r"'<>|?*]+?\.(?:${ARTIFACT_EXTENSIONS})`, "gi"),
    new RegExp(String.raw`/mnt/[a-z]/[^\n\r"'<>]+?\.(?:${ARTIFACT_EXTENSIONS})`, "gi"),
    new RegExp(String.raw`~?/[^\n\r"'<>]+?\.(?:${ARTIFACT_EXTENSIONS})`, "gi")
  ];
  const seen = new Set();
  const paths = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const path = normalizeArtifactPath(match[0]);
      const key = path.toLowerCase();
      if (path && !seen.has(key)) {
        seen.add(key);
        paths.push(path);
      }
      if (paths.length >= 8) return paths;
    }
  }
  return paths;
}

function artifactName(path) {
  const normalized = String(path || "").replaceAll("\\", "/");
  return normalized.split("/").filter(Boolean).pop() || normalized || "文件";
}

function renderArtifactCards(text) {
  const paths = extractArtifactPaths(text);
  if (!paths.length) return "";
  return `
    <div class="artifact-list">
      ${paths.map((path) => `
        <div class="artifact-card">
          <div class="artifact-main">
            <strong>${escapeHtml(artifactName(path))}</strong>
            <code>${escapeHtml(shortenPath(path))}</code>
          </div>
          <div class="artifact-actions">
            <button class="ghost-button artifact-button" type="button" data-file-action="open" data-file-path="${escapeAttr(path)}">打开</button>
            <button class="ghost-button artifact-button" type="button" data-file-action="reveal" data-file-path="${escapeAttr(path)}">位置</button>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

async function openArtifactPath(path, action = "open") {
  const response = await fetch("/api/files/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, action })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.detail || data.message || `HTTP ${response.status}`);
  }
}

function needsPermissionForPrompt(text, files = []) {
  if (files.length) return true;
  const value = String(text || "").trim();
  if (!value) return false;
  if (PERMISSION_DIRECT_RE.test(value)) return true;
  return PERMISSION_ACTION_RE.test(value) && PERMISSION_TARGET_RE.test(value);
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
  state.followOutput = true;
  state.abortController = new AbortController();
  state.retrySend.count = 0;
  state.retrySend.context = { text, permissionMode, attachments };
  setInputEnabled(false);
  showStopButton(true);
  showThinking(true);

  addMessage("user", attachmentDisplayText(text, attachments));
  const assistantContent = addMessage("assistant", "");
  const assistantArticle = assistantContent.closest(".message");
  const streamRenderer = createStreamRenderer(assistantArticle);
  let fullText = "";
  let thinkingText = "";
  let receivedDone = false;  // track whether we got a "done" SSE event

  // Long-running notice: keep the input locked while the backend task is alive.
  const safetyTimer = setTimeout(() => {
    if (state.isStreaming) {
      showThinking(false);
      if (!fullText) {
        streamRenderer.replaceWithText("(任务仍在运行，我会继续等待；为避免重复执行，先不要再次提交同一条指令。)");
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
        streamRenderer.append("thinking", payload.content || "");
      } else if (payload.type === "text") {
        showThinking(false);
        fullText += payload.content || "";
        streamRenderer.append("text", payload.content || "");
      } else if (payload.type === "error") {
        showThinking(false);
        if (state.cancelRequested) {
          fullText = "已停止当前任务，输入已恢复。";
          streamRenderer.replaceWithText(fullText);
        } else if (
          state.retrySend.count < state.retrySend.max &&
          state.retrySend.context &&
          /上一个任务还在运行/.test(payload.content || "")
        ) {
          state.retrySend.count++;
          const ctx = state.retrySend.context;
          streamRenderer.replaceWithText(`(上个任务刚结束，${state.retrySend.delayMs / 1000} 秒后自动重试…)`);
          setTimeout(() => {
            if (!state.isStreaming) return;
            // Mark streaming as done so retry can proceed
            state.isStreaming = false;
            state.abortController = null;
            doRetrySend(ctx.text, ctx.permissionMode, ctx.attachments);
          }, state.retrySend.delayMs);
        } else {
          fullText = `错误：${payload.content || ""}`;
          streamRenderer.replaceWithText(fullText);
          assistantContent.closest(".message").classList.add("error");
        }
      } else if (payload.type === "heartbeat") {
        showThinking(false);
        if (!fullText) {
          const minutes = Math.max(1, Math.round((Number(payload.elapsed) || 0) / 60));
          const stage = payload.waiting_for === "model" ? "正在等待模型/API 响应" : "正在等待本地工具返回";
          const note = payload.action_task
            ? `动作任务仍在运行，已等待约 ${minutes} 分钟，${stage}。我会继续等；如果你判断它卡住，可以点停止按钮。`
            : `长任务仍在运行，已等待约 ${minutes} 分钟，${stage}。我会保持连接，不会提前打断。`;
          streamRenderer.replaceWithText(`(${note})`);
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
      streamRenderer.replaceWithText(fullText);
    } else {
      fullText = `连接失败：${error.message}`;
      streamRenderer.replaceWithText(fullText);
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

async function doRetrySend(text, permissionMode, attachments = []) {
  if (!state.sessionId) return;

  state.isStreaming = true;
  state.cancelRequested = false;
  state.followOutput = true;
  state.abortController = new AbortController();
  setInputEnabled(false);
  showStopButton(true);

  // Remove the retry-notice bubble
  const lastMsg = document.querySelector(".message:last-of-type");
  if (lastMsg && lastMsg.dataset.role === "assistant") {
    lastMsg.remove();
  }

  const assistantContent = addMessage("assistant", "");
  const assistantArticle = assistantContent.closest(".message");
  const streamRenderer = createStreamRenderer(assistantArticle);
  let fullText = "";
  let receivedDone = false;

  const safetyTimer = setTimeout(() => {
    if (state.isStreaming && !fullText) {
      streamRenderer.replaceWithText("(任务仍在运行，我会继续等待；为避免重复执行，先不要再次提交同一条指令。)");
    }
  }, 120000);

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
      try { payload = JSON.parse(line.slice(6)); } catch { return; }
      if (typeof payload.content === "string") {
        payload.content = repairTextForDisplay(payload.content);
      }
      if (payload.type === "thinking") {
        streamRenderer.append("thinking", payload.content || "");
      } else if (payload.type === "text") {
        fullText += payload.content || "";
        streamRenderer.append("text", payload.content || "");
      } else if (payload.type === "error") {
        if (state.cancelRequested) {
          fullText = "已停止当前任务，输入已恢复。";
        } else {
          fullText = `错误：${payload.content || ""}`;
          assistantContent.closest(".message").classList.add("error");
        }
        streamRenderer.replaceWithText(fullText);
      } else if (payload.type === "done") {
        receivedDone = true;
      }
    };

    const consumeSseBuffer = (final = false) => {
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      if (final && buffer.trim()) { parts.push(buffer); buffer = ""; }
      for (const part of parts) handleSsePart(part);
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) { buffer += decoder.decode(); consumeSseBuffer(true); break; }
      buffer += decoder.decode(value, { stream: true });
      consumeSseBuffer();
    }
  } catch (error) {
    if (error.name !== "AbortError" && !state.cancelRequested) {
      fullText = `连接失败：${error.message}`;
      streamRenderer.replaceWithText(fullText);
      assistantContent.closest(".message").classList.add("error");
    }
  } finally {
    clearTimeout(safetyTimer);
    state.isStreaming = false;
    state.abortController = null;
    state.cancelRequested = false;
    showStopButton(false);
    setInputEnabled(true);
    showThinking(false);
    $("#user-input").focus();
    try { await switchSession(state.sessionId); } catch {}
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
  text = text.replace(/((?:<li>[\s\S]*?<\/li>)+)/g, "<ul>$1</ul>");
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

function isNearChatBottom(threshold = 120) {
  const container = $("#chat-container");
  if (!container) return true;
  return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
}

function scrollBottom({ force = false } = {}) {
  requestAnimationFrame(() => {
    const container = $("#chat-container");
    if (!container) return;
    if (!force && state.isStreaming && !state.followOutput) return;
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
