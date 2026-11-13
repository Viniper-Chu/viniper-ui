import { state, api, escape } from "./api.js";
import { icon } from "./icons.js";
import { ui } from "./ui.js";
const $ = selector => document.querySelector(selector);
const statusLabel = {
  active: "进行中",
  running: "进行中",
  complete: "已完成",
  completed: "已完成",
  paused: "已暂停",
  blocked: "待继续",
  waiting: "等待处理",
  failed: "失败",
  budget_limited: "达到预算",
  scheduled: "已启用",
  disabled: "已暂停",
};
export async function loadTasks() {
  const version = ++taskVersion;
  for (const kind of ["goals", "schedules"]) taskLoads[kind] ||= "loading";
  renderTasks();
  await Promise.all(["goals", "schedules"].map(async kind => {
    try {
      const data = await api(kind === "goals" ? "/api/goals?mode=viniper" : "/api/schedules");
      if (version !== taskVersion) return;
      state[kind] = data[kind] || [];
      taskLoads[kind] = "ready";
    } catch {
      if (version !== taskVersion) return;
      taskLoads[kind] = "error";
    }
    renderTasks();
  }));
}
let taskVersion = 0;
const taskLoads = {};
let taskFilter = "all";
export function selectTaskFilter(value) {
  taskFilter = value;
  renderTasks();
}
function taskState(task, goal) {
  if (!goal) {
    const special = { "project-invalid": "会话不可用", "waiting-permission": "等待授权", "overlap-pending": "等待会话空闲", "imported-timezone": "待核对时区" }[task.status];
    if (special || task.last_error) return ["attention", special || "执行出错"];
    return task.enabled ? ["open", "已启用"] : ["attention", "已暂停"];
  }
  const status = task.runtime_status || task.status;
  const group = ["complete", "completed"].includes(status) ? "closed" : ["active", "running"].includes(status) ? "open" : "attention";
  return [group, statusLabel[status] || status || "待处理"];
}
const schedulePresets = new Map([
  ["0 9 * * 1-5", "工作日 09:00"], ["0 20 * * *", "每天 20:00"], ["0 9 * * 1", "每周一 09:00"],
]);

function nextRun(task) {
  if (!task.enabled || !Number.isFinite(task.nextRunAt)) return "";
  const zone = task.schedule?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    const formatted = new Intl.DateTimeFormat("zh-CN", {timeZone: zone, month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:false}).format(task.nextRunAt);
    return `下次 ${formatted}（${zone === "Asia/Shanghai" ? "上海时间" : zone}）`;
  } catch { return ""; }
}


let selected = null, editor = null, saving = false;
let listTop = 0, rowOffset = 0, detailTop = 0, listSelector = "", neighbor = "";
function record() {
  return selected && state[selected.kind].find(item => item.id === selected.id);
}

function rowSelector(kind, id) {
  return `[data-record-kind="${kind}"][data-record-id="${CSS.escape(id)}"]`;
}

function rememberList(selector) {
  listSelector = selector;
  listTop = $("#tasks-view").scrollTop;
  const row = $(selector);
  rowOffset = row?.getBoundingClientRect().top ?? 0;
  const adjacent = row?.nextElementSibling || row?.previousElementSibling;
  neighbor = adjacent?.dataset.recordId ? rowSelector(adjacent.dataset.recordKind, adjacent.dataset.recordId) : "";
}

function surface(id) {
  for (const name of ["task-catalog","task-detail","task-editor"]) $("#" + name).hidden = name !== id;
}

export function backToTasks() {
  if (saving) return;
  surface("task-catalog");
  selected = editor = null;
  renderTasks();
  const page = $("#tasks-view");
  const row = (listSelector && $(listSelector)) || (neighbor && $(neighbor));
  page.scrollTop = listTop;
  if (row) page.scrollTop += row.getBoundingClientRect().top - rowOffset;
  (row || $("#task-search")).focus({preventScroll:true});
}

function cadence(job) {
  const pattern = job.schedule || {};
  const cron = job.cron || job.cronExpression || pattern.expression;
  if (cron) return schedulePresets.get(cron) || cron;
  const time = [pattern.hour,pattern.minute].map(v => String(v ?? 0).padStart(2,"0")).join(":");
  if (pattern.kind === "daily") return "每天 " + time;
  if (pattern.kind === "weekly") return "每周" + "日一二三四五六"[pattern.weekday] + " " + time;
  if (pattern.kind === "once") return "单次执行";
  if (pattern.kind === "interval") return `每 ${pattern.everyMs / 1000} 秒`;
  return "";
}

function rowHtml(task, kind) {
  const goal = kind === "goals";
  const [group,status] = taskState(task,goal);
  const meta = goal ? `${task.turn_count || 0} 轮` : cadence(task);
  return `<button class="record-row" data-record-kind="${kind}" data-record-id="${escape(task.id)}" data-hint="查看${goal ? "目标" : "定时任务"}详情"><span class="card-icon">${icon(goal ? "target" : "clock")}</span><span class="capability-copy"><span class="capability-name">${escape(task.title || task.name)}</span><small>${escape(meta)}</small></span><small class="record-state" data-tone="${group}">${escape(status)}</small>${icon("arrowRight")}</button>`;
}

