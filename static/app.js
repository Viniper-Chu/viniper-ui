const state = {
  sessionId: null,
  sessionName: "",
  workdir: "",
  contextRevision: "",
  contextUsage: { used_tokens: 0, context_limit: 0, effective_context_window: 0, ratio: 0, source: "unavailable", updated_at: 0, model: "" },
  dailyUsage: {
    status: "idle",
    rangeDays: 30,
    loadedRangeDays: 0,
    source: "",
    timezone: "",
    days: [],
    totals: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      total_tokens: 0,
      run_count: 0
    },
    lastFetchedAt: 0,
    emptyRefreshKey: "",
    error: ""
  },
  dailyUsageRequest: null,
  messages: [],
  activityEvents: [],
  isStreaming: false,
  contextFiles: [],
  skills: [],
  activeSkillCategory: "all",
  currentSkill: null,
  skillsViewRestore: null,
  status: null,
  selectedModel: "deepseek-v4-pro[1m]",
  permissionMode: "default",
  modelMenuOpen: false,
  modelMenuIndex: 0,
  permissionMenuOpen: false,
  permissionMenuIndex: 0,
  peerMenuOpen: false,
  peerCapability: { available: false, verified: false, reason: "", discovery: "unavailable", targets: [] },
  peerTarget: null,
  theme: "light",
  language: "zh-CN",
  accent: "viniper",
  fontSize: "normal",
  sidebarVisible: true,
  sidebarWidth: 280,
  sidebarResizing: false,
  sidebarGesture: {
    startX: 0,
    startWidth: 280,
    dragging: false,
    pointerId: null
  },
  viewMode: "chat",
  sessionMode: "chat",
  sessionIndex: [],
  navigation: {
    current: null,
    back: [],
    forward: [],
    replaying: false
  },
  menuOpen: false,
  accountMenuOpen: false,
  accountMenuPinned: false,
  sessionMenuSessionId: null,
  searchOpen: false,
  searchResults: [],
  searchIndex: 0,
  alwaysOnTop: false,
  sessionPinned: false,
  sessionUnread: false,
  sessionRuntimeState: "idle",
  inlineStatus: { sessionId: "", kind: "", message: "", timer: null },
  settings: null,
  settingsDirty: false,
  settingsActiveSection: "account",
  runtimeBusy: false,
  agentInstructions: { content: "", exists: false, path: "", updated_at: null },
  previewMode: false,
  updateInfo: null,
  abortController: null,
  cancelRequested: false,
  followOutput: true,
  storedThinkingTimer: null,
  slashSuggestions: [],
  slashSuggestionIndex: 0,
  folderPicker: {
    targetSelector: "",
    currentPath: "",
    parentPath: "",
    defaultRoot: "",
    roots: []
  },
  pendingInteraction: null,
  pendingDeleteResolver: null,
  pendingRenameResolver: null,
  pendingTextInputResolver: null,
  sessionSwitchGeneration: 0,
  sessionSwitchPending: false,
  retrySend: { count: 0, max: 3, delayMs: 3000 },
  contextCompression: { status: "idle", reason: "", lastAttemptKey: "", inFlight: false, timer: null },
  contextCompressionBySession: {},
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const SessionScrollRegistry = {
  records: new Map(),
  projectionTokens: new Map(),
  ensure(sessionId) {
    const id = String(sessionId || "");
    if (!id) return null;
    const existing = this.records.get(id);
    if (existing && typeof existing === "object") return existing;
    const record = { follow: existing === undefined ? true : Boolean(existing), scrollTop: null };
    this.records.set(id, record);
    return record;
  },
  get(sessionId) {
    const id = String(sessionId || "");
    return this.ensure(id)?.follow ?? true;
  },
  getRecord(sessionId) {
    return this.records.get(String(sessionId || "")) || null;
  },
  set(sessionId, follow, scrollTop = undefined) {
    const id = String(sessionId || "");
    const record = this.ensure(id);
    const value = Boolean(follow);
    if (record) {
      record.follow = value;
      if (Number.isFinite(Number(scrollTop))) record.scrollTop = Math.max(0, Number(scrollTop));
    }
    if (id && id === String(state.sessionId || "")) state.followOutput = value;
    return value;
  },
  setScrollTop(sessionId, scrollTop) {
    const record = this.ensure(sessionId);
    if (!record || !Number.isFinite(Number(scrollTop))) return null;
    record.scrollTop = Math.max(0, Number(scrollTop));
    return record.scrollTop;
  },
  activate(sessionId) {
    const record = this.ensure(sessionId);
    state.followOutput = record?.follow ?? true;
    return state.followOutput;
  },
  restore(sessionId) {
    const record = this.getRecord(sessionId);
    const container = $("#chat-container");
    if (!record || !container) return null;
    const max = Math.max(0, container.scrollHeight - container.clientHeight);
    const target = record.follow ? max : Math.min(max, Math.max(0, Number(record.scrollTop) || 0));
    container.scrollTop = target;
    return target;
  },
  beginProjection(sessionId) {
    const id = String(sessionId || "");
    if (!id) return null;
    const token = {};
    this.projectionTokens.set(id, token);
    return token;
  },
  finishProjection(sessionId, token) {
    const id = String(sessionId || "");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (this.projectionTokens.get(id) === token) this.projectionTokens.delete(id);
    }));
  },
  isProjecting(sessionId) {
    return this.projectionTokens.has(String(sessionId || ""));
  },
  remove(sessionId) {
    const id = String(sessionId || "");
    this.records.delete(id);
    this.projectionTokens.delete(id);
  },
};

const SessionRunRegistry = {
  records: new Map(),
  get(sessionId) {
    return this.records.get(String(sessionId)) || null;
  },
  start(sessionId, meta = {}) {
    const id = String(sessionId);
    const current = this.records.get(id);
    const requestedRunId = String(meta.runId || "");
    if (current?.active && (!requestedRunId || !current.runId || current.runId === requestedRunId)) return current;
    const record = {
      sessionId: id,
      mode: meta.mode || "agent",
      workdir: meta.workdir || "",
      active: true,
      status: "running",
      waitingInput: false,
      pendingInteraction: null,
      awaitingInteractionAck: null,
      cancelRequested: false,
      guidancePending: false,
      queuePending: false,
      runId: requestedRunId,
      serverSequence: Math.max(0, Number(meta.serverSequence) || 0),
      segments: Array.isArray(meta.segments) ? meta.segments.map((segment) => ({ ...segment })) : [],
      cursor: 0,
      startedAt: performance.now(),
      elapsedOverride: null,
      completed: false,
      usage: null,
      turnUsage: meta.turnUsage || meta.turn_usage ? { ...(meta.turnUsage || meta.turn_usage) } : null,
      contextCompacting: false,
      peerCapability: null,
      error: false,
      thinkingVisible: true,
      workingLabel: meta.workingLabel || "正在发送…",
    };
    this.records.set(id, record);
    this.mirror(id);
    return record;
  },
  update(sessionId, patch = {}) {
    const record = this.records.get(String(sessionId));
    if (!record) return null;
    Object.assign(record, patch);
    if (record.waitingInput || record.pendingInteraction || ["waiting_input", "awaiting_cli_ack"].includes(record.status)) {
      record.thinkingVisible = false;
    }
    if (String(sessionId) === String(state.sessionId)) this.mirror(sessionId);
    return record;
  },
  finish(sessionId, status = "completed") {
    const record = this.records.get(String(sessionId));
    if (!record) return null;
    record.active = false;
    record.status = status;
    record.waitingInput = false;
    if (status === "cancelled") {
      record.pendingInteraction = null;
      record.awaitingInteractionAck = null;
    } else if (status === "failed" && (record.pendingInteraction || record.awaitingInteractionAck)) {
      const interrupted = record.pendingInteraction || record.awaitingInteractionAck;
      record.pendingInteraction = {
        ...interrupted,
        interaction_state: "failed",
        terminal: true,
        allowed_actions: [],
        failure_message: String(interrupted.failure_message || "任务中断；请求未执行"),
      };
      record.awaitingInteractionAck = null;
    }
    record.guidancePending = false;
    record.queuePending = false;
    record.completed = true;
    record.thinkingVisible = false;
    syncRunMessageToState(String(sessionId));
    if (String(sessionId) === String(state.sessionId)) this.mirror(sessionId);
    return record;
  },
  mirror(sessionId = state.sessionId) {
    if (String(sessionId || "") !== String(state.sessionId || "")) return;
    syncCurrentSessionRuntimeUi();
  },
  snapshot(sessionId) {
    const record = this.records.get(String(sessionId));
    if (!record) return null;
    return {
      ...record,
      segments: record.segments.map((segment) => ({ ...segment })),
      pendingInteraction: record.pendingInteraction ? { ...record.pendingInteraction } : null,
      awaitingInteractionAck: record.awaitingInteractionAck ? { ...record.awaitingInteractionAck } : null,
      usage: record.usage ? { ...record.usage } : null,
      turnUsage: record.turnUsage ? { ...record.turnUsage } : null,
      peerCapability: record.peerCapability ? { ...record.peerCapability } : null,
    };
  },
  applyEvent(sessionId, payload = {}) {
    const record = this.records.get(String(sessionId));
    if (!record || !payload || typeof payload !== "object") return record;
    const type = String(payload.type || "");
    const closeThinking = () => {
      const last = record.segments[record.segments.length - 1];
      if (!last || last.type !== "thinking" || !last.activeThinking) return;
      last.elapsedSeconds = Number.isFinite(last.startedAt)
        ? Math.max(0, Math.round((performance.now() - last.startedAt) / 1000))
        : 0;
      last.activeThinking = false;
    };
    const removeThinking = () => {
      record.segments = record.segments.filter((segment) => segment.type !== "thinking");
    };
    record.cursor += 1;
    if ([
      "thinking_start", "thinking_delta", "thinking", "thinking_complete", "text",
      "tool_start", "tool_result", "artifact", "peer_outgoing", "peer_delivery",
      "peer_incoming", "image", "interaction_request", "interaction_response_committed", "interaction_ack", "error", "done"
    ].includes(type)) {
      record.thinkingVisible = false;
    }
    if (type === "thinking_start") {
      const last = record.segments[record.segments.length - 1];
      if (!(last?.type === "thinking" && last.activeThinking)) {
        record.segments.push({ type: "thinking", content: "", startedAt: performance.now(), activeThinking: true, showEmpty: true });
      }
    } else if (type === "thinking_delta" || type === "thinking") {
      this.applyEvent(sessionId, { type: "thinking_start", _internal: true });
      const last = record.segments[record.segments.length - 1];
      last.content += repairTextForDisplay(payload.content || "");
      if (payload._internal !== true) record.cursor -= 1;
    } else if (type === "thinking_complete") {
      closeThinking();
    } else if (type === "text") {
      removeThinking();
      const value = repairTextForDisplay(payload.content || "");
      const last = record.segments[record.segments.length - 1];
      if (value && last?.type === "text") last.content += value;
      else if (value) record.segments.push({ type: "text", content: value });
    } else if (type === "image" && payload.scope === "thinking") {
      let thinkingIndex = -1;
      for (let index = record.segments.length - 1; index >= 0; index -= 1) {
        if (record.segments[index]?.type === "thinking") {
          thinkingIndex = index;
          break;
        }
      }
      if (thinkingIndex < 0) {
        record.segments.push({ type: "thinking", content: "", images: [], startedAt: performance.now(), activeThinking: true, showEmpty: true });
        thinkingIndex = record.segments.length - 1;
      }
      const thinkingSegment = record.segments[thinkingIndex];
      if (!Array.isArray(thinkingSegment.images)) thinkingSegment.images = [];
      thinkingSegment.images.push({ ...payload, type: "image" });
      thinkingSegment.showEmpty = true;
    } else if (["tool_start", "tool_result", "artifact", "peer_outgoing", "peer_delivery", "peer_incoming", "image"].includes(type)) {
      closeThinking();
      removeThinking();
      record.segments.push({ ...payload, type, content: payload.content == null ? "" : String(payload.content) });
    } else if (type === "interaction_request") {
      removeThinking();
      const interaction = normalizeInteractionRequest(payload);
      record.pendingInteraction = interaction;
      record.waitingInput = Boolean(interaction);
      record.status = interaction ? "waiting_input" : "running";
    } else if (type === "interaction_response_committed") {
      const requestId = String(payload.request_id || record.pendingInteraction?.request_id || "");
      if (record.pendingInteraction && (!requestId || String(record.pendingInteraction.request_id) === requestId)) {
        record.awaitingInteractionAck = {
          ...record.pendingInteraction,
          request_id: requestId,
          interaction_state: "awaiting_cli_ack",
          response_action: String(payload.response_action || record.pendingInteraction.response_action || ""),
          allowed_actions: [],
        };
        record.pendingInteraction = null;
      }
      record.waitingInput = false;
      record.status = "awaiting_cli_ack";
    } else if (type === "interaction_ack") {
      const requestId = String(payload.request_id || "");
      const awaiting = record.awaitingInteractionAck;
      if (!awaiting || (requestId && String(awaiting.request_id) !== requestId)) return record;
      const resultKey = String(awaiting.request_id || requestId);
      if (payload.status === "accepted") {
        if (!record.segments.some((segment) => segment.type === "interaction_result" && String(segment.request_id) === resultKey)) {
          record.segments.push({
            type: "interaction_result",
            request_id: resultKey,
            kind: String(awaiting.kind || "permission"),
            action: String(awaiting.response_action || payload.action || "accepted"),
            status: "accepted",
          });
        }
        record.awaitingInteractionAck = null;
        record.pendingInteraction = null;
        record.status = "running";
      } else if (payload.status === "failed") {
        record.awaitingInteractionAck = null;
        record.pendingInteraction = {
          ...awaiting,
          interaction_state: "failed",
          terminal: true,
          allowed_actions: [],
          failure_code: String(payload.failure_code || awaiting.failure_code || ""),
          response_action: String(payload.response_action || awaiting.response_action || ""),
          failure_message: String(payload.reason || payload.message || "任务中断；请求未执行"),
        };
        record.status = "failed";
        record.error = true;
      }
    } else if (type === "compact_boundary") {
      record.contextCompacting = true;
      record.usage = normalizeContextUsage(payload.usage || { source: "unavailable", compacting: true });
    } else if (type === "usage") {
      record.usage = normalizeContextUsage(payload.usage);
      record.contextCompacting = Boolean(record.usage?.compacting);
    } else if (type === "turn_usage") {
      record.turnUsage = normalizeTurnUsage(payload.turn_usage || payload.turnUsage);
    } else if (type === "peer_capability") {
      record.peerCapability = normalizePeerStatus(payload.peer || {});
    } else if (type === "heartbeat") {
      const elapsed = Number(payload.elapsed);
      if (Number.isFinite(elapsed)) record.elapsedOverride = Math.max(Number(record.elapsedOverride) || 0, Math.max(0, elapsed));
      if (!record.waitingInput && !record.pendingInteraction
        && !record.segments.some((segment) => ["thinking", "text", "tool_start", "tool_result", "artifact"].includes(segment.type))) {
        const stage = payload.waiting_for === "tool" ? "正在等待本地工具…" : "正在工作…";
        record.workingLabel = Number.isFinite(elapsed) && elapsed >= 10 ? `${stage} ${Math.round(elapsed)} 秒` : stage;
        record.thinkingVisible = true;
      }
    } else if (type === "working_status") {
      record.workingLabel = repairTextForDisplay(payload.content || "正在工作…");
      record.thinkingVisible = !(record.waitingInput || record.pendingInteraction);
    } else if (type === "error") {
      removeThinking();
      record.error = true;
      record.status = "failed";
    } else if (type === "done") {
      closeThinking();
      removeThinking();
      removeThinking();
      record.completed = true;
      record.waitingInput = false;
    }
    if (String(sessionId) === String(state.sessionId)) this.mirror(sessionId);
    return record;
  },
  replaceText(sessionId, content) {
    const record = this.records.get(String(sessionId));
    if (!record) return null;
    record.cursor += 1;
    record.thinkingVisible = false;
    record.segments = record.segments.filter((segment) => segment.type !== "thinking" && segment.type !== "text");
    if (content) record.segments.push({ type: "text", content: repairTextForDisplay(content) });
    if (String(sessionId) === String(state.sessionId)) this.mirror(sessionId);
    return record;
  },
  clearFinished() {
    for (const [id, record] of this.records) if (!record.active) this.records.delete(id);
  }
};

const SessionQueueRegistry = {
  records: new Map(),
  get(sessionId) {
    return this.records.get(String(sessionId)) || [];
  },
  set(sessionId, items = []) {
    const id = String(sessionId);
    const normalized = Array.isArray(items) ? items.map((item) => ({ ...item, session_id: id })) : [];
    this.records.set(id, normalized);
    if (id === String(state.sessionId || "")) renderAgentQueue(id);
    return normalized;
  },
  upsert(sessionId, item) {
    const id = String(sessionId);
    const items = this.get(id).slice();
    const index = items.findIndex((candidate) => String(candidate.id) === String(item?.id));
    if (index >= 0) items[index] = { ...items[index], ...item, session_id: id };
    else if (item?.id) items.push({ ...item, session_id: id });
    return this.set(id, items);
  },
  remove(sessionId, itemId) {
    const id = String(sessionId);
    return this.set(id, this.get(id).filter((item) => String(item.id) !== String(itemId)));
  }
};

const SessionTransportRegistry = {
  records: new Map(),
  get(sessionId) {
    return this.records.get(String(sessionId)) || null;
  },
  start(sessionId, meta = {}) {
    const id = String(sessionId);
    const record = {
      sessionId: id,
      abortController: meta.abortController || null,
      reader: null,
      timer: null,
      retry: { count: 0, max: 3, delayMs: 3000, context: null },
    };
    this.records.set(id, record);
    return record;
  },
  update(sessionId, patch = {}) {
    const record = this.get(sessionId);
    if (!record) return null;
    Object.assign(record, patch);
    return record;
  },
  finish(sessionId) {
    const id = String(sessionId);
    const record = this.records.get(id);
    if (record?.timer) window.clearInterval(record.timer);
    this.records.delete(id);
    return record || null;
  }
};

function renderSessionInlineStatus() {
  const node = $("#session-inline-status");
  if (!node) return;
  const item = state.inlineStatus || {};
  const visible = Boolean(item.message && String(item.sessionId || "") === String(state.sessionId || ""));
  node.classList.toggle("hidden", !visible);
  node.setAttribute("aria-hidden", visible ? "false" : "true");
  node.dataset.statusKind = visible ? String(item.kind || "info") : "";
  node.textContent = visible ? item.message : "";
}

function clearInlineStatus(sessionId = state.sessionId, kind = "") {
  const item = state.inlineStatus || {};
  if (sessionId && String(item.sessionId || "") !== String(sessionId)) return;
  if (kind && String(item.kind || "") !== String(kind)) return;
  if (item.timer) window.clearTimeout(item.timer);
  state.inlineStatus = { sessionId: "", kind: "", message: "", timer: null };
  renderSessionInlineStatus();
}

function showInlineStatus(message, { sessionId = state.sessionId, kind = "info", timeout = 0 } = {}) {
  const id = String(sessionId || "");
  if (!id || id !== String(state.sessionId || "")) return false;
  const current = state.inlineStatus || {};
  if (current.timer) window.clearTimeout(current.timer);
  state.inlineStatus = { sessionId: id, kind: String(kind || "info"), message: String(message || ""), timer: null };
  if (timeout > 0) {
    state.inlineStatus.timer = window.setTimeout(() => clearInlineStatus(id), timeout);
  }
  renderSessionInlineStatus();
  return true;
}

function updateSessionPauseStatus() {
  const id = String(state.sessionId || "");
  const record = id ? SessionRunRegistry.get(id) : null;
  const paused = String(state.sessionRuntimeState || "") === "paused" || String(record?.status || "") === "paused";
  if (paused) {
    const current = state.inlineStatus || {};
    if (current.kind !== "paused" || String(current.sessionId) !== id) {
      state.inlineStatus = { sessionId: id, kind: "paused", message: "已暂停 · 输入消息可继续", timer: null };
    }
  } else if (state.inlineStatus?.kind === "paused" && String(state.inlineStatus.sessionId) === id) {
    clearInlineStatus(id, "paused");
  }
  renderSessionInlineStatus();
}

function resetCurrentSessionRuntimeUi() {
  state.pendingInteraction = null;
  clearInlineStatus();
  clearInteractionDock();
  $("#thinking")?.classList.add("hidden");
  $("#stop-btn")?.classList.add("hidden");
  const input = $("#user-input");
  const send = $("#send-btn");
  if (input) input.disabled = false;
  if (send) send.disabled = false;
}

function syncCurrentSessionRuntimeUi() {
  const sessionId = String(state.sessionId || "");
  const record = sessionId ? SessionRunRegistry.get(sessionId) : null;
  const transport = sessionId ? SessionTransportRegistry.get(sessionId) : null;
  const active = Boolean(record?.active);
  const agent = state.viewMode === "agent" && state.sessionMode === "agent";
  const interactionState = String(record?.pendingInteraction?.interaction_state || "");
  const interactionTerminal = ["accepted", "denied", "cancelled", "failed", "terminal"].includes(interactionState);
  const interactionLocked = Boolean(record?.waitingInput || (record?.pendingInteraction && !interactionTerminal)
    || ["waiting_input", "awaiting_cli_ack"].includes(String(record?.status || "")));
  const guidance = Boolean(active && agent && !interactionLocked);
  const runningHint = Boolean(active && agent);
  const guidancePending = Boolean(guidance && record?.guidancePending);
  const queuePending = Boolean(guidance && record?.queuePending);

  state.isStreaming = active;
  state.abortController = transport?.abortController || null;
  state.cancelRequested = Boolean(record?.cancelRequested);
  state.pendingInteraction = record?.pendingInteraction || null;
  if (transport?.retry) state.retrySend = transport.retry;
  if (record?.usage) state.contextUsage = normalizeContextUsage({ ...record.usage, compacting: record.contextCompacting });
  if (record?.peerCapability) state.peerCapability = normalizePeerStatus(record.peerCapability);
  if (record?.usage || record?.contextCompacting) updateContextMeter({ schedule: false });

  const thinking = $("#thinking");
  const stop = $("#stop-btn");
  const send = $("#send-btn");
  const input = $("#user-input");
  const shortcut = $(".composer-shortcut");
  const composer = $("#composer");
  const locked = active && !guidance;

  thinking?.classList.toggle("hidden", !(active && record?.thinkingVisible));
  const workingLabel = thinking?.querySelector(".working-label");
  if (workingLabel) workingLabel.textContent = record?.workingLabel || "正在工作…";
  stop?.classList.toggle("hidden", !active);
  if (input) {
    input.disabled = locked;
    input.placeholder = runningHint
      ? "输入后按 Enter 排队，Ctrl+Enter 引导当前任务"
      : (agent ? "输入任务，或使用 / 命令" : "输入消息");
  }
  if (send) {
    send.disabled = state.sessionSwitchPending || locked || guidancePending || queuePending;
    const label = guidancePending
      ? "正在发送引导"
      : (queuePending ? "正在加入队列" : (guidance ? "加入待发送队列" : "发送"));
    send.title = label;
    send.setAttribute("aria-label", label);
  }
  if (shortcut) {
    shortcut.textContent = runningHint
      ? "Enter 排队 · Ctrl+Enter 引导 · Shift+Enter 换行"
      : "Enter 发送 · Shift+Enter 换行";
  }
  if (composer) composer.dataset.runtimeState = active ? (record?.status || "running") : "idle";

  ["#file-btn", "#update-btn", "#model-picker-button", "#model-select",
    "#permission-picker-button", "#permission-select", "#change-workdir-btn"
  ].forEach((selector) => {
    const control = $(selector);
    if (control) control.disabled = active;
  });
  updateSessionPauseStatus();
  renderPeerMenu();
}
const APP_TITLE = String(typeof window !== "undefined" && window.VINIPER_APP_TITLE || "Viniper");
const STORAGE_PREFIX = "viniper-ui:";
const LAST_SESSION_KEY = `${STORAGE_PREFIX}last-session-id`;
const MODEL_KEY = `${STORAGE_PREFIX}selected-model`;
const THEME_KEY = `${STORAGE_PREFIX}theme`;
const LANGUAGE_KEY = `${STORAGE_PREFIX}language`;
const ACCENT_KEY = `${STORAGE_PREFIX}accent`;
const FONT_SIZE_KEY = `${STORAGE_PREFIX}font-size`;
const SIDEBAR_KEY = `${STORAGE_PREFIX}sidebar-visible`;
const SIDEBAR_WIDTH_KEY = `${STORAGE_PREFIX}sidebar-width`;
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const LAUNCH_SPLASH_MIN_MS = 1850;
const launchSplashStarted = performance.now();
const filePreviewUrls = new WeakMap();
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
const DEFAULT_AUTO_COMPACT_THRESHOLD = 0.95;
const PERMISSION_MODES = [
  {
    id: "default",
    label: "询问权限",
    description: "Claude 在需要权限时暂停并询问"
  },
  {
    id: "acceptEdits",
    label: "自动接受编辑",
    description: "自动允许文件编辑，其他高风险操作仍会询问"
  },
  {
    id: "plan",
    label: "计划模式",
    description: "先规划，减少直接执行动作"
  },
  {
    id: "auto",
    label: "自动模式",
    description: "仅在当前 Claude Code 与模型支持时可用"
  },
  {
    id: "bypassPermissions",
    label: "跳过权限",
    description: "仅在设置中明确启用后可用"
  },
  {
    id: "dontAsk",
    label: "不询问",
    description: "CLI 模式：未预批准的工具会被自动拒绝",
    cli_only: true,
    separator_before: true
  }
];
const CLAUDE_NATIVE_SLASH_COMMANDS = [
  { command: "/goal", title: "目标任务", description: "Claude Code 原生目标/技能命令，发送后由当前 agent shell 处理", source: "Claude Code" },
  { command: "/help", title: "帮助", description: "查看 Claude Code 可用命令和帮助", source: "Claude Code" },
  { command: "/status", title: "状态", description: "查看当前会话、模型和连接状态", source: "Claude Code" },
  { command: "/model", title: "模型", description: "切换或查看 Claude Code 模型", source: "Claude Code" },
  { command: "/permissions", title: "权限", description: "查看或调整 Claude Code 权限设置", source: "Claude Code" },
  { command: "/compact", title: "压缩上下文", description: "压缩长会话上下文", source: "Claude Code" },
  { command: "/clear", title: "清空显示", description: "清理当前上下文或显示内容", source: "Claude Code" },
  { command: "/init", title: "初始化项目", description: "为当前项目生成或更新 Claude Code 项目说明", source: "Claude Code" },
  { command: "/memory", title: "记忆", description: "查看或编辑 Claude Code 记忆", source: "Claude Code" },
  { command: "/doctor", title: "诊断", description: "运行 Claude Code 环境诊断", source: "Claude Code" },
  { command: "/theme", title: "主题", description: "调整 Claude Code 终端主题", source: "Claude Code" },
  { command: "/cost", title: "用量", description: "查看当前会话用量和成本信息", source: "Claude Code" },
  { command: "/review", title: "代码审查", description: "让 Claude Code 审查当前变更", source: "Claude Code" }
];
const FONT_SIZE_OPTIONS = [
  { id: "xs", label: "更小" },
  { id: "sm", label: "小" },
  { id: "normal", label: "标准" },
  { id: "lg", label: "大" },
  { id: "xl", label: "更大" }
];
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 760;
const SIDEBAR_EDGE_HIT_WIDTH = 28;
const SIDEBAR_DRAG_THRESHOLD = 5;
const I18N = {
  "zh-CN": {
    newChat: "新建聊天",
    newSession: "新建会话",
    skills: "技能库",
    settings: "设置",
    model: "模型",
    permission: "权限",
    directory: "目录",
    inputPlaceholder: "输入消息",
    attach: "添加附件",
    stop: "停止当前任务",
    send: "发送",
    sidebar: "显示/隐藏边栏",
    pin: "置顶",
    unpin: "取消置顶",
    sessionPin: "置顶会话",
    sessionUnpin: "取消置顶会话",
    windowPin: "置顶聊天窗口",
    windowUnpin: "取消置顶聊天窗口",
    skillsWeb: "Skills",
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
    sidebar: "Toggle sidebar",
    pin: "Pin",
    unpin: "Unpin",
    sessionPin: "Pin session",
    sessionUnpin: "Unpin session",
    windowPin: "Keep chat window on top",
    windowUnpin: "Stop keeping chat window on top",
    skillsWeb: "Skills",
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
  applyFontSize(appearance.font_size || state.fontSize);
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
  window.viniperDesktop?.setTitlebarTheme?.({
    color: document.documentElement.dataset.theme === "dark" ? "#222220" : "#f5f3ee",
    symbolColor: document.documentElement.dataset.theme === "dark" ? "#f5f5f7" : "#302f2b"
  });
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

function getInitialFontSize() {
  const savedFontSize = storageGet(FONT_SIZE_KEY);
  return FONT_SIZE_OPTIONS.some((item) => item.id === savedFontSize) ? savedFontSize : "normal";
}

function applyFontSize(fontSize) {
  state.fontSize = FONT_SIZE_OPTIONS.some((item) => item.id === fontSize) ? fontSize : "normal";
  document.documentElement.dataset.fontSize = state.fontSize;
  storageSet(FONT_SIZE_KEY, state.fontSize);
}

function getInitialSidebarVisible() {
  const saved = storageGet(SIDEBAR_KEY);
  if (saved !== null) return saved !== "0";
  return !(window.matchMedia && window.matchMedia("(max-width: 819px)").matches);
}

function getInitialSidebarWidth() {
  const raw = Number(storageGet(SIDEBAR_WIDTH_KEY));
  return Number.isFinite(raw) && raw > 0 ? clampSidebarWidth(raw) : 280;
}

function clampSidebarWidth(width) {
  const narrow = window.matchMedia && window.matchMedia("(max-width: 819px)").matches;
  const viewportLimit = narrow
    ? Math.max(SIDEBAR_MIN_WIDTH, window.innerWidth - 56)
    : Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(window.innerWidth * 0.65)));
  return Math.min(viewportLimit, Math.max(SIDEBAR_MIN_WIDTH, Math.round(Number(width) || 280)));
}

function normalizeNavigationLocation(location) {
  if (!location || typeof location !== "object") return null;
  const kind = String(location.kind || "");
  if (kind === "session" && location.sessionId) {
    return {
      kind,
      mode: location.mode === "agent" ? "agent" : "chat",
      sessionId: String(location.sessionId)
    };
  }
  if (kind === "skills") {
    return location.skillId
      ? { kind, skillId: String(location.skillId) }
      : { kind };
  }
  if (kind === "settings") {
    return location.section
      ? { kind, section: String(location.section) }
      : { kind };
  }
  if (kind === "mode-home") {
    return { kind, mode: location.mode === "agent" ? "agent" : "chat" };
  }
  return null;
}

function navigationLocationKey(location) {
  const normalized = normalizeNavigationLocation(location);
  return normalized ? JSON.stringify(normalized) : "";
}

function sameNavigationLocation(left, right) {
  return navigationLocationKey(left) === navigationLocationKey(right);
}

function pushNavigationLocation(history, location) {
  const currentHistory = history || { current: null, back: [], forward: [], replaying: false };
  const next = normalizeNavigationLocation(location);
  if (!next || sameNavigationLocation(currentHistory.current, next)) return currentHistory;
  return {
    current: next,
    back: currentHistory.current ? [...(currentHistory.back || []), currentHistory.current] : [...(currentHistory.back || [])],
    forward: [],
    replaying: Boolean(currentHistory.replaying)
  };
}

function stepNavigationHistory(history, direction) {
  const currentHistory = history || { current: null, back: [], forward: [], replaying: false };
  const source = direction === "forward" ? [...(currentHistory.forward || [])] : [...(currentHistory.back || [])];
  if (!source.length) return currentHistory;
  const target = source.pop();
  const opposite = direction === "forward" ? [...(currentHistory.back || [])] : [...(currentHistory.forward || [])];
  if (currentHistory.current) opposite.push(currentHistory.current);
  return direction === "forward"
    ? { current: target, back: opposite, forward: source, replaying: true }
    : { current: target, back: source, forward: opposite, replaying: true };
}

function sidebarGestureDecision(startX, currentX, threshold = SIDEBAR_DRAG_THRESHOLD) {
  const delta = Number(currentX) - Number(startX);
  return { delta, dragging: Number.isFinite(delta) && Math.abs(delta) > threshold };
}

function sidebarPointerStartAction({ visible = true, narrow = false, button = 0 } = {}) {
  if (narrow || button !== 0) return "ignore";
  return visible ? "gesture" : "toggle";
}

function setSidebarWidth(width, { persist = true } = {}) {
  state.sidebarWidth = clampSidebarWidth(width);
  document.documentElement.style.setProperty("--sidebar-width", `${state.sidebarWidth}px`);
  if (persist && state.sidebarVisible) storageSet(SIDEBAR_WIDTH_KEY, String(state.sidebarWidth));
  updateSidebarControls();
}

function sidebarIsNarrow() {
  return Boolean(window.matchMedia && window.matchMedia("(max-width: 819px)").matches);
}

function updateSidebarControls() {
  const button = $("#toggle-sidebar-btn");
  const resizer = $("#sidebar-resizer");
  const tooltip = $("#sidebar-resizer-tooltip");
  const label = state.sidebarVisible ? "折叠侧栏" : "展开侧栏";
  const tooltipText = `${label} Ctrl+B`;
  if (button) {
    button.classList.toggle("active", state.sidebarVisible);
    button.title = tooltipText;
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", state.sidebarVisible ? "true" : "false");
  }
  if (resizer) {
    resizer.title = `${tooltipText}；拖动调整大小`;
    resizer.setAttribute("aria-label", `${tooltipText}；拖动调整大小`);
    resizer.setAttribute("aria-valuenow", String(state.sidebarWidth));
    resizer.setAttribute("aria-valuetext", `${state.sidebarWidth} 像素`);
    resizer.dataset.collapsed = state.sidebarVisible ? "false" : "true";
  }
  if (tooltip) tooltip.innerHTML = `${tooltipText}<br>拖动调整大小`;
}

function setSidebarVisible(visible, { source = "command" } = {}) {
  state.sidebarVisible = Boolean(visible);
  document.body.classList.toggle("sidebar-collapsed", !state.sidebarVisible);
  storageSet(SIDEBAR_KEY, state.sidebarVisible ? "1" : "0");
  document.body.dataset.sidebarSource = source;
  updateSidebarControls();
}

