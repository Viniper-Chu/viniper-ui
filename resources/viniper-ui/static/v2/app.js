import { editRoom } from "./room.js";
import { bindEffortControl, selectedEffort, effortLabel } from "./effort.js";
import { setupFunctionField } from "./function-field.js";
import { setupTooltips } from "./tooltips.js";
import { api, query, state, escape, timeLabel, composerContextUsage } from "./api.js";
import { ui } from "./ui.js";
import { setupNavigator } from "./navigator.js";
import { icon, hydrateIcons } from "./icons.js";
import {
  renderMessages,
  appendMessage,
  paintRun,
  projectEvent,
  updateRail,
  setupConversationScroll,
  jumpToMessage,
  bottom,
  openFile,
  readTerminalOutput,
  toolTitle,
  workingLabel,
  copyAnswer,
  refreshLiveRunStatus,
} from "./conversation.js";
import { option, showMenu, closeMenu, menuContent, sessionMenuContent } from "./menus.js";
import {
  loadExtensions,
  renderExtensions,
  showSkill,
  showPlugin,
  backToExtensions,
  useSelectedSkill,
  editSkill, cancelSkillEdit, saveSkill, skillEditorMode,
} from "./pages.js";
import { loadTasks, renderTasks, taskAction, selectTaskFilter, openTaskEditor, backToTasks, showTask, cancelTaskEdit, saveTask } from "./tasks.js";
import { editModelService, loadSettings, saveSettings, selectSettingsSection, readingSize, setupPreferenceSearch, clearPreferenceSearch, focusPreference, syncSettings, discardSettings } from "./preferences.js";
const $ = (s) => document.querySelector(s);
let switchVersion = 0;
let toastTimer;
let busySending = false;
let submitting = null;
let sessionsVersion = 0;
let busySteering = false;
let busyPermissionAnswer = false;
let lastAnnouncedInteractionKey = "";
let draftDirectory = "";
let switchingTargetId = null;
const UI_SESSION_STORAGE_KEY = "viniper.ui.sessionState.v1";

function announcePolite(text) {
  const el = $("#sr-announcer");
  if (!el || !text) return;
  el.textContent = "";
  setTimeout(() => { el.textContent = text; }, 20);
}

function persistUiSessionState() {
  try {
    const store = globalThis.sessionStorage;
    if (!store) return;
    const drafts = {};
    for (const [k, v] of state.drafts.entries()) {
      if (v) drafts[k] = v;
    }
    store.setItem(UI_SESSION_STORAGE_KEY, JSON.stringify({
      activeSessionId: state.session?.session_id || "",
      draftDirectory,
      drafts,
    }));
  } catch {}
}

function restoreUiSessionState() {
  try {
    const raw = globalThis.sessionStorage?.getItem(UI_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.drafts && typeof parsed.drafts === "object") {
      for (const [k, v] of Object.entries(parsed.drafts)) {
        if (typeof v === "string" && v) state.drafts.set(k, v);
      }
    }
    if (typeof parsed?.draftDirectory === "string" && parsed.draftDirectory) {
      draftDirectory = parsed.draftDirectory;
    }
    return typeof parsed?.activeSessionId === "string" ? parsed.activeSessionId : "";
  } catch {
    return null;
  }
}

function renderQueueItems(items = []) {
  const box = $("#queue");
  if (!box) return;
  box.hidden = !items.length;
  setMarkup(box, items
    .map(
      (item) =>
        `<div class="queued-message" data-queue-id="${escape(item.id)}"><span>${escape(item.text)}</span><button class="icon-button" data-cancel-queue="${escape(item.id)}" aria-label="移除待发送消息">${icon("close")}</button></div>`,
    )
    .join(""));
}

async function refreshQueue(sid = state.session?.session_id) {
  if (!sid) {
    renderQueueItems([]);
    return;
  }
  const queue = await api(`/api/runs/${encodeURIComponent(sid)}/queue`);
  const items = queue.items || queue.queue || [];
  state.queues?.set(sid, items);
  if (state.session?.session_id === sid) renderQueueItems(items);
}

