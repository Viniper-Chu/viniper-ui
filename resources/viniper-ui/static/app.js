const state = {
  sessionId: null,
  sessionName: "",
  workdir: "",
  contextRevision: "",
  contextUsage: { used_tokens: 0, context_limit: 0, effective_context_window: 0, ratio: 0, source: "unavailable", updated_at: 0, model: "" },
  contextUsageBySession: {},
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
  dailyUsageByMode: null,
  dailyUsageRequestByMode: { viniper: null, claude: null },
  messages: [],
  activityEvents: [],
  isStreaming: false,
  contextFiles: [],
  contextFilesByMode: { viniper: [], claude: [] },
  skills: [],
  plugins: [],
  projectIndexEntries: [],
  projectIndexQuery: "",
  activeSkillCategory: "all",
  currentSkill: null,
  skillsViewRestore: null,
  status: null,
  selectedModel: "deepseek-flash",
  permissionMode: "ask",
  modelMenuOpen: false,
  modelMenuIndex: 0,
  permissionMenuOpen: false,
  permissionMenuIndex: 0,
  peerMenuOpen: false,
  peerCapability: { available: false, verified: false, reason: "", discovery: "unavailable", targets: [] },
  peerTarget: null,
  capabilities: null,
  configurationMatrix: null,
  harnessSnapshot: null,
  harnessSettingsSection: "local-models",
  workspaceTab: "project",
  workspaceRequestGeneration: 0,
  plan: { sessionId: "", steps: [], current: 0, total: 0 },
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
  viewMode: "viniper",
  sessionMode: "viniper",
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
  settingsView: { mode: null, generation: 0 },
  runtimeBusy: false,
  agentInstructions: { content: "", exists: false, path: "", updated_at: null },
  previewMode: false,
  updateInfo: null,
  updateFlow: { checking: false, busy: "", snapshot: null, error: "", pollTimer: null, returnFocus: null },
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

const MODE_OWNED_STATE_KEYS = Object.freeze([
  "sessionId", "sessionName", "workdir", "contextRevision", "contextUsage",
  "contextUsageBySession", "messages", "activityEvents", "contextFiles", "status",
  "selectedModel", "permissionMode", "peerCapability", "peerTarget", "capabilities", "configurationMatrix",
  "harnessSnapshot", "harnessSettingsSection",
  "skills", "plugins", "projectIndexEntries", "projectIndexQuery", "activeSkillCategory", "currentSkill",
  "workspaceTab", "sessionIndex", "settings", "settingsDirty", "settingsActiveSection", "agentInstructions",
  "plan", "sessionPinned", "sessionUnread", "sessionRuntimeState", "inlineStatus",
  "abortController", "cancelRequested", "pendingInteraction", "retrySend",
  "contextCompression", "contextCompressionBySession"
]);

function createModeOwnedState(mode) {
  return {
    mode,
    sessionId: null,
    sessionName: "",
    workdir: "",
    contextRevision: "",
    contextUsage: { used_tokens: 0, context_limit: 0, effective_context_window: 0, ratio: 0, source: "unavailable", updated_at: 0, model: "" },
    contextUsageBySession: {},
    messages: [],
    activityEvents: [],
    contextFiles: [],
    skills: [],
    plugins: [],
    projectIndexEntries: [],
    projectIndexQuery: "",
    activeSkillCategory: "all",
    currentSkill: null,
    workspaceTab: "project",
    sessionIndex: [],
    settings: null,
    settingsDirty: false,
    settingsActiveSection: "account",
    agentInstructions: { content: "", exists: false, path: "", updated_at: null },
    status: null,
    selectedModel: mode === "claude" ? "" : "deepseek-flash",
    permissionMode: mode === "claude" ? "default" : "ask",
    peerCapability: { available: false, verified: false, reason: "", discovery: "unavailable", targets: [] },
    peerTarget: null,
    capabilities: null,
    configurationMatrix: null,
    harnessSnapshot: null,
    harnessSettingsSection: "local-models",
    plan: { sessionId: "", steps: [], current: 0, total: 0 },
    sessionPinned: false,
    sessionUnread: false,
    sessionRuntimeState: "idle",
    inlineStatus: { sessionId: "", kind: "", message: "", timer: null },
    abortController: null,
    cancelRequested: false,
    pendingInteraction: null,
    retrySend: { count: 0, max: 3, delayMs: 3000 },
    contextCompression: { status: "idle", reason: "", lastAttemptKey: "", inFlight: false, timer: null },
    contextCompressionBySession: {},
    draft: "",
    generation: 0,
    createPromise: null,
    firstSendPromise: null,
    commandManifest: [],
  };
}

const ModeStateRegistry = Object.seal({
  viniper: createModeOwnedState("viniper"),
  claude: createModeOwnedState("claude"),
});

function modeOwnedState(mode = state.viewMode) {
  return ModeStateRegistry[mode === "claude" ? "claude" : "viniper"];
}

function saveActiveModeState(mode = state.viewMode) {
  const owner = modeOwnedState(mode);
  MODE_OWNED_STATE_KEYS.forEach((key) => { owner[key] = state[key]; });
  const input = typeof document !== "undefined" ? document.querySelector("#user-input") : null;
  if (input) owner.draft = input.value;
  return owner;
}

function restoreModeOwnedState(mode) {
  const owner = modeOwnedState(mode);
  MODE_OWNED_STATE_KEYS.forEach((key) => { state[key] = owner[key]; });
  const input = typeof document !== "undefined" ? document.querySelector("#user-input") : null;
  if (input) {
    input.value = owner.draft;
    if (typeof autoResize === "function") autoResize(input);
  }
  return owner;
}

function bumpModeGeneration(mode = state.viewMode) {
  const owner = modeOwnedState(mode);
  owner.generation += 1;
  return owner.generation;
}

function modeProjectionToken(mode = state.viewMode, sessionId = state.sessionId) {
  const owner = modeOwnedState(mode);
  return { mode: owner.mode, sessionId: String(sessionId || ""), generation: owner.generation };
}

function modeProjectionIsCurrent(token) {
  const owner = modeOwnedState(token?.mode);
  return Boolean(token)
    && state.viewMode === token.mode
    && owner.generation === token.generation
    && String(state.sessionId || "") === String(token.sessionId || "");
}

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

// A cold Workstation start may render the first Claude status while the
// bounded CLI capability probe is still running.  Keep this refresh strictly
// mode-owned and bounded so a transient disabled descriptor is never treated
// as the final permission menu state.
const permissionStatusRefreshTimers = new Map();
const permissionStatusRefreshAttempts = new Map();
const MAX_PERMISSION_STATUS_REFRESH_ATTEMPTS = 6;

function schedulePermissionStatusRefresh(mode, token, status) {
  const requestedMode = mode === "claude" ? "claude" : "viniper";
  if (requestedMode !== "claude" || !status?.permission_modes_pending) {
    permissionStatusRefreshAttempts.delete(requestedMode);
    const timer = permissionStatusRefreshTimers.get(requestedMode);
    if (timer) {
      clearTimeout(timer);
      permissionStatusRefreshTimers.delete(requestedMode);
    }
    return;
  }
  const attempts = Number(permissionStatusRefreshAttempts.get(requestedMode) || 0);
  if (attempts >= MAX_PERMISSION_STATUS_REFRESH_ATTEMPTS || permissionStatusRefreshTimers.has(requestedMode)) return;
  permissionStatusRefreshAttempts.set(requestedMode, attempts + 1);
  const timer = setTimeout(() => {
    permissionStatusRefreshTimers.delete(requestedMode);
    if (modeProjectionIsCurrent(token)) void loadStatus(requestedMode, token);
  }, 300);
  permissionStatusRefreshTimers.set(requestedMode, timer);
}

// If the bounded cold-start refresh window expires while the CLI capability
// probe is still running, opening the permission menu is an explicit,
// mode-owned recovery action.  This keeps the automatic path finite while
// giving the user a deterministic way to observe the eventual capability
// result without changing permission semantics or crossing agent owners.
function requestPermissionStatusRefresh(mode = state.viewMode) {
  const requestedMode = mode === "claude" ? "claude" : "viniper";
  if (requestedMode !== "claude") return;
  const timer = permissionStatusRefreshTimers.get(requestedMode);
  if (timer) {
    clearTimeout(timer);
    permissionStatusRefreshTimers.delete(requestedMode);
  }
  permissionStatusRefreshAttempts.set(requestedMode, 0);
  const token = modeProjectionToken(requestedMode, state.sessionId);
  if (modeProjectionIsCurrent(token)) void loadStatus(requestedMode, token);
}

function emptyDailyUsageState() {
  return {
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
  };
}

function dailyUsageModeKey(mode = state.viewMode) {
  return mode === "claude" ? "claude" : "viniper";
}

function activateDailyUsageMode(mode = state.viewMode) {
  const key = dailyUsageModeKey(mode);
  if (!state.dailyUsageByMode) {
    state.dailyUsageByMode = { viniper: state.dailyUsage, claude: emptyDailyUsageState() };
  }
  if (!state.dailyUsageByMode[key]) state.dailyUsageByMode[key] = emptyDailyUsageState();
  state.dailyUsage = state.dailyUsageByMode[key];
  return state.dailyUsage;
}

function setDailyUsageForMode(mode, value) {
  const key = dailyUsageModeKey(mode);
  if (!state.dailyUsageByMode) state.dailyUsageByMode = { viniper: emptyDailyUsageState(), claude: emptyDailyUsageState() };
  const next = value && typeof value === "object" ? value : emptyDailyUsageState();
  state.dailyUsageByMode[key] = next;
  if (dailyUsageModeKey() === key) state.dailyUsage = next;
  return next;
}

function dailyUsageRequestForMode(mode = state.viewMode) {
  const key = dailyUsageModeKey(mode);
  if (!state.dailyUsageRequestByMode) state.dailyUsageRequestByMode = { viniper: null, claude: null };
  return state.dailyUsageRequestByMode[key] || null;
}

function setDailyUsageRequestForMode(mode, request) {
  const key = dailyUsageModeKey(mode);
  if (!state.dailyUsageRequestByMode) state.dailyUsageRequestByMode = { viniper: null, claude: null };
  state.dailyUsageRequestByMode[key] = request || null;
  state.dailyUsageRequest = dailyUsageRequestForMode();
}

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
    const container = $("#conversation-container");
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
      mode: meta.mode || "claude",
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
      // Keep completed thinking segments in the live trace so the native
      // Viniper shell can show the reasoning timeline alongside tool
      // summaries and streamed output.  The terminal `done` event still
      // removes transient thinking before the persisted transcript is
      // finalized.
      closeThinking();
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
    } else if (type === "plan_timeline") {
      closeThinking();
      const runId = String(payload.run_id || "");
      const index = record.segments.findIndex((segment) => (
        segment.type === "plan_timeline" && String(segment.run_id || "") === runId
      ));
      const segment = { ...payload, type: "plan_timeline" };
      if (index >= 0) record.segments[index] = segment;
      else record.segments.push(segment);
    } else if (type === "turn_diff") {
      closeThinking();
      const runId = String(payload.run_id || "");
      const index = record.segments.findIndex((segment) => (
        segment.type === "turn_diff" && String(segment.run_id || "") === runId
      ));
      const segment = { ...payload, type: "turn_diff" };
      if (index >= 0) record.segments[index] = segment;
      else record.segments.push(segment);
    } else if (["tool_start", "tool_result", "artifact", "peer_outgoing", "peer_delivery", "peer_incoming", "image"].includes(type)) {
      closeThinking();
      const activity = { ...payload, type, content: payload.content == null ? "" : String(payload.content) };
      if (type === "tool_start" || type === "tool_result") {
        const name = String(payload.name || payload.tool_name || payload.toolName || "").trim();
        const toolId = String(payload.tool_id || payload.toolId || payload.call_id || payload.callId || "").trim();
        if (name) {
          activity.name = name;
          activity.tool_name = name;
        }
        if (toolId) activity.tool_id = toolId;
      }
      record.segments.push(activity);
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
  const agent = state.viewMode === "claude" && state.sessionMode === "claude";
  const interactionState = String(record?.pendingInteraction?.interaction_state || "");
  const interactionTerminal = ["accepted", "denied", "cancelled", "failed", "terminal"].includes(interactionState);
  const interactionLocked = Boolean(record?.waitingInput || (record?.pendingInteraction && !interactionTerminal)
    || ["waiting_input", "awaiting_cli_ack"].includes(String(record?.status || "")));
  const queueAvailable = Boolean(active && !interactionLocked);
  const guidance = Boolean(queueAvailable && agent);
  const runningHint = Boolean(active);
  const guidancePending = Boolean(guidance && record?.guidancePending);
  const queuePending = Boolean(queueAvailable && record?.queuePending);

  state.isStreaming = active;
  state.abortController = transport?.abortController || null;
  state.cancelRequested = Boolean(record?.cancelRequested);
  state.pendingInteraction = record?.pendingInteraction || null;
  if (transport?.retry) state.retrySend = transport.retry;
  if (record?.usage) {
    state.contextUsage = normalizeContextUsage({ ...record.usage, compacting: record.contextCompacting });
    if (state.sessionId) state.contextUsageBySession[state.sessionId] = state.contextUsage;
  }
  if (record?.peerCapability) state.peerCapability = normalizePeerStatus(record.peerCapability);
  if (record?.usage || record?.contextCompacting) updateContextMeter({ schedule: false });

  const statusText = $("#composer-status-text");
  const statusMark = $("#composer-status .run-state-mark");
  const elapsed = Number.isFinite(Number(record?.elapsedOverride))
    ? Math.max(0, Math.round(Number(record.elapsedOverride)))
    : (active && Number.isFinite(Number(record?.startedAt)) ? Math.max(0, Math.round((Date.now() - Number(record.startedAt)) / 1000)) : 0);
  if (statusText) statusText.textContent = active ? `运行中 · ${formatDuration(elapsed)}` : "空闲";
  if (statusMark) {
    statusMark.dataset.active = active ? "true" : "false";
    statusMark.setAttribute("aria-label", active ? "运行中" : "空闲");
  }

  const thinking = $("#thinking");
  const stop = $("#stop-btn");
  const send = $("#send-btn");
  const input = $("#user-input");
  const shortcut = $(".composer-shortcut");
  const composer = $("#composer");
  const locked = active && !queueAvailable;

  thinking?.classList.toggle("hidden", !(active && record?.thinkingVisible));
  const workingLabel = thinking?.querySelector(".working-label");
  if (workingLabel) workingLabel.textContent = record?.workingLabel || "正在工作…";
  stop?.classList.toggle("hidden", !active);
  if (input) {
    input.disabled = locked;
    input.placeholder = !sessionId
      ? "输入任务，发送时将新建当前 Agent 会话"
      : (runningHint
        ? (agent ? "输入后按 Enter 排队，Ctrl+Enter 引导当前任务" : "输入后按 Enter 排队")
        : "输入任务，或使用 / 命令");
  }
  if (send) {
    send.disabled = state.sessionSwitchPending || locked || guidancePending || queuePending || Boolean(modeOwnedState().firstSendPromise);
    const label = guidancePending
      ? "正在发送引导"
      : (queuePending ? "正在加入队列" : (guidance ? "加入待发送队列" : "发送"));
    send.title = label;
    send.setAttribute("aria-label", label);
  }
  if (shortcut) {
    shortcut.textContent = runningHint
      ? (agent ? "Enter 排队 · Ctrl+Enter 引导 · Shift+Enter 换行" : "Enter 排队 · Shift+Enter 换行")
      : "Enter 发送 · Shift+Enter 换行";
  }
  if (composer) composer.dataset.runtimeState = active ? (record?.status || "running") : "idle";

  ["#file-btn", "#model-picker-button", "#model-select",
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
const VIEW_MODE_KEY = `${STORAGE_PREFIX}view-mode`;
const LEGACY_MODEL_KEY = `${STORAGE_PREFIX}selected-model`;
const MODEL_KEYS = Object.freeze({
  viniper: `${STORAGE_PREFIX}selected-model:viniper`,
  claude: `${STORAGE_PREFIX}selected-model:claude`,
});
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

function modelStorageKey(mode = state.viewMode) {
  return MODEL_KEYS[mode === "claude" ? "claude" : "viniper"];
}

function readRememberedModel(mode = state.viewMode) {
  const scopedKey = modelStorageKey(mode);
  const scoped = storageGet(scopedKey);
  if (scoped) return scoped;
  const legacy = storageGet(LEGACY_MODEL_KEY);
  if (!legacy) return "";
  storageSet(scopedKey, legacy);
  storageRemove(LEGACY_MODEL_KEY);
  return legacy;
}

function rememberModel(model, mode = state.viewMode) {
  storageSet(modelStorageKey(mode), String(model || ""));
}

// Token estimation: ~3 chars per token for mixed Chinese/English text.
// Only the backend registry can attest to a deployment's context capacity.
const DEFAULT_CONTEXT_LIMIT = 0;
const DEFAULT_AUTO_COMPACT_THRESHOLD = 0.95;
const VINIPER_PERMISSION_MODES = [
  {
    id: "ask",
    label: "每次询问",
    description: "每个有副作用工具都人工批准"
  },
  {
    id: "review",
    label: "规划自动审核",
    description: "先生成结构化计划；项目内受控动作审核通过后自动执行，越界/高风险直接拒绝"
  },
  {
    id: "fullAccess",
    label: "完全访问",
    description: "已注册通用工具在产品边界内自动执行，不弹人工批准"
  }
];
const CLAUDE_PERMISSION_MODES = [
  {
    id: "default",
    label: "询问权限",
    description: "Claude Code CLI 在需要权限时暂停并询问"
  },
  {
    id: "acceptEdits",
    label: "自动接受编辑",
    description: "Claude Code CLI 自动允许文件编辑，其他高风险操作仍会询问"
  },
  {
    id: "plan",
    label: "计划模式",
    description: "Claude Code CLI 先规划，减少直接执行动作"
  },
  {
    id: "fullAccess",
    label: "完全访问",
    description: "Claude Code CLI 使用 bypassPermissions 自动执行工具；AskUserQuestion 仍需回答"
  }
];
const VINIPER_HARNESS_COMMANDS = Object.freeze([
  { command: "/mcp", title: "MCP", description: "查看当前 MCP 能力与可用状态" },
  { command: "/goal", title: "目标", description: "创建或恢复一个可追踪的目标任务" },
  { command: "/target", title: "目标", description: "打开目标任务入口" },
  { command: "/plan", title: "计划", description: "查看当前会话计划与步骤" }
]);
const CLAUDE_NATIVE_COMMANDS = Object.freeze([
  ["model", "模型", "选择当前会话的模型"],
  ["permissions", "权限", "选择工具执行权限"],
  ["context", "上下文", "查看当前上下文用量"],
  ["config", "设置", "打开 Claude code 独立设置"],
].map(([name, title, description]) => Object.freeze({
  command: `/${name}`, title, description, execution: "native-ui", ui_action: name, version: "",
})));

function slashCommandsForMode(mode = state.viewMode) {
  if (mode !== "claude") return VINIPER_HARNESS_COMMANDS;
  const manifest = modeOwnedState("claude").commandManifest;
  return manifest.length ? manifest : CLAUDE_NATIVE_COMMANDS;
}
const PERMISSION_MODE_COPY = {
  viniper: {
    ask: "Viniper Harness 对每个有副作用工具人工批准",
    review: "Viniper Harness 先做结构化计划与风险审核，越界动作直接拒绝",
    fullAccess: "Viniper Harness 在注册工具与产品边界内自动执行"
  },
  claude: {
    default: "Claude Code CLI 在需要权限时暂停并询问",
    acceptEdits: "Claude Code CLI 自动接受文件编辑，其他操作遵循 CLI 权限",
    plan: "Claude Code CLI 仅规划，不直接执行修改",
    fullAccess: "Claude Code CLI 使用 bypassPermissions 自动执行工具；AskUserQuestion 仍需回答"
  }
};
function permissionDescriptionForMode(id, mode = state.viewMode) {
  const owner = mode === "claude" ? "claude" : "viniper";
  return PERMISSION_MODE_COPY[owner]?.[id] || "";
}
function slashCommandOwner(mode = state.viewMode) {
  return mode === "claude" ? "Claude code" : "Viniper";
}
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
    windowPin: "置顶工作台窗口",
    windowUnpin: "取消置顶工作台窗口",
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
    newSession: "New session",
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
    windowPin: "Keep Viniper window on top",
    windowUnpin: "Stop keeping Viniper window on top",
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

function modelCapacityMetadata(modelId = state.selectedModel) {
  const id = String(modelId || "");
  const model = (state.status?.models || []).find((item) => String(item?.id || "") === id);
  const rawLimit = Number(model?.context_window ?? model?.context ?? 0);
  const status = String(model?.context_status || "unknown").toLowerCase();
  const trusted = status === "verified" && Number.isFinite(rawLimit) && rawLimit > 0;
  return {
    id,
    limit: trusted ? rawLimit : 0,
    status: trusted ? "verified" : "unknown",
    source: String(model?.context_source || "no trusted deployment metadata"),
    sourceUrl: String(model?.context_source_url || ""),
    maxOutputTokens: Math.max(0, Number(model?.max_output_tokens) || 0),
  };
}

function getContextLimit(modelId = state.selectedModel) {
  return modelCapacityMetadata(modelId).limit;
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
  return "viniper";
}

function applyAccent(accent) {
  state.accent = "viniper";
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
      mode: location.mode === "claude" ? "claude" : "viniper",
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
    return { kind, mode: location.mode === "claude" ? "claude" : "viniper" };
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
  const nextMode = mode === "claude" ? "claude" : "viniper";
  const previousMode = state.viewMode === "claude" ? "claude" : "viniper";
  if (previousMode !== nextMode) {
    closeSettingsModal({ restoreNavigation: false });
    saveActiveModeState(previousMode);
    // The interaction dock is a single shell surface. Never carry the
    // previous owner's actionable card across an Agent switch; the next
    // owner restores only its own SessionRunRegistry projection below.
    clearInteractionDock();
    $("#native-command-status")?.remove();
    state.pendingInteraction = null;
    restoreModeOwnedState(nextMode);
  }
  state.viewMode = nextMode;
  state.sessionMode = nextMode;
  storageSet(VIEW_MODE_KEY, nextMode);
  activateDailyUsageMode(nextMode);
  document.body.dataset.viewMode = nextMode;
  document.body.dataset.sessionMode = nextMode;
  if (nextMode === "viniper") {
    setPeerMenuOpen(false);
    clearPeerTarget();
  }
  $$(".view-tab").forEach((button) => {
    const active = button.id === `${nextMode}-view-btn`;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  const main = $("#main");
  if (main) main.classList.add("conversation-view");
  const conversationContainer = $("#conversation-container");
  if (conversationContainer) conversationContainer.dataset.surface = "conversation-surface";
  const composer = $("#composer");
  if (composer) composer.dataset.surface = "conversation-composer";
  updateModeChrome();
  renderContextFiles();
  renderCurrentSession();
  if (state.messages.length) renderAllMessages();
  else if ($("#messages")) renderWelcome();
  renderPlanDock(state.plan);
  if (nextMode === "claude") renderGoalDock({ available: true, goals: [] });
  else void loadGoalSnapshot(state.sessionId, modeProjectionToken(nextMode, state.sessionId));
  syncCurrentSessionRuntimeUi();
}

function updateModeChrome() {
  const agent = state.viewMode === "claude";
  $$(".claude-only").forEach((node) => node.classList.toggle("hidden", !agent));
  Object.entries({ claude: "行为与权限", provider: "连接与模型", capabilities: "工具与扩展" }).forEach(([key, label]) => {
    const node = $(`[data-settings-nav="${key}"] span`);
    if (node) node.textContent = label;
  });
  $$(".viniper-only").forEach((node) => {
    node.classList.toggle("hidden", agent);
    if (agent) node.setAttribute("aria-hidden", "true");
    else node.removeAttribute("aria-hidden");
  });
  if (agent && state.workspaceTab === "capabilities") state.workspaceTab = "project";
  const hint = $(".composer-hint");
  const input = $("#user-input");
  const navLabel = $("#new-session-nav-label");
  const title = $("#new-session-title");
  if (hint) {
    hint.textContent = "输入任务，或使用 / 命令";
    hint.classList.remove("hidden");
  }
  if (input) input.placeholder = "输入任务，或使用 / 命令";
  if (navLabel) navLabel.textContent = "新建会话";
  if (title) title.textContent = "新建会话";
  const newSession = $("#new-viniper-session-btn");
  if (newSession) {
    const label = "新建会话";
    newSession.title = label;
    newSession.setAttribute("aria-label", label);
  }
  const workdirLabel = $("#new-session-workdir")?.closest(".path-input-row")?.previousElementSibling;
  const workdirRow = $("#new-session-workdir")?.closest(".path-input-row");
  if (workdirLabel) workdirLabel.classList.remove("hidden");
  if (workdirRow) workdirRow.classList.remove("hidden");
  $("#drop-overlay")?.classList.remove("hidden");
  // A mode transition always closes the dynamic overlay.  Input/click events
  // reopen it only when Agent has a real slash context and suggestions.
  hideSlashSuggestions();
  renderPeerMenu();
  if (!agent && state.settingsActiveSection === "capabilities" && !$("#settings-modal")?.classList.contains("hidden")) {
    void renderHarnessSettings();
  }
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
  const newSession = $("#new-viniper-session-btn");
  if (newSession) {
    newSession.title = t("newSession");
    newSession.setAttribute("aria-label", t("newSession"));
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
  { action: "new-session", label: "新建会话", detail: "在当前 Agent 工作区创建会话", kind: "command" },
  { action: "skills", label: "自定义与技能", detail: "浏览本地技能库", kind: "command" },
  { action: "settings", label: "设置", detail: "打开应用设置", kind: "command" },
  { action: "switch-viniper", label: "切换到 Viniper", detail: "Harness Agent 工作区", kind: "command" },
  { action: "switch-agent", label: "切换到 Claude code", detail: "Claude Code 工作区", kind: "command" }
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

function buildSearchEntries(_sessionRecords = [], skillRecords = [], query = "", projectRecords = []) {
  const needle = String(query || "").trim().toLowerCase();
  const skills = (skillRecords || []).map((skill) => ({
    kind: "skill",
    id: skill.id || skill.filename,
    label: skill.name || skill.filename,
    detail: `${skill.source || "本地"} · ${skill.path || skill.filename || ""}`
  })).filter((item) => item.id);
  const projectEntries = (projectRecords || []).map((entry) => ({
    kind: "code",
    id: entry.path,
    label: entry.path,
    detail: "当前项目代码导航"
  })).filter((item) => item.id);
  const entries = [...skills, ...projectEntries, ...GLOBAL_SEARCH_COMMANDS];
  return needle
    ? entries.filter((item) => `${item.label} ${item.detail} ${item.id || ""}`.toLowerCase().includes(needle))
    : entries;
}

function searchEntries(query = "") {
  return buildSearchEntries([], state.skills, query, state.projectIndexEntries);
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
        <span class="search-result-kind">${escapeHtml(item.kind === "skill" ? "技能" : item.kind === "code" ? "代码" : "命令")}</span>
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
    case "new-session":
      await createSession({ mode: state.viewMode });
      break;
    case "skills":
      openSkillsView({ history: true });
      break;
    case "settings":
      await openSettingsModal({ history: true });
      break;
    case "switch-viniper":
      await switchMode("viniper");
      break;
    case "switch-agent":
      await switchMode("claude");
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
  if (item.kind === "skill") {
    openSkillsView({ history: false, recordLocation: false });
    await showSkillDetail(item.id, { history: true });
    return;
  }
  if (item.kind === "code") {
    await openArtifactPath(item.id, "open");
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
    setViewMode(storageGet(VIEW_MODE_KEY) === "claude" ? "claude" : "viniper");
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
    window.__viniperWorkstationReady = true;
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
      const activeAgent = state.sessionMode === "claude" && SessionRunRegistry.get(state.sessionId)?.active;
      if (event.ctrlKey && activeAgent) void sendAgentGuidance(state.sessionId, input);
      else void sendMessage();
    }
    if (event.ctrlKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openNewSessionModal();
    }
  });

  input.addEventListener("input", () => {
    modeOwnedState().draft = input.value;
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
  $("#conversation-container").addEventListener("scroll", () => {
    if (!SessionScrollRegistry.isProjecting(state.sessionId)) {
      const container = $("#conversation-container");
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
    if (!state.sessionId) return;
    startInlineSessionRename();
  });
  $("#session-header-menu-button")?.addEventListener("click", (event) => {
    if (!state.sessionId) return;
    event.stopPropagation();
    const button = event.currentTarget;
    if (!$("#session-context-menu")?.classList.contains("hidden") && state.sessionMenuSessionId === String(state.sessionId)) {
      closeSessionMenu({ restoreFocus: true });
    } else {
      openSessionMenu(state.sessionId, button);
    }
  });
  $("#new-viniper-session-btn")?.addEventListener("click", openNewSessionModal);
  $("#new-session-nav-btn")?.addEventListener("click", openNewSessionModal);
  $("#project-btn")?.addEventListener("click", () => openWorkspaceTab("project"));
  $("#harness-capabilities-btn")?.addEventListener("click", () => void openWorkspaceTab("capabilities"));
  $("#customize-btn")?.addEventListener("click", openSkillsView);
  $("#workspace-rail-tabs")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-workspace-tab]");
    if (button) void openWorkspaceTab(button.dataset.workspaceTab);
  });
  $("#workspace-rail")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-workspace-change-dir]")) void changeWorkdir();
  });
  $("#viniper-view-btn")?.addEventListener("click", () => switchMode("viniper"));
  $("#claude-view-btn")?.addEventListener("click", () => switchMode("claude"));
  $$("[data-settings-nav]").forEach((button) => {
    button.addEventListener("click", async () => {
      const selected = normalizeSettingsSection(button.dataset.settingsNav);
      activateSettingsSection(selected);
      if (state.viewMode === "viniper" && selected === "capabilities") {
        await Promise.all([
          loadHarnessCapabilities({ render: false }),
          loadHarnessConfigurationMatrix({ render: false }),
        ]);
        renderHarnessSettings();
      }
    });
  });
  $(".settings-main")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-harness-section]");
    if (!button || state.viewMode !== "viniper") return;
    state.harnessSettingsSection = button.dataset.harnessSection || "local-models";
    renderHarnessSettings();
  });
  $("#settings-search")?.addEventListener("input", filterSettingsCenter);
  $("#settings-search-results")?.addEventListener("click", (event) => {
    const result = event.target.closest("[data-settings-search-target]");
    if (!result) return;
    const section = result.dataset.settingsSearchSection || "account";
    const selected = normalizeSettingsSection(section);
    activateSettingsSection(selected);
    if (state.viewMode === "viniper" && selected === "capabilities") {
      void Promise.all([
        loadHarnessCapabilities({ render: false }),
        loadHarnessConfigurationMatrix({ render: false }),
      ]).then(() => renderHarnessSettings());
    }
    const target = document.getElementById(result.dataset.settingsSearchTarget || "");
    for (let parent = target?.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === "DETAILS") parent.open = true;
    }
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
  $("#update-modal").addEventListener("keydown", handleUpdateModalKeydown);
  $("#settings-close-btn")?.addEventListener("click", closeSettingsModal);
  $("#cancel-settings-btn")?.addEventListener("click", closeSettingsModal);
  $("#save-settings-btn").addEventListener("click", saveSettings);
  $("#run-diagnostics-btn").addEventListener("click", runDiagnostics);
  $("#settings-models").addEventListener("input", () => { renderSettingsModelSelect(); renderSettingsModelRows(); });
  $("#settings-model-table")?.addEventListener("input", syncSettingsModelRows);
  $("#settings-model-table")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-model]");
    if (!button) return;
    button.closest("[data-model-row]")?.remove();
    syncSettingsModelRows();
    if (!$("#settings-model-table [data-model-row]")) renderSettingsModelRows();
  });
  $("#settings-add-model-btn")?.addEventListener("click", () => {
    const models = parseModelsText($("#settings-models").value);
    let suffix = models.length + 1;
    while (models.some((model) => model.id === `new-model-${suffix}`)) suffix += 1;
    models.push({ id: `new-model-${suffix}`, label: "新模型", context: 0 });
    $("#settings-models").value = modelsToText(models);
    renderSettingsModelRows();
    renderSettingsModelSelect();
    markSettingsDirty("已添加模型，请填写服务商提供的模型 ID 后保存。");
    const input = $$("#settings-model-table [data-model-field=id]").at(-1);
    input?.focus(); input?.select();
  });
  $("#settings-provider-test-btn")?.addEventListener("click", testProviderConnection);
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
    if (action === "later") void switchMode("viniper", { history: true });
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
    if (!$("#update-modal")?.classList.contains("hidden")) return;
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
    case "new-viniper-session":
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
  const nativeItems = slashCommandsForMode(state.viewMode).map((item) => ({
    ...item,
    source: slashCommandOwner(state.viewMode),
    kind: "native"
  }));
  return nativeItems
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
    });
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