function setViewMode(mode) {
  const nextMode = mode === "agent" ? "agent" : "chat";
  state.viewMode = nextMode;
  state.sessionMode = nextMode;
  document.body.dataset.viewMode = nextMode;
  document.body.dataset.sessionMode = nextMode;
  if (nextMode === "chat") {
    clearContextFiles();
    hideSlashSuggestions();
    closePlusMenu();
    setPeerMenuOpen(false);
    clearPeerTarget();
  }
  $$(".view-tab").forEach((button) => {
    const active = button.id === `${nextMode}-view-btn`;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  const main = $("#main");
  if (main) main.classList.toggle("agent-view", nextMode === "agent");
  const chatContainer = $("#chat-container");
  if (chatContainer) chatContainer.dataset.surface = nextMode === "agent" ? "agent-workspace" : "chat-conversation";
  const composer = $("#composer");
  if (composer) composer.dataset.surface = nextMode === "agent" ? "agent-composer" : "chat-composer";
  updateModeChrome();
  if (!state.messages.length && $("#messages")) renderWelcome();
}

function updateModeChrome() {
  const agent = state.viewMode === "agent";
  document.querySelectorAll(".agent-only").forEach((node) => {
    // Dynamic overlays and capability-gated controls own their hidden state;
    // selecting Agent must not expose an empty slash panel or disabled peer entry.
    if (node.id === "slash-suggestions" || node.matches?.("[data-peer-picker]")) return;
    node.classList.toggle("hidden", !agent);
  });
  const hint = $(".composer-hint");
  const input = $("#user-input");
  const navLabel = $("#new-session-nav-label");
  const title = $("#new-session-title");
  if (hint) {
    hint.textContent = agent ? "输入任务，或使用 / 命令" : "";
    hint.classList.toggle("hidden", !agent);
  }
  if (input) input.placeholder = agent ? "输入任务，或使用 / 命令" : "输入消息";
  if (navLabel) navLabel.textContent = agent ? "新建会话" : "新建聊天";
  if (title) title.textContent = agent ? "新建会话" : "新建聊天";
  const newChat = $("#new-chat-btn");
  if (newChat) {
    const label = agent ? "新建会话" : "新建聊天";
    newChat.title = label;
    newChat.setAttribute("aria-label", label);
  }
  const workdirLabel = $("#new-session-workdir")?.closest(".path-input-row")?.previousElementSibling;
  const workdirRow = $("#new-session-workdir")?.closest(".path-input-row");
  if (workdirLabel) workdirLabel.classList.toggle("hidden", !agent);
  if (workdirRow) workdirRow.classList.toggle("hidden", !agent);
  $("#drop-overlay")?.classList.toggle("hidden", !agent);
  // A mode transition always closes the dynamic overlay.  Input/click events
  // reopen it only when Agent has a real slash context and suggestions.
  hideSlashSuggestions();
  renderPeerMenu();
  renderSessionHeader();
  syncCurrentSessionRuntimeUi();
}

function toggleSidebar(source = "command") {
  setSidebarVisible(!state.sidebarVisible, { source });
}

function updateWindowPinButton() {
  const button = $("#always-on-top-btn");
  if (!button) return;
  const title = state.alwaysOnTop ? t("windowUnpin") : t("windowPin");
  button.classList.toggle("active", state.alwaysOnTop);
  button.title = title;
  button.setAttribute("aria-label", title);
  button.setAttribute("aria-pressed", state.alwaysOnTop ? "true" : "false");
}

function t(key) {
  return (I18N[state.language] || I18N["zh-CN"])[key] || I18N["zh-CN"][key] || key;
}

function translateChrome() {
  const newChat = $("#new-chat-btn");
  if (newChat) {
    newChat.title = t("newChat");
    newChat.setAttribute("aria-label", t("newChat"));
  }
  const accountTrigger = $("#account-menu-trigger");
  if (accountTrigger) {
    accountTrigger.title = "打开账号与应用菜单";
    accountTrigger.setAttribute("aria-label", "打开账号与应用菜单");
  }
  const workdir = $("#change-workdir-btn");
  if (workdir) workdir.textContent = t("directory");
  const input = $("#user-input");
  if (input) input.placeholder = t("inputPlaceholder");
  const fileButton = $("#file-btn");
  if (fileButton) {
    fileButton.title = t("attach");
    fileButton.setAttribute("aria-label", t("attach"));
  }
  const stopButton = $("#stop-btn");
  if (stopButton) {
    stopButton.title = t("stop");
    stopButton.setAttribute("aria-label", t("stop"));
  }
  const sendButton = $("#send-btn");
  if (sendButton) {
    sendButton.title = t("send");
    sendButton.setAttribute("aria-label", t("send"));
  }
  const sidebarButton = $("#toggle-sidebar-btn");
  if (sidebarButton) {
    sidebarButton.title = t("sidebar");
    sidebarButton.setAttribute("aria-label", t("sidebar"));
  }
  syncCurrentSessionRuntimeUi();
  updateSidebarControls();
  updateModeChrome();
  const thinking = $("#thinking span:last-child");
  if (thinking) thinking.textContent = t("thinking");
  updateThemeButton();
  updateWindowPinButton();
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

function updateNavigationButtons() {
  const back = $("#back-btn");
  const forward = $("#forward-btn");
  const backEnabled = Boolean(state.navigation.back.length);
  const forwardEnabled = Boolean(state.navigation.forward.length);
  for (const [button, enabled, label] of [[back, backEnabled, "后退"], [forward, forwardEnabled, "前进"]]) {
    if (!button) continue;
    button.disabled = !enabled;
    button.setAttribute("aria-disabled", enabled ? "false" : "true");
    button.title = enabled ? label : `${label}（暂无历史）`;
  }
}

function setNavigationLocation(location, { push = true } = {}) {
  const next = normalizeNavigationLocation(location);
  if (!next) return;
  if (push && !state.navigation.replaying) {
    state.navigation = pushNavigationLocation(state.navigation, next);
  } else {
    state.navigation = { ...state.navigation, current: next };
  }
  updateNavigationButtons();
}

async function applyNavigationLocation(location) {
  const next = normalizeNavigationLocation(location);
  if (!next) return false;
  const overlay = navigationOverlayState(next);
  if (!overlay.skills) closeSkillsView({ restoreNavigation: false });
  if (!overlay.settings) closeSettingsModal({ restoreNavigation: false });
  if (next.kind === "session") {
    const ok = await switchSession(next.sessionId, { quiet: true, history: false });
    if (ok) return true;
    await switchMode(next.mode, { history: false, quiet: true });
    setNavigationLocation({ kind: "mode-home", mode: next.mode }, { push: false });
    return false;
  }
  if (next.kind === "skills") {
    openSkillsView({ history: false, recordLocation: false });
    if (next.skillId) await showSkillDetail(next.skillId, { history: false });
    return true;
  }
  if (next.kind === "settings") {
    await openSettingsModal({ history: false, section: next.section });
    return true;
  }
  if (next.kind === "mode-home") {
    await switchMode(next.mode, { history: false, quiet: true });
    return true;
  }
  return false;
}

async function navigateHistory(direction) {
  const nextHistory = stepNavigationHistory(state.navigation, direction);
  if (nextHistory === state.navigation) return;
  state.navigation = nextHistory;
  updateNavigationButtons();
  try {
    await applyNavigationLocation(nextHistory.current);
  } finally {
    state.navigation = { ...state.navigation, replaying: false };
    updateNavigationButtons();
  }
}

function isOverlayNavigationLocation(location) {
  return location?.kind === "skills" || location?.kind === "settings";
}

function closeOverlayNavigation(history, fallback) {
  const currentHistory = history || { current: null, back: [], forward: [], replaying: false };
  const current = normalizeNavigationLocation(currentHistory.current);
  const back = [...(currentHistory.back || [])];
  const fallbackLocation = normalizeNavigationLocation(fallback);
  let previous = normalizeNavigationLocation(back.pop()) || fallbackLocation;
  while (
    previous &&
    isOverlayNavigationLocation(current) &&
    isOverlayNavigationLocation(previous) &&
    previous.kind === current.kind
  ) {
    const next = normalizeNavigationLocation(back.pop());
    if (!next) {
      previous = fallbackLocation;
      break;
    }
    previous = next;
  }
  return {
    ...currentHistory,
    current: previous,
    back,
    forward: [],
    replaying: true
  };
}

function navigationOverlayState(location) {
  if (location?.kind === "skills") return { skills: true, settings: false };
  if (location?.kind === "settings") return { skills: false, settings: true };
  return { skills: false, settings: false };
}

function fallbackDurableLocation() {
  return state.sessionId
    ? { kind: "session", mode: state.sessionMode, sessionId: state.sessionId }
    : { kind: "mode-home", mode: state.viewMode };
}

async function restorePreviousDurableLocation() {
  const current = state.navigation.current;
  if (!isOverlayNavigationLocation(current) || state.navigation.replaying) return;
  const nextHistory = closeOverlayNavigation(state.navigation, fallbackDurableLocation());
  const previous = nextHistory.current;
  state.navigation = nextHistory;
  updateNavigationButtons();
  try {
    await applyNavigationLocation(previous);
  } finally {
    state.navigation = { ...state.navigation, replaying: false };
    updateNavigationButtons();
  }
}

const GLOBAL_SEARCH_COMMANDS = [
  { action: "new-chat", label: "新建聊天", detail: "创建 Chat 会话", kind: "command" },
  { action: "new-agent-session", label: "新建会话", detail: "创建 Agent 会话", kind: "command" },
  { action: "skills", label: "自定义与技能", detail: "浏览本地技能库", kind: "command" },
  { action: "settings", label: "设置", detail: "打开应用设置", kind: "command" },
  { action: "switch-chat", label: "切换到 Chat", detail: "只进行对话", kind: "command" },
  { action: "switch-agent", label: "切换到 Agent", detail: "Claude Code 工作区", kind: "command" }
];

function globalMenuFocusIndex(key, currentIndex, itemCount) {
  const count = Number(itemCount) || 0;
  if (!count) return -1;
  const current = Number.isInteger(currentIndex) && currentIndex >= 0 && currentIndex < count
    ? currentIndex
    : 0;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return (current + 1) % count;
  if (key === "ArrowUp") return (current - 1 + count) % count;
  return current;
}

function handleGlobalMenuKeydown(event) {
  if (!event || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return false;
  const menu = $("#global-menu");
  const items = menu ? Array.from(menu.querySelectorAll("[role=menuitem]")) : [];
  if (!items.length) return false;
  const currentIndex = items.indexOf(document.activeElement);
  const nextIndex = globalMenuFocusIndex(event.key, currentIndex, items.length);
  if (nextIndex === currentIndex && event.key !== "Home" && event.key !== "End") return false;
  event.preventDefault();
  items[nextIndex]?.focus();
  return true;
}

function setMenuOpen(open) {
  state.menuOpen = Boolean(open);
  const menu = $("#global-menu");
  const button = $("#menu-btn");
  if (menu) {
    menu.classList.toggle("hidden", !state.menuOpen);
    menu.setAttribute("aria-hidden", state.menuOpen ? "false" : "true");
  }
  if (button) button.setAttribute("aria-expanded", state.menuOpen ? "true" : "false");
  if (state.menuOpen) menu?.querySelector("[role=menuitem]")?.focus();
}

function openMenu() {
  closeSearchPanel({ restoreFocus: false });
  setMenuOpen(true);
}

function closeMenu({ restoreFocus = false } = {}) {
  const wasOpen = state.menuOpen;
  setMenuOpen(false);
  if (wasOpen && restoreFocus) $("#menu-btn")?.focus();
}

function accountMenuTransition(current = {}, action = "hover") {
  const open = Boolean(current.open);
  const pinned = Boolean(current.pinned);
  if (action === "click") {
    if (open && !pinned) return { open: true, pinned: true, focus: true };
    if (open && pinned) return { open: false, pinned: false, focus: false };
    return { open: true, pinned: true, focus: true };
  }
  if (action === "hover" || action === "focus") return { open: true, pinned, focus: false };
  if (action === "leave" && !pinned) return { open: false, pinned: false, focus: false };
  if (action === "escape" || action === "outside") return { open: false, pinned: false, focus: false };
  return { open, pinned, focus: false };
}

function setAccountMenuOpen(open, { focus = false, pinned = state.accountMenuPinned } = {}) {
  state.accountMenuOpen = Boolean(open);
  state.accountMenuPinned = state.accountMenuOpen ? Boolean(pinned) : false;
  const menu = $("#account-menu");
  const trigger = $("#account-menu-trigger");
  if (menu) {
    menu.dataset.open = state.accountMenuOpen ? "true" : "false";
    menu.setAttribute("aria-hidden", state.accountMenuOpen ? "false" : "true");
  }
  if (trigger) trigger.setAttribute("aria-expanded", state.accountMenuOpen ? "true" : "false");
  if (state.accountMenuOpen && focus) menu?.querySelector("[role=menuitem]")?.focus();
}

function openAccountMenu({ focus = false, pinned = false } = {}) {
  closeMenu({ restoreFocus: false });
  closeSearchPanel({ restoreFocus: false });
  setAccountMenuOpen(true, { focus, pinned });
}

function closeAccountMenu({ restoreFocus = false } = {}) {
  const wasOpen = state.accountMenuOpen;
  setAccountMenuOpen(false);
  if (wasOpen && restoreFocus) $("#account-menu-trigger")?.focus();
}

function handleAccountMenuKeydown(event) {
  if (!event) return false;
  if (event.key === "Escape") {
    event.preventDefault();
    closeAccountMenu({ restoreFocus: true });
    return true;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return false;
  const menu = $("#account-menu");
  const items = menu ? Array.from(menu.querySelectorAll("[role=menuitem]")) : [];
  if (!items.length) return false;
  const currentIndex = items.indexOf(document.activeElement);
  const nextIndex = globalMenuFocusIndex(event.key, currentIndex, items.length);
  event.preventDefault();
  items[nextIndex]?.focus();
  return true;
}

async function executeAccountAction(action) {
  closeAccountMenu({ restoreFocus: false });
  if (action === "settings") {
    await openSettingsModal({ history: true });
  } else if (action === "update") {
    await checkForUpdates({ silent: false });
  } else if (action === "diagnostics") {
    await openSettingsModal({ history: true, section: "diagnostics" });
    await runDiagnostics();
  }
}

function setSearchOpen(open) {
  state.searchOpen = Boolean(open);
  const panel = $("#search-panel");
  const button = $("#search-btn");
  if (panel) {
    panel.classList.toggle("hidden", !state.searchOpen);
    panel.setAttribute("aria-hidden", state.searchOpen ? "false" : "true");
  }
  if (button) button.setAttribute("aria-expanded", state.searchOpen ? "true" : "false");
}

function buildSearchEntries(sessionRecords = [], skillRecords = [], query = "") {
  const needle = String(query || "").trim().toLowerCase();
  const sessions = (sessionRecords || []).map((session) => ({
    kind: "session",
    id: session.id || session.session_id,
    mode: session.mode === "agent" ? "agent" : "chat",
    label: session.name || session.id || session.session_id,
    detail: `${session.mode === "agent" ? "Agent" : "Chat"} · ${session.workdir || "本地会话"}`
  })).filter((item) => item.id);
  const skills = (skillRecords || []).map((skill) => ({
    kind: "skill",
    id: skill.id || skill.filename,
    label: skill.name || skill.filename,
    detail: `${skill.source || "本地"} · ${skill.path || skill.filename || ""}`
  })).filter((item) => item.id);
  const entries = [...sessions, ...skills, ...GLOBAL_SEARCH_COMMANDS];
  return needle
    ? entries.filter((item) => `${item.label} ${item.detail} ${item.id || ""}`.toLowerCase().includes(needle))
    : entries;
}

function searchEntries(query = "") {
  return buildSearchEntries(state.sessionIndex, state.skills, query);
}

function renderSearchResults() {
  const input = $("#global-search-input");
  const container = $("#search-results");
  if (!container) return;
  state.searchResults = searchEntries(input?.value || "");
  state.searchIndex = Math.min(state.searchIndex, Math.max(0, state.searchResults.length - 1));
  container.innerHTML = state.searchResults.length
    ? state.searchResults.map((item, index) => `
      <button class="search-result${index === state.searchIndex ? " active" : ""}" type="button" role="option" aria-selected="${index === state.searchIndex ? "true" : "false"}" data-search-index="${index}">
        <span class="search-result-kind">${escapeHtml(item.kind === "session" ? (item.mode === "agent" ? "Agent" : "Chat") : item.kind === "skill" ? "技能" : "命令")}</span>
        <span class="search-result-main"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail || "")}</small></span>
      </button>
    `).join("")
    : `<div class="search-empty">没有匹配结果</div>`;
}

function openSearchPanel() {
  closeMenu({ restoreFocus: false });
  setSearchOpen(true);
  state.searchIndex = 0;
  renderSearchResults();
  const input = $("#global-search-input");
  input?.focus();
  input?.select();
}

function closeSearchPanel({ restoreFocus = false } = {}) {
  const wasOpen = state.searchOpen;
  setSearchOpen(false);
  if (wasOpen && restoreFocus) $("#search-btn")?.focus();
}

async function executeGlobalAction(action) {
  closeMenu({ restoreFocus: false });
  closeSearchPanel({ restoreFocus: false });
  switch (action) {
    case "new-chat":
      await createSession({ mode: "chat" });
      break;
    case "new-agent-session":
      await createSession({ mode: "agent" });
      break;
    case "skills":
      if (state.viewMode !== "agent") await switchMode("agent", { history: true, quiet: true });
      openSkillsView({ history: true });
      break;
    case "settings":
      await openSettingsModal({ history: true });
      break;
    case "switch-chat":
      await switchMode("chat");
      break;
    case "switch-agent":
      await switchMode("agent");
      break;
    case "toggle-theme":
      toggleTheme();
      break;
    case "diagnostics":
      await openSettingsModal({ history: true });
      await runDiagnostics();
      break;
    default:
      break;
  }
}

async function activateSearchResult(item) {
  if (!item) return;
  closeSearchPanel({ restoreFocus: true });
  if (item.kind === "session") {
    await switchSession(item.id, { history: true });
    return;
  }
  if (item.kind === "skill") {
    if (state.viewMode !== "agent") await switchMode("agent", { history: true, quiet: true });
    openSkillsView({ history: false, recordLocation: false });
    await showSkillDetail(item.id, { history: true });
    return;
  }
  await executeGlobalAction(item.action);
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    applyAccent(getInitialAccent());
    applyFontSize(getInitialFontSize());
    applyTheme(getInitialTheme());
    applyLanguage(getInitialLanguage());
    setSidebarWidth(getInitialSidebarWidth(), { persist: false });
    setSidebarVisible(getInitialSidebarVisible());
    setViewMode("chat");
    bindEvents();
    bindSidebarResize();
    setupDesktopBridge();
    await loadStatus();
    void refreshDailyUsage({ reason: "startup" });
    if ($("#skills-view")) await loadSkills();
    await restoreLastSession();
    void refreshRuntimeStatus();
    checkForUpdates({ silent: true });
  } finally {
    hideLaunchSplash();
  }
});

function hideLaunchSplash() {
  const splash = $("#launch-splash");
  if (!splash) return;
  if (document.documentElement.dataset.skipSplash === "true") {
    splash.remove();
    return;
  }
  const remaining = Math.max(0, LAUNCH_SPLASH_MIN_MS - (performance.now() - launchSplashStarted));
  setTimeout(() => {
    splash.classList.add("is-hiding");
    try {
      sessionStorage.setItem("viniper-ui:launch-splash-seen", "1");
      document.documentElement.dataset.skipSplash = "true";
    } catch {}
    setTimeout(() => splash.remove(), 620);
  }, remaining);
}

function bindEvents() {
  const input = $("#user-input");

  input.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (handleSlashSuggestionKeydown(event)) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      hideSlashSuggestions();
      const activeAgent = state.sessionMode === "agent" && SessionRunRegistry.get(state.sessionId)?.active;
      if (event.ctrlKey && activeAgent) void sendAgentGuidance(state.sessionId, input);
      else void sendMessage();
    }
    if (event.ctrlKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openNewSessionModal();
    }
  });

  input.addEventListener("input", () => {
    autoResize(input);
    updateSlashSuggestions();
  });
  input.addEventListener("click", updateSlashSuggestions);
  input.addEventListener("keyup", (event) => {
    if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
      updateSlashSuggestions();
    }
  });
  const panel = $("#slash-suggestions");
  panel.addEventListener("pointerdown", (event) => {
    const button = event.target.closest("[data-slash-index]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    acceptSlashSuggestion(Number(button.dataset.slashIndex || 0));
  });
  panel.addEventListener("pointerover", (event) => {
    const button = event.target.closest("[data-slash-index]");
    if (!button) return;
    setSlashSuggestionIndex(Number(button.dataset.slashIndex || 0));
  });
  $("#chat-container").addEventListener("scroll", () => {
    if (!SessionScrollRegistry.isProjecting(state.sessionId)) {
      const container = $("#chat-container");
      SessionScrollRegistry.set(state.sessionId, isNearChatBottom(), container?.scrollTop);
    }
    updateMessageTraceRail();
  });
  window.addEventListener("resize", updateMessageTraceRail);
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest("#message-trace-rail")) hideMessageTracePreview();
  }, true);

  $("#send-btn").addEventListener("click", () => sendMessage());
  $("#stop-btn").addEventListener("click", cancelCurrentTask);
  $("#file-btn").addEventListener("click", togglePlusMenu);
  $("#file-input").addEventListener("change", handleFileAttach);
  $("#plus-menu").addEventListener("click", (event) => {
    const button = event.target.closest("[data-plus-action]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    closePlusMenu();
    if (button.dataset.plusAction === "attach") {
      $("#file-input").click();
    }
  });
  $("#peer-picker-button")?.addEventListener("click", () => {
    setPeerMenuOpen(!state.peerMenuOpen, { focus: true });
  });
  $("#peer-menu")?.addEventListener("click", (event) => {
    const option = event.target.closest("[data-peer-session-id]");
    if (option) selectPeerTarget(option.dataset.peerSessionId);
    if (event.target.closest("[data-peer-clear]")) {
      clearPeerTarget();
      setPeerMenuOpen(false, { restoreFocus: true });
    }
  });
  $("#peer-menu")?.addEventListener("keydown", handlePeerMenuKeydown);
  $("#menu-btn")?.addEventListener("click", () => {
    if (state.menuOpen) closeMenu({ restoreFocus: true });
    else openMenu();
  });
  $("#toggle-sidebar-btn").addEventListener("click", () => toggleSidebar("topbar"));
  $("#search-btn")?.addEventListener("click", () => {
    if (state.searchOpen) closeSearchPanel({ restoreFocus: true });
    else openSearchPanel();
  });
  $("#session-history-toggle")?.addEventListener("click", () => {
    const wrap = $("#session-history-search-wrap");
    setSessionHistorySearchVisible(Boolean(wrap?.classList.contains("hidden")), { focus: true });
  });
  $("#session-history-search")?.addEventListener("input", () => {
    void loadSessionList();
  });
  $("#back-btn")?.addEventListener("click", () => navigateHistory("back"));
  $("#forward-btn")?.addEventListener("click", () => navigateHistory("forward"));
  $("#global-menu")?.addEventListener("click", (event) => {
    const action = event.target.closest("[data-menu-action]")?.dataset.menuAction;
    if (action) executeGlobalAction(action);
  });
  $("#global-menu")?.addEventListener("keydown", handleGlobalMenuKeydown);
  $("#search-results")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-search-index]");
    if (!button) return;
    activateSearchResult(state.searchResults[Number(button.dataset.searchIndex)]);
  });
  $("#global-search-input")?.addEventListener("input", () => {
    state.searchIndex = 0;
    renderSearchResults();
  });
  $("#global-search-input")?.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const count = state.searchResults.length;
      if (count) state.searchIndex = (state.searchIndex + delta + count) % count;
      renderSearchResults();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      activateSearchResult(state.searchResults[state.searchIndex]);
    }
  });
  const topbarPinButton = $("#always-on-top-btn");
  if (topbarPinButton) topbarPinButton.addEventListener("click", toggleAlwaysOnTop);
  const accountTrigger = $("#account-menu-trigger");
  accountTrigger?.addEventListener("click", () => {
    const next = accountMenuTransition({ open: state.accountMenuOpen, pinned: state.accountMenuPinned }, "click");
    setAccountMenuOpen(next.open, { focus: next.focus, pinned: next.pinned });
  });
  accountTrigger?.addEventListener("pointerenter", () => {
    const next = accountMenuTransition({ open: state.accountMenuOpen, pinned: state.accountMenuPinned }, "hover");
    setAccountMenuOpen(next.open, { pinned: next.pinned });
  });
  $(".sidebar-footer")?.addEventListener("pointerenter", () => {
    const next = accountMenuTransition({ open: state.accountMenuOpen, pinned: state.accountMenuPinned }, "hover");
    setAccountMenuOpen(next.open, { pinned: next.pinned });
  });
  $(".sidebar-footer")?.addEventListener("focusin", () => {
    const next = accountMenuTransition({ open: state.accountMenuOpen, pinned: state.accountMenuPinned }, "focus");
    setAccountMenuOpen(next.open, { pinned: next.pinned });
  });
  $(".sidebar-footer")?.addEventListener("pointerleave", () => {
    if (!$(".sidebar-footer")?.contains(document.activeElement)) {
      const next = accountMenuTransition({ open: state.accountMenuOpen, pinned: state.accountMenuPinned }, "leave");
      setAccountMenuOpen(next.open, { pinned: next.pinned });
    }
  });
  accountTrigger?.addEventListener("keydown", (event) => {
    if (!["Enter", " ", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    openAccountMenu({ focus: true, pinned: true });
  });
  $("#account-menu")?.addEventListener("keydown", handleAccountMenuKeydown);
  $("#account-menu")?.addEventListener("click", (event) => {
    const action = event.target.closest("[data-account-action]")?.dataset.accountAction;
    if (action) void executeAccountAction(action);
  });
  $("#session-context-menu")?.addEventListener("click", (event) => {
    const action = event.target.closest("[data-session-action]")?.dataset.sessionAction;
    if (action) void executeSessionMenuAction(action);
  });
  $("#session-context-menu")?.addEventListener("keydown", handleSessionMenuKeydown);
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#session-context-menu, [data-session-menu]")) closeSessionMenu();
  }, true);
  $("#session-title-button")?.addEventListener("click", () => {
    if (state.viewMode !== "agent" || !state.sessionId) return;
    startInlineSessionRename();
  });
  $("#session-header-menu-button")?.addEventListener("click", (event) => {
    if (state.viewMode !== "agent" || !state.sessionId) return;
    event.stopPropagation();
    const button = event.currentTarget;
    if (!$("#session-context-menu")?.classList.contains("hidden") && state.sessionMenuSessionId === String(state.sessionId)) {
      closeSessionMenu({ restoreFocus: true });
    } else {
      openSessionMenu(state.sessionId, button);
    }
  });
  $("#new-chat-btn")?.addEventListener("click", openNewSessionModal);
  $("#new-session-nav-btn")?.addEventListener("click", openNewSessionModal);
  $("#project-btn")?.addEventListener("click", changeWorkdir);
  $("#customize-btn")?.addEventListener("click", openSkillsView);
  $("#chat-view-btn")?.addEventListener("click", () => switchMode("chat"));
  $("#agent-view-btn")?.addEventListener("click", () => switchMode("agent"));
  $$("[data-settings-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      activateSettingsSection(button.dataset.settingsNav);
    });
  });
  $("#settings-search")?.addEventListener("input", filterSettingsCenter);
  $("#settings-search-results")?.addEventListener("click", (event) => {
    const result = event.target.closest("[data-settings-search-target]");
    if (!result) return;
    const section = result.dataset.settingsSearchSection || "account";
    activateSettingsSection(section);
    const target = document.getElementById(result.dataset.settingsSearchTarget || "");
    target?.scrollIntoView?.({ block: "center" });
    target?.querySelector?.("input, select, textarea, button")?.focus?.();
  });
  $(".rail-close")?.addEventListener("click", () => {
    $("#workspace-rail")?.classList.add("hidden");
  });
  $("#close-skills-view-btn")?.addEventListener("click", closeSkillsView);
  if ($("#skill-search")) $("#skill-search").addEventListener("input", renderSkillList);
  if ($("#back-to-skills")) $("#back-to-skills").addEventListener("click", returnToSkillList);
  if ($("#use-skill-btn")) $("#use-skill-btn").addEventListener("click", useSkill);
  $("#change-workdir-btn")?.addEventListener("click", changeWorkdir);
  $("#update-btn").addEventListener("click", () => checkForUpdates({ silent: false }));
  $("#cancel-update-btn").addEventListener("click", closeUpdateModal);
  $("#install-update-btn").addEventListener("click", installUpdate);
  $("#settings-close-btn")?.addEventListener("click", closeSettingsModal);
  $("#cancel-settings-btn")?.addEventListener("click", closeSettingsModal);
  $("#save-settings-btn").addEventListener("click", saveSettings);
  $("#run-diagnostics-btn").addEventListener("click", runDiagnostics);
  $("#settings-models").addEventListener("input", renderSettingsModelSelect);
  $("#settings-enable-auto-mode")?.addEventListener("change", () => renderSettingsPermissionOptions());
  $("#settings-allow-bypass-permissions")?.addEventListener("change", () => renderSettingsPermissionOptions());
  $(".settings-center-content")?.addEventListener("input", (event) => {
    if (event.target.matches("input, select, textarea")) markSettingsDirty();
  });
  $(".settings-center-content")?.addEventListener("change", (event) => {
    if (event.target.matches("input, select, textarea")) markSettingsDirty();
  });
  $("#settings-check-update-btn")?.addEventListener("click", () => checkForUpdates({ silent: false }));
  $("#settings-runtime-setup-btn")?.addEventListener("click", runRuntimeSetup);
  $("#settings-runtime-update-btn")?.addEventListener("click", updateAgentRuntime);
  $("#settings-runtime-diagnostics-btn")?.addEventListener("click", openRuntimeDiagnostics);
  $("#messages")?.addEventListener("click", (event) => {
    const action = event.target.closest("[data-runtime-action]")?.dataset.runtimeAction;
    if (action === "setup") void runRuntimeSetup();
    if (action === "later") void switchMode("chat", { history: true });
    if (action === "diagnostics") void openRuntimeDiagnostics();
    const usageRange = event.target.closest("[data-usage-range]")?.dataset.usageRange;
    if (usageRange) {
      void selectDailyUsageRange(Number(usageRange));
    } else if (event.target.closest('[data-usage-action="retry"]')) {
      void refreshDailyUsage({ force: true, reason: "manual-retry" });
    }
  });
  $("#open-settings-skills-btn")?.addEventListener("click", () => {
    closeSettingsModal({ restoreNavigation: false });
    void openSkillsView({ history: true });
  });
  $("#model-select").addEventListener("change", (event) => selectModel(event.target.value));
  $("#permission-select").addEventListener("change", (event) => selectPermissionMode(event.target.value));
  $("#model-picker-button")?.addEventListener("click", () => {
    setAnchoredMenuOpen("model", !state.modelMenuOpen, { focus: true });
  });
  $("#permission-picker-button")?.addEventListener("click", () => {
    setAnchoredMenuOpen("permission", !state.permissionMenuOpen, { focus: true });
  });
  $("#model-menu")?.addEventListener("click", (event) => {
    const option = event.target.closest("[data-model-id]");
    if (option) selectModel(option.dataset.modelId, { closeMenu: true, restoreFocus: true });
  });
  $("#permission-menu")?.addEventListener("click", (event) => {
    const option = event.target.closest("[data-permission-mode]");
    if (option) selectPermissionMode(option.dataset.permissionMode, { closeMenu: true, restoreFocus: true });
  });
  $("#model-menu")?.addEventListener("keydown", (event) => handleAnchoredMenuKeydown(event, "model"));
  $("#permission-menu")?.addEventListener("keydown", (event) => handleAnchoredMenuKeydown(event, "permission"));
  $("#context-meter")?.addEventListener("click", () => {
    setContextPopoverOpen($("#context-meter")?.getAttribute("aria-expanded") !== "true");
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".context-usage-control")) setContextPopoverOpen(false);
    if (!event.target.closest('[data-picker="model"]')) setAnchoredMenuOpen("model", false);
    if (!event.target.closest('[data-picker="permission"]')) setAnchoredMenuOpen("permission", false);
  }, true);
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
  $("#cancel-text-input-btn")?.addEventListener("click", () => closeTextInputModal(null));
  $("#confirm-text-input-btn")?.addEventListener("click", () => closeTextInputModal($("#text-input-value")?.value.trim() || null));
  $("#text-input-value")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      closeTextInputModal($("#text-input-value")?.value.trim() || null);
    }
  });
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
  bindFileDrop();
  bindClipboardPaste();

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "i") {
      event.preventDefault();
      setAnchoredMenuOpen("model", true, { focus: true });
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key === ",") {
      event.preventDefault();
      void openSettingsModal({ history: true });
      return;
    }
    if (event.key === "Escape") {
      if (!$("#message-trace-preview")?.classList.contains("hidden")) {
        hideMessageTracePreview();
        return;
      }
      if (state.peerMenuOpen) {
        setPeerMenuOpen(false, { restoreFocus: true });
        return;
      }
      if (state.modelMenuOpen) {
        setAnchoredMenuOpen("model", false, { restoreFocus: true });
        return;
      }
      if (state.permissionMenuOpen) {
        setAnchoredMenuOpen("permission", false, { restoreFocus: true });
        return;
      }
      if (!$("#context-popover")?.classList.contains("hidden")) {
        setContextPopoverOpen(false);
        $("#context-meter")?.focus();
        return;
      }
      if (state.accountMenuOpen) {
        closeAccountMenu({ restoreFocus: true });
        return;
      }
      if (!$("#session-context-menu")?.classList.contains("hidden")) {
        closeSessionMenu({ restoreFocus: true });
        return;
      }
      if (state.searchOpen) {
        closeSearchPanel({ restoreFocus: true });
        return;
      }
      if (state.menuOpen) {
        closeMenu({ restoreFocus: true });
        return;
      }
      if (!$("#settings-modal")?.classList.contains("hidden")) {
        closeSettingsModal();
        return;
      }
      if (!$("#skills-view")?.classList.contains("hidden")) {
        closeSkillsView();
        return;
      }
      closeFolderPicker();
      closePlusMenu();
      closeNewSessionModal();
      closeDeleteSessionModal(false);
      closeRenameSessionModal(null);
      closeTextInputModal(null);
    }
  });
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (state.theme === "system") applyTheme("system");
    });
  }
  document.addEventListener("click", (event) => {
    if (state.accountMenuOpen && !event.target.closest("#account-menu") && !event.target.closest("#account-menu-trigger")) {
      closeAccountMenu({ restoreFocus: false });
    }
    if (!event.target.closest("#plus-menu") && !event.target.closest("#file-btn")) {
      closePlusMenu();
    }
    if (!event.target.closest("[data-peer-picker]")) {
      setPeerMenuOpen(false);
    }
    if (!event.target.closest("#slash-suggestions") && !event.target.closest("#composer")) {
      hideSlashSuggestions();
    }

  });

  document.addEventListener("pointerdown", (event) => {
    if (state.accountMenuOpen && !event.target.closest(".sidebar-footer")) {
      closeAccountMenu({ restoreFocus: false });
    }
    if (state.menuOpen && !event.target.closest("#global-menu") && !event.target.closest("#menu-btn")) {
      closeMenu({ restoreFocus: true });
    }
    if (state.searchOpen && !event.target.closest("#search-panel") && !event.target.closest("#search-btn")) {
      closeSearchPanel({ restoreFocus: true });
    }
  });

  document.addEventListener("click", async (event) => {
    const peerReply = event.target.closest("[data-peer-reply-session]");
    if (peerReply) {
      const senderSessionId = String(peerReply.dataset.peerReplySession || "");
      await refreshPeerStatus();
      if (!selectPeerTarget(senderSessionId)) {
        $("#status-line").textContent = "发送方会话已不在原生活跃注册表中";
      }
      return;
    }
    const fileButton = event.target.closest("[data-file-action]");
    if (fileButton) {
      const fileRow = fileButton.closest(".artifact-summary, .artifact-card");
      const status = fileRow?.querySelector(".artifact-inline-status");
      try {
        await openArtifactPath(fileButton.dataset.filePath || "", fileButton.dataset.fileAction || "open");
      } catch (error) {
        if (status) status.textContent = "文件已不存在";
        fileRow?.classList.add("artifact-stale");
        fileRow?.querySelectorAll("[data-file-action]").forEach((button) => {
          button.disabled = true;
          button.setAttribute("aria-disabled", "true");
        });
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

function normalizeSettingsSection(key = "account") {
  const aliases = { general: "account", models: "provider" };
  const selected = aliases[String(key || "account")] || String(key || "account");
  return $(`[data-settings-panel="${selected}"]`) ? selected : "account";
}

function activateSettingsSection(key = "account", { recordLocation = true } = {}) {
  const selected = normalizeSettingsSection(key);
  state.settingsActiveSection = selected;
  $$("[data-settings-nav]").forEach((item) => {
    const active = item.dataset.settingsNav === selected;
    item.classList.toggle("active", active);
    item.setAttribute("aria-current", active ? "page" : "false");
  });
  $$("[data-settings-panel]").forEach((panel) => {
    panel.classList.toggle("settings-panel-muted", panel.dataset.settingsPanel !== selected);
  });
  const content = $(".settings-center-content");
  if (content) content.scrollTop = 0;
  if (recordLocation && state.navigation.current?.kind === "settings") {
    setNavigationLocation({ kind: "settings", section: selected });
  }
}

function filterSettingsCenter(eventOrQuery = "") {
  const raw = typeof eventOrQuery === "string"
    ? eventOrQuery
    : eventOrQuery?.target?.value || $("#settings-search")?.value || "";
  const query = String(raw).trim().toLocaleLowerCase("zh-CN");
  const results = $("#settings-search-results");
  const navItems = $$("[data-settings-nav]");
  if (!results) return [];
  if (!query) {
    results.innerHTML = "";
    results.classList.add("hidden");
    navItems.forEach((item) => item.classList.remove("hidden"));
    return [];
  }

  const matches = $$("[data-settings-label]").filter((row) => {
    const panel = row.closest("[data-settings-panel]");
    const haystack = `${row.dataset.settingsLabel || ""} ${row.textContent || ""} ${panel?.dataset.settingsKeywords || ""}`.toLocaleLowerCase("zh-CN");
    return haystack.includes(query);
  }).map((row) => {
    const panel = row.closest("[data-settings-panel]");
    const section = panel?.dataset.settingsPanel || "account";
    const label = row.dataset.settingsLabel || row.querySelector("label, .settings-field-label")?.textContent || section;
    return { section, target: row.id, label: String(label).trim() };
  });

  const matchingSections = new Set(matches.map((item) => item.section));
  navItems.forEach((item) => item.classList.toggle("hidden", !matchingSections.has(item.dataset.settingsNav)));
  results.classList.remove("hidden");
  results.innerHTML = matches.length
    ? matches.map((item) => `<button type="button" data-settings-search-section="${escapeAttr(item.section)}" data-settings-search-target="${escapeAttr(item.target)}"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml($(`[data-settings-nav="${item.section}"] span`)?.textContent || "设置")}</span></button>`).join("")
    : `<p class="settings-search-empty">没有找到“${escapeHtml(raw)}”</p>`;
  return matches;
}

function markSettingsDirty(message = "有未保存的更改") {
  state.settingsDirty = true;
  $("#settings-save-status").textContent = message;
  $("#settings-action-bar").classList.remove("hidden");
}

function clearSettingsDirty() {
  state.settingsDirty = false;
  $("#settings-save-status").textContent = "已保存";
  $("#settings-action-bar").classList.add("hidden");
}

function bindSidebarResize() {
  const resizer = $("#sidebar-resizer");
  if (!resizer) return;

  const clearGesture = ({ cancelled = false } = {}) => {
    const gesture = state.sidebarGesture;
    if (cancelled && Number.isFinite(gesture.startWidth)) {
      setSidebarWidth(gesture.startWidth, { persist: false });
    }
    state.sidebarResizing = false;
    state.sidebarGesture = { startX: 0, startWidth: state.sidebarWidth, dragging: false, pointerId: null };
    document.body.classList.remove("sidebar-resizing", "sidebar-gesture-active");
    if (gesture.pointerId !== null && resizer.hasPointerCapture?.(gesture.pointerId)) {
      resizer.releasePointerCapture?.(gesture.pointerId);
    }
    if (cancelled) updateSidebarControls();
  };

  resizer.addEventListener("pointerdown", (event) => {
    const action = sidebarPointerStartAction({
      visible: state.sidebarVisible,
      narrow: sidebarIsNarrow(),
      button: event.button
    });
    if (action === "ignore") return;
    if (action === "toggle") {
      event.preventDefault();
      toggleSidebar("splitter-collapsed-click");
      return;
    }
    event.preventDefault();
    resizer.setPointerCapture?.(event.pointerId);
    state.sidebarGesture = {
      startX: event.clientX,
      startWidth: state.sidebarWidth,
      dragging: false,
      pointerId: event.pointerId
    };
    state.sidebarResizing = true;
    document.body.classList.add("sidebar-gesture-active");
  });

  resizer.addEventListener("pointermove", (event) => {
    const gesture = state.sidebarGesture;
    if (!state.sidebarResizing || gesture.pointerId !== event.pointerId) return;
    const decision = sidebarGestureDecision(gesture.startX, event.clientX);
    if (!gesture.dragging && decision.dragging) {
      gesture.dragging = true;
      document.body.classList.add("sidebar-resizing");
    }
    if (gesture.dragging) {
      setSidebarWidth(gesture.startWidth + decision.delta, { persist: false });
      event.preventDefault();
    }
  });

  resizer.addEventListener("pointerup", (event) => {
    const gesture = state.sidebarGesture;
    if (!state.sidebarResizing || gesture.pointerId !== event.pointerId) return;
    if (gesture.dragging) {
      storageSet(SIDEBAR_WIDTH_KEY, String(state.sidebarWidth));
    } else {
      toggleSidebar("splitter-click");
    }
    clearGesture();
  });

  resizer.addEventListener("pointercancel", (event) => {
    if (state.sidebarGesture.pointerId === event.pointerId) clearGesture({ cancelled: true });
  });
  resizer.addEventListener("lostpointercapture", () => {
    if (state.sidebarResizing) clearGesture({ cancelled: true });
  });
  resizer.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleSidebar("splitter-keyboard");
  });
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "b") {
      event.preventDefault();
      toggleSidebar("ctrl-b");
    }
  });
  window.addEventListener("resize", () => {
    if (!state.sidebarVisible) return;
    setSidebarWidth(state.sidebarWidth, { persist: false });
  });
  updateSidebarControls();
}