function setHtml(element, html) {
  if (element._taskHtml === html) return;
  element.innerHTML = html;
  element._taskHtml = html;
}

export function renderTasks() {
  const query = $("#task-search").value.trim().toLocaleLowerCase();
  const focus = document.activeElement?.closest("[data-record-id]");
  document.querySelectorAll("[data-task-filter]").forEach(b => b.setAttribute("aria-pressed",String(b.dataset.taskFilter === taskFilter)));
  for (const [kind,stem] of [["goals","goal"],["schedules","schedule"]]) {
    const goal = kind === "goals";
    const visible = state[kind].filter(item =>
      (!query || [item.title,item.name,item.prompt].join(" ").toLocaleLowerCase().includes(query)) &&
      (taskFilter === "all" || taskState(item,goal)[0] === taskFilter));
    const ready = taskLoads[kind] === "ready";
    const label = goal ? "目标" : "定时任务";
    const empty = query || taskFilter !== "all" ? `没有匹配的${label}` : `还没有${label}`;
    const error = taskLoads[kind] === "error";
    $(`#${stem}-count`).textContent = ready ? `${visible.length} 项` : "";
    const fallback = `<div class="task-empty" role="status">${error ? "暂时无法读取" + label : ready ? empty : "正在读取…"}${error ? '<button class="text-button" data-action="refresh-tasks">重新读取</button>' : ""}</div>`;
    setHtml($(`#${stem}-list`), ready && visible.length ? visible.map(item=>rowHtml(item,kind)).join("") : fallback);
  }
  if (focus && !focus.isConnected && !selected && !editor && state.view === "tasks") {
    ($(rowSelector(focus.dataset.recordKind,focus.dataset.recordId)) || $("#task-search")).focus({preventScroll:true});
  }
  if (selected && !editor) paintDetail();
}

export function showTask(kind,id) {
  if (!["goals","schedules"].includes(kind)) return;
  if (!selected && !editor) rememberList(rowSelector(kind,id));
  selected = {kind,id}; editor = null;
  surface("task-detail");
  paintDetail();
  $("#tasks-view").scrollTop = 0;
  $("#task-record h1")?.focus({preventScroll:true});
}

function paintDetail() {
  const task = record(), host = $("#task-record");
  if (!task) {
    setHtml(host, `<p role="status">${taskLoads[selected.kind] === "ready" ? "这项任务已移除" : "暂时无法读取任务详情"}</p>`);
    return;
  }
  const goal = selected.kind === "goals", [group,status] = taskState(task,goal);
  const id = escape(task.id), ref = goal ? `data-goal-id="${id}"` : `data-schedule-id="${id}"`;
  const actions = [];
  const action = (value,name,glyph) => `<button class="secondary-button" data-task-action="${value}" ${ref}>${icon(glyph)}${name}</button>`;
  const editable = goal ? !["active","complete","completed"].includes(task.status) : !task.schedule?.kind || task.schedule.kind === "cron";
  if (editable) actions.push(action("edit",goal ? "编辑目标" : "编辑定时任务","edit"));
  if (group !== "closed" && task.status !== "project-invalid") {
    const active = goal ? task.status === "active" : task.enabled;
    actions.push(action(active ? (goal ? "stop" : "pause") : (goal ? "continue" : "resume"),active ? "暂停" : "继续",active ? "pause" : "play"));
  }
  const sid = goal ? task.session_id : task.native_session_id;
  if (sid) actions.push(`<button class="text-button" data-session="${escape(sid)}">${icon("chat")}打开会话</button>`);
  const until = nextRun(task);
  const facts = goal ? [["已用轮次",`${task.turn_count || 0} / ${task.max_turns || "—"}`]] :
    [["执行周期",cadence(task)],["时区",task.schedule?.timeZone],["下次执行",until.replace(/^下次 /,"")]];
  const sections = [["任务内容",task.prompt],["当前进展",task.current_step],["最近结果",task.last_output || task.last_result || task.lastStatus],["错误",task.last_error]];
  const html = `<header class="detail-heading"><span class="detail-icon">${icon(goal?"target":"clock")}</span><h1 tabindex="-1">${escape(task.title || task.name)}</h1></header>
    <div class="record-tools">${actions.join("")}</div>
    <dl class="record-facts"><div><dt>状态</dt><dd class="record-state" data-tone="${group}">${escape(status)}</dd></div>${facts.filter(([,v])=>v).map(([k,v])=>`<div><dt>${k}</dt><dd>${escape(v)}</dd></div>`).join("")}</dl>
    ${sections.filter(([,v])=>v).map(([k,v])=>`<section class="record-section"><h2>${k}</h2><p>${escape(v)}</p></section>`).join("")}
    <button class="text-button remove-record" data-task-action="delete" ${ref}>${icon("trash")}移除${goal?"目标":"定时任务"}</button>`;
  setHtml(host,html);
}