async function loadStatus(mode = state.viewMode, token = modeProjectionToken(mode, state.sessionId)) {
  const requestedMode = mode === "claude" ? "claude" : "viniper";
  try {
    const response = await fetch(`/api/status?mode=${encodeURIComponent(requestedMode)}&session_id=${encodeURIComponent(token.sessionId || state.sessionId || "")}`);
    const status = await response.json();
    const owner = modeOwnedState(requestedMode);
    if (owner.generation !== token.generation) return status;
    owner.status = status;
    if (requestedMode === "claude" && status?.native_commands?.owner === "claude-code-cli") {
      const version = String(status.native_commands.cli_version || "");
      const commands = status.native_commands.descriptors || status.native_commands.commands || [];
      owner.commandManifest = commands.map((item) => ({
        ...(typeof item === "object" ? item : {}),
        command: String(typeof item === "object" ? item.command : item),
        title: typeof item === "object" ? (item.title || item.command) : String(item).replace(/^\//, ""),
        description: typeof item === "object" ? (item.description || "Claude Code 原生命令") : `Claude Code CLI ${version} 原生命令`,
        version,
      }));
    }
    if (!modeProjectionIsCurrent(token)) return status;
    state.status = status;
    state.previewMode =
      Boolean(state.status?.preview) || new URLSearchParams(window.location.search).get("preview") === "1";
    document.body.classList.toggle("preview-mode", state.previewMode);
    updateRuntimeProfileChrome();
    applySettingsFromServer(state.status.settings);
    const rememberedModel = readRememberedModel(requestedMode);
    const available = (state.status.models || []).map((model) => model.id);
    state.selectedModel = available.includes(rememberedModel)
      ? rememberedModel
      : (state.status.model || "deepseek-flash");
    state.permissionMode = sanitizePermissionMode(state.status.permission_mode || "default");
    renderModelSelect();
    renderPermissionSelect();
    updateModelLabels();
    updateContextMeter();
    renderUpdateButton();
    renderRuntimeSettings(state.status.runtime);
    translateChrome();
    saveActiveModeState(requestedMode);
    schedulePermissionStatusRefresh(requestedMode, token, status);
    return status;
  } catch {
    if (modeProjectionIsCurrent(token)) $("#status-line").textContent = "服务未就绪";
    return null;
  }
}

function renderUpdateButton() {
  const flow = state.updateFlow;
  const info = state.updateInfo;
  const snapshot = flow.snapshot;
  const version = state.status?.version ? `v${state.status.version}` : "版本信息";
  const downloading = snapshot?.status === "downloading";
  const ready = snapshot?.status === "ready";
  const busy = Boolean(flow.checking || flow.busy);
  const label = flow.checking ? "正在检查更新…" : downloading ? "查看下载进度" : ready ? "安装更新" : info?.update_available ? "查看新版本" : "检查更新";
  for (const selector of ["#update-btn", "#settings-check-update-btn", '[data-account-action="update"]']) {
    const button = $(selector);
    if (!button) continue;
    button.disabled = busy;
    button.title = label;
    button.setAttribute("aria-label", `${version} · ${label}`);
    if (selector === "#update-btn") {
      button.textContent = `${version} · ${label}`;
      button.classList.toggle("update-available", Boolean(info?.update_available || ready));
    } else if (selector === "#settings-check-update-btn") button.textContent = label;
  }
  const status = $("#settings-update-status");
  if (status) status.textContent = flow.error || (flow.checking ? "正在连接 GitHub，检查正式版…" : snapshot?.message || info?.message || (info?.update_available ? `可更新至 v${info.latest_version}。` : `当前 ${version} · GitHub 正式版。两个 Agent 一起更新，会话与设置保留。`));
}

async function requestUpdate(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      cache: "no-store", signal: controller.signal
    });
    const data = await response.json().catch(() => null);
    if (!data || typeof data !== "object") throw new Error("更新服务返回了无效响应，请稍后重试。");
    if (!response.ok || data.ok === false) {
      throw new Error(data.detail || data.message || `请求失败（HTTP ${response.status}），请稍后重试。`);
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("连接超时，请检查网络后重试。");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function checkForUpdates({ silent = false } = {}) {
  const flow = state.updateFlow;
  if (!silent) showUpdateModal();
  if (flow.checking || flow.busy) return state.updateInfo;
  if (["downloading", "ready", "installer_opened"].includes(flow.snapshot?.status)) {
    await refreshUpdateStatus();
    return state.updateInfo;
  }
  flow.checking = true;
  flow.error = "";
  renderUpdateModal();
  try {
    state.updateInfo = await requestUpdate("/api/update/check", {});
    await refreshUpdateStatus();
    return state.updateInfo;
  } catch (error) {
    state.updateInfo = null;
    flow.error = `检查更新失败：${error.message}`;
    return null;
  } finally {
    flow.checking = false;
    renderUpdateModal();
  }
}

function showUpdateModal() {
  const modal = $("#update-modal");
  if (!modal) return;
  if (modal.classList.contains("hidden")) state.updateFlow.returnFocus = document.activeElement;
  modal.classList.remove("hidden");
  renderUpdateModal();
  $("#cancel-update-btn").focus();
}

function closeUpdateModal() {
  $("#update-modal")?.classList.add("hidden");
  state.updateFlow.returnFocus?.focus?.();
}

function handleUpdateModalKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeUpdateModal();
    return;
  }
  if (event.key !== "Tab") return;
  const controls = Array.from($("#update-modal").querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')).filter((node) => !node.closest(".hidden"));
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}

