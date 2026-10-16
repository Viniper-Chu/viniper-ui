import { escape, timeLabel, state, api } from "./api.js";
import { icon } from "./icons.js";
const $ = (s) => document.querySelector(s);
let followingLatest = true;
let lastScrollTop = 0;
let holdingPointer = false;
export const nearBottom = () => {
  const el = $("#conversation");
  return el.scrollHeight - el.scrollTop - el.clientHeight < 4;
};
export function bottom(force = false) {
  if (force) followingLatest = true;
  const selection = globalThis.getSelection?.();
  if (followingLatest && (force || (!holdingPointer && (!selection || selection.isCollapsed)))) {
    const el = $("#conversation");
    el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
    lastScrollTop = el.scrollTop;
  }
  $("#jump-bottom").hidden = nearBottom();
}
export function jumpToMessage(id) {
  followingLatest = false;
  document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
}
export function setupConversationScroll() {
  const el = $("#conversation");
  el.addEventListener("scroll", trackScroll, { passive: true });
  el.addEventListener("wheel", (event) => {
    if (event.deltaY < 0) followingLatest = false;
  }, { passive: true });
  el.addEventListener("touchstart", () => { holdingPointer = true; followingLatest = false; }, { passive: true });
  el.addEventListener("touchend", () => { holdingPointer = false; }, { passive: true });
  el.addEventListener("touchcancel", () => { holdingPointer = false; }, { passive: true });
  el.addEventListener("pointerdown", () => { holdingPointer = true; });
  document.addEventListener("pointerup", () => { holdingPointer = false; });
  document.addEventListener("pointercancel", () => { holdingPointer = false; });
  el.addEventListener("keydown", (event) => {
    if (["ArrowUp", "PageUp", "Home"].includes(event.key)) followingLatest = false;
  });
}

