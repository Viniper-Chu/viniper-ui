const statusLabels = {
  idle: "就绪",
  running: "运行中",
  queued: "排队中",
  waiting: "等待消息",
  cancelled: "已取消",
  failed: "失败",
};

const typeLabels = { message: "消息", delegation: "委派", result: "结果" };
const envelopeStatusLabels = { sent: "已发送", delivered: "已送达", read: "已读", completed: "已完成" };

export function renderCoordination(elements, state, actions) {
  const active = state.sessions.find((session) => session.id === state.activeSessionId);
  const activeEngine = active?.engineId ?? "viniper";
  const sessions = state.sessions.filter((session) => (session.engineId ?? "viniper") === activeEngine);
  const engineState = { ...state, sessions };
  renderConstellation(elements.constellation, engineState, actions.activate);
  renderCompact(elements.compact, engineState);
  renderTargets(elements.target, sessions, state.activeSessionId);
  renderInbox(elements.inbox, state.coordination.envelopes, active, actions.markRead);
  elements.waitState.textContent = active?.waitingFor
    ? `正在等待${active.waitingFor.fromSessionId ? "指定会话" : "任一会话"}的${active.waitingFor.envelopeType ? typeLabels[active.waitingFor.envelopeType] : "新消息"}`
    : "当前没有等待条件。";
  elements.cancelWait.disabled = !active?.waitingFor;
}

function renderConstellation(root, state, activate) {
  root.replaceChildren();
  for (const session of state.sessions) {
    const unread = state.coordination.unreadBySession.find((item) => item.sessionId === session.id)?.count ?? 0;
    const node = document.createElement("button");
    node.type = "button";
    node.className = `constellation-node ${session.status} ${session.id === state.activeSessionId ? "active" : ""}`;
    node.setAttribute("aria-label", `${session.title}，${statusLabels[session.status] ?? session.status}${unread ? `，${unread} 条未读协作` : ""}`);
    const dot = document.createElement("span");
    dot.className = "constellation-dot";
    dot.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = session.title;
    const meta = document.createElement("small");
    meta.textContent = `${statusLabels[session.status] ?? session.status}${unread ? ` · ${unread} 未读` : ""}`;
    copy.append(title, meta);
    node.append(dot, copy);
    node.addEventListener("click", () => activate(session.id));
    root.append(node);
  }
  if (!state.sessions.length) root.textContent = "暂无会话。";
}

function renderCompact(root, state) {
  root.replaceChildren();
  for (const session of state.sessions.slice(0, 5)) {
    const item = document.createElement("span");
    item.className = `compact-session-state ${session.status}`;
    item.textContent = `${session.title} · ${statusLabels[session.status] ?? session.status}`;
    root.append(item);
  }
}

function renderTargets(select, sessions, activeId) {
  const selected = select.value;
  select.replaceChildren();
  for (const session of sessions.filter((item) => item.id !== activeId)) {
    const option = document.createElement("option");
    option.value = session.id;
    option.textContent = session.title;
    select.append(option);
  }
  if ([...select.options].some((option) => option.value === selected)) select.value = selected;
}

function renderInbox(root, envelopes, active, markRead) {
  root.replaceChildren();
  if (!active) return;
  const relevant = envelopes
    .filter((envelope) => envelope.sourceSessionId === active.id || envelope.targetSessionId === active.id)
    .slice(-12)
    .reverse();
  for (const envelope of relevant) {
    const incoming = envelope.targetSessionId === active.id;
    const item = document.createElement("article");
    item.className = `envelope-item ${incoming ? "incoming" : "outgoing"}`;
    const heading = document.createElement("div");
    heading.className = "envelope-heading";
    const label = document.createElement("strong");
    label.textContent = `${incoming ? "收到" : "发出"}${typeLabels[envelope.type]}`;
    const status = document.createElement("span");
    status.textContent = envelopeStatusLabels[envelope.status] ?? envelope.status;
    heading.append(label, status);
    const body = document.createElement("p");
    body.textContent = envelope.body;
    item.append(heading, body);
    if (incoming && envelope.status === "delivered") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "text-button";
      button.textContent = "已读";
      button.setAttribute("aria-label", "标为已读");
      button.title = "标为已读";
      button.dataset.tooltip = "标为已读";
      button.addEventListener("click", () => markRead(envelope.id));
      item.append(button);
    }
    root.append(item);
  }
  if (!relevant.length) {
    const empty = document.createElement("p");
    empty.className = "empty-copy";
    empty.textContent = "还没有跨会话消息。可以先创建第二个会话。";
    root.append(empty);
  }
}