function setupDesktopBridge() {
  const desktop = window.viniperDesktop;
  document.body.classList.toggle("platform-win32", desktop?.platform === "win32");
  if (!desktop) {
    updateWindowPinButton();
    return;
  }

  desktop.getWindowState?.().then((statePayload) => {
    state.alwaysOnTop = Boolean(statePayload?.alwaysOnTop);
    updateWindowPinButton();
  }).catch(() => {});

  desktop.onWindowState?.((statePayload) => {
    state.alwaysOnTop = Boolean(statePayload?.alwaysOnTop);
    updateWindowPinButton();
  });

  desktop.onCommand?.((payload) => {
    handleDesktopCommand(payload?.command, payload?.payload || {});
  });
}

function notifyDesktopConversationCompleted() {
  try {
    window.viniperDesktop?.conversationCompleted?.();
  } catch {}
}

function handleDesktopCommand(command) {
  switch (command) {
    case "new-chat":
      openNewSessionModal();
      break;
    case "attach-file":
      $("#file-input").click();
      break;
    case "change-workdir":
      changeWorkdir();
      break;
    case "toggle-sidebar":
      toggleSidebar();
      break;
    case "open-settings":
      openSettingsModal();
      break;
    case "run-diagnostics":
      openSettingsModal().then(() => runDiagnostics()).catch(() => {});
      break;
    default:
      break;
  }
}

async function toggleAlwaysOnTop() {
  const desktop = window.viniperDesktop;
  if (!desktop?.setAlwaysOnTop) {
    state.alwaysOnTop = !state.alwaysOnTop;
    updateWindowPinButton();
    return;
  }
  try {
    const next = !state.alwaysOnTop;
    const result = await desktop.setAlwaysOnTop(next);
    state.alwaysOnTop = Boolean(result?.alwaysOnTop);
  } catch {
    state.alwaysOnTop = false;
  }
  updateWindowPinButton();
}

async function setSessionPinned(sessionId, pinned) {
  if (!sessionId) return;
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: Boolean(pinned) })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.detail || `HTTP ${response.status}`);
    }
    if (sessionId === state.sessionId) {
      state.sessionPinned = Boolean(data.session?.pinned);
    }
    await loadSessionList();
  } catch (error) {
    showInlineStatus(`会话置顶失败：${error.message}`, { kind: "error", timeout: 5200 });
    await loadSessionList();
  }
}

function togglePlusMenu(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const menu = $("#plus-menu");
  if (!menu) return;
  menu.classList.toggle("hidden");
}

function closePlusMenu() {
  const menu = $("#plus-menu");
  if (menu) menu.classList.add("hidden");
}

function slashSuggestionContext() {
  if (state.viewMode !== "agent") return null;
  const input = $("#user-input");
  if (!input || document.activeElement !== input || input.disabled) return null;
  const caret = Number.isFinite(input.selectionStart) ? input.selectionStart : input.value.length;
  const before = input.value.slice(0, caret);
  const after = input.value.slice(caret);
  const match = before.match(/^\/([^\s\n]*)$/);
  if (!match) return null;
  return { input, caret, query: match[1].toLowerCase(), after };
}

function buildSlashSuggestionCandidates(query) {
  const seen = new Set();
  const nativeItems = CLAUDE_NATIVE_SLASH_COMMANDS.map((item) => ({ ...item, kind: "native" }));
  const skillItems = (state.skills || []).map((skill) => ({
    command: `/${skill.command || skill.name || skill.id}`,
    title: skill.title || skill.name || skill.id || skill.command || "skill",
    description: skill.description || skill.desc || "",
    source: "Skill",
    kind: "skill"
  }));

  return [...nativeItems, ...skillItems]
    .filter((item) => {
      const command = String(item.command || "").trim();
      if (!command || seen.has(command.toLowerCase())) return false;
      seen.add(command.toLowerCase());
      if (!query) return true;
      const haystack = [
        command,
        item.title || "",
        item.description || "",
        item.source || ""
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => {
      const aPrefix = a.command.toLowerCase().startsWith(`/${query}`) ? 0 : 1;
      const bPrefix = b.command.toLowerCase().startsWith(`/${query}`) ? 0 : 1;
      if (aPrefix !== bPrefix) return aPrefix - bPrefix;
      if (a.kind !== b.kind) return a.kind === "native" ? -1 : 1;
      return a.command.localeCompare(b.command);
    })
    .slice(0, 10);
}

function hideSlashSuggestions() {
  const panel = $("#slash-suggestions");
  if (!panel) return;
  panel.classList.add("hidden");
  panel.innerHTML = "";
  state.slashSuggestions = [];
  state.slashSuggestionIndex = 0;
  const input = $("#user-input");
  input?.removeAttribute("aria-activedescendant");
  input?.removeAttribute("aria-controls");
  input?.removeAttribute("aria-expanded");
}

function updateSlashSuggestions() {
  if (state.viewMode !== "agent") {
    hideSlashSuggestions();
    return;
  }
  const context = slashSuggestionContext();
  if (!context) {
    hideSlashSuggestions();
    return;
  }
  const suggestions = buildSlashSuggestionCandidates(context.query);
  if (!suggestions.length) {
    hideSlashSuggestions();
    return;
  }
  state.slashSuggestions = suggestions;
  state.slashSuggestionIndex = Math.min(state.slashSuggestionIndex, suggestions.length - 1);
  renderSlashSuggestions();
}

function renderSlashSuggestions() {
  const panel = $("#slash-suggestions");
  const input = $("#user-input");
  if (!panel || !input || !state.slashSuggestions.length) return;
  panel.innerHTML = state.slashSuggestions.map((item, index) => `
    <button
      id="slash-suggestion-${index}"
      class="slash-suggestion-item ${index === state.slashSuggestionIndex ? "active" : ""}"
      type="button"
      role="option"
      aria-selected="${index === state.slashSuggestionIndex ? "true" : "false"}"
      data-slash-index="${index}"
    >
      <span class="slash-suggestion-command">${escapeHtml(item.command)}</span>
      <span class="slash-suggestion-title">${escapeHtml(item.title || item.command)}</span>
      <span class="slash-suggestion-source">${escapeHtml(item.source || "")}</span>
      ${item.description ? `<span class="slash-suggestion-desc">${escapeHtml(item.description)}</span>` : ""}
    </button>
  `).join("");
  panel.classList.remove("hidden");
  input.setAttribute("aria-controls", "slash-suggestions");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-activedescendant", `slash-suggestion-${state.slashSuggestionIndex}`);
}

function setSlashSuggestionIndex(index) {
  const next = Math.max(0, Math.min(Number(index) || 0, state.slashSuggestions.length - 1));
  if (next === state.slashSuggestionIndex) return;
  state.slashSuggestionIndex = next;
  $$("#slash-suggestions [data-slash-index]").forEach((button) => {
    const active = Number(button.dataset.slashIndex || 0) === next;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  $("#user-input")?.setAttribute("aria-activedescendant", `slash-suggestion-${next}`);
}

function acceptSlashSuggestion(index = state.slashSuggestionIndex) {
  const context = slashSuggestionContext();
  const item = state.slashSuggestions[index];
  if (!context || !item) return false;
  const after = context.after.replace(/^\s+/, "");
  const insert = `${item.command} `;
  context.input.value = `${insert}${after}`;
  context.input.selectionStart = insert.length;
  context.input.selectionEnd = insert.length;
  autoResize(context.input);
  hideSlashSuggestions();
  context.input.focus();
  return true;
}

function handleSlashSuggestionKeydown(event) {
  const panel = $("#slash-suggestions");
  if (!panel || panel.classList.contains("hidden") || !state.slashSuggestions.length) return false;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    setSlashSuggestionIndex((state.slashSuggestionIndex + 1) % state.slashSuggestions.length);
    return true;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    setSlashSuggestionIndex((state.slashSuggestionIndex - 1 + state.slashSuggestions.length) % state.slashSuggestions.length);
    return true;
  }
  if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    acceptSlashSuggestion();
    return true;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    hideSlashSuggestions();
    return true;
  }
  return false;
}

async function loadStatus() {
  try {
    const response = await fetch("/api/status");
    state.status = await response.json();
    state.previewMode =
      Boolean(state.status?.preview) || new URLSearchParams(window.location.search).get("preview") === "1";
    document.body.classList.toggle("preview-mode", state.previewMode);
    updateRuntimeProfileChrome();
    applySettingsFromServer(state.status.settings);
    const rememberedModel = storageGet(MODEL_KEY);
    const available = (state.status.models || []).map((model) => model.id);
    state.selectedModel = available.includes(rememberedModel)
      ? rememberedModel
      : (state.status.model || "deepseek-v4-pro[1m]");
    state.permissionMode = sanitizePermissionMode(state.status.permission_mode || "default");
    renderModelSelect();
    renderPermissionSelect();
    updateModelLabels();
    updateContextMeter();
    renderUpdateButton();
    renderRuntimeSettings(state.status.runtime);
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
      showInlineStatus(data.message || (data.configured === false ? "还没有配置更新源。" : "当前已经是最新版本。"), { kind: "info", timeout: 4200 });
    }
    return data;
  } catch (error) {
    if (!silent) showInlineStatus(`检查更新失败：${error.message}`, { kind: "error", timeout: 5200 });
    return null;
  } finally {
    if (button) button.disabled = false;
  }
}

function showUpdateModal(info) {
  const modal = $("#update-modal");
  if (!modal) return;
  const strategy = info.requires_installer ? " 此版本包含 WSL2 运行时迁移，必须使用完整 Windows 安装器。" : "";
  $("#update-summary").textContent = `当前版本 v${info.current_version || "?"}，最新版本 v${info.latest_version || "?"}。${strategy}`;
  $("#update-notes").textContent = info.notes || "这个版本包含最新修复和功能更新。";
  $("#install-update-btn").textContent = info.requires_installer ? "打开完整安装器" : "立即更新";
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
    showInlineStatus("当前没有可安装的新版本。", { kind: "info", timeout: 4200 });
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
      showInlineStatus(data.message || `更新已安装，请重新打开 ${APP_TITLE}。`, { kind: "info", timeout: 5200 });
    }
  } catch (error) {
    $("#update-notes").textContent = `更新失败：${error.message}`;
    button.textContent = oldText;
    button.disabled = false;
    $("#cancel-update-btn").disabled = false;
  }
}

function runtimeProfileChromeCopy(previewMode) {
  return previewMode
    ? {
        profileLabel: "预览环境",
        composerStatus: "本地会话 · 数据保存在当前 Preview 环境"
      }
    : {
        profileLabel: "本地环境",
        composerStatus: "本地会话 · 数据保存在当前 Viniper 环境"
      };
}

function updateRuntimeProfileChrome() {
  const copy = runtimeProfileChromeCopy(state.previewMode);
  const profileLabel = $("#profile-label");
  const composerStatus = $("#composer-status");
  if (profileLabel) profileLabel.textContent = copy.profileLabel;
  if (composerStatus) composerStatus.textContent = copy.composerStatus;
}

function runtimeSetupViewModel(runtime = {}) {
  const status = String(runtime?.status || "checking");
  const version = String(runtime?.version || "").trim();
  const base = {
    status,
    ready: Boolean(runtime?.ready || status === "ready"),
    canInstall: true,
    needsReboot: Boolean(runtime?.needs_reboot || status === "reboot_required"),
    title: "正在检查 Agent 运行时",
    detail: "Viniper 正在确认 WSL2、受管发行版与 Claude Code。",
    actionLabel: "安装运行时",
    progress: "检查中"
  };
  if (base.ready) {
    return {
      ...base,
      canInstall: false,
      title: "Agent 运行时已就绪",
      detail: version ? `ViniperRuntime · Claude Code ${version}` : "ViniperRuntime 已通过兼容检查。",
      actionLabel: "运行时已就绪",
      progress: "已完成"
    };
  }
  if (status === "wsl_missing") {
    return {
      ...base,
      title: "启用 WSL2 以使用 Agent",
      detail: "Windows 会显示一次 UAC 确认。完成后可能需要重启；Chat 始终可以继续使用。",
      actionLabel: "启用并安装",
      progress: "等待安装"
    };
  }
  if (status === "distro_missing") {
    return {
      ...base,
      title: "安装 ViniperRuntime",
      detail: "将下载 Ubuntu 24.04 与 Claude Code，并创建专用的非 root 运行用户。",
      actionLabel: "开始安装",
      progress: "尚未下载"
    };
  }
  if (base.needsReboot) {
    return {
      ...base,
      canInstall: false,
      title: "需要重启 Windows",
      detail: "WSL2 功能已请求。重启后再次打开 Viniper，安装会从当前步骤继续。",
      actionLabel: "等待重启",
      progress: "等待重启"
    };
  }
  if (["installing", "configuring", "cli_installing", "verifying"].includes(status)) {
    const labels = {
      installing: "正在下载 ViniperRuntime",
      configuring: "正在配置非 root 运行环境",
      cli_installing: "正在安装 Claude Code",
      verifying: "正在执行兼容检查"
    };
    return {
      ...base,
      canInstall: false,
      title: labels[status],
      detail: "请保持 Viniper 打开；活动 Agent 会话不会在此过程中被替换。",
      actionLabel: "正在处理",
      progress: labels[status]
    };
  }
  return {
    ...base,
    title: "Agent 运行时需要修复",
    detail: "上次设置未完成。可以重试、打开诊断，或稍后继续使用 Chat。",
    actionLabel: "重试设置",
    progress: "可恢复"
  };
}

function renderRuntimeSettings(runtime = state.status?.runtime || {}) {
  const view = runtimeSetupViewModel(runtime);
  const status = $("#settings-runtime-status");
  const setupButton = $("#settings-runtime-setup-btn");
  const updateButton = $("#settings-runtime-update-btn");
  if (status) {
    status.classList.toggle("ready", view.ready);
    status.classList.toggle("not-ready", !view.ready);
    status.innerHTML = `<strong>${escapeHtml(view.title)}</strong><span>${escapeHtml(view.detail)}</span>`;
  }
  if (setupButton) {
    setupButton.textContent = state.runtimeBusy ? "正在处理" : view.actionLabel;
    setupButton.disabled = state.runtimeBusy || !view.canInstall;
    setupButton.classList.toggle("hidden", view.ready);
  }
  if (updateButton) {
    updateButton.classList.toggle("hidden", !view.ready);
    updateButton.disabled = state.runtimeBusy;
    const update = runtime?.update || {};
    updateButton.textContent = ["current", "compatible"].includes(update.status)
      ? "Claude Code 已检查"
      : "检查 Claude Code 更新";
  }
}

async function refreshRuntimeStatus({ rerender = true } = {}) {
  const response = await fetch("/api/runtime/status", { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.detail || "无法读取 Agent 运行时状态");
  const runtime = data.runtime || {};
  state.status = { ...(state.status || {}), runtime };
  renderRuntimeSettings(runtime);
  if (rerender && state.viewMode === "agent" && !state.messages.length) renderWelcome();
  return runtime;
}

async function recordRuntimePlatformResult(succeeded) {
  const response = await fetch("/api/runtime/platform-result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ succeeded: Boolean(succeeded) })
  });
  const data = await response.json().catch(() => ({}));
  if (data.runtime) state.status = { ...(state.status || {}), runtime: data.runtime };
  return data.runtime || {};
}

async function runRuntimeSetup() {
  if (state.runtimeBusy) return;
  state.runtimeBusy = true;
  renderRuntimeSettings();
  if (state.viewMode === "agent" && !state.messages.length) renderWelcome();
  try {
    let runtime = await refreshRuntimeStatus({ rerender: false });
    if (runtime.status === "wsl_missing") {
      const bridge = window.viniperDesktop?.enableWslPlatform;
      if (typeof bridge !== "function") {
        throw new Error("请从 Viniper Desktop 打开安装入口；浏览器页面不能请求 Windows UAC。 ");
      }
      const platform = await bridge();
      runtime = await recordRuntimePlatformResult(Boolean(platform?.ok));
      if (!platform?.ok) throw new Error(platform?.message || "WSL2 安装未完成");
      runtime = await refreshRuntimeStatus({ rerender: false });
    }
    if (runtime.status === "reboot_required" || runtime.needs_reboot) return;
    if (!runtime.ready) {
      const response = await fetch("/api/runtime/provision", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "Agent 运行时设置失败");
      runtime = await refreshRuntimeStatus({ rerender: false });
    }
  } catch (error) {
    const status = $("#settings-runtime-status");
    if (status) status.innerHTML = `<strong>Agent 运行时未完成</strong><span>${escapeHtml(error.message)}</span>`;
  } finally {
    state.runtimeBusy = false;
    renderRuntimeSettings();
    if (state.viewMode === "agent" && !state.messages.length) renderWelcome();
  }
}

async function updateAgentRuntime() {
  if (state.runtimeBusy) return;
  state.runtimeBusy = true;
  renderRuntimeSettings();
  try {
    const response = await fetch("/api/runtime/update", { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.detail || data.runtime_update?.detail || "Claude Code 更新检查未完成");
    await refreshRuntimeStatus({ rerender: false });
  } catch (error) {
    const status = $("#settings-runtime-status");
    if (status) status.innerHTML = `<strong>更新检查未完成</strong><span>${escapeHtml(error.message)}</span>`;
  } finally {
    state.runtimeBusy = false;
    renderRuntimeSettings();
  }
}

async function openRuntimeDiagnostics() {
  await openSettingsModal({ section: "diagnostics", history: true });
  await runDiagnostics();
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
  $("#update-notes").textContent = `更新已安装，但自动刷新超时。请手动重新打开 ${APP_TITLE}。`;
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
    <option value="${escapeAttr(item.id)}"${item.available === false || item.enabled === false ? " disabled" : ""} title="${escapeAttr(item.reason || item.title || item.description || "")}">
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

async function openSettingsModal({ history = true, section = null } = {}) {
  closeAccountMenu({ restoreFocus: false });
  closeSkillsView({ restoreNavigation: false });
  const [data, instructionData, runtimeData] = await Promise.all([
    fetch("/api/settings").then((response) => response.json()).catch(() => ({})),
    fetch("/api/agent-instructions").then((response) => response.json()).catch(() => ({})),
    fetch("/api/runtime/status").then((response) => response.json()).catch(() => ({}))
  ]);
  if (data.settings) {
    state.settings = data.settings;
    state.status = {
      ...(state.status || {}),
      shells: data.shells,
      languages: data.languages,
      themes: data.themes,
      accents: data.accents,
      font_sizes: data.font_sizes,
      models: data.models
    };
  }
  if (instructionData.ok !== false && typeof instructionData.content === "string") {
    state.agentInstructions = {
      content: instructionData.content,
      exists: Boolean(instructionData.exists),
      path: instructionData.path || "",
      updated_at: instructionData.updated_at ?? null
    };
  }

  const settings = state.settings || state.status?.settings || {};
  const account = settings.account || {};
  const appearance = settings.appearance || {};
  const shell = settings.shell || {};
  const provider = settings.provider || {};
  const workspace = settings.workspace || {};
  const runtimeSettings = settings.runtime || {};
  const runtime = runtimeData.runtime || runtimeData;

  $("#settings-display-name").value = account.display_name || "";
  $("#settings-signed-in").checked = Boolean(account.signed_in);
  renderSettingsOptions($("#settings-language"), state.status?.languages || [], appearance.language || state.language);
  renderSettingsOptions($("#settings-theme"), state.status?.themes || [], appearance.theme || state.theme);
  renderSettingsOptions($("#settings-accent"), state.status?.accents || [], appearance.accent || state.accent);
  renderSettingsOptions($("#settings-font-size"), state.status?.font_sizes || FONT_SIZE_OPTIONS, appearance.font_size || state.fontSize);
  renderSettingsOptions($("#settings-shell"), state.status?.shells || [], shell.id || "claude-code");
  $("#settings-custom-command").value = shell.custom_command || "";
  $("#settings-custom-env").value = shell.custom_env || "";
  $("#settings-enable-auto-mode").checked = Boolean(runtimeSettings.enable_auto_mode);
  $("#settings-enable-auto-mode").disabled = !Boolean(runtime?.capabilities?.auto_permission);
  $("#settings-allow-bypass-permissions").checked = Boolean(runtimeSettings.allow_bypass_permissions);
  renderSettingsPermissionOptions(runtimeSettings.permission_mode || state.permissionMode);
  $("#settings-default-root").value = workspace.default_root || "";
  $("#settings-provider-label").value = provider.label || "DeepSeek";
  $("#settings-base-url").value = provider.base_url || "";
  $("#settings-api-key").value = "";
  $("#settings-api-key").placeholder = provider.api_key_configured ? "已保存，留空保持不变" : "输入 API Key";
  $("#settings-api-key-env").value = provider.api_key_env || "ANTHROPIC_AUTH_TOKEN";
  $("#settings-base-url-env").value = provider.base_url_env || "ANTHROPIC_BASE_URL";
  $("#settings-model-env").value = provider.model_env || "ANTHROPIC_MODEL";
  $("#settings-models").value = modelsToText(provider.models || state.status?.models || []);
  renderSettingsModelSelect();
  $("#settings-provider-model").value = provider.model || state.selectedModel;
  $("#agent-md-editor").value = state.agentInstructions.content || "";
  $("#agent-md-path").textContent = state.agentInstructions.path || "保存后将在当前数据目录创建 AGENT.md";
  const runtimeStatus = $("#settings-runtime-status");
  if (runtimeStatus) renderRuntimeSettings(runtime);
  $("#diagnostics-panel").innerHTML = "";
  $("#settings-search").value = "";
  filterSettingsCenter("");
  clearSettingsDirty();
  $("#settings-modal").classList.remove("hidden");
  const selected = normalizeSettingsSection(section || "account");
  activateSettingsSection(selected, { recordLocation: false });
  setNavigationLocation({ kind: "settings", section: selected }, { push: history });
  $("#settings-search").focus();
}

function closeSettingsModal({ restoreNavigation = true } = {}) {
  const modal = $("#settings-modal");
  if (modal) modal.classList.add("hidden");
  filterSettingsCenter("");
  clearSettingsDirty();
  if (restoreNavigation && state.navigation.current?.kind === "settings") {
    void restorePreviousDurableLocation();
  }
}

async function saveAgentInstructions() {
  const content = $("#agent-md-editor")?.value || "";
  if (content === state.agentInstructions.content) return state.agentInstructions;
  const response = await fetch("/api/agent-instructions", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.detail || "保存 AGENT.md 失败；原内容已保留。");
  }
  state.agentInstructions = {
    content: data.content || "",
    exists: Boolean(data.exists),
    path: data.path || "",
    updated_at: data.updated_at ?? null
  };
  $("#agent-md-path").textContent = state.agentInstructions.path;
  return state.agentInstructions;
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
      accent: $("#settings-accent").value,
      font_size: $("#settings-font-size").value
    },
    shell: {
      id: $("#settings-shell").value,
      custom_command: $("#settings-custom-command").value.trim(),
      custom_env: $("#settings-custom-env").value.trim()
    },
    workspace: {
      default_root: $("#settings-default-root").value.trim()
    },
    runtime: {
      ...(state.settings?.runtime || {}),
      permission_mode: $("#settings-permission-default").value || state.permissionMode,
      enable_auto_mode: $("#settings-enable-auto-mode").checked,
      allow_bypass_permissions: $("#settings-allow-bypass-permissions").checked
    },
    provider: {
      label: $("#settings-provider-label").value.trim() || "DeepSeek",
      base_url: $("#settings-base-url").value.trim(),
      api_key_env: $("#settings-api-key-env").value.trim() || "ANTHROPIC_AUTH_TOKEN",
      base_url_env: $("#settings-base-url-env").value.trim() || "ANTHROPIC_BASE_URL",
      model_env: $("#settings-model-env").value.trim() || "ANTHROPIC_MODEL",
      model: $("#settings-provider-model").value || models[0].id,
      models
    }
  };
  if (apiKey) settings.provider.api_key = apiKey;

  const button = $("#save-settings-btn");
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = "保存中";
  $("#settings-save-status").textContent = "正在保存…";
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
    await saveAgentInstructions();
    state.settings = data.settings;
    state.status = {
      ...(state.status || {}),
      models: data.models,
      settings: data.settings,
      permission_modes: data.permission_modes || state.status?.permission_modes || [],
    };
    applySettingsFromServer(data.settings);
    state.selectedModel = data.settings.provider?.model || state.selectedModel;
    storageSet(MODEL_KEY, state.selectedModel);
    renderModelSelect();
    renderPermissionSelect();
    updateModelLabels();
    updateContextMeter();
    clearSettingsDirty();
    closeSettingsModal();
  } catch (error) {
    markSettingsDirty(`保存失败：${error.message}`);
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

function showTextInputModal({ title = "输入", label = "名称", placeholder = "", value = "" } = {}) {
  const modal = $("#text-input-modal");
  const heading = $("#text-input-title");
  const labelNode = $("#text-input-label");
  const input = $("#text-input-value");
  if (!modal || !input) return Promise.resolve(null);
  if (heading) heading.textContent = title;
  if (labelNode) labelNode.textContent = label;
  input.value = value;
  input.placeholder = placeholder;
  modal.classList.remove("hidden");
  input.focus();
  input.select();
  return new Promise((resolve) => {
    state.pendingTextInputResolver = resolve;
  });
}

function closeTextInputModal(value = null) {
  const modal = $("#text-input-modal");
  if (modal) modal.classList.add("hidden");
  if (state.pendingTextInputResolver) {
    const resolve = state.pendingTextInputResolver;
    state.pendingTextInputResolver = null;
    resolve(value ? String(value).trim() : null);
  }
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
  if (target) {
    target.value = state.folderPicker.currentPath || "";
    if (target.id === "settings-default-root") markSettingsDirty();
  }
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
  const name = await showTextInputModal({ title: "新建文件夹", label: "文件夹名称", placeholder: "输入新文件夹名称" });
  if (!name) return;
  try {
    const path = await createFolder(state.folderPicker.currentPath || state.folderPicker.defaultRoot, name);
    await loadFolderPickerPath(path);
  } catch (error) {
    showInlineStatus(`新建文件夹失败：${error.message}`, { kind: "error", timeout: 5200 });
  }
}

async function createDefaultFolderForInput(targetSelector) {
  const name = await showTextInputModal({ title: "新建文件夹", label: "文件夹名称", placeholder: "输入新文件夹名称" });
  if (!name) return;
  try {
    const data = await fetchFolderRoots();
    const path = await createFolder(data.default_root || workspaceDefaultRoot(), name);
    const target = $(targetSelector);
    if (target) {
      target.value = path;
      if (target.id === "settings-default-root") markSettingsDirty();
    }
  } catch (error) {
    showInlineStatus(`新建文件夹失败：${error.message}`, { kind: "error", timeout: 5200 });
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
  const models = availableModels();

  select.innerHTML = models.map((model) => `
    <option value="${escapeAttr(model.id)}" title="${escapeAttr(model.description || "")}">
      ${escapeHtml(model.label)}
    </option>
  `).join("");
  if (!models.some((model) => model.id === state.selectedModel)) {
    state.selectedModel = models[0]?.id || state.selectedModel;
  }
  select.value = state.selectedModel;
  renderModelMenu();
}

function availableModels() {
  return state.status?.models || [
    { id: "deepseek-v4-pro[1m]", label: "DeepSeek V4 Pro", description: "复杂推理" },
    { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", description: "快速响应" }
  ];
}

function renderModelMenu() {
  const menu = $("#model-menu");
  if (!menu) return;
  const models = availableModels();
  state.modelMenuIndex = Math.max(0, models.findIndex((model) => model.id === state.selectedModel));
  menu.innerHTML = models.map((model, index) => `
    <button type="button" class="anchored-menu-option${model.id === state.selectedModel ? " selected" : ""}" role="option" aria-selected="${model.id === state.selectedModel ? "true" : "false"}" data-model-id="${escapeAttr(model.id)}" data-menu-index="${index}">
      <span class="anchored-menu-check" aria-hidden="true">${model.id === state.selectedModel ? "✓" : ""}</span>
      <span class="anchored-menu-copy"><strong>${escapeHtml(model.label || model.id)}</strong>${model.description ? `<small>${escapeHtml(model.description)}</small>` : ""}</span>
      ${index < 9 ? `<kbd>${index + 1}</kbd>` : ""}
    </button>
  `).join("");
}

function selectModel(modelId, { closeMenu = false, restoreFocus = false } = {}) {
  const model = availableModels().find((item) => item.id === String(modelId || ""));
  if (!model) return false;
  state.selectedModel = model.id;
  const select = $("#model-select");
  if (select) select.value = model.id;
  storageSet(MODEL_KEY, state.selectedModel);
  renderModelMenu();
  updateModelLabels();
  renderCurrentSession();
  updateContextMeter();
  persistSelectedModel();
  if (closeMenu) setAnchoredMenuOpen("model", false, { restoreFocus });
  return true;
}

function menuNextIndex(index, delta, count) {
  if (!count) return 0;
  return (Number(index || 0) + Number(delta || 0) + count) % count;
}

function menuDigitIndex(key, count) {
  if (!/^[1-9]$/.test(String(key || ""))) return -1;
  const index = Number(key) - 1;
  return index < count ? index : -1;
}

function pickerParts(kind) {
  const model = kind === "model";
  return {
    menu: $(model ? "#model-menu" : "#permission-menu"),
    button: $(model ? "#model-picker-button" : "#permission-picker-button"),
    stateKey: model ? "modelMenuOpen" : "permissionMenuOpen",
    indexKey: model ? "modelMenuIndex" : "permissionMenuIndex",
    selector: model ? "[data-model-id]" : "[data-permission-mode]",
  };
}

function setAnchoredMenuOpen(kind, open, { focus = false, restoreFocus = false } = {}) {
  const parts = pickerParts(kind);
  if (!parts.menu || !parts.button) return;
  if (open) {
    const other = kind === "model" ? "permission" : "model";
    setAnchoredMenuOpen(other, false);
  }
  state[parts.stateKey] = Boolean(open);
  parts.menu.classList.toggle("hidden", !open);
  parts.button.setAttribute("aria-expanded", open ? "true" : "false");
  if (focus && open) {
    setTimeout(() => {
      const options = Array.from(parts.menu.querySelectorAll(parts.selector));
      options[state[parts.indexKey]]?.focus?.();
    }, 0);
  } else if (restoreFocus && !open) {
    parts.button.focus?.();
  }
}

function handleAnchoredMenuKeydown(event, kind) {
  const parts = pickerParts(kind);
  const options = Array.from(parts.menu?.querySelectorAll(parts.selector) || []);
  if (!options.length) return;
  let next = state[parts.indexKey] || 0;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    next = menuNextIndex(next, event.key === "ArrowDown" ? 1 : -1, options.length);
  } else if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    next = event.key === "Home" ? 0 : options.length - 1;
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    options[next]?.click?.();
    return;
  } else if (event.key === "Escape") {
    event.preventDefault();
    setAnchoredMenuOpen(kind, false, { restoreFocus: true });
    return;
  } else {
    const digit = menuDigitIndex(event.key, options.length);
    if (digit < 0) return;
    event.preventDefault();
    options[digit]?.click?.();
    return;
  }
  state[parts.indexKey] = next;
  options[next]?.focus?.();
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
function orderedPermissionModes(declared, visible) {
  const fallbackById = new Map(PERMISSION_MODES.map((item) => [item.id, item]));
  const declaredById = new Map((Array.isArray(declared) ? declared : []).map((item) => [item.id, item]));
  return ["default", "acceptEdits", "plan", "auto", "bypassPermissions", "dontAsk"]
    .filter((id) => visible.has(id))
    .map((id) => ({ ...(fallbackById.get(id) || {}), ...(declaredById.get(id) || {}) }))
    .filter((item) => item.id);
}

function permissionModeOptions() {
  const declared = Array.isArray(state.status?.permission_modes) && state.status.permission_modes.length
    ? state.status.permission_modes
    : PERMISSION_MODES;
  const runtimeSettings = state.settings?.runtime || state.status?.settings?.runtime || {};
  const capabilities = state.status?.runtime?.capabilities || {};
  const declaredIds = new Set(declared.map((item) => item.id));
  const visible = new Set(["default", "acceptEdits", "plan", "auto", "bypassPermissions", "dontAsk"]);
  if (!declaredIds.has("dontAsk")) visible.delete("dontAsk");
  return orderedPermissionModes(declared, visible).map((mode) => ({
    ...mode,
    enabled: mode.enabled !== false
      && (mode.id !== "auto" || (Boolean(runtimeSettings.enable_auto_mode) && Boolean(capabilities.auto_permission) && mode.enabled !== false))
      && (mode.id !== "bypassPermissions" || (Boolean(runtimeSettings.allow_bypass_permissions) && mode.enabled !== false)),
    reason: mode.reason || (
      mode.id === "auto" && (!runtimeSettings.enable_auto_mode || !capabilities.auto_permission)
        ? "请先满足 Claude Code 自动模式的设置与运行时能力"
        : mode.id === "bypassPermissions" && !runtimeSettings.allow_bypass_permissions
          ? "请先在设置中明确启用跳过权限"
          : ""
    )
  }));
}

function settingsPermissionModeOptions() {
  const declared = Array.isArray(state.status?.permission_modes) && state.status.permission_modes.length
    ? state.status.permission_modes
    : PERMISSION_MODES;
  const declaredIds = new Set(declared.map((item) => item.id));
  const visible = new Set(["default", "acceptEdits", "plan", "auto", "bypassPermissions", "dontAsk"]);
  if (!declaredIds.has("dontAsk")) visible.delete("dontAsk");
  const runtimeSettings = state.settings?.runtime || state.status?.settings?.runtime || {};
  // During settings editing the checkbox is the local draft gate.  It may
  // only make an already server-enabled mode more restrictive; a server
  // disabled descriptor/reason always remains authoritative.
  const autoGate = $("#settings-enable-auto-mode")
    ? Boolean($("#settings-enable-auto-mode").checked)
    : Boolean(runtimeSettings.enable_auto_mode);
  const bypassGate = $("#settings-allow-bypass-permissions")
    ? Boolean($("#settings-allow-bypass-permissions").checked)
    : Boolean(runtimeSettings.allow_bypass_permissions);
  return orderedPermissionModes(declared, visible).map((mode) => ({
    ...mode,
    enabled: mode.enabled !== false
      && (mode.id !== "auto" || autoGate)
      && (mode.id !== "bypassPermissions" || bypassGate),
    reason: mode.reason || (
      mode.id === "auto" && !autoGate
        ? "请先在设置中启用自动模式"
        : mode.id === "bypassPermissions" && !bypassGate
          ? "请先在设置中明确启用跳过权限"
          : ""
    ),
  }));
}

function renderSettingsPermissionOptions(selected = $("#settings-permission-default")?.value || state.permissionMode) {
  const select = $("#settings-permission-default");
  if (!select) return;
  const options = settingsPermissionModeOptions();
  const value = options.some((item) => item.id === selected) ? selected : "default";
  renderSettingsOptions(select, options, value);
}

function sanitizePermissionMode(mode) {
  let value = String(mode || "");
  if (["ask", "manual"].includes(value)) value = "default";
  return permissionModeOptions().some((item) => item.id === value) ? value : "default";
}
function renderPermissionSelect() {
  const select = $("#permission-select");
  if (!select) {
    return;
  }
  const modes = permissionModeOptions();
  if (!modes.some((item) => item.id === state.permissionMode)) {
    state.permissionMode = sanitizePermissionMode(state.status?.permission_mode || "default");
  }
  select.innerHTML = modes
    .map((mode) => `
      <option value="${escapeAttr(mode.id)}" ${mode.enabled === false ? "disabled" : ""} title="${escapeAttr(mode.reason || mode.description || "")} ">
        ${escapeHtml(mode.label)}
      </option>
    `)
    .join("");
  select.value = state.permissionMode;
  renderPermissionMenu();
}

function renderPermissionMenu() {
  const menu = $("#permission-menu");
  if (!menu) return;
  const modes = permissionModeOptions();
  state.permissionMenuIndex = Math.max(0, modes.findIndex((mode) => mode.id === state.permissionMode));
  menu.innerHTML = modes.map((mode, index) => `${mode.separator_before ? `<div class="permission-menu-divider" data-permission-divider="cli" role="separator">CLI 模式</div>` : ""}
    <button type="button" class="anchored-menu-option${mode.id === state.permissionMode ? " selected" : ""}" role="option" aria-selected="${mode.id === state.permissionMode ? "true" : "false"}" aria-disabled="${mode.enabled === false ? "true" : "false"}" ${mode.enabled === false ? "disabled" : ""} aria-label="${escapeAttr(`${mode.label}：${mode.reason || mode.description || ""}`)}" title="${escapeAttr(`${mode.label}：${mode.reason || mode.description || ""}`)}" data-permission-mode="${escapeAttr(mode.id)}" data-menu-index="${index}" data-reason="${escapeAttr(mode.reason || "")}">
      <span class="anchored-menu-check" aria-hidden="true">${mode.id === state.permissionMode ? "✓" : ""}</span>
      <span class="anchored-menu-copy"><strong>${escapeHtml(mode.label)}</strong>${(mode.enabled === false ? (mode.reason || mode.description) : (mode.description || mode.reason)) ? `<small${mode.enabled === false && mode.reason ? ' class="permission-disabled-reason"' : ""}>${escapeHtml(mode.enabled === false ? (mode.reason || mode.description) : (mode.description || mode.reason))}</small>` : ""}</span>
    </button>
  `).join("");
  const label = $("#permission-picker-label");
  if (label) label.textContent = modes.find((mode) => mode.id === state.permissionMode)?.label || "询问权限";
}

function selectPermissionMode(mode, { closeMenu = false, restoreFocus = false } = {}) {
  const requested = sanitizePermissionMode(mode);
  const descriptor = permissionModeOptions().find((item) => item.id === requested);
  if (!descriptor || descriptor.enabled === false) {
    return state.permissionMode;
  }
  const value = requested;
  state.permissionMode = value;
  const select = $("#permission-select");
  if (select) select.value = value;
  renderPermissionMenu();
  const sessionId = String(state.sessionId || "");
  if (sessionId && state.sessionMode === "agent") {
    void fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permission_mode: value }),
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "权限模式保存失败");
      if (String(state.sessionId || "") === sessionId) {
        state.permissionMode = sanitizePermissionMode(data.session?.permission_mode || value);
        renderPermissionSelect();
      }
    }).catch(() => {
      if (String(state.sessionId || "") === sessionId) void switchSession(sessionId, { quiet: true, history: false });
    });
  }
  if (closeMenu) setAnchoredMenuOpen("permission", false, { restoreFocus });
  return value;
}