function updateSizeLabel(value) {
  const bytes = Math.max(0, Number(value) || 0);
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function renderUpdateModal() {
  renderUpdateButton();
  const flow = state.updateFlow;
  const info = state.updateInfo || {};
  const snapshot = flow.snapshot || {};
  const phase = snapshot.status || "idle";
  const downloading = phase === "downloading";
  const ready = phase === "ready";
  const opened = phase === "installer_opened" || snapshot.installer_opened === true;
  const busy = Boolean(flow.checking || flow.busy);
  const available = Boolean(info.update_available);
  const latest = snapshot.latest_version || info.latest_version || "";
  const current = info.current_version || state.status?.version || "";
  $("#update-title").textContent = opened ? "继续完成安装" : ready ? "更新已下载" : downloading ? "正在下载更新" : "应用更新";
  $("#update-summary").textContent = current ? `当前 v${current}${latest && latest !== current ? ` → v${latest}` : ""} · GitHub 正式版` : "从 GitHub 获取正式版更新";
  $("#update-notes").textContent = info.notes || "暂无版本说明。";
  $("#update-notes-section").classList.toggle("hidden", !info.notes);
  const message = flow.error || (flow.checking ? "正在连接 GitHub，检查正式版…" : flow.busy === "apply" ? "正在打开安装器…" : flow.busy === "download" ? "正在准备下载…" : opened ? (snapshot.desktop_quit_requested ? "安装器已打开，工作台即将退出。请按安装器提示完成更新，再重新打开工作台。" : "安装器已打开。请先从托盘退出工作台，再在安装器中继续；完成后重新打开工作台。") : snapshot.message || info.message || (available ? "下载安装包后再确认安装。更新保留两个 Agent 的会话、设置和密钥。" : "点击检查更新，获取最新正式版。"));
  $("#update-feedback").textContent = message;
  $("#update-feedback").dataset.kind = flow.error || phase === "failed" ? "error" : "status";
  $("#update-modal").setAttribute("aria-busy", String(busy));
  const progress = $("#update-progress");
  const downloaded = Math.max(0, Number(snapshot.downloaded_bytes) || 0);
  const total = Math.max(0, Number(snapshot.total_bytes) || 0);
  $("#update-progress-section").classList.toggle("hidden", !["downloading", "ready", "installer_opened"].includes(phase));
  if (total > 0) {
    progress.max = total;
    progress.value = Math.min(downloaded, total);
    progress.setAttribute("aria-valuetext", `${updateSizeLabel(downloaded)} / ${updateSizeLabel(total)}`);
  } else {
    progress.removeAttribute("value");
    progress.removeAttribute("aria-valuetext");
  }
  $("#update-progress-label").textContent = total > 0 ? `${updateSizeLabel(downloaded)} / ${updateSizeLabel(total)}` : downloaded > 0 ? `已下载 ${updateSizeLabel(downloaded)}` : "等待下载数据…";
  $("#update-install-hint").classList.toggle("hidden", !ready);
  $("#update-install-hint").textContent = typeof window.viniperDesktop?.installAppUpdate === "function"
    ? "请先完成两个 Agent 的运行中任务。点击后会打开 Windows 安装器并退出工作台，由你确认安装。"
    : "请先完成两个 Agent 的运行中任务。点击后会打开 Windows 安装器；请从托盘退出工作台，再在安装器中继续。";
  const button = $("#install-update-btn");
  button.disabled = busy || (downloading && !flow.error) || opened;
  button.textContent = flow.checking ? "正在检查…" : flow.busy === "apply" ? "正在打开…" : downloading && flow.error ? "重试连接" : downloading || flow.busy === "download" ? "下载中…" : opened ? "安装器已打开" : ready ? "安装更新" : available ? (phase === "failed" ? "重新下载" : "下载安装包") : "检查更新";
  $("#cancel-update-btn").textContent = downloading ? "后台下载" : opened ? "关闭" : "稍后";
}

function scheduleUpdateStatusPoll() {
  const flow = state.updateFlow;
  if (flow.pollTimer) clearTimeout(flow.pollTimer);
  flow.pollTimer = null;
  if (flow.snapshot?.status === "downloading" || (flow.snapshot?.status === "installer_opened" && !flow.snapshot.desktop_quit_requested)) {
    flow.pollTimer = setTimeout(() => { flow.pollTimer = null; void refreshUpdateStatus(); }, flow.snapshot.status === "downloading" ? 1000 : 3000);
  }
}

async function refreshUpdateStatus() {
  const flow = state.updateFlow;
  try {
    flow.snapshot = await requestUpdate("/api/update/status");
    flow.error = "";
  } catch (error) {
    flow.error = `暂时无法读取更新进度：${error.message}`;
  } finally {
    renderUpdateModal();
    scheduleUpdateStatusPoll();
  }
}

async function installUpdate() {
  const flow = state.updateFlow;
  if (flow.busy || flow.checking || flow.snapshot?.status === "installer_opened") return;
  if (flow.snapshot?.status === "downloading") { if (flow.error) await refreshUpdateStatus(); return; }
  const ready = flow.snapshot?.status === "ready";
  if (!ready && !state.updateInfo?.update_available) { await checkForUpdates(); return; }
  flow.busy = ready ? "apply" : "download";
  flow.error = "";
  renderUpdateModal();
  try {
    const data = ready && typeof window.viniperDesktop?.installAppUpdate === "function"
      ? await window.viniperDesktop.installAppUpdate()
      : await requestUpdate(ready ? "/api/update/apply" : "/api/update/install", {});
    if (data.ok === false) throw new Error(data.detail || data.message || "安装器未能启动，请重试。");
    flow.snapshot = { ...flow.snapshot, ...data };
    if (data.started === false && data.status === "idle" && state.updateInfo) state.updateInfo.update_available = false;
    if (data.installer_opened) flow.snapshot.status = "installer_opened";
    else await refreshUpdateStatus();
  } catch (error) {
    flow.error = `${ready ? "暂时不能安装" : "下载未开始"}：${error.message}`;
  } finally {
    flow.busy = "";
    renderUpdateModal();
    scheduleUpdateStatusPoll();
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
  const composerStatus = $("#composer-status-text");
  if (profileLabel) profileLabel.textContent = copy.profileLabel;
  if (composerStatus && !state.isStreaming) composerStatus.textContent = "空闲";
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
      detail: "Windows 会显示一次 UAC 确认。完成后可能需要重启；Viniper 始终可以继续使用。",
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
    detail: "上次设置未完成。可以重试、打开诊断，或稍后继续使用 Viniper。",
    actionLabel: "重试设置",
    progress: "可恢复"
  };
}

function renderRuntimeSettings(runtime = state.status?.runtime || {}) {
  const isClaudeCode = state.viewMode === "claude";
  const view = isClaudeCode ? runtimeSetupViewModel(runtime) : { ready: Boolean(state.status?.configured || state.settings?.provider?.api_key_configured), canInstall: false };
  const engineLabel = isClaudeCode ? "Claude code · 原生 CLI" : "Viniper · 自研 Agent";
  const providerLabel = String(state.settings?.provider?.label || "模型服务");
  const modelLabel = String(state.settings?.provider?.model || state.selectedModel || "默认模型");
  const permissionId = String(state.permissionMode || state.settings?.runtime?.permission_mode || "default");
  const permissionLabel = (isClaudeCode ? CLAUDE_PERMISSION_MODES : VINIPER_PERMISSION_MODES).find((item) => item.id === permissionId)?.label || permissionId;
  const status = $("#settings-runtime-status");
  const setupButton = $("#settings-runtime-setup-btn");
  const updateButton = $("#settings-runtime-update-btn");
  if (status) {
    status.classList.toggle("ready", view.ready);
    status.classList.toggle("not-ready", !view.ready);
    // Keep one fixed two-line status block in the shared Agent settings
    // position, while exposing the active engine/provider/model/permission
    // tuple so Viniper and Claude code cannot appear to share state.
    const readiness = isClaudeCode ? (view.ready ? "可用" : "未就绪") : (view.ready ? "连接已配置" : "请配置连接");
    const detail = `${providerLabel} · ${modelLabel} · ${permissionLabel} · ${readiness}`;
    status.innerHTML = `<strong>${escapeHtml(engineLabel)}</strong><span>${escapeHtml(detail)}</span>`;
  }
  if (setupButton) {
    setupButton.textContent = state.runtimeBusy ? "正在处理" : view.actionLabel;
    setupButton.disabled = state.runtimeBusy || !view.canInstall;
    setupButton.classList.toggle("hidden", !isClaudeCode || view.ready);
  }
  if (updateButton) {
    updateButton.classList.toggle("hidden", !isClaudeCode || !view.ready);
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
  if (rerender && !state.messages.length) renderWelcome();
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
  if (!state.messages.length) renderWelcome();
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
    if (!state.messages.length) renderWelcome();
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
    const hasContext = parts.length > 2 && parts[2] !== "";
    const context = hasContext ? Number(parts[2]) : 0;
    models.push({
      id,
      label: parts[1] || id,
      description: "",
      context: Number.isFinite(context) ? Math.max(context, 0) : 0
    });
  }
  return models;
}

const settingsSaves = new Map();

function settingsViewToken() {
  return Object.freeze({ ...state.settingsView });
}

function settingsViewIsCurrent(token) {
  return token?.mode === state.viewMode && token.mode === state.settingsView.mode
    && token.generation === state.settingsView.generation
    && !$("#settings-modal")?.classList.contains("hidden");
}

async function settingsResponse(response, fallback) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.detail || fallback);
  return data;
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
  const mode = state.viewMode === "claude" ? "claude" : "viniper";
  state.settingsView = { mode, generation: state.settingsView.generation + 1 };
  const token = settingsViewToken();
  const owner = modeOwnedState(mode);
  const modal = $("#settings-modal");
  modal.classList.remove("hidden");
  modal.classList.add("settings-loading");
  modal.setAttribute("aria-busy", "true");
  $("#settings-title").textContent = mode === "claude" ? "Claude code 设置" : "Viniper 设置";
  $("#save-settings-btn").disabled = true;
  $("#settings-api-key").value = "";
  clearSettingsDirty();
  let data, instructionData, runtimeData;
  try {
    [data, instructionData, runtimeData] = await Promise.all([
      fetch(`/api/settings?mode=${encodeURIComponent(mode)}`).then((response) => settingsResponse(response, "设置读取失败")),
      fetch(`/api/agent-instructions?mode=${encodeURIComponent(mode)}`).then((response) => settingsResponse(response, "自定义指令读取失败")),
      mode === "claude" ? fetch("/api/runtime/status").then((response) => settingsResponse(response, "运行环境读取失败")) : Promise.resolve({ runtime: state.status?.runtime || {} }),
    ]);
  } catch (error) {
    if (settingsViewIsCurrent(token)) {
      modal.classList.remove("settings-loading");
      modal.setAttribute("aria-busy", "false");
      modal.classList.add("settings-load-error");
      $("#settings-save-status").textContent = `读取失败：${error.message}。关闭后重新打开可重试。`;
      $("#settings-action-bar").classList.remove("hidden");
    }
    return;
  }
  if (!settingsViewIsCurrent(token)) return;
  modal.classList.remove("settings-loading", "settings-load-error");
  modal.setAttribute("aria-busy", "false");
  $("#save-settings-btn").disabled = settingsSaves.has(mode);
  $("#save-settings-btn").textContent = settingsSaves.has(mode) ? "保存中" : "保存";
  $("#settings-provider-test-btn").disabled = false;
  if (data.settings) {
    state.settings = data.settings;
    owner.settings = data.settings;
    state.status = {
      ...(state.status || {}),
      shells: data.shells,
      languages: data.languages,
      themes: data.themes,
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
    owner.agentInstructions = state.agentInstructions;
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
  renderSettingsOptions($("#settings-language"), state.status?.languages || [], appearance.language || state.language);
  renderSettingsOptions($("#settings-theme"), state.status?.themes || [], appearance.theme || state.theme);
  renderSettingsOptions($("#settings-font-size"), state.status?.font_sizes || FONT_SIZE_OPTIONS, appearance.font_size || state.fontSize);
  renderSettingsOptions($("#settings-shell"), state.status?.shells || [], shell.id || "claude-code");
  $("#settings-custom-command").value = shell.custom_command || "";
  $("#settings-custom-env").value = shell.custom_env || "";
  $("#settings-memory-enabled").checked = runtimeSettings.memory_enabled !== false;
  $("#settings-memory-status").textContent = runtimeSettings.memory_enabled === false ? "已关闭" : "已开启 · 当前 Agent 独立保存";
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
  renderSettingsModelRows();
  renderSettingsModelSelect();
  $("#settings-provider-model").value = provider.model || state.selectedModel;
  $("#settings-provider-test-status").textContent = provider.api_key_configured ? "已配置 · 尚未测试" : "未配置";
  $("#agent-md-editor").value = state.agentInstructions.content || "";
  $("#agent-md-path").textContent = state.agentInstructions.path || "保存后将在当前数据目录创建 AGENT.md";
  const instructionHeading = $('[data-settings-panel="agent-md"] .settings-panel-header h3');
  if (instructionHeading) instructionHeading.textContent = mode === "claude" ? "CLAUDE.md" : "AGENT.md";
  const instructionNavLabel = $('[data-settings-nav="agent-md"] span');
  if (instructionNavLabel) instructionNavLabel.textContent = mode === "claude" ? "CLAUDE.md" : "AGENT.md";
  const instructionEditor = $("#agent-md-editor");
  if (instructionEditor) instructionEditor.placeholder = mode === "claude" ? "# Claude code 独立指令" : "# Viniper 独立指令";
  const instructionDescription = $('[data-settings-panel="agent-md"] .settings-panel-header p');
  if (instructionDescription) instructionDescription.textContent = mode === "claude" ? "Claude code 使用这些长期指令；项目中的 CLAUDE.md 也会生效。" : "Viniper 开始或恢复任务时读取这些长期指令。";
  const runtimeStatus = $("#settings-runtime-status");
  if (runtimeStatus) renderRuntimeSettings(runtime);
  $("#diagnostics-panel").innerHTML = "";
  $("#settings-search").value = "";
  filterSettingsCenter("");
  clearSettingsDirty();
  $("#settings-modal").classList.remove("hidden");
  const selected = normalizeSettingsSection(section || "account");
  if (mode === "viniper" && selected === "capabilities") {
    await loadHarnessSnapshot({ render: false });
    if (selected === "capabilities") {
      await Promise.all([
        loadHarnessCapabilities({ render: false }),
        loadHarnessConfigurationMatrix({ render: false }),
      ]);
    }
  } else if (mode === "claude") {
    state.harnessSnapshot = null;
    state.capabilities = null;
    state.configurationMatrix = null;
  }
  if (!settingsViewIsCurrent(token)) return;
  activateSettingsSection(selected, { recordLocation: false });
  updateModeChrome();
  if (state.viewMode === "viniper" && selected === "capabilities") renderHarnessSettings();
  setNavigationLocation({ kind: "settings", section: selected }, { push: history });
  $("#settings-search").focus();
}

function renderSettingsModelRows() {
  const host = $("#settings-model-table");
  if (!host) return;
  const models = parseModelsText($("#settings-models").value);
  host.innerHTML = models.map((model, index) => `<div class="settings-model-row" data-model-row="${index}">
    <label><span>模型 ID</span><input data-model-field="id" aria-label="模型 ${index + 1} ID" value="${escapeAttr(model.id)}" placeholder="服务商提供的模型 ID"></label>
    <label><span>显示名称</span><input data-model-field="label" aria-label="模型 ${index + 1} 显示名称" value="${escapeAttr(model.label)}" placeholder="便于识别的名称"></label>
    <label><span>上下文上限（Token）</span><input data-model-field="context" aria-label="模型 ${index + 1} 上下文上限（自动识别）" type="number" readonly value="${model.context || ""}" placeholder="尚未识别"></label>
    <button type="button" class="ghost-button settings-model-remove" data-remove-model="${index}" aria-label="删除模型 ${escapeAttr(model.label || model.id)}">删除</button>
  </div>`).join("") || `<p class="settings-help">还没有模型。添加服务商提供的模型 ID 后即可选择。</p>`;
}

function syncSettingsModelRows() {
  const rows = $$("#settings-model-table [data-model-row]");
  $("#settings-models").value = rows.map((row) => ["id", "label", "context"].map((field) => row.querySelector(`[data-model-field="${field}"]`)?.value.trim() || "").join(" | ")).join("\n");
  renderSettingsModelSelect();
  markSettingsDirty();
}

function closeSettingsModal({ restoreNavigation = true } = {}) {
  state.settingsView = { mode: null, generation: state.settingsView.generation + 1 };
  const modal = $("#settings-modal");
  if (modal) modal.classList.add("hidden");
  $("#settings-api-key").value = "";
  filterSettingsCenter("");
  clearSettingsDirty();
  if (restoreNavigation && state.navigation.current?.kind === "settings") {
    void restorePreviousDurableLocation();
  }
}

async function saveAgentInstructions({ mode, content, previousContent, token }) {
  const owner = modeOwnedState(mode);
  if (content === previousContent) return owner.agentInstructions;
  const response = await fetch("/api/agent-instructions", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, mode })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.detail || "保存 AGENT.md 失败；原内容已保留。");
  }
  owner.agentInstructions = {
    content: data.content || "",
    exists: Boolean(data.exists),
    path: data.path || "",
    updated_at: data.updated_at ?? null
  };
  if (state.viewMode === mode) state.agentInstructions = owner.agentInstructions;
  if (settingsViewIsCurrent(token)) {
    $("#agent-md-path").textContent = owner.agentInstructions.path;
  }
  return owner.agentInstructions;
}

async function saveSettings() {
  const token = settingsViewToken();
  if (!settingsViewIsCurrent(token) || settingsSaves.has(token.mode)) return;
  const mode = token.mode;
  const owner = modeOwnedState(mode);
  const models = parseModelsText($("#settings-models").value);
  if (!models.length) {
    markSettingsDirty("请至少添加一个模型，并填写服务商提供的模型 ID。");
    activateSettingsSection("provider");
    $("#settings-add-model-btn")?.focus();
    return;
  }
  const instructionSnapshot = { mode, token, content: $("#agent-md-editor")?.value || "", previousContent: state.agentInstructions.content };
  const apiKey = $("#settings-api-key").value.trim();
  const settings = {
    account: {
      display_name: $("#settings-display-name").value.trim() || "Viniper 用户",
      signed_in: Boolean(state.settings?.account?.signed_in)
    },
    appearance: {
      language: $("#settings-language").value,
      theme: $("#settings-theme").value,
      accent: "viniper",
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
      memory_enabled: $("#settings-memory-enabled").checked
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
  const button = $("#save-settings-btn");
  settingsSaves.set(mode, token);
  button.disabled = true;
  button.textContent = "保存中";
  $("#settings-save-status").textContent = "正在保存…";
  try {
    if (apiKey) {
      const saveSecret = window.viniperDesktop?.saveProviderSecret;
      if (typeof saveSecret !== "function") {
        throw new Error("API Key 必须由桌面安全存储保存");
      }
      const result = await saveSecret(mode, apiKey);
      if (!result?.ok) throw new Error(result?.reason || "安全存储不可用");
    }
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings, mode })
    });
    const data = await response.json();
    if (!response.ok || data.ok === false) {
      throw new Error(data.detail || "保存失败");
    }
    await saveAgentInstructions(instructionSnapshot);
    owner.settings = data.settings;
    owner.status = {
      ...(owner.status || {}),
      models: data.models,
      settings: data.settings,
      permission_modes: data.permission_modes || owner.status?.permission_modes || [],
    };
    owner.selectedModel = data.settings.provider?.model || owner.selectedModel;
    rememberModel(owner.selectedModel, mode);
    if (state.viewMode === mode) {
      state.settings = owner.settings;
      state.status = owner.status;
    }
    if (!settingsViewIsCurrent(token)) return;
    applySettingsFromServer(data.settings);
    state.selectedModel = data.settings.provider?.model || state.selectedModel;
    rememberModel(state.selectedModel, state.viewMode);
    renderModelSelect();
    renderPermissionSelect();
    updateModelLabels();
    updateContextMeter();
    clearSettingsDirty();
    closeSettingsModal();
  } catch (error) {
    if (settingsViewIsCurrent(token)) markSettingsDirty(`保存失败：${error.message}`);
  } finally {
    settingsSaves.delete(mode);
    if (state.settingsView.mode === mode) {
      button.disabled = false;
      button.textContent = "保存";
    }
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

async function testProviderConnection() {
  const token = settingsViewToken();
  if (!settingsViewIsCurrent(token)) return;
  const button = $("#settings-provider-test-btn");
  const status = $("#settings-provider-test-status");
  if (!button || !status) return;
  button.disabled = true;
  status.textContent = "测试中…";
  try {
    const response = await fetch(`/api/provider/test?mode=${encodeURIComponent(token.mode)}`, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.detail || "Provider 不可用");
    if (String(data.status || "").startsWith("http_") || data.status === "error") throw new Error(data.detail || data.error_type || data.status);
    if (settingsViewIsCurrent(token)) status.textContent = !data.configured ? "请先保存连接地址和密钥"
      : ["connected", "reachable"].includes(data.status) ? "连接测试通过"
        : data.status === "ready" ? "配置已读取，尚未验证实际请求" : `连接检查：${data.status || "尚未验证"}`;
  } catch (error) {
    if (settingsViewIsCurrent(token)) status.textContent = `连接失败：${error.message || error}`;
  } finally {
    if (settingsViewIsCurrent(token)) button.disabled = false;
  }
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
    <option value="${escapeAttr(model.id)}">
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
    { id: "deepseek-flash", label: "DeepSeek V4.1 Flash", description: "" }
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
      <span class="anchored-menu-copy"><strong>${escapeHtml(model.label || model.id)}</strong></span>
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
  rememberModel(state.selectedModel, state.viewMode);
  renderModelMenu();
  updateModelLabels();
  renderCurrentSession();
  updateContextMeter();
  persistSelectedModel();
  void refreshContextUsageForSelectedModel();
  if (closeMenu) setAnchoredMenuOpen("model", false, { restoreFocus });
  return true;
}

async function refreshContextUsageForSelectedModel() {
  const sessionId = String(state.sessionId || "");
  if (!sessionId) return null;
  const mode = state.viewMode === "claude" ? "claude" : "viniper";
  const selectedModel = String(state.selectedModel || "");
  const model = encodeURIComponent(selectedModel);
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/usage?model=${model}&mode=${mode}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false || !data.usage) return null;
    if (selectedModel !== String(state.selectedModel || "")) return null;
    if (sessionId !== String(state.sessionId || "") || mode !== (state.viewMode === "claude" ? "claude" : "viniper")) return null;
    state.contextUsage = normalizeContextUsage(data.usage, state.selectedModel);
    state.contextUsageBySession[sessionId] = state.contextUsage;
    updateContextMeter({ schedule: false });
    return data.usage;
  } catch {
    // The local status projection remains authoritative; no Provider call is
    // made for a model switch and the existing usage stays visible.
    updateContextMeter({ schedule: false });
    return null;
  }
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
    const claudePermissionUnavailable = kind === "permission"
      && state.viewMode === "claude"
      && (state.status?.permission_modes_pending || permissionModeOptions().some((item) => item.enabled === false));
    if (claudePermissionUnavailable) {
      requestPermissionStatusRefresh("claude");
    }
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
  const selectedMode = state.viewMode === "claude" ? "claude" : "viniper";
  const selectedModel = state.selectedModel;
  modelPersistTimer = setTimeout(async () => {
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: selectedMode, settings: { provider: { model: selectedModel } } })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) return;
      if (data.settings && state.viewMode === selectedMode) {
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
  const baseModes = state.viewMode === "claude" ? CLAUDE_PERMISSION_MODES : VINIPER_PERMISSION_MODES;
  const fallbackById = new Map(baseModes.map((item) => [item.id, item]));
  const declaredById = new Map((Array.isArray(declared) ? declared : []).map((item) => [item.id, item]));
  return baseModes.map((item) => item.id)
    .filter((id) => visible.has(id))
    .map((id) => {
      const item = { ...(fallbackById.get(id) || {}), ...(declaredById.get(id) || {}) };
      return { ...item, description: permissionDescriptionForMode(id, state.viewMode) || item.description || "" };
    })
    .filter((item) => item.id);
}

function permissionModeOptions() {
  const baseModes = state.viewMode === "claude" ? CLAUDE_PERMISSION_MODES : VINIPER_PERMISSION_MODES;
  const defaultVisible = new Set(baseModes.map((item) => item.id));
  const declared = Array.isArray(state.status?.permission_modes) && state.status.permission_modes.length
    ? state.status.permission_modes
    : baseModes;
  return orderedPermissionModes(declared, defaultVisible);
}

function settingsPermissionModeOptions() {
  const baseModes = state.viewMode === "claude" ? CLAUDE_PERMISSION_MODES : VINIPER_PERMISSION_MODES;
  const defaultVisible = new Set(baseModes.map((item) => item.id));
  const declared = Array.isArray(state.status?.permission_modes) && state.status.permission_modes.length
    ? state.status.permission_modes
    : baseModes;
  return orderedPermissionModes(declared, defaultVisible);
}

function renderSettingsPermissionOptions(selected = $("#settings-permission-default")?.value || state.permissionMode) {
  const select = $("#settings-permission-default");
  if (!select) return;
  const options = settingsPermissionModeOptions();
  const fallback = state.viewMode === "claude" ? "default" : "ask";
  const value = options.some((item) => item.id === selected) ? selected : fallback;
  renderSettingsOptions(select, options, value);
}

