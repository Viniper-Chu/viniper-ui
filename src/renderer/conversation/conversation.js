const statusLabels = {
  idle: "就绪",
  running: "思考中",
  queued: "排队中",
  waiting: "等待中",
  cancelled: "已取消",
  failed: "失败",
  completed: "已完成",
};

const toolStatusLabels = {
  pending: "进行中",
  success: "已完成",
  error: "失败",
  cancelled: "已取消",
};

/**
 * Project the persisted RuntimeEvent/AppSnapshot shape into the single
 * conversation view model. The renderer never talks to the database and
 * does not maintain a second event state machine; reducer-owned session data
 * remains the source of truth after restart as well as during a run.
 */
export function projectConversationSegments(session, options = {}) {
  const events = [...(session?.events ?? [])].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  const messages = (session?.messages ?? []).map((message) => ({
    ...message,
    segments: messageSegments(message, events),
  }));
  const activities = projectActivityTimeline(session, events).map((activity) => ({
    ...activity,
    presentation: activity.presentation ? { ...activity.presentation } : undefined,
    traceStatus: traceStatus(activity.status),
  }));
  const runs = options.runs ?? [];
  const sessionRuns = runs.filter((run) => run.sessionId === session?.id);
  const runEvents = events.filter((event) => ["run.started", "run.completed", "run.cancelled", "run.failed"].includes(event.type));
  const activeRunIds = new Set(session?.activeRunIds ?? (session?.activeRunId ? [session.activeRunId] : []));
  const activeRun = sessionRuns.find((run) => activeRunIds.has(run.runId)) ?? sessionRuns.find((run) => run.status === "running");
  const latestRun = activeRun ?? [...sessionRuns].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
  const durationMs = runDuration(session, latestRun, runEvents, options.now ?? Date.now());
  const turnId = latestRun?.runId ?? session?.activeRunId;
  const usage = turnUsage(events, turnId, options.telemetry, session?.id);
  const plan = canonicalPayload(events, "plan.updated", turnId, "plan") ?? session?.plan;
  const turnDiff = canonicalPayload(events, "turn.diff.updated", turnId, "diff") ?? session?.turnDiff;
  const viewStatus = conversationStatus(session, activities, latestRun);
  return {
    messages,
    activities,
    usage,
    plan,
    turnDiff,
    durationMs,
    traceStatus: viewStatus,
    traceLabel: viewStatus === "pending" ? "正在思考" : viewStatus === "failed" ? "运行失败" : "思考与工具",
    traceSummary: summaryText(durationMs, usage),
    artifacts: [...activities].filter((activity) => activity.presentation?.kind?.startsWith("project-")),
    eventCount: events.length,
    source: "canonical-runtime-snapshot",
  };
}

export function renderConversation(messageList, emptyState, session, providerLabel = "Agent", options = {}) {
  const view = projectConversationSegments(session, options);
  const shell = messageList.closest("[data-conversation-shell]");
  if (shell) {
    shell.dataset.traceStatus = view.traceStatus;
    shell.dataset.eventCount = String(view.eventCount);
  }
  messageList.replaceChildren();
  emptyState.classList.toggle("hidden", view.messages.length > 0);
  const latestUserIndex = view.messages.findLastIndex((message) => message.role === "user");
  let traceInserted = false;
  const trace = buildTrace(view, providerLabel);
  for (const [index, message] of view.messages.entries()) {
    if (!traceInserted && index > latestUserIndex && message.role === "assistant") {
      messageList.append(trace);
      traceInserted = true;
    }
    messageList.append(renderMessage(message, providerLabel));
  }
  if (!traceInserted && view.messages.length) messageList.append(trace);
  if (view.messages.length) messageList.prepend(buildMessageTraceRail(view));
  const scroller = document.querySelector("#conversation");
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
}

function messageSegments(message, events) {
  const deltas = events
    .filter((event) => event.type === "message.delta" && event.payload?.messageId === message.id)
    .map((event) => event.payload?.text)
    .filter((text) => typeof text === "string" && text.length > 0);
  if (deltas.length) return deltas;
  return message.text ? splitOutput(message.text) : [];
}

/**
 * Canonical event projection used when a restored snapshot has not yet
 * materialised its activity array. This mirrors Viniper's MessageStreamStore
 * grouping (thinking/tool start + terminal result) without creating renderer
 * state: each render starts from the immutable snapshot and event journal.
 */