function normalizePeerStatus(value) {
  const targets = Array.isArray(value?.targets) ? value.targets.filter((item) => (
    item && typeof item === "object" && item.session_id && item.peer_name
  )).map((item) => ({
    session_id: String(item.session_id),
    peer_name: String(item.peer_name),
    display_name: String(item.display_name || item.peer_name),
    kind: String(item.kind || "interactive")
  })) : [];
  return {
    available: Boolean(value?.available),
    verified: Boolean(value?.verified),
    reason: String(value?.reason || ""),
    discovery: String(value?.discovery || "unavailable"),
    targets
  };
}

function clearPeerTarget({ render = true } = {}) {
  state.peerTarget = null;
  if (render) renderPeerMenu();
}

function selectPeerTarget(sessionId) {
  const target = state.peerCapability.targets.find((item) => item.session_id === String(sessionId || ""));
  if (!target) return false;
  state.peerTarget = { ...target };
  renderPeerMenu();
  setPeerMenuOpen(false, { restoreFocus: true });
  $("#user-input")?.focus?.();
  return true;
}

function renderPeerMenu() {
  const button = $("#peer-picker-button");
  const label = $("#peer-picker-label");
  const menu = $("#peer-menu");
  const wrapper = $("[data-peer-picker]");
  if (!button || !label || !menu) return;
  const targets = state.peerCapability.targets;
  const selectedId = String(state.peerTarget?.session_id || "");
  const visible = state.viewMode === "agent"
    && state.peerCapability.available
    && state.peerCapability.verified
    && targets.length > 0;
  const enabled = state.viewMode === "agent"
    && !SessionRunRegistry.get(state.sessionId)?.active
    && state.peerCapability.verified
    && targets.length > 0;
  if (wrapper) {
    wrapper.hidden = !visible;
    wrapper.classList.toggle("hidden", !visible);
    wrapper.setAttribute("aria-hidden", visible ? "false" : "true");
  }
  if (!visible) setPeerMenuOpen(false);
  button.disabled = !enabled;
  button.setAttribute("aria-disabled", enabled ? "false" : "true");
  button.classList.toggle("selected", Boolean(selectedId));
  label.textContent = state.peerTarget?.display_name || "会话消息";
  const reason = enabled
    ? (state.peerTarget ? `下一条消息发送给 ${state.peerTarget.display_name}` : "选择另一个运行中的 Agent 会话")
    : (state.peerCapability.reason || "当前没有可达的运行中 Agent 会话");
  button.title = reason;
  button.setAttribute("aria-label", reason);
  menu.innerHTML = targets.map((target, index) => `
    <button type="button" class="anchored-menu-option${target.session_id === selectedId ? " selected" : ""}" role="option" aria-selected="${target.session_id === selectedId ? "true" : "false"}" data-peer-session-id="${escapeAttr(target.session_id)}" data-menu-index="${index}">
      <span class="anchored-menu-check" aria-hidden="true">${target.session_id === selectedId ? "✓" : ""}</span>
      <span class="anchored-menu-copy"><strong>${escapeHtml(target.display_name)}</strong><small>运行中的 Agent 会话</small></span>
    </button>
  `).join("") + (selectedId ? `
    <button type="button" class="anchored-menu-option peer-clear-option" role="option" data-peer-clear="true" data-menu-index="${targets.length}">
      <span class="anchored-menu-check" aria-hidden="true"></span>
      <span class="anchored-menu-copy"><strong>取消跨会话发送</strong><small>恢复为当前会话任务</small></span>
    </button>
  ` : "");
}

function setPeerMenuOpen(open, { focus = false, restoreFocus = false } = {}) {
  const button = $("#peer-picker-button");
  const menu = $("#peer-menu");
  if (!button || !menu) return;
  const next = Boolean(open && !button.disabled);
  state.peerMenuOpen = next;
  menu.classList.toggle("hidden", !next);
  button.setAttribute("aria-expanded", next ? "true" : "false");
  if (next) {
    setAnchoredMenuOpen("model", false);
    setAnchoredMenuOpen("permission", false);
  }
  if (focus && next) setTimeout(() => menu.querySelector("[data-menu-index]")?.focus?.(), 0);
  if (restoreFocus && !next) button.focus?.();
}

function handlePeerMenuKeydown(event) {
  const options = Array.from($("#peer-menu")?.querySelectorAll("[data-menu-index]") || []);
  if (!options.length) return;
  let index = Math.max(0, options.indexOf(document.activeElement));
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    index = menuNextIndex(index, event.key === "ArrowDown" ? 1 : -1, options.length);
    options[index]?.focus?.();
  } else if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    options[event.key === "Home" ? 0 : options.length - 1]?.focus?.();
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    options[index]?.click?.();
  } else if (event.key === "Escape") {
    event.preventDefault();
    setPeerMenuOpen(false, { restoreFocus: true });
  }
}