function sanitizePermissionMode(mode) {
  const raw = String(mode || "");
  const isClaude = state.viewMode === "claude";
  const migration = isClaude
    ? { ask: "default", manual: "default", auto: "acceptEdits", full: "fullAccess", bypassPermissions: "fullAccess" }
    : { default: "ask", manual: "ask", acceptEdits: "review", auto: "review", plan: "review", full: "fullAccess", bypassPermissions: "fullAccess" };
  const value = migration[raw] || raw;
  const fallback = isClaude ? "default" : "ask";
  return permissionModeOptions().some((item) => item.id === value) ? value : fallback;
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
  if (label) label.textContent = modes.find((mode) => mode.id === state.permissionMode)?.label || (state.viewMode === "claude" ? "询问权限" : "每次询问");
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
  if (sessionId && state.sessionMode === state.viewMode) {
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
  const visible = state.viewMode === "claude"
    && state.peerCapability.available
    && state.peerCapability.verified
    && targets.length > 0;
  const enabled = state.viewMode === "claude"
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
  const token = modeProjectionToken(state.viewMode, state.sessionId);
  if (state.viewMode !== "claude" || !state.sessionId) {
    state.peerCapability = normalizePeerStatus({ reason: "Viniper 跨会话能力由 Harness 独立提供" });
    clearPeerTarget({ render: false });
    renderPeerMenu();
    return state.peerCapability;
  }
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(state.sessionId)}/peers`);
    const data = await response.json().catch(() => ({}));
    if (!modeProjectionIsCurrent(token)) return modeOwnedState(token.mode).peerCapability;
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

async function createSession({ silent = false, name = "", workdir = "", mode = state.viewMode, history = true, preserveComposer = false } = {}) {
  const requestedMode = mode === "claude" ? "claude" : "viniper";
  const input = $("#user-input");
  const preservedDraft = preserveComposer ? String(input?.value || modeOwnedState(requestedMode).draft || "") : "";
  const preservedFiles = preserveComposer ? [...modeOwnedState(requestedMode).contextFiles] : [];
  closeSkillsView({ restoreNavigation: false });
  closeSettingsModal({ restoreNavigation: false });
  resetCurrentSessionRuntimeUi();
  const sessionMode = requestedMode;
  const response = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, workdir, mode: sessionMode })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.session_id) throw new Error(data.detail || `新建会话失败（HTTP ${response.status}）`);
  clearContextCompressionTimer();
  setViewMode(sessionMode);
  state.sessionId = data.session_id;
  SessionScrollRegistry.set(state.sessionId, true);
  state.sessionMode = data.mode === "claude" ? "claude" : "viniper";
  state.viewMode = state.sessionMode;
  activateContextCompressionState(state.sessionId);
  state.contextRevision = data.revision || `${data.updated || ""}:${data.message_count || 0}`;
  state.contextUsage = normalizeContextUsage(data.context_usage);
  state.contextUsageBySession[state.sessionId] = state.contextUsage;
  state.permissionMode = sanitizePermissionMode(data.permission_mode || "default");
  state.sessionName = data.name || "";
  state.workdir = data.workdir || "";
  state.sessionPinned = Boolean(data.pinned);
  state.sessionUnread = Boolean(data.unread);
  state.sessionRuntimeState = String(data.runtime_state || "idle");
  state.messages = [];
  state.activityEvents = [];
  if (preserveComposer) {
    state.contextFiles = preservedFiles;
    modeOwnedState(sessionMode).contextFiles = state.contextFiles;
    if (input) input.value = preservedDraft;
    modeOwnedState(sessionMode).draft = preservedDraft;
    renderContextFiles();
  } else {
    clearContextFiles();
  }
  renderCurrentSession();
  renderWelcome();
  updateContextMeter();
  void refreshPeerStatus();
  rememberSession(state.sessionId);
  await loadSessionList();
  setNavigationLocation({ kind: "session", mode: state.sessionMode, sessionId: state.sessionId }, { push: history });
  if (!silent) $("#user-input").focus();
  saveActiveModeState(sessionMode);
  return data;
}

function sessionHasMessages(session) {
  return Math.max(0, Number(session?.count ?? session?.message_count ?? 0) || 0) > 0;
}

function sessionIsActive(session) {
  return ["running", "waiting_input", "awaiting_cli_ack"].includes(String(session?.runtime_state || ""));
}

async function restoreLastSession() {
  await enterModeLanding(state.viewMode, { history: false });
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
  const header = $("#session-header");
  const titleButton = $("#session-title-button");
  const inlineInput = $("#session-title-inline-input");
  const title = $("#session-title");
  const path = $("#workdir-display");
  const menuButton = $("#session-header-menu-button");
  if (!header || (!titleButton && !inlineInput) || !path || !menuButton) return;
  const visible = Boolean(state.sessionId);
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
  const header = $("#session-header");
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
  const header = $("#session-header");
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
  if (!state.sessionId || $("#session-title-inline-input")) return false;
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
  if (projectAction) projectAction.hidden = false;
  const removeWorkspace = setSessionMenuItemLabel(menu, "remove-workspace", "从工作台移除");
  if (removeWorkspace) removeWorkspace.hidden = !Boolean(session.workdir);
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
  if (!target) throw new Error("会话不存在。");
  if (targetId !== String(state.sessionId || "")) {
    const switched = await switchSession(targetId, { quiet: true, history: true });
    if (!switched) throw new Error("无法打开目标会话。");
  }
  changeWorkdir();
  return true;
}

async function removeWorkspaceBinding(sessionId) {
  const response = await fetch("/api/workspaces/remove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, confirm: true })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.detail || "移除工作区绑定失败");
  if (data.physical_files_deleted !== false) throw new Error("工作区移除未能证明磁盘文件保持不变");
  await loadSessionList();
  if (String(sessionId) === String(state.sessionId || "")) await switchSession(sessionId, { quiet: true, history: false });
  showInlineStatus("已从工作台移除；磁盘文件未删除", { kind: "info", timeout: 4200 });
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
    else if (action === "remove-workspace") await removeWorkspaceBinding(sessionId);
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

async function loadSessionList() {
  const requestedMode = state.viewMode === "claude" ? "claude" : "viniper";
  const generation = modeOwnedState(requestedMode).generation;
  let sessions;
  try {
    const response = await fetch("/api/sessions");
    const data = await response.json();
    sessions = data.sessions || [];
  } catch {
    return;
  }
  if (state.viewMode !== requestedMode || modeOwnedState(requestedMode).generation !== generation) return;
  sessions = sessions.filter((session) => (session.mode === "viniper" ? "viniper" : "claude") === requestedMode);
  state.sessionIndex = sessions;
  modeOwnedState(requestedMode).sessionIndex = sessions;
  renderSessionHeader();
  const list = $("#session-list");
  if (!sessions.length) {
    list.innerHTML = `<div class="empty-list">暂无会话</div>`;
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
    const sessionMode = data.mode === "claude" ? "claude" : "viniper";
    if (state.viewMode !== sessionMode) {
      setViewMode(sessionMode);
      bumpModeGeneration(sessionMode);
      const token = modeProjectionToken(sessionMode, state.sessionId);
      await loadStatus(sessionMode, token);
      if (generation !== state.sessionSwitchGeneration) return false;
    }
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
  const scrollProjectionToken = SessionScrollRegistry.beginProjection(sessionId);
  SessionScrollRegistry.activate(sessionId);
  const sessionMode = data.mode === "claude" ? "claude" : "viniper";
  setViewMode(sessionMode);
  state.sessionId = sessionId;
  state.sessionMode = sessionMode;
  state.viewMode = sessionMode;
  activateContextCompressionState(sessionId);
  state.contextRevision = data.revision || `${data.updated || ""}:${data.message_count || 0}`;
  state.contextUsage = normalizeContextUsage(data.context_usage);
  state.contextUsageBySession[state.sessionId] = state.contextUsage;
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
  void loadPlanSnapshot(sessionId);
  void loadGoalSnapshot(sessionId);
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
    if (activeRunSnapshot && !SessionTransportRegistry.get(sessionId)) {
      void resumeAgentRun(sessionId, activeRunSnapshot);
    }
  }
  SessionScrollRegistry.finishProjection(sessionId, scrollProjectionToken);
  saveActiveModeState(sessionMode);
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
  const nextMode = mode === "claude" ? "claude" : "viniper";
  closeSkillsView({ restoreNavigation: false });
  closeSettingsModal({ restoreNavigation: false });
  bumpModeGeneration(state.viewMode);
  setViewMode(nextMode);
  bumpModeGeneration(nextMode);
  const token = modeProjectionToken(nextMode, state.sessionId);
  await loadStatus(nextMode, token);
  if (!modeProjectionIsCurrent(token)) return false;
  await loadSessionList();
  setNavigationLocation(state.sessionId
    ? { kind: "session", mode: nextMode, sessionId: state.sessionId }
    : { kind: "mode-home", mode: nextMode }, { push: history });
  if (!quiet) $("#user-input")?.focus();
  return true;
}

async function enterModeLanding(mode, { history = true } = {}) {
  const nextMode = mode === "claude" ? "claude" : "viniper";
  ++state.sessionSwitchGeneration;
  state.sessionSwitchPending = false;
  resetCurrentSessionRuntimeUi();
  clearContextCompressionTimer();
  setViewMode(nextMode);
  state.sessionId = null;
  state.sessionMode = nextMode;
  state.sessionName = "";
  state.workdir = "";
  state.sessionPinned = false;
  state.sessionUnread = false;
  state.sessionRuntimeState = "idle";
  state.contextRevision = "";
  state.contextUsage = normalizeContextUsage(null);
  state.messages = [];
  state.activityEvents = [];
  state.plan = { sessionId: "", steps: [], current: 0, total: 0 };
  clearContextFiles();
  renderPlanDock(state.plan);
  renderGoalDock({ available: true, goals: [] });
  renderCurrentSession();
  renderWelcome();
  renderPermissionSelect();
  syncCurrentSessionRuntimeUi();
  modeOwnedState(nextMode).draft = "";
  saveActiveModeState(nextMode);
  await loadSessionList();
  setNavigationLocation({ kind: "mode-home", mode: nextMode }, { push: history });
  return true;
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
  const emptyConversation = state.viewMode === "viniper" && state.messages.length === 0;
  $("#conversation-container")?.classList.toggle("conversation-empty-state", emptyConversation);
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
  const container = $("#conversation-container");
  const article = Array.from(messages?.children || []).filter((node) => node?.classList?.contains("message"))[index];
  const tick = rail?.querySelector?.(`[data-trace-index="${Number(index)}"]`);
  if (!rail || !preview || !titleNode || !summaryNode || !container || !article || !tick || state.sessionMode !== "claude") return false;
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
  const container = $("#conversation-container");
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
  const titleRect = $("#session-title")?.getBoundingClientRect?.();
  const fallbackLeft = messagesRect.left - mainRect.left - 22;
  // Align the tick's left edge (the tick has a 2px inset inside the rail) to
  // the visible Agent title's first glyph.  This keeps the trace axis stable
  // when the sidebar is resized/collapsed and avoids drifting toward the
  // variable-width message column.  Conversation/empty states retain a safe fallback.
  const titleAxisLeft = titleRect && titleRect.width > 0
    ? titleRect.left - mainRect.left - 2
    : fallbackLeft;
  const left = Math.max(4, Math.round(titleAxisLeft));
  rail.dataset.axisSource = titleRect && titleRect.width > 0 ? "agent-title" : "message-column-fallback";
  rail.style.setProperty("--message-trace-top", `${top}px`);
  rail.style.setProperty("--message-trace-bottom", `${bottom}px`);
  rail.style.setProperty("--message-trace-left", `${left}px`);
  return true;
}

function updateMessageTraceRail() {
  const rail = $("#message-trace-rail");
  const track = $("#message-trace-track");
  const container = $("#conversation-container");
  const messages = $("#messages");
  if (!rail || !track || !container || !messages) return false;

  const articles = Array.from(messages.children || []).filter((node) => node?.classList?.contains("message"));
  const visible = state.sessionMode === "claude" && articles.length > 0;
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
        // to #conversation-container after the rail/composer grid is laid out.  Use
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
    mode: payload?.mode === "viniper" ? "viniper" : "claude",
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
    : source === "harness-runtime-local"
      ? "本机 Viniper Harness Runtime"
    : "本机 Token 记录";
}

function dailyUsageObservationBoundary(usage = state.dailyUsage) {
  const mode = usage?.mode === "viniper" || usage?.mode === "claude"
    ? usage.mode
    : dailyUsageModeKey();
  return mode === "viniper"
    ? "仅统计本机 Viniper Harness Runtime，不代表 Provider 账户额度。"
    : "仅统计本机 Claude Code stream-json，不代表官网额度。";
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
    return `<div class="daily-usage-status" role="status"><strong>正在读取本机 Token 记录…</strong><span>${escapeHtml(dailyUsageObservationBoundary(usage))}</span></div>
      <div class="daily-usage-heatmap daily-usage-loading" aria-hidden="true">${Array.from({ length: usage.rangeDays || 30 }, (_, index) => `<span style="--loading-index:${index}"></span>`).join("")}</div>`;
  }
  if (status === "error") {
    return `<div class="daily-usage-status daily-usage-error" role="status"><strong>本机 Token 用量暂不可用</strong><span>无法读取本地 stream-json 记录；不会用估算值或官网额度代替。</span><button type="button" data-usage-action="retry">重新读取</button></div>`;
  }
  const totals = usage.totals || normalizeDailyUsage({}).totals;
  const days = usage.days || [];
  const heatmap = renderDailyUsageHeatmap(days);
  const emptyGuidance = status === "empty"
    ? `<p class="daily-usage-empty-guidance">所选时段尚未记录到本机 Token。运行一次 ${usage.mode === "viniper" ? "Viniper" : "Claude code"} 任务后，这里会出现使用记录。</p>`
    : "";
  return `${dailyUsageMetrics(days, totals)}${heatmap}${emptyGuidance}
    <p class="daily-usage-source">来源：${escapeHtml(dailyUsageSourceLabel(usage.source))} · ${escapeHtml(dailyUsageTimezoneLabel(usage.timezone))} · 这是本机观测，不是官网账户额度</p>`;
}

function dailyUsagePanelMarkup(usage = state.dailyUsage) {
  const rangeDays = usage.rangeDays === 7 ? 7 : 30;
  const disabled = usage.status === "loading" ? " disabled" : "";
  return `<header class="daily-usage-heading"><div><p>Overview · 本机观测</p><h1 id="daily-usage-overview-title">本机 Token 用量</h1></div><div class="daily-usage-ranges" role="group" aria-label="用量时间范围"><button type="button" data-usage-range="30" aria-pressed="${rangeDays === 30 ? "true" : "false"}"${disabled}>30天</button><button type="button" data-usage-range="7" aria-pressed="${rangeDays === 7 ? "true" : "false"}"${disabled}>7天</button></div></header><div class="daily-usage-content">${dailyUsagePanelContent(usage)}</div>`;
}

function renderDailyUsagePanel() {
  const panel = $("#daily-usage-overview");
  if (!panel) return false;
  activateDailyUsageMode();
  panel.dataset.usageStatus = state.dailyUsage.status || "idle";
  panel.innerHTML = dailyUsagePanelMarkup(state.dailyUsage);
  return true;
}

async function refreshDailyUsage({ force = false, reason = "manual" } = {}) {
  const mode = dailyUsageModeKey();
  const usage = activateDailyUsageMode(mode);
  const activeRequest = dailyUsageRequestForMode(mode);
  if (activeRequest) return activeRequest;
  const requestedDays = usage.rangeDays === 7 ? 7 : 30;
  const fresh = usage.lastFetchedAt && (Date.now() - usage.lastFetchedAt < 10000);
  if (!force && fresh && usage.loadedRangeDays === requestedDays && ["ready", "empty"].includes(usage.status)) {
    renderDailyUsagePanel();
    return usage;
  }
  setDailyUsageForMode(mode, { ...usage, status: "loading", rangeDays: requestedDays, error: "" });
  renderDailyUsagePanel();
  const request = (async () => {
    try {
      const response = await fetch(`/api/usage/daily?days=${requestedDays}&mode=${encodeURIComponent(mode)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.detail || `HTTP ${response.status}`);
      const normalized = normalizeDailyUsage(payload);
      setDailyUsageForMode(mode, {
        ...normalized,
        rangeDays: requestedDays,
        loadedRangeDays: requestedDays,
        lastFetchedAt: Date.now(),
        emptyRefreshKey: usage.emptyRefreshKey,
        refreshReason: reason
      });
      return state.dailyUsageByMode[mode];
    } catch (error) {
      const failed = {
        ...normalizeDailyUsage({}),
        status: "error",
        mode,
        rangeDays: requestedDays,
        loadedRangeDays: 0,
        lastFetchedAt: 0,
        emptyRefreshKey: usage.emptyRefreshKey,
        error: String(error?.message || error || "暂不可用"),
        refreshReason: reason
      };
      setDailyUsageForMode(mode, failed);
      return failed;
    } finally {
      setDailyUsageRequestForMode(mode, null);
      renderDailyUsagePanel();
    }
  })();
  setDailyUsageRequestForMode(mode, request);
  return request;
}

async function selectDailyUsageRange(days) {
  const next = Number(days) === 7 ? 7 : 30;
  const mode = dailyUsageModeKey();
  const usage = activateDailyUsageMode(mode);
  const activeRequest = dailyUsageRequestForMode(mode);
  if (activeRequest) return activeRequest;
  if (usage.rangeDays === next && usage.loadedRangeDays === next && ["ready", "empty"].includes(usage.status)) {
    return usage;
  }
  setDailyUsageForMode(mode, { ...usage, rangeDays: next, emptyRefreshKey: "" });
  renderDailyUsagePanel();
  return refreshDailyUsage({ force: true, reason: `range-${next}` });
}

function refreshDailyUsageForEmptyMode() {
  if (state.messages.length) return;
  const mode = dailyUsageModeKey();
  const usage = activateDailyUsageMode(mode);
  const key = `${mode}:${String(state.sessionId || "startup")}:${usage.rangeDays === 7 ? 7 : 30}`;
  if (usage.emptyRefreshKey === key) return;
  usage.emptyRefreshKey = key;
  if (dailyUsageRequestForMode(mode)) return;
  const selectedRange = usage.rangeDays === 7 ? 7 : 30;
  const fresh = usage.loadedRangeDays === selectedRange
    && usage.lastFetchedAt
    && (Date.now() - usage.lastFetchedAt < 10000);
  if (!fresh) void refreshDailyUsage({ reason: "mode-empty" });
}

const refreshDailyUsageForEmptyAgent = refreshDailyUsageForEmptyMode;

function renderWelcome() {
  activateDailyUsageMode();
  $("#messages").innerHTML =
    `<div class="welcome token-overview-welcome"><section id="daily-usage-overview" class="daily-usage-overview" data-usage-mode="${dailyUsageModeKey()}" data-usage-status="${escapeAttr(state.dailyUsage.status || "idle")}" aria-labelledby="daily-usage-overview-title">${dailyUsagePanelMarkup(state.dailyUsage)}</section><span class="sr-only">${dailyUsageModeKey() === "claude" ? "Claude code" : "Viniper"} 空会话 Token 概览</span></div>`;
  refreshDailyUsageForEmptyMode();
  updateContextRail();
  updateMessageTraceRail();
}

function renderAllMessages() {
  if (!state.messages.length) {
    $("#conversation-container")?.classList.toggle("conversation-empty-state", state.viewMode === "viniper");
    renderWelcome();
    updateStoredThinkingTimer();
    updateContextRail();
    return;
  }

  $("#conversation-container")?.classList.remove("conversation-empty-state");
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
  $("#conversation-container")?.classList.remove("conversation-empty-state");

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
        turnUsage: meta?.turn_usage ?? meta?.turnUsage ?? meta?.usage
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
  return String(segment.name || segment.tool_name || segment.toolName || segment.tool || "").trim();
}