export async function taskAction(action, goalId, scheduleId) {
  const goal = Boolean(goalId), id = goalId || scheduleId;
  if (action === "edit") return openTaskEditor();
  const path = `/api/${goal ? "goals" : "schedules"}/${encodeURIComponent(id)}`;
  if (action === "delete") {
    ui.dialog("移除任务","<p>移除这项任务？相关对话和项目文件会保留。</p>",{label:"移除",danger:true,onSubmit:async()=>{
      await api(path,{method:"DELETE"});
      if (state.view === "tasks") { await loadTasks(); if (selected?.id === id) backToTasks(); }
    }});
    return;
  }
  await api(path,{method:"PATCH",body:{action}});
  if (state.view === "tasks") await loadTasks();
  ui.toast(["continue","resume"].includes(action) ? "已继续" : "已暂停");
}

export function openTaskEditor(create = false) {
  if (saving) return;
  const task = create ? null : record();
  if (!create && !task) return;
  if (create) { selected = null; rememberList('[data-action="new-schedule"]'); }
  detailTop = $("#tasks-view").scrollTop;
  const goal = !create && selected.kind === "goals";
  const zone = task?.schedule?.timeZone || "Asia/Shanghai";
  editor = {task,goal,zone};
  surface("task-editor");
  $("#task-edit-title").textContent = create ? "新建定时任务" : goal ? "编辑目标" : "编辑定时任务";
  $("#task-edit-origin").textContent = create ? "目标与任务" : "任务详情";
  const form = $("#task-edit-form");
  const cron = task?.cron || task?.schedule?.expression || "0 9 * * 1-5";
  const presets = [...schedulePresets].map(([v,l])=>`<option value="${v}">${l}</option>`).join("");
  form.innerHTML = `<label class="field">名称<input name="title" required maxlength="${goal?160:100}" value="${escape(task?.title || task?.name || "")}"></label>
   <label class="field">任务内容<textarea name="prompt" rows="6" required>${escape(task?.prompt || "")}</textarea></label>
   ${goal ? "" : `<div class="form-grid"><label class="field">执行时间（${escape(zone === "Asia/Shanghai" ? "上海时间" : zone)}）<select name="preset">${presets}<option value="custom">自定义 Cron</option></select></label><label class="field">Cron 表达式<input name="cron" value="${escape(cron)}"></label></div>
   <details class="schedule-help"><summary data-hint="执行规则">执行规则</summary><p>应用运行时执行。会话忙碌时等待空闲，重启时跳过错过的时间。</p></details>`}
   <footer class="editor-bar"><span role="status"></span><button type="button" data-action="cancel-task-edit" class="secondary-button">取消</button><button class="primary-button" type="submit">${create ? "创建" : "保存修改"}</button></footer>`;
  if (!goal) {
    const preset = form.elements.preset;
    preset.value = schedulePresets.has(cron) ? cron : "custom";
    const sync = () => {
      const custom = preset.value === "custom";
      form.elements.cron.closest("label").hidden = !custom;
      form.elements.cron.disabled = !custom;
      form.elements.cron.required = custom;
    };
    preset.addEventListener("change",sync); sync();
  }
  $("#tasks-view").scrollTop = 0;
  form.elements.title.focus({preventScroll:true});
}

export function cancelTaskEdit() {
  if (!editor || saving) return;
  editor = null;
  if (!selected) return backToTasks();
  surface("task-detail"); paintDetail();
  $("#tasks-view").scrollTop = detailTop;
  $("#task-record [data-task-action=edit]")?.focus({preventScroll:true});
}

export async function saveTask() {
  if (!editor || saving) return;
  const current = editor, {task,goal,zone} = current, form = $("#task-edit-form");
  const data = new FormData(form);
  const body = {title:data.get("title").trim(),prompt:data.get("prompt").trim()};
  if (goal) body.original = {title:task.title,prompt:task.prompt};
  else Object.assign(body,{cron:data.get("preset") === "custom" ? data.get("cron") : data.get("preset"),time_zone:zone});
  const url = goal ? "/api/goals" : "/api/schedules";
  if (!task) Object.assign(body,{session_id:state.session?.session_id || "",workdir:state.workdir,model:state.model});
  else body.action = "edit";
  saving = true;
  const controls = [...form.elements].filter(el=> !el.disabled);
  controls.forEach(el=>el.disabled=true);
  try {
    const response = await api(task ? `${url}/${encodeURIComponent(task.id)}` : url,{method:task ? "PATCH" : "POST",body});
    if (response.changed === false) throw new Error("任务已移除，请返回列表");
    await loadTasks();
    if (current !== editor) return;
    if (!task) selected = {kind:"schedules",id:response.schedule.id};
    editor = null;
    surface("task-detail"); paintDetail();
    $("#tasks-view").scrollTop = task ? detailTop : 0;
    ($("#task-record [data-task-action=edit]") || $("#task-record h1"))?.focus({preventScroll:true});
    ui.toast(task ? "修改已保存" : "定时任务已创建");
  } catch (error) { form.querySelector("[role=status]").textContent=error.message; }
  finally { saving=false; controls.forEach(el=>el.disabled=false); }
}
