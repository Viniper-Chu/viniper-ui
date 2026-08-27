const statusLabels = {
  idle: "就绪",
  running: "运行中",
  queued: "排队中",
  waiting: "等待消息",
  cancelled: "已取消",
  failed: "失败",
};

export function renderSessionList(root, sessions, activeSessionId, actions) {
  root.replaceChildren();
  const visible = stableSessions(sessions.slice(0, 200));
  const defaultSessions = visible.filter((session) => session.projectAccess?.enabled !== true);
  const projectGroups = new Map();
  for (const session of visible.filter((item) => item.projectAccess?.enabled === true)) {
    const label = projectName(session.workingDirectory);
    const group = projectGroups.get(label) ?? [];
    group.push(session);
    projectGroups.set(label, group);
  }
  for (const group of [
    { label: "默认会话", sessions: defaultSessions },
    ...[...projectGroups.entries()].map(([label, items]) => ({ label, sessions: stableSessions(items) })),
  ]) {
    if (!group.sessions.length) continue;
    const heading = document.createElement("div");
    heading.className = "session-group-label";
    heading.textContent = group.label;
    root.append(heading);
    for (const session of group.sessions) appendSession(root, session, activeSessionId, actions);
  }
}

function appendSession(root, session, activeSessionId, actions) {
    const item = document.createElement("article");
    item.className = `session-item ${session.id === activeSessionId ? "active" : ""}`;

    const main = document.createElement("button");
    main.type = "button";
    main.className = "session-main";
    main.innerHTML = `<span class="session-status-mark ${session.status}" aria-hidden="true"></span><span class="session-copy"><span class="session-title"></span><span class="session-meta"></span></span>`;
    main.setAttribute("aria-label", `${session.title}，${statusLabels[session.status] ?? session.status}`);
    main.querySelector(".session-title").textContent = session.title;
    const project = session.projectAccess?.enabled ? projectName(session.workingDirectory) : "本地会话";
    main.querySelector(".session-meta").textContent = `${project}${session.queue.length ? ` · ${session.queue.length} 条排队` : ""}`;
    main.title = session.projectAccess?.enabled ? session.workingDirectory : "未打开项目";
    main.addEventListener("click", () => actions.activate(session.id));

    const controls = document.createElement("details");
    controls.className = "session-actions";
    controls.innerHTML = `<summary class="session-actions-trigger" aria-label="会话操作" title="会话操作"><span aria-hidden="true">···</span></summary><div class="session-actions-menu"><button class="session-action" type="button" aria-label="置顶会话"></button><button class="session-action" type="button" aria-label="重命名会话"></button><button class="session-action" type="button" aria-label="删除会话"></button></div>`;
    const [pin, rename, remove] = controls.querySelectorAll("button");
    pin.innerHTML = sessionIcon(session.pinned ? "pin-filled" : "pin");
    pin.setAttribute("aria-label", session.pinned ? "取消置顶" : "置顶会话");
    pin.title = pin.getAttribute("aria-label");
    pin.dataset.tooltip = pin.title;
    pin.addEventListener("click", () => { controls.open = false; actions.pin(session.id); });
    rename.title = "重命名会话";
    rename.dataset.tooltip = "重命名";
    rename.addEventListener("click", () => { controls.open = false; actions.rename(session, rename); });
    remove.title = "删除会话";
    remove.dataset.tooltip = "删除会话";
    remove.addEventListener("click", () => { controls.open = false; actions.remove(session, remove); });
    rename.innerHTML = sessionIcon("rename");
    remove.innerHTML = sessionIcon("remove");

    item.append(main, controls);
    root.append(item);
}

function stableSessions(sessions) {
  return [...sessions].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    return right.createdAt - left.createdAt;
  });
}

function projectName(workingDirectory) {
  return workingDirectory.split(/[\\/]+/u).filter(Boolean).at(-1) ?? workingDirectory;
}

function sessionIcon(name) {
  const paths = {
    pin: '<path d="m12 3 2.4 5.1 4.6.7-3.3 3.7.8 5.5-4.5-2.5-4.5 2.5.8-5.5L5 8.8l4.6-.7L12 3Z"></path>',
    "pin-filled": '<path fill="currentColor" d="m12 3 2.4 5.1 4.6.7-3.3 3.7.8 5.5-4.5-2.5-4.5 2.5.8-5.5L5 8.8l4.6-.7L12 3Z"></path>',
    rename: '<path d="m4 16.8-.7 3.9 3.9-.7L18 9.2 14.8 6 4 16.8Z"></path><path d="m13.7 7.1 3.2 3.2M15.7 5.1l3.2 3.2"></path>',
    remove: '<path d="M6 7h12M10 7V5h4v2m-7 0 .7 12h8.6L17 7M10 11v5m4-5v5"></path>',
  };
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}