function activityDetail(segment = {}) {
  return String(segment.summary || segment.detail || segment.content || "").trim();
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
  const statusLabel = status === "error" ? "失败" : (status === "pending" ? "进行中" : "已完成");
  const toolId = summary.tool_id ? ` data-tool-id="${escapeAttr(summary.tool_id)}"` : "";
  const images = Array.isArray(result.images) ? result.images.map((image) => renderImageSegment(image, index, "tool-image")).join("") : "";
  return `<div class="tool-summary tool-summary-${status}" data-segment-index="${index}" data-activity="tool_summary" data-tool-status="${escapeAttr(rawStatus)}"${toolId} aria-label="${escapeAttr(`${name}：${rawStatus}`)}">
    ${activityIconSvg(name, "tool-summary-icon")}
    <span class="tool-status-dot" aria-hidden="true"></span>
    <span class="tool-summary-name">${escapeHtml(name)}</span>
    <span class="tool-summary-status-label">${statusLabel}</span>
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
  const operation = fileOperationFromSegment(segment);
  return `<div class="artifact-summary" data-segment-index="${index}" data-activity="artifact" aria-label="文件：${escapeAttr(name)}">
    ${activityIconSvg("文件", "artifact-summary-icon")}
    <span class="artifact-summary-path" title="${escapeAttr(path)}">${escapeHtml(name)}</span>
    <span class="artifact-inline-status" aria-live="polite"></span>
    ${path ? `<span class="artifact-inline-actions"><button class="artifact-inline-button" type="button" data-file-action="open" data-file-path="${escapeAttr(path)}">打开</button><button class="artifact-inline-button" type="button" data-file-action="reveal" data-file-path="${escapeAttr(path)}">位置</button></span>` : ""}
  </div>${operation ? renderFileOperationCard(operation, index) : ""}${image ? `<div class="message-image-gallery artifact-image-gallery">${image}</div>` : ""}`;
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

function renderInlinePlanTimeline(segment = {}, index = 0) {
  const plan = normalizePlanSnapshot(segment.plan && typeof segment.plan === "object"
    ? { ...segment.plan, session_id: segment.session_id || state.sessionId }
    : segment);
  if (!plan.steps.length) return "";
  const completed = plan.steps.filter((step) => step.status === "completed").length;
  const resolved = plan.steps.filter((step) => ["completed", "skipped", "failed"].includes(step.status)).length;
  const pending = plan.total - resolved;
  const current = plan.current || Math.min(completed + 1, plan.total);
  return `<details class="inline-plan-timeline" data-segment-index="${index}" open>
    <summary><span>规划步骤</span><strong>第 ${current} / ${plan.total} 步</strong></summary>
    <ol class="plan-step-list">${plan.steps.map((step) => `
      <li class="plan-step plan-step-${escapeAttr(step.status)}">
        <span class="plan-step-state" aria-hidden="true">${step.status === "completed" ? "✓" : ""}</span>
        <span class="plan-step-title">${escapeHtml(step.title)}</span>
      </li>`).join("")}</ol>
    <footer><span>${completed} 项已完成</span><span>${pending} 项待处理${plan.terminalStatus ? ` · ${escapeHtml(plan.terminalStatus)}` : ""}</span></footer>
  </details>`;
}

function renderInlineTurnDiff(segment = {}, index = 0) {
  const diff = segment.turn_diff && typeof segment.turn_diff === "object" ? segment.turn_diff : segment;
  const files = Array.isArray(diff.files) ? diff.files : [];
  const additions = files.reduce((sum, file) => sum + Math.max(0, Number(file?.additions) || 0), 0);
  const deletions = files.reduce((sum, file) => sum + Math.max(0, Number(file?.deletions) || 0), 0);
  const patch = String(diff.patch || "").slice(0, 120000);
  const lines = patch ? patch.split("\n") : [];
  const summary = String(diff.summary || `${files.length} 个文件已更改`);
  return `<details class="inline-turn-diff" data-segment-index="${index}">
    <summary><span>代码变更</span><strong>${escapeHtml(summary)}</strong><span class="file-change-stats"><b>+${additions}</b><i>-${deletions}</i></span></summary>
    ${files.length ? `<ul class="inline-turn-diff-files">${files.map((file) => `<li><code>${escapeHtml(String(file?.path || ""))}</code><span class="file-change-stats"><b>+${Math.max(0, Number(file?.additions) || 0)}</b><i>-${Math.max(0, Number(file?.deletions) || 0)}</i></span></li>`).join("")}</ul>` : ""}
    ${lines.length ? `<pre class="file-diff"><code>${lines.map((line, lineIndex) => `<span class="diff-line ${line.startsWith("+") && !line.startsWith("+++") ? "added" : (line.startsWith("-") && !line.startsWith("---") ? "removed" : "")}"><b>${lineIndex + 1}</b>${escapeHtml(line)}</span>`).join("")}</code></pre>` : ""}
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
    if (segment?.type === "thinking" && options.hideThinking && !String(segment.content || "").trim() && !(Array.isArray(segment.images) && segment.images.length)) return "";
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
    if (segment?.type === "plan_timeline") {
      return renderInlinePlanTimeline(segment, index);
    }
    if (segment?.type === "turn_diff") {
      return renderInlineTurnDiff(segment, index);
    }
    const type = segment?.type === "thinking" ? "thinking" : "text";
    const content = repairTextForDisplay(segment?.content || "");
    const thinkingImages = type === "thinking" && Array.isArray(segment?.images) ? segment.images : [];
    if (!content.trim() && !thinkingImages.length && !(type === "thinking" && (segment?.activeThinking || segment?.showEmpty))) return "";
    const segmentElapsed = Number(segment?.elapsed_seconds ?? segment?.elapsedSeconds);
    const segmentOptions = {
      ...options,
      segmentIndex: index,
      activeThinking: Boolean(!options.hideThinking && (segment.activeThinking || (options.activeThinking && index === activeThinkingIndex))),
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
  if (!payload || typeof payload !== "object") return null;
  const payloadType = String(payload.type || "");
  if (!["interaction_request", "permission_request", "question_request"].includes(payloadType)) return null;
  const requestId = String(payload.request_id || "").trim();
  if (!requestId) return null;
  const kind = payload.kind === "permission" || payloadType === "permission_request"
    ? "permission"
    : (payload.kind === "question" || payloadType === "question_request" ? "question" : "");
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
    owner: String(payload.owner || (payload.mode === "viniper" ? "viniper" : "claude-code")),
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
  const runAttr = card.run_id ? ` data-interaction-run-id="${escapeAttr(card.run_id)}"` : "";
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
    return `<section class="inline-interaction-card inline-permission-card" data-interaction-kind="permission" data-segment-index="${index}"${idAttr}${sessionAttr}${runAttr}${stateAttr}${interactionPayloadAttr(card)} aria-label="权限确认" tabindex="0">
      <div class="inline-interaction-head"><span class="inline-interaction-kicker">${card.owner === "viniper" ? "Viniper Harness 需要你的输入才能继续" : "Claude 需要你的输入才能继续"}</span><strong>允许 ${card.owner === "viniper" ? "Viniper" : "Claude"} 使用 ${escapeHtml(tool)}？</strong></div>
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
  return `<section class="inline-interaction-card inline-question-card" data-interaction-kind="question" data-segment-index="${index}" data-question-index="0"${idAttr}${sessionAttr}${runAttr}${questionStateAttr}${interactionPayloadAttr(questionCard)} aria-label="问题确认" tabindex="0">
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
  const visible = id === String(state.sessionId || "");
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
      const response = await fetch(`/api/runs/${encodeURIComponent(id)}/queue/${encodeURIComponent(itemId)}`, {
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
      const response = await fetch(`/api/runs/${encodeURIComponent(id)}/queue/${encodeURIComponent(itemId)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        $("#status-line").textContent = `队列移除失败：${data.detail || response.status}`;
        return;
      }
      SessionQueueRegistry.remove(id, itemId);
    });
  });
}

async function refreshAgentQueue(sessionId = state.sessionId, token = modeProjectionToken(state.viewMode, sessionId)) {
  const id = String(sessionId || "");
  if (!id) {
    SessionQueueRegistry.set(id, []);
    return [];
  }
  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(id)}/queue`);
    const data = await response.json().catch(() => ({}));
    if (!modeProjectionIsCurrent(token)) return SessionQueueRegistry.get(id);
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
    const response = await fetch(`/api/runs/${encodeURIComponent(sessionId)}/interaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: requestId, run_id: String(card?.dataset.interactionRunId || card?.__interactionRequest?.run_id || ""), kind, action, answers })
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

const runRenderScheduler = AgentStream.createRenderScheduler();

function scheduleRunRender(sessionId) {
  const record = SessionRunRegistry.get(sessionId);
  runRenderScheduler.schedule(sessionId, () => {
    if (SessionRunRegistry.get(sessionId) === record) renderSessionRun(sessionId);
  });
}

function createStreamRenderer(sessionId) {
  const id = String(sessionId || "");
  ensureRunTimer(id);
  const sync = () => scheduleRunRender(id);
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
      runRenderScheduler.flush(id);
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
    scheduleRunRender(id);
    syncCurrentSessionRuntimeUi();
  }
  return true;
}

async function consumeAgentRunResponse(response, record, transport, project) {
  const runId = String(response.headers?.get("X-Viniper-Run-Id") || record.runId || "");
  if (runId) record.runId = runId;
  await AgentStream.readJsonEvents(response.body, (payload) => {
    if (payload.type === "replay_gap") {
      const error = new Error("运行事件已超出回放窗口，正在重新读取会话");
      error.code = "REPLAY_GAP";
      throw error;
    }
    project(payload);
  }, (reader) => { transport.reader = reader; });
  const outcome = await AgentStream.confirmRunState(fetch, record.sessionId, record.runId);
  if (outcome.kind !== "terminal") throw new Error("运行连接已结束，正在核实后台任务");
  record.status = outcome.run.status;
  record.cancelRequested = outcome.run.cancel_requested;
}

function reconnectAgentRun(sessionId, record, transport) {
  if (SessionRunRegistry.get(sessionId) !== record || record.cancelRequested || !record.runId) return false;
  if (SessionTransportRegistry.get(sessionId) === transport) SessionTransportRegistry.finish(sessionId);
  record.active = true;
  record.completed = false;
  record.workingLabel = "正在恢复运行连接…";
  record.reconnectAttempts = (record.reconnectAttempts || 0) + 1;
  if (String(state.sessionId) === sessionId) syncCurrentSessionRuntimeUi();
  window.setTimeout(() => {
    if (SessionRunRegistry.get(sessionId) === record && record.active && !SessionTransportRegistry.get(sessionId)) {
      void resumeAgentRun(sessionId, { run_id: record.runId });
    }
  }, Math.min(10000, 1000 * 2 ** Math.min(4, record.reconnectAttempts - 1)));
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
  let replaced = false;
  try {
    const current = await AgentStream.confirmRunState(fetch, id, runId);
    if (current.kind === "replaced") { replaced = true; return false; }
    const after = Math.max(0, Number(record.serverSequence) || 0);
    const response = await fetch(`/api/runs/${encodeURIComponent(id)}/events?run_id=${encodeURIComponent(runId)}&after_sequence=${after}`, {
      signal: abortController.signal,
    });
    if (!response.ok || !response.body) throw new Error(`恢复运行流失败: ${response.status}`);
    await consumeAgentRunResponse(response, record, transport, (payload) => projectCoordinatedRunEvent(id, payload));
    terminal = true;
  } catch (error) {
    if (error.code === "REPLAY_GAP") replaced = true;
    if (error.name !== "AbortError" && String(state.sessionId) === id) {
      $("#status-line").textContent = "运行仍在后台，正在恢复界面连接…";
    }
  } finally {
    if (SessionTransportRegistry.get(id) === transport) SessionTransportRegistry.finish(id);
    if ((terminal || replaced) && SessionRunRegistry.get(id) === record) {
      SessionRunRegistry.finish(id, replaced ? "idle" : record.status);
      runRenderScheduler.flush(id);
      if (String(state.sessionId) === id) {
        clearInteractionDock();
        try { await switchSession(id, { quiet: true, history: false }); } catch {}
      } else {
        await loadSessionList();
      }
    } else if (!terminal) {
      if (record.cancelRequested) {
        SessionRunRegistry.finish(id, "cancelled");
        if (String(state.sessionId) === id) syncCurrentSessionRuntimeUi();
      } else {
        reconnectAgentRun(id, record, transport);
      }
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

function normalizePlanSnapshot(value = {}) {
  const planStatuses = ["completed", "in_progress", "pending", "skipped", "failed", "blocked"];
  const steps = Array.isArray(value.steps) ? value.steps.map((step, index) => ({
    id: String(step?.id || `step-${index + 1}`),
    title: String(step?.title || "未命名步骤"),
    status: planStatuses.includes(step?.status) ? step.status : "pending",
  })) : [];
  return {
    sessionId: String(value.session_id || state.sessionId || ""),
    steps,
    current: Math.max(0, Number(value.current) || 0),
    total: steps.length,
    terminalStatus: String(value.terminal_status || ""),
  };
}

function renderPlanDock(snapshot = state.plan) {
  const dock = $("#plan-dock");
  if (!dock) return;
  const plan = normalizePlanSnapshot(snapshot);
  state.plan = plan;
  const visible = plan.sessionId === String(state.sessionId || "") && plan.steps.length > 0;
  dock.classList.toggle("hidden", !visible);
  if (!visible) {
    dock.innerHTML = "";
    return;
  }
  const completed = plan.steps.filter((step) => step.status === "completed").length;
  const resolved = plan.steps.filter((step) => ["completed", "skipped", "failed"].includes(step.status)).length;
  const pending = plan.total - resolved;
  const current = plan.current || Math.min(completed + 1, plan.total);
  dock.innerHTML = `
    <details class="plan-card" open>
      <summary><span>规划步骤</span><strong>第 ${current} / ${plan.total} 步</strong></summary>
      <ol class="plan-step-list">
        ${plan.steps.map((step) => `
          <li class="plan-step plan-step-${escapeAttr(step.status)}" data-plan-step-id="${escapeAttr(step.id)}">
            <span class="plan-step-state" aria-hidden="true">${step.status === "completed" ? "✓" : ""}</span>
            <span class="plan-step-title">${escapeHtml(step.title)}</span>
            <span class="sr-only">${step.status}</span>
          </li>
        `).join("")}
      </ol>
      <footer><span>${completed} 项已完成</span><span>${pending} 项待处理${plan.terminalStatus ? ` · ${escapeHtml(plan.terminalStatus)}` : ""}</span></footer>
    </details>`;
}

async function loadPlanSnapshot(sessionId = state.sessionId, token = modeProjectionToken(state.viewMode, sessionId)) {
  const sid = String(sessionId || "");
  if (!sid) return renderPlanDock({ session_id: "", steps: [] });
  try {
    const response = await fetch(`/api/plans?session_id=${encodeURIComponent(sid)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.detail || `HTTP ${response.status}`);
    if (modeProjectionIsCurrent(token)) renderPlanDock(data);
    return data;
  } catch {
    if (modeProjectionIsCurrent(token)) renderPlanDock({ session_id: sid, steps: [] });
    return null;
  }
}

function renderGoalDock(payload = {}) {
  const dock = $("#goal-dock");
  if (!dock) return;
  if (state.viewMode === "claude") {
    dock.classList.add("hidden");
    dock.innerHTML = "";
    return;
  }
  const goals = Array.isArray(payload.goals) ? payload.goals : [];
  const goal = goals[0] || payload.goal || null;
  const available = payload.available !== false;
  const visible = available && Boolean(goal);
  dock.classList.toggle("hidden", !visible);
  if (!visible) {
    dock.innerHTML = "";
    return;
  }
  const status = String(goal.status || "blocked");
  const current = Math.max(0, Number(goal.progress?.current) || 0);
  const total = Math.max(current, Number(goal.progress?.total) || 0);
  const tokens = Math.max(0, Number(goal.token_usage?.used_tokens) || 0);
  const elapsed = Math.max(0, Number(goal.elapsed_seconds) || 0);
  dock.innerHTML = `<section class="goal-card" data-goal-status="${escapeAttr(status)}" data-goal-id="${escapeAttr(goal.id)}">
    <header><strong>${escapeHtml(goal.title || "目标")}</strong><span>${escapeHtml(status)}</span></header>
    <p>${escapeHtml(goal.prompt || goal.current_step || "")}</p>
    <div class="goal-progress"><span style="--goal-progress:${total ? Math.min(1, current / total) : 0}"></span></div>
    <footer><span>${current} / ${total}</span><span>${formatCompactTokenCount(tokens)} Token · ${formatDuration(elapsed)}</span><div class="goal-actions"><button type="button" data-goal-action="stop">停止</button><button type="button" data-goal-action="continue">继续</button><button type="button" data-goal-action="delete" aria-label="删除目标">删除</button></div></footer>
  </section>`;
  dock.querySelectorAll("[data-goal-action]").forEach((button) => button.addEventListener("click", async () => {
    if (button.disabled) return;
    const action = String(button.dataset.goalAction || "");
    const buttons = Array.from(dock.querySelectorAll("[data-goal-action]"));
    buttons.forEach((item) => { item.disabled = true; });
    dock.querySelector(".goal-card")?.setAttribute("aria-busy", "true");
    try {
      const deleting = action === "delete";
      const response = await fetch(`/api/goals/${encodeURIComponent(goal.id)}`, deleting
        ? { method: "DELETE" }
        : { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        showInlineStatus(data.detail || (deleting ? "Goal 删除失败，数据已保留" : "Goal 操作失败"), { kind: "error" });
        return;
      }
      if (deleting) {
        renderGoalDock({ available: true, goals: [] });
        showInlineStatus("Goal 已删除", { kind: "success" });
        return;
      }
      renderGoalDock({ available: true, goals: [data.goal] });
    } catch {
      showInlineStatus(action === "delete" ? "Goal 删除失败，数据已保留" : "Goal 操作失败", { kind: "error" });
    } finally {
      if (!dock.classList.contains("hidden")) {
        dock.querySelector(".goal-card")?.removeAttribute("aria-busy");
        dock.querySelectorAll("[data-goal-action]").forEach((item) => { item.disabled = false; });
      }
    }
  }));
}

async function loadGoalSnapshot(sessionId = state.sessionId, token = modeProjectionToken(state.viewMode, sessionId)) {
  const sid = String(sessionId || "");
  if (token.mode === "claude") {
    if (modeProjectionIsCurrent(token)) renderGoalDock({ available: true, goals: [] });
    return { ok: true, available: false, owner: "claude-code-cli", goals: [] };
  }
  const response = await fetch(`/api/goals?mode=viniper&session_id=${encodeURIComponent(sid)}`);
  const data = await response.json().catch(() => ({}));
  if (modeProjectionIsCurrent(token)) renderGoalDock(response.ok ? data : { available: true, goals: [] });
  return data;
}

function fileOperationFromSegment(segment = {}) {
  const change = segment.file_change && typeof segment.file_change === "object" ? segment.file_change : null;
  if (!change) return null;
  return {
    path: String(change.path || ""),
    operation: String(change.operation || "modified"),
    additions: Math.max(0, Number(change.additions) || 0),
    deletions: Math.max(0, Number(change.deletions) || 0),
    diff: String(change.diff || ""),
    available: Boolean(change.available && change.diff),
  };
}

function renderFileOperationCard(change, index = 0) {
  const filename = artifactName(change.path) || "文件";
  const label = change.operation === "created" ? "文件已创建" : (change.operation === "deleted" ? "文件已删除" : "文件已修改");
  const lines = change.available ? change.diff.split("\n") : [];
  return `<details class="file-operation-card" data-file-operation="${escapeAttr(change.operation)}" data-segment-index="${index}">
    <summary><span>${escapeHtml(label)}</span><strong title="${escapeAttr(change.path)}">${escapeHtml(filename)}</strong><span class="file-change-stats"><b>+${change.additions}</b><i>-${change.deletions}</i></span></summary>
    ${change.available ? `<div class="file-diff-toolbar"><code>${escapeHtml(change.path)}</code><button type="button" data-copy="${escapeAttr(change.diff)}">复制</button></div><pre class="file-diff"><code>${lines.map((line, lineIndex) => `<span class="diff-line ${line.startsWith("+") && !line.startsWith("+++") ? "added" : (line.startsWith("-") && !line.startsWith("---") ? "removed" : "")}"><b>${lineIndex + 1}</b>${escapeHtml(line)}</span>`).join("")}</code></pre>` : `<p class="file-diff-unavailable">本次工具事件没有提供可验证的 before/after 数据，具体 diff 不可用。</p>`}
  </details>`;
}

function currentFileOperations() {
  return state.messages.flatMap((message) => Array.isArray(message?.segments) ? message.segments : [])
    .map(fileOperationFromSegment)
    .filter(Boolean);
}

function harnessStatusText(status) {
  if (status === "verified") return "已验证";
  if (status === "connected") return "已连接";
  if (status === "configured" || status === "ready") return "已配置";
  if (status === "external-prerequisite") return "需外部条件";
  if (status === "not-configured") return "未配置";
  return status === "available" ? "可用" : "不可用";
}

async function loadHarnessSnapshot({ render = true } = {}) {
  if (state.viewMode !== "viniper") return null;
  const token = modeProjectionToken("viniper", state.sessionId);
  try {
    const response = await fetch(`/api/harness/snapshot?mode=viniper&session_id=${encodeURIComponent(state.sessionId || "")}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!modeProjectionIsCurrent(token)) return data;
    state.harnessSnapshot = data;
    if (render) renderHarnessSettings();
    return data;
  } catch (error) {
    if (!modeProjectionIsCurrent(token)) return null;
    state.harnessSnapshot = { ok: true, status: "unavailable", reason: error.message || "Harness 能力快照不可用" };
    if (render) renderHarnessSettings();
    return state.harnessSnapshot;
  }
}

async function loadHarnessCapabilities({ sessionId = state.sessionId || "", render = false } = {}) {
  if (state.viewMode !== "viniper") {
    return null;
  }
  const token = modeProjectionToken("viniper", sessionId);
  try {
    const response = await fetch(`/api/capabilities?mode=viniper&session_id=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!modeProjectionIsCurrent(token)) return data;
    state.capabilities = response.ok && data.ok !== false
      ? data
      : { ok: false, mode: "viniper", status: "unavailable", reason: data.reason || data.detail || `HTTP ${response.status}` };
  } catch (error) {
    if (!modeProjectionIsCurrent(token)) return null;
    state.capabilities = { ok: false, mode: "viniper", status: "unavailable", reason: error.message || "Harness 能力状态读取失败" };
  }
  if (render) renderHarnessCapabilityStatus();
  return state.capabilities;
}

async function loadHarnessConfigurationMatrix({ render = false } = {}) {
  if (state.viewMode !== "viniper") {
    return null;
  }
  const token = modeProjectionToken("viniper", state.sessionId);
  try {
    const response = await fetch("/api/configuration-matrix?mode=viniper", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!modeProjectionIsCurrent(token)) return data;
    state.configurationMatrix = response.ok && data.ok !== false
      ? data
      : { ok: false, mode: "viniper", items: [], reason: data.reason || data.detail || `HTTP ${response.status}` };
  } catch (error) {
    if (!modeProjectionIsCurrent(token)) return null;
    state.configurationMatrix = { ok: false, mode: "viniper", items: [], reason: error.message || "Harness 配置状态读取失败" };
  }
  if (render) renderHarnessCapabilityStatus();
  return state.configurationMatrix;
}

async function harnessAction(target, args = {}) {
  if (state.viewMode !== "viniper") throw new Error("该操作仅属于 Viniper Harness");
  const response = await fetch("/api/harness/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "viniper", session_id: state.sessionId || "", target, args }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.detail || data.reason || "Harness 操作不可用");
  state.harnessSnapshot = await loadHarnessSnapshot({ render: false }) || state.harnessSnapshot;
  state.configurationMatrix = await loadHarnessConfigurationMatrix({ render: false }) || state.configurationMatrix;
  return data.data || data;
}

function harnessConfigurationStatus(id, fallback = "unavailable") {
  const item = (state.configurationMatrix?.items || []).find((entry) => entry?.id === id);
  if (!item) return { status: fallback || "unavailable", reason: "" };
  if (item.verified) return { status: "verified", reason: "" };
  if (item.connected) return { status: "connected", reason: "" };
  if (item.configured) return { status: "configured", reason: "" };
  if (item.external_prerequisite) return { status: "external-prerequisite", reason: String(item.external_prerequisite) };
  return { status: item.implemented ? "not-configured" : "unavailable", reason: "" };
}

function harnessFeatureRecords() {
  const features = state.capabilities?.features || {};
  const projectIndex = harnessConfigurationStatus("project-index", features.project_index?.status);
  const lsp = harnessConfigurationStatus("typescript-javascript-semantics", features.lsp?.status);
  const localModels = harnessConfigurationStatus("local-model-registry", features.local_models?.status);
  const extensions = harnessConfigurationStatus("builtin-coordination-plugin", features.extensions?.status);
  const mcp = harnessConfigurationStatus("workstation-loopback-mcp", features.mcp?.status);
  const provider = harnessConfigurationStatus("viniper-provider", features.provider_settings?.status);
  return [
    ["协作与委派", state.capabilities?.collaboration?.status, "", "协作"],
    ["子 Agent", state.capabilities?.subagents?.status, "", "子 Agent"],
    ["项目索引", projectIndex.status, projectIndex.reason, "项目索引"],
    ["LSP 导航", lsp.status, lsp.reason, "LSP"],
    ["本地模型", localModels.status, localModels.reason, "本地模型"],
    ["扩展", extensions.status, extensions.reason, "扩展"],
    ["MCP", mcp.status, mcp.reason, "MCP"],
    ["Review", features.review?.status, "", "Review"],
    ["能力组合", features.composition?.status, "", "组合"],
    ["Provider 适配", provider.status, provider.reason, "Provider"],
  ];
}

function renderHarnessCapabilityStatus() {
  const host = $("#harness-capability-status");
  if (!host) return;
  const records = harnessFeatureRecords();
  const capabilities = state.capabilities || {};
  const failures = [
    capabilities.ok === false || capabilities.status === "unavailable" ? `Harness 能力状态读取失败：${capabilities.reason || "接口不可用"}` : "",
    state.configurationMatrix?.ok === false ? `Harness 配置状态读取失败：${state.configurationMatrix.reason || "接口不可用"}` : "",
  ].filter(Boolean);
  const error = failures.map((message) => `<p class="workspace-unavailable">${escapeHtml(message)}</p>`).join("");
  host.innerHTML = `${error}${records.map(([label, status, reason]) => `<div class="capability-status-item"><span>${escapeHtml(label)}</span><strong data-status="${escapeAttr(status || "unavailable")}"${reason ? ` title="${escapeAttr(reason)}"` : ""}>${escapeHtml(harnessStatusText(status))}</strong></div>`).join("") || `<p class="workspace-unavailable">正在读取 Harness 能力…</p>`}`;
}

function renderHarnessLocalModels(snapshot = {}) {
  const host = $("#harness-settings-local-models");
  if (!host) return;
  const records = Array.isArray(snapshot.local_models?.records) ? snapshot.local_models.records : [];
  const runnerStatus = snapshot.local_models?.runner_status || {};
  const runnerNotice = runnerStatus.available === false
    ? `<p class="workspace-unavailable">${escapeHtml(runnerStatus.reason || "未检测到可用的本地模型 runner。")}</p>`
    : "";
  const rows = records.map((record) => {
    const versions = Array.isArray(record.versions) ? record.versions : [];
    const nextVersion = versions.find((version) => version.id && version.id !== record.activeVersionId && version.id !== record.pendingVersionId)?.id || "";
    return `<article class="harness-record"><div><strong>${escapeHtml(record.label || record.id)}</strong><small>${escapeHtml(record.id || "")}</small></div><span data-status="${escapeAttr(record.status || "unknown")}">${escapeHtml(record.status || "未知")}</span><div class="harness-record-actions">${record.pendingVersionId ? `<button type="button" class="ghost-button" data-local-model-action="confirm" data-local-model-id="${escapeAttr(record.id)}" data-local-model-version="${escapeAttr(record.pendingVersionId)}">采用版本</button><button type="button" class="ghost-button" data-local-model-action="apply" data-local-model-id="${escapeAttr(record.id)}">应用更新</button>` : ""}${nextVersion ? `<button type="button" class="ghost-button" data-local-model-action="update" data-local-model-id="${escapeAttr(record.id)}" data-local-model-version="${escapeAttr(nextVersion)}">申请更新 ${escapeHtml(nextVersion)}</button>` : `<small class="subtle">无可用的新版本快照</small>`}</div></article>`;
  }).join("");
  host.innerHTML = `<div class="harness-panel-heading"><div><h4>本地模型注册表</h4><p>通过 Harness LocalModelService 管理；仅接受回环端点，更新只使用真实版本快照。</p></div><span>${records.length} 个</span></div>${runnerNotice}
    <div class="harness-record-list">${rows || `<p class="workspace-unavailable">尚未注册本地模型。</p>`}</div>
    <form id="local-model-form" class="harness-inline-form"><input name="id" required placeholder="模型 ID"><input name="label" required placeholder="显示名称"><input name="endpoint" placeholder="http://127.0.0.1:11434"><input name="version" required placeholder="真实版本"><button class="primary-button" type="submit">添加</button></form>`;
  host.querySelector("#local-model-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await harnessAction("local-models.register", { id: String(form.get("id") || "").trim(), label: String(form.get("label") || "").trim(), endpoint: String(form.get("endpoint") || "").trim(), version: String(form.get("version") || "").trim(), source: "user", format: "http", compatibility: "loopback", toolCapability: "none" });
      toast("本地模型已登记，等待采用", "success");
      await loadHarnessSnapshot();
    } catch (error) { toast(error.message || "本地模型登记失败", "error"); }
  });
  host.querySelectorAll("[data-local-model-action]").forEach((button) => button.addEventListener("click", async () => {
    try {
      const action = button.dataset.localModelAction;
      const id = button.dataset.localModelId || "";
      if (action === "confirm") await harnessAction("local-models.confirm", { id, version_id: button.dataset.localModelVersion || "" });
      if (action === "update") await harnessAction("local-models.update", { id, version_id: button.dataset.localModelVersion || "" });
      if (action === "apply") await harnessAction("local-models.apply-update", { id });
      await loadHarnessSnapshot();
    } catch (error) { toast(error.message || "本地模型操作失败", "error"); }
  }));
}

function renderHarnessExtensions(snapshot = {}) {
  const host = $("#harness-settings-extensions");
  if (!host) return;
  const ext = snapshot.extensions || {};
  const records = Array.isArray(ext.records) ? ext.records : [];
  const staged = Array.isArray(ext.staged) ? ext.staged : [];
  const mcp = Array.isArray(ext.mcpConnections) ? ext.mcpConnections : [];
  const recordRows = records.map((record) => {
    const stagedForRecord = staged.find((item) => item.manifest?.id === record.id);
    const pendingUpdate = record.pendingUpdate;
    const pendingRollback = Boolean(record.pendingRollback);
    return `<article class="harness-record"><div><strong>${escapeHtml(record.name || record.id)}</strong><small>${escapeHtml(record.kind || "extension")} · ${escapeHtml(record.current?.version || "未安装")}</small></div><span data-status="${escapeAttr(record.status || "unknown")}">${escapeHtml(record.status || "未知")}</span><div class="harness-record-actions">${record.trust === "trusted" ? `<span class="subtle">已信任</span>` : `<button type="button" class="ghost-button" data-extension-action="trust" data-extension-id="${escapeAttr(record.id)}" data-extension-version="${escapeAttr(record.current?.version || "")}">信任</button>`}<button type="button" class="ghost-button" data-extension-action="toggle" data-extension-id="${escapeAttr(record.id)}" data-extension-enabled="${record.enabled ? "1" : "0"}">${record.enabled ? "停用" : "启用"}</button>${stagedForRecord ? `<button type="button" class="ghost-button" data-extension-action="update" data-extension-id="${escapeAttr(record.id)}" data-extension-staging="${escapeAttr(stagedForRecord.stagingId)}">申请更新</button>` : ""}${pendingUpdate ? `<button type="button" class="ghost-button" data-extension-action="apply-update" data-extension-id="${escapeAttr(record.id)}">确认更新</button>` : ""}${record.previous ? `<button type="button" class="ghost-button" data-extension-action="rollback" data-extension-id="${escapeAttr(record.id)}">${pendingRollback ? "确认回滚" : "申请回滚"}</button>` : ""}</div></article>`;
  }).join("");
  const stagedRows = staged.map((item) => `<article class="harness-record"><div><strong>${escapeHtml(item.manifest?.name || item.manifest?.id || "暂存扩展")}</strong><small>${escapeHtml(item.manifest?.id || "")} · ${escapeHtml(item.manifest?.version || "")}</small></div><span data-status="staged">已暂存</span><div class="harness-record-actions"><button type="button" class="ghost-button" data-extension-staging-install="${escapeAttr(item.stagingId)}">安装</button></div></article>`).join("");
  host.innerHTML = `<div class="harness-panel-heading"><div><h4>扩展与 MCP</h4><p>扩展生命周期和 MCP 连接均由 Harness ExtensionManager 持有；没有后端实现的刷新不会伪造。</p></div></div>
    <div class="harness-record-list">${recordRows || `<p class="workspace-unavailable">尚未安装扩展。</p>`}${stagedRows}</div>
    <form id="extension-stage-form" class="harness-inline-form"><input name="location" required placeholder="扩展目录或本地包路径"><input name="source" value="user" placeholder="来源"><button class="primary-button" type="submit">暂存扩展</button></form>
    <div class="harness-subsection"><h5>MCP 连接</h5>${mcp.map((item) => `<div class="harness-mcp-row"><code>${escapeHtml(item.id)}</code><span data-status="${item.connected ? "connected" : (item.configured ? "ready" : "unavailable")}">${item.connected ? "已连接" : (item.configured ? "已配置" : "未配置")}</span>${item.connected ? `<button type="button" class="ghost-button" data-mcp-action="disconnect" data-mcp-id="${escapeAttr(item.id)}">断开</button>` : `<button type="button" class="ghost-button" data-mcp-action="connect" data-mcp-id="${escapeAttr(item.id)}">连接测试</button>`}<button type="button" class="ghost-button" data-mcp-action="refresh" data-mcp-id="${escapeAttr(item.id)}">刷新连接</button><button type="button" class="ghost-button" data-mcp-action="status" data-mcp-id="${escapeAttr(item.id)}">读取状态</button></div>`).join("") || `<p class="workspace-unavailable">尚未配置 MCP。</p>`}</div>
    <form id="mcp-form" class="harness-inline-form"><input name="id" required placeholder="MCP 名称"><input name="endpoint" required placeholder="http://127.0.0.1:port/mcp"><button class="primary-button" type="submit">保存 MCP</button></form>`;
  host.querySelector("#extension-stage-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try { await harnessAction("extensions.stage", { location: String(form.get("location") || "").trim(), source: String(form.get("source") || "user").trim() }); toast("扩展已暂存", "success"); await loadHarnessSnapshot(); }
    catch (error) { toast(error.message || "扩展暂存失败", "error"); }
  });
  host.querySelectorAll("[data-extension-staging-install]").forEach((button) => button.addEventListener("click", async () => {
    try { await harnessAction("extensions.install", { staging_id: button.dataset.extensionStagingInstall || "" }); toast("扩展已安装", "success"); await loadHarnessSnapshot(); }
    catch (error) { toast(error.message || "扩展安装失败", "error"); }
  }));
  host.querySelectorAll("[data-extension-action]").forEach((button) => button.addEventListener("click", async () => {
    try {
      const action = button.dataset.extensionAction;
      const id = button.dataset.extensionId || "";
      if (action === "trust") await harnessAction("extensions.trust", { id, version: button.dataset.extensionVersion || "" });
      if (action === "toggle") await harnessAction("extensions.enable", { id, enabled: button.dataset.extensionEnabled !== "1" });
      if (action === "update") await harnessAction("extensions.update", { id, staging_id: button.dataset.extensionStaging || "" });
      if (action === "apply-update") await harnessAction("extensions.apply-update", { id });
      if (action === "rollback") await harnessAction(button.textContent.includes("确认") ? "extensions.confirm-rollback" : "extensions.rollback", { id });
      await loadHarnessSnapshot();
    } catch (error) { toast(error.message || "扩展操作失败", "error"); }
  }));
  host.querySelectorAll("[data-mcp-action]").forEach((button) => button.addEventListener("click", async () => {
    try {
      const action = button.dataset.mcpAction || "";
      const id = button.dataset.mcpId || "";
      if (action === "connect") await harnessAction("extensions.mcp.connect", { id });
      if (action === "disconnect") await harnessAction("extensions.mcp.disconnect", { id });
      if (action === "refresh") await harnessAction("extensions.mcp.refresh", { id });
      if (action === "status") await harnessAction("extensions.mcp.status", { id });
      toast(action === "status" ? "MCP 状态已读取" : "MCP 状态已更新", "success"); await loadHarnessSnapshot();
    }
    catch (error) { toast(error.message || "MCP 连接失败", "error"); }
  }));
  host.querySelector("#mcp-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try { await harnessAction("extensions.mcp.configure", { id: String(form.get("id") || "").trim(), endpoint: String(form.get("endpoint") || "").trim() }); toast("MCP 配置已保存", "success"); await loadHarnessSnapshot(); }
    catch (error) { toast(error.message || "MCP 配置失败", "error"); }
  });
}

function renderHarnessReview(snapshot = {}) {
  const host = $("#harness-settings-review");
  if (!host) return;
  const reviews = Array.isArray(snapshot.reviews) ? snapshot.reviews : [];
  const composition = snapshot.composition || {};
  const presets = Array.isArray(composition.presets) ? composition.presets : [];
  const custom = Array.isArray(composition.custom) ? composition.custom : [];
  const options = presets.map((preset) => `<option value="${escapeAttr(preset.id || preset.name || "standard")}"${preset.id === composition.current?.preset ? " selected" : ""}>${escapeHtml(preset.label || preset.id || preset.name)}</option>`).join("") + custom.map((item) => `<option value="custom:${escapeAttr(item.name || "")}"${composition.customSelected === item.name ? " selected" : ""}>自定义 · ${escapeHtml(item.name || "")}</option>`).join("");
  const reviewRows = reviews.slice(-6).reverse().map((review) => `<article class="harness-review"><strong>${escapeHtml(review.outcome || "UNPROVEN")}</strong><span>${escapeHtml(review.stoppedReason || review.id || "结构化结果")}</span>${review.findings?.length ? `<ul>${review.findings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}${review.suggestions?.length ? `<small>建议：${escapeHtml(review.suggestions.join("；"))}</small>` : ""}</article>`).join("");
  host.innerHTML = `<div class="harness-panel-heading"><div><h4>Review 与能力组合</h4><p>Review.run 接收当前工作区与只读证据，结果由 Harness ReviewService 结构化返回；没有执行器时明确未证明。</p></div></div><form id="harness-review-form" class="harness-inline-form"><input name="workspace_id" value="${escapeAttr(state.workdir || "")}" placeholder="当前工作区"><input name="evidence_summary" placeholder="变更/产物证据摘要"><button id="harness-review-start" type="submit" class="primary-button">运行 Review</button></form><div class="harness-review-list">${reviewRows || `<p class="workspace-unavailable">尚无 Review 结果。</p>`}</div><div class="harness-composition"><h5>能力组合</h5><select id="harness-composition-select">${options}</select><div class="harness-action-row"><button id="harness-composition-restore" type="button" class="ghost-button">恢复默认</button><span class="subtle">${escapeHtml(composition.current?.presentation?.summary || "尚未加载")}</span></div><form id="harness-composition-save" class="harness-inline-form"><input name="name" required placeholder="自定义组合名称"><input name="source" value="standard" placeholder="来源方案"><button class="ghost-button" type="submit">保存自定义组合</button></form></div>`;
  host.querySelector("#harness-review-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try { await harnessAction("review.run", { workspace_id: String(form.get("workspace_id") || ""), evidence_summary: String(form.get("evidence_summary") || "") }); toast("Review 结果已返回", "success"); await loadHarnessSnapshot(); }
    catch (error) { toast(error.message || "Review 不可用", "error"); }
  });
  host.querySelector("#harness-composition-select")?.addEventListener("change", async (event) => {
    try {
      const value = String(event.target.value || "standard");
      if (value.startsWith("custom:")) await harnessAction("composition.select-custom", { name: value.slice(7) });
      else await harnessAction("composition.set-preset", { preset: value });
      await loadHarnessSnapshot();
    }
    catch (error) { toast(error.message || "能力组合保存失败", "error"); }
  });
  host.querySelector("#harness-composition-restore")?.addEventListener("click", async () => {
    try { await harnessAction("composition.restore-default"); toast("已恢复默认组合", "success"); await loadHarnessSnapshot(); }
    catch (error) { toast(error.message || "恢复默认失败", "error"); }
  });
  host.querySelector("#harness-composition-save")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try { await harnessAction("composition.save-custom", { name: String(form.get("name") || "").trim(), source: String(form.get("source") || "standard").trim() }); toast("自定义组合已保存", "success"); await loadHarnessSnapshot(); }
    catch (error) { toast(error.message || "保存自定义组合失败", "error"); }
  });
}

function renderHarnessProvider(snapshot = {}) {
  const host = $("#harness-settings-provider");
  if (!host) return;
  const settings = snapshot.provider_settings?.profiles || {};
  const catalogRows = Array.isArray(snapshot.provider_catalog?.profiles) ? snapshot.provider_catalog.profiles : [];
  const catalog = Object.fromEntries(catalogRows.map((item) => [item.profile?.id || item.id, item]));
  const rows = Object.entries(settings).map(([id, profile]) => {
    const catalogProfile = catalog[id] || {};
    const profileMeta = catalogProfile.profile || {};
    const configuration = catalogProfile.configuration || {};
    const state = catalogProfile.state || catalogProfile;
    const models = Array.isArray(profile.models) ? profile.models : [];
    const enabled = catalogProfile.enabledCapabilities || profile.enabledCapabilities || {};
    const capabilityNames = ["stream", "tools", "reasoning", "cache", "usage"];
    const network = profile.network || catalogProfile.network || {};
    const capabilityInputs = capabilityNames.map((name) => `<label class="harness-check"><input type="checkbox" data-provider-capability="${escapeAttr(name)}" ${enabled[name] ? "checked" : ""}>${escapeHtml(name)}</label>`).join("");
    return `<article class="harness-provider-row" data-provider-profile="${escapeAttr(id)}"><div><strong>${escapeHtml(profileMeta.label || catalogProfile.label || id)}</strong><small>${escapeHtml(profileMeta.protocol || catalogProfile.protocol || "provider")} · ${escapeHtml(profileMeta.vendor || "")}</small></div><span data-status="${escapeAttr(profile.connectionState || state.connectionState || "unknown")}">${escapeHtml(profile.connectionState || state.connectionState || "未验证")}</span><code>${escapeHtml(profile.endpoint || configuration.endpoint || profileMeta.endpoint?.defaultUrl || "未设置")}</code><small>模型 ${escapeHtml(profile.selectedModel || models[0] || "未选择")} · cache ${escapeHtml(profileMeta.cachePolicyId || "unknown")} · secret ref 由 Host 持有</small><small>能力：${escapeHtml(capabilityNames.filter((name) => enabled[name]).join("、") || "未启用")} · 网络：${escapeHtml(network.mode || "system")} · 代理 ${network.proxyConfigured || network.proxyUrl ? "已配置" : "未配置"} · TLS ${escapeHtml(network.tlsVerification || "required")} · 证书 ${network.customCaConfigured ? "已配置" : "未配置"}</small><div class="harness-provider-capabilities">${capabilityInputs}</div><div class="harness-inline-form"><select data-provider-network-mode="${escapeAttr(id)}"><option value="system"${network.mode !== "profile" ? " selected" : ""}>系统网络</option><option value="profile"${network.mode === "profile" ? " selected" : ""}>Provider 代理</option></select><input data-provider-proxy="${escapeAttr(id)}" value="${escapeAttr(network.proxyUrl || "")}" placeholder="可选代理 URL"><button type="button" class="ghost-button" data-provider-network-save="${escapeAttr(id)}">保存网络</button></div><div class="harness-record-actions"><button type="button" class="ghost-button" data-provider-capability-save="${escapeAttr(id)}">保存能力</button><button type="button" class="ghost-button" data-provider-capability-read="${escapeAttr(id)}">读取能力</button><button type="button" class="ghost-button" data-provider-network-read="${escapeAttr(id)}">读取网络</button><button type="button" class="ghost-button" data-harness-provider-test="${escapeAttr(id)}">单次连接测试</button></div></article>`;
  }).join("");
  host.innerHTML = `<div class="harness-panel-heading"><div><h4>Provider 协议与适配</h4><p>显示后端已有协议、端点、模型、能力、cache policy、网络与 TLS 状态；密钥只使用 Host secret ref。</p></div></div><div class="harness-provider-list">${rows || `<p class="workspace-unavailable">Provider 目录不可用。</p>`}</div>`;
  host.querySelectorAll("[data-provider-capability-save]").forEach((button) => button.addEventListener("click", async () => {
    const row = button.closest("[data-provider-profile]");
    const capabilities = Object.fromEntries([...row.querySelectorAll("[data-provider-capability]")].map((input) => [input.dataset.providerCapability, input.checked]));
    try { await harnessAction("provider.capabilities", { profile_id: button.dataset.providerCapabilitySave || "", capabilities }); toast("Provider 能力已保存", "success"); await loadHarnessSnapshot(); }
    catch (error) { toast(error.message || "Provider 能力保存失败", "error"); }
  }));
  host.querySelectorAll("[data-provider-capability-read]").forEach((button) => button.addEventListener("click", async () => {
    try { await harnessAction("provider.capabilities.snapshot", { profile_id: button.dataset.providerCapabilityRead || "" }); toast("Provider 能力状态已读取", "success"); }
    catch (error) { toast(error.message || "Provider 能力读取失败", "error"); }
  }));
  host.querySelectorAll("[data-provider-network-read]").forEach((button) => button.addEventListener("click", async () => {
    try { await harnessAction("provider.network.snapshot", { profile_id: button.dataset.providerNetworkRead || "" }); toast("Provider 网络状态已读取", "success"); }
    catch (error) { toast(error.message || "Provider 网络读取失败", "error"); }
  }));
  host.querySelectorAll("[data-provider-network-save]").forEach((button) => button.addEventListener("click", async () => {
    const row = button.closest("[data-provider-profile]");
    const mode = row.querySelector(`[data-provider-network-mode="${CSS.escape(button.dataset.providerNetworkSave || "")}"]`)?.value || "system";
    const proxyUrl = row.querySelector(`[data-provider-proxy="${CSS.escape(button.dataset.providerNetworkSave || "")}"]`)?.value.trim() || "";
    try { await harnessAction("provider.network", { profile_id: button.dataset.providerNetworkSave || "", network: { mode, proxyUrl, tlsVerification: "required" } }); toast("Provider 网络设置已保存", "success"); await loadHarnessSnapshot(); }
    catch (error) { toast(error.message || "Provider 网络保存失败", "error"); }
  }));
  host.querySelectorAll("[data-harness-provider-test]").forEach((button) => button.addEventListener("click", async () => {
    const profile = button.dataset.harnessProviderTest || "";
    try {
      const response = await fetch(`/api/provider/test?mode=viniper&profile_id=${encodeURIComponent(profile)}`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      toast(data.status || data.message || (data.ok ? "连接测试完成" : "连接测试失败"), data.ok ? "success" : "error");
    } catch (error) { toast(error.message || "连接测试失败", "error"); }
  }));
}

function renderHarnessSettings() {
  const section = $("[data-settings-panel=capabilities]");
  if (!section || state.viewMode !== "viniper") return;
  const snapshot = state.harnessSnapshot || {};
  renderHarnessCapabilityStatus();
  renderHarnessLocalModels(snapshot);
  renderHarnessExtensions(snapshot);
  renderHarnessReview(snapshot);
  renderHarnessProvider(snapshot);
  const active = state.harnessSettingsSection || "local-models";
  $$(`[data-harness-panel]`).forEach((panel) => panel.classList.toggle("hidden", panel.dataset.harnessPanel !== active));
  $$(`[data-harness-section]`).forEach((button) => button.classList.toggle("active", button.dataset.harnessSection === active));
}

async function postCollaborationAction(sessionId, body) {
  const response = await fetch(`/api/collaboration/${encodeURIComponent(sessionId || "")}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.detail || data.error || "协作操作不可用");
  return data;
}

async function renderCollaborationWorkspace(host) {
  const mode = state.viewMode;
  const sessionId = state.sessionId || "";
  const token = modeProjectionToken(mode, sessionId);
  const [capabilityResponse, snapshotResponse] = await Promise.all([
    fetch(`/api/capabilities?mode=${encodeURIComponent(mode)}&session_id=${encodeURIComponent(sessionId)}`),
    fetch(`/api/collaboration/${encodeURIComponent(sessionId)}`),
  ]);
  const capabilities = await capabilityResponse.json().catch(() => ({}));
  const snapshot = await snapshotResponse.json().catch(() => ({}));
  if (!modeProjectionIsCurrent(token)) return;
  state.capabilities = capabilities;
  const collaboration = capabilities.collaboration || {};
  const subagentCapability = capabilities.subagents || {};
  const unavailableSessions = Array.isArray(snapshot.unavailable_sessions) ? snapshot.unavailable_sessions : [];
  const ownerUnavailable = unavailableSessions.some(item => String(item.native_session_id) === sessionId);
  const available = collaboration.status === "available" && snapshotResponse.ok && snapshot.status === "available" && !ownerUnavailable;
  const sessions = Array.isArray(snapshot.sessions)
    ? snapshot.sessions.filter((item) => String(item.native_session_id || item.id || "") !== sessionId)
    : [];
  const targetOptions = sessions.map((item) => `<option value="${escapeAttr(item.native_session_id || item.id)}">${escapeHtml(item.name || item.native_session_id || item.id)}</option>`).join("");
  const envelopes = Array.isArray(snapshot.envelopes) ? snapshot.envelopes : [];
  const inbox = envelopes.filter((item) => String(item.target_session_id || "") === sessionId).slice(-20).reverse();
  const waits = Array.isArray(snapshot.waits) ? snapshot.waits.filter((item) => String(item.session_id || "") === sessionId) : [];
  const subagents = Array.isArray(snapshot.subagents) ? snapshot.subagents : [];
  const unavailableReason = ownerUnavailable ? "当前会话的项目目录不可用，请重新选择目录。"
    : (!snapshotResponse.ok ? "协作状态读取失败，请重试。" : collaboration.reason || snapshot.reason || "当前 owner 未暴露原生跨会话消息能力。");
  host.innerHTML = `<div class="workspace-panel-header"><h2>协作与子 Agent</h2><span>${escapeHtml(capabilities.engine || "")}</span></div>
    <dl class="capability-list"><div><dt>跨会话协作</dt><dd data-status="${escapeAttr(collaboration.status || "unavailable")}">${available ? "可用" : "不可用"}</dd></div><div><dt>子 Agent</dt><dd data-status="${escapeAttr(subagentCapability.status || "unavailable")}">${subagentCapability.status === "available" ? "可用" : "不可用"}</dd></div></dl>
    ${available ? "" : `<p class="workspace-unavailable" role="status">${escapeHtml(unavailableReason)}</p>`}
    ${unavailableSessions.map(item => `<p class="workspace-unavailable" role="status">会话 ${escapeHtml(item.native_session_id)}：${escapeHtml(item.reason)}</p>`).join("")}
    <form id="collaboration-form" class="collaboration-form" data-owner="${escapeAttr(mode)}">
      <label>动作<select name="action"><option value="send_message">发送消息</option><option value="delegate">委派任务</option><option value="wait_for_result">等待结果</option></select></label>
      <label>目标会话<select name="target_session_id">${targetOptions}</select></label>
      <label data-collaboration-content>内容<input name="content" maxlength="8000" placeholder="消息或委派任务"></label>
      <label data-collaboration-correlation class="hidden">关联 ID<input name="correlation_id" maxlength="128" placeholder="委派信封 ID"></label>
      <label data-collaboration-timeout class="hidden">超时（秒）<input name="timeout_seconds" type="number" min="1" max="86400" value="60"></label>
      <button class="primary-button" type="submit" ${available && sessions.length ? "" : "disabled"}>执行</button>
    </form>
    <section class="collaboration-status-panel"><div class="workspace-panel-header"><h3>等待与结果</h3><span>${waits.length ? "等待中" : "空闲"}</span></div>
      ${waits.map((item) => `<div class="harness-record"><div><strong>等待 ${escapeHtml(item.envelope_type || "消息")}</strong><small>${escapeHtml(item.correlation_id || "任意关联")}</small></div><button type="button" class="ghost-button" data-cancel-wait="${escapeAttr(item.id)}">取消等待</button></div>`).join("") || `<p class="workspace-unavailable">当前没有等待。</p>`}
      <ul class="harness-record-list">${inbox.map((item) => `<li class="harness-record" data-envelope-id="${escapeAttr(item.id)}"><div><strong>${escapeHtml(item.type === "result" ? "委派结果" : item.type === "delegation" ? "委派任务" : "会话消息")}</strong><small>${escapeHtml(item.status || "delivered")} · ${escapeHtml(item.correlation_id || item.id)}</small></div><span>${escapeHtml(item.body || "")}</span>${item.status === "delivered" ? `<button type="button" class="ghost-button" data-mark-envelope="${escapeAttr(item.id)}">标记已读</button>` : ""}</li>`).join("") || `<li class="workspace-unavailable">暂无消息或结果。</li>`}</ul>
    </section>
    <section class="collaboration-subagents"><div class="workspace-panel-header"><h3>子 Agent</h3><span>${subagents.length}</span></div>
      ${mode === "viniper" ? `<form id="harness-subagent-form" class="collaboration-form"><label>目标会话<select name="target_session_id">${targetOptions}</select></label><label>任务<input name="task" maxlength="8000" placeholder="描述子 Agent 任务"></label><button class="primary-button" type="submit" ${subagentCapability.status === "available" && sessions.length ? "" : "disabled"}>启动子 Agent</button></form>` : `<p class="workspace-unavailable">Claude code 仅使用当前 CLI 原生 --agents；跨会话 SendMessage 未暴露时不会借用 Harness。</p>`}
      <ul class="harness-record-list">${subagents.map((item) => `<li class="harness-record"><div><strong>${escapeHtml(item.id || "子 Agent")}</strong><small>${escapeHtml(item.status || "unknown")}</small></div><span>${escapeHtml(item.output || item.error || "等待状态更新")}</span>${["queued", "running"].includes(item.status) && mode === "viniper" ? `<button type="button" class="ghost-button" data-cancel-subagent="${escapeAttr(item.id)}">取消</button>` : ""}</li>`).join("") || `<li class="workspace-unavailable">暂无子 Agent 记录。</li>`}</ul>
    </section>`;
  const form = host.querySelector("#collaboration-form");
  if (mode === "claude") {
    const nativeButton = document.createElement("button");
    nativeButton.className = "ghost-button";
    nativeButton.type = "button";
    nativeButton.textContent = "管理 Claude Code 原生子 Agent";
    nativeButton.addEventListener("click", () => void executeWorkspaceSlashCommand("/agents"));
    host.querySelector(".collaboration-subagents")?.prepend(nativeButton);
  }
  const syncFields = () => {
    const waiting = form?.elements.action.value === "wait_for_result";
    form?.querySelector("[data-collaboration-content]")?.classList.toggle("hidden", waiting);
    form?.querySelector("[data-collaboration-correlation]")?.classList.toggle("hidden", !waiting);
    form?.querySelector("[data-collaboration-timeout]")?.classList.toggle("hidden", !waiting);
  };
  form?.elements.action.addEventListener("change", syncFields);
  syncFields();
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const action = String(values.get("action") || "");
    const target = String(values.get("target_session_id") || "");
    const payload = action === "wait_for_result"
      ? { action, source_session_id: target, envelope_type: "result", correlation_id: String(values.get("correlation_id") || ""), timeout_ms: Number(values.get("timeout_seconds") || 60) * 1000 }
      : action === "delegate"
        ? { action, target_session_id: target, task: String(values.get("content") || "") }
        : { action, target_session_id: target, message: String(values.get("content") || "") };
    try { await postCollaborationAction(sessionId, payload); toast("协作操作已提交", "success"); await renderCollaborationWorkspace(host); }
    catch (error) { toast(error.message || "协作操作不可用", "error"); }
  });
  host.querySelectorAll("[data-cancel-wait]").forEach((button) => button.addEventListener("click", async () => { try { await postCollaborationAction(sessionId, { action: "cancel_wait", wait_id: button.dataset.cancelWait }); await renderCollaborationWorkspace(host); } catch (error) { toast(error.message, "error"); } }));
  host.querySelectorAll("[data-mark-envelope]").forEach((button) => button.addEventListener("click", async () => { try { await postCollaborationAction(sessionId, { action: "mark_read", envelope_id: button.dataset.markEnvelope }); await renderCollaborationWorkspace(host); } catch (error) { toast(error.message, "error"); } }));
  host.querySelectorAll("[data-cancel-subagent]").forEach((button) => button.addEventListener("click", async () => { try { await postCollaborationAction(sessionId, { action: "cancel_subagent", subagent_id: button.dataset.cancelSubagent }); await renderCollaborationWorkspace(host); } catch (error) { toast(error.message, "error"); } }));
  host.querySelector("#harness-subagent-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const values = new FormData(event.currentTarget); try { await postCollaborationAction(sessionId, { action: "spawn_subagent", target_session_id: values.get("target_session_id"), task: values.get("task") }); toast("子 Agent 已提交", "success"); await renderCollaborationWorkspace(host); } catch (error) { toast(error.message, "error"); } });
}