function projectActivityTimeline(session, events) {
  const source = Array.isArray(session?.activities) ? session.activities : [];
  const activities = source.map((activity) => ({
    ...activity,
    presentation: activity.presentation ? { ...activity.presentation } : undefined,
  }));
  const byId = new Map(activities.map((activity) => [String(activity.id), activity]));
  const byCallId = new Map(activities.filter((activity) => activity.callId).map((activity) => [String(activity.callId), activity]));
  const textValue = (value) => typeof value === "string" ? value : "";
  const payloadText = (payload) => textValue(payload?.detail ?? payload?.text ?? payload?.summary ?? payload?.result);
  const ensure = (event, defaults) => {
    const payload = event.payload ?? {};
    const id = String(payload.activityId ?? payload.activity_id ?? payload.callId ?? payload.call_id ?? event.id);
    const callId = payload.callId ?? payload.call_id;
    let activity = byId.get(id) ?? (callId ? byCallId.get(String(callId)) : undefined);
    if (!activity) {
      activity = {
        id,
        ...defaults,
        runId: payload.runId ?? payload.run_id,
        callId,
        createdAt: event.timestamp ?? Date.now(),
      };
      activities.push(activity);
      byId.set(id, activity);
      if (callId) byCallId.set(String(callId), activity);
    }
    return activity;
  };
  for (const event of events) {
    const payload = event.payload ?? {};
    if (event.type === "thinking.started") {
      ensure(event, { kind: "thinking", title: textValue(payload.title) || "思考", detail: payloadText(payload), status: "running" });
    } else if (event.type === "thinking.delta") {
      const activity = ensure(event, { kind: "thinking", title: "思考", detail: "", status: "running" });
      if (!source.length) activity.detail = `${activity.detail ?? ""}${payloadText(payload)}`;
    } else if (event.type === "thinking.completed") {
      ensure(event, { kind: "thinking", title: "思考", detail: "", status: "completed" }).status = "completed";
    } else if (event.type === "tool.requested") {
      const activity = ensure(event, {
        kind: "tool",
        title: textValue(payload.toolName ?? payload.tool_name) || "工具",
        toolName: textValue(payload.toolName ?? payload.tool_name),
        detail: payloadText(payload),
        status: "running",
      });
      activity.kind = "tool";
      activity.status = activity.status === "completed" ? activity.status : "running";
    } else if (["tool.completed", "tool.failed", "tool.cancelled"].includes(event.type)) {
      const activity = ensure(event, { kind: "tool", title: "工具", detail: "", status: "running" });
      activity.kind = "tool";
      activity.status = event.type === "tool.completed" ? "completed" : event.type === "tool.cancelled" ? "cancelled" : "failed";
      const detail = payloadText(payload);
      if (detail) activity.detail = detail;
      if (payload.presentation && typeof payload.presentation === "object") activity.presentation = { ...payload.presentation };
    } else if (event.type === "interaction.requested") {
      ensure(event, { kind: "interaction", title: textValue(payload.title) || "需要确认", detail: payloadText(payload), status: "waiting" });
    } else if (event.type === "interaction.resolved") {
      ensure(event, { kind: "interaction", title: "需要确认", detail: "", status: "completed" }).status = "completed";
    }
  }
  return activities;
}

function splitOutput(text) {
  return String(text).split(/(?<=\n)/u).filter(Boolean);
}

function conversationStatus(session, activities, latestRun) {
  if (activities.some((activity) => activity.traceStatus === "pending")) return "pending";
  if (session?.status === "failed" || latestRun?.status === "failed") return "failed";
  if (activities.length || (session?.messages ?? []).length) return "completed";
  return "idle";
}

function traceStatus(status) {
  if (status === "running" || status === "waiting") return "pending";
  if (status === "failed") return "error";
  if (status === "cancelled") return "cancelled";
  return "success";
}

function runDuration(session, run, runEvents, now) {
  const runId = run?.runId ?? session?.activeRunId;
  const started = run?.createdAt
    ?? runEvents.find((event) => event.type === "run.started" && (!runId || event.payload?.runId === runId))?.timestamp;
  if (!started) return 0;
  const terminal = runEvents.find((event) => ["run.completed", "run.cancelled", "run.failed"].includes(event.type)
    && (!runId || event.payload?.runId === runId));
  const ended = terminal?.timestamp ?? run?.updatedAt ?? now;
  return Math.max(0, ended - started);
}

function turnUsage(events, turnId, telemetry, sessionId) {
  const usage = canonicalPayload(events, "turn.usage.updated", turnId, "usage");
  if (usage) return { total: Number(usage.total) || 0, source: usage.source ?? "estimated", ...usage };
  return legacySessionUsage(telemetry, sessionId);
}