async function refreshPeerStatus() {
  if (state.viewMode !== "agent" || !state.sessionId) {
    state.peerCapability = normalizePeerStatus({ reason: "Chat 不具备 Agent 跨会话能力" });
    clearPeerTarget({ render: false });
    renderPeerMenu();
    return state.peerCapability;
  }
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(state.sessionId)}/peers`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.detail || `HTTP ${response.status}`);
    state.peerCapability = normalizePeerStatus(data.peer);
  } catch (error) {
    state.peerCapability = normalizePeerStatus({ reason: `原生会话发现不可用：${error.message || error}` });
  }
  if (state.peerTarget && !state.peerCapability.targets.some((item) => item.session_id === state.peerTarget.session_id)) {
    clearPeerTarget({ render: false });
  }
  renderPeerMenu();
  return state.peerCapability;
}

function storageRemove(key) {
  localStorage.removeItem(key);
}

function updateModelLabels() {
  const option = getSelectedModelOption();
  const pickerLabel = $("#model-picker-label");
  if (pickerLabel) pickerLabel.textContent = option.label || option.id || "模型";
  const previewSuffix = state.previewMode ? " · 预览版" : "";
  $("#status-line").textContent = state.status?.configured
    ? `${option.label} ${t("connected")}${previewSuffix}`
    : `${t("waitingKey")}${previewSuffix}`;
}

function getSelectedModelOption() {
  const models = state.status?.models || [];
  return models.find((model) => model.id === state.selectedModel) || {
    id: state.selectedModel,
    label: state.selectedModel,
    description: ""
  };
}

async function createSession({ silent = false, name = "", workdir = "", mode = state.viewMode, history = true } = {}) {
  closeSkillsView({ restoreNavigation: false });
  closeSettingsModal({ restoreNavigation: false });
  resetCurrentSessionRuntimeUi();
  const sessionMode = mode === "agent" ? "agent" : "chat";
  const response = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, workdir: sessionMode === "agent" ? workdir : "", mode: sessionMode })
  });
  const data = await response.json();
  clearContextCompressionTimer();
  state.sessionId = data.session_id;
  SessionScrollRegistry.set(state.sessionId, true);
  state.sessionMode = data.mode === "agent" ? "agent" : "chat";
  state.viewMode = state.sessionMode;
  setViewMode(state.sessionMode);
  activateContextCompressionState(state.sessionId);
  state.contextRevision = data.revision || `${data.updated || ""}:${data.message_count || 0}`;
  state.contextUsage = normalizeContextUsage(data.context_usage);
  state.permissionMode = sanitizePermissionMode(data.permission_mode || "default");
  state.sessionName = data.name || "";
  state.workdir = data.workdir || "";
  state.sessionPinned = Boolean(data.pinned);
  state.sessionUnread = Boolean(data.unread);
  state.sessionRuntimeState = String(data.runtime_state || "idle");
  state.messages = [];
  state.activityEvents = [];
  clearContextFiles();
  renderCurrentSession();
  renderWelcome();
  updateContextMeter();
  void refreshPeerStatus();
  rememberSession(state.sessionId);
  await loadSessionList();
  setNavigationLocation({ kind: "session", mode: state.sessionMode, sessionId: state.sessionId }, { push: history });
  if (!silent) $("#user-input").focus();
}

async function restoreLastSession() {
  const remembered = storageGet(LAST_SESSION_KEY);
  if (remembered) {
    const ok = await switchSession(remembered, { quiet: true, history: false });
    if (ok) return;
  }

  try {
    const response = await fetch(`/api/sessions/last?mode=${encodeURIComponent(state.viewMode)}`);
    const data = await response.json();
    if (data.session?.session_id) {
      applySession(data.session.session_id, data.session);
      rememberSession(data.session.session_id);
      await loadSessionList();
      setNavigationLocation({ kind: "session", mode: state.sessionMode, sessionId: data.session.session_id }, { push: false });
      SessionScrollRegistry.restore(data.session.session_id);
      return;
    }
  } catch {}

  await createSession({ silent: true, history: false });
}

function openNewSessionModal() {
  $("#new-session-name").value = "";
  $("#new-session-workdir").value = "";
  updateModeChrome();
  $("#new-session-modal").classList.remove("hidden");
  $("#new-session-name").focus();
}

function closeNewSessionModal() {
  $("#new-session-modal").classList.add("hidden");
}

async function createNamedSession() {
  await createSession({
    name: $("#new-session-name").value.trim(),
    workdir: $("#new-session-workdir").value.trim(),
    mode: state.viewMode
  });
  closeNewSessionModal();
}

function sessionMenuRecord(sessionId) {
  const indexed = state.sessionIndex.find((item) => String(item.id) === String(sessionId));
  if (indexed) return indexed;
  if (String(sessionId || "") !== String(state.sessionId || "")) return null;
  return {
    id: state.sessionId,
    mode: state.sessionMode,
    name: state.sessionName,
    workdir: state.workdir,
    pinned: state.sessionPinned,
    unread: state.sessionUnread
  };
}

function renderSessionHeader() {
  const header = $("#agent-session-header");
  const titleButton = $("#session-title-button");
  const inlineInput = $("#session-title-inline-input");
  const title = $("#session-title");
  const path = $("#workdir-display");
  const menuButton = $("#session-header-menu-button");
  if (!header || (!titleButton && !inlineInput) || !path || !menuButton) return;
  const visible = state.viewMode === "agent" && Boolean(state.sessionId);
  header.classList.toggle("hidden", !visible);
  header.setAttribute("aria-hidden", visible ? "false" : "true");
  if (!visible) {
    menuButton.removeAttribute("data-session-menu");
    menuButton.setAttribute("aria-expanded", "false");
    return;
  }
  const name = String(state.sessionName || "未命名会话");
  const fullPath = String(state.workdir || "");
  const pathLabel = fullPath ? shortenPath(fullPath) : "默认工作目录";
  if (titleButton && title) {
    title.textContent = name;
    titleButton.title = `单击重命名：${name}`;
    titleButton.setAttribute("aria-label", `重命名当前会话：${name}`);
  }
  if (inlineInput) {
    inlineInput.value = state.sessionName || "";
    inlineInput.setAttribute("aria-label", `编辑当前会话名称：${name}`);
  }
  path.textContent = pathLabel;
  path.title = fullPath || "使用默认工作目录";
  path.setAttribute("aria-label", `工作目录：${fullPath || "使用默认工作目录"}`);
  menuButton.dataset.sessionMenu = String(state.sessionId);
  menuButton.setAttribute("aria-label", `${name}的会话操作`);
  menuButton.setAttribute("aria-expanded", state.sessionMenuSessionId === String(state.sessionId) ? "true" : "false");
}

function createSessionTitleButton() {
  const button = document.createElement("button");
  button.id = "session-title-button";
  button.className = "session-title-button titlebar-no-drag";
  button.type = "button";
  button.setAttribute("aria-label", "重命名当前会话");
  button.innerHTML = '<span id="session-title">未命名会话</span>';
  button.addEventListener("click", () => startInlineSessionRename());
  return button;
}

function restoreInlineSessionTitle(errorMessage = "") {
  const input = $("#session-title-inline-input");
  const header = $("#agent-session-header");
  if (input) input.replaceWith(createSessionTitleButton());
  renderSessionHeader();
  if (!errorMessage || !header) return;
  const note = document.createElement("span");
  note.className = "session-title-inline-error";
  note.setAttribute("role", "status");
  note.textContent = errorMessage;
  header.appendChild(note);
  window.setTimeout(() => note.remove(), 4200);
}

async function persistSessionName(sessionId, nextName) {
  const id = String(sessionId || "");
  const name = String(nextName || "").trim();
  if (!id || !name) throw new Error("会话名称不能为空");
  const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `保存失败：${response.status}`);
  const indexed = state.sessionIndex.find((item) => String(item.id) === id);
  if (indexed) indexed.name = name;
  if (id === String(state.sessionId || "")) state.sessionName = name;
  renderSessionHeader();
  await loadSessionList();
  return name;
}

function sizeInlineSessionTitleInput(input) {
  if (!input) return;
  const header = $("#agent-session-header");
  const workdir = $("#workdir-display");
  const menu = $("#session-header-menu-button");
  const headerRect = header?.getBoundingClientRect?.();
  const menuRect = menu?.getBoundingClientRect?.();
  const style = getComputedStyle(input);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (context) context.font = style.font || `${style.fontSize} ${style.fontFamily}`;
  const measured = context
    ? context.measureText(String(input.value || "未命名会话")).width
    : Number(input.scrollWidth || 0);
  const headerLeft = Number(headerRect?.left || 0);
  const headerRight = Number(headerRect?.right || 0);
  const menuWidth = Number(menuRect?.width || 24);
  const workdirStyle = workdir ? getComputedStyle(workdir) : null;
  const workdirMin = workdirStyle && workdirStyle.display !== "none"
    ? Math.max(42, Number.parseFloat(workdirStyle.minWidth) || 42)
    : 0;
  const titleEnd = headerRight - menuWidth - workdirMin - 12;
  const available = headerRect && titleEnd > headerLeft
    ? Math.max(72, titleEnd - headerLeft - 8)
    : 420;
  const width = Math.min(available, Math.max(72, Math.ceil(measured + 18)));
  input.style.setProperty("--session-title-inline-width", `${width}px`);
  input.style.width = `${width}px`;
}

function startInlineSessionRename() {
  if (state.viewMode !== "agent" || !state.sessionId || $("#session-title-inline-input")) return false;
  const button = $("#session-title-button");
  if (!button) return false;
  const editingSessionId = String(state.sessionId);
  const original = String(state.sessionName || "未命名会话");
  const input = document.createElement("input");
  input.id = "session-title-inline-input";
  input.className = "session-title-inline-input titlebar-no-drag";
  input.classList.add("is-editing");
  input.type = "text";
  input.value = original;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("role", "textbox");
  input.setAttribute("aria-label", `编辑当前会话名称：${original}`);
  button.replaceWith(input);
  input.focus();
  input.select();
  sizeInlineSessionTitleInput(input);
  input.addEventListener("input", () => sizeInlineSessionTitleInput(input));
  window.requestAnimationFrame(() => sizeInlineSessionTitleInput(input));
  let settled = false;
  const finish = async (save) => {
    if (settled) return;
    settled = true;
    if (!save) {
      restoreInlineSessionTitle();
      return;
    }
    const nextName = input.value.trim() || original;
    try {
      await persistSessionName(editingSessionId, nextName);
      // A user can switch sessions while the PUT is in flight.  Only restore
      // the editor that belongs to the session which started the request; a
      // newer session's title/input must not be replaced by this completion.
      if (String(state.sessionId || "") === editingSessionId && $("#session-title-inline-input") === input) {
        restoreInlineSessionTitle();
      }
    } catch (error) {
      if (String(state.sessionId || "") === editingSessionId && $("#session-title-inline-input") === input) {
        restoreInlineSessionTitle(error.message || "会话名称保存失败");
      }
    }
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      void finish(false);
    }
  });
  input.addEventListener("blur", () => { void finish(true); });
  return true;
}

function setSessionMenuItemLabel(menu, action, label) {
  // data-session-pin remains a semantic alias so session pin and window pin
  // stay independently testable while all dispatch uses data-session-action.
  const selector = action === "pin"
    ? '[data-session-action="pin"], [data-session-pin]'
    : `[data-session-action="${action}"]`;
  const item = menu?.querySelector?.(selector);
  if (!item) return null;
  const labelNode = item.querySelector?.("[data-session-action-label]");
  if (labelNode) labelNode.textContent = label;
  else item.textContent = label;
  item.setAttribute?.("aria-label", label);
  return item;
}

function closeSessionMenu({ restoreFocus = false } = {}) {
  const menu = $("#session-context-menu");
  const trigger = state.sessionMenuSessionId ? $$(`[data-session-menu]`).find((item) => item.dataset.sessionMenu === String(state.sessionMenuSessionId)) : null;
  state.sessionMenuSessionId = null;
  if (menu) {
    menu.classList.add("hidden");
    menu.setAttribute("aria-hidden", "true");
  }
  if (trigger) trigger.setAttribute("aria-expanded", "false");
  renderSessionHeader();
  if (restoreFocus) trigger?.focus();
}

function openSessionMenu(sessionId, trigger) {
  const menu = $("#session-context-menu");
  const session = sessionMenuRecord(sessionId);
  if (!menu || !session) return;
  state.sessionMenuSessionId = String(sessionId);
  $$(`[data-session-menu]`).forEach((item) => item.setAttribute("aria-expanded", item.dataset.sessionMenu === String(sessionId) ? "true" : "false"));
  const pinned = Boolean(session.pinned);
  const unread = Boolean(session.unread);
  setSessionMenuItemLabel(menu, "pin", pinned ? "取消置顶" : "置顶");
  setSessionMenuItemLabel(menu, "unread", unread ? "标为已读" : "标为未读");
  setSessionMenuItemLabel(menu, "rename", "重命名");
  const projectAction = setSessionMenuItemLabel(menu, "project", "添加到项目");
  if (projectAction) projectAction.hidden = (session.mode === "chat");
  setSessionMenuItemLabel(menu, "delete", "删除");
  menu.classList.remove("hidden");
  menu.setAttribute("aria-hidden", "false");
  const anchor = trigger?.getBoundingClientRect?.();
  const width = menu.offsetWidth || 184;
  const height = menu.offsetHeight || 214;
  const left = Math.max(8, Math.min((anchor?.right || 0) - width, window.innerWidth - width - 8));
  const below = (anchor?.bottom || 0) + 4;
  const above = (anchor?.top || 0) - height - 4;
  const top = below + height <= window.innerHeight - 8
    ? below
    : Math.max(8, above);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  renderSessionHeader();
  menu.querySelector('[role="menuitem"]')?.focus();
}

async function setSessionUnread(sessionId, unread) {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unread: Boolean(unread) })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  await loadSessionList();
}

async function renameSessionRecord(sessionId, currentName = "") {
  const nextName = await showRenameSessionModal(currentName);
  if (nextName === null) return;
  await persistSessionName(sessionId, nextName);
}

async function openSessionProjectMapping(sessionId) {
  const targetId = String(sessionId || "");
  const target = sessionMenuRecord(targetId);
  if (!target || target.mode === "chat") throw new Error("Chat 会话不使用工作目录。");
  if (targetId !== String(state.sessionId || "")) {
    const switched = await switchSession(targetId, { quiet: true, history: true });
    if (!switched) throw new Error("无法打开目标会话。");
  }
  changeWorkdir();
  return true;
}

async function deleteSessionRecord(sessionId, title) {
  if (SessionRunRegistry.get(sessionId)?.active) {
    throw new Error("运行中的会话必须先停止，才能删除。");
  }
  if (!(await showDeleteSessionModal(title))) return;
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || `HTTP ${response.status}`);
  if (storageGet(LAST_SESSION_KEY) === sessionId) storageRemove(LAST_SESSION_KEY);
  SessionScrollRegistry.remove(sessionId);
  await loadSessionList();
  if (sessionId === state.sessionId) await switchMode(state.viewMode, { history: false, quiet: true });
}

async function executeSessionMenuAction(action) {
  const sessionId = state.sessionMenuSessionId;
  const session = sessionMenuRecord(sessionId);
  if (!session) return closeSessionMenu();
  closeSessionMenu({ restoreFocus: false });
  try {
    if (action === "pin") await setSessionPinned(sessionId, !session.pinned);
    else if (action === "unread") await setSessionUnread(sessionId, !session.unread);
    else if (action === "rename") await renameSessionRecord(sessionId, session.name || sessionId);
    else if (action === "project") await openSessionProjectMapping(sessionId);
    else if (action === "delete") await deleteSessionRecord(sessionId, session.name || sessionId);
  } catch (error) {
    showInlineStatus(error.message || String(error), { kind: "error", timeout: 5200 });
    await loadSessionList();
  }
}

function handleSessionMenuKeydown(event) {
  const menu = $("#session-context-menu");
  if (!menu || menu.classList.contains("hidden")) return;
  const items = Array.from(menu.querySelectorAll('[role="menuitem"]')).filter((item) => !item.disabled && !item.hidden);
  if (!items.length) return;
  const current = Math.max(0, items.indexOf(document.activeElement));
  if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeSessionMenu({ restoreFocus: true });
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    void executeSessionMenuAction(document.activeElement?.dataset.sessionAction);
  } else if (/^[a-z]$/i.test(event.key)) {
    const shortcut = items.find((item) => String(item.dataset.menuKey || "").toLowerCase() === event.key.toLowerCase());
    if (shortcut) {
      event.preventDefault();
      shortcut.focus();
      void executeSessionMenuAction(shortcut.dataset.sessionAction);
    }
  }
}

function setSessionHistorySearchVisible(visible, { focus = false } = {}) {
  const wrap = $("#session-history-search-wrap");
  const toggle = $("#session-history-toggle");
  const input = $("#session-history-search");
  if (!wrap || !toggle || !input) return;
  wrap.classList.toggle("hidden", !visible);
  toggle.setAttribute("aria-expanded", String(Boolean(visible)));
  if (visible && focus) input.focus();
  if (!visible && input.value) {
    input.value = "";
    void loadSessionList();
  }
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
  state.sessionIndex = sessions;
  renderSessionHeader();
  const list = $("#session-list");
  const currentMode = state.viewMode === "agent" ? "agent" : "chat";
  sessions = sessions.filter((session) => (session.mode === "chat" ? "chat" : "agent") === currentMode);
  const historyQuery = String($("#session-history-search")?.value || "").trim().toLocaleLowerCase();
  if (historyQuery) {
    sessions = sessions.filter((session) => {
      const title = String(session.name || session.id || "").toLocaleLowerCase();
      const workdir = String(session.workdir || "").toLocaleLowerCase();
      return title.includes(historyQuery) || workdir.includes(historyQuery);
    });
  }

  if (!sessions.length) {
    list.innerHTML = `<div class="empty-list">${historyQuery ? "未找到匹配会话" : "暂无会话"}</div>`;
    return;
  }

  const renderSession = (session) => {
    const active = session.id === state.sessionId ? " active" : "";
    const title = session.name || session.id;
    const unread = Boolean(session.unread);
    const runtimeState = String(session.runtime_state || "idle");
    const running = ["running", "waiting_input", "awaiting_cli_ack"].includes(runtimeState);
    const statusLabel = runtimeState === "waiting_input" ? "等待确认" : running ? "运行中" : "";
    return `
      <div class="session-item${active}${unread ? " unread" : ""}" data-session="${escapeAttr(session.id)}" data-runtime-state="${escapeAttr(runtimeState)}">
        <button class="session-main" type="button" data-open-session="${escapeAttr(session.id)}" aria-label="${escapeAttr(title)}">
          <svg class="session-dialogue-icon" viewBox="0 0 18 18" aria-hidden="true"><path d="M3.5 4.5h11v7h-6l-3.5 2v-2h-1.5z"></path><path d="M6 7.5h6M6 9.8h3.8"></path></svg>
          <span class="session-name">${escapeHtml(title)}</span>
          ${unread ? `<span class="session-unread-dot" title="未读" aria-label="未读"></span>` : ""}
          ${statusLabel ? `<span class="session-runtime-status">${escapeHtml(statusLabel)}</span>` : ""}
        </button>
        <button class="session-more" type="button" data-session-menu="${escapeAttr(session.id)}" aria-label="会话操作" aria-haspopup="menu" aria-expanded="false">•••</button>
      </div>
    `;
  };
  const pinnedSessions = sessions.filter((session) => Boolean(session.pinned));
  const recentSessions = sessions.filter((session) => !session.pinned);
  const renderGroup = (title, items) => items.length
    ? `<section class="session-group"><h2>${escapeHtml(title)}</h2>${items.map(renderSession).join("")}</section>`
    : "";
  list.innerHTML = `${renderGroup("已置顶", pinnedSessions)}${renderGroup("最近会话", recentSessions)}`
    || `<div class="empty-list">暂无会话</div>`;

  $$("[data-open-session]").forEach((button) => {
    button.addEventListener("click", () => switchSession(button.dataset.openSession));
  });

  $$("#session-list [data-session-menu]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!$("#session-context-menu")?.classList.contains("hidden") && state.sessionMenuSessionId === button.dataset.sessionMenu) {
        closeSessionMenu({ restoreFocus: true });
      } else {
        openSessionMenu(button.dataset.sessionMenu, button);
      }
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openSessionMenu(button.dataset.sessionMenu, button);
    });
  });
}

async function switchSession(sessionId, { quiet = false, history = true } = {}) {
  const generation = ++state.sessionSwitchGeneration;
  state.sessionSwitchPending = true;
  syncCurrentSessionRuntimeUi();
  closeSkillsView({ restoreNavigation: false });
  closeSettingsModal({ restoreNavigation: false });
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
    if (!response.ok || generation !== state.sessionSwitchGeneration) return false;
    const data = await response.json();
    if (generation !== state.sessionSwitchGeneration) return false;
    applySession(sessionId, data);
    rememberSession(sessionId);
    await loadSessionList();
    if (generation !== state.sessionSwitchGeneration) return false;
    setNavigationLocation({ kind: "session", mode: state.sessionMode, sessionId }, { push: history });
    SessionScrollRegistry.restore(sessionId);
    if (!quiet) $("#user-input").focus();
    return true;
  } finally {
    if (generation === state.sessionSwitchGeneration) {
      state.sessionSwitchPending = false;
      syncCurrentSessionRuntimeUi();
    }
  }
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
  resetCurrentSessionRuntimeUi();
  if (state.sessionId !== sessionId) clearContextCompressionTimer();
  state.sessionId = sessionId;
  const scrollProjectionToken = SessionScrollRegistry.beginProjection(sessionId);
  SessionScrollRegistry.activate(sessionId);
  state.sessionMode = data.mode === "agent" ? "agent" : "chat";
  state.viewMode = state.sessionMode;
  setViewMode(state.sessionMode);
  activateContextCompressionState(sessionId);
  state.contextRevision = data.revision || `${data.updated || ""}:${data.message_count || 0}`;
  state.contextUsage = normalizeContextUsage(data.context_usage);
  state.permissionMode = sanitizePermissionMode(data.permission_mode || "default");
  renderPermissionSelect();
  state.sessionName = data.name || "";
  state.workdir = data.workdir || "";
  state.sessionPinned = Boolean(data.pinned);
  state.sessionUnread = Boolean(data.unread);
  state.sessionRuntimeState = String(data.runtime_state || "idle");
  state.messages = data.messages || [];
  const activeRunSnapshot = data.active_run && data.active_run.active ? data.active_run : null;
  const runtimeActive = ["running", "waiting_input", "awaiting_cli_ack"].includes(state.sessionRuntimeState);
  const existingRun = SessionRunRegistry.get(sessionId);
  if (!runtimeActive && existingRun?.active) {
    SessionRunRegistry.finish(sessionId, state.sessionRuntimeState === "failed" ? "failed" : "completed");
    SessionTransportRegistry.finish(sessionId);
  }
  if (runtimeActive && (!existingRun?.active || (activeRunSnapshot?.run_id && existingRun.runId !== activeRunSnapshot.run_id))) {
    const pendingMessage = [...state.messages].reverse().find((message) => message?.role === "assistant" && message?.pending);
    let segments = Array.isArray(pendingMessage?.segments)
      ? pendingMessage.segments.map((segment) => ({ ...segment }))
      : [];
    if (segments.some((segment) => segment?.type === "text" && String(segment.content || "").trim())) {
      segments = segments.filter((segment) => segment?.type !== "thinking");
    }
    if (!segments.length && String(pendingMessage?.content || "")) {
      segments = [{ type: "text", content: String(pendingMessage.content) }];
    }
    SessionRunRegistry.start(sessionId, {
      mode: state.sessionMode,
      workdir: state.workdir,
      hydrated: true,
      segments,
      runId: activeRunSnapshot?.run_id || "",
      serverSequence: activeRunSnapshot?.sequence || 0,
    });
  }
  if (runtimeActive && activeRunSnapshot) {
    SessionRunRegistry.update(sessionId, {
      runId: String(activeRunSnapshot.run_id || ""),
      serverSequence: Math.max(0, Number(activeRunSnapshot.sequence) || 0),
      active: true,
      status: String(activeRunSnapshot.status || state.sessionRuntimeState || "running"),
      cancelRequested: Boolean(activeRunSnapshot.cancel_requested),
      pendingInteraction: null,
      awaitingInteractionAck: null,
    });
  }
  state.activityEvents = [];
  renderCurrentSession();
  renderAllMessages();
  renderContextFiles();
  void refreshAgentQueue(sessionId);
  updateContextMeter();
  void refreshPeerStatus();
  const pendingInteraction = activeRunSnapshot?.pending_interaction || data.pending_interaction;
  if (pendingInteraction) {
    const normalizedInteraction = normalizeInteractionRequest(pendingInteraction);
    let run = SessionRunRegistry.get(sessionId);
    if (runtimeActive && !run?.active) {
      run = SessionRunRegistry.start(sessionId, { mode: state.sessionMode, workdir: state.workdir, hydrated: true });
    }
    if (run && normalizedInteraction) {
      const actionable = interactionIsActionable(normalizedInteraction);
      if (String(normalizedInteraction.interaction_state || "") === "awaiting_cli_ack") {
        SessionRunRegistry.update(sessionId, {
          pendingInteraction: null,
          awaitingInteractionAck: normalizedInteraction,
          waitingInput: false,
          status: "awaiting_cli_ack",
        });
      } else {
        SessionRunRegistry.update(sessionId, {
          pendingInteraction: normalizedInteraction,
          awaitingInteractionAck: null,
          waitingInput: actionable,
          status: actionable ? "waiting_input" : (normalizedInteraction.interaction_state || state.sessionRuntimeState),
        });
      }
    }
    if (interactionIsActionable(normalizedInteraction)) restorePendingInteractionCard(pendingInteraction, sessionId);
  } else if (activeRunSnapshot?.awaiting_interaction_ack) {
    const awaiting = activeRunSnapshot.awaiting_interaction_ack;
    const requestId = typeof awaiting === "object" ? awaiting.request_id : awaiting;
    const run = SessionRunRegistry.get(sessionId);
    if (run && requestId) {
      SessionRunRegistry.update(sessionId, {
        pendingInteraction: null,
        awaitingInteractionAck: { request_id: String(requestId), interaction_state: "awaiting_cli_ack", allowed_actions: [] },
        waitingInput: false,
        status: "awaiting_cli_ack",
      });
    }
  }
  SessionRunRegistry.mirror(sessionId);
  const activeRun = SessionRunRegistry.get(sessionId)?.active;
  if (activeRun) {
    renderSessionRun(sessionId);
    if (state.sessionMode === "agent" && activeRunSnapshot && !SessionTransportRegistry.get(sessionId)) {
      void resumeAgentRun(sessionId, activeRunSnapshot);
    }
  }
  SessionScrollRegistry.finishProjection(sessionId, scrollProjectionToken);
}

function restorePendingInteractionCard(payload, expectedSessionId = state.sessionId) {
  const normalized = normalizeInteractionRequest(payload);
  const sessionId = String(expectedSessionId || "");
  if (!normalized || !sessionId || String(state.sessionId || "") !== sessionId) return;
  if (normalized.session_id && String(normalized.session_id) !== sessionId) return;
  if (!interactionIsActionable(normalized)) return;
  mountInteractionCard(normalized);
  const run = SessionRunRegistry.get(sessionId);
  if (run) {
    const actionable = interactionIsActionable(normalized);
    SessionRunRegistry.update(sessionId, {
      pendingInteraction: normalized,
      waitingInput: actionable,
      status: actionable ? "waiting_input" : (normalized.interaction_state || run.status),
    });
  }
}

async function switchMode(mode, { history = true, quiet = false } = {}) {
  const nextMode = mode === "agent" ? "agent" : "chat";
  closeSkillsView({ restoreNavigation: false });
  closeSettingsModal({ restoreNavigation: false });
  setViewMode(nextMode);
  try {
    const response = await fetch("/api/sessions");
    const data = await response.json();
    const candidates = (data.sessions || []).filter((session) => (session.mode === "chat" ? "chat" : "agent") === nextMode);
    const latest = candidates[0];
    if (latest?.id) {
      await switchSession(latest.id, { quiet: true, history });
    } else {
      await createSession({ silent: quiet, mode: nextMode, history });
    }
  } catch {
    if (!state.sessionId || state.sessionMode !== nextMode) await createSession({ silent: quiet, mode: nextMode, history });
  }
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
    showInlineStatus(`目录切换失败：${error.message}`, { kind: "error", timeout: 5200 });
  }
}

function renderCurrentSession() {
  const emptyChat = state.viewMode === "chat" && state.messages.length === 0;
  $("#chat-container")?.classList.toggle("chat-empty-state", emptyChat);
  updateModeChrome();
  updateContextMeter();
  updateMessageTraceRail();
}

function hideMessageTracePreview() {
  const preview = $("#message-trace-preview");
  if (!preview) return;
  preview.classList.add("hidden");
  preview.setAttribute("aria-hidden", "true");
}

function messageTracePreviewCopy(article, index) {
  const role = article?.dataset?.role === "user" ? "用户" : "助手";
  const nodes = role === "用户"
    ? Array.from(article?.querySelectorAll?.(".user-text") || [])
    : Array.from(article?.querySelectorAll?.(".msg-text-segment") || []);
  const text = nodes.map((node) => String(node.textContent || "").trim()).filter(Boolean).join(" ");
  const lines = text.split(/\s*\n\s*|(?<=[。！？.!?])\s+/).map((line) => line.trim()).filter(Boolean);
  const title = (lines.shift() || `${role}第 ${index + 1} 条消息`).slice(0, 72);
  const summary = (lines.join(" ") || (text && text !== title ? text.slice(title.length).trim() : "点击刻度跳转到该轮消息")).slice(0, 180);
  return { title, summary };
}

function showMessageTracePreview(index) {
  const rail = $("#message-trace-rail");
  const preview = $("#message-trace-preview");
  const titleNode = $("#message-trace-preview-title");
  const summaryNode = $("#message-trace-preview-summary");
  const messages = $("#messages");
  const container = $("#chat-container");
  const article = Array.from(messages?.children || []).filter((node) => node?.classList?.contains("message"))[index];
  const tick = rail?.querySelector?.(`[data-trace-index="${Number(index)}"]`);
  if (!rail || !preview || !titleNode || !summaryNode || !container || !article || !tick || state.sessionMode !== "agent") return false;
  const copy = messageTracePreviewCopy(article, index);
  titleNode.textContent = copy.title;
  summaryNode.textContent = copy.summary;
  preview.classList.remove("hidden");
  preview.setAttribute("aria-hidden", "false");
  const railRect = rail.getBoundingClientRect();
  const tickRect = tick.getBoundingClientRect();
  const inputRect = $("#input-area")?.getBoundingClientRect?.();
  const viewportBottom = Math.min(window.innerHeight - 10, Number(inputRect?.top || window.innerHeight) - 10);
  let left = railRect.right + 10;
  let top = tickRect.top - 8;
  const cardRect = preview.getBoundingClientRect();
  if (left + cardRect.width > window.innerWidth - 10) left = Math.max(10, railRect.left - cardRect.width - 10);
  if (top + cardRect.height > viewportBottom) top = Math.max(10, viewportBottom - cardRect.height);
  if (top < 10) top = Math.min(Math.max(10, tickRect.bottom + 8), viewportBottom - cardRect.height);
  preview.style.left = `${Math.round(left)}px`;
  preview.style.top = `${Math.round(top)}px`;
  return true;
}

function syncMessageTraceGeometry() {
  const rail = $("#message-trace-rail");
  const main = $("#main");
  const container = $("#chat-container");
  const messages = $("#messages");
  if (!rail || !main || !container || !messages) return false;
  const mainRect = main.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const messagesRect = messages.getBoundingClientRect();
  const inputRect = $("#input-area")?.getBoundingClientRect?.();
  const top = Math.max(8, Math.round(containerRect.top - mainRect.top + 14));
  const bottom = inputRect
    ? Math.max(8, Math.round(mainRect.bottom - inputRect.top + 14))
    : Math.max(8, Math.round(mainRect.bottom - containerRect.bottom + 14));
  const left = Math.max(4, Math.round(messagesRect.left - mainRect.left - 22));
  rail.style.setProperty("--message-trace-top", `${top}px`);
  rail.style.setProperty("--message-trace-bottom", `${bottom}px`);
  rail.style.setProperty("--message-trace-left", `${left}px`);
  return true;
}

function updateMessageTraceRail() {
  const rail = $("#message-trace-rail");
  const track = $("#message-trace-track");
  const container = $("#chat-container");
  const messages = $("#messages");
  if (!rail || !track || !container || !messages) return false;

  const articles = Array.from(messages.children || []).filter((node) => node?.classList?.contains("message"));
  const visible = state.sessionMode === "agent" && articles.length > 0;
  hideMessageTracePreview();
  rail.classList.toggle("hidden", !visible);
  rail.setAttribute("aria-hidden", visible ? "false" : "true");
  container.classList.toggle("has-message-trace", visible);
  if (visible) syncMessageTraceGeometry();
  while (track.firstChild) track.removeChild(track.firstChild);
  if (!visible) return false;

  const viewport = container.getBoundingClientRect();
  const viewportCenter = viewport.top + (viewport.height / 2);
  const trackRect = track.getBoundingClientRect();
  const availableHeight = Math.max(0, trackRect.height);
  const traceTargetStep = 12;
  const traceStep = articles.length > 1
    ? Math.min(traceTargetStep, availableHeight / (articles.length - 1))
    : 0;
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  articles.forEach((article, index) => {
    article.dataset.traceIndex = String(index);
    // The rail is a compact navigation index, not a miniature copy of the
    // document's variable-height geometry. Keep short transcripts tight like
    // Claude Code; only compress the step when many ticks cannot fit.
    const top = articles.length > 1 ? index * traceStep : Math.min(availableHeight / 2, 6);
    const tick = document.createElement("button");
    tick.type = "button";
    tick.className = "message-trace-tick";
    tick.dataset.traceIndex = String(index);
    const roleLabel = article.dataset.role === "user" ? "用户" : "助手";
    tick.title = `跳转到第 ${index + 1} 条${roleLabel}消息`;
    tick.setAttribute("aria-label", tick.title);
    tick.style.top = `${top}px`;
    tick.addEventListener("pointerenter", () => showMessageTracePreview(index));
    tick.addEventListener("focus", () => showMessageTracePreview(index));
    tick.addEventListener("pointerleave", hideMessageTracePreview);
    tick.addEventListener("blur", () => {
      if (!rail.contains(document.activeElement)) hideMessageTracePreview();
    });
    tick.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        hideMessageTracePreview();
        tick.blur();
      }
    });
    tick.addEventListener("click", () => {
      hideMessageTracePreview();
      const target = articles[index];
      if (!target) return;
      const token = SessionScrollRegistry.beginProjection(state.sessionId);
      try {
        const max = Math.max(0, container.scrollHeight - container.clientHeight);
        // offsetTop is relative to the article's offset parent, not reliably
        // to #chat-container after the rail/composer grid is laid out.  Use
        // the two live rects in the shared CSS/DIP space and adjust from the
        // current scroll position so the real target message is centered.
        const targetRect = target.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const targetCenter = targetRect.top + (targetRect.height / 2);
        const viewportCenter = containerRect.top + (container.clientHeight / 2);
        const targetTop = Math.min(max, Math.max(0, container.scrollTop + targetCenter - viewportCenter));
        container.scrollTop = targetTop;
        SessionScrollRegistry.set(state.sessionId, isNearChatBottom(), container.scrollTop);
      } finally {
        SessionScrollRegistry.finishProjection(state.sessionId, token);
      }
      updateMessageTraceRail();
    });
    track.appendChild(tick);

    const rect = article.getBoundingClientRect();
    const distance = Math.abs((rect.top + (rect.height / 2)) - viewportCenter);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  Array.from(track.children).forEach((tick, index) => {
    const active = index === nearestIndex;
    tick.classList.toggle("active", active);
    if (active) tick.setAttribute("aria-current", "true");
    else tick.removeAttribute("aria-current");
  });
  return true;
}

function dailyUsageNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function normalizeDailyUsage(payload = {}) {
  const days = (Array.isArray(payload.days) ? payload.days : []).map((item) => {
    const inputTokens = dailyUsageNumber(item?.input_tokens);
    const outputTokens = dailyUsageNumber(item?.output_tokens);
    const cacheCreationTokens = dailyUsageNumber(item?.cache_creation_input_tokens);
    const cacheReadTokens = dailyUsageNumber(item?.cache_read_input_tokens);
    return {
      date: String(item?.date || ""),
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: cacheCreationTokens,
      cache_read_input_tokens: cacheReadTokens,
      total_tokens: dailyUsageNumber(item?.total_tokens ?? (inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens)),
      run_count: dailyUsageNumber(item?.run_count)
    };
  });
  const computed = days.reduce((totals, day) => {
    totals.input_tokens += day.input_tokens;
    totals.output_tokens += day.output_tokens;
    totals.cache_creation_input_tokens += day.cache_creation_input_tokens;
    totals.cache_read_input_tokens += day.cache_read_input_tokens;
    totals.total_tokens += day.total_tokens;
    totals.run_count += day.run_count;
    return totals;
  }, {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    total_tokens: 0,
    run_count: 0
  });
  const declaredTotals = payload?.totals && typeof payload.totals === "object" ? payload.totals : {};
  const totalValue = (field, rootField = null) => {
    if (declaredTotals[field] !== undefined) return dailyUsageNumber(declaredTotals[field]);
    if (rootField && payload[rootField] !== undefined) return dailyUsageNumber(payload[rootField]);
    return computed[field];
  };
  const totals = {
    input_tokens: totalValue("input_tokens"),
    output_tokens: totalValue("output_tokens"),
    cache_creation_input_tokens: totalValue("cache_creation_input_tokens"),
    cache_read_input_tokens: totalValue("cache_read_input_tokens"),
    total_tokens: totalValue("total_tokens", "total_tokens"),
    run_count: totalValue("run_count", "run_count")
  };
  return {
    status: totals.total_tokens > 0 ? "ready" : "empty",
    source: String(payload?.source || ""),
    timezone: payload?.timezone || "",
    days,
    totals,
    error: ""
  };
}

function usageIntensity(value, maximum) {
  const amount = dailyUsageNumber(value);
  const max = dailyUsageNumber(maximum);
  if (!amount || !max) return 0;
  return Math.min(4, Math.max(1, Math.ceil((amount / max) * 4)));
}

function formatExactTokenCount(value) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(dailyUsageNumber(value));
}

function dailyUsageTimezoneLabel(timezone) {
  if (!timezone) return "本机时区";
  if (typeof timezone === "string") return timezone;
  const name = String(timezone.name || "").trim();
  const offset = String(timezone.utc_offset || "").trim();
  return [name, offset].filter(Boolean).join(" ") || "本机时区";
}

function dailyUsageSourceLabel(source) {
  return source === "claude-code-stream-json-local"
    ? "本机 Claude Code stream-json"
    : "本机 Token 记录";
}

function renderDailyUsageHeatmap(days) {
  const maximum = Math.max(0, ...days.map((day) => day.total_tokens));
  const firstDate = days[0]?.date ? new Date(`${days[0].date}T00:00:00`) : null;
  const leadingDays = firstDate && !Number.isNaN(firstDate.getTime()) ? (firstDate.getDay() + 6) % 7 : 0;
  const leading = Array.from({ length: leadingDays }, () => '<span class="daily-usage-day daily-usage-day-blank" aria-hidden="true"></span>');
  const cells = days.map((day) => {
      const level = usageIntensity(day.total_tokens, maximum);
      const exact = formatExactTokenCount(day.total_tokens);
      const title = `${day.date}：总计 ${exact} token；输入 ${formatExactTokenCount(day.input_tokens)}；输出 ${formatExactTokenCount(day.output_tokens)}；缓存创建 ${formatExactTokenCount(day.cache_creation_input_tokens)}；缓存读取 ${formatExactTokenCount(day.cache_read_input_tokens)}；运行 ${formatExactTokenCount(day.run_count)} 次`;
      return `<span class="daily-usage-day usage-level-${level}" role="img" tabindex="0" title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}">
      </span>`;
    });
  const range = days.length || state.dailyUsage.rangeDays || 30;
  return `<div class="daily-usage-heatmap" role="group" aria-label="近 ${range} 天每日本机 Token 用量">
    ${leading.concat(cells).join("")}
  </div>`;
}

function dailyUsageMetrics(days, totals) {
  const cacheTotal = totals.cache_creation_input_tokens + totals.cache_read_input_tokens;
  const activeDays = days.filter((day) => day.total_tokens > 0 || day.run_count > 0).length;
  return `<div class="daily-usage-metrics" aria-label="Token 类型汇总">
    <div><span>运行次数</span><strong>${formatExactTokenCount(totals.run_count)}</strong></div>
    <div><span>总 Token</span><strong>${formatExactTokenCount(totals.total_tokens)}</strong></div>
    <div><span>活跃天数</span><strong>${formatExactTokenCount(activeDays)}</strong></div>
    <div><span>输入</span><strong>${formatExactTokenCount(totals.input_tokens)}</strong></div>
    <div><span>输出</span><strong>${formatExactTokenCount(totals.output_tokens)}</strong></div>
    <div title="缓存创建 ${formatExactTokenCount(totals.cache_creation_input_tokens)}；缓存读取 ${formatExactTokenCount(totals.cache_read_input_tokens)}"><span>缓存</span><strong>${formatExactTokenCount(cacheTotal)}</strong><small>创建 ${formatExactTokenCount(totals.cache_creation_input_tokens)} · 读取 ${formatExactTokenCount(totals.cache_read_input_tokens)}</small></div>
  </div>`;
}

function dailyUsagePanelContent(usage = state.dailyUsage) {
  const status = usage?.status || "idle";
  if (status === "loading" || status === "idle") {
    return `<div class="daily-usage-status" role="status"><strong>正在读取本机 Token 记录…</strong><span>仅统计本机 Claude Code stream-json，不代表官网额度。</span></div>
      <div class="daily-usage-heatmap daily-usage-loading" aria-hidden="true">${Array.from({ length: usage.rangeDays || 30 }, (_, index) => `<span style="--loading-index:${index}"></span>`).join("")}</div>`;
  }
  if (status === "error") {
    return `<div class="daily-usage-status daily-usage-error" role="status"><strong>本机 Token 用量暂不可用</strong><span>无法读取本地 stream-json 记录；不会用估算值或官网额度代替。</span><button type="button" data-usage-action="retry">重新读取</button></div>`;
  }
  const totals = usage.totals || normalizeDailyUsage({}).totals;
  const days = usage.days || [];
  const heatmap = renderDailyUsageHeatmap(days);
  const emptyGuidance = status === "empty"
    ? `<p class="daily-usage-empty-guidance">所选时段尚未记录到本机 Claude Code stream-json Token。运行一次 Agent 任务后，这里会出现使用记录。</p>`
    : "";
  return `${dailyUsageMetrics(days, totals)}${heatmap}${emptyGuidance}
    <p class="daily-usage-source">来源：${escapeHtml(dailyUsageSourceLabel(usage.source))} · ${escapeHtml(dailyUsageTimezoneLabel(usage.timezone))} · 这是本机观测，不是官网账户额度</p>`;
}

function dailyUsagePanelMarkup(usage = state.dailyUsage) {
  const rangeDays = usage.rangeDays === 7 ? 7 : 30;
  const disabled = usage.status === "loading" ? " disabled" : "";
  return `<header class="daily-usage-heading"><div><p>Overview · 本机观测</p><h1 id="agent-daily-usage-title">本机 Token 用量</h1></div><div class="daily-usage-ranges" role="group" aria-label="用量时间范围"><button type="button" data-usage-range="30" aria-pressed="${rangeDays === 30 ? "true" : "false"}"${disabled}>30天</button><button type="button" data-usage-range="7" aria-pressed="${rangeDays === 7 ? "true" : "false"}"${disabled}>7天</button></div></header><div class="daily-usage-content">${dailyUsagePanelContent(usage)}</div>`;
}

function renderDailyUsagePanel() {
  const panel = $("#agent-daily-usage");
  if (!panel) return false;
  panel.dataset.usageStatus = state.dailyUsage.status || "idle";
  panel.innerHTML = dailyUsagePanelMarkup(state.dailyUsage);
  return true;
}

async function refreshDailyUsage({ force = false, reason = "manual" } = {}) {
  if (state.dailyUsageRequest) return state.dailyUsageRequest;
  const requestedDays = state.dailyUsage.rangeDays === 7 ? 7 : 30;
  const fresh = state.dailyUsage.lastFetchedAt && (Date.now() - state.dailyUsage.lastFetchedAt < 10000);
  if (!force && fresh && state.dailyUsage.loadedRangeDays === requestedDays && ["ready", "empty"].includes(state.dailyUsage.status)) {
    renderDailyUsagePanel();
    return state.dailyUsage;
  }
  state.dailyUsage = { ...state.dailyUsage, status: "loading", rangeDays: requestedDays, error: "" };
  renderDailyUsagePanel();
  state.dailyUsageRequest = (async () => {
    try {
      const response = await fetch(`/api/usage/daily?days=${requestedDays}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.detail || `HTTP ${response.status}`);
      const normalized = normalizeDailyUsage(payload);
      state.dailyUsage = {
        ...normalized,
        rangeDays: requestedDays,
        loadedRangeDays: requestedDays,
        lastFetchedAt: Date.now(),
        emptyRefreshKey: state.dailyUsage.emptyRefreshKey,
        refreshReason: reason
      };
      return state.dailyUsage;
    } catch (error) {
      state.dailyUsage = {
        ...normalizeDailyUsage({}),
        status: "error",
        rangeDays: requestedDays,
        loadedRangeDays: 0,
        lastFetchedAt: 0,
        emptyRefreshKey: state.dailyUsage.emptyRefreshKey,
        error: String(error?.message || error || "暂不可用"),
        refreshReason: reason
      };
      return state.dailyUsage;
    } finally {
      state.dailyUsageRequest = null;
      renderDailyUsagePanel();
    }
  })();
  return state.dailyUsageRequest;
}

async function selectDailyUsageRange(days) {
  const next = Number(days) === 7 ? 7 : 30;
  if (state.dailyUsageRequest) return state.dailyUsageRequest;
  if (state.dailyUsage.rangeDays === next && state.dailyUsage.loadedRangeDays === next && ["ready", "empty"].includes(state.dailyUsage.status)) {
    return state.dailyUsage;
  }
  state.dailyUsage = { ...state.dailyUsage, rangeDays: next, emptyRefreshKey: "" };
  renderDailyUsagePanel();
  return refreshDailyUsage({ force: true, reason: `range-${next}` });
}

function refreshDailyUsageForEmptyAgent() {
  if (state.viewMode !== "agent" || state.messages.length) return;
  const key = `${String(state.sessionId || "agent-startup")}:${state.dailyUsage.rangeDays === 7 ? 7 : 30}`;
  if (state.dailyUsage.emptyRefreshKey === key) return;
  state.dailyUsage.emptyRefreshKey = key;
  if (state.dailyUsageRequest) return;
  const selectedRange = state.dailyUsage.rangeDays === 7 ? 7 : 30;
  const fresh = state.dailyUsage.loadedRangeDays === selectedRange
    && state.dailyUsage.lastFetchedAt
    && (Date.now() - state.dailyUsage.lastFetchedAt < 10000);
  if (!fresh) void refreshDailyUsage({ reason: "agent-empty" });
}

function renderWelcome() {
  const agent = state.viewMode === "agent";
  const eyebrow = "Chat";
  const title = "今天想聊什么？";
  const copy = "只进行对话，不会调用工具或操作文件。";
  const actions = [
        ["帮我解释这个概念并举一个例子", "解释概念"],
        ["帮我把这段文字改得更清晰", "润色文字"],
        ["帮我整理一个思路", "整理思路"]
      ];
  const icon = `<img class="welcome-icon" src="/static/assets/viniper-icon.png?v=${encodeURIComponent(state.status?.version || "preview")}" alt="" aria-hidden="true">`;
  const runtimeView = runtimeSetupViewModel(state.status?.runtime || {});
  $("#messages").innerHTML = agent
    ? (runtimeView.ready
      ? `<div class="welcome agent-welcome"><section id="agent-daily-usage" class="agent-daily-usage" data-usage-status="${escapeAttr(state.dailyUsage.status || "idle")}" aria-labelledby="agent-daily-usage-title">${dailyUsagePanelMarkup(state.dailyUsage)}</section><span class="sr-only">Agent 工作区已就绪</span></div>`
      : `<div class="welcome agent-welcome runtime-setup-welcome">
          <div class="runtime-setup-card" data-runtime-status="${escapeAttr(runtimeView.status)}">
            <span class="runtime-setup-progress">${escapeHtml(runtimeView.progress)}</span>
            <h1>${escapeHtml(runtimeView.title)}</h1>
            <p>${escapeHtml(runtimeView.detail)}</p>
            <div class="runtime-setup-actions">
              <button class="primary-button" type="button" data-runtime-action="setup"${state.runtimeBusy || !runtimeView.canInstall ? " disabled" : ""}>${escapeHtml(state.runtimeBusy ? "正在处理" : runtimeView.actionLabel)}</button>
              <button class="ghost-button" type="button" data-runtime-action="later">稍后</button>
              <button class="ghost-button" type="button" data-runtime-action="diagnostics">打开诊断</button>
            </div>
          </div>
        </div>`)
    : `
      <div class="welcome chat-welcome">
        ${icon}
        <p class="welcome-eyebrow">${escapeHtml(eyebrow)}</p>
        <h1>${escapeHtml(title)}</h1>
        <p class="welcome-copy">${escapeHtml(copy)}</p>
        <div class="quick-actions">
          ${actions.map(([prompt, label]) => `<button class="quick-btn" data-prompt="${escapeAttr(prompt)}">${escapeHtml(label)}</button>`).join("")}
        </div>
      </div>
    `;
  if (agent && runtimeView.ready) refreshDailyUsageForEmptyAgent();
  updateContextRail();
  updateMessageTraceRail();
}

function renderAllMessages() {
  if (!state.messages.length) {
    $("#chat-container")?.classList.toggle("chat-empty-state", state.viewMode === "chat");
    renderWelcome();
    updateStoredThinkingTimer();
    updateContextRail();
    return;
  }

  $("#chat-container")?.classList.remove("chat-empty-state");
  $("#messages").innerHTML = state.messages.map((message, index) => {
    const roleClass = message.role === "system" ? "system" : message.role;
    const label = message.role === "user"
      ? ""
      : (message.role === "system" ? "上下文摘要" : "");
    const content = message.content;
    return messageTemplate(roleClass, label, content, message.thinking || "", message.segments || [], { ...message, traceIndex: index });
  }).join("");
  updateStoredThinkingTimer();
  updateContextRail();
  updateMessageTraceRail();
  if (SessionRunRegistry.get(state.sessionId)?.active) renderSessionRun(state.sessionId);
}

function addMessage(role, content, meta = {}) {
  const welcome = $(".welcome");
  if (welcome) welcome.remove();
  $("#chat-container")?.classList.remove("chat-empty-state");

  const roleClass = role;
  const runSessionId = String(meta?.runSessionId || meta?.run_session_id || "");
  const message = {
    role,
    content: String(content || ""),
    ...meta,
  };
  if (runSessionId) message.run_session_id = runSessionId;
  if (role === "assistant" && runSessionId && SessionRunRegistry.get(runSessionId)?.active) {
    message.pending = true;
    message.segments = Array.isArray(message.segments) ? message.segments : [];
  }
  state.messages.push(message);
  const label = role === "user" ? "" : assistantLabel(state.selectedModel);
  $("#messages").insertAdjacentHTML("beforeend", messageTemplate(
    roleClass,
    label,
    message.content,
    message.thinking || "",
    message.segments || [],
    { ...message, traceIndex: state.messages.length - 1 },
  ));
  updateContextRail();
  updateMessageTraceRail();
  return $("#messages .message:last-child .msg-content");
}

function assistantLabel(modelId) {
  const option = (state.status?.models || []).find((model) => model.id === modelId);
  return option ? (option.label || option.id || modelId || "") : (modelId || "");
}

function messageTemplate(roleClass, label, content, thinking = "", segments = [], meta = {}) {
  const displayContent = repairTextForDisplay(content);
  const displayThinking = repairTextForDisplay(thinking);
  const displaySegments = Array.isArray(segments) ? segments : [];
  const isGuidance = roleClass === "guidance" || Boolean(meta?.guidance || meta?.steer);
  const renderedRoleClass = isGuidance ? "guidance" : roleClass;
  const activeRun = roleClass === "assistant" && state.sessionId
    ? SessionRunRegistry.get(state.sessionId)?.active
    : false;
  const isPending = roleClass === "assistant" && Boolean(meta?.pending) && Boolean(activeRun);
  const body = roleClass === "assistant" && (displaySegments.length || activeRun || Number.isFinite(Number(meta?.elapsed_seconds ?? meta?.elapsedSeconds)))
    ? renderMessageSegments(displaySegments, {
        totalElapsedSeconds: meta?.elapsed_seconds
          ?? meta?.elapsedSeconds
          ?? (activeRun ? runElapsedSeconds(SessionRunRegistry.get(state.sessionId)) : undefined),
        turnUsage: meta?.turn_usage ?? meta?.turnUsage
          ?? (activeRun ? SessionRunRegistry.get(state.sessionId)?.turnUsage : undefined),
        activeThinking: isPending,
        hideThinking: !isPending
      })
    : (roleClass === "assistant" || roleClass === "error"
      ? renderAssistantContentHtml(displayContent)
      : renderUserContentHtml(displayContent, meta?.attachments || []));
  const header = isGuidance
    ? `<header class="msg-header guidance-marker"><svg viewBox="0 0 18 18" aria-hidden="true"><path d="M4 4v4.5A3.5 3.5 0 0 0 7.5 12H14"/><path d="m11 9 3 3-3 3"/></svg><span>已引导当前任务</span></header>`
    : (roleClass === "system" && label ? `<header class="msg-header">${escapeHtml(label)}</header>` : "");
  const pendingAttr = isPending ? ` data-pending="true"` : "";
  const runSessionId = roleClass === "assistant"
    ? String(meta?.runSessionId || meta?.run_session_id || (isPending ? state.sessionId : "") || "")
    : "";
  const runAttr = runSessionId ? ` data-run-session-id="${escapeAttr(runSessionId)}"` : "";
  const traceIndex = Number.isInteger(Number(meta?.traceIndex)) ? ` data-trace-index="${Number(meta.traceIndex)}"` : "";
  const runStatus = roleClass === "assistant" && meta?.retryable
    ? `<p class="message-run-status" role="status">发送失败，可重试</p>`
    : "";
  return `
    <article class="message ${renderedRoleClass}" data-role="${escapeAttr(renderedRoleClass)}"${traceIndex}${pendingAttr}${runAttr}>
      ${header}
      ${displayThinking && roleClass === "assistant" && !displaySegments.length && isPending ? renderThinkingPanel(displayThinking, { activeThinking: true }) : ""}
      <div class="msg-content">${body}</div>
      ${runStatus}
    </article>
  `;
}

function attachmentKind(item = {}) {
  const type = String(item.type || "").toLowerCase();
  const name = String(item.name || "");
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  if (type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext)) return "IMG";
  if (type.includes("pdf") || ext === "pdf") return "PDF";
  if (["doc", "docx"].includes(ext)) return "DOC";
  if (["xls", "xlsx", "csv"].includes(ext)) return "XLS";
  if (["ppt", "pptx"].includes(ext)) return "PPT";
  if (["zip", "rar", "7z", "gz", "tgz"].includes(ext)) return "ZIP";
  if (["js", "ts", "tsx", "jsx", "py", "css", "html", "json", "md", "txt"].includes(ext)) return "TXT";
  return "FILE";
}

function isImageAttachment(item = {}) {
  return attachmentKind(item) === "IMG";
}

function attachmentPreviewSrc(item = {}) {
  if (!isImageAttachment(item)) return "";
  if (item.url) return String(item.url);
  const data = String(item.data || "");
  if (!data) return "";
  if (data.startsWith("data:")) return data;
  return `data:${item.type || "image/png"};base64,${data}`;
}

function renderMessageAttachments(attachments = []) {
  const safeItems = Array.isArray(attachments) ? attachments : [];
  if (!safeItems.length) return "";
  const items = safeItems.map((item) => {
    const previewSrc = attachmentPreviewSrc(item);
    const imagePreview = previewSrc
      ? `<img class="message-attachment-thumb" src="${escapeAttr(previewSrc)}" alt="${escapeAttr(item.name || "image")}">`
      : "";
    const kind = attachmentKind(item);
    return (
      `<span class="message-attachment-card${previewSrc ? " is-image" : ""}" title="${escapeAttr(item.name || "attachment")}">` +
        imagePreview +
        `<span class="message-attachment-row">` +
          `<span class="message-attachment-icon">${escapeHtml(kind)}</span>` +
          `<span class="message-attachment-main">` +
            `<span class="message-attachment-name">${escapeHtml(item.name || "attachment")}</span>` +
            `<span class="message-attachment-meta">${escapeHtml(formatBytes(item.size || 0))}</span>` +
          `</span>` +
        `</span>` +
      `</span>`
    );
  }).join("");
  return `<div class="message-attachments" aria-label="附件">${items}</div>`;
}