async function openWorkspaceTab(tab = "project") {
  const rail = $("#workspace-rail");
  if (!rail) return;
  const token = modeProjectionToken(state.viewMode, state.sessionId);
  const generation = ++state.workspaceRequestGeneration;
  const isCurrent = () => modeProjectionIsCurrent(token) && generation === state.workspaceRequestGeneration;
  try {
  state.workspaceTab = ["project", "plan", "index", "changes", "collaboration", "capabilities"].includes(tab) ? tab : "project";
  if (state.viewMode === "claude" && state.workspaceTab === "capabilities") state.workspaceTab = "project";
  rail.classList.remove("hidden");
  rail.setAttribute("aria-hidden", "false");
  $$("[data-workspace-tab]").forEach((button) => button.classList.toggle("active", button.dataset.workspaceTab === state.workspaceTab));
  const browser = $("#workspace-browser-area");
  const planArea = $("#workspace-plan-area");
  const changes = $("#workspace-changes-area");
  const collaboration = $("#workspace-collaboration-area");
  const capabilityArea = $("#workspace-capabilities-area");
  [browser, planArea, changes, collaboration, capabilityArea].forEach((panel) => panel?.classList.add("hidden"));
  if (state.workspaceTab === "project" || state.workspaceTab === "index") {
    browser.classList.remove("hidden");
    browser.innerHTML = `<div class="workspace-panel-header"><h2>${state.workspaceTab === "index" ? "项目索引" : "项目与目录"}</h2><span>${escapeHtml(state.workdir || "未选择")}</span></div><div class="workspace-loading">正在读取…</div>`;
    const response = await fetch(`/api/project-index?session_id=${encodeURIComponent(state.sessionId || "")}&mode=${encodeURIComponent(state.viewMode)}&query=${encodeURIComponent(state.projectIndexQuery || "")}`);
    const data = await response.json().catch(() => ({}));
    if (!isCurrent()) return;
    if (!response.ok || data.ok === false) throw new Error(data.detail || "项目目录读取失败");
    const entries = Array.isArray(data.entries) ? data.entries : [];
    state.projectIndexEntries = entries;
    browser.innerHTML = `<div class="workspace-panel-header"><h2>${state.workspaceTab === "index" ? "项目索引" : "项目与目录"}</h2><button type="button" class="ghost-button" data-workspace-change-dir>选择目录</button></div><div class="project-index-toolbar"><input id="project-index-query" type="search" value="${escapeAttr(state.projectIndexQuery || "")}" placeholder="搜索文件或符号"><button type="button" class="ghost-button" data-project-index-search>搜索</button><button type="button" class="ghost-button" data-project-index-build>重建索引</button></div><code class="workspace-root">${escapeHtml(data.root || state.workdir || "")}</code>${data.ok === false || data.status === "unavailable" ? `<p class="workspace-unavailable">${escapeHtml(data.reason || "当前项目索引不可用。")}</p>` : `<div class="project-index-list">${entries.slice(0, 120).map((entry) => `<button type="button" data-index-path="${escapeAttr(entry.path)}"><span>${escapeHtml(entry.path)}</span><small>${formatBytes(entry.size)}${entry.symbols?.length ? ` · ${entry.symbols.length} 个符号` : ""}</small></button>`).join("") || `<p class="workspace-unavailable">项目中没有可显示的文件。</p>`}</div>`}<div class="lsp-navigator"><h3>LSP 语义导航</h3><div class="lsp-form"><input id="lsp-path" placeholder="相对文件路径"><input id="lsp-symbol" placeholder="符号"><select id="lsp-operation"><option value="definition">定义</option><option value="references">引用</option><option value="implementation">实现</option><option value="hover">悬停</option></select><button type="button" class="ghost-button" data-lsp-navigate>查询</button></div><div id="lsp-results" class="lsp-results"></div></div>`;
    browser.querySelector("[data-workspace-change-dir]")?.addEventListener("click", () => void changeWorkdir());
    if (token.mode === "claude") {
      browser.querySelector("[data-project-index-build]")?.remove();
      browser.querySelector(".lsp-navigator")?.remove();
      const heading = browser.querySelector(".workspace-panel-header h2");
      if (heading) heading.textContent = "项目文件";
      const search = browser.querySelector("#project-index-query");
      if (search) search.placeholder = "搜索文件";
      if (data.truncated) browser.insertAdjacentHTML("beforeend", '<p class="workspace-unavailable">文件较多，仅显示部分结果。输入文件名可缩小范围。</p>');
    }
    const projectIndexQuery = browser.querySelector("#project-index-query");
    const submitProjectIndexSearch = () => {
      state.projectIndexQuery = String(projectIndexQuery?.value || "").trim();
      void openWorkspaceTab(state.workspaceTab);
    };
    browser.querySelector("[data-project-index-search]")?.addEventListener("click", submitProjectIndexSearch);
    projectIndexQuery?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submitProjectIndexSearch();
      }
    });
    browser.querySelector("[data-project-index-build]")?.addEventListener("click", async () => { try { await harnessAction("project-index.build", { project_root: state.workdir || "" }); toast("项目索引已更新", "success"); await openWorkspaceTab(state.workspaceTab); } catch (error) { toast(error.message || "索引不可用", "error"); } });
    let previewRequest = 0;
    browser.querySelectorAll("[data-index-path]").forEach((button) => button.addEventListener("click", async () => {
      if (token.mode === "claude") {
        const relativePath = button.dataset.indexPath || "";
        const request = ++previewRequest;
        browser.querySelector("#project-file-preview")?.remove();
        const preview = document.createElement("section");
        preview.id = "project-file-preview";
        preview.className = "project-file-preview";
        preview.innerHTML = `<div class="workspace-panel-header"><h3>${escapeHtml(relativePath)}</h3><span>只读预览</span></div><p class="workspace-unavailable">正在读取文件…</p>`;
        browser.append(preview);
        try {
          const response = await fetch(`/api/project-file?session_id=${encodeURIComponent(token.sessionId)}&mode=claude&path=${encodeURIComponent(relativePath)}`);
          const file = await response.json().catch(() => ({}));
          if (!isCurrent() || request !== previewRequest) return;
          if (!response.ok || file.ok === false) throw new Error(file.detail || file.reason || "文件读取失败");
          const readable = file.status === "available" && typeof file.content === "string";
          preview.innerHTML = `<div class="workspace-panel-header"><h3>${escapeHtml(file.path || relativePath)}</h3><span>只读预览${file.size ? ` · ${formatBytes(file.size)}` : ""}</span></div>${readable ? `<button type="button" class="ghost-button" data-copy-project-file>复制内容</button><pre><code>${escapeHtml(file.content)}</code></pre>` : `<p class="workspace-unavailable">${escapeHtml(file.reason || "这个文件无法在工作台内预览。可在本机文件管理器中查看。")}</p>`}`;
          preview.querySelector("[data-copy-project-file]")?.addEventListener("click", async (event) => {
            const copyButton = event.currentTarget;
            try { await navigator.clipboard.writeText(file.content); copyButton.textContent = "已复制"; }
            catch { showInlineStatus("复制失败，请选中内容后手动复制。", { kind: "error", timeout: 5000 }); }
          });
          preview.scrollIntoView({ block: "nearest" });
        } catch (error) {
          if (isCurrent() && request === previewRequest) preview.innerHTML = `<p class="workspace-unavailable">${escapeHtml(error.message || "文件读取失败")}。重新选择文件可重试。</p>`;
        }
        return;
      }
      const lspPath = browser.querySelector("#lsp-path");
      if (lspPath) {
        lspPath.value = button.dataset.indexPath || "";
        lspPath.focus();
      }
    }));
    browser.querySelector("[data-lsp-navigate]")?.addEventListener("click", async () => {
      const result = browser.querySelector("#lsp-results");
      try {
        const data = await harnessAction("lsp.navigate", { operation: browser.querySelector("#lsp-operation")?.value || "definition", project_root: state.workdir || "", path: browser.querySelector("#lsp-path")?.value || "", symbol: browser.querySelector("#lsp-symbol")?.value || "" });
        const items = Array.isArray(data.items) ? data.items : [];
        if (result) result.innerHTML = data.status === "available" && items.length ? items.map((item) => `<div><code>${escapeHtml(item.path || "")}:${escapeHtml(item.line || 1)}</code><span>${escapeHtml(item.name || data.hoverText || "匹配")}</span></div>`).join("") : `<p class="workspace-unavailable">${escapeHtml(data.error || "没有可验证的结果")}</p>`;
      } catch (error) { if (result) result.innerHTML = `<p class="workspace-unavailable">${escapeHtml(error.message || "LSP 不可用")}</p>`; }
    });
  } else if (state.workspaceTab === "plan") {
    planArea.classList.remove("hidden");
    const snapshot = await loadPlanSnapshot();
    if (!isCurrent()) return;
    const plan = normalizePlanSnapshot(snapshot || {});
    planArea.innerHTML = plan.steps.length ? `<div class="workspace-panel-header"><h2>规划步骤</h2><span>第 ${plan.current || 1} / ${plan.total} 步</span></div><ol class="plan-step-list">${plan.steps.map((step) => `<li class="plan-step plan-step-${escapeAttr(step.status)}"><span class="plan-step-state">${step.status === "completed" ? "✓" : ""}</span><span class="plan-step-title">${escapeHtml(step.title)}</span></li>`).join("")}</ol>` : `<p class="workspace-unavailable">当前会话还没有结构化计划。输入 /plan 步骤一 | 步骤二 创建。</p>`;
  } else if (state.workspaceTab === "changes") {
    changes.classList.remove("hidden");
    const operations = currentFileOperations();
    changes.innerHTML = `<div class="workspace-panel-header"><h2>修改与查看</h2><span>${operations.length} 个文件事件</span></div>${operations.length ? operations.map(renderFileOperationCard).join("") : `<p class="workspace-unavailable">当前会话没有可验证的文件 diff。</p>`}`;
  } else if (state.workspaceTab === "collaboration") {
    collaboration.classList.remove("hidden");
    await renderCollaborationWorkspace(collaboration);
    return;
  } else if (state.workspaceTab === "capabilities") {
    capabilityArea.classList.remove("hidden");
    await Promise.all([
      loadHarnessCapabilities({ render: false }),
      loadHarnessConfigurationMatrix({ render: false }),
    ]);
    const snapshot = state.harnessSnapshot || await loadHarnessSnapshot({ render: false }) || {};
    if (!isCurrent()) return;
    capabilityArea.innerHTML = `<div class="workspace-panel-header"><h2>Harness 能力</h2><span>Viniper · Harness Runtime</span></div><div class="capability-status-grid">${harnessFeatureRecords().map(([label, status, reason]) => `<div class="capability-status-item"><span>${escapeHtml(label)}</span><strong data-status="${escapeAttr(status || "unavailable")}"${reason ? ` title="${escapeAttr(reason)}"` : ""}>${escapeHtml(harnessStatusText(status))}</strong></div>`).join("")}</div><p class="workspace-unavailable">详细管理位于设置 → Harness 能力；项目索引/LSP 与协作分别位于对应工作区页。</p><button type="button" class="ghost-button" data-open-harness-settings>打开 Harness 设置</button>`;
    capabilityArea.querySelector("[data-open-harness-settings]")?.addEventListener("click", () => void openSettingsModal({ section: "capabilities" }));
  }
  } catch (error) {
    if (!isCurrent()) return;
    rail.querySelector(".workspace-loading")?.remove();
    showInlineStatus(`读取工作区失败：${error.message || error}。可重新打开重试。`, { kind: "error", timeout: 6500 });
  }
}