function legacySessionUsage(telemetry, sessionId) {
  const item = telemetry?.sessions?.find((summary) => summary.sessionId === sessionId);
  const usage = item?.currentRun?.usage ?? item?.latestRun?.usage ?? item?.cumulative;
  if (!usage) return { total: 0, source: "unknown" };
  return { total: Number(usage.total) || 0, source: usage.source ?? "estimated" };
}

function canonicalPayload(events, type, turnId, field) {
  const candidates = events.filter((event) => event.type === type
    && (!turnId || event.turnId === turnId || event.payload?.runId === turnId));
  return [...candidates].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))[0]?.payload?.[field];
}

function summaryText(durationMs, usage) {
  const parts = [];
  if (durationMs > 0) parts.push(formatDuration(durationMs));
  if (usage.total > 0) parts.push(`${formatCount(usage.total)} tokens${usage.source === "provider" ? " · Provider" : " · 估算"}`);
  return parts.join(" · ") || "本轮状态已从事件恢复";
}

function buildTrace(view, providerLabel) {
  const trace = document.createElement("details");
  trace.className = `thinking-panel reasoning-block ${view.traceStatus}`;
  trace.dataset.traceSource = view.source;
  trace.dataset.traceStatus = view.traceStatus;
  trace.open = view.traceStatus === "pending";
  const summary = document.createElement("summary");
  summary.className = "thinking-panel-summary";
  const pulse = document.createElement("span");
  pulse.className = "reasoning-pulse thinking-panel-pulse thinking-icon";
  const title = document.createElement("strong");
  title.className = "thinking-label";
  title.textContent = view.traceStatus === "pending" ? `${providerLabel} 正在思考` : view.traceLabel;
  const meta = document.createElement("span");
  meta.className = "thinking-summary-meta thinking-preview thinking-time";
  meta.textContent = view.traceSummary;
  summary.append(pulse, title, meta);
  const body = document.createElement("div");
  body.className = "thinking-panel-body reasoning-content";
  if (view.plan?.steps?.length) body.append(renderPlanCard(view.plan));
  if (view.turnDiff?.files?.length || view.turnDiff?.patch) body.append(renderTurnDiffCard(view.turnDiff));
  for (const activity of view.activities) body.append(renderTraceActivity(activity));
  if (!view.activities.length) {
    const pending = document.createElement("p");
    pending.className = "reasoning-copy thinking-empty-copy";
    pending.textContent = view.traceStatus === "pending" ? "Agent 正在准备执行。" : "本轮没有额外的思考或工具事件。";
    body.append(pending);
  }
  const completedSummary = document.createElement("div");
  completedSummary.className = "thinking-complete-summary message-total-time";
  const summaryLabel = document.createElement("span");
  summaryLabel.textContent = view.traceStatus === "pending" ? "实时轨迹" : "本轮完成";
  const summaryValue = document.createElement("strong");
  summaryValue.textContent = view.traceSummary;
  completedSummary.append(summaryLabel, summaryValue);
  body.append(completedSummary);
  trace.append(summary, body);
  return trace;
}

function renderPlanCard(plan) {
  const card = document.createElement("section");
  card.className = "runtime-plan-card";
  const heading = document.createElement("header");
  const title = document.createElement("strong");
  title.textContent = "计划";
  const progress = document.createElement("span");
  const completed = plan.steps.filter((step) => step.status === "completed").length;
  progress.textContent = `${completed} / ${plan.steps.length}`;
  heading.append(title, progress);
  card.append(heading);
  if (plan.explanation) {
    const explanation = document.createElement("p");
    explanation.textContent = plan.explanation;
    card.append(explanation);
  }
  const list = document.createElement("ol");
  for (const step of plan.steps) {
    const item = document.createElement("li");
    item.className = `runtime-plan-step ${step.status}`;
    const mark = document.createElement("span");
    mark.textContent = step.status === "completed" ? "✓" : step.status === "in_progress" ? "◌" : step.status === "blocked" ? "!" : "○";
    const label = document.createElement("span");
    label.textContent = step.step;
    item.append(mark, label);
    list.append(item);
  }
  card.append(list);
  return card;
}

function renderTurnDiffCard(diff) {
  const card = document.createElement("details");
  card.className = "runtime-diff-card";
  const summary = document.createElement("summary");
  const additions = (diff.files ?? []).reduce((total, file) => total + (Number(file.additions) || 0), 0);
  const deletions = (diff.files ?? []).reduce((total, file) => total + (Number(file.deletions) || 0), 0);
  summary.textContent = `${diff.summary || "文件已修改"}  +${additions} -${deletions}`;
  card.append(summary);
  const files = document.createElement("div");
  files.className = "runtime-diff-files";
  for (const file of diff.files ?? []) {
    const row = document.createElement("span");
    row.textContent = `${file.path}  +${file.additions || 0} -${file.deletions || 0}`;
    files.append(row);
  }
  card.append(files);
  if (diff.patch) {
    const patch = document.createElement("pre");
    patch.className = "runtime-diff-patch";
    patch.textContent = diff.patch;
    card.append(patch);
  }
  return card;
}

