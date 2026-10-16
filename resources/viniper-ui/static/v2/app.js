import { api, query, state, escape, timeLabel } from "./api.js";
import { ui } from "./ui.js";
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
} from "./conversation.js";
import { showMenu, closeMenu, menuContent, permissionIcon } from "./menus.js";
import {
  loadExtensions,
  renderExtensions,
  showSkill,
  loadTasks,
  taskAction,
  openSchedule,
  loadSettings,
  saveSettings,
} from "./pages.js";
const $ = (s) => document.querySelector(s);
let switchVersion = 0;
let toastTimer;
let busySending = false;
let busySteering = false;
let sessionListMarkup = "";
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
  $("#dialog-actions").innerHTML = onSubmit
    ? `<button class="secondary-button" value="cancel" formnovalidate>取消</button><button class="${danger ? "danger" : "primary"}-button" value="submit">${escape(label)}</button>`
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
      toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  };
  hydrateIcons(d);
  d.showModal();
  d.querySelector("input,textarea")?.focus();
}
export function view(name) {
  state.view = name;
  $("#app").dataset.view = name;
  for (const page of ["chat", "extensions", "tasks", "settings"])
    $(`#${page}-view`).hidden = page !== name;
  document
    .querySelectorAll("[data-view]")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  $("#session-title").textContent =
    name === "chat"
      ? state.session?.name || "新会话"
      : { extensions: "技能与插件", tasks: "目标与任务", settings: "设置" }[
          name
        ];
  $("#project-button").hidden = name !== "chat";
  $("#session-more").hidden = name !== "chat";
  closeMenu();
  if (name === "extensions")
    loadExtensions().catch((e) => toast(e.message, true));
  if (name === "tasks") loadTasks().catch((e) => toast(e.message, true));
  if (name === "settings") loadSettings().catch((e) => toast(e.message, true));
  if (innerWidth <= 860) $("#app").classList.add("sidebar-collapsed");
}
export async function loadStatus() {
  state.status = await api("/api/status?mode=viniper");
  state.model = state.model || state.status.model;
  state.reasoning =
    state.session?.reasoning ||
    state.status.local_agent?.default_reasoning ||
    state.reasoning;
  state.permission =
    state.session?.permission_mode || state.status.permission_mode;
  state.workdir =
    state.session?.workdir ||
    state.status.settings?.workspace?.default_root ||
    "";
  $("#connection-status").textContent = state.status.configured
    ? "模型已配置"
    : "等待配置模型";
  $("#version").textContent = state.status.version;
  if (!state.session) {
    $("#project-name").textContent =
      state.workdir?.split("/").filter(Boolean).at(-1) || "选择工作目录";
    $("#project-button").title = state.workdir;
  }
  applyTheme(state.status.settings?.appearance || {});
  syncComposer();
}
export async function loadSessions() {
  const data = await api("/api/sessions");
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
function renderSessions() {
  const search = $("#session-search").value.toLocaleLowerCase();
  const markup =
    state.sessions
      .filter((s) =>
        `${s.name} ${s.workdir}`.toLocaleLowerCase().includes(search),
      )
      .map(
        (s) =>
          `<button class="session-item${state.session?.session_id === s.id ? " active" : ""}" data-session="${escape(s.id)}" title="${escape(s.name || "未命名会话")}">${icon("chat")}<span>${escape(s.name || "未命名会话")}</span>${s.runtime_state === "running" ? '<i class="session-dot"></i>' : ""}</button>`,
      )
      .join("") || '<div class="section-caption">还没有会话</div>';
  if (markup !== sessionListMarkup) {
    $("#session-list").innerHTML = markup;
    sessionListMarkup = markup;
  }
}
export async function selectSession(id) {
  rememberDraft();
  const generation = ++switchVersion;
  const session = await api(`/api/sessions/${encodeURIComponent(id)}`);
  if (generation !== switchVersion) return;
  state.session = session;
  state.model = (state.status?.models || []).some((m) => m.id === session.model)
    ? session.model
    : state.status?.model;
  state.permission = session.permission_mode;
  state.workdir = session.workdir;
  state.mode = session.task_mode || "execute";
  state.reasoning =
    session.reasoning ||
    state.status?.local_agent?.default_reasoning ||
    "medium";
  view("chat");
  $("#project-name").textContent =
    session.workdir?.split("/").filter(Boolean).slice(-1)[0] || "选择工作目录";
  $("#project-button").title = session.workdir || "";
  $("#prompt").value = state.drafts.get(id) || "";
  renderMessages(session.messages);
  renderSessions();
  syncComposer();
  bottom(true);
  const running = state.runs.get(id);
  if (running?.active) {
    const pendingIndex = session.messages.findLastIndex(message => message.role === "assistant" && message.pending);
    running.node = $("#messages").children[pendingIndex] || null;
    paintRun(running);
  } else if (session.active_run?.active)
    resumeRun(session).catch((e) => toast(e.message, true));
  await refreshGoalBanner();
}
export function newChat() {
  rememberDraft();
  switchVersion++;
  state.session = null;
  state.mode = "execute";
  state.attachments = [];
  state.selectedSkills = [];
  $("#task-banner").hidden = true;
  view("chat");
  $("#session-title").textContent = "新会话";
  $("#project-name").textContent =
    state.workdir?.split("/").filter(Boolean).slice(-1)[0] || "选择工作目录";
  $("#prompt").value = state.drafts.get("new") || "";
  renderMessages([]);
  renderSessions();
  syncComposer();
  $("#prompt").focus();
}
function rememberDraft() {
  state.drafts.set(state.session?.session_id || "new", $("#prompt").value);
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
      permission_mode: state.permission,
      task_mode: mode,
    },
  });
  const created = { ...data, messages: [], task_mode: mode };
  if (generation === switchVersion) {
    state.session = created;
    state.permission = data.permission_mode;
  }
  await loadSessions();
  return created;
}