function updateContextRail() {
  const rail = $("#workspace-rail");
  const toolArea = $("#tool-area");
  const artifactArea = $("#artifact-area");
  if (!rail || !toolArea || !artifactArea) return;
  if (state.workspaceTab === "changes" && !rail.classList.contains("hidden")) void openWorkspaceTab("changes");
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
  const body = { mode: mode === "claude" ? "claude" : "viniper", message, model, permission_mode: permissionMode, attachments };
  if (mode === "claude" && peerTarget?.session_id) body.peer_target_session_id = String(peerTarget.session_id);
  return body;
}

function parallelWorkdirConflict(sessionId, workdir, sessions = state.sessionIndex) {
  const key = String(workdir || "").trim().replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
  if (!key) return null;
  return (Array.isArray(sessions) ? sessions : []).find((session) => {
    if (!session || String(session.id || "") === String(sessionId || "") || session.mode !== "claude") return false;
    if (!["running", "waiting_input", "awaiting_cli_ack"].includes(String(session.runtime_state || ""))) return false;
    const candidate = String(session.workdir || "").trim().replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
    return candidate === key;
  }) || null;
}

async function sendAgentGuidance(sessionId, input = $("#user-input")) {
  const runSessionId = String(sessionId || "");
  const run = SessionRunRegistry.get(runSessionId);
  if (!runSessionId || !run?.active || !["viniper", "claude"].includes(run.mode) || !input) return false;
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
    const response = await fetch(`/api/runs/${encodeURIComponent(runSessionId)}/guidance`, {
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
  if (!runSessionId || !run?.active || !["viniper", "claude"].includes(run.mode) || !input) return false;
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
    const response = await fetch(`/api/runs/${encodeURIComponent(runSessionId)}/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        attachments,
        mode: state.sessionMode === "claude" ? "claude" : "viniper",
        model: state.selectedModel,
        permission_mode: sanitizePermissionMode(state.permissionMode),
      }),
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

async function executeClaudeNativeSlashCommand(text) {
  const match = String(text || "").trim().match(/^\/([a-z0-9_:-]+)(?:\s+([\s\S]*))?$/i);
  if (!match) return false;
  const command = match[1].toLowerCase();
  const detail = String(match[2] || "").trim();
  const descriptor = slashCommandsForMode("claude").find((item) => item.command === `/${command}`);
  if (!descriptor) return false;
  const sessionId = String(state.sessionId || "");
  const token = modeProjectionToken("claude", sessionId);
  const response = await fetch(`/api/claude-native-commands/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command: `/${command}`, arguments: detail, cli_version: descriptor.version || "" }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.detail || `/${command} 原生命令不可用`);
  if (!modeProjectionIsCurrent(token)) return true;
  const result = { ...descriptor, ...data.descriptor, ...data };
  if (result.execution === "native-ui" && result.ui_action) {
    await openClaudeCommandUi(result.ui_action);
  } else if (["opened", "native_terminal_opened"].includes(result.status) || (result.execution === "cli" && result.status === "completed")) {
    showNativeCommandStatus(result);
  } else {
    showInlineStatus(result.summary || result.reason || `/${command} 当前不可用`, { kind: result.available === false ? "error" : "info", timeout: 6500 });
  }
  return true;
}

async function openClaudeCommandUi(action) {
  if (state.viewMode !== "claude") return;
  if (action === "model" || action === "permissions") {
    setAnchoredMenuOpen(action === "model" ? "model" : "permission", true, { focus: true });
  } else if (action === "context") {
    setContextPopoverOpen(true);
  } else if (action === "config" || action === "settings" || action === "status") {
    await openSettingsModal({ section: action === "status" ? "claude" : "provider" });
  } else if (action === "sessions") {
    setSidebarVisible(true);
    $("#session-list")?.focus();
    showInlineStatus("在左侧选择要继续的 Claude code 会话", { kind: "info", timeout: 5000 });
  } else if (action === "skills" || action === "plugins") {
    openSkillsView();
  } else if (["tasks", "plan", "agents", "project", "diff"].includes(action)) {
    const tab = { tasks: "plan", plan: "plan", agents: "collaboration", project: "project", diff: "changes" }[action];
    await openWorkspaceTab(tab);
  } else {
    throw new Error("这个原生命令的桌面入口尚不可用，请使用 Claude Code 原生终端。");
  }
}

function showNativeCommandStatus(result) {
  $("#native-command-status")?.remove();
  const host = document.createElement("div");
  host.id = "native-command-status";
  host.className = "native-command-status";
  host.setAttribute("role", "status");
  const command = String(result.command_to_type || result.command || "");
  const output = result.execution === "cli" ? String(result.summary || "原生命令已返回") : "";
  host.innerHTML = `<div><strong>${output ? `Claude Code ${escapeHtml(command)}` : "Claude Code 原生窗口已打开"}</strong>${output ? `<pre>${escapeHtml(output)}</pre>` : `<p>${escapeHtml(result.summary || "在原生窗口中继续完成操作。")}</p>${command ? `<code>${escapeHtml(command)}</code>` : ""}`}</div><div class="native-command-actions">${command ? `<button type="button" class="ghost-button" data-native-command-copy>${output ? "复制输出" : "复制命令"}</button>` : ""}<button type="button" class="ghost-button" data-native-command-dismiss aria-label="关闭原生命令提示">关闭</button></div>`;
  host.querySelector("[data-native-command-copy]")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(output || command); host.querySelector("[data-native-command-copy]").textContent = "已复制"; }
    catch { showInlineStatus("复制失败，请选中命令手动复制。", { kind: "error", timeout: 5000 }); }
  });
  host.querySelector("[data-native-command-dismiss]")?.addEventListener("click", () => host.remove());
  $("#composer")?.before(host);
}