function renderUserContentHtml(content, attachments = []) {
  const text = repairTextForDisplay(content || "").trim();
  const textHtml = text ? `<div class="user-text">${escapeHtml(text)}</div>` : "";
  return `${textHtml}${renderMessageAttachments(attachments)}`;
}

function liveTimeAttrs(enabled, elapsedSeconds) {
  if (!enabled || !Number.isFinite(Number(elapsedSeconds))) return "";
  const base = Math.max(0, Math.round(Number(elapsedSeconds)));
  return ` data-live-time="true" data-elapsed-base="${base}" data-rendered-at="${Date.now()}"`;
}

function updateLiveTimeNode(node, prefix) {
  const base = Math.max(0, Number(node.dataset.elapsedBase || 0));
  const renderedAt = Number(node.dataset.renderedAt || Date.now());
  const elapsed = Math.max(0, Math.round(base + ((Date.now() - renderedAt) / 1000)));
  const tokenLabel = node.dataset.tokenLabel ? ` · ${node.dataset.tokenLabel} tokens` : "";
  const text = `${prefix} ${formatDuration(elapsed)}${tokenLabel}`;
  const label = node.querySelector?.("[data-live-time-label]");
  if (label) label.textContent = text;
  else node.textContent = text;
}

function updateStoredThinkingTimes() {
  const pendingMessages = $$(".message.assistant[data-pending='true']");
  for (const article of pendingMessages) {
    const total = article.querySelector("[data-live-total='true']");
    if (total) updateLiveTimeNode(total, "本轮用时");
    for (const node of Array.from(article.querySelectorAll("[data-live-thinking='true']"))) {
      updateLiveTimeNode(node, "思考中");
    }
  }
}

function updateStoredThinkingTimer() {
  if (state.storedThinkingTimer) {
    window.clearInterval(state.storedThinkingTimer);
    state.storedThinkingTimer = null;
  }
  if (!$(".message.assistant[data-pending='true']")) return;
  updateStoredThinkingTimes();
  state.storedThinkingTimer = window.setInterval(updateStoredThinkingTimes, 1000);
}

function ensureStoredThinkingTimer() {
  if (state.storedThinkingTimer || !$(".message.assistant[data-pending='true']")) return;
  updateStoredThinkingTimes();
  state.storedThinkingTimer = window.setInterval(updateStoredThinkingTimes, 1000);
}

function activityIconSvg(kind = "tool", className = "activity-icon") {
  const name = String(kind || "").toLowerCase();
  const path = /message|消息|peer/.test(name)
    ? '<path d="M3.25 4.25h11.5v7.5H8l-3.25 2.5v-2.5h-1.5z"/>'
    : /read|读取|file|文件/.test(name)
    ? '<path d="M4 2.75h6l3 3v9.5H4z"/><path d="M10 2.75v3h3M6.5 9h4M6.5 12h4"/>'
    : /write|edit|写|改/.test(name)
      ? '<path d="m4 12.8-.7 2.9 2.9-.7L13.8 7.4 11.6 5.2z"/><path d="m10.8 6 2.2 2.2M4 3.5h4"/>'
      : /search|grep|搜索|查/.test(name)
        ? '<circle cx="7.5" cy="7.5" r="4.25"/><path d="m10.8 10.8 3.2 3.2"/>'
        : '<path d="M4 3.5h10v11H4z"/><path d="m6.5 7 2 2-2 2M9.5 11h2"/>';
  return `<svg class="${escapeAttr(className)}" viewBox="0 0 18 18" aria-hidden="true">${path}</svg>`;
}

function thinkingIconSvg() {
  return '<svg class="thinking-icon" viewBox="0 0 18 18" aria-hidden="true"><circle cx="5" cy="9" r="1.35"/><circle cx="9" cy="9" r="1.35"/><circle cx="13" cy="9" r="1.35"/></svg>';
}

function activityName(segment = {}) {
  return String(segment.name || segment.tool || "").trim();
}

function activityDetail(segment = {}) {
  return String(segment.summary || segment.detail || "").trim();
}

function sameAdjacentToolName(start = {}, result = {}) {
  const startName = activityName(start);
  const resultName = activityName(result);
  return !startName || !resultName || startName === resultName;
}

function mergeActivitySegments(segments = []) {
  const merged = [];
  const byToolId = new Map();
  const byPeerToolId = new Map();
  let previousRaw = null;

  for (const source of Array.isArray(segments) ? segments : []) {
    const segment = source && typeof source === "object" ? { ...source } : {};
    const type = String(segment.type || "");
    if (type === "peer_outgoing") {
      const toolId = String(segment.tool_id || "").trim();
      const summary = { type: "peer_summary", tool_id: toolId || null, start: segment, result: null };
      const index = merged.push(summary) - 1;
      if (toolId) byPeerToolId.set(toolId, index);
      previousRaw = null;
      continue;
    }
    if (type === "peer_delivery") {
      const toolId = String(segment.tool_id || "").trim();
      const existingIndex = toolId ? byPeerToolId.get(toolId) : undefined;
      if (Number.isInteger(existingIndex)) {
        merged[existingIndex].result = segment;
      } else {
        const index = merged.push({ type: "peer_summary", tool_id: toolId || null, start: null, result: segment }) - 1;
        if (toolId) byPeerToolId.set(toolId, index);
      }
      previousRaw = null;
      continue;
    }
    if (type !== "tool_start" && type !== "tool_result") {
      merged.push(segment);
      previousRaw = null;
      continue;
    }

    const toolId = String(segment.tool_id || "").trim();
    if (type === "tool_start") {
      const existingIndex = toolId ? byToolId.get(toolId) : undefined;
      if (Number.isInteger(existingIndex)) {
        const existing = merged[existingIndex];
        existing.start = segment;
        existing.name = activityName(segment) || existing.name;
        previousRaw = { type, toolId, segment, index: existingIndex };
        continue;
      }
      const summary = {
        type: "tool_summary",
        tool_id: toolId || null,
        name: activityName(segment),
        start: segment,
        result: null
      };
      const index = merged.push(summary) - 1;
      if (toolId) byToolId.set(toolId, index);
      previousRaw = { type, toolId, segment, index };
      continue;
    }

    const existingIndex = toolId ? byToolId.get(toolId) : undefined;
    if (Number.isInteger(existingIndex)) {
      const existing = merged[existingIndex];
      existing.result = segment;
      existing.name = activityName(existing.start) || activityName(segment) || existing.name;
      previousRaw = { type, toolId, segment, index: existingIndex };
      continue;
    }

    if (!toolId && previousRaw?.type === "tool_start" && !previousRaw.toolId && sameAdjacentToolName(previousRaw.segment, segment)) {
      const adjacent = merged[previousRaw.index];
      adjacent.result = segment;
      adjacent.name = activityName(adjacent.start) || activityName(segment) || adjacent.name;
      previousRaw = { type, toolId, segment, index: previousRaw.index };
      continue;
    }

    const summary = {
      type: "tool_summary",
      tool_id: toolId || null,
      name: activityName(segment),
      start: null,
      result: segment
    };
    const index = merged.push(summary) - 1;
    if (toolId) byToolId.set(toolId, index);
    previousRaw = { type, toolId, segment, index };
  }

  return merged;
}

function renderToolSummary(summary = {}, index = 0) {
  const start = summary.start || {};
  const hasResult = Boolean(summary.result);
  const result = summary.result || {};
  const name = summary.name || activityName(start) || activityName(result) || "工具";
  const detail = activityDetail(start) || activityDetail(result);
  const rawStatus = String(result.status || start.status || "running");
  const status = hasResult
    ? (/fail|error|失败/i.test(rawStatus) ? "error" : "success")
    : "pending";
  const toolId = summary.tool_id ? ` data-tool-id="${escapeAttr(summary.tool_id)}"` : "";
  const images = Array.isArray(result.images) ? result.images.map((image) => renderImageSegment(image, index, "tool-image")).join("") : "";
  return `<div class="tool-summary tool-summary-${status}" data-segment-index="${index}" data-activity="tool_summary" data-tool-status="${escapeAttr(rawStatus)}"${toolId} aria-label="${escapeAttr(`${name}：${rawStatus}`)}">
    ${activityIconSvg(name, "tool-summary-icon")}
    <span class="tool-status-dot" aria-hidden="true"></span>
    <span class="tool-summary-name">${escapeHtml(name)}</span>
    ${detail ? `<span class="tool-summary-detail">${escapeHtml(detail)}</span>` : ""}
  </div>${images ? `<div class="message-image-gallery tool-image-gallery">${images}</div>` : ""}`;
}

function safeImageDataUrl(segment = {}) {
  const mime = String(segment.mime_type || segment.mimeType || "").toLowerCase();
  const supported = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
  const data = String(segment.data || "").trim();
  if (!supported.has(mime) || !data || data.length > 14 * 1024 * 1024) return "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 !== 0) return "";
  return `data:${mime};base64,${data}`;
}

function renderImageSegment(segment = {}, index = 0, extraClass = "") {
  const source = safeImageDataUrl(segment);
  if (!source) return "";
  const alt = String(segment.alt || "图片");
  return `<figure class="message-image ${escapeAttr(extraClass)}" data-segment-index="${index}"><img src="${escapeAttr(source)}" alt="${escapeAttr(alt)}" loading="lazy" decoding="async"><figcaption>${escapeHtml(alt)}</figcaption></figure>`;
}

function renderArtifactSummary(segment = {}, index = 0) {
  const path = String(segment.path || segment.content || "").trim();
  const name = String(segment.name || artifactName(path) || "文件");
  const image = renderImageSegment(segment.image, index, "artifact-image");
  return `<div class="artifact-summary" data-segment-index="${index}" data-activity="artifact" aria-label="文件：${escapeAttr(name)}">
    ${activityIconSvg("文件", "artifact-summary-icon")}
    <span class="artifact-summary-path" title="${escapeAttr(path)}">${escapeHtml(name)}</span>
    <span class="artifact-inline-status" aria-live="polite"></span>
    ${path ? `<span class="artifact-inline-actions"><button class="artifact-inline-button" type="button" data-file-action="open" data-file-path="${escapeAttr(path)}">打开</button><button class="artifact-inline-button" type="button" data-file-action="reveal" data-file-path="${escapeAttr(path)}">位置</button></span>` : ""}
  </div>${image ? `<div class="message-image-gallery artifact-image-gallery">${image}</div>` : ""}`;
}

function peerStatusLabel(value) {
  const status = String(value || "sending").toLowerCase();
  if (["delivered", "success", "sent"].includes(status)) return "已送达";
  if (["held", "pending", "queued"].includes(status)) return "已保留";
  if (["refused", "denied"].includes(status)) return "已拒绝";
  if (["failed", "error", "dropped"].includes(status)) return "发送失败";
  return "发送中";
}

function renderPeerSummary(summary = {}, index = 0) {
  const start = summary.start || {};
  const result = summary.result || {};
  const target = String(result.target || start.target || "目标会话");
  const status = String(result.status || start.status || "sending");
  const content = String(result.content || start.content || "").trim();
  return `<div class="peer-summary peer-summary-${escapeAttr(status)}" data-segment-index="${index}" data-activity="peer_summary" data-peer-status="${escapeAttr(status)}">
    ${activityIconSvg("message", "peer-summary-icon")}
    <span class="peer-summary-copy"><strong>发送给 ${escapeHtml(target)}</strong>${content ? `<small>${escapeHtml(content)}</small>` : ""}</span>
    <span class="peer-summary-status">${escapeHtml(peerStatusLabel(status))}</span>
  </div>`;
}

function renderPeerIncoming(segment = {}, index = 0) {
  const sender = String(segment.sender_display_name || segment.sender || "其他会话");
  const content = String(segment.content || "").trim();
  const reply = segment.sender_session_id
    ? `<button type="button" class="peer-reply-button" data-peer-reply-session="${escapeAttr(segment.sender_session_id)}">回复</button>`
    : "";
  return `<details class="peer-incoming" data-segment-index="${index}" data-activity="peer_incoming">
    <summary>${activityIconSvg("message", "peer-summary-icon")}<span>来自 ${escapeHtml(sender)} 的消息</span></summary>
    <div class="peer-incoming-body"><p>${escapeHtml(content)}</p>${reply}</div>
  </details>`;
}

function renderMessageSegments(segments = [], options = {}) {
  const displaySegments = mergeActivitySegments(segments);
  const turnUsage = normalizeTurnUsage(options.turnUsage || options.turn_usage);
  const compactTokenLabel = turnUsage && turnUsage.total_tokens > 0
    ? formatCompactTokenCount(turnUsage.total_tokens)
    : "";
  const tokenLabel = compactTokenLabel ? ` · ${compactTokenLabel}` : "";
  const tokenAttr = compactTokenLabel ? ` data-token-label="${escapeAttr(compactTokenLabel)}"` : "";
  const explicitTotalElapsed = Number(options.totalElapsedSeconds);
  const derivedTotalElapsed = displaySegments.reduce((sum, segment) => {
    const elapsed = Number(segment?.elapsed_seconds ?? segment?.elapsedSeconds);
    return Number.isFinite(elapsed) ? sum + Math.max(0, elapsed) : sum;
  }, 0);
  const totalElapsed = Number.isFinite(explicitTotalElapsed)
    ? explicitTotalElapsed
    : (derivedTotalElapsed > 0 ? derivedTotalElapsed : NaN);
  const activeThinkingIndex = options.activeThinking
    ? displaySegments.reduce((lastIndex, segment, index) => segment?.type === "thinking" ? index : lastIndex, -1)
    : -1;
  const body = displaySegments.map((segment, index) => {
    if (segment?.type === "thinking" && options.hideThinking) return "";
    if (segment?.type === "interaction") {
      return "";
    }
    if (segment?.type === "tool_summary") {
      return renderToolSummary(segment, index);
    }
    if (segment?.type === "artifact") {
      return renderArtifactSummary(segment, index);
    }
    if (segment?.type === "image") {
      return renderImageSegment(segment, index);
    }
    if (segment?.type === "interaction_result") {
      const label = segment.status === "accepted"
        ? (segment.kind === "question" ? "已回答询问" : (segment.action === "deny" ? "已拒绝权限" : "已确认权限"))
        : "交互未完成";
      return `<div class="interaction-result-summary" data-interaction-result="${escapeAttr(segment.request_id || "")}">${escapeHtml(label)}</div>`;
    }
    if (segment?.type === "peer_summary") {
      return renderPeerSummary(segment, index);
    }
    if (segment?.type === "peer_incoming") {
      return renderPeerIncoming(segment, index);
    }
    const type = segment?.type === "thinking" ? "thinking" : "text";
    const content = repairTextForDisplay(segment?.content || "");
    const thinkingImages = type === "thinking" && Array.isArray(segment?.images) ? segment.images : [];
    if (!content.trim() && !thinkingImages.length && !(type === "thinking" && (segment?.activeThinking || segment?.showEmpty))) return "";
    const segmentElapsed = Number(segment?.elapsed_seconds ?? segment?.elapsedSeconds);
    const segmentOptions = {
      ...options,
      segmentIndex: index,
      activeThinking: Boolean(segment.activeThinking || (options.activeThinking && index === activeThinkingIndex)),
      images: thinkingImages,
    };
    if (Number.isFinite(segmentElapsed)) segmentOptions.elapsedSeconds = segmentElapsed;
    return type === "thinking"
      ? renderThinkingPanel(content, segmentOptions)
      : `<div class="msg-text-segment" data-segment-index="${index}">${renderAssistantContentHtml(content)}</div>`;
  }).join("");
  const liveTotalAttrs = liveTimeAttrs(true, totalElapsed).replace("data-live-time", "data-live-total");
  const activeTotalSummary = options.activeThinking && Number.isFinite(totalElapsed) && totalElapsed >= 0
    ? `<div class="thinking-complete-summary thinking-live-total" role="status" data-turn-duration="${Math.round(totalElapsed)}"${liveTotalAttrs}${tokenAttr}>${thinkingIconSvg()}<span data-live-time-label>本轮用时 ${escapeHtml(formatDuration(totalElapsed))}${escapeHtml(tokenLabel)}${tokenLabel ? " tokens" : ""}</span></div>`
    : "";
  const completedThinkingSummary = !options.activeThinking && options.hideThinking && Number.isFinite(totalElapsed) && totalElapsed > 0
    ? `<div class="thinking-complete-summary" role="status" data-turn-duration="${Math.round(totalElapsed)}">${thinkingIconSvg()}<span>本轮用时 ${escapeHtml(formatDuration(totalElapsed))}${escapeHtml(tokenLabel)}${tokenLabel ? " tokens" : ""}</span></div>`
    : "";
  return `${body}${activeTotalSummary || completedThinkingSummary}`;
}

function normalizeInteractionRequest(payload = {}) {
  if (!payload || typeof payload !== "object" || payload.type !== "interaction_request") return null;
  const requestId = String(payload.request_id || "").trim();
  if (!requestId) return null;
  const kind = payload.kind === "permission" ? "permission" : (payload.kind === "question" ? "question" : "");
  if (!kind) return null;
  const sessionId = String(payload.session_id || "").trim();
  const interactionState = String(payload.interaction_state || payload.state || "").trim();
  const base = {
    type: "interaction",
    kind,
    request_id: requestId,
    tool_use_id: String(payload.tool_use_id || requestId),
    session_id: sessionId,
    run_id: String(payload.run_id || ""),
    interaction_state: interactionState,
    terminal: Boolean(payload.terminal),
    failure_message: String(payload.failure_message || ""),
    failure_code: String(payload.failure_code || ""),
    response_action: String(payload.response_action || payload.action || ""),
    decision: String(payload.decision || ""),
    agent_id: payload.agent_id ?? null,
    response: payload.response ?? null,
  };
  if (kind === "permission") {
    const allowed = Array.isArray(payload.allowed_actions) ? payload.allowed_actions.map((item) => String(item)).filter((item) => ["deny", "allow_once", "allow_always"].includes(item)) : [];
    const display = payload.display && typeof payload.display === "object"
      ? Object.fromEntries(["command", "description", "file_path", "path", "url"].filter((key) => String(payload.display[key] || "").trim()).map((key) => [key, String(payload.display[key]).trim()]))
      : {};
    return {
      ...base,
      tool_name: String(payload.tool_name || "工具"),
      summary: String(payload.summary || "").trim(),
      workdir: String(payload.workdir || "").trim(),
      display,
      blocked_path: String(payload.blocked_path || ""),
      decision_reason: String(payload.decision_reason || ""),
      decision_reason_type: String(payload.decision_reason_type || ""),
      title: String(payload.title || ""),
      display_name: String(payload.display_name || ""),
      description: String(payload.description || ""),
      risk: String(payload.risk || ""),
      allowed_actions: Array.from(new Set(allowed))
    };
  }
  return {
    ...base,
    tool_name: String(payload.tool_name || "AskUserQuestion"),
    questions: Array.isArray(payload.questions) ? payload.questions.map((question) => ({
      ...(question && typeof question === "object" ? question : {}),
      question: String(question?.question || ""),
      header: String(question?.header || ""),
      multiSelect: Boolean(question?.multiSelect),
      options: Array.isArray(question?.options) ? question.options.map((option) => ({
        ...(option && typeof option === "object" ? option : {}),
        label: String(option?.label || ""),
        description: String(option?.description || "")
      })).filter((option) => option.label) : []
    })) : [],
    allowed_actions: Array.isArray(payload.allowed_actions)
      ? Array.from(new Set(payload.allowed_actions.map((item) => String(item)).filter((item) => ["answer", "skip"].includes(item))))
      : []
  };
}

function interactionPayloadAttr(card) {
  return ` data-interaction-payload="${escapeAttr(JSON.stringify(card || {}))}"`;
}

function interactionIsActionable(request = {}) {
  return ["", "created", "pending", "waiting_input"].includes(String(request.interaction_state || ""));
}

function interactionStatusText(request = {}) {
  const stateValue = String(request.interaction_state || "");
  if (stateValue === "answering" || stateValue === "response_committed") return "正在提交，等待 Claude 确认";
  if (stateValue === "awaiting_cli_ack") return "等待 Claude 确认";
  if (stateValue === "failed") return String(request.failure_message || "任务中断；请求未执行");
  if (stateValue === "cancelled") return "已取消";
  if (stateValue === "denied") return "已拒绝";
  return "";
}

function questionAnswerKey(question, index) {
  return String(question?.question || `第${index + 1}题`);
}

function questionAnswerValue(card, question, index) {
  const values = Array.from(card.querySelectorAll(`[data-question-index="${index}"][data-question-option]:checked`)).map((input) => input.value);
  const otherToggle = card.querySelector(`[data-question-index="${index}"][data-question-other-toggle]`);
  const other = card.querySelector(`[data-question-index="${index}"][data-question-other]`);
  const otherValue = String(other?.value || "").trim();
  if (otherToggle?.checked && otherValue) values.push(otherValue);
  return question?.multiSelect ? values : (values[0] || "");
}

function captureQuestionAnswer(card) {
  const request = card.__interactionRequest;
  const stateForCard = card.__interactionState;
  if (!request || !stateForCard) return;
  const index = stateForCard.index;
  const value = questionAnswerValue(card, request.questions[index], index);
  const key = questionAnswerKey(request.questions[index], index);
  if (Array.isArray(value) ? value.length : value) {
    stateForCard.answers[key] = value;
  } else {
    delete stateForCard.answers[key];
  }
}

function questionStepHtml(request, index, stateForCard) {
  const question = request.questions[index] || { question: "请回答", header: "", options: [], multiSelect: false };
  const saved = stateForCard.answers[questionAnswerKey(question, index)];
  const selected = new Set(Array.isArray(saved) ? saved : (saved ? [saved] : []));
  const disabledAttr = interactionIsActionable(request) ? "" : " disabled";
  const controls = question.options.map((option, optionIndex) => `
    <label class="inline-question-option" data-question-option-label>
      <input type="${question.multiSelect ? "checkbox" : "radio"}" name="interaction-${escapeAttr(request.request_id)}-${index}" value="${escapeAttr(option.label)}" data-question-index="${index}" data-question-option="${optionIndex}"${selected.has(option.label) ? " checked" : ""}${disabledAttr}>
      <span class="inline-question-option-copy"><strong>${escapeHtml(option.label)}</strong>${option.description ? `<small>${escapeHtml(option.description)}</small>` : ""}${typeof option.preview === "string" && option.preview.trim() ? `<small class="inline-question-preview">${escapeHtml(option.preview.trim())}</small>` : ""}</span>
      <kbd class="inline-question-number inline-question-key">${optionIndex + 1}</kbd>
    </label>
  `).join("");
  const knownLabels = new Set(question.options.map((option) => option.label));
  const otherValue = Array.from(selected).filter((value) => !knownLabels.has(value)).join(", ");
  const otherIndex = question.options.length + 1;
  const questionPreview = typeof question.preview === "string" && question.preview.trim()
    ? `<p class="inline-question-preview">${escapeHtml(question.preview.trim())}</p>`
    : "";
  return `${questionPreview}<div class="inline-question-options">${controls || ""}
      <label class="inline-question-option inline-question-other-option" data-question-option-label>
        <input type="${question.multiSelect ? "checkbox" : "radio"}" name="interaction-${escapeAttr(request.request_id)}-${index}" value="__other__" data-question-index="${index}" data-question-other-toggle${otherValue ? " checked" : ""}${disabledAttr}>
        <span class="inline-question-option-copy"><strong>其他</strong><small>输入自定义回答</small></span>
        <kbd class="inline-question-number inline-question-key">${otherIndex}</kbd>
      </label>
      <div class="inline-question-other-editor"${otherValue ? "" : " hidden"}>
        <input type="text" data-question-index="${index}" data-question-other value="${escapeAttr(otherValue)}" placeholder="输入其他回答" aria-label="其他回答"${disabledAttr}>
      </div>
    </div>`;
}

function questionHasAnswer(card, index) {
  const request = card.__interactionRequest;
  if (!request?.questions?.[index]) return false;
  const value = questionAnswerValue(card, request.questions[index], index);
  return Boolean(Array.isArray(value) ? value.length : value);
}

function updateQuestionControls(card) {
  const request = card.__interactionRequest;
  const stateForCard = card.__interactionState;
  if (!request || !stateForCard) return;
  const index = stateForCard.index;
  const pending = card.dataset.submitPending === "true";
  const answered = !interactionIsActionable(request);
  const hasCurrent = questionHasAnswer(card, index);
  const otherToggle = card.querySelector(`[data-question-index="${index}"][data-question-other-toggle]`);
  const otherEditor = card.querySelector(".inline-question-other-editor");
  if (otherEditor) otherEditor.hidden = !otherToggle?.checked;
  const previous = card.querySelector('[data-question-action="previous"]');
  const next = card.querySelector('[data-question-action="next"]');
  const submit = card.querySelector('[data-question-action="answer"]');
  const finalStep = index >= request.questions.length - 1;
  if (previous) {
    previous.hidden = index === 0;
    previous.disabled = pending || answered;
  }
  if (next) {
    next.hidden = finalStep;
    next.disabled = pending || answered || !hasCurrent;
  }
  if (submit) {
    submit.hidden = !finalStep;
    submit.disabled = pending || answered || !hasCurrent;
  }
}

function renderQuestionStep(card) {
  const request = card.__interactionRequest;
  const stateForCard = card.__interactionState;
  if (!request || !stateForCard) return;
  const index = Math.max(0, Math.min(stateForCard.index, Math.max(0, request.questions.length - 1)));
  stateForCard.index = index;
  const question = request.questions[index] || {};
  const body = card.querySelector("[data-question-body]");
  if (body) body.innerHTML = questionStepHtml(request, index, stateForCard);
  const progress = card.querySelector(".inline-question-progress");
  if (progress) progress.textContent = `${index + 1} / ${request.questions.length || 1}`;
  const header = card.querySelector(".inline-question-header");
  if (header) header.textContent = question.header || "Claude Code";
  const title = card.querySelector(".inline-question-title");
  if (title) title.textContent = question.question || "请回答";
  if (!interactionIsActionable(request)) {
    card.querySelectorAll("button,input,textarea").forEach((control) => { control.disabled = true; });
  }
  updateQuestionControls(card);
}

function renderInteractionCard(request = {}, index = 0) {
  const card = normalizeInteractionRequest({ ...request, type: "interaction_request" }) || request;
  const requestId = String(card.request_id || "");
  const idAttr = ` data-interaction-request-id="${escapeAttr(requestId)}"`;
  const sessionAttr = card.session_id ? ` data-interaction-session-id="${escapeAttr(card.session_id)}"` : "";
  if (card.kind === "permission") {
    const tool = card.tool_name || "工具";
    const detail = card.title || card.summary || card.description || "";
    const displayLabels = { command: "命令", description: "说明", file_path: "路径", path: "路径", url: "地址", blocked_path: "受阻路径", decision_reason: "原因", risk: "风险" };
    const publicDetails = {
      ...(card.display || {}),
      ...(card.blocked_path ? { blocked_path: card.blocked_path } : {}),
      ...(card.decision_reason ? { decision_reason: card.decision_reason } : {}),
      ...(card.risk ? { risk: card.risk } : {}),
    };
    const displayHtml = Object.entries(publicDetails).map(([key, value]) => `<p class="inline-interaction-detail inline-interaction-display" data-display-field="${escapeAttr(key)}"><span>${escapeHtml(displayLabels[key] || "详情")}：</span>${escapeHtml(value)}</p>`).join("");
    const workdir = card.workdir ? `<p class="inline-interaction-workdir">工作目录：${escapeHtml(card.workdir)}</p>` : "";
    const stateAttr = card.interaction_state ? ` data-interaction-state="${escapeAttr(card.interaction_state)}"` : "";
    const actionable = interactionIsActionable(card);
    const actionHtml = actionable ? `<div class="inline-interaction-actions">
        <button type="button" class="ghost-button" data-interaction-action="deny">拒绝</button>
        <button type="button" class="primary-button" data-interaction-action="allow_once">允许一次</button>
        ${card.allowed_actions?.includes("allow_always") ? `<button type="button" class="ghost-button" data-interaction-action="allow_always">始终允许</button>` : ""}
      </div>` : "";
    return `<section class="inline-interaction-card inline-permission-card" data-interaction-kind="permission" data-segment-index="${index}"${idAttr}${sessionAttr}${stateAttr}${interactionPayloadAttr(card)} aria-label="权限确认" tabindex="0">
      <div class="inline-interaction-head"><span class="inline-interaction-kicker">Claude 需要你的输入才能继续</span><strong>允许 Claude 使用 ${escapeHtml(tool)}？</strong></div>
      ${detail ? `<p class="inline-interaction-detail">${escapeHtml(detail)}</p>` : ""}
      ${displayHtml}
      ${workdir}
      ${actionHtml}
      <p class="inline-interaction-status" aria-live="polite">${escapeHtml(interactionStatusText(card))}</p>
    </section>`;
  }
  const questions = Array.isArray(card.questions) && card.questions.length ? card.questions : [{ question: "请回答", options: [] }];
  const questionCard = { ...card, questions };
  const questionActionable = interactionIsActionable(questionCard);
  const questionStateAttr = questionCard.interaction_state ? ` data-interaction-state="${escapeAttr(questionCard.interaction_state)}"` : "";
  return `<section class="inline-interaction-card inline-question-card" data-interaction-kind="question" data-segment-index="${index}" data-question-index="0"${idAttr}${sessionAttr}${questionStateAttr}${interactionPayloadAttr(questionCard)} aria-label="问题确认" tabindex="0">
    <div class="inline-question-topline">
      <span class="inline-question-status-dot" aria-hidden="true"></span>
      <div class="inline-question-heading"><span class="inline-question-header">${escapeHtml(questions[0].header || "Claude Code")}</span><strong class="inline-question-title">${escapeHtml(questions[0].question || "请回答")}</strong></div>
      <span class="inline-question-progress" aria-live="polite">1 / ${questions.length}</span>
      ${questionActionable && questionCard.allowed_actions?.includes("skip") ? `<button type="button" class="inline-question-close" data-question-action="skip" aria-label="关闭并跳过" title="跳过">×</button>` : ""}
    </div>
    <div data-question-body>${questionStepHtml(questionCard, 0, { answers: {} })}</div>
    <div class="inline-question-footer">
      <p class="inline-interaction-status" aria-live="polite">${escapeHtml(interactionStatusText(questionCard))}</p>
      ${questionActionable ? `<div class="inline-interaction-actions">
        <button type="button" class="ghost-button" data-question-action="previous" hidden>上一步</button>
        ${questionCard.allowed_actions?.includes("skip") ? `<button type="button" class="ghost-button" data-question-action="skip">跳过</button>` : ""}
        <button type="button" class="primary-button" data-question-action="next">下一步</button>
        <button type="button" class="primary-button" data-question-action="answer" hidden>提交 Enter</button>
      </div>` : ""}
    </div>
  </section>`;
}

function queueDockNode() {
  return document.querySelector("#agent-queue-dock");
}

function queueStatusLabel(status) {
  if (status === "dispatching") return "正在接续";
  if (status === "paused") return "已暂停";
  return "待发送";
}

function renderAgentQueue(sessionId = state.sessionId) {
  const dock = queueDockNode();
  if (!dock) return;
  const id = String(sessionId || "");
  const visible = id === String(state.sessionId || "") && state.sessionMode === "agent";
  const items = visible ? SessionQueueRegistry.get(id) : [];
  dock.classList.toggle("hidden", !items.length);
  if (!items.length) {
    dock.innerHTML = "";
    return;
  }
  dock.innerHTML = `
    <div class="agent-queue-head"><strong>接下来</strong><span>当前任务完成后按顺序发送</span></div>
    <div class="agent-queue-list">
      ${items.map((item, index) => `
        <article class="agent-queue-item" data-queue-item-id="${escapeAttr(item.id)}" data-queue-status="${escapeAttr(item.status || "queued")}">
          <span class="agent-queue-order" aria-hidden="true">${index + 1}</span>
          <div class="agent-queue-copy">
            <p>${escapeHtml(item.text || "")}</p>
            <textarea class="agent-queue-editor hidden" rows="2" aria-label="编辑待发送内容">${escapeHtml(item.text || "")}</textarea>
            <small>${escapeHtml(queueStatusLabel(item.status))}${Array.isArray(item.attachments) && item.attachments.length ? ` · ${item.attachments.length} 个附件` : ""}</small>
          </div>
          <div class="agent-queue-actions">
            <button type="button" class="ghost-button agent-queue-edit">编辑</button>
            <button type="button" class="ghost-button agent-queue-save hidden">保存</button>
            <button type="button" class="ghost-button agent-queue-remove">移除</button>
          </div>
        </article>
      `).join("")}
    </div>`;

  dock.querySelectorAll(".agent-queue-edit").forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest(".agent-queue-item");
      card?.classList.add("is-editing");
      card?.querySelector("p")?.classList.add("hidden");
      const editor = card?.querySelector(".agent-queue-editor");
      editor?.classList.remove("hidden");
      card?.querySelector(".agent-queue-save")?.classList.remove("hidden");
      button.classList.add("hidden");
      editor?.focus();
      editor?.select();
    });
  });
  dock.querySelectorAll(".agent-queue-save").forEach((button) => {
    const save = async () => {
      const card = button.closest(".agent-queue-item");
      const itemId = card?.dataset.queueItemId || "";
      const message = card?.querySelector(".agent-queue-editor")?.value.trim() || "";
      if (!itemId || !message) return;
      const response = await fetch(`/api/chat/${encodeURIComponent(id)}/queue/${encodeURIComponent(itemId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        $("#status-line").textContent = `队列修改失败：${data.detail || response.status}`;
        return;
      }
      SessionQueueRegistry.upsert(id, data.item);
    };
    button.addEventListener("click", save);
    button.closest(".agent-queue-item")?.querySelector(".agent-queue-editor")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void save();
      } else if (event.key === "Escape") {
        event.preventDefault();
        renderAgentQueue(id);
      }
    });
  });
  dock.querySelectorAll(".agent-queue-remove").forEach((button) => {
    button.addEventListener("click", async () => {
      const itemId = button.closest(".agent-queue-item")?.dataset.queueItemId || "";
      if (!itemId) return;
      const response = await fetch(`/api/chat/${encodeURIComponent(id)}/queue/${encodeURIComponent(itemId)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        $("#status-line").textContent = `队列移除失败：${data.detail || response.status}`;
        return;
      }
      SessionQueueRegistry.remove(id, itemId);
    });
  });
}