function findPendingAssistant(messages) {
  const visible = (messages || []).filter((m) => m.role === "user" || m.role === "assistant");
  const pendingIndex = visible.findLastIndex((m) => m.role === "assistant" && m.pending);
  if (pendingIndex < 0) return { message: null, node: null };
  const message = visible[pendingIndex];
  const children = [...($("#messages")?.children || [])];
  const byId = message.id
    ? children.find((el) => el.dataset?.messageId === String(message.id))
    : null;
  return { message, node: byId || children[pendingIndex] || null };
}
function setMarkup(element, html) {
  if (element._markup === html) return;
  element.innerHTML = html;
  element._markup = html;
}
export function toast(message, error = false) {
  $("#toast").textContent = message;
  $("#toast").classList.toggle("error", error);
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => ($("#toast").hidden = true),
    error ? 6500 : 3500,
  );
}
export function dialog(
  title,
  body,
  { label = "确定", onSubmit, danger = false } = {},
) {
  closeMenu();
  const d = $("#dialog");
  $("#dialog-title").textContent = title;
  $("#dialog-body").innerHTML = body;
  d.classList.toggle("dialog-form", Boolean(d.querySelector("#dialog-body input,#dialog-body textarea,#dialog-body .form-grid")));
  $("#dialog-actions").innerHTML = onSubmit
    ? `<button class="secondary-button" value="cancel" data-hint="取消并返回  Esc" formnovalidate>取消</button><button class="${danger ? "danger" : "primary"}-button" value="submit" data-hint="${escape(label === "确定" ? title : label)}">${escape(label)}</button>`
    : "";
  d.querySelector("form").onsubmit = async (event) => {
    if (event.submitter?.value !== "submit") return;
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      await onSubmit(new FormData(d.querySelector("form")));
      d.close();
    } catch (error) {
      let alert = d.querySelector("#dialog-body [role=alert]");
      if (!alert) {
        alert = document.createElement("p");
        alert.setAttribute("role", "alert");
        $("#dialog-body").append(alert);
      }
      alert.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  hydrateIcons(d);
  d.showModal();
  d.querySelector("input,textarea")?.focus();
}
const settingsDialog = $("#settings-view");
let settingsOpener = null;

function leaveSettings() {
  if (!settingsDialog.open) return;
  settingsDialog.close();
  if (settingsOpener?.isConnected && settingsOpener.getClientRects().length)
    settingsOpener.focus({ preventScroll: true });
  settingsOpener = null;
}

settingsDialog.addEventListener("keydown", event => {
  if (event.key === "Escape" && !event.isComposing && $("#preference-query").value) {
    event.preventDefault();
    event.stopPropagation();
    clearPreferenceSearch();
    $("#preference-query").focus();
  }
});
settingsDialog.addEventListener("cancel", event => {
  event.preventDefault();
  if ($("#preference-query").value) {
    clearPreferenceSearch();
    $("#preference-query").focus();
  } else leaveSettings();
});
function onSettingsBackdrop(event) {
  if (event.target !== settingsDialog) return false;
  const rect = settingsDialog.getBoundingClientRect();
  return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
}
let pressedBackdrop = false;
settingsDialog.addEventListener("pointerdown", event => { pressedBackdrop = onSettingsBackdrop(event); });
settingsDialog.addEventListener("click", event => {
  if (pressedBackdrop && onSettingsBackdrop(event)) leaveSettings();
  pressedBackdrop = false;
});

export function view(name) {
  if (name === "settings") {
    if (!settingsDialog.open) {
      settingsOpener = document.activeElement;
      closeMenu();
      clearPreferenceSearch();
      settingsDialog.showModal();
      $(".settings-navigation [aria-selected=true]").focus({ preventScroll: true });
      return Promise.resolve(loadSettings()).catch(e => toast(e.message, true));
    }
    return;
  }
  if (settingsDialog.open) leaveSettings();
  if (state.view === "extensions") backToExtensions(false);
  state.view = name;
  $("#return-chat").hidden = name === "chat";
  $("#app").dataset.view = name;
  for (const page of ["chat", "extensions", "tasks"])
    $(`#${page}-view`).hidden = page !== name;
  document
    .querySelectorAll("[data-view]")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  $("#session-title").textContent = name === "chat" ? state.session?.name || "" : "";
  $("#project-button").hidden = name !== "chat" || !state.session;
  $("#session-more").hidden = name !== "chat";
  $("#room-header").hidden = name !== "chat" || !state.session?.discussion;
  closeMenu();
  let loading;
  if (name === "extensions")
    loading = loadExtensions().catch((e) => toast(e.message, true));
  if (name === "tasks") loading = loadTasks().catch((e) => toast(e.message, true));
  if (innerWidth <= 860) $("#app").classList.add("sidebar-collapsed");
  return loading;
}
export async function loadStatus() {
  state.status = await api("/api/status?mode=viniper");
  state.model = state.model || state.status.model;
  state.workdir =
    state.session?.workdir || draftDirectory ||
    state.status.settings?.workspace?.default_root ||
    "";
  state.modelNotice = state.model === state.status.model ? state.status.model_notice : null;
  $("#version").textContent = state.status.version;
  if (!state.session) {
    $("#project-name").textContent =
      state.workdir?.split("/").filter(Boolean).at(-1) || "选择工作目录";
  }
  applyTheme(state.status.settings?.appearance || {});
  syncComposer();
}
async function refreshModelNotice() {
  const selectedModel = state.model;
  const data = await api(`/api/model-notice?${query({ model: selectedModel })}`);
  if (selectedModel !== state.model) return;
  state.modelNotice = data.notice;
  syncComposer();
}
export async function loadSessions() {
  const revision = ++sessionsVersion;
  const data = await api("/api/sessions");
  if (revision !== sessionsVersion) return;
  state.sessions = (data.sessions || []).filter((s) => s.mode === "viniper");
  if (state.session && !state.sessions.some(s => s.id === state.session.session_id) && !state.runs.get(state.session.session_id)?.active) {
    const attachments = state.attachments, skills = state.selectedSkills, mode = state.mode;
    state.drafts.set("new", $("#prompt").value);
    newChat();
    state.attachments = attachments;
    state.selectedSkills = skills;
    state.mode = mode;
    syncComposer();
    toast("会话已移除，未发送的内容已保留在新会话");
  }
  renderSessions();
}
const phases = {
  submitting: ["提交", "正在提交消息", "orbit"],
  notice: ["处理", "正在处理", "orbit"],
  starting: ["准备", "正在连接模型", "orbit"],
  context: ["读入", "正在读入上下文", "orbit"],
  image: ["识图", "正在读取图片", "eye"],
  thinking: ["思考", "正在思考", "dots"],
  "tool-input": ["工具", "正在准备工具调用", "activityTool"],
  tool: ["工具", "正在执行工具", "activityTool"],
  resume: ["继续", "正在接续处理", "orbit"],
  output: ["输出", "正在输出", "activityOutput"],
  waiting: ["待确认", "等待你的确认", "clock"],
  steering: ["引导", "正在按新方向继续", "steer"],
  stopping: ["停止中", "正在停止", "stop"],
};
function activePhase(run, snapshot) {
  const local = run?.active;
  if (!local && (!snapshot?.active || (run?.done && run.runId === snapshot.run_id))) return "";
  const sameRun = snapshot?.active && (!local || snapshot.run_id === run.runId);
  if ((local && run.stopRequested) || (sameRun && snapshot.cancel_requested)) return "stopping";
  if (local ? run.interaction : snapshot.pending_interaction) return "waiting";
  if (local && run.steering?.status === "queued") return "steering";
  const phase = (local && run.phase) || (sameRun && snapshot.activity_phase);
  return Object.hasOwn(phases, phase) ? phase : "starting";
}
function signal(phase) {
  const glyph = phases[phase][2];
  if (glyph === "orbit") return '<i class="spinner"></i>';
  if (glyph === "dots") return '<i class="thought-dots"><b></b><b></b><b></b></i>';
  return icon(glyph);
}
function renderSessions() {
  $("#history-heading").hidden = !state.sessions.length;
  const list = $("#session-list");
  const rows = new Map([...list.querySelectorAll("[data-session-row]")].map(row => [row.dataset.sessionRow, row]));
  const visible = state.sessions;
  visible.forEach((session, index) => {
    const id = session.id, name = session.name || "未命名会话";
    const phase = activePhase(state.runs.get(id), session.active_run);
    const selected = state.session?.session_id === id;
    let row = rows.get(id);
    if (!row) {
      row = document.createElement("div");
      row.className = "session-row";
      row.dataset.sessionRow = id;
      row.innerHTML = `<button class="session-item" data-session="${escape(id)}"><span class="session-state phase-signal" aria-hidden="true"></span><span class="session-copy"><span class="session-name"></span><span class="session-preview" hidden></span></span><span class="session-pin" aria-label="已置顶" hidden>${icon("pin")}</span><small class="session-state-label" hidden></small></button><button class="icon-button session-more" data-session-menu="${escape(id)}" aria-haspopup="menu" aria-expanded="false">${icon("more")}</button>`;
    }
    rows.delete(id);
    if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
    const label = phase ? phases[phase][0] : "";
    const item = row.querySelector(".session-item");
    const preview = session.preview || "";
    const snippet = row.querySelector(".session-preview");
    if (row._preview !== preview) {
      snippet.innerHTML = globalThis.ViniperMarkdown.preview(preview);
      row._preview = preview;
    }
    snippet.hidden = !preview;
    if (row._name !== name) {
      row.querySelector(".session-name").textContent = name;
      row.querySelector(".session-more").setAttribute("aria-label", `会话选项：${name}`);
    }
    if (row._name !== name || row.dataset.phase !== phase) item.dataset.hint = `打开会话：${name}${label ? " · " + label : ""}`;
    row._name = name;
    if (row.dataset.phase !== phase) {
      row.dataset.phase = phase;
      setMarkup(row.querySelector(".session-state"), phase ? signal(phase) : icon(session.discussion ? "discussion" : "chat"));
      const status = row.querySelector(".session-state-label");
      status.textContent = label;
      status.hidden = !phase;
    }
    row.classList.toggle("active", selected);
    item.classList.toggle("active", selected);
    if (selected) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
    row.querySelector(".session-pin").hidden = !session.pinned;
  });
  for (const row of rows.values()) row.remove();
}
export async function selectSession(id) {
  const leavingKey = switchingTargetId || state.session?.session_id || "new";
  rememberDraft(leavingKey);
  switchingTargetId = id;
  const generation = ++switchVersion;
  let session;
  try {
    session = await api(`/api/sessions/${encodeURIComponent(id)}`);
  } finally {
    if (generation === switchVersion) switchingTargetId = null;
  }
  if (generation !== switchVersion) return;
  state.session = session;
  const savedComposer = state.composerDrafts?.get(id);
  const defaultModel = (state.status?.models || []).some((m) => m.id === session.model)
    ? session.model
    : state.status?.model;
  state.model = savedComposer?.model && (state.status?.models || []).some((m) => m.id === savedComposer.model)
    ? savedComposer.model
    : defaultModel;
  state.workdir = session.workdir;
  state.mode = savedComposer?.mode || session.task_mode || "execute";
  state.attachments = savedComposer?.attachments ? [...savedComposer.attachments] : [];
  state.selectedSkills = savedComposer?.selectedSkills ? [...savedComposer.selectedSkills] : [];
  const activeModel = state.status?.models?.find(m => m.id === state.model);
  state.reasoning = selectedEffort(
    activeModel,
    savedComposer?.reasoning ?? (activeModel?.reasoning_options?.includes("auto") ? session.local_reasoning_preference : session.reasoning),
  );
  view("chat");
  $("#project-name").textContent =
    session.workdir?.split("/").filter(Boolean).slice(-1)[0] || "选择工作目录";
  $("#prompt").value = state.drafts.get(id) || "";
  renderQueueItems(state.queues?.get(id) || []);
  void refreshQueue(id).catch(() => {});
  renderMessages(session.messages.map(message =>
    session.active_run?.active && message.pending
      ? { ...message, streaming: true, working: "正在接续输出" }
      : message));
  renderSessions();
  syncComposer();
  persistUiSessionState();
  bottom(true);
  const running = state.runs.get(id);
  if (running?.active) {
    running.node = findPendingAssistant(session.messages).node;
    paintRun(running);
  } else if (session.active_run?.active)
    resumeRun(session).catch((e) => toast(e.message, true));
  await refreshGoalBanner();
}
export function newChat() {
  const leavingKey = switchingTargetId || state.session?.session_id || "new";
  rememberDraft(leavingKey);
  switchingTargetId = null;
  switchVersion++;
  state.session = null;
  const savedNew = state.composerDrafts?.get("new");
  if (savedNew?.model && (state.status?.models || []).some((m) => m.id === savedNew.model)) {
    state.model = savedNew.model;
  }
  state.reasoning = selectedEffort(state.status?.models?.find(m => m.id === state.model), savedNew?.reasoning ?? null);
  state.workdir = savedNew?.workdir || draftDirectory || state.status?.settings?.workspace?.default_root || "";
  state.mode = savedNew?.mode || "execute";
  state.attachments = savedNew?.attachments ? [...savedNew.attachments] : [];
  state.selectedSkills = savedNew?.selectedSkills ? [...savedNew.selectedSkills] : [];
  $("#task-banner").hidden = true;
  renderQueueItems([]);
  view("chat");
  $("#project-name").textContent =
    state.workdir?.split("/").filter(Boolean).slice(-1)[0] || "选择工作目录";
  $("#prompt").value = state.drafts.get("new") || "";
  renderMessages([]);
  renderSessions();
  syncComposer();
  persistUiSessionState();
  $("#prompt").focus();
}
function rememberDraft(targetKey = switchingTargetId || state.session?.session_id || "new") {
  state.drafts.set(targetKey, $("#prompt").value);
  state.composerDrafts?.set(targetKey, {
    attachments: [...state.attachments],
    selectedSkills: [...state.selectedSkills],
    mode: state.mode,
    model: state.model,
    reasoning: state.reasoning,
    workdir: state.workdir,
  });
  persistUiSessionState();
}
export async function ensureSession() {
  if (state.session) return state.session;
  const generation = switchVersion,
    mode = state.mode;
  const data = await api("/api/sessions", {
    method: "POST",
    body: {
      mode: "viniper",
      workdir: state.workdir,
      task_mode: mode,
    },
  });
  const created = { ...data, messages: [], task_mode: mode };
  if (generation === switchVersion) {
    draftDirectory = "";
    state.session = created;
    $("#session-title").textContent = created.name;
  }
  sessionsVersion++;
  state.sessions = [{...created, id:created.session_id}, ...state.sessions.filter(item => item.id !== created.session_id)];
  renderSessions();
  return created;
}

const systemColors = matchMedia("(prefers-color-scheme: dark)");
systemColors.addEventListener("change", () => {
  const appearance = state.status?.settings?.appearance;
  if (!appearance?.theme || appearance.theme === "system") applyTheme(appearance || {});
});

export function applyTheme(appearance) {
  const preference = appearance.theme || "system";
  const theme = preference === "system" ? (systemColors.matches ? "dark" : "light") : preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty("--chat-size", readingSize(appearance.font_size));
  const palette = getComputedStyle(document.documentElement);
  window.viniperDesktop
    ?.setTitlebarTheme({
      color: palette.getPropertyValue("--bg").trim(),
      symbolColor: palette.getPropertyValue("--ink").trim(),
    })
    .catch(() => {});
}
function resizePrompt() {
  const prompt = $("#prompt");
  const layout = `${prompt.clientWidth}:${$("#chat-view").classList.contains("is-empty")}:${prompt.value}`;
  if (prompt._layout !== layout) {
    prompt.style.height = "auto";
    prompt.style.height = Math.min(180, prompt.scrollHeight) + "px";
    prompt._layout = layout;
  }
  const stopping = isStopping();
  const empty = !prompt.value.trim();
  const notice = state.session?.discussion && state.mode === "execute" ? null : state.modelNotice;
  const send = $("#send-button");
  const steer = $("#steer-button");
  send.hidden = send.dataset.icon === "enqueue" && empty;
  send.disabled = busySending || stopping || Boolean(notice) || empty;
  steer.disabled = busySteering || stopping || empty;
  if (stopping) send.dataset.hint = "任务正在停止，请稍候";
  else if (notice) send.dataset.hint = notice.message || "模型暂时不可用";
  else if (empty) send.dataset.hint = "先输入要发送的消息";
  else send.dataset.hint = send.dataset.icon === "enqueue" ? "本轮结束后发送  Enter" : "发送消息  Enter";
  if (stopping) steer.dataset.hint = "任务正在停止，请稍候";
  else if (busySteering) steer.dataset.hint = "正在提交引导";
  else steer.dataset.hint = empty ? "先输入要补充或纠正的方向" : "立即引导当前任务  ⌘Enter";
}
function isStopping() {
  const run = state.runs.get(state.session?.session_id);
  return activePhase(run, state.session?.active_run) === "stopping";
}
export function syncComposer() {
  const run = state.runs.get(state.session?.session_id),
    active = Boolean(run?.active || state.session?.active_run?.active);
  const stopping = isStopping();
  const pending = run?.active ? run.interaction : state.session?.pending_interaction;
  const workspace = state.session?.workdir || state.workdir;
  const group = state.session?.discussion === true && state.mode === "execute";
  const room = state.session?.discussion === true;
  const notice = group ? null : state.modelNotice;
  $("#room-header").hidden = !room || state.view !== "chat";
  $("#room-header").disabled = active || busySending;
  if (room) setMarkup($("#room-header"), icon("discussion") + "群成员 · " + state.session.members.length);
  $("#mention-member").hidden = !group;
  $("#model-button").hidden = group;
  const heading = $("#welcome h1");
  if (heading) heading.textContent = group ? "这道题，一起讨论" : "今天解哪道题？";
  const connectionStatus = $("#connection-status");
  connectionStatus.textContent = notice?.label || (state.status?.configured ? "" : "等待配置模型");
  connectionStatus.hidden = !connectionStatus.textContent;
  $("#model-notice").hidden = !notice;
  $("#model-notice").textContent = notice?.message || "";
  $("#prompt").placeholder = active ? "补充任务要求…" : group ? "向讨论组提问，或点名一位成员…" : "输入题目，或添加题图、讲义…";
  $("#prompt").title = active ? "Enter 排队 · ⌘Enter 引导" : "Enter 发送 · Shift Enter 换行";
  $("#project-button").hidden = state.view !== "chat" || !state.session;
  $("#welcome-project").textContent = workspace?.split(/[\\/]/).filter(Boolean).at(-1) || "选择工作目录";
  const projectHint = "选择工作目录" + (workspace ? " · " + workspace : "");
  $("#project-button").dataset.hint = projectHint;
  $("#welcome-project").parentElement.dataset.hint = projectHint;
  const model = state.status?.models?.find(
    (m) => (m.id || m.value || m.model) === state.model,
  );
  $("#model-label").textContent =
    model?.label || model?.name || state.model || "选择模型";
  state.reasoning = selectedEffort(model, state.reasoning);
  $("#reasoning-label").textContent = effortLabel(state.reasoning);
  const u = composerContextUsage();
  const ratio = Math.max(0, Math.min(1, Number(u.ratio) || 0));
  $("#context-progress").style.strokeDashoffset = 53.407 * (1 - ratio);
  $("#context-button").dataset.hint = u.used_tokens != null && u.context_limit
    ? `上下文 ${Math.round(ratio * 100)}% · ${u.used_tokens} / ${u.context_limit}`
    : "查看上下文用量和容量";
  $("#model-button").disabled = active;
  $("#model-button").dataset.hint = active ? "当前任务结束后可切换模型与智能程度" : "选择模型与智能程度";

  $("#stop-button").hidden = !active;
  $("#stop-button").disabled = stopping;
  $("#stop-button").dataset.hint = stopping ? "正在等待当前任务停止" : "停止当前任务  ⌘.";
  $("#steer-button").hidden = !active;
  const sendGlyph = active ? "enqueue" : "send";
  const sendButton = $("#send-button");
  if (sendButton.dataset.icon !== sendGlyph) {
    sendButton.dataset.icon = sendGlyph;
    sendButton.innerHTML = icon(sendGlyph);
  }
  $("#send-button").setAttribute(
    "aria-label",
    active ? "加入待发送队列" : "发送消息",
  );
  $("#input-hint").hidden = !active;
  $("#input-hint").textContent = stopping ? "停止后可发送下一条消息" : "Enter 排队 · ⌘Enter 引导";
  const phase = submitting?.generation === switchVersion ? "submitting" : activePhase(run, state.session?.active_run);
  const strip = $("#work-indicator");
  strip.hidden = !phase;
  if (phase) {
    const tool = phase === "tool" ? run?.message?.segments?.findLast(s => s.type === "tool_start") : null;
    const toolName = tool?.tool_name || tool?.name;
    const phaseLabel = toolName ? `正在${toolTitle(toolName)}`
      : phase === "notice" && run?.message?.working ? workingLabel(run.message.working) : phases[phase][1];
    const statusLabel = group && run?.message?.speaker ? run.message.speaker + " · " + phaseLabel : phaseLabel;
    const target = tool?.input?.path || tool?.input?.directory || tool?.input?.cwd || "";
    const detail = $("#work-detail");
    detail.textContent = String(target).split(/[\\/]/).filter(Boolean).at(-1) || "";
    detail.hidden = !detail.textContent;
    detail.title = target;
    if (strip.dataset.phase !== phase) {
      strip.dataset.phase = phase;
      setMarkup($("#work-signal"), signal(phase));
    }
    if ($("#work-label").textContent !== statusLabel) $("#work-label").textContent = statusLabel;
    const elapsed = run?.started ? timeLabel(Math.max(0, Math.round((Date.now() - run.started) / 1000))) : "";
    if ($("#work-time").textContent !== elapsed) $("#work-time").textContent = elapsed;
  }
  const sid = state.session?.session_id;
  if (strip._sidebarSession !== sid || strip._sidebarPhase !== phase) {
    strip._sidebarSession = sid;
    strip._sidebarPhase = phase;
    renderSessions();
  }
  $("#mode-chip").hidden =
    state.mode === "execute" && !state.selectedSkills.length;
  const selectionLabel = [state.mode === "plan" ? "规划模式" : state.mode === "goal" ? "目标模式" : "",
    ...state.selectedSkills.map(id => {
      const skill = state.skills.find(s => (s.id || s.filename) === id);
      return skill?.display_name || skill?.name || skill?.command || "已选技能";
    })].filter(Boolean).join(" · ");
  setMarkup($("#mode-chip"),
    `${icon(state.mode === "plan" ? "plan" : state.mode === "goal" ? "target" : "plugin")}<span>${escape(selectionLabel)}</span><button data-action="clear-mode" data-hint="清除已选模式和技能，返回普通对话" aria-label="清除模式与技能">${icon("close")}</button>`);
  $("#attachments").hidden = !state.attachments.length;
  setMarkup($("#attachments"), state.attachments
    .map(
      (a, i) =>
        `<div class="attachment-chip">${icon("file")}<span>${escape(a.name)}</span><button data-remove-attachment="${i}" aria-label="移除附件 ${escape(a.name)}">${icon("close")}</button></div>`,
    )
    .join(""));
  resizePrompt();
  $("#interaction").hidden = !pending;
  if (pending) {
    const interactionKey = `${state.session?.session_id || ""}:${pending.call_id || pending.request_id || ""}`;
    const call = run?.message?.segments?.find(s => s.type === "tool_start" && (s.call_id || s.tool_id) === (pending.call_id || pending.request_id));
    const detail = call?.input?.command || call?.input?.path || pending.summary || pending.description || pending.content || "允许使用此项能力？";
    setMarkup($("#interaction"), `<div class="interaction-copy"><h3>${icon("shield")}允许${escape(toolTitle(pending.tool_name || "此项能力"))}</h3><p>${escape(detail)}</p><small>确认后记住此能力，后续任务直接执行。</small></div><div class="interaction-actions"><button class="secondary-button" data-permission-answer="reject" data-hint="拒绝本次工具调用"${busyPermissionAnswer ? " disabled" : ""}>拒绝</button><button class="primary-button" data-permission-answer="allow-always" data-hint="允许此能力并记住选择"${busyPermissionAnswer ? " disabled" : ""}>允许并记住</button></div>`);
    if (interactionKey !== lastAnnouncedInteractionKey) {
      lastAnnouncedInteractionKey = interactionKey;
      announcePolite(`需要确认权限：允许${toolTitle(pending.tool_name || "此项能力")}`);
      if (document.activeElement === document.body) {
        $("#interaction [data-permission-answer='allow-always']")?.focus({ preventScroll: true });
      }
    }
  } else {
    lastAnnouncedInteractionKey = "";
  }
}
async function send() {
  if (busySending) return;
  if (isStopping()) return toast("正在停止，完成后可继续发送");
  const text = $("#prompt").value.trim();
  if (!text) return;
  const generation = switchVersion,
    originalId = state.session?.session_id || "new";
  const controls = {
    mode: state.mode,
    model: state.model,
    reasoning: state.reasoning,
    skills: [...state.selectedSkills],
    attachments: [...state.attachments],
  };
  const visible = () => generation === switchVersion;
  const clear = () => {
    if (!preview || !state.drafts.get(originalId) || state.drafts.get(originalId).trim() === text) state.drafts.delete(originalId);
    state.composerDrafts?.delete(originalId);
    if (state.session?.session_id) state.composerDrafts?.delete(state.session.session_id);
    if (visible()) {
      if (!preview) $("#prompt").value = "";
      $("#prompt").style.height = "";
      state.attachments = state.attachments.filter(a => !controls.attachments.includes(a));
      syncComposer();
    }
    if (typeof persistUiSessionState === "function") persistUiSessionState();
  };
  const alreadyActive = state.runs.get(originalId)?.active || state.session?.active_run?.active;
  const preview = !alreadyActive && controls.mode !== "goal" ? newRun(originalId, null) : null;
  busySending = true;
  if (preview) {
    submitting = {generation};
    appendMessage({role:"user", content:text});
    preview.node = appendMessage(preview.message);
    $("#prompt").value = "";
    syncComposer();
    bottom(true);
  }
  try {
    const session = await ensureSession(),
      sid = session.session_id;
    if (preview) preview.sessionId = sid;
    const existing = state.runs.get(sid);
    if (existing?.active || session.active_run?.active) {
      await api(`/api/runs/${sid}/queue`, {
        method: "POST",
        body: {
          mode: "viniper",
          message: text,
          attachments: controls.attachments,
        },
      });
      clear();
      if (typeof refreshQueue === "function") void refreshQueue(sid).catch(() => {});
      toast("已加入待发送队列");
      return;
    }
    if (controls.mode === "goal") {
      const result = await api("/api/goals", {
        method: "POST",
        body: {
          mode: "viniper",
          session_id: sid,
          title: text.slice(0, 80),
          prompt: text,
          model: controls.model,
          reasoning: controls.reasoning,
          skills: controls.skills,
          attachments: controls.attachments,
        },
      });
      await api(`/api/goals/${result.goal.id}`, {
        method: "PATCH",
        body: { action: "continue" },
      });
      clear();
      if (visible()) await refreshGoalBanner();
      toast("目标已开始，可随时暂停");
      return;
    }
    const payload = {
      mode: "viniper",
      message: text,
      model: controls.model,
      reasoning: controls.reasoning,
      task_mode: controls.mode,
      skills: controls.skills,
      attachments: controls.attachments,
    };
    const response = await fetch(`/api/runs/${sid}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "发送失败");
    }
    clear();
    const run = preview || newRun(sid, null);
    submitting = null;
    run.sessionId = sid;
    run.runId = response.headers.get("X-Viniper-Run-Id");
    run.phase = "starting";
    run.message.planned = controls.mode === "plan";
    state.runs.set(sid, run);
    if (visible()) {
      if (!preview) {
        appendMessage({ role: "user", content: text });
        run.node = appendMessage(run.message);
      }
      syncComposer();
      bottom(true);
    }
    void consume(response, run);
  } catch (error) {
    if (preview) {
      if (visible()) {
        renderMessages(state.session?.messages || []);
        $("#prompt").value = [text, $("#prompt").value].filter(Boolean).join("\n");
        rememberDraft();
      } else {
        const key = preview.sessionId;
        state.drafts.set(key, [text, state.drafts.get(key)].filter(Boolean).join("\n"));
      }
    }
    toast(error.message, true);
  } finally {
    submitting = null;
    busySending = false;
    syncComposer();
  }
}

function newRun(sessionId, runId) {
  return {
    sessionId,
    runId,
    active: true,
    sequence: 0,
    started: Date.now(),
    message: {
      role: "assistant",
      content: "",
      thinking: "",
      segments: [],
      streaming: true,
      elapsed: 0,
    },
    node: null,
    interaction: null,
  };
}
async function resumeRun(session) {
  const sid = session.session_id;
  if (state.runs.get(sid)?.active) return;
  const snapshot = session.active_run;
  const run = newRun(sid, snapshot.run_id);
  const { message: last, node: pendingNode } = findPendingAssistant(session.messages);
  run.guidanceIds = new Set((session.messages || []).map(message => message.guidance_id).filter(Boolean));
  if (last?.role === "assistant") {
    run.message = { ...run.message, ...last, streaming: true };
    run.message.elapsed = Number(
      last.elapsed_seconds ?? last.elapsed ?? last.turn_usage?.elapsed_seconds ?? 0,
    );
    run.started -= run.message.elapsed * 1000;
    run.node = pendingNode;
  }
  if (snapshot.turn_started_at > 0) run.started = snapshot.turn_started_at * 1000;
  run.phase = snapshot.activity_phase;
  run.sequence = snapshot.sequence || 0;
  run.stopRequested = Boolean(snapshot.cancel_requested);
  run.message.stopping = run.stopRequested;
  run.interaction = snapshot.pending_interaction;
  state.runs.set(sid, run);
  const response = await fetch(
    `/api/runs/${sid}/events?${query({ run_id: run.runId, after_sequence: snapshot.sequence || 0 })}`,
  );
  if (!response.ok) throw new Error("无法恢复正在进行的任务");
  syncComposer();
  void consume(response, run);
}
async function consume(response, run) {
  const renderer = globalThis.AgentStream.createRenderScheduler();
  let current = response;
  try {
    while (current && !run.done) {
      let streamError = null;
      try {
        if (!current.body) throw new Error("未收到流式响应体");
        await globalThis.AgentStream.readJsonEvents(current.body, (event) => {
          projectEvent(run, event);
          const isPermRequest = event?.type === "permission_request" || event?.type === "interaction_request";
          if (isPermRequest && typeof announcePolite === "function") {
            announcePolite(`需要确认工具权限：${event.tool_name || "工具操作"}`);
          }
          renderer.schedule(run.sessionId, () => {
            paintRun(run);
            if (state.session?.session_id === run.sessionId) {
              syncComposer();
              if (isPermRequest && document.activeElement !== $("#prompt")) {
                document.querySelector('[data-permission-answer="allow_once"], [data-permission-answer]')?.focus({ preventScroll: true });
              }
            }
            else if (run.sidebarPhase !== activePhase(run)) {
              run.sidebarPhase = activePhase(run);
              renderSessions();
            }
          });
        });
      } catch (error) {
        streamError = error;
      }
      if (run.done) break;
      let nextResponse = null;
      let lastError = streamError;
      const delays = [0, 400, 900, 1800, 3200, 5000, 7000, 8000];
      for (const delay of delays) {
        if (run.done) break;
        if (delay > 0) {
          run.phase = "resume";
          run.message.working = "连接波动，正在重连…";
          paintRun(run);
          if (state.session?.session_id === run.sessionId) syncComposer();
          await new Promise((r) => setTimeout(r, delay));
        }
        try {
          const result = await globalThis.AgentStream.confirmRunState(
            fetch,
            run.sessionId,
            run.runId,
          );
          if (result.kind === "active") {
            const candidate = await fetch(
              `/api/runs/${encodeURIComponent(run.sessionId)}/events?${query({ run_id: run.runId, after_sequence: run.sequence })}`,
            );
            if (!candidate.ok || !candidate.body) throw new Error(`重连失败 (${candidate.status})`);
            nextResponse = candidate;
            break;
          }
          if (result.kind === "terminal" || result.kind === "replaced") {
            run.done = true;
            break;
          }
        } catch (err) {
          lastError = err;
        }
      }
      if (run.done) break;
      if (nextResponse) {
        current = nextResponse;
        continue;
      }
      if (lastError) throw lastError;
      break;
    }
  } catch (error) {
    run.error = true;
    const text = `\n\n连接中断：${error.message}`;
    run.message.content += text;
    run.message.segments.push({ type: "text", content: text });
    toast(error.message, true);
  } finally {
    renderer.flush(run.sessionId);
    run.active = false;
    run.message.streaming = false;
    run.message.elapsed =
      run.message.elapsed || Math.round((Date.now() - run.started) / 1000);
    paintRun(run);
    if (state.session?.session_id === run.sessionId) {
      state.session.active_run = null;
      syncComposer();
      try {
        const updated = await api(`/api/sessions/${run.sessionId}`);
        if (state.session?.session_id === run.sessionId) {
          state.session = updated;
          renderMessages(updated.messages, { preserveView: true });
          syncComposer();
        }
      } catch {}
    }
    void loadSessions();
    if (typeof announcePolite === "function") {
      announcePolite(run.error ? "任务未完成" : run.message.cancelled ? "任务已停止" : "任务已完成");
    }
    window.viniperDesktop?.conversationCompleted();
  }
}
async function steer() {
  if (busySteering) return;
  const text = $("#prompt").value.trim();
  if (!text) {
    $("#prompt").focus();
    toast("输入要补充或纠正的方向，再点“引导”");
    return;
  }
  const sid = state.session?.session_id,
    generation = switchVersion;
  if (!sid) return;
  busySteering = true;
  syncComposer();
  try {
    await api(`/api/runs/${sid}/guidance`, {
      method: "POST", body: { message: text },
    });
    if (generation === switchVersion && $("#prompt").value.trim() === text) $("#prompt").value = "";
    toast("引导已发送，正在按新方向继续");
  } finally {
    busySteering = false;
    syncComposer();
  }
}

async function stop() {
  const sid = state.session?.session_id;
  if (!sid || isStopping()) return;
  const run = state.runs.get(sid);
  if (run) {
    run.stopRequested = true;
    run.message.stopping = true;
    paintRun(run);
  }
  syncComposer();
  try {
    await api(`/api/runs/${sid}/cancel`, { method: "POST", body: {} });
  } catch (error) {
    if (run) {
      run.stopRequested = false;
      run.message.stopping = false;
      paintRun(run);
    }
    throw error;
  } finally {
    if (state.session?.session_id === sid) syncComposer();
  }
}
async function permissionAnswer(action) {
  if (busyPermissionAnswer) return;
  const sid = state.session?.session_id,
    run = sid ? state.runs.get(sid) : null,
    pending = run?.interaction || state.session?.pending_interaction;
  if (!sid || !pending) return;
  busyPermissionAnswer = true;
  syncComposer();
  try {
    await api(`/api/runs/${sid}/interaction`, {
      method: "POST",
      body: {
        action,
        call_id: pending.call_id || pending.request_id,
        run_id: run?.runId || state.session.active_run?.run_id,
      },
    });
    if (run) run.interaction = null;
    if (state.session?.session_id === sid) state.session.pending_interaction = null;
  } finally {
    busyPermissionAnswer = false;
    syncComposer();
  }
}
async function project() {
  const current = state.session?.workdir || state.workdir;
  const native = window.viniperDesktop?.chooseProject;
  const set = async (workdir) => {
    if (!workdir) return;
    state.workdir = workdir;
    if (!state.session) draftDirectory = workdir;
    if (state.session) {
      await api(`/api/sessions/${state.session.session_id}`, {
        method: "PUT",
        body: { workdir },
      });
      state.session.workdir = workdir;
    }
    $("#project-name").textContent = workdir.split("/").filter(Boolean).at(-1);
    syncComposer();
  };
  if (native) {
    await set(await native());
    return;
  }
  dialog(
    "选择工作目录",
    `<label class="field">目录路径<input name="path" value="${escape(current)}" required></label>`,
    { onSubmit: (data) => set(String(data.get("path"))) },
  );
}
function sessionTarget(id = state.session?.session_id) {
  return state.sessions.find(session => session.id === id) ||
    (state.session?.session_id === id ? state.session : null);
}
function openSessionMenu(button, id) {
  const session = sessionTarget(id);
  if (session) showMenu(button, sessionMenuContent(session), { kind: "session" });
}
async function rename(id = state.session?.session_id) {
  const session = sessionTarget(id);
  if (!session) return;
  dialog(
    "重命名会话",
    `<label class="field">会话名称<input name="name" value="${escape(session.name)}" required maxlength="160"></label>`,
    {
      onSubmit: async (data) => {
        const name = String(data.get("name") || "").trim();
        if (!name) throw new Error("请输入会话名称");
        await api(`/api/sessions/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: { name },
        });
        if (state.session?.session_id === id) {
          state.session.name = name;
          if (state.view === "chat") $("#session-title").textContent = name;
        }
        await loadSessions();
      },
    },
  );
}
async function pinSession(id = state.session?.session_id) {
  const session = sessionTarget(id);
  if (!session) return;
  const pinned = !session.pinned;
  await api(`/api/sessions/${encodeURIComponent(id)}`, { method: "PUT", body: { pinned } });
  if (state.session?.session_id === id) state.session.pinned = pinned;
  await loadSessions();
  toast(pinned ? "已置顶会话" : "已取消置顶");
}
async function deleteSession(id = state.session?.session_id) {
  const session = sessionTarget(id);
  if (!session) return;
  if (state.runs.get(id)?.active || session.active_run?.active)
    return toast("请先停止正在运行的任务，再删除会话", true);
  dialog("删除会话", `<p>删除“${escape(session.name)}”及其会话记录？项目文件会保留。</p>`, {
    label: "删除", danger: true,
    onSubmit: async () => {
      await api(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      state.runs.delete(id);
      state.composerDrafts?.delete(id);
      state.queues?.delete(id);
      // loadSessions preserves any unsent input if this was the current chat.
      await loadSessions();
      state.drafts.delete(id);
      if (typeof persistUiSessionState === "function") persistUiSessionState();
    },
  });
}
async function showPlan() {
  if (!state.session) {
    toast("先创建一个会话");
    return;
  }
  const plan = await api(
    `/api/plans?${query({ session_id: state.session.session_id })}`,
  );
  dialog(
    "任务计划",
    plan.steps?.length
      ? `<ol>${plan.steps.map((s) => `<li>${escape(s.title)} <small>${{ completed: "已完成", in_progress: "进行中", pending: "待处理" }[s.status] || s.status}</small></li>`).join("")}</ol>`
      : "<p>当前还没有计划。可以在输入框的 + 菜单中选择“规划模式”。</p>",
  );
}
export async function refreshGoalBanner() {
  if (!state.session) {
    $("#task-banner").hidden = true;
    return;
  }
  const sid = state.session.session_id;
  const result = await api(
    `/api/goals?${query({ session_id: sid, mode: "viniper" })}`,
  );
  if (state.session?.session_id !== sid) return;
  const goal = result.goals?.find((g) => g.status !== "complete");
  $("#task-banner").hidden = !goal;
  if (goal)
    $("#task-banner").innerHTML =
      `${icon("target")}<div><strong>${escape(goal.title)}</strong><small>${escape(goal.current_step || goal.runtime_status)}</small></div><button class="text-button" data-goal-id="${goal.id}" data-task-action="${goal.status === "active" ? "stop" : "continue"}">${goal.status === "active" ? "暂停" : "继续"}</button><button class="icon-button" data-goal-id="${goal.id}" data-task-action="delete" aria-label="移除目标">${icon("close")}</button>`;
}
async function handleMenu(action, value) {
  closeMenu();
  if (action === "copy-message") {
    const message = document.getElementById(value)?._message;
    if (message) {
      await navigator.clipboard.writeText(message.role === "assistant" ? copyAnswer(message) : message.content);
      toast("已复制");
    }
    return;
  }
  if (action === "save-prompt-skill" || action === "schedule-prompt") {
    const message = document.getElementById(value)?._message;
    if (message?.role !== "user" || !message.content?.trim()) return;
    if (action === "schedule-prompt") {
      view("tasks");
      openTaskEditor(true, message.content);
    } else {
      dialog("保存为我的技能", `<label class="field">名称<input name="name" maxlength="60" required></label>
        <label class="field">适用场景<input name="description" maxlength="180" required></label>
        <label class="field">操作步骤<textarea name="instructions" rows="6" maxlength="24000" required>${escape(message.content)}</textarea></label>`,
        {label:"保存技能", onSubmit:async form => {
          await api("/api/skills", {method:"POST", body:Object.fromEntries(form)});
          toast("已保存到技能与插件");
        }});
    }
    return;
  }
  if (action === "new-discussion" || action === "room-members") {
    const room = action === "room-members" ? state.session : null;
    const workdir = state.workdir, generation = switchVersion;
    editRoom(dialog, room, state.status?.models || [], state.model, async fields => {
      const result = room
        ? await api("/api/sessions/" + room.session_id, {method:"PUT",body:fields})
        : await api("/api/sessions", {method:"POST",body:{...fields,mode:"viniper",discussion:true,workdir}});
      if (generation === switchVersion) {
        if (!room) { state.attachments = []; state.selectedSkills = []; }
        await selectSession(room?.session_id || result.session_id);
      }
      await loadSessions();
    });
    return;
  }
  if (action === "mention") {
    const input = $("#prompt");
    const start = input.selectionStart, end = input.selectionEnd;
    const before = input.value.slice(0,start);
    input.setRangeText((before.endsWith("@") ? "" : (before && !/\s$/.test(before) ? " @" : "@")) + value + " ",start,end,"end");
    input.focus(); rememberDraft(); resizePrompt(); return;
  }
  if (action === "attach") $("#file-input").click();
  else if (action === "mode") {
    state.mode = state.mode === value ? "execute" : value;
    rememberDraft();
    syncComposer();
    $("#prompt").focus();
  } else if (action === "model") {
    if (state.status?.models.find(m => m.id === value)?.credential_mode === "discussion" && !state.status.discussion_cloud_configured) {
      openPreference("connection-settings", "discussion-key"); return;
    }
    state.model = value;
    const nextModel = state.status.models.find(m => m.id === value);
    state.reasoning = selectedEffort(nextModel, nextModel?.reasoning_options?.includes("auto") ? state.session?.local_reasoning_preference : state.reasoning);
    rememberDraft();
    await refreshModelNotice();
    const sid = state.session?.session_id;
    syncComposer();
    if (sid) {
      const data = await api(
        `/api/sessions/${sid}/usage?${query({ model: value })}`,
      );
      if (state.session?.session_id === sid && state.model === value) {
        state.session.context_usage = data.usage;
        syncComposer();
      }
    }

  } else if (action === "connection-settings") openPreference("connection-settings");
  else if (action === "extensions") view("extensions");
  else if (action === "rename") await rename(value || undefined);
  else if (action === "pin-session") await pinSession(value || undefined);
  else if (action === "delete-session") await deleteSession(value || undefined);
  else if (action === "open-project")
    await openFile(state.session?.workdir || state.workdir);
  else if (action === "plan") await showPlan();
  else await dispatch(action);
}
function applyStarter(button) {
  view("chat");
  const prompt = $("#prompt");
  const start = prompt.selectionStart, end = prompt.selectionEnd;
  const before = prompt.value.slice(0, start), after = prompt.value.slice(end);
  const separatorBefore = before && !before.endsWith("\n") ? "\n" : "";
  const separatorAfter = after && !after.startsWith("\n") ? "\n" : "";
  prompt.setRangeText(separatorBefore + button.dataset.prompt + separatorAfter, start, end, "end");
  resizePrompt(); rememberDraft(); syncComposer(); prompt.focus();
}
function openPreference(section, field) {
  const loading = view("settings") || ($("#settings-fields").disabled ? loadSettings() : null);
  selectSettingsSection(section);
  Promise.resolve(loading).then(() => {
    if (!settingsDialog.open || document.getElementById(section).hidden) return;
    if (field) focusPreference(field);
    else document.querySelector('[aria-controls="' + section + '"]').focus();
  }).catch(() => {});
}
setupPreferenceSearch(openPreference);
async function openRecord(kind, id) {
  const target = ["skills","plugins"].includes(kind) ? "extensions" : "tasks";
  await view(target);
  if (state.view !== target) return;
  if (!state[kind].some(record => record.id === id)) return toast("这项内容已变更，请重新查找", true);
  if (kind === "skills") return showSkill(id);
  if (kind === "plugins") return showPlugin(id);
  return showTask(kind,id);
}
const navigate = setupNavigator({ openRecord, openPreference, selectSession, view, newChat, jumpToMessage, openFile, closeMenu, toast, applyStarter });
async function dispatch(action) {
  if (action === "quick" || action === "turn-index") return navigate(action);
  if (action === "leave-settings") return leaveSettings();
  if (action === "add-model-service") return editModelService();
  if (action === "send") return send();
  if (action === "steer") return steer();
  if (action === "stop") return stop();
  if (action === "new-chat") return newChat();
  if (action === "new-discussion" || action === "room-members") return handleMenu(action);
  if (action === "mentions" || action === "type-mention") {
    const members = state.session?.members || [];
    showMenu(action === "type-mention" ? $("#prompt") : $("#mention-member"), members.map(m => option({label:"@" + m.name,detail:m.role,image:"model",action:"mention",value:m.name})).join("") + option({label:"@全体",image:"discussion",action:"mention",value:"全体"}));
    return;
  }
  if (action === "new-goal") {
    newChat();
    state.mode = "goal";
    syncComposer();
    return;
  }
  if (action === "project") return project();
  if (action === "rename") return rename();
  if (action === "bottom") return bottom(true);
  if (action === "toggle-sidebar")
    return $("#app").classList.toggle("sidebar-collapsed");
  if (action === "back-tasks") return backToTasks();
  if (action === "cancel-task-edit") return cancelTaskEdit();
  if (action === "edit-skill") return editSkill();
  if (action === "cancel-skill-edit") return cancelSkillEdit();
  if (action === "back-extensions") return backToExtensions();
  if (action === "use-skill") return useSelectedSkill();
  if (action === "refresh-tasks") return loadTasks();
  if (action === "reload-settings") return loadSettings();
  if (action === "discard-settings") return discardSettings();
  if (action === "refresh-extensions") return loadExtensions(true);
  if (action === "toggle-skills") {
    state.showAllSkills = !state.showAllSkills;
    return renderExtensions();
  }
  if (action === "new-schedule") return openTaskEditor(true);
  if (action === "clear-mode") {
    state.mode = "execute";
    state.selectedSkills = [];
    rememberDraft();
    return syncComposer();
  }
  if (action === "implement-plan") {
    state.mode = "execute";
    syncComposer();
    $("#prompt").value = "按刚才的计划开始实施，完成后验证结果。";
    rememberDraft();
    resizePrompt();
    $("#prompt").focus();
  }
}
async function click(event) {
  const b = event.target.closest("button,a");
  if (!b) return;
  try {
    if (b.dataset.modelService) return editModelService(b.dataset.modelService);
    if (b.hasAttribute("data-message-menu")) {
      const article = b.closest(".message"), value = article.id, message = article._message;
      let actions = option({label:"复制文本",image:"copy",action:"copy-message",value});
      if (message.role === "user") {
        actions += option({label:"保存为技能",image:"book",action:"save-prompt-skill",value})
          + option({label:"设为定时任务",image:"clock",action:"schedule-prompt",value});
      } else if (state.session?.members?.some(m => m.name === message.speaker)) {
        actions += option({label:"回复 " + message.speaker,image:"chat",action:"mention",value:message.speaker});
      }
      showMenu(b, actions, {kind:"session"});
      return;
    }
    if (b.dataset.skillMode) return skillEditorMode(b.dataset.skillMode);
    if (b.dataset.recordId) return showTask(b.dataset.recordKind,b.dataset.recordId);
    if (b.dataset.taskFilter) return selectTaskFilter(b.dataset.taskFilter);
    if (b.dataset.extensionFilter) {
      state.extensionFilter = b.dataset.extensionFilter;
      renderExtensions();
      return;
    }
    if (b.dataset.settingsSection) {
      selectSettingsSection(b.dataset.settingsSection);
      return;
    }
    if (b.dataset.cancelQueue) {
      const sid = state.session?.session_id;
      if (!sid) {
        renderQueueItems([]);
        return;
      }
      await api(
        `/api/runs/${encodeURIComponent(sid)}/queue/${encodeURIComponent(b.dataset.cancelQueue)}`,
        { method: "DELETE" },
      );
      const nextItems = (state.queues?.get(sid) || []).filter(item => String(item.id) !== b.dataset.cancelQueue);
      state.queues?.set(sid, nextItems);
      b.closest(".queued-message")?.remove();
      $("#queue").hidden = !$("#queue").children.length;
      return;
    }
    if (b.dataset.view) {
      view(b.dataset.view);
      return;
    }
    if (b.dataset.session) {
      await selectSession(b.dataset.session);
      return;
    }
    if (b.dataset.sessionMenu) {
      openSessionMenu(b, b.dataset.sessionMenu);
      return;
    }
    if (b.dataset.menu) {
      showMenu(b, menuContent(b.dataset.menu));
      return;
    }
    if (b.dataset.menuAction) {
      await handleMenu(b.dataset.menuAction, b.dataset.value);
      return;
    }
    if (b.dataset.action) {
      await dispatch(b.dataset.action);
      return;
    }
    if (b.dataset.copy !== undefined) {
      await navigator.clipboard.writeText(b.dataset.copy);
      toast("已复制");
      return;
    }
    if (b.dataset.terminal) {
      await readTerminalOutput(b);
      return;
    }
    if (b.dataset.file) {
      event.preventDefault();
      await openFile(b.dataset.file);
      return;
    }
    if (b.tagName === "A") {
      const href = b.getAttribute("href");
      if (/^https?:/i.test(href)) {
        event.preventDefault();
        if (window.viniperDesktop?.openExternal)
          await window.viniperDesktop.openExternal(href);
        else window.open(href, "_blank", "noopener");
      }
      return;
    }
    if (b.dataset.jump) {
      jumpToMessage(b.dataset.jump);
      return;
    }
    if (b.dataset.prompt) {
      applyStarter(b);
      return;
    }
    if (b.dataset.removeAttachment !== undefined) {
      state.attachments.splice(Number(b.dataset.removeAttachment), 1);
      rememberDraft();
      syncComposer();
      return;
    }
    if (b.dataset.permissionAnswer) {
      await permissionAnswer(b.dataset.permissionAnswer);
      return;
    }
    if (b.dataset.skill) {
      await showSkill(b.dataset.skill);
      return;
    }
    if (b.dataset.plugin) {
      showPlugin(b.dataset.plugin);
      return;
    }
    if (b.dataset.taskAction) {
      await taskAction(
        b.dataset.taskAction,
        b.dataset.goalId,
        b.dataset.scheduleId,
      );
      await refreshGoalBanner();
      return;
    }
  } catch (error) {
    toast(error.message, true);
  }
}
Object.assign(ui, { toast, dialog, view, syncComposer, loadStatus });
document.addEventListener("click", click);
$("#session-list").addEventListener("contextmenu", (event) => {
  const row = event.target.closest("[data-session-row]");
  if (!row) return;
  event.preventDefault();
  openSessionMenu(row.querySelector("[data-session-menu]"), row.dataset.sessionRow);
});

$("#task-search").addEventListener("input", renderTasks);
$("#task-edit-form").addEventListener("submit",event => { event.preventDefault(); saveTask().catch(error => toast(error.message,true)); });
$("#skill-edit-form").elements.content.addEventListener("invalid", () => skillEditorMode("source"));
$("#skill-edit-form").addEventListener("submit",event => { event.preventDefault(); saveSkill().catch(error => toast(error.message,true)); });
$("#extension-search").addEventListener("input", renderExtensions);
$(".settings-navigation").addEventListener("keydown", event => {
  const tabs = [...event.currentTarget.querySelectorAll('[role="tab"]')];
  const index = tabs.indexOf(event.target);
  if (index < 0 || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 :
    (index + tabs.length + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1)) % tabs.length;
  selectSettingsSection(tabs[next].dataset.settingsSection);
  tabs[next].focus();
});
$("#settings-form").addEventListener("input", () => syncSettings());
$("#settings-form").addEventListener("change", () => syncSettings());
$("#browse-workdir").addEventListener("click", async () => {
  try {
    const directory = await window.viniperDesktop.chooseProject();
    if (directory) {
      $("#settings-form").elements.workdir.value = directory;
      syncSettings();
    }
  } catch (error) { toast(error.message, true); }
});
$("#settings-form").addEventListener("invalid", event => {
  const panel = event.target.closest('[role="tabpanel"]');
  if (panel?.hidden) selectSettingsSection(panel.id);
}, true);
$("#settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  saveSettings().catch((error) => toast(error.message, true));
});
$("#prompt").addEventListener("input", event => {
  if (!event.isComposing && event.data === "@" && state.session?.discussion && state.mode === "execute"
      && /(?:^|\s)@$/.test(event.target.value.slice(0,event.target.selectionStart))) dispatch("type-mention");
  rememberDraft();
  resizePrompt();
});
$("#prompt").addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    ((event.metaKey || event.ctrlKey) &&
    state.runs.get(state.session?.session_id)?.active
      ? steer()
      : send()
    ).catch((error) => toast(error.message, true));
  }
});
document.addEventListener("keydown", (event) => {
  if (event.isComposing || document.querySelector("dialog[open]")) return;
  if (event.key === "Escape" && state.view === "tasks" && $("#task-catalog").hidden) {
    event.preventDefault();
    if ($("#task-editor").hidden) backToTasks(); else cancelTaskEdit();
    return;
  }
  if (event.key === "Escape" && state.view === "extensions" && !$("#skill-editor").hidden) {
    event.preventDefault(); cancelSkillEdit(); return;
  }
  if (event.key === "Escape" && state.view === "extensions" && !$("#extension-detail").hidden) {
    event.preventDefault();
    backToExtensions();
    return;
  }
  if (
    ((event.metaKey || event.ctrlKey) && event.key === ".")
    || (event.key === "Escape" && state.view === "chat" && $("#popover").hidden && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName))
  ) {
    const activeRun = state.runs.get(state.session?.session_id);
    if ((activeRun?.active || state.session?.active_run?.active) && !isStopping()) {
      event.preventDefault();
      stop().catch((error) => toast(error.message, true));
      return;
    }
  }
  if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "k") {
    event.preventDefault(); navigate("quick"); return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    newChat();
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
    event.preventDefault();
    $("#app").classList.toggle("sidebar-collapsed");
  }
  if ((event.metaKey || event.ctrlKey) && event.key === ",") {
    event.preventDefault();
    view("settings");
  }
});
$("#file-input").addEventListener("change", async () => {
  try {
    for (const file of $("#file-input").files) {
      if (file.size > 16 * 1024 * 1024)
        throw new Error("单个附件不能超过 16 MB");
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      state.attachments.push({ name: file.name, type: file.type, data });
    }
    rememberDraft();
    syncComposer();
  } catch (e) {
    toast(e.message, true);
  } finally {
    $("#file-input").value = "";
  }
});
setupTooltips();
setupConversationScroll();
window.viniperDesktop?.onCommand((payload) => {
  const cmd = payload.command || payload.action;
  if (settingsDialog.open) return;
  if (["new-session", "new-chat", "new-viniper-session"].includes(cmd))
    newChat();
  if (["settings", "open-settings"].includes(cmd)) view("settings");
  if (cmd === "new-discussion") handleMenu("new-discussion").catch(e => toast(e.message,true));
  if (cmd === "quick-navigator") navigate("quick");
  if (cmd === "toggle-sidebar") dispatch("toggle-sidebar");
  if (cmd === "attach-file") $("#file-input").click();
  if (cmd === "change-workdir") project().catch((e) => toast(e.message, true));
});
if (
  window.viniperDesktop?.platform === "darwin" ||
  /Mac/.test(navigator.platform)
)
  document.body.classList.add("platform-mac");