function renderTraceActivity(activity) {
  if (activity.kind === "tool") return renderToolSummary(activity);
  if (activity.presentation?.kind?.startsWith("project-")) return renderArtifactSummary(activity);
  const row = document.createElement("article");
  row.className = `reasoning-step thinking-step ${activity.kind} ${activity.traceStatus}`;
  const mark = document.createElement("span");
  mark.className = "reasoning-step-mark";
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.className = "thinking-step-title";
  title.textContent = activity.title;
  const detail = document.createElement("p");
  detail.className = "reasoning-copy thinking-step-detail";
  detail.textContent = activity.detail || statusLabels[activity.status] || "";
  copy.append(title, detail);
  const status = document.createElement("span");
  status.className = "reasoning-step-status";
  status.textContent = statusLabels[activity.status] ?? activity.status;
  row.append(mark, copy, status);
  return row;
}

function renderToolSummary(activity) {
  const status = activity.traceStatus;
  const row = document.createElement("article");
  row.className = `tool-summary tool-summary-${status}`;
  row.dataset.activityId = activity.id;
  const icon = document.createElement("span");
  icon.className = "tool-summary-icon tool-status-dot";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = status === "success" ? "✓" : status === "error" ? "!" : status === "cancelled" ? "!" : "·";
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.className = "tool-summary-name";
  title.textContent = activity.toolName || activity.title;
  const detail = document.createElement("p");
  detail.className = "tool-summary-detail";
  detail.textContent = activity.detail || toolStatusLabels[status];
  copy.append(title, detail);
  const state = document.createElement("span");
  state.className = "tool-summary-status";
  state.textContent = toolStatusLabels[status] ?? status;
  row.append(icon, copy, state);
  if (activity.presentation?.kind?.startsWith("project-")) row.append(renderArtifactSummary(activity));
  return row;
}

function renderArtifactSummary(activity) {
  const presentation = activity.presentation ?? {};
  const row = document.createElement("div");
  row.className = "artifact-summary";
  const label = document.createElement("span");
  label.className = "artifact-summary-path";
  label.textContent = presentation.summary || activity.detail || "项目产物";
  const paths = document.createElement("small");
  paths.textContent = Array.isArray(presentation.paths) ? presentation.paths.join(" · ") : "";
  row.append(label, paths);
  return row;
}

function renderMessage(message, providerLabel) {
  const row = document.createElement("article");
  row.className = `message ${message.role} ${message.status === "streaming" ? "streaming" : ""}`;
  row.dataset.messageId = message.id;
  const header = document.createElement("header");
  header.className = "message-heading msg-header";
  const label = document.createElement("strong");
  label.textContent = message.role === "user" ? "你" : providerLabel;
  const time = document.createElement("span");
  time.textContent = formatTime(message.createdAt);
  header.append(label, time);
  const text = document.createElement("div");
  text.className = "message-text msg-content";
  for (const [index, segment] of message.segments.entries()) {
    const part = document.createElement("span");
    part.className = "message-segment msg-text-segment";
    part.dataset.segment = String(index);
    part.textContent = segment;
    text.append(part);
  }
  row.append(header, text);
  return row;
}

function buildMessageTraceRail(view) {
  const rail = document.createElement("nav");
  rail.className = "message-trace-rail";
  rail.setAttribute("aria-label", "消息轨迹");
  const track = document.createElement("div");
  track.className = "message-trace-track";
  view.messages.forEach((message, index) => {
    const tick = document.createElement("button");
    tick.type = "button";
    tick.className = `message-trace-tick ${message.role}`;
    tick.dataset.traceTarget = message.id;
    tick.title = `${message.role === "user" ? "你" : "Agent"} · ${formatTime(message.createdAt)}`;
    tick.setAttribute("aria-label", tick.title);
    tick.addEventListener("click", () => document.querySelector(`[data-message-id="${cssEscape(message.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
    track.append(tick);
    if (index < view.messages.length - 1) track.append(document.createElement("span"));
  });
  rail.append(track);
  return rail;
}

function cssEscape(value) {
  return String(value).replace(/(["\\])/gu, "\\$1");
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatCount(value) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}