async function refreshAgentQueue(sessionId = state.sessionId) {
  const id = String(sessionId || "");
  if (!id || (id === String(state.sessionId || "") && state.sessionMode !== "agent")) {
    SessionQueueRegistry.set(id, []);
    return [];
  }
  try {
    const response = await fetch(`/api/chat/${encodeURIComponent(id)}/queue`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return SessionQueueRegistry.get(id);
    return SessionQueueRegistry.set(id, data.items || []);
  } catch {
    return SessionQueueRegistry.get(id);
  }
}

function interactionDockNode() {
  return $("#interaction-dock");
}

function clearInteractionDock(requestId = "") {
  const dock = interactionDockNode();
  if (!dock) return;
  const card = dock.querySelector(".inline-interaction-card");
  if (requestId && card?.dataset.interactionRequestId !== String(requestId)) return;
  dock.replaceChildren();
  delete dock.dataset.requestId;
}

function mountInteractionCard(payload, renderer = null) {
  const normalized = normalizeInteractionRequest(payload?.type === "interaction_request" ? payload : { ...payload, type: "interaction_request" });
  const dock = interactionDockNode();
  if (!normalized || !dock) return null;
  const existing = dock.querySelector(".inline-interaction-card");
  if (
    existing?.dataset.interactionRequestId === normalized.request_id
    && String(existing?.dataset.interactionState || "") === normalized.interaction_state
  ) return existing;
  dock.innerHTML = renderInteractionCard(normalized, 0);
  dock.dataset.requestId = normalized.request_id;
  const card = dock.querySelector(".inline-interaction-card");
  bindInteractionCard(card, renderer);
  card?.focus({ preventScroll: true });
  return card;
}

function compactInteractionCard(card, action) {
  if (!card) return;
  const label = action === "deny" ? "已拒绝" : action === "skip" ? "已跳过" : "已回答";
  card.classList.add("resolved");
  card.innerHTML = `<div class="inline-interaction-resolved"><span aria-hidden="true">✓</span><strong>${label}</strong><span>Claude Code 正在继续</span></div>`;
}

function bindInteractionCard(card, renderer = null) {
  if (!card || card.dataset.interactionBound === "true") return;
  card.dataset.interactionBound = "true";
  try {
    card.__interactionRequest = JSON.parse(card.dataset.interactionPayload || "{}");
  } catch {
    card.__interactionRequest = null;
  }
  card.__interactionState = { index: Number(card.dataset.questionIndex || 0), answers: {} };
  if (card.dataset.interactionKind === "question") renderQuestionStep(card);
  card.addEventListener("change", (event) => {
    if (card.dataset.interactionKind !== "question" || !interactionIsActionable(card.__interactionRequest) || card.dataset.submitPending === "true") return;
    if (!event.target.matches("[data-question-option], [data-question-other-toggle], [data-question-other]")) return;
    captureQuestionAnswer(card);
    updateQuestionControls(card);
    const status = card.querySelector(".inline-interaction-status");
    if (status) status.textContent = "";
  });
  card.addEventListener("input", (event) => {
    if (!event.target.matches("[data-question-other]")) return;
    const index = card.__interactionState.index;
    const toggle = card.querySelector(`[data-question-index="${index}"][data-question-other-toggle]`);
    if (toggle && event.target.value.trim()) toggle.checked = true;
    captureQuestionAnswer(card);
    updateQuestionControls(card);
  });
  card.addEventListener("click", (event) => {
    if (!interactionIsActionable(card.__interactionRequest) || card.dataset.submitPending === "true") return;
    const button = event.target.closest("[data-interaction-action], [data-question-action]");
    if (!button) return;
    const requestId = card.dataset.interactionRequestId;
    if (card.dataset.interactionKind === "question") {
      const questionAction = button.dataset.questionAction;
      captureQuestionAnswer(card);
      if (questionAction === "previous" || questionAction === "next") {
        const nextIndex = card.__interactionState.index + (questionAction === "next" ? 1 : -1);
        if (questionAction === "next" && !questionAnswerValue(card, card.__interactionRequest.questions[card.__interactionState.index], card.__interactionState.index)?.length) {
          const status = card.querySelector(".inline-interaction-status");
          if (status) status.textContent = "请选择或填写当前题的回答";
          return;
        }
        card.__interactionState.index = Math.max(0, Math.min(nextIndex, card.__interactionRequest.questions.length - 1));
        renderQuestionStep(card);
        return;
      }
      if (questionAction === "skip" && !card.__interactionRequest.allowed_actions?.includes("skip")) return;
      if (questionAction === "answer") {
        const unanswered = card.__interactionRequest.questions.findIndex((question, questionIndex) => {
          const value = card.__interactionState.answers[questionAnswerKey(question, questionIndex)];
          return !(Array.isArray(value) ? value.length : value);
        });
        if (unanswered >= 0) {
          card.__interactionState.index = unanswered;
          renderQuestionStep(card);
          const status = card.querySelector(".inline-interaction-status");
          if (status) status.textContent = `请完成第 ${unanswered + 1} 题`;
          return;
        }
      }
      void respondToInteraction(requestId, "question", questionAction || "answer", card.__interactionState.answers, card, renderer);
      return;
    }
    void respondToInteraction(requestId, card.dataset.interactionKind, button.dataset.interactionAction, null, card, renderer);
  });
  card.addEventListener("keydown", (event) => {
    if (card.dataset.interactionKind !== "question" || !interactionIsActionable(card.__interactionRequest)) return;
    const options = Array.from(card.querySelectorAll("[data-question-option], [data-question-other-toggle]"));
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      const current = Math.max(0, options.indexOf(document.activeElement));
      const next = (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % Math.max(1, options.length);
      options[next]?.focus();
    } else if (/^[1-9]$/.test(event.key)) {
      const option = options[Number(event.key) - 1];
      if (option) { event.preventDefault(); option.checked = true; option.dispatchEvent(new Event("change", { bubbles: true })); }
    } else if (event.key === "Enter") {
      event.preventDefault();
      const action = card.querySelector('[data-question-action="next"]:not([hidden])') || card.querySelector('[data-question-action="answer"]');
      action?.click();
    } else if (event.key === "Escape") {
      event.preventDefault();
      const skip = card.querySelector('[data-question-action="skip"]:not([hidden])');
      if (skip) skip.click();
      else {
        const status = card.querySelector(".inline-interaction-status");
        if (status) status.textContent = "如需结束本次请求，请点击停止任务";
      }
    }
  });
}

function bindInteractionCards(container, renderer = null) {
  container?.querySelectorAll(".inline-interaction-card").forEach((card) => bindInteractionCard(card, renderer));
}

async function respondToInteraction(requestId, kind, action, answers, card, renderer = null) {
  const sessionId = String(card?.dataset.interactionSessionId || state.sessionId || "");
  if (!sessionId || !requestId || card?.dataset.submitPending === "true") return;
  const status = card?.querySelector(".inline-interaction-status");
  if (card) {
    card.dataset.submitPending = "true";
    card.querySelectorAll("button,input,textarea").forEach((control) => { control.disabled = true; });
    if (status) status.textContent = "正在提交…";
  }
  try {
    const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/interaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: requestId, kind, action, answers })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "交互请求已失效");
    const run = SessionRunRegistry.get(sessionId);
    if (run?.pendingInteraction?.request_id === requestId) {
      const awaitingInteractionAck = {
        ...run.pendingInteraction,
        interaction_state: String(data.status || "awaiting_cli_ack"),
        response_action: String(action || ""),
        response_answers: answers && typeof answers === "object" ? { ...answers } : null,
        allowed_actions: [],
      };
      SessionRunRegistry.update(sessionId, {
        pendingInteraction: null,
        awaitingInteractionAck,
        waitingInput: false,
        status: data.status === "awaiting_cli_ack" ? "awaiting_cli_ack" : "running",
      });
    }
    if (String(state.sessionId || "") === sessionId) clearInteractionDock(requestId);
    renderer?.markInteractionAnswered?.(requestId, action, answers, data.status);
  } catch (error) {
    if (card) {
      delete card.dataset.submitPending;
      card.querySelectorAll("button,input,textarea").forEach((control) => { control.disabled = false; });
      if (kind === "question") updateQuestionControls(card);
    }
    if (status) status.textContent = `交互失败：${error.message || error}`;
    if (renderer) renderer.markInteractionError(requestId);
  }
}

function renderAssistantContentHtml(text) {
  const value = repairTextForDisplay(text || "");
  return renderMarkdown(stripLegacyChangedFilesSummary(value));
}

function runElapsedSeconds(record) {
  const local = Math.max(0, Math.round((performance.now() - Number(record?.startedAt || performance.now())) / 1000));
  const observed = Number(record?.elapsedOverride);
  if (record?.completed && Number.isFinite(observed)) return Math.max(0, observed);
  return Number.isFinite(observed) ? Math.max(local, Math.max(0, observed)) : local;
}

function runArticleForSession(sessionId) {
  const exact = Array.from(document.querySelectorAll("[data-run-session-id]") || []).find((article) => (
    String(article?.dataset?.runSessionId || "") === String(sessionId)
    && article?.isConnected !== false
  ));
  if (exact) return exact;
  if (String(state.sessionId) !== String(sessionId) || !SessionRunRegistry.get(sessionId)?.active) return null;
  const assistants = Array.from(document.querySelectorAll("#messages .message.assistant") || []);
  const fallback = assistants[assistants.length - 1] || null;
  if (fallback?.dataset) fallback.dataset.runSessionId = String(sessionId);
  return fallback;
}

function syncRunMessageToState(sessionId) {
  const id = String(sessionId || "");
  if (!id || String(state.sessionId || "") !== id) return null;
  const record = SessionRunRegistry.get(id);
  if (!record) return null;
  const messages = Array.isArray(state.messages) ? state.messages : [];
  let message = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate?.role !== "assistant") continue;
    const candidateRunId = String(candidate.run_session_id || candidate.runSessionId || "");
    if (candidateRunId === id || (!candidateRunId && candidate.pending)) {
      message = candidate;
      break;
    }
  }
  if (!message) return null;
  message.run_session_id = id;
  message.segments = record.segments.map((segment) => ({ ...segment }));
  if (record.turnUsage) message.turn_usage = { ...record.turnUsage };
  else delete message.turn_usage;
  message.content = message.segments
    .filter((segment) => segment.type === "text")
    .map((segment) => String(segment.content || ""))
    .join("");
  if (record.active) message.pending = true;
  else message.pending = false;
  if (record.error) {
    message.error = true;
    message.retryable = true;
  }
  return message;
}

function renderSessionRun(sessionId) {
  const id = String(sessionId || "");
  const record = SessionRunRegistry.get(id);
  if (!record || String(state.sessionId) !== id) return false;
  const scrollProjectionToken = SessionScrollRegistry.beginProjection(id);
  try {
    syncRunMessageToState(id);
    const article = runArticleForSession(id);
    const container = article?.querySelector?.(".msg-content");
    if (!article || !container) return false;
    const segments = record.segments.map((segment) => {
      if (segment.type !== "thinking") return { ...segment };
      const elapsed = segment.activeThinking && Number.isFinite(segment.startedAt)
        ? Math.max(0, Math.round((performance.now() - segment.startedAt) / 1000))
        : Number(segment.elapsedSeconds ?? segment.elapsed_seconds);
      return {
        ...segment,
        elapsedSeconds: Number.isFinite(elapsed) ? Math.max(0, elapsed) : undefined,
        activeThinking: Boolean(segment.activeThinking && record.active && !record.completed),
      };
    });
    container.innerHTML = renderMessageSegments(segments, {
      activeThinking: Boolean(record.active && !record.completed),
      hideThinking: Boolean(!record.active || record.completed),
      totalElapsedSeconds: runElapsedSeconds(record),
      turnUsage: record.turnUsage,
    });
    if (record.active && !record.completed) article.dataset.pending = "true";
    else article.removeAttribute("data-pending");
    if (record.active && !record.completed) ensureStoredThinkingTimer();
    else updateStoredThinkingTimer();
    article.classList?.toggle?.("error", Boolean(record.error));
    if (record.pendingInteraction) {
      mountInteractionCard(record.pendingInteraction, createStreamRenderer(id));
    } else {
      const dock = interactionDockNode();
      const card = dock?.querySelector?.(".inline-interaction-card");
      if (card && String(card.dataset.interactionSessionId || id) === id && !card.dataset.interactionState) {
        clearInteractionDock();
      }
    }
    scrollBottom();
    updateMessageTraceRail();
    return true;
  } finally {
    SessionScrollRegistry.finishProjection(id, scrollProjectionToken);
  }
}

function markRunError(sessionId, value = true) {
  const record = SessionRunRegistry.get(sessionId);
  if (record) record.error = Boolean(value);
  renderSessionRun(sessionId);
}

function ensureRunTimer(sessionId) {
  const transport = SessionTransportRegistry.get(sessionId);
  if (!transport || transport.timer) return;
  transport.timer = window.setInterval(() => renderSessionRun(sessionId), 1000);
}

function createStreamRenderer(sessionId) {
  const id = String(sessionId || "");
  ensureRunTimer(id);
  const sync = () => renderSessionRun(id);
  const api = {
    append(type, content) {
      const value = repairTextForDisplay(content || "");
      if (!value) return;
      SessionRunRegistry.applyEvent(id, {
        type: type === "thinking" ? "thinking_delta" : "text",
        content: value,
      });
      sync();
    },
    setElapsed(seconds) {
      SessionRunRegistry.applyEvent(id, { type: "heartbeat", elapsed: seconds });
      sync();
    },
    setWorkingStatus(content, payload = {}) {
      SessionRunRegistry.applyEvent(id, { type: "working_status", content, ...payload });
      sync();
    },
    replaceWithText(content) {
      SessionRunRegistry.replaceText(id, content);
      sync();
    },
    appendActivity(payload) {
      SessionRunRegistry.applyEvent(id, payload);
      sync();
    },
    appendInteraction(payload) {
      SessionRunRegistry.applyEvent(id, payload);
      sync();
    },
    setUsage(usage) {
      SessionRunRegistry.applyEvent(id, { type: "usage", usage });
      sync();
    },
    setTurnUsage(turnUsage) {
      SessionRunRegistry.applyEvent(id, { type: "turn_usage", turn_usage: turnUsage });
      sync();
    },
    setPeerCapability(peer) {
      SessionRunRegistry.applyEvent(id, { type: "peer_capability", peer });
      sync();
    },
    markInteractionAnswered(requestId, action, _answers, status = "accepted") {
      const record = SessionRunRegistry.get(id);
      if (record?.pendingInteraction?.request_id === String(requestId || "")) {
        const awaitingInteractionAck = {
          ...record.pendingInteraction,
          interaction_state: String(status || "awaiting_cli_ack"),
          response_action: String(action || ""),
          allowed_actions: [],
        };
        SessionRunRegistry.update(id, {
          pendingInteraction: null,
          awaitingInteractionAck,
          waitingInput: false,
          status: status === "awaiting_cli_ack" ? "awaiting_cli_ack" : "running",
        });
      }
      if (String(state.sessionId || "") === id) clearInteractionDock(String(requestId || ""));
    },
    markInteractionError(requestId) {
      const card = Array.from(interactionDockNode()?.querySelectorAll("[data-interaction-request-id]") || [])
        .find((item) => item.dataset.interactionRequestId === String(requestId || ""));
      if (card) card.classList.add("error");
    },
    cancelInteractions() {
      SessionRunRegistry.update(id, { pendingInteraction: null, waitingInput: false });
      if (String(state.sessionId) !== id) return;
      interactionDockNode()?.querySelectorAll(".inline-interaction-card:not([data-interaction-state='answered'])").forEach((card) => {
        card.dataset.interactionState = "cancelled";
        card.querySelectorAll("button,input,textarea").forEach((control) => { control.disabled = true; });
        const status = card.querySelector(".inline-interaction-status");
        if (status) status.textContent = "已停止";
      });
    },
    startThinking() {
      SessionRunRegistry.applyEvent(id, { type: "thinking_start" });
      sync();
    },
    completeThinking() {
      SessionRunRegistry.applyEvent(id, { type: "thinking_complete" });
      sync();
    },
    finish() {
      SessionRunRegistry.applyEvent(id, { type: "done" });
      sync();
    }
  };
  return api;
}

function acceptCoordinatedRunEvent(sessionId, payload = {}) {
  const record = SessionRunRegistry.get(sessionId);
  if (!record || !payload || typeof payload !== "object") return false;
  const incomingSessionId = String(payload.session_id || "");
  if (incomingSessionId && incomingSessionId !== String(sessionId)) return false;
  const incomingRunId = String(payload.run_id || "");
  if (incomingRunId) {
    if (record.runId && record.runId !== incomingRunId) return false;
    record.runId = incomingRunId;
  }
  const sequence = Number(payload.sequence);
  if (Number.isFinite(sequence) && sequence > 0) {
    if (sequence <= Number(record.serverSequence || 0)) return false;
    record.serverSequence = sequence;
  }
  return true;
}

function projectCoordinatedRunEvent(sessionId, payload = {}, { accepted = false } = {}) {
  const id = String(sessionId || "");
  const record = SessionRunRegistry.get(id);
  if (!record || (!accepted && !acceptCoordinatedRunEvent(id, payload))) return false;
  const type = String(payload.type || "");
  if (type === "interaction_response_committed") {
    SessionRunRegistry.applyEvent(id, payload);
    if (String(state.sessionId) === id) clearInteractionDock(String(payload.request_id || ""));
  } else if (type === "interaction_ack") {
    SessionRunRegistry.applyEvent(id, payload);
    if (String(state.sessionId) === id) {
      const pending = SessionRunRegistry.get(id)?.pendingInteraction;
      clearInteractionDock(String(payload.request_id || ""));
      if (pending && !interactionIsActionable(pending)) mountInteractionCard(pending, createStreamRenderer(id));
    }
  } else if (type === "interaction_resolved") {
    SessionRunRegistry.applyEvent(id, {
      ...payload,
      type: "interaction_ack",
      status: payload.success === false ? "failed" : "accepted",
    });
    if (String(state.sessionId) === id) {
      clearInteractionDock(String(payload.request_id || ""));
      const failedInteraction = SessionRunRegistry.get(id)?.pendingInteraction;
      if (failedInteraction && !interactionIsActionable(failedInteraction)) {
        mountInteractionCard(failedInteraction, createStreamRenderer(id));
      }
    }
  } else if (type === "run_status" && payload.status === "cancelled") {
    SessionRunRegistry.update(id, { cancelRequested: true, waitingInput: false, pendingInteraction: null, status: "cancelled" });
  } else if (type === "run_status" && payload.status === "paused") {
    SessionRunRegistry.update(id, {
      active: false,
      waitingInput: false,
      pendingInteraction: null,
      status: "paused",
      workingLabel: String(payload.message || "已暂停 · 输入消息可继续"),
    });
  } else if (type === "run_status" && payload.status === "running") {
    SessionRunRegistry.update(id, {
      active: true,
      status: "running",
      cancelRequested: false,
    });
  } else if (type === "queue_dispatch") {
    const item = payload.item || {};
    SessionQueueRegistry.upsert(id, { ...item, status: "dispatching" });
    SessionRunRegistry.update(id, {
      active: true,
      status: "running",
      waitingInput: false,
      pendingInteraction: null,
      segments: [],
      cursor: 0,
      completed: false,
      error: false,
      thinkingVisible: true,
    });
    if (String(state.sessionId) === id) {
      addMessage("user", String(item.text || ""), { queued: true });
      addMessage("assistant", "", { runSessionId: id });
    }
  } else if (type === "queue_removed") {
    SessionQueueRegistry.remove(id, payload.item_id);
  } else if (type === "assistant_start" || type === "runtime_started") {
    SessionRunRegistry.update(id, { status: "running", thinkingVisible: true, workingLabel: "正在工作…" });
  } else {
    SessionRunRegistry.applyEvent(id, payload);
    if (type === "error") record.status = "failed";
    if (type === "done") record.status = record.cancelRequested ? "cancelled" : (record.error ? "failed" : "completed");
  }
  if (["tool_start", "tool_result", "artifact"].includes(type) && String(state.sessionId) === id) recordActivity(payload);
  if (String(state.sessionId) === id) {
    renderSessionRun(id);
    syncCurrentSessionRuntimeUi();
  }
  return true;
}