export function applyTheme(appearance) {
  const theme =
    appearance.theme === "system"
      ? matchMedia("(prefers-color-scheme:dark)").matches
        ? "dark"
        : "light"
      : appearance.theme || "light";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty(
    "--chat-size",
    { small: "14px", normal: "15px", large: "17px" }[appearance.font_size] ||
      "15px",
  );
  window.viniperDesktop
    ?.setTitlebarTheme({
      theme,
      backgroundColor: theme === "dark" ? "#182320" : "#f8faf7",
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
  $("#send-button").disabled = !prompt.value.trim();
  $("#steer-button").disabled = busySteering || !prompt.value.trim();
}
export function syncComposer() {
  const run = state.runs.get(state.session?.session_id),
    active = Boolean(run?.active || state.session?.active_run?.active);
  const permission = (state.status?.permission_modes || []).find(
    (p) => p.id === state.permission,
  );
  $("#permission-label").textContent = permission?.label || "每次询问";
  $("#permission-button").dataset.risk = /full|bypass/.test(state.permission)
    ? "full"
    : /review|read/.test(state.permission)
      ? "read"
      : "normal";
  setMarkup($("#permission-button").querySelector("[data-icon]"), icon(permissionIcon(state.permission)));
  const model = state.status?.models?.find(
    (m) => (m.id || m.value || m.model) === state.model,
  );
  $("#model-label").textContent =
    model?.label || model?.name || state.model || "选择模型";
  $("#reasoning-label").textContent = {
    off: "不思考",
    minimal: "极低",
    low: "低",
    medium: "中",
    high: "高",
  }[state.reasoning] || state.reasoning;
  const u = run?.usage || state.session?.context_usage || {};
  const ratio = Math.max(0, Math.min(1, Number(u.ratio) || 0));
  $("#context-progress").style.strokeDashoffset = 53.407 * (1 - ratio);
  $("#context-button").title = u.used_tokens
    ? `上下文 ${Math.round(ratio * 100)}% · ${u.used_tokens} / ${u.context_limit}`
    : "上下文用量";
  $("#model-button").disabled = active;
  $("#permission-button").disabled = active;
  $("#stop-button").hidden = !active;
  $("#steer-button").hidden = !active;
  $("#send-button").title = active ? "加入待发送队列" : "发送消息";
  $("#send-button").setAttribute(
    "aria-label",
    active ? "加入待发送队列" : "发送消息",
  );
  $("#input-hint").textContent = active
    ? "Enter 排队 · ⌘Enter 引导当前任务"
    : "Enter 发送 · Shift Enter 换行";
  $("#run-status").textContent = run?.interaction
    ? "等待确认"
    : active
      ? run?.steering?.status === "queued"
        ? "正在中断当前步骤，切换到新方向…"
        : run?.message?.working || "等待模型响应"
      : state.mode === "plan"
        ? "规划模式 · 只读调研"
        : state.mode === "goal"
          ? "目标模式 · 持续推进"
          : "准备就绪";
  $("#mode-chip").hidden =
    state.mode === "execute" && !state.selectedSkills.length;
  const selectionLabel = [state.mode === "plan" ? "规划模式" : state.mode === "goal" ? "目标模式" : "",
    ...state.selectedSkills.map(id => {
      const skill = state.skills.find(s => (s.id || s.filename) === id);
      return skill?.display_name || skill?.name || skill?.command || "已选技能";
    })].filter(Boolean).join(" · ");
  setMarkup($("#mode-chip"),
    `${icon(state.mode === "plan" ? "plan" : state.mode === "goal" ? "target" : "plugin")}<span>${escape(selectionLabel)}</span><button data-action="clear-mode" aria-label="清除模式与技能">${icon("close")}</button>`);
  $("#attachments").hidden = !state.attachments.length;
  setMarkup($("#attachments"), state.attachments
    .map(
      (a, i) =>
        `<div class="attachment-chip">${icon("file")}<span>${escape(a.name)}</span><button data-remove-attachment="${i}" aria-label="移除附件 ${escape(a.name)}">${icon("close")}</button></div>`,
    )
    .join(""));
  resizePrompt();
  const pending = run?.interaction || state.session?.pending_interaction;
  $("#interaction").hidden = !pending;
  if (pending) {
    setMarkup($("#interaction"),
      `<h3>需要你的确认</h3><p>${escape(pending.description || pending.summary || pending.tool_name || pending.message || pending.content || "允许执行此操作？")}</p><div class="interaction-actions"><button class="secondary-button" data-permission-answer="reject">拒绝</button><button class="primary-button" data-permission-answer="allow-once">允许这一次</button></div>`);
  }
}
async function send() {
  if (busySending) return;
  const text = $("#prompt").value.trim();
  if (!text) return;
  const generation = switchVersion,
    originalId = state.session?.session_id || "new";
  const controls = {
    mode: state.mode,
    model: state.model,
    permission: state.permission,
    reasoning: state.reasoning,
    skills: [...state.selectedSkills],
    attachments: [...state.attachments],
  };
  const visible = () => generation === switchVersion;
  const clear = () => {
    state.drafts.delete(originalId);
    if (visible()) {
      $("#prompt").value = "";
      $("#prompt").style.height = "";
      state.attachments = [];
      syncComposer();
    }
  };
  busySending = true;
  try {
    const session = await ensureSession(),
      sid = session.session_id;
    if (!visible()) return;
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
          permission_mode: controls.permission,
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
      permission_mode: controls.permission,
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
    const run = newRun(sid, response.headers.get("X-Viniper-Run-Id"));
    run.message.planned = controls.mode === "plan";
    state.runs.set(sid, run);
    if (visible()) {
      appendMessage({ role: "user", content: text });
      run.node = appendMessage(run.message);
      syncComposer();
      bottom(true);
    }
    void consume(response, run);
  } catch (error) {
    toast(error.message, true);
  } finally {
    busySending = false;
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
  const pendingIndex = session.messages?.findLastIndex(message => message.role === "assistant" && message.pending) ?? -1;
  const last = session.messages?.[pendingIndex];
  run.guidanceIds = new Set((session.messages || []).map(message => message.guidance_id).filter(Boolean));
  if (last?.role === "assistant") {
    run.message = { ...run.message, ...last, streaming: true };
    run.message.elapsed = Number(
      last.elapsed_seconds ?? last.elapsed ?? last.turn_usage?.elapsed_seconds ?? 0,
    );
    run.started -= run.message.elapsed * 1000;
    run.node = $("#messages").children[pendingIndex];
  }
  run.sequence = snapshot.sequence || 0;
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
  try {
    await globalThis.AgentStream.readJsonEvents(response.body, (event) => {
      projectEvent(run, event);
      renderer.schedule(run.sessionId, () => {
        paintRun(run);
        syncComposer();
      });
    });
    if (!run.done) {
      const result = await globalThis.AgentStream.confirmRunState(
        fetch,
        run.sessionId,
        run.runId,
      );
      if (result.kind === "active") {
        const next = await fetch(
          `/api/runs/${run.sessionId}/events?${query({ run_id: run.runId, after_sequence: run.sequence })}`,
        );
        return await consume(next, run);
      }
    }
  } catch (error) {
    run.error = true;
    run.message.content += `\n\n连接中断：${error.message}`;
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
  if (!sid) return;
  await api(`/api/runs/${sid}/cancel`, { method: "POST", body: {} });
  toast("正在停止，已完成的操作会保留");
}
async function permissionAnswer(action) {
  const sid = state.session.session_id,
    run = state.runs.get(sid),
    pending = run?.interaction || state.session.pending_interaction;
  await api(`/api/runs/${sid}/interaction`, {
    method: "POST",
    body: {
      action,
      call_id: pending.call_id || pending.request_id,
      run_id: run?.runId || state.session.active_run?.run_id,
    },
  });
  if (run) run.interaction = null;
  state.session.pending_interaction = null;
  syncComposer();
}
async function project() {
  const current = state.session?.workdir || state.workdir;
  const native = window.viniperDesktop?.chooseProject;
  const set = async (workdir) => {
    if (!workdir) return;
    state.workdir = workdir;
    if (state.session) {
      await api(`/api/sessions/${state.session.session_id}`, {
        method: "PUT",
        body: { workdir },
      });
      state.session.workdir = workdir;
    }
    $("#project-name").textContent = workdir.split("/").filter(Boolean).at(-1);
    $("#project-button").title = workdir;
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
async function rename() {
  if (!state.session) return;
  dialog(
    "重命名会话",
    `<label class="field">会话名称<input name="name" value="${escape(state.session.name)}" required maxlength="160"></label>`,
    {
      onSubmit: async (data) => {
        await api(`/api/sessions/${state.session.session_id}`, {
          method: "PUT",
          body: { name: data.get("name") },
        });
        await selectSession(state.session.session_id);
        await loadSessions();
      },
    },
  );
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
  if (action === "attach") $("#file-input").click();
  else if (action === "mode") {
    state.mode = state.mode === value ? "execute" : value;
    syncComposer();
    $("#prompt").focus();
  } else if (action === "permission") {
    const session = state.session;
    if (session) {
      await api(`/api/sessions/${session.session_id}`, {
        method: "PUT",
        body: { permission_mode: value },
      });
      session.permission_mode = value;
    }
    if (state.session === session) {
      state.permission = value;
      syncComposer();
    }
  } else if (action === "model") {
    state.model = value;
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
  } else if (action === "reasoning") {
    state.reasoning = value;
    syncComposer();
  } else if (action === "extensions") view("extensions");
  else if (action === "delete-session") {
    dialog(
      "删除会话",
      `<p>删除“${escape(state.session.name)}”及其会话记录？项目文件会保留。</p>`,
      {
        label: "删除",
        danger: true,
        onSubmit: async () => {
          await api(`/api/sessions/${state.session.session_id}`, {
            method: "DELETE",
          });
          newChat();
          await loadSessions();
        },
      },
    );
  } else if (action === "open-project")
    await openFile(state.session?.workdir || state.workdir);
  else if (action === "plan") await showPlan();
  else await dispatch(action);
}
async function dispatch(action) {
  if (action === "send") return send();
  if (action === "steer") return steer();
  if (action === "stop") return stop();
  if (action === "new-chat") return newChat();
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
  if (action === "refresh-extensions") return loadExtensions();
  if (action === "toggle-skills") {
    state.showAllSkills = !state.showAllSkills;
    return renderExtensions();
  }
  if (action === "new-schedule") return openSchedule();
  if (action === "clear-mode") {
    state.mode = "execute";
    state.selectedSkills = [];
    return syncComposer();
  }
  if (action === "implement-plan") {
    state.mode = "execute";
    syncComposer();
    $("#prompt").value = "按刚才的计划开始实施，完成后验证结果。";
    resizePrompt();
    $("#prompt").focus();
  }
}
async function click(event) {
  const b = event.target.closest("button,a");
  if (!b) return;
  try {
    if (b.dataset.cancelQueue) {
      await api(
        `/api/runs/${state.session.session_id}/queue/${b.dataset.cancelQueue}`,
        { method: "DELETE" },
      );
      b.closest(".queued-message").remove();
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
      $("#prompt").value = b.dataset.prompt;
      resizePrompt();
      rememberDraft();
      $("#prompt").focus();
      return;
    }
    if (b.dataset.removeAttachment !== undefined) {
      state.attachments.splice(Number(b.dataset.removeAttachment), 1);
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
      const plugin = state.plugins.find((p) => p.id === b.dataset.plugin);
      dialog(
        plugin?.name || "插件",
        `<p>${escape(plugin?.description || "此插件通过已注册工具提供能力，在对话中描述任务即可调用。")}</p><p>工具：${escape((plugin?.tools || []).join("、"))}</p>`,
      );
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
$("#session-search").addEventListener("input", renderSessions);
$("#extension-search").addEventListener("input", renderExtensions);
$("#settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  saveSettings().catch((error) => toast(error.message, true));
});
$("#prompt").addEventListener("input", () => {
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
    syncComposer();
  } catch (e) {
    toast(e.message, true);
  } finally {
    $("#file-input").value = "";
  }
});
setupConversationScroll();
window.viniperDesktop?.onCommand((payload) => {
  const cmd = payload.command || payload.action;
  if (["new-session", "new-chat", "new-viniper-session"].includes(cmd))
    newChat();
  if (["settings", "open-settings"].includes(cmd)) view("settings");
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
await Promise.all([loadStatus(), loadSessions()]).catch((error) =>
  toast(`连接尚未就绪：${error.message}`, true),
);
setInterval(async () => {
  try {
    if (document.hidden) return;
    await loadSessions();
    if (state.session) {
      const queue = await api(`/api/runs/${state.session.session_id}/queue`);
      const items = queue.items || queue.queue || [];
      $("#queue").hidden = !items.length;
      setMarkup($("#queue"), items
        .map(
          (item) =>
            `<div class="queued-message"><span>${escape(item.text)}</span><button class="icon-button" data-cancel-queue="${escape(item.id)}" aria-label="移除待发送消息">${icon("close")}</button></div>`,
        )
        .join(""));
    }
    if (state.view === "tasks") await loadTasks();
    if (state.session) {
      await refreshGoalBanner();
      const listed = state.sessions.find(
        (s) => s.id === state.session.session_id,
      );
      if (
        listed?.runtime_state === "running" &&
        !state.runs.get(listed.id)?.active
      )
        await selectSession(listed.id);
    }
  } catch {}
}, 4000);

setInterval(() => {
  for (const run of state.runs.values())
    if (run.active) {
      run.message.elapsed = Math.round((Date.now() - run.started) / 1000);
      paintRun(run);
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