// Keep existing text, details and scroll containers alive while Markdown grows.
function patchChildren(parent, next) {
  const desired = [...next.childNodes];
  desired.forEach((fresh, index) => {
    const current = parent.childNodes[index];
    if (!current) { parent.append(fresh); return; }
    if (current.nodeType !== fresh.nodeType || current.nodeName !== fresh.nodeName) {
      current.replaceWith(fresh);
      return;
    }
    if (current.nodeType === 3) {
      if (fresh.data === current.data) return;
      if (fresh.data.startsWith(current.data)) current.appendData(fresh.data.slice(current.data.length));
      else if (current.data !== fresh.data) current.data = fresh.data;
      return;
    }
    if (current.nodeType !== 1) return;
    for (const attr of [...current.attributes])
      if (!fresh.hasAttribute(attr.name) && !(current.tagName === "DETAILS" && attr.name === "open")) current.removeAttribute(attr.name);
    for (const attr of fresh.attributes)
      if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
    patchChildren(current, fresh);
  });
  while (parent.childNodes.length > desired.length) parent.lastChild.remove();
}
function updateMarkup(element, html) {
  if (element._markup === html) return;
  const template = document.createElement("template");
  template.innerHTML = html;
  decorateFiles(template.content, element.matches(".answer"));
  patchChildren(element, template.content);
  element._markup = html;
}
function updateMarkdown(element, text, streaming) {
  const key = `${Boolean(streaming)}:${text}`;
  if (element._markdown === key) return;
  updateMarkup(element, markdown(text, streaming));
  element._markdown = key;
}
function markdown(text, streaming = false) {
  return globalThis.ViniperMarkdown.render(
    String(text || "").replace(/\[VINIPER_GOAL_(?:DONE|CONTINUE)\]/g, ""),
    { streaming },
  );
}
function toolTitle(name) {
  return {
    "file.list": "定位文件", "file.search": "查找文件", "file.read": "读取文件",
    "file.edit": "修改文字", "file.write": "写入文件",
    "file.docx.inspect": "读取文档结构", "file.docx.replace": "替换文档文字",
    "file.docx.edit": "调整文档文字与格式", "file.sqlite.inspect": "查看数据库结构",
    "file.sqlite.query": "查询数据", "file.sqlite.apply": "更新并回读数据",
    "file.image.analyze": "检查图片",
    "file.math.handout": "制作师生讲义", "file.pdf.inspect": "读取 PDF 页面", "file.pdf.render": "渲染 PDF 页面",
    "terminal.run": "运行命令", "terminal.output": "查看命令输出",
    "web.search": "搜索资料", "web.fetch": "阅读网页",
  }[name] || name;
}
function toolReceipt(tool) {
  if (tool.type !== "tool_result" && tool.type !== "tool") return "";
  const name = tool.tool_name || tool.name;
  let data;
  try { data = JSON.parse(tool.content || tool.output || ""); } catch { return ""; }
  if (name !== "file.sqlite.apply" || !Array.isArray(data.transactions)) return "";
  const committed = data.transactions.filter((t) => t.status === "committed").length;
  const rolledBack = data.transactions.filter((t) => t.status === "rolled_back").length;
  const facts = [];
  if (committed) facts.push(`${committed} 组事务已提交`);
  if (rolledBack) facts.push(`${rolledBack} 组事务已回滚`);
  if (Array.isArray(data.readback)) facts.push(`${data.readback.length} 项查询已回读`);
  if (data.readback_error) facts.push("回读未完成，查看详情");
  return facts.join(" · ");
}
function resultFiles(message) {
  const files = new Map();
  const documents = (message.segments || []).filter(item => item.presentation?.kind === "document-results"
    && !["failed", "error", "cancelled"].includes(item.status)).map(item => item.presentation);
  for (const document of documents) for (const path of document.files) files.set(path, { path });
  const intermediate = path => documents.some(document => document.intermediateFiles.includes(path)
    || document.intermediateDirectories.some(directory => path.startsWith(directory.replace(/\/$/, "") + "/")));
  const sourceDependency = path => documents.some(document => document.sourceDependencies?.includes(path));
  for (const item of message.segments || []) {
    if (item.type === "artifact" && item.path && item.status !== "failed" && !intermediate(item.path) && !sourceDependency(item.path)) files.set(item.path, item);
  }
  if (!files.size) return "";
  return `<div class="result-files" aria-label="本轮文件">${[...files.values()].map((file) => {
    const name = file.path.split("/").at(-1);
    const parent = file.path.slice(0, -name.length).replace(/\/$/, "");
    const type = /\.pdf$/i.test(name) ? "PDF" : /\.tex$/i.test(name) ? "TeX" : /\.docx$/i.test(name) ? "Word" : /\.(db|sqlite3?)$/i.test(name) ? "数据" : /\.(py|ts|js|tsx|jsx|rs)$/i.test(name) ? "代码" : "文件";
    const glyph = type === "数据" ? "database" : ["代码", "TeX"].includes(type) ? "codeWindow" : "document";
    return `<button class="result-file" data-file="${escape(file.path)}" title="${escape(file.path)}"><span class="result-file-icon">${icon(glyph)}</span><span class="result-file-copy"><strong>${escape(name)}</strong><small>${escape(parent)}</small></span><span class="result-file-type">${type}</span>${icon("external")}</button>`;
  }).join("")}${[...new Set(documents.map(document => document.sourceDirectory).filter(Boolean))].map(path => `<button class="text-button" data-file="${escape(path)}" title="保留此目录中的 TeX 与页码映射文件，便于重新编译">${icon("folder")}完整 TeX 源码${icon("external")}</button>`).join("")}</div>`;
}
function terminalHtml(tool) {
  const p = tool.presentation;
  if (!p || !["terminal-run", "terminal-output"].includes(p.kind)) return "";
  const labels = { test: "测试命令", build: "构建命令", lint: "代码检查", typecheck: "类型检查", dependency: "依赖操作", command: "终端命令" };
  const status = `${labels[p.purpose] || "终端输出"}${p.exitCode != null ? ` · 退出码 ${p.exitCode}` : ""}${p.durationMs ? ` · ${(p.durationMs / 1000).toFixed(1)} 秒` : ""}`;
  const streams = p.kind === "terminal-run" ? ["stdout", "stderr"].map((name) => ({name, ...p[name]}))
    : [{name:p.stream, preview:p.outputText, truncated:p.nextOffset != null, totalBytes:p.totalBytes}];
  return `<div class="terminal-receipt"><p>${escape(status)}</p>${streams.filter((stream) => stream.preview || stream.totalBytes).map((stream) => `<section class="terminal-stream" data-output-key="${escape((tool.call_id || tool.tool_id || p.executionId) + ":" + stream.name)}"><strong>${stream.name === "stderr" ? "错误输出" : "标准输出"}</strong><pre>${escape(stream.preview || "")}</pre>${stream.truncated ? `<button class="secondary-button" data-terminal="${escape(p.executionId)}" data-output-stream="${escape(stream.name)}" data-output-offset="0">读取完整输出</button>` : ""}</section>`).join("")}</div>`;
}
export async function readTerminalOutput(button) {
  button.disabled = true;
  try {
    const offset = Number(button.dataset.outputOffset || 0);
    const data = await api(`/api/sessions/${encodeURIComponent(state.session.session_id)}/terminal/${encodeURIComponent(button.dataset.terminal)}?stream=${button.dataset.outputStream}&offset=${offset}`);
    const pre = button.closest(".terminal-stream").querySelector("pre");
    pre.textContent = (offset ? pre.textContent : "") + data.text;
    if (data.nextOffset == null) button.remove();
    else { button.dataset.outputOffset = data.nextOffset; button.textContent = "继续读取输出"; }
  } finally { button.disabled = false; }
}
function toolHtml(tool, streaming) {
  const status =
    tool.status ||
    (tool.type === "tool_start"
      ? streaming
        ? "running"
        : "interrupted"
      : "success");
  const labels = {
    running: "执行中",
    waiting: "等待确认",
    success: "已完成",
    completed: "已完成",
    failed: "失败",
    error: "失败",
    cancelled: "已停止",
    interrupted: "未完成",
    rejected: "已拒绝",
    denied: "已拒绝",
    blocked: "受阻",
  };
  const label = labels[status] || status;
  const error =
    Boolean(tool.is_error) ||
    ["failed", "error", "rejected", "denied", "blocked"].includes(status);
  const title =
    tool.tool_name ||
    tool.name ||
    tool.title ||
    tool.path ||
    {
      plan: "任务计划",
      plan_timeline: "任务计划",
      turn_diff: "文件修改",
      context_compacted: "上下文已整理",
    }[tool.type] ||
    "工具操作";
  const input = tool.input
    ? `参数\n${JSON.stringify(tool.input, null, 2)}\n\n`
    : "";
  const output =
    typeof tool.output === "string"
      ? tool.output
      : typeof tool.content === "string"
        ? tool.content
        : JSON.stringify(
            tool.result ?? tool.steps ?? tool.file_change ?? tool,
            null,
            2,
          );
  const path = tool.input?.path || tool.path;
  const receipt = toolReceipt(tool);
  return `<div class="tool-event${error ? " error" : ""}" data-call-id="${escape(tool.call_id || tool.tool_id || tool.path || title)}">${icon(error ? "shieldAlert" : status === "running" ? "clock" : status === "cancelled" ? "pause" : "check")}<details><summary><span>${escape(toolTitle(String(title)))}</span> <small>${escape(label)}</small></summary>${path && !error ? `<button class="file-link tool-path" data-file="${escape(path)}" title="${escape(path)}">${icon("file")}${escape(path.split("/").at(-1))}</button>` : ""}${receipt ? `<p class="tool-receipt">${escape(receipt)}</p>` : ""}${terminalHtml(tool)}<pre>${escape(input + output)}</pre></details></div>`;

}
function messageText(message) {
  const segments = message.segments || [];
  const all = message.content || segments.filter(s => s.type === "text").map(s => s.content || "").join("");
  const unchanged = { answer: all, progress: [] };
  if (message.streaming || message.cancelled || message.steered || message.error) return unchanged;
  const lastTool = segments.findLastIndex(s => ["tool_start", "tool_result", "tool"].includes(s.type));
  if (lastTool < 0) return unchanged;
  const answer = segments.slice(lastTool + 1).filter(s => s.type === "text").map(s => s.content || "").join("");
  const progress = segments.slice(0, lastTool).filter(s => s.type === "text" && s.content?.trim()).map(s => s.content);
  return answer.trim() && progress.length ? { answer, progress } : unchanged;
}
function activityData(message, progress = []) {
  const segments = message.segments || [];
  const thoughts =
    segments
      .filter((s) => s.type === "thinking" || s.type === "reasoning")
      .map((s) => s.content || "")
      .join("\n\n") ||
    message.thinking ||
    "";
  const tools = [];
  for (const item of segments.filter((s) =>
    [
      "tool_start",
      "tool_result",
      "tool",
      "artifact",
      "plan",
      "plan_timeline",
      "turn_diff",
      "context_compacted",
    ].includes(s.type),
  )) {
    const id = item.call_id || item.tool_call_id || item.tool_id;
    const index = id
      ? tools.findIndex(
          (t) => (t.call_id || t.tool_call_id || t.tool_id) === id,
        )
      : -1;
    if (item.type === "tool_result" && index >= 0)
      tools[index] = { ...tools[index], ...item };
    else tools.push(item);
  }
  const operationCount = tools.filter(t => t.type !== "artifact").length;
  const elapsed =
    message.elapsed ??
    message.elapsed_seconds ??
    message.turn_usage?.elapsed_seconds ??
    0;
  const outcome = message.cancelled
    ? "已停止 · "
    : message.steered
      ? "已按引导中断 · "
    : message.error
      ? "未完成 · "
      : "";
  const label = message.streaming
    ? message.working || "等待模型响应"
    : elapsed
      ? `${outcome}用时 ${timeLabel(elapsed)}`
      : `${outcome}用时不足 1 秒`;
  return { thoughts, tools, label, count: !message.streaming && operationCount ? `${operationCount} 次操作${progress.length ? ` · ${progress.length} 条进展` : ""}` : "", time: message.streaming && elapsed ? `· ${timeLabel(elapsed)}` : "" };
}
function activityBodyHtml(message, progress, data) {
  return `<div class="thinking-content">${data.thoughts ? markdown(data.thoughts, message.streaming) : ""}</div><div class="progress-content">${progress.length ? `<p>执行中的回复</p>${progress.map(text => markdown(text, false)).join("")}` : ""}</div><div class="activity-tools">${data.tools.map(t => `<div>${toolHtml(t, Boolean(message.streaming))}</div>`).join("")}</div><span class="activity-empty"${data.thoughts || data.tools.length ? " hidden" : ""}>${message.streaming ? "等待模型响应…" : "本轮没有额外的执行记录。"}</span>`;
}
function activityHtml(message, progress = []) {
  const data = activityData(message, progress);
  return `<details class="activity"><summary><span class="activity-symbol">${message.streaming ? '<span class="spinner"></span>' : icon("chevron")}</span><span class="activity-label">${escape(data.label)}</span><small class="activity-count"${data.count ? "" : " hidden"}>${escape(data.count)}</small><span class="activity-time"${data.time ? "" : " hidden"}>${escape(data.time)}</span></summary><div class="activity-body">${message.streaming ? "" : activityBodyHtml(message, progress, data)}</div></details>`;
}
function updateActivityBody(activity, message, progress, data) {
  const body = activity.querySelector(".activity-body");
  if (!body.querySelector(".thinking-content")) body.innerHTML = activityBodyHtml({ streaming: true }, [], { thoughts: "", tools: [] });
  updateMarkdown(body.querySelector(".thinking-content"), data.thoughts, message.streaming);
  updateMarkup(body.querySelector(".progress-content"), progress.length ? `<p>执行中的回复</p>${progress.map(text => markdown(text, false)).join("")}` : "");
  const list = body.querySelector(".activity-tools");
  data.tools.forEach((tool, index) => {
    let slot = list.children[index];
    if (!slot) { slot = document.createElement("div"); list.append(slot); }
    updateMarkup(slot, toolHtml(tool, Boolean(message.streaming)));
  });
  while (list.children.length > data.tools.length) list.lastElementChild.remove();
  const empty = body.querySelector(".activity-empty");
  empty.hidden = Boolean(data.thoughts || data.tools.length);
  empty.textContent = message.streaming ? "等待模型响应…" : "本轮没有额外的执行记录。";
}
function messageHtml(message) {
  if (message.role === "user")
    return `<div class="user-content">${message.guidance ? `<span class="guidance-label">${icon("steer")}引导</span>` : ""}${escape(message.content)}${(message.attachments || []).map((a) => `<div><button class="file-link" data-file="${escape(a.path || "")}">${icon("file")}${escape(a.name || a.path)}</button></div>`).join("")}</div>`;
  const { answer: content, progress } = messageText(message);
  return `${activityHtml(message, progress)}<div class="answer">${markdown(content, Boolean(message.streaming))}</div><div class="message-results">${resultFiles(message)}</div><div class="message-plan">${message.planned && !message.streaming ? '<button class="secondary-button" data-action="implement-plan">按此计划开始实施</button>' : ""}</div><div class="message-actions"><button class="icon-button" data-copy="${escape(content)}" title="复制回答" aria-label="复制回答">${icon("copy")}</button></div>`;
}
function updateMessage(node, message) {
  node._message = message;
  if (message.role === "user") { updateMarkup(node, messageHtml(message)); return; }
  const { answer, progress } = messageText(message);
  const activity = node.querySelector(".activity");
  const data = activityData(message, progress);
  updateMarkup(activity.querySelector(".activity-symbol"), message.streaming ? '<span class="spinner"></span>' : icon("chevron"));
  for (const [className, text] of [["activity-label", data.label], ["activity-count", data.count], ["activity-time", data.time]]) {
    const part = activity.querySelector(`.${className}`);
    if (part.textContent !== text) part.textContent = text;
    part.hidden = !text;
  }
  // A collapsed trace does no Markdown work on streaming tokens or timer ticks.
  if (activity.open) updateActivityBody(activity, message, progress, data);
  updateMarkdown(node.querySelector(".answer"), answer, message.streaming);
  updateMarkup(node.querySelector(".message-results"), resultFiles(message));
  updateMarkup(node.querySelector(".message-plan"), message.planned && !message.streaming ? '<button class="secondary-button" data-action="implement-plan">按此计划开始实施</button>' : "");
  const copy = node.querySelector("[data-copy]");
  if (copy.dataset.copy !== answer) copy.dataset.copy = answer;
}
export function renderMessages(messages, { preserveView = false } = {}) {
  const visible = (messages || []).filter(
    (m) => m.role === "user" || m.role === "assistant",
  );
  $("#welcome").hidden = visible.length > 0;
  $("#chat-view").classList.toggle("is-empty", visible.length === 0);
  $("#starters").hidden = visible.length > 0;
  const list = $("#messages");
  if (!preserveView) { list.replaceChildren(); followingLatest = true; lastScrollTop = 0; }
  visible.forEach((message, index) => {
    const node = list.children[index];
    if (node && node._message?.role === message.role) updateMessage(node, message);
    else {
      const added = appendMessage(message, index);
      if (node) list.replaceChild(added, node);
    }
  });
  while (list.children.length > visible.length) list.lastElementChild.remove();
  updateRail();
  if (preserveView) bottom();
}
export function appendMessage(message, index = $("#messages").children.length) {
  $("#welcome").hidden = true;
  $("#chat-view").classList.remove("is-empty");
  $("#starters").hidden = true;
  const node = document.createElement("article");
  node.className = `message ${message.role}`;
  node.id = `message-${index}`;
  node.dataset.messageIndex = index;
  node._message = message;
  node.innerHTML = messageHtml(message);
  node.querySelector(".activity")?.addEventListener("toggle", (event) => {
    if (!event.target.open) return;
    const { progress } = messageText(node._message);
    updateActivityBody(event.target, node._message, progress, activityData(node._message, progress));
  });
  $("#messages").append(node);
  decorateFiles(node);
  updateRail();
  return node;
}
export function paintRun(run) {
  if (state.session?.session_id !== run.sessionId || state.view !== "chat")
    return;
  let node = run.node;
  if (!node?.isConnected) {
    node = appendMessage(run.message);
    run.node = node;
  }
  node.classList.toggle("error", Boolean(run.error));
  updateMessage(node, run.message);
  bottom();
}
export function projectEvent(run, event) {
  if (event.sequence && event.sequence <= run.sequence) return;
  if (event.sequence) run.sequence = event.sequence;
  if (event.run_id) run.runId = event.run_id;
  if (event.type === "queue_dispatch") {
    run.done = false;
    run.message = {
      role: "assistant",
      content: "",
      thinking: "",
      segments: [],
      streaming: true,
      elapsed: 0,
    };
    run.started = Date.now();
    if (state.session?.session_id === run.sessionId) {
      appendMessage({ role: "user", content: event.item?.text || "" });
      run.node = appendMessage(run.message);
    }
    return;
  }
  const m = run.message,
    type = event.type;
  if (type === "text") {
    m.content += event.content || "";
    m.working = "正在回答";
  } else if (type === "thinking" || type === "thinking_delta") {
    m.thinking += event.content || "";
    m.working = "正在思考";
  } else if (type === "tool_start") {
    m.segments.push({ ...event });
    m.working = `正在${toolTitle(event.tool_name || event.name || "执行工具")}`;
  } else if (type === "tool_result") {
    const id = event.call_id || event.tool_call_id || event.tool_id;
    const previous = m.segments.findIndex(
      (s) =>
        s.type === "tool_start" &&
        (s.call_id || s.tool_call_id || s.tool_id) === id,
    );
    if (id && previous >= 0)
      m.segments[previous] = { ...m.segments[previous], ...event };
    else m.segments.push({ ...event });
    m.working = m.segments.some((s) => s.type === "tool_start") ? "正在执行工具" : "等待模型继续";
  } else if (["artifact", "plan", "turn_diff", "context_compacted"].includes(type))
    m.segments.push({ ...event });
  else if (type === "working_status") m.working = event.content || "正在处理";
  else if (type === "heartbeat") m.elapsed = Math.round((Date.now() - run.started) / 1000);
  else if (type === "turn_usage") {
    m.turn_usage = event.turn_usage;
  } else if (type === "usage") run.usage = event.usage;
  else if (["permission_request", "interaction_request"].includes(type))
    run.interaction = event;
  else if (["interaction_resolved", "permission_resolved"].includes(type))
    run.interaction = null;
  else if (type === "error") {
    run.error = true;
    m.error = true;
    m.content += `\n\n${event.content || "本次任务未完成"}`;
  } else if (type === "done") {
    run.done = true;
    m.streaming = false;
    run.interaction = null;
  } else if (type === "steering") {
    run.steering = event.receipt;
    const visible = state.session?.session_id === run.sessionId && state.view === "chat";
    if (event.user_message) {
      run.guidanceIds ??= new Set();
      if (!run.guidanceIds.has(event.user_message.guidance_id)) {
        run.guidanceIds.add(event.user_message.guidance_id);
        if (visible) appendMessage(event.user_message);
      }
    }
    if (event.previous_message && event.message) {
      // End the old response in place. Guidance and the next response are
      // new timeline entries; never move or concatenate the previous answer.
      if (visible && run.node?.isConnected) updateMessage(run.node, { ...event.previous_message, streaming: false });
      run.message = { ...event.message, streaming: true, elapsed: 0, working: "正在按引导继续" };
      run.started = Date.now();
      run.interaction = null;
      run.node = visible ? appendMessage(run.message) : null;
    }
  }
}
export function updateRail() {
  const nodes = [...$("#messages").querySelectorAll(".message.user")];
  $("#message-rail").innerHTML = nodes
    .map(
      (node) =>
        `<button data-jump="${node.id}" aria-label="跳转到消息：${escape(node._message?.content?.slice(0, 90) || "历史消息")}" title="${escape(node._message?.content?.slice(0, 90) || "历史消息")}"></button>`,
    )
    .join("");
}
export function trackScroll() {
  const top = $("#conversation").scrollTop;
  if (top < lastScrollTop - 1) followingLatest = false;
  else if (!holdingPointer && nearBottom()) followingLatest = true;
  lastScrollTop = top;
  $("#jump-bottom").hidden = nearBottom();
  const area = $("#conversation").getBoundingClientRect();
  let active = "";
  for (const node of $("#messages").querySelectorAll(".message.user"))
    if (node.getBoundingClientRect().top <= area.top + 120) active = node.id;
  $("#message-rail")
    .querySelectorAll("button")
    .forEach((b) => b.classList.toggle("active", b.dataset.jump === active));
}
export function decorateFiles(root, answer = false) {
  root.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href");
    if (
      /^(?:file:\/\/|\/(?!\/)|~\/|\.\.?\/)/.test(href) ||
      (!/^[a-z][a-z\d+.-]*:/i.test(href) && !href.startsWith("#"))
    ) {
      try {
        a.dataset.file = decodeURIComponent(href.replace(/^file:\/\//, ""));
      } catch {
        a.dataset.file = href;
      }
      a.removeAttribute("target");
    }
  });
  root.querySelectorAll(answer ? "p>code,li>code" : ".answer p>code,.answer li>code").forEach((code) => {
    const text = code.textContent.trim();
    if (/^(?:\/(?!\/)|~\/|\.\.?\/)[^\n]+/.test(text)) {
      const b = document.createElement("button");
      b.className = "file-link";
      b.dataset.file = text;
      b.textContent = text;
      code.replaceWith(b);
    }
  });
}
export async function openFile(path) {
  let value = path.replace(/(?::\d+){1,2}$/, "");
  if (!/^(?:\/|~\/|[A-Za-z]:)/.test(value))
    value = `${state.session?.workdir || state.workdir}/${value}`;
  await api("/api/files/open", { method: "POST", body: { path: value } });
}