async function resumeAgentRun(sessionId, snapshot = {}) {
  const id = String(sessionId || "");
  const runId = String(snapshot.run_id || SessionRunRegistry.get(id)?.runId || "");
  const record = SessionRunRegistry.get(id);
  if (!id || !runId || !record?.active || SessionTransportRegistry.get(id)) return false;
  const abortController = new AbortController();
  const transport = SessionTransportRegistry.start(id, { abortController, runId });
  let terminal = false;
  try {
    const after = Math.max(0, Number(record.serverSequence) || 0);
    const response = await fetch(`/api/chat/${encodeURIComponent(id)}/events?run_id=${encodeURIComponent(runId)}&after_sequence=${after}`, {
      signal: abortController.signal,
    });
    if (!response.ok || !response.body) throw new Error(`恢复运行流失败: ${response.status}`);
    const reader = response.body.getReader();
    transport.reader = reader;
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    const consume = (final = false) => {
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      if (final && buffer.trim()) { parts.push(buffer); buffer = ""; }
      for (const part of parts) {
        const line = part.split("\n").find((item) => item.startsWith("data: "));
        if (!line) continue;
        try {
          const payload = JSON.parse(line.slice(6));
          projectCoordinatedRunEvent(id, payload);
        } catch {}
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        consume(true);
        terminal = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      consume();
    }
  } catch (error) {
    if (error.name !== "AbortError" && String(state.sessionId) === id) {
      $("#status-line").textContent = "运行仍在后台，正在恢复界面连接…";
    }
  } finally {
    if (SessionTransportRegistry.get(id) === transport) SessionTransportRegistry.finish(id);
    if (terminal && SessionRunRegistry.get(id) === record) {
      const status = record.cancelRequested ? "cancelled" : (record.error ? "failed" : "completed");
      SessionRunRegistry.finish(id, status);
      if (String(state.sessionId) === id) {
        clearInteractionDock();
        try { await switchSession(id, { quiet: true, history: false }); } catch {}
      } else {
        await loadSessionList();
      }
    } else if (!terminal && record.active && !record.cancelRequested) {
      window.setTimeout(() => {
        if (record.active && !SessionTransportRegistry.get(id)) void resumeAgentRun(id, {
          run_id: record.runId,
          sequence: record.serverSequence,
        });
      }, 1000);
    }
  }
  return terminal;
}

const ARTIFACT_EXTENSIONS = "pdf|docx|xlsx|pptx|txt|md|csv|tex|html|png|jpe?g|webp|zip|tar\\.gz|js|jsx|ts|tsx|py|css|json|ya?ml|toml|rs|go|java|c|cpp|h|hpp|sh|bat|ps1|xml|svg";
function stripLegacyChangedFilesSummary(text) {
  const lines = String(text || "").split(/\r?\n/);
  const kept = [];
  for (let index = 0; index < lines.length;) {
    if (/^\s*修改的文件[:：]\s*$/.test(lines[index])) {
      index += 1;
      while (index < lines.length && (!lines[index].trim() || /^\s*(?:[A-Za-z]:[\\/]|\/mnt\/[a-z]\/|~?\/)/i.test(lines[index]))) {
        index += 1;
      }
      continue;
    }
    kept.push(lines[index]);
    index += 1;
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

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

function recordActivity(payload) {
  if (!payload || !["tool_start", "tool_result", "artifact"].includes(payload.type)) return;
  state.activityEvents.push({ ...payload });
  updateContextRail();
}

function structuredActivities() {
  const persisted = state.messages.flatMap((message) => (
    Array.isArray(message?.segments)
      ? message.segments.filter((segment) => ["tool_start", "tool_result", "artifact"].includes(segment?.type))
      : []
  ));
  return [...persisted, ...state.activityEvents];
}

function updateContextRail() {
  const rail = $("#workspace-rail");
  const toolArea = $("#tool-area");
  const artifactArea = $("#artifact-area");
  if (!rail || !toolArea || !artifactArea) return;
  toolArea.classList.add("hidden");
  artifactArea.classList.add("hidden");
  rail.classList.add("hidden");
  rail.setAttribute("aria-hidden", "true");
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
  const lines = attachments.map((item) => `[Attachment: ${item.name} · ${formatBytes(item.size)} · ${item.type || "application/octet-stream"}]`);
  return `${text}\n\n${lines.join("\n")}`;
}

function buildChatRequestBody(mode, message, model, permissionMode = null, attachments = [], peerTarget = null) {
  if (mode !== "agent") return { message, model };
  const body = { message, model, permission_mode: permissionMode, attachments };
  if (peerTarget?.session_id) body.peer_target_session_id = String(peerTarget.session_id);
  return body;
}

function parallelWorkdirConflict(sessionId, workdir, sessions = state.sessionIndex) {
  const key = String(workdir || "").trim().replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
  if (!key) return null;
  return (Array.isArray(sessions) ? sessions : []).find((session) => {
    if (!session || String(session.id || "") === String(sessionId || "") || session.mode !== "agent") return false;
    if (!["running", "waiting_input", "awaiting_cli_ack"].includes(String(session.runtime_state || ""))) return false;
    const candidate = String(session.workdir || "").trim().replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
    return candidate === key;
  }) || null;
}

async function sendAgentGuidance(sessionId, input = $("#user-input")) {
  const runSessionId = String(sessionId || "");
  const run = SessionRunRegistry.get(runSessionId);
  if (!runSessionId || !run?.active || run.mode !== "agent" || !input) return false;
  const originalValue = input.value;
  const text = originalValue.trim();
  if (!text) return false;
  if (run.waitingInput || run.pendingInteraction) {
    if (String(state.sessionId) === runSessionId) {
      showInlineStatus("请先处理当前问题或权限请求", { kind: "error", timeout: 4200 });
      input.focus();
    }
    return false;
  }
  if (run.guidancePending) return false;
  run.guidancePending = true;
  if (String(state.sessionId) === runSessionId) syncCurrentSessionRuntimeUi();
  const initiatingRunIsCurrent = () => SessionRunRegistry.get(runSessionId) === run;
  try {
    const response = await fetch(`/api/chat/${encodeURIComponent(runSessionId)}/guidance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.accepted !== true) {
      throw new Error(data.detail || `HTTP ${response.status}`);
    }
    if (initiatingRunIsCurrent() && String(state.sessionId) === runSessionId) {
      if (input.value === originalValue) {
        input.value = "";
        autoResize(input);
      }
      addMessage("user", text, { guidance: true });
      showInlineStatus("已将修正发送到当前运行", { kind: "info", timeout: 3200 });
    }
    return true;
  } catch (error) {
    if (initiatingRunIsCurrent() && String(state.sessionId) === runSessionId) {
      showInlineStatus(`引导未发送：${error.message || error}`, { kind: "error", timeout: 5200 });
      input.focus();
    }
    return false;
  } finally {
    if (initiatingRunIsCurrent()) run.guidancePending = false;
    if (String(state.sessionId) === runSessionId) syncCurrentSessionRuntimeUi();
  }
}

async function enqueueAgentMessage(sessionId, input = $("#user-input")) {
  const runSessionId = String(sessionId || "");
  const run = SessionRunRegistry.get(runSessionId);
  if (!runSessionId || !run?.active || run.mode !== "agent" || !input) return false;
  const originalValue = input.value;
  const text = originalValue.trim();
  if (!text || run.queuePending) return false;
  const files = [...state.contextFiles];
  const tooLarge = files.find((file) => file.size > MAX_ATTACHMENT_BYTES);
  if (tooLarge) {
    showInlineStatus(`附件过大：${tooLarge.name} 超过 ${formatBytes(MAX_ATTACHMENT_BYTES)}`, { kind: "error", timeout: 6200 });
    return false;
  }
  let attachments = [];
  try {
    attachments = await Promise.all(files.map(fileToAttachment));
  } catch (error) {
    showInlineStatus(`附件读取失败：${error.message || error}`, { kind: "error", timeout: 5200 });
    return false;
  }
  run.queuePending = true;
  if (String(state.sessionId) === runSessionId) syncCurrentSessionRuntimeUi();
  const initiatingRunIsCurrent = () => SessionRunRegistry.get(runSessionId) === run;
  try {
    const response = await fetch(`/api/chat/${encodeURIComponent(runSessionId)}/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, attachments }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.queued !== true) {
      throw new Error(data.detail || `HTTP ${response.status}`);
    }
    if (data.item) SessionQueueRegistry.upsert(runSessionId, data.item);
    if (initiatingRunIsCurrent() && String(state.sessionId) === runSessionId) {
      if (input.value === originalValue) {
        input.value = "";
        autoResize(input);
      }
      if (files.length) {
        const queuedFiles = new Set(files);
        const remaining = state.contextFiles.filter((file) => !queuedFiles.has(file));
        state.contextFiles.splice(0, state.contextFiles.length, ...remaining);
        renderContextFiles();
      }
      showInlineStatus("已加入待发送队列", { kind: "info", timeout: 3200 });
    }
    return true;
  } catch (error) {
    if (initiatingRunIsCurrent() && String(state.sessionId) === runSessionId) {
      showInlineStatus(`加入队列失败：${error.message || error}`, { kind: "error", timeout: 5200 });
      input.focus();
    }
    return false;
  } finally {
    if (initiatingRunIsCurrent()) run.queuePending = false;
    if (String(state.sessionId) === runSessionId) syncCurrentSessionRuntimeUi();
  }
}

async function sendMessage() {
  if (!state.sessionId) return;
  const currentRun = SessionRunRegistry.get(state.sessionId);
  if (currentRun?.active) {
    if (state.sessionMode === "agent" && state.viewMode === "agent") {
      await enqueueAgentMessage(state.sessionId);
    }
    return;
  }
  const runSessionId = String(state.sessionId);
  const runMode = state.viewMode === "agent" ? "agent" : "chat";
  const runWorkdir = state.workdir;
  const runModel = state.selectedModel;

  const input = $("#user-input");
  const text = input.value.trim();
  if (!text) return;

  const agent = runMode === "agent";
  const peerTarget = agent && state.peerTarget ? { ...state.peerTarget } : null;
  const files = agent ? [...state.contextFiles] : [];
  let permissionMode = agent ? sanitizePermissionMode(state.permissionMode) : null;
  let attachments = [];
  if (agent) {
    if (peerTarget && files.length) {
      showInlineStatus("跨会话消息不支持附件；请先移除附件或取消会话目标", { kind: "error", timeout: 5200 });
      return;
    }
    const tooLarge = files.find((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (tooLarge) {
      showInlineStatus(`附件过大：${tooLarge.name} 超过 ${formatBytes(MAX_ATTACHMENT_BYTES)}。大文件请直接告诉 Claude Code 文件路径来读取。`, { kind: "error", timeout: 6200 });
      return;
    }
    try {
      attachments = await Promise.all(files.map(fileToAttachment));
    } catch (error) {
      showInlineStatus(`附件读取失败：${error.message || error}`, { kind: "error", timeout: 5200 });
      return;
    }
    if (files.length) clearContextFiles();
    const conflict = parallelWorkdirConflict(runSessionId, runWorkdir);
    if (conflict) {
      $("#status-line").textContent = `“${conflict.name || "另一个 Agent"}”正在使用同一工作目录；并行编辑可能互相影响。`;
    }
  }

  input.value = "";
  autoResize(input);
  SessionScrollRegistry.set(runSessionId, true);
  const abortController = new AbortController();
  const runRecord = SessionRunRegistry.start(runSessionId, {
    mode: runMode,
    workdir: runWorkdir,
  });
  const transportRecord = SessionTransportRegistry.start(runSessionId, { abortController });
  transportRecord.retry.count = 0;
  transportRecord.retry.max = peerTarget ? 0 : transportRecord.retry.max;
  transportRecord.retry.context = { text, permissionMode, attachments, mode: runMode, workdir: runWorkdir, model: runModel };
  SessionRunRegistry.mirror(runSessionId);

  addMessage("user", peerTarget ? `发送给 ${peerTarget.display_name}：${text}` : text, { attachments: agent ? attachments : [] });
  if (peerTarget) clearPeerTarget();
  addMessage("assistant", "", { runSessionId });
  let streamRenderer = createStreamRenderer(runSessionId);
  const runIsVisible = () => String(state.sessionId) === runSessionId;
  const renderRun = (method, ...args) => {
    if (typeof streamRenderer[method] === "function") streamRenderer[method](...args);
  };
  let fullText = "";
  let thinkingText = "";
  let receivedDone = false;  // track whether we got a "done" SSE event
  let hadError = false;
  let completedNormally = false;

  // Long-running notice: keep the input locked while the backend task is alive.
  const safetyTimer = setTimeout(() => {
    if (runRecord.active && runIsVisible()) {
      if (!fullText) {
        renderRun("setWorkingStatus", "任务仍在运行…");
      }
    }
  }, 120000);  // 2 minutes: show a notice, but do not allow duplicate sends

  try {
    const response = await fetch(`/api/chat/${encodeURIComponent(runSessionId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildChatRequestBody(runMode, text, runModel, permissionMode, attachments, peerTarget)),
      signal: transportRecord.abortController.signal
    });

    if (!response.ok || !response.body) {
      throw new Error(`请求失败: ${response.status}`);
    }

    const reader = response.body.getReader();
    transportRecord.reader = reader;
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
      if ((payload.run_id || payload.sequence) && !acceptCoordinatedRunEvent(runSessionId, payload)) return;

      if (["interaction_response_committed", "interaction_ack", "interaction_resolved", "compact_boundary"].includes(payload.type)) {
        projectCoordinatedRunEvent(runSessionId, payload, { accepted: true });
      } else if (payload.type === "interaction_request") {
        const interaction = normalizeInteractionRequest(payload);
        runRecord.pendingInteraction = interaction;
        runRecord.waitingInput = Boolean(interaction);
        SessionRunRegistry.update(runSessionId, { pendingInteraction: interaction, waitingInput: Boolean(interaction), status: interaction ? "waiting_input" : "running" });
        renderRun("appendInteraction", payload);
      } else if (payload.type === "queue_dispatch") {
        const item = payload.item || {};
        SessionQueueRegistry.upsert(runSessionId, { ...item, status: "dispatching" });
        fullText = "";
        thinkingText = "";
        receivedDone = false;
        hadError = false;
        completedNormally = false;
        SessionRunRegistry.update(runSessionId, {
          active: true,
          status: "running",
          waitingInput: false,
          pendingInteraction: null,
          segments: [],
          cursor: 0,
          completed: false,
          error: false,
          thinkingVisible: true,
        });
        if (runIsVisible()) {
          addMessage("user", String(item.text || ""), { queued: true });
          addMessage("assistant", "", { runSessionId });
        }
        streamRenderer = createStreamRenderer(runSessionId);
        if (runIsVisible()) syncCurrentSessionRuntimeUi();
      } else if (payload.type === "queue_removed") {
        SessionQueueRegistry.remove(runSessionId, payload.item_id);
      } else if (["tool_start", "tool_result", "artifact", "peer_outgoing", "peer_delivery", "peer_incoming"].includes(payload.type)) {
        if (runIsVisible()) recordActivity(payload);
        renderRun("appendActivity", payload);
      } else if (payload.type === "peer_capability") {
        renderRun("setPeerCapability", payload.peer || {});
        if (runIsVisible()) {
          void refreshPeerStatus();
        }
      } else if (payload.type === "thinking_start") {
        if (runIsVisible()) showThinking(false);
        renderRun("startThinking");
      } else if (payload.type === "thinking_complete") {
        if (runIsVisible()) showThinking(false);
        renderRun("completeThinking");
      } else if (payload.type === "thinking_delta" || payload.type === "thinking") {
        if (runIsVisible()) showThinking(false);
        thinkingText += payload.content || "";
        renderRun("append", "thinking", payload.content || "");
      } else if (payload.type === "text") {
        if (runIsVisible()) showThinking(false);
        fullText += payload.content || "";
        renderRun("append", "text", payload.content || "");
      } else if (payload.type === "usage") {
        renderRun("setUsage", payload.usage);
        if (runIsVisible()) {
          updateContextMeter({ schedule: false });
        }
      } else if (payload.type === "turn_usage") {
        renderRun("setTurnUsage", payload.turn_usage || payload.turnUsage);
      } else if (payload.type === "working_status") {
        renderRun("setWorkingStatus", payload.content || "正在工作…", payload);
      } else if (payload.type === "error") {
        hadError = true;
        runRecord.status = "failed";
        SessionRunRegistry.applyEvent(runSessionId, payload);
        if (runIsVisible()) showThinking(false);
        if (runRecord.cancelRequested) {
          fullText = "已停止当前任务，输入已恢复。";
          renderRun("replaceWithText", fullText);
        } else if (
          transportRecord.retry.count < transportRecord.retry.max &&
          runMode === "agent" &&
          transportRecord.retry.context &&
          /上一个任务还在运行/.test(payload.content || "")
        ) {
          transportRecord.retry.count++;
          const ctx = transportRecord.retry.context;
          renderRun("replaceWithText", `(上个任务刚结束，${transportRecord.retry.delayMs / 1000} 秒后自动重试…)`);
          setTimeout(() => {
            if (!runRecord.active) return;
            SessionTransportRegistry.finish(runSessionId);
            SessionRunRegistry.finish(runSessionId, "retrying");
            doRetrySend(ctx.text, ctx.permissionMode, ctx.attachments, ctx.mode, runSessionId, ctx.workdir, ctx.model);
          }, transportRecord.retry.delayMs);
        } else {
          fullText = `错误：${payload.content || ""}`;
          renderRun("replaceWithText", fullText);
          markRunError(runSessionId);
        }
      } else if (payload.type === "heartbeat") {
        renderRun("setElapsed", payload.elapsed);
      } else if (payload.type === "done") {
        receivedDone = true;
        runRecord.status = hadError ? "failed" : "completed";
        runRecord.waitingInput = false;
        completedNormally = !hadError && !runRecord.cancelRequested;
        if (runIsVisible()) showThinking(false);
        renderRun("finish");
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
          if (runIsVisible()) showThinking(false);
        }
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      consumeSseBuffer();
    }
  } catch (error) {
    if (runIsVisible()) showThinking(false);
    hadError = true;
    runRecord.status = "failed";
    if (error.name === "AbortError" || runRecord.cancelRequested) {
      renderRun("cancelInteractions");
      fullText = fullText || "已停止当前任务，输入已恢复。";
      renderRun("replaceWithText", fullText);
    } else {
      fullText = `连接失败：${error.message}`;
      renderRun("replaceWithText", fullText);
      markRunError(runSessionId);
    }
  } finally {
    clearTimeout(safetyTimer);
    runRecord.active = false;
    runRecord.status = completedNormally ? "completed" : (runRecord.cancelRequested ? "cancelled" : (runRecord.status || "failed"));
    runRecord.waitingInput = false;
    renderRun("finish");
    SessionTransportRegistry.finish(runSessionId);
    SessionRunRegistry.finish(runSessionId, runRecord.status);
    if (runIsVisible()) {
      if (runRecord.cancelRequested) renderRun("cancelInteractions");
      if (runIsVisible()) showThinking(false);
      $("#user-input").focus();
      if (receivedDone) {
        try { await switchSession(runSessionId, { quiet: true, history: false }); } catch {}
      } else {
        renderAllMessages();
      }
      updateContextMeter({ announce: true });
    } else {
      await loadSessionList();
    }
    if (completedNormally) {
      notifyDesktopConversationCompleted();
      if (runMode === "agent") void refreshDailyUsage({ force: true, reason: "agent-run-completed" });
    }
  }
}

async function doRetrySend(
  text,
  permissionMode,
  attachments = [],
  mode = state.viewMode,
  sessionId = state.sessionId,
  workdir = "",
  model = state.selectedModel
) {
  if (!sessionId || SessionRunRegistry.get(sessionId)?.active) return;
  const runSessionId = String(sessionId);
  const runMode = mode === "agent" ? "agent" : "chat";
  const runWorkdir = String(workdir || (String(state.sessionId) === runSessionId ? state.workdir : ""));
  const runModel = String(model || state.selectedModel);

  const agent = runMode === "agent";
  if (!agent) {
    permissionMode = null;
    attachments = [];
  }

  SessionScrollRegistry.set(runSessionId, true);
  const abortController = new AbortController();
  const runRecord = SessionRunRegistry.start(runSessionId, {
    mode: runMode,
    workdir: runWorkdir,
  });
  const transportRecord = SessionTransportRegistry.start(runSessionId, { abortController });
  SessionRunRegistry.mirror(runSessionId);

  // Remove the retry-notice bubble
  const lastMsg = document.querySelector(".message:last-of-type");
  if (lastMsg && lastMsg.dataset.role === "assistant") {
    lastMsg.remove();
  }

  addMessage("assistant", "", { runSessionId });
  let streamRenderer = createStreamRenderer(runSessionId);
  const runIsVisible = () => String(state.sessionId) === runSessionId;
  const renderRun = (method, ...args) => {
    if (typeof streamRenderer[method] === "function") streamRenderer[method](...args);
  };
  let fullText = "";
  let receivedDone = false;
  let hadError = false;
  let completedNormally = false;

  const safetyTimer = setTimeout(() => {
    if (runRecord.active && runIsVisible() && !fullText) {
      renderRun("setWorkingStatus", "任务仍在运行…");
    }
  }, 120000);

  try {
    const response = await fetch(`/api/chat/${encodeURIComponent(runSessionId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildChatRequestBody(runMode, text, runModel, permissionMode, attachments)),
      signal: transportRecord.abortController.signal
    });

    if (!response.ok || !response.body) {
      throw new Error(`请求失败: ${response.status}`);
    }

    const reader = response.body.getReader();
    transportRecord.reader = reader;
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
      if ((payload.run_id || payload.sequence) && !acceptCoordinatedRunEvent(runSessionId, payload)) return;
      if (["interaction_response_committed", "interaction_ack", "interaction_resolved", "compact_boundary"].includes(payload.type)) {
        projectCoordinatedRunEvent(runSessionId, payload, { accepted: true });
      } else if (payload.type === "interaction_request") {
        const interaction = normalizeInteractionRequest(payload);
        runRecord.pendingInteraction = interaction;
        runRecord.waitingInput = Boolean(interaction);
        SessionRunRegistry.update(runSessionId, { pendingInteraction: interaction, waitingInput: Boolean(interaction), status: interaction ? "waiting_input" : "running" });
        renderRun("appendInteraction", payload);
      } else if (payload.type === "queue_dispatch") {
        const item = payload.item || {};
        SessionQueueRegistry.upsert(runSessionId, { ...item, status: "dispatching" });
        fullText = "";
        receivedDone = false;
        hadError = false;
        completedNormally = false;
        SessionRunRegistry.update(runSessionId, {
          active: true,
          status: "running",
          waitingInput: false,
          pendingInteraction: null,
          segments: [],
          cursor: 0,
          completed: false,
          error: false,
          thinkingVisible: true,
        });
        if (runIsVisible()) {
          addMessage("user", String(item.text || ""), { queued: true });
          addMessage("assistant", "", { runSessionId });
        }
        streamRenderer = createStreamRenderer(runSessionId);
        if (runIsVisible()) syncCurrentSessionRuntimeUi();
      } else if (payload.type === "queue_removed") {
        SessionQueueRegistry.remove(runSessionId, payload.item_id);
      } else if (["tool_start", "tool_result", "artifact", "peer_outgoing", "peer_delivery", "peer_incoming"].includes(payload.type)) {
        if (runIsVisible()) recordActivity(payload);
        renderRun("appendActivity", payload);
      } else if (payload.type === "peer_capability") {
        renderRun("setPeerCapability", payload.peer || {});
        if (runIsVisible()) void refreshPeerStatus();
      } else if (payload.type === "thinking_start") {
        renderRun("startThinking");
      } else if (payload.type === "thinking_complete") {
        renderRun("completeThinking");
      } else if (payload.type === "thinking_delta" || payload.type === "thinking") {
        renderRun("append", "thinking", payload.content || "");
      } else if (payload.type === "text") {
        fullText += payload.content || "";
        renderRun("append", "text", payload.content || "");
      } else if (payload.type === "usage") {
        renderRun("setUsage", payload.usage);
        if (runIsVisible()) {
          updateContextMeter({ schedule: false });
        }
      } else if (payload.type === "turn_usage") {
        renderRun("setTurnUsage", payload.turn_usage || payload.turnUsage);
      } else if (payload.type === "working_status") {
        renderRun("setWorkingStatus", payload.content || "正在工作…", payload);
      } else if (payload.type === "error") {
        hadError = true;
        runRecord.status = "failed";
        SessionRunRegistry.applyEvent(runSessionId, payload);
        if (runRecord.cancelRequested) {
          fullText = "已停止当前任务，输入已恢复。";
        } else {
          fullText = `错误：${payload.content || ""}`;
          markRunError(runSessionId);
        }
        renderRun("replaceWithText", fullText);
      } else if (payload.type === "done") {
        receivedDone = true;
        completedNormally = !hadError && !runRecord.cancelRequested;
        renderRun("finish");
      } else if (payload.type === "heartbeat") {
        renderRun("setElapsed", payload.elapsed);
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
    hadError = true;
    runRecord.status = "failed";
    if (error.name !== "AbortError" && !runRecord.cancelRequested) {
      fullText = `连接失败：${error.message}`;
      renderRun("replaceWithText", fullText);
      markRunError(runSessionId);
    } else {
      renderRun("cancelInteractions");
    }
  } finally {
    clearTimeout(safetyTimer);
    runRecord.active = false;
    runRecord.status = completedNormally ? "completed" : (runRecord.cancelRequested ? "cancelled" : (runRecord.status || "failed"));
    renderRun("finish");
    SessionTransportRegistry.finish(runSessionId);
    SessionRunRegistry.finish(runSessionId, runRecord.status);
    if (runIsVisible()) {
      showThinking(false);
      $("#user-input").focus();
      try { await switchSession(runSessionId, { quiet: true, history: false }); } catch {}
      updateContextMeter({ announce: true });
    } else {
      await loadSessionList();
    }
    if (completedNormally) {
      notifyDesktopConversationCompleted();
      if (runMode === "agent") void refreshDailyUsage({ force: true, reason: "agent-run-completed" });
    }
  }
}

function normalizeContextUsage(value) {
  const source = ["real", "unavailable"].includes(value?.source) ? value.source : "unavailable";
  const tokens = Math.max(0, Number(value?.used_tokens) || 0);
  const limit = Math.max(0, Number(value?.context_limit) || 0);
  const effectiveWindow = Math.max(0, Number(value?.effective_context_window) || limit);
  const rawRatio = Number(value?.ratio);
  const ratio = Number.isFinite(rawRatio) ? Math.min(Math.max(rawRatio, 0), 1) : (limit ? Math.min(tokens / limit, 1) : 0);
  return {
    used_tokens: tokens,
    context_limit: limit,
    effective_context_window: effectiveWindow,
    ratio,
    source,
    updated_at: Number(value?.updated_at) || 0,
    model: String(value?.model || ""),
    input_tokens: Math.max(0, Number(value?.input_tokens) || 0),
    cache_creation_input_tokens: Math.max(0, Number(value?.cache_creation_input_tokens) || 0),
    cache_read_input_tokens: Math.max(0, Number(value?.cache_read_input_tokens) || 0),
    output_tokens: Math.max(0, Number(value?.output_tokens) || 0),
    compacting: Boolean(value?.compacting),
    effective_auto_compact_threshold: Number(value?.effective_auto_compact_threshold) > 0
      ? Math.min(Math.max(Number(value.effective_auto_compact_threshold), 0.5), 0.99)
      : DEFAULT_AUTO_COMPACT_THRESHOLD,
  };
}

function contextStats() {
  const usage = normalizeContextUsage(state.contextUsage);
  const tokens = usage.used_tokens;
  const limit = usage.effective_context_window || usage.context_limit;
  const ratio = usage.ratio;
  const autoCompactThreshold = usage.effective_auto_compact_threshold || DEFAULT_AUTO_COMPACT_THRESHOLD;
  return {
    tokens,
    limit,
    effectiveContextWindow: limit,
    ratio,
    autoCompactThreshold,
    percent: Math.round(ratio * 100),
    source: usage.source,
    compacting: usage.compacting,
    available: usage.source !== "unavailable" && limit > 0,
    shouldCompress: usage.source !== "unavailable" && ratio >= autoCompactThreshold,
    critical: usage.source !== "unavailable" && ratio >= autoCompactThreshold
  };
}

function newContextCompressionState() {
  return { status: "idle", reason: "", lastAttemptKey: "", inFlight: false, timer: null };
}

function clearContextCompressionTimer(compressionState = state.contextCompression) {
  if (compressionState?.timer) {
    clearTimeout(compressionState.timer);
    compressionState.timer = null;
  }
}

function activateContextCompressionState(sessionId) {
  clearContextCompressionTimer();
  if (!sessionId) {
    state.contextCompression = newContextCompressionState();
    return;
  }
  const saved = state.contextCompressionBySession[sessionId]
    || (state.contextCompressionBySession[sessionId] = newContextCompressionState());
  state.contextCompression = saved;
}

function contextCompressionKey(stats = contextStats()) {
  const last = state.messages[state.messages.length - 1] || {};
  return [
    state.sessionId || "",
    state.contextRevision || "",
    state.messages.length,
    last.role || "",
    stats.tokens,
  ].join(":");
}

function scheduleContextCompression(stats) {
  // Native Claude Code owns automatic compaction and emits compact_boundary.
  // This compatibility function intentionally never POSTs /api/compress.
  return Boolean(stats?.compacting);
}

function updateContextMeter({ announce = false, schedule = true } = {}) {
  const meter = $("#context-meter");
  if (!meter) return;

  const stats = contextStats();
  const percentText = stats.available ? `${stats.percent}%` : "—";
  const number = new Intl.NumberFormat("zh-CN");
  const sourceLabels = { real: "Claude 实际用量", unavailable: "不可用" };
  const usageTooltip = stats.available
    ? `已用 ${number.format(stats.tokens)} / ${number.format(stats.limit)} 令牌 · ${stats.percent}% · 来源：${sourceLabels[stats.source] || "不可用"}`
    : "上下文用量暂不可用";
  $("#context-percent").textContent = percentText;
  const ring = meter.querySelector(".context-ring");
  if (ring) {
    const progress = ring.querySelector(".context-ring-progress-circle");
    const radius = Number(progress?.getAttribute("r")) || 9;
    const circumference = 2 * Math.PI * radius;
    const ratio = stats.available ? Math.max(0, Math.min(1, Number(stats.percent) / 100)) : 0;
    ring.style.setProperty("--context-percent", `${stats.percent}%`);
    if (progress) {
      progress.style.strokeDasharray = `${circumference}`;
      progress.style.strokeDashoffset = `${circumference * (1 - ratio)}`;
      progress.dataset.percent = String(stats.available ? stats.percent : 0);
    }
    ring.title = usageTooltip;
    ring.setAttribute("aria-label", usageTooltip);
    ring.setAttribute("aria-busy", stats.compacting ? "true" : "false");
  }
  $("#context-label").textContent = stats.available ? `上下文窗口已用 ${stats.percent}%` : "上下文用量暂不可用";
  meter.title = usageTooltip;
  meter.setAttribute("aria-label", meter.title);

  $("#context-usage-detail").textContent = stats.available
    ? `${number.format(stats.tokens)} / ${number.format(stats.limit)} 令牌（${stats.percent}%）`
    : "暂时没有真实用量";
  $("#context-usage-source").textContent = `来源：${sourceLabels[stats.source] || "不可用"}`;

  meter.classList.toggle("warn", stats.shouldCompress && !stats.critical);
  meter.classList.toggle("critical", stats.critical);
  meter.classList.toggle("compressable", stats.shouldCompress);
  meter.dataset.compressionState = stats.compacting ? "running" : "idle";

  if (stats.compacting) {
    showContextNotice(stats);
  } else if (announce && stats.shouldCompress) {
    showContextNotice(stats);
  } else if (!stats.shouldCompress) {
    hideContextNotice();
  }
  if (schedule) scheduleContextCompression(stats);
}

function setContextPopoverOpen(open) {
  const popover = $("#context-popover");
  const meter = $("#context-meter");
  if (!popover || !meter) return;
  popover.classList.toggle("hidden", !open);
  meter.setAttribute("aria-expanded", open ? "true" : "false");
}

function showContextNotice(stats = contextStats()) {
  const message = stats.compacting
    ? "正在压缩上下文…"
    : "上下文接近压缩线，Claude Code 将在处理新消息时判断。";
  showInlineStatus(message, { kind: "context" });
}

function hideContextNotice() {
  clearInlineStatus(state.sessionId, "context");
}

function shortContextReason(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 120);
}

async function requestContextCompression(sessionId = state.sessionId, compressionState = state.contextCompression) {
  if (!sessionId || state.isStreaming || compressionState.inFlight) return null;

  compressionState.inFlight = true;
  compressionState.status = "running";
  compressionState.reason = "";
  if (state.sessionId === sessionId) {
    showContextNotice(contextStats());
  }

  try {
    const response = await fetch(`/api/compress/${encodeURIComponent(sessionId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: state.selectedModel })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.reason || `压缩失败: ${response.status}`);
    }
    compressionState.status = data.status || (data.compressed ? "succeeded" : "idle");
    compressionState.reason = shortContextReason(data.reason);
    if (data.compressed) {
      if (state.sessionId === sessionId) {
        await switchSession(sessionId, { quiet: true });
        showCompressedBanner("上下文已整理，底层 Claude Code 会话也已重置并带入摘要。");
      }
    } else if (data.reason && !data.deduplicated) {
      if (state.sessionId === sessionId) showCompressedBanner(data.reason.includes("below threshold") ? "当前上下文还不需要整理。" : `上下文整理：${shortContextReason(data.reason)}`);
    }
    return data;
  } catch (error) {
    compressionState.status = "failed";
    compressionState.reason = shortContextReason(error.message || String(error));
    if (state.sessionId === sessionId) {
      showInlineStatus(`上下文整理失败：${compressionState.reason}`, { kind: "error", timeout: 5200 });
    }
    return null;
  } finally {
    compressionState.inFlight = false;
    if (state.sessionId === sessionId) updateContextMeter({ schedule: false });
  }
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}小时 ${String(minutes).padStart(2, "0")}分 ${String(secs).padStart(2, "0")}秒`;
  if (minutes > 0) return `${minutes}分 ${String(secs).padStart(2, "0")}秒`;
  return `${secs}秒`;
}

function normalizeTurnUsage(value) {
  if (!value || typeof value !== "object") return null;
  const fields = ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"];
  const usage = {};
  let observed = false;
  for (const field of fields) {
    const amount = Math.max(0, Number(value[field]) || 0);
    usage[field] = amount;
    observed ||= Object.prototype.hasOwnProperty.call(value, field);
  }
  if (!observed && !Number.isFinite(Number(value.total_tokens))) return null;
  usage.total_tokens = Math.max(0, Number(value.total_tokens) || fields.reduce((sum, field) => sum + usage[field], 0));
  return usage;
}

function formatCompactTokenCount(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  if (total >= 1000000) return `${(total / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
  if (total >= 1000) return `${(total / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(total);
}

function renderThinkingPanel(thinking, options = {}) {
  const hasTime = Number.isFinite(Number(options.elapsedSeconds));
  const timeLabel = hasTime
    ? `${options.activeThinking ? "思考中" : "已思考"} ${formatDuration(options.elapsedSeconds)}`
    : "";
  const stateClass = options.activeThinking ? " streaming" : "";
  const indexAttr = Number.isInteger(options.segmentIndex) ? ` data-segment-index="${options.segmentIndex}"` : "";
  const timeAttrs = liveTimeAttrs(Boolean(options.activeThinking), options.elapsedSeconds).replace("data-live-time", "data-live-thinking");
  const openAttr = options.activeThinking ? " open" : "";
  const images = Array.isArray(options.images)
    ? options.images.map((image) => renderImageSegment(image, options.segmentIndex || 0, "thinking-image")).join("")
    : "";
  return `
    <details class="thinking-panel${stateClass}"${indexAttr}${openAttr}>
      <summary>
        ${thinkingIconSvg()}
        <span class="thinking-label">${options.activeThinking ? "正在思考…" : "思考过程"}</span>
        ${timeLabel ? `<span class="thinking-time" data-thinking-time${timeAttrs}>${escapeHtml(timeLabel)}</span>` : ""}
      </summary>
      <div class="thinking-body">${thinking ? renderMarkdown(thinking) : ""}${images ? `<div class="message-image-gallery thinking-image-gallery">${images}</div>` : ""}</div>
    </details>
  `;
}

function previewThinking(thinking) {
  const clean = repairTextForDisplay(thinking).replace(/\s+/g, " ").trim();
  if (!clean) return "正在处理…";
  return clean.length > 140 ? `${clean.slice(0, 140)}...` : clean;
}

function showThinking(show, sessionId = state.sessionId) {
  const id = String(sessionId || "");
  const record = SessionRunRegistry.get(id);
  if (record) record.thinkingVisible = Boolean(show);
  if (id === String(state.sessionId || "")) syncCurrentSessionRuntimeUi();
}

async function cancelCurrentTask() {
  if (!state.isStreaming || !state.sessionId) return;

  const runSessionId = String(state.sessionId);
  const runRecord = SessionRunRegistry.get(runSessionId);
  const transportRecord = SessionTransportRegistry.get(runSessionId);
  if (!runRecord?.active) return;
  runRecord.cancelRequested = true;
  runRecord.pendingInteraction = null;
  runRecord.waitingInput = false;
  SessionRunRegistry.update(runSessionId, { cancelRequested: true, pendingInteraction: null, waitingInput: false, status: "cancelled" });
  try {
    await fetch(`/api/chat/${encodeURIComponent(runSessionId)}/cancel`, { method: "POST" });
  } catch {}

  if (transportRecord?.abortController) {
    transportRecord.abortController.abort();
  }
}

function autoResize(element) {
  element.style.height = "auto";
  element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
}

function handleFileAttach() {
  if (state.viewMode !== "agent") {
    clearContextFiles();
    $("#file-input").value = "";
    return;
  }
  attachFiles($("#file-input").files || []);
  $("#file-input").value = "";
}

function normalizeAttachedFile(file, fallbackName = "clipboard-file") {
  if (!file || typeof file.name !== "string") return file;
  if (file.name) return file;
  const extension = file.type?.split("/")?.[1]?.replace(/[^a-z0-9.+-]/gi, "") || "bin";
  return new File([file], `${fallbackName}-${Date.now()}.${extension}`, {
    type: file.type || "application/octet-stream",
    lastModified: file.lastModified || Date.now()
  });
}

function revokeFilePreview(file) {
  const url = filePreviewUrls.get(file);
  if (url) {
    URL.revokeObjectURL(url);
    filePreviewUrls.delete(file);
  }
}

function clearContextFiles() {
  state.contextFiles.forEach(revokeFilePreview);
  state.contextFiles = [];
  renderContextFiles();
}

function attachFiles(fileList) {
  if (state.viewMode !== "agent") {
    clearContextFiles();
    return;
  }
  const files = Array.from(fileList || [])
    .map((file) => normalizeAttachedFile(file, "clipboard-image"))
    .filter((file) => file && typeof file.name === "string");
  if (!files.length) return;
  state.contextFiles.push(...files);
  renderContextFiles();
  $("#user-input").focus();
}

function bindFileDrop() {
  const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes("Files");
  let dragDepth = 0;

  window.addEventListener("dragenter", (event) => {
    if (!hasFiles(event)) return;
    if (state.viewMode !== "agent") {
      event.preventDefault();
      clearContextFiles();
      return;
    }
    event.preventDefault();
    dragDepth += 1;
    document.body.classList.add("drag-over");
  });

  window.addEventListener("dragover", (event) => {
    if (!hasFiles(event)) return;
    if (state.viewMode !== "agent") {
      event.preventDefault();
      clearContextFiles();
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });

  window.addEventListener("dragleave", (event) => {
    if (!hasFiles(event)) return;
    if (state.viewMode !== "agent") return;
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) document.body.classList.remove("drag-over");
  });

  window.addEventListener("drop", (event) => {
    if (!hasFiles(event)) return;
    if (state.viewMode !== "agent") {
      event.preventDefault();
      clearContextFiles();
      return;
    }
    event.preventDefault();
    dragDepth = 0;
    document.body.classList.remove("drag-over");
    attachFiles(event.dataTransfer?.files || []);
  });
}

function bindClipboardPaste() {
  window.addEventListener("paste", (event) => {
    if (state.viewMode !== "agent") {
      if (event.clipboardData?.files?.length || Array.from(event.clipboardData?.items || []).some((item) => item.kind === "file")) {
        event.preventDefault();
        clearContextFiles();
      }
      return;
    }
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const files = [];
    for (const file of Array.from(clipboard.files || [])) {
      files.push(normalizeAttachedFile(file, "clipboard-file"));
    }
    for (const item of Array.from(clipboard.items || [])) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file) {
        const normalized = normalizeAttachedFile(file, item.type?.startsWith("image/") ? "clipboard-image" : "clipboard-file");
        if (!files.some((candidate) => candidate.name === normalized.name && candidate.size === normalized.size && candidate.type === normalized.type)) {
          files.push(normalized);
        }
      }
    }
    if (!files.length) return;
    event.preventDefault();
    attachFiles(files);
  });
}

function filePreviewHtml(file) {
  if (!file?.type?.startsWith("image/")) return "";
  if (!filePreviewUrls.has(file)) {
    filePreviewUrls.set(file, URL.createObjectURL(file));
  }
  return `<img class="ctx-file-preview" src="${escapeAttr(filePreviewUrls.get(file))}" alt="">`;
}

function renderContextFiles() {
  const container = $("#context-files");
  if (!container) return;
  const hasFiles = state.contextFiles.length > 0;
  container.innerHTML = state.contextFiles.map((file, index) => `
    <span class="ctx-file">
      ${filePreviewHtml(file)}
      <span class="ctx-file-info">
        <span class="ctx-file-name">${escapeHtml(file.name)}</span>
        <span class="ctx-file-size">${escapeHtml(formatBytes(file.size))}</span>
      </span>
      <button type="button" data-remove-file="${index}" aria-label="移除">×</button>
    </span>
  `).join("");
  container.classList.toggle("hidden", !hasFiles);
  container.setAttribute("aria-hidden", hasFiles ? "false" : "true");

  $$("[data-remove-file]").forEach((button) => {
    button.addEventListener("click", () => {
      const [removed] = state.contextFiles.splice(Number(button.dataset.removeFile), 1);
      if (removed) revokeFilePreview(removed);
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

function setSkillsSurfaceActive(active) {
  const main = $("#main");
  const chat = $("#chat-container");
  const messages = $("#messages");
  const input = $("#input-area");
  const dock = $("#interaction-dock");
  if (active && !main?.classList.contains("skills-view-active")) {
    state.skillsViewRestore = {
      sessionId: state.sessionId,
      scrollTop: chat?.scrollTop || 0,
    };
  }
  main?.classList.toggle("skills-view-active", Boolean(active));
  for (const node of [chat, messages, input, dock]) {
    if (!node) continue;
    node.inert = Boolean(active);
    if (active) node.setAttribute("aria-hidden", "true");
    else node.removeAttribute("aria-hidden");
  }
  if (!active) {
    const restore = state.skillsViewRestore;
    if (restore && String(restore.sessionId || "") === String(state.sessionId || "") && chat) {
      chat.scrollTop = Number(restore.scrollTop) || 0;
    }
    state.skillsViewRestore = null;
  }
}

function openSkillsView({ history = true, recordLocation = true } = {}) {
  const view = $("#skills-view");
  if (!view || state.viewMode !== "agent") return;
  closeSettingsModal({ restoreNavigation: false });
  setSkillsSurfaceActive(true);
  view.classList.remove("hidden");
  view.dataset.page = "list";
  if (recordLocation) setNavigationLocation({ kind: "skills" }, { push: history });
  showSkillList();
  loadSkills();
  $("#skill-search")?.focus();
}

function closeSkillsView({ restoreNavigation = true } = {}) {
  const view = $("#skills-view");
  if (!view) return;
  view.classList.add("hidden");
  setSkillsSurfaceActive(false);
  showSkillList();
  if (restoreNavigation && state.navigation.current?.kind === "skills") {
    void restorePreviousDurableLocation();
  }
}

function renderSkillCategories() {
  const labels = new Map(state.skills.map((skill) => [skill.category, skill.display_category || skill.category]));
  const categories = ["all", ...new Set(state.skills.map((skill) => skill.category))];
  $("#skills-categories").innerHTML = categories.map((category) => `
    <button class="cat-chip${category === state.activeSkillCategory ? " active" : ""}" data-category="${escapeAttr(category)}">
      ${category === "all" ? "全部" : escapeHtml(labels.get(category) || "本地技能")}
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
      `${skill.display_name || skill.name} ${skill.display_description || skill.description} ${skill.display_category || skill.category} ${skill.name} ${skill.command}`.toLowerCase().includes(query)
    );
  }

  $("#skills-list").innerHTML = skills.length
    ? skills.map((skill) => `
      <button class="skill-card" data-skill="${escapeAttr(skill.id || skill.filename)}">
        <span class="skill-name">${escapeHtml(skill.display_name || skill.name)}</span>
        <span class="skill-raw-name">原始名称：${escapeHtml(skill.name || skill.command)} · /${escapeHtml(skill.command || "skill")}</span>
        <span class="skill-desc">${escapeHtml(skill.display_description || "暂无中文说明")}</span>
        <span class="skill-card-meta"><span class="skill-cat">${escapeHtml(skill.display_category || "本地技能")}</span><span class="skill-claude-status" data-state="${escapeAttr(skill.claude?.state || "viniper_only")}">${escapeHtml(skill.claude?.label || "仅 Viniper 可用")}</span></span>
      </button>
    `).join("")
    : `<div class="empty-list">没有匹配结果</div>`;

  $$(".skill-card").forEach((card) => {
    card.addEventListener("click", () => showSkillDetail(card.dataset.skill));
  });
}

async function showSkillDetail(filename, { history = true } = {}) {
  state.currentSkill = filename;
  setNavigationLocation({ kind: "skills", skillId: filename }, { push: history });
  const response = await fetch(`/api/skills/${encodeURIComponent(filename)}`);
  if (!response.ok) {
    showSkillList();
    setNavigationLocation({ kind: "skills" }, { push: false });
    return false;
  }
  const data = await response.json();
  const status = data.claude || {state: "viniper_only", label: "仅 Viniper 可用", detail: ""};
  $("#skill-detail-content").innerHTML = `
    <section class="skill-detail-summary">
      <div><h2>${escapeHtml(data.display_name || "本地技能")}</h2><p>${escapeHtml(data.display_description || "暂无中文说明")}</p></div>
      <span class="skill-claude-status" data-state="${escapeAttr(status.state)}" title="${escapeAttr(status.detail || "")}">${escapeHtml(status.label)}</span>
    </section>
    <section class="skill-original-content" aria-label="原始技能说明">${data.content ? renderMarkdown(data.content) : escapeHtml(data.detail || "加载失败")}</section>
  `;
  $("#skills-view").dataset.page = "detail";
  $("#skill-detail").classList.remove("hidden");
  const useButton = $("#use-skill-btn");
  if (useButton) {
    useButton.disabled = status.state !== "available";
    useButton.title = status.state === "available" ? "在 Agent 中使用此技能" : (status.detail || "该技能当前不可由 Claude Code 调用");
  }
}

function showSkillList() {
  state.currentSkill = null;
  $("#skills-view")?.setAttribute("data-page", "list");
  $("#skill-detail").classList.add("hidden");
  $("#skills-list").classList.remove("hidden");
  $("#skills-categories").classList.remove("hidden");
  $(".skills-search").classList.remove("hidden");
  const useButton = $("#use-skill-btn");
  if (useButton) {
    useButton.disabled = false;
    useButton.removeAttribute("title");
  }
}

async function returnToSkillList() {
  const current = state.navigation.current;
  const previous = state.navigation.back?.[state.navigation.back.length - 1];
  if (current?.kind === "skills" && current.skillId && previous?.kind === "skills" && !previous.skillId) {
    await navigateHistory("back");
    return;
  }
  showSkillList();
  if (current?.kind === "skills" && current.skillId) {
    setNavigationLocation({ kind: "skills" }, { push: false });
  }
}

async function useSkill() {
  const skillId = state.currentSkill;
  if (!skillId) return;
  const skill = state.skills.find((item) => item.id === skillId);
  if (state.viewMode !== "agent") await switchMode("agent");
  const fallback = skill?.slug || skill?.filename?.replace(/\.md$/i, "") || skillId.split("/").pop().replace(/\.md$/i, "");
  const skillName = (skill?.command || fallback).trim();
  closeSkillsView();
  $("#user-input").value = `/${skillName} `;
  autoResize($("#user-input"));
  $("#user-input").focus();
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
  const homeMatch = normalized.match(/^(?:[a-z]:\/Users\/[^/]+|\/home\/[^/]+)(?=\/|$)/i);
  const display = homeMatch ? `~${normalized.slice(homeMatch[0].length)}` : normalized;
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
    if (!force && !SessionScrollRegistry.get(state.sessionId)) return;
    container.scrollTop = container.scrollHeight;
  });
}

function showCompressedBanner(message = "已压缩上下文") {
  showInlineStatus(message, { kind: "context", timeout: 4000 });
}

if (typeof globalThis !== "undefined") {
  globalThis.__VINIPER_TEST_API__ = {
    state,
    SessionRunRegistry,
    SessionQueueRegistry,
    SessionTransportRegistry,
    syncCurrentSessionRuntimeUi,
    resetCurrentSessionRuntimeUi,
    createStreamRenderer,
    renderSessionRun,
    renderAllMessages,
    renderCurrentSession,
    updateMessageTraceRail,
    respondToInteraction,
    projectCoordinatedRunEvent,
    setViewMode,
    updateSlashSuggestions,
    hideSlashSuggestions,
    normalizeNavigationLocation,
    navigationLocationKey,
    sameNavigationLocation,
    pushNavigationLocation,
    stepNavigationHistory,
    closeOverlayNavigation,
    globalMenuFocusIndex,
    accountMenuTransition,
    renderSessionHeader,
    startInlineSessionRename,
    persistSessionName,
    renderSessionInlineStatus,
    showInlineStatus,
    clearInlineStatus,
    showTextInputModal,
    closeTextInputModal,
    openSessionMenu,
    closeSessionMenu,
    executeSessionMenuAction,
    openSessionProjectMapping,
    handleSessionMenuKeydown,
    handleGlobalMenuKeydown,
    sidebarGestureDecision,
    sidebarPointerStartAction,
    navigationOverlayState,
    activateSearchResult,
    returnToSkillList,
    buildSearchEntries,
    searchEntries,
    mergeActivitySegments,
    renderMessageSegments,
    normalizeInteractionRequest,
    parallelWorkdirConflict,
    renderInteractionCard,
    bindInteractionCard,
    bindInteractionCards,
    renderQuestionStep,
    mountInteractionCard,
    clearInteractionDock,
    questionAnswerValue,
    captureQuestionAnswer,
    buildChatRequestBody,
    permissionModeOptions,
    renderPermissionSelect,
    selectPermissionMode,
    normalizeDailyUsage,
    usageIntensity,
    dailyUsagePanelContent,
    renderDailyUsageHeatmap,
    renderDailyUsagePanel,
    refreshDailyUsage,
    selectDailyUsageRange,
    sendAgentGuidance,
    enqueueAgentMessage,
    renderAgentQueue,
    refreshAgentQueue,
    sendMessage,
    normalizePeerStatus,
    selectPeerTarget,
    clearPeerTarget,
    renderPeerMenu,
    handlePeerMenuKeydown,
    renderAssistantContentHtml,
    renderContextFiles,
    shortenPath,
    runtimeSetupViewModel,
    runtimeProfileChromeCopy,
    updateRuntimeProfileChrome
  };
}