async function executeWorkspaceSlashCommand(text) {
  if (state.viewMode === "claude") {
    const token = modeProjectionToken("claude", state.sessionId);
    try {
      return await executeClaudeNativeSlashCommand(text);
    } catch (error) {
      if (modeProjectionIsCurrent(token)) showInlineStatus(`${text}：${error.message || error}`, { kind: "error", timeout: 5200 });
      return "failed";
    }
  }
  const match = String(text || "").trim().match(/^\/(mcp|goal|target|plan)(?:\s+([\s\S]*))?$/i);
  if (!match) return false;
  const token = modeProjectionToken("viniper", state.sessionId);
  const command = match[1].toLowerCase();
  const detail = String(match[2] || "").trim();
  const endpoint = command === "goal"
    ? `/api/goals?mode=viniper&session_id=${encodeURIComponent(state.sessionId || "")}`
    : command === "plan"
      ? `/api/plans?session_id=${encodeURIComponent(state.sessionId || "")}`
      : command === "target"
        ? `/api/capabilities?mode=viniper&session_id=${encodeURIComponent(state.sessionId || "")}`
        : `/api/capabilities?mode=viniper&session_id=${encodeURIComponent(state.sessionId || "")}`;
  try {
    const mutatingPlan = command === "plan" && Boolean(detail);
    const mutatingGoal = command === "goal" && Boolean(detail);
    const response = await fetch(endpoint, {
      method: mutatingGoal || mutatingPlan ? "POST" : "GET",
      headers: mutatingGoal || mutatingPlan ? { "Content-Type": "application/json" } : undefined,
      body: mutatingGoal
        ? JSON.stringify({ title: detail || "目标任务", prompt: detail || "", session_id: state.sessionId, mode: "viniper" })
        : (mutatingPlan ? JSON.stringify({ text: detail, session_id: state.sessionId, mode: "viniper" }) : undefined),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.detail || `/${command} 不可用`);
    if (!modeProjectionIsCurrent(token)) return true;
    const summary = data.summary || (command === "goal"
      ? (data.available === false ? data.reason : (data.goal ? `已创建目标：${data.goal.title}` : `Goal：${(data.goals || []).length} 项`))
      : command === "plan"
        ? `计划步骤 ${Array.isArray(data.steps) ? data.steps.length : 0} 项`
        : `${command.toUpperCase()}：${data.status || "可用"}`);
    addMessage("user", text, { slash_command: command });
    addMessage("assistant", summary, { slash_command: command, completed: true });
    if (command === "plan") renderPlanDock(data);
    if (command === "goal") renderGoalDock(data.goal ? { available: true, goals: [data.goal] } : data);
    showInlineStatus(summary, { kind: "info", timeout: 4200 });
  } catch (error) {
    if (modeProjectionIsCurrent(token)) showInlineStatus(`${text}：${error.message || error}`, { kind: "error", timeout: 5200 });
    return "failed";
  }
  return true;
}

function createRunEventProjection({
  runSessionId,
  runMode,
  runRecord,
  transportRecord,
  runIsVisible,
  getRenderer,
  setRenderer,
  onError,
}) {
  const projection = {
    fullText: "",
    thinkingText: "",
    receivedDone: false,
    hadError: false,
    completedNormally: false,
  };
  const renderRun = (method, ...args) => {
    const renderer = getRenderer();
    if (typeof renderer?.[method] === "function") renderer[method](...args);
  };
  projection.project = (payload = {}) => {
    if (typeof payload.content === "string") payload.content = repairTextForDisplay(payload.content);
    if ((payload.run_id || payload.sequence) && !acceptCoordinatedRunEvent(runSessionId, payload)) return false;
    const type = String(payload.type || "");
    if (["interaction_response_committed", "interaction_ack", "interaction_resolved", "compact_boundary"].includes(type)) {
      projectCoordinatedRunEvent(runSessionId, payload, { accepted: true });
    } else if (type === "interaction_request" || type === "permission_request") {
      const interactionPayload = type === "permission_request"
        ? {
          ...payload,
          type: "interaction_request",
          kind: "permission",
          request_id: String(payload.request_id || payload.call_id || ""),
          summary: String(payload.content || payload.summary || "需要权限"),
          allowed_actions: Array.isArray(payload.allowed_actions) && payload.allowed_actions.length ? payload.allowed_actions : ["deny", "allow_once"],
          owner: runMode,
        }
        : payload;
      const interaction = normalizeInteractionRequest(interactionPayload);
      runRecord.pendingInteraction = interaction;
      runRecord.waitingInput = Boolean(interaction);
      SessionRunRegistry.update(runSessionId, { pendingInteraction: interaction, waitingInput: Boolean(interaction), status: interaction ? "waiting_input" : "running" });
      renderRun("appendInteraction", interactionPayload);
    } else if (type === "queue_dispatch") {
      const item = payload.item || {};
      SessionQueueRegistry.upsert(runSessionId, { ...item, status: "dispatching" });
      projection.fullText = "";
      projection.thinkingText = "";
      projection.receivedDone = false;
      projection.hadError = false;
      projection.completedNormally = false;
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
      setRenderer(createStreamRenderer(runSessionId));
      if (runIsVisible()) syncCurrentSessionRuntimeUi();
    } else if (type === "queue_removed") {
      SessionQueueRegistry.remove(runSessionId, payload.item_id);
    } else if (type === "plan") {
      if (runIsVisible()) renderPlanDock(payload);
      renderRun("appendActivity", { ...payload, type: "plan_timeline" });
    } else if (type === "turn_diff") {
      renderRun("appendActivity", payload);
    } else if (["tool_start", "tool_result", "artifact", "peer_outgoing", "peer_delivery", "peer_incoming"].includes(type)) {
      if (runIsVisible()) recordActivity(payload);
      renderRun("appendActivity", payload);
    } else if (type === "peer_capability") {
      renderRun("setPeerCapability", payload.peer || {});
      if (runIsVisible()) void refreshPeerStatus();
    } else if (type === "thinking_start") {
      if (runIsVisible()) showThinking(false);
      renderRun("startThinking");
    } else if (type === "thinking_complete") {
      if (runIsVisible()) showThinking(false);
      renderRun("completeThinking");
    } else if (type === "thinking_delta" || type === "thinking") {
      if (runIsVisible()) showThinking(false);
      projection.thinkingText += payload.content || "";
      renderRun("append", "thinking", payload.content || "");
    } else if (type === "text") {
      if (runIsVisible()) showThinking(false);
      projection.fullText += payload.content || "";
      renderRun("append", "text", payload.content || "");
    } else if (type === "usage") {
      renderRun("setUsage", payload.usage);
      if (runIsVisible()) updateContextMeter({ schedule: false });
    } else if (type === "turn_usage") {
      renderRun("setTurnUsage", payload.turn_usage || payload.turnUsage);
    } else if (type === "working_status") {
      renderRun("setWorkingStatus", payload.content || "正在工作…", payload);
    } else if (type === "error") {
      projection.hadError = true;
      runRecord.status = "failed";
      SessionRunRegistry.applyEvent(runSessionId, payload);
      if (runIsVisible()) showThinking(false);
      if (runRecord.cancelRequested) {
        projection.fullText = "已停止当前任务，输入已恢复。";
        renderRun("replaceWithText", projection.fullText);
      } else if (!(typeof onError === "function" && onError(payload, projection, renderRun))) {
        projection.fullText = `错误：${payload.content || ""}`;
        renderRun("replaceWithText", projection.fullText);
        markRunError(runSessionId);
      }
    } else if (type === "heartbeat") {
      renderRun("setElapsed", payload.elapsed);
    } else if (type === "done") {
      projection.receivedDone = true;
      runRecord.status = projection.hadError ? "failed" : "completed";
      runRecord.waitingInput = false;
      projection.completedNormally = !projection.hadError && !runRecord.cancelRequested;
      if (runIsVisible()) showThinking(false);
      renderRun("finish");
    }
    return true;
  };
  projection.renderRun = renderRun;
  projection.transportRecord = transportRecord;
  return projection;
}

async function sendMessage() {
  const mode = state.viewMode === "claude" ? "claude" : "viniper";
  const owner = modeOwnedState(mode);
  if (state.sessionId) return sendMessageForSession();
  if (owner.firstSendPromise) return owner.firstSendPromise;
  const input = $("#user-input");
  const draft = String(input?.value || owner.draft || "");
  if (!draft.trim()) return false;
  owner.draft = draft;
  owner.firstSendPromise = (async () => {
    try {
      await createSession({ silent: true, mode, history: true, preserveComposer: true });
      if (state.viewMode !== mode || !state.sessionId) return false;
      return await sendMessageForSession();
    } catch (error) {
      owner.draft = draft;
      if (state.viewMode === mode && input) {
        input.value = draft;
        autoResize(input);
        showInlineStatus(`首条消息未发送：${error.message || error}。草稿已保留。`, { kind: "error", timeout: 6200 });
      }
      return false;
    } finally {
      owner.firstSendPromise = null;
      if (state.viewMode === mode) syncCurrentSessionRuntimeUi();
    }
  })();
  syncCurrentSessionRuntimeUi();
  return owner.firstSendPromise;
}

async function sendMessageForSession() {
  if (!state.sessionId) return false;
  const currentRun = SessionRunRegistry.get(state.sessionId);
  if (currentRun?.active) {
    if (state.sessionMode === state.viewMode && ["viniper", "claude"].includes(state.sessionMode)) {
      await enqueueAgentMessage(state.sessionId);
    }
    return;
  }
  const runSessionId = String(state.sessionId);
  const runMode = state.viewMode === "claude" ? "claude" : "viniper";
  const runWorkdir = state.workdir;
  const runModel = state.selectedModel;

  const input = $("#user-input");
  const text = input.value.trim();
  if (!text) return;

  const slashResult = await executeWorkspaceSlashCommand(text);
  if (slashResult) {
    if (slashResult !== "failed" && state.viewMode === runMode && String(state.sessionId) === runSessionId && input.value.trim() === text) {
      input.value = "";
      modeOwnedState(runMode).draft = "";
      autoResize(input);
      hideSlashSuggestions();
    }
    return;
  }

  const agent = runMode === "claude";
  const peerTarget = agent && state.peerTarget ? { ...state.peerTarget } : null;
  const files = [...state.contextFiles];
  let permissionMode = sanitizePermissionMode(state.permissionMode);
  let attachments = [];
  if (files.length || agent) {
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
  modeOwnedState(runMode).draft = "";
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

  addMessage("user", peerTarget ? `发送给 ${peerTarget.display_name}：${text}` : text, { attachments });
  if (peerTarget) clearPeerTarget();
  addMessage("assistant", "", { runSessionId });
  let streamRenderer = createStreamRenderer(runSessionId);
  const runIsVisible = () => String(state.sessionId) === runSessionId;
  const projection = createRunEventProjection({
    runSessionId,
    runMode,
    runRecord,
    transportRecord,
    runIsVisible,
    getRenderer: () => streamRenderer,
    setRenderer: (value) => { streamRenderer = value; },
    onError: (payload, _projection, render) => {
      if (
        transportRecord.retry.count < transportRecord.retry.max
        && runMode === "claude"
        && transportRecord.retry.context
        && /上一个任务还在运行/.test(payload.content || "")
      ) {
        transportRecord.retry.count++;
        const ctx = transportRecord.retry.context;
        render("replaceWithText", `(上个任务刚结束，${transportRecord.retry.delayMs / 1000} 秒后自动重试…)`);
        setTimeout(() => {
          if (!runRecord.active) return;
          SessionTransportRegistry.finish(runSessionId);
          SessionRunRegistry.finish(runSessionId, "retrying");
          doRetrySend(ctx.text, ctx.permissionMode, ctx.attachments, ctx.mode, runSessionId, ctx.workdir, ctx.model);
        }, transportRecord.retry.delayMs);
        return true;
      }
      return false;
    },
  });
  const renderRun = projection.renderRun;

  // Long-running notice: keep the input locked while the backend task is alive.
  const safetyTimer = setTimeout(() => {
    if (runRecord.active && runIsVisible()) {
      if (!projection.fullText) {
        renderRun("setWorkingStatus", "任务仍在运行…");
      }
    }
  }, 120000);  // 2 minutes: show a notice, but do not allow duplicate sends

  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(runSessionId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildChatRequestBody(runMode, text, runModel, permissionMode, attachments, peerTarget)),
      signal: transportRecord.abortController.signal
    });

    if (!response.ok || !response.body) {
      throw new Error(`请求失败: ${response.status}`);
    }

    await consumeAgentRunResponse(response, runRecord, transportRecord, projection.project);
    projection.completedNormally = runRecord.status === "completed";
  } catch (error) {
    if (runRecord.runId && !runRecord.cancelRequested) {
      transportRecord.reconnecting = true;
      return;
    }
    if (runIsVisible()) showThinking(false);
    projection.hadError = true;
    runRecord.status = "failed";
    if (error.name === "AbortError" || runRecord.cancelRequested) {
      renderRun("cancelInteractions");
      projection.fullText = projection.fullText || "已停止当前任务，输入已恢复。";
      renderRun("replaceWithText", projection.fullText);
    } else {
      projection.fullText = `连接失败：${error.message}`;
      renderRun("replaceWithText", projection.fullText);
      markRunError(runSessionId);
    }
  } finally {
    clearTimeout(safetyTimer);
    if (transportRecord.reconnecting && reconnectAgentRun(runSessionId, runRecord, transportRecord)) return;
    runRecord.active = false;
    runRecord.status = projection.completedNormally ? "completed" : (runRecord.cancelRequested ? "cancelled" : (runRecord.status || "failed"));
    runRecord.waitingInput = false;
    renderRun("finish");
    SessionTransportRegistry.finish(runSessionId);
    SessionRunRegistry.finish(runSessionId, runRecord.status);
    if (runIsVisible()) {
      if (runRecord.cancelRequested) renderRun("cancelInteractions");
      if (runIsVisible()) showThinking(false);
      $("#user-input").focus();
      if (projection.receivedDone) {
        try { await switchSession(runSessionId, { quiet: true, history: false }); } catch {}
      } else {
        renderAllMessages();
      }
      updateContextMeter({ announce: true });
    } else {
      await loadSessionList();
    }
    if (projection.completedNormally) {
      notifyDesktopConversationCompleted();
      void refreshDailyUsage({ force: true, reason: `${runMode}-run-completed` });
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
  const runMode = mode === "claude" ? "claude" : "viniper";
  const runWorkdir = String(workdir || (String(state.sessionId) === runSessionId ? state.workdir : ""));
  const runModel = String(model || state.selectedModel);

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
  const projection = createRunEventProjection({
    runSessionId,
    runMode,
    runRecord,
    transportRecord,
    runIsVisible,
    getRenderer: () => streamRenderer,
    setRenderer: (value) => { streamRenderer = value; },
  });
  const renderRun = projection.renderRun;

  const safetyTimer = setTimeout(() => {
    if (runRecord.active && runIsVisible() && !projection.fullText) {
      renderRun("setWorkingStatus", "任务仍在运行…");
    }
  }, 120000);

  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(runSessionId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildChatRequestBody(runMode, text, runModel, permissionMode, attachments)),
      signal: transportRecord.abortController.signal
    });

    if (!response.ok || !response.body) {
      throw new Error(`请求失败: ${response.status}`);
    }

    await consumeAgentRunResponse(response, runRecord, transportRecord, projection.project);
    projection.completedNormally = runRecord.status === "completed";
  } catch (error) {
    if (runRecord.runId && !runRecord.cancelRequested) {
      transportRecord.reconnecting = true;
      return;
    }
    projection.hadError = true;
    runRecord.status = "failed";
    if (error.name !== "AbortError" && !runRecord.cancelRequested) {
      projection.fullText = `连接失败：${error.message}`;
      renderRun("replaceWithText", projection.fullText);
      markRunError(runSessionId);
    } else {
      renderRun("cancelInteractions");
    }
  } finally {
    clearTimeout(safetyTimer);
    if (transportRecord.reconnecting && reconnectAgentRun(runSessionId, runRecord, transportRecord)) return;
    runRecord.active = false;
    runRecord.status = projection.completedNormally ? "completed" : (runRecord.cancelRequested ? "cancelled" : (runRecord.status || "failed"));
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
    if (projection.completedNormally) {
      notifyDesktopConversationCompleted();
      void refreshDailyUsage({ force: true, reason: `${runMode}-run-completed` });
    }
  }
}

function normalizeContextUsage(value, selectedModel = state.selectedModel) {
  const source = ["real", "unavailable"].includes(value?.source) ? value.source : "unavailable";
  const tokens = Math.max(0, Number(value?.used_tokens) || 0);
  const rawLimit = Math.max(0, Number(value?.context_limit) || 0);
  const capacity = modelCapacityMetadata(selectedModel);
  const reportedStatus = String(value?.capacity_status || value?.model_capacity?.status || "").toLowerCase();
  const reportedModel = String(value?.model || "");
  const trustedReportedLimit = reportedStatus === "verified" && rawLimit > 0 && (!reportedModel || reportedModel === String(selectedModel || ""));
  const limit = capacity.status === "verified" ? capacity.limit : (trustedReportedLimit ? rawLimit : 0);
  const effectiveWindow = limit;
  const ratio = limit ? Math.min(tokens / limit, 1) : 0;
  return {
    used_tokens: tokens,
    context_limit: limit,
    effective_context_window: effectiveWindow,
    ratio,
    source,
    updated_at: Number(value?.updated_at) || 0,
    model: reportedModel || String(selectedModel || ""),
    capacity_status: capacity.status,
    capacity_source: capacity.source,
    capacity_source_url: capacity.sourceUrl,
    max_output_tokens: capacity.maxOutputTokens,
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
  const capacity = modelCapacityMetadata(state.selectedModel);
  const limit = capacity.status === "verified" ? capacity.limit : 0;
  const ratio = limit ? Math.min(tokens / limit, 1) : 0;
  const autoCompactThreshold = usage.effective_auto_compact_threshold || DEFAULT_AUTO_COMPACT_THRESHOLD;
  return {
    tokens,
    limit,
    effectiveContextWindow: limit,
    ratio,
    autoCompactThreshold,
    percent: Math.round(ratio * 100),
    source: usage.source,
    capacityStatus: capacity.status,
    capacitySource: capacity.source,
    capacitySourceUrl: capacity.sourceUrl,
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
  const sourceLabels = { real: "Provider 实际用量", unavailable: "不可用" };
  const usageTooltip = stats.available
    ? `已用 ${number.format(stats.tokens)} / ${number.format(stats.limit)} 令牌 · ${stats.percent}% · 来源：${sourceLabels[stats.source] || "不可用"}`
    : (stats.capacityStatus === "unknown"
      ? `模型 ${state.selectedModel || "当前模型"} 的部署上下文容量未知，无法计算占用比例`
      : "上下文用量暂不可用");
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
  $("#context-label").textContent = stats.available
    ? `上下文窗口已用 ${stats.percent}%`
    : (stats.capacityStatus === "unknown" ? "模型上下文容量未知" : "上下文用量暂不可用");
  meter.title = usageTooltip;
  meter.setAttribute("aria-label", meter.title);

  $("#context-usage-detail").textContent = stats.available
    ? `${number.format(stats.tokens)} / ${number.format(stats.limit)} 令牌（${stats.percent}%）`
    : (stats.capacityStatus === "unknown" ? `${number.format(stats.tokens)} 令牌已记录；模型容量未知` : "暂时没有真实用量");
  $("#context-usage-source").textContent = stats.capacityStatus === "unknown"
    ? `容量来源：${stats.capacitySource || "未找到可信部署元数据"}`
    : `来源：${sourceLabels[stats.source] || "不可用"}`;

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
  const previousStatus = runRecord.status;
  const previousInteraction = runRecord.pendingInteraction;
  const previouslyWaiting = runRecord.waitingInput;
  runRecord.cancelRequested = true;
  runRecord.pendingInteraction = null;
  runRecord.waitingInput = false;
  SessionRunRegistry.update(runSessionId, { cancelRequested: true, pendingInteraction: null, waitingInput: false, status: "cancelled" });
  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(runSessionId)}/cancel`, { method: "POST" });
    if (!response.ok) throw new Error(`停止请求失败（${response.status}）`);
  } catch (error) {
    runRecord.cancelRequested = false;
    SessionRunRegistry.update(runSessionId, { cancelRequested: false, status: previousStatus, pendingInteraction: previousInteraction, waitingInput: previouslyWaiting });
    showInlineStatus(error.message || "暂时无法停止后台任务，请重试", { kind: "error", sessionId: runSessionId });
    return;
  }

  if (transportRecord?.abortController) {
    transportRecord.abortController.abort();
  }
  // A user can cancel while a reconnect timer owns no active HTTP reader.
  // The acknowledged backend cancel must still unlock the composer.
  SessionRunRegistry.finish(runSessionId, "cancelled");
  if (String(state.sessionId) === runSessionId) syncCurrentSessionRuntimeUi();
}

function autoResize(element) {
  element.style.height = "auto";
  element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
}

function handleFileAttach() {
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
  state.contextFilesByMode[state.viewMode === "claude" ? "claude" : "viniper"] = state.contextFiles;
  renderContextFiles();
}

function attachFiles(fileList) {
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
    event.preventDefault();
    dragDepth += 1;
    document.body.classList.add("drag-over");
  });

  window.addEventListener("dragover", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });

  window.addEventListener("dragleave", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) document.body.classList.remove("drag-over");
  });

  window.addEventListener("drop", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    document.body.classList.remove("drag-over");
    attachFiles(event.dataTransfer?.files || []);
  });
}

function bindClipboardPaste() {
  window.addEventListener("paste", (event) => {
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
  const token = modeProjectionToken(state.viewMode, state.sessionId);
  try {
    const mode = encodeURIComponent(state.viewMode);
    const [skillsResponse, pluginsResponse] = await Promise.all([
      fetch(`/api/skills?mode=${mode}`),
      fetch(`/api/plugins?mode=${mode}`),
    ]);
    const data = await skillsResponse.json();
    const pluginData = await pluginsResponse.json().catch(() => ({}));
    if (!modeProjectionIsCurrent(token)) return;
    state.skills = data.skills || [];
    state.plugins = pluginData.plugins || [];
    renderSkillCategories();
    renderSkillList();
    renderPluginList(pluginData);
  } catch {
    if (!modeProjectionIsCurrent(token)) return;
    state.skills = [];
    state.plugins = [];
    renderPluginList({ status: "unavailable" });
  }
}

function renderPluginList(snapshot = {}) {
  const list = $("#plugins-list");
  const label = $("#plugins-engine-label");
  if (!list) return;
  if (label) label.textContent = state.viewMode === "claude" ? "Claude code" : "Viniper";
  list.innerHTML = state.plugins.length
    ? state.plugins.map((plugin) => `<article class="plugin-card"><strong>${escapeHtml(plugin.name || plugin.id || "插件")}</strong><span>${escapeHtml(plugin.status || "available")}</span></article>`).join("")
    : `<p class="workspace-unavailable">${snapshot.status === "unavailable" ? "当前引擎未提供可验证的插件目录。" : "当前引擎尚未发现插件。"}</p>`;
}

function setSkillsSurfaceActive(active) {
  const main = $("#main");
  const conversation = $("#conversation-container");
  const messages = $("#messages");
  const input = $("#input-area");
  const dock = $("#interaction-dock");
  if (active && !main?.classList.contains("skills-view-active")) {
    state.skillsViewRestore = {
      sessionId: state.sessionId,
      scrollTop: conversation?.scrollTop || 0,
    };
  }
  main?.classList.toggle("skills-view-active", Boolean(active));
  for (const node of [conversation, messages, input, dock]) {
    if (!node) continue;
    node.inert = Boolean(active);
    if (active) node.setAttribute("aria-hidden", "true");
    else node.removeAttribute("aria-hidden");
  }
  if (!active) {
    const restore = state.skillsViewRestore;
    if (restore && String(restore.sessionId || "") === String(state.sessionId || "") && conversation) {
      conversation.scrollTop = Number(restore.scrollTop) || 0;
    }
    state.skillsViewRestore = null;
  }
}

function openSkillsView({ history = true, recordLocation = true } = {}) {
  const view = $("#skills-view");
  if (!view) return;
  closeSettingsModal({ restoreNavigation: false });
  setSkillsSurfaceActive(true);
  view.classList.remove("hidden");
  view.dataset.page = "list";
  view.dataset.mode = state.viewMode;
  const heading = view.querySelector("h1");
  const description = view.querySelector(".subtle");
  if (heading) heading.textContent = state.viewMode === "claude" ? "Claude code 技能与插件" : "Viniper 技能与插件";
  if (description) description.textContent = state.viewMode === "claude" ? "仅浏览 Claude Code 原生技能来源。" : "仅浏览 Viniper Harness 的独立技能来源。";
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
        <span class="skill-card-meta"><span class="skill-cat">${escapeHtml(skill.display_category || "本地技能")}</span><span class="skill-claude-status" data-state="${escapeAttr(skill.availability?.state || "available")}">${escapeHtml(skill.availability?.label || "当前引擎")}</span></span>
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
  const response = await fetch(`/api/skills/${encodeURIComponent(filename)}?mode=${encodeURIComponent(state.viewMode)}`);
  if (!response.ok) {
    showSkillList();
    setNavigationLocation({ kind: "skills" }, { push: false });
    return false;
  }
  const data = await response.json();
  const status = data.availability || {state: "unavailable", label: "不可用", detail: "当前引擎未发现该技能"};
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
    useButton.title = status.state === "available" ? "在当前引擎中使用此技能" : (status.detail || "该技能当前不可用");
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
  const container = $("#conversation-container");
  if (!container) return true;
  return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
}

function scrollBottom({ force = false } = {}) {
  requestAnimationFrame(() => {
    const container = $("#conversation-container");
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
    createRunEventProjection,
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