if (innerWidth <= 860) $("#app").classList.add("sidebar-collapsed");
hydrateIcons();
bindEffortControl($("#popover"), value => {
  state.reasoning = value;
  rememberDraft();
  syncComposer();
});
setupFunctionField($("#chat-view"));
const restoredSessionId = restoreUiSessionState();
if (!restoredSessionId && state.drafts.get("new")) {
  $("#prompt").value = state.drafts.get("new");
  resizePrompt();
}
await Promise.all([loadStatus(), loadSessions()]).catch((error) =>
  toast(`连接尚未就绪：${error.message}`, true),
);
if (restoredSessionId && state.sessions.some((s) => s.id === restoredSessionId)) {
  await selectSession(restoredSessionId).catch((error) => toast(error.message, true));
} else if (state.drafts.get("new")) {
  $("#prompt").value = state.drafts.get("new");
  syncComposer();
}
async function backgroundPollTick() {
  if (!document.hidden) {
    if (!state.status) {
      await loadStatus().catch(() => {});
    } else {
      await refreshModelNotice().catch(() => {});
    }
    await loadSessions().catch(() => {});
    if (state.session) {
      await refreshQueue(state.session.session_id).catch(() => {});
    }
    if (!settingsDialog.open && state.view === "tasks") {
      await loadTasks().catch(() => {});
    }
    if (state.session) {
      await refreshGoalBanner().catch(() => {});
      const sid = state.session.session_id;
      const listed = state.sessions.find((s) => s.id === sid);
      if (
        !settingsDialog.open && state.view === "chat" && listed?.active_run?.active &&
        !state.runs.get(sid)?.active && !busySending
      ) {
        try {
          const fresh = await api(`/api/sessions/${encodeURIComponent(sid)}`);
          if (state.session?.session_id === sid && !state.runs.get(sid)?.active) {
            state.session.messages = fresh.messages;
            state.session.active_run = fresh.active_run;
            renderMessages(fresh.messages.map((m) =>
              fresh.active_run?.active && m.pending ? { ...m, streaming: true, working: "正在接续输出" } : m
            ), { preserveView: true });
            if (fresh.active_run?.active) void resumeRun(fresh).catch((e) => toast(e.message, true));
          }
        } catch {}
      }
    }
  }
  setTimeout(backgroundPollTick, 4000);
}
setTimeout(backgroundPollTick, 4000);

setInterval(() => {
  for (const run of state.runs.values())
    if (run.active) {
      run.message.elapsed = Math.round((Date.now() - run.started) / 1000);
      // Timer updates only the small status line and waiting/thinking elapsed label.
      if (state.session?.session_id === run.sessionId) {
        syncComposer();
        refreshLiveRunStatus(run);
      }
    }
}, 1000);

const compactWindow = matchMedia("(max-width:860px)");
compactWindow.addEventListener("change", (event) => {
  if (event.matches) $("#app").classList.add("sidebar-collapsed");
});
document.addEventListener("pointerdown", (event) => {
  if (
    compactWindow.matches &&
    !event.target.closest('#sidebar,[data-action="toggle-sidebar"]')
  )
    $("#app").classList.add("sidebar-collapsed");
});
