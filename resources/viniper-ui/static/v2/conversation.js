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
  document.getElementById(id)?.scrollIntoView({ block: "start", behavior: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
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
export function toolTitle(name) {
  return {
    "project.list": "查看项目目录", "project.search": "搜索项目", "project.read": "读取项目文件",
    "project.write": "写入项目文件", "project.edit": "修改项目文件", "project.diff": "查看文件差异",
    "github.repository.read": "读取 GitHub 仓库",
    "coordination.send-message": "发送协作消息", "coordination.delegate-task": "分配协作任务",
    "coordination.wait-for-result": "等待任务结果", "coordination.read-result": "读取任务结果",
    "file.list": "定位文件", "file.search": "查找文件", "file.read": "读取文件",
    "file.edit": "修改文字", "file.write": "写入文件",
    "file.docx.inspect": "读取文档结构", "file.docx.replace": "替换文档文字",
    "file.docx.edit": "调整文档文字与格式", "file.sqlite.inspect": "查看数据库结构",
    "file.sqlite.query": "查询数据", "file.sqlite.apply": "更新并回读数据",
    "file.image.analyze": "检查图片",
    "math.quadratic.check": "验算实根个数", "file.math.handout": "制作师生讲义", "file.pdf.inspect": "读取 PDF 页面", "file.pdf.render": "渲染 PDF 页面",
    "terminal.run": "运行命令", "terminal.output": "查看命令输出",
    "web.search": "搜索资料", "web.fetch": "阅读网页",
  }[name] || name;
}
export function workingLabel(value) {
  return String(value || "等待模型响应").replace(/正在准备操作内容(?:.*)?$/, "正在准备工具调用");
}
function toolReceipt(tool) {
  if (tool.type !== "tool_result" && tool.type !== "tool") return "";
  const name = tool.tool_name || tool.name;
  let data;
  try { data = JSON.parse(tool.content || tool.output || ""); } catch { return ""; }
  if (name === "math.quadratic.check" && data?.ok === true) {
    const families = Array.isArray(data.families) ? data.families : [data];
    const pieces = families.flatMap(f => Array.isArray(f?.pieces) ? f.pieces : []);
    if (pieces.length) return "已核对 " + pieces.length + " 个参数区间或临界值";
    if (Array.isArray(data.cases)) return "已验算 " + data.cases.length + " 组系数";
  }
  if (name === "file.math.handout" && data?.success === true) {
    const facts = [Number.isInteger(data.question_count) && data.question_count + " 题",
      Number.isInteger(data.student?.page_count) && "学生版 " + data.student.page_count + " 页",
      Number.isInteger(data.teacher?.page_count) && "教师版 " + data.teacher.page_count + " 页"];
    return facts.filter(Boolean).join(" · ");
  }
  if (name !== "file.sqlite.apply" || !Array.isArray(data?.transactions)) return "";
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
  // Filesystem watchers can report Finder metadata; it is not a deliverable.
  for (const path of files.keys()) if (/^(?:\.DS_Store|Thumbs\.db|\._.*)$/i.test(path.split(/[\\/]/).at(-1))) files.delete(path);
  if (!files.size) return "";
  const cards = [...files.values()].map((file) => {
    const name = file.path.split(/[\\/]/).at(-1);
    const parent = file.path.slice(0, -name.length).replace(/[\\/]$/, "");
    const type = /\.pdf$/i.test(name) ? "PDF" : /\.tex$/i.test(name) ? "TeX" : /\.docx$/i.test(name) ? "Word" : /\.(db|sqlite3?)$/i.test(name) ? "数据" : /\.(py|ts|js|tsx|jsx|rs)$/i.test(name) ? "代码" : "文件";
    const glyph = type === "数据" ? "database" : ["代码", "TeX"].includes(type) ? "codeWindow" : "document";
    return `<button class="result-file" data-file="${escape(file.path)}"><span class="result-file-icon" aria-hidden="true" data-result-type="${type}">${type === "PDF" ? "PDF" : icon(glyph)}</span><span class="result-file-copy"><strong>${escape(name)}</strong><small>${escape(parent)}</small></span><span class="sr-only">${type}</span>${icon("external")}</button>`;
  });
  const more = cards.length > 3
    ? `<details class="more-files"><summary data-hint="其余交付文件">${icon("chevron")}另外 ${cards.length - 3} 个文件</summary><div class="more-files-list">${cards.slice(3).join("")}</div></details>`
    : "";
  return `<div class="result-files" aria-label="本轮文件">${cards.slice(0, 3).join("")}${more}${[...new Set(documents.map(document => document.sourceDirectory).filter(Boolean))].map(path => `<button class="text-button" data-file="${escape(path)}">${icon("folder")}完整 TeX 源码${icon("external")}</button>`).join("")}</div>`;
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
  const path = String(tool.input?.path || tool.path || "");
  const filename = path.split(/[\\/]/).filter(Boolean).at(-1);
  const receipt = toolReceipt(tool);
  const glyph = error ? "shieldAlert" : status === "waiting" ? "clock" : ["cancelled", "interrupted"].includes(status) ? "pause" : status === "running" ? "activityTool" : "check";
  return `<div class="tool-event${error ? " error" : ""}" data-call-id="${escape(tool.call_id || tool.tool_id || tool.path || title)}"><details>
    <summary data-hint="工具调用详情" class="step-heading"><span class="step-glyph">${icon(glyph)}</span><span class="step-label">${escape(toolTitle(String(title)))}</span>${filename ? `<span class="step-target">${escape(filename)}</span>` : ""}<small${["success", "completed"].includes(status) && !error ? ' class="sr-only"' : ""}>${escape(error && !["failed", "error", "rejected", "denied", "blocked"].includes(status) ? "失败" : label)}</small><span class="step-chevron">${icon("chevron")}</span></summary>
    <div class="tool-body">${path && !error ? `<button class="file-link tool-path" data-file="${escape(path)}">${icon("file")}${escape(filename || path)}</button>` : ""}${receipt ? `<p class="tool-receipt">${escape(receipt)}</p>` : ""}${terminalHtml(tool)}<pre>${escape(input + output)}</pre></div>
  </details></div>`;

}
// Preserve the order of the canonical event stream. Tool results update their
// original call row; reasoning never gets concatenated ahead of all replies.
export function conversationTimeline(message) {
  const parts = [], tools = new Map();
  const segments = message.segments || [];
  const hasThoughts = segments.some(s => ["thinking", "reasoning"].includes(s.type));
  const hasText = segments.some(s => s.type === "text");
  const pushText = (kind, content, source) => {
    if (!content) return;
    const last = parts.at(-1);
    if (last?.kind === kind) last.content += content;
    else parts.push({ kind, content, key: `${kind}-${source}` });
  };
  if (!hasThoughts && message.thinking) pushText("thinking", message.thinking, "legacy");
  segments.forEach((segment, index) => {
    if (["thinking", "reasoning", "text"].includes(segment.type)) {
      pushText(segment.type === "text" ? "text" : "thinking", segment.content || "", index);
      return;
    }
    if (["tool_start", "tool_result", "tool"].includes(segment.type)) {
      const id = segment.call_id || segment.tool_call_id || segment.tool_id;
      const prior = id && tools.get(id);
      if (prior) { prior.tool = { ...prior.tool, ...segment }; prior.resultSource = segment; }
      else {
        const part = { kind: "tool", key: `tool-${id || index}`, source: segment, tool: { ...segment } };
        parts.push(part);
        if (id) tools.set(id, part);
      }
    } else if (["plan", "plan_timeline", "turn_diff", "context_compacted"].includes(segment.type)) {
      parts.push({ kind: "tool", key: `event-${index}`, source: segment, tool: segment });
    }
  });
  if (!hasText) pushText("text", message.content || "", "legacy");
  else {
    const represented = segments.filter(s => s.type === "text").map(s => s.content || "").join("");
    if (represented && message.content?.startsWith(represented)) pushText("text", message.content.slice(represented.length), "tail");
  }
  const lastWork = parts.findLastIndex(p => p.kind !== "text");
  for (let i = 0; i < parts.length; i++) parts[i].final = parts[i].kind === "text" && i > lastWork;
  return parts;
}
function activityData(message, parts) {
  const count = parts.filter(p => p.kind === "tool" && ["tool", "tool_start", "tool_result"].includes(p.tool.type)).length;
  const elapsed = message.elapsed ?? message.elapsed_seconds ?? message.turn_usage?.elapsed_seconds ?? 0;
  const outcome = message.cancelled ? "已停止 · " : message.steered ? "已按引导中断 · " : message.error ? "未完成 · " : "";
  return {
    label: `${outcome}用时 ${elapsed ? timeLabel(elapsed) : "不足 1 秒"}`,
    count: count ? `${count} 次操作` : "",
    expandable: parts.some(part => isFoldable(part)),
    outcome,
  };
}
function isFoldable(part) {
  if (part.kind !== "tool") return part.kind === "thinking";
  const tool = part.tool;
  if (!["tool", "tool_start", "tool_result"].includes(tool.type) || tool.is_error) return false;
  return ["success", "completed"].includes(tool.status || (tool.type === "tool_start" ? "running" : "success"));
}
function timelinePartHtml(part, streaming, live, thinkingActive) {
  if (part.kind === "text") return `<div class="answer${part.final ? " final-answer" : " progress-answer"}">${markdown(part.content, streaming && live)}</div>`;
  if (part.kind === "tool") return toolHtml(part.tool, streaming);
  return `<details class="thought-step"><summary data-hint="思考记录" class="step-heading"><span class="step-glyph">${icon("thought")}</span><span class="step-label">${thinkingActive ? "正在思考" : "思考过程"}</span><span class="step-chevron">${icon("chevron")}</span></summary><div class="thinking-content"></div></details>`;
}
function timelineHtml(message, parts) {
  return parts.map((part, i) => {
    const last = i === parts.length - 1;
    const thinking = Boolean(message.streaming && last && part.kind === "thinking" && message.working === "正在思考");
    return `<div class="timeline-part" data-kind="${part.kind}" data-foldable="${isFoldable(part)}" data-thinking="${thinking}" data-part-key="${escape(part.key)}">${timelinePartHtml(part, Boolean(message.streaming), last, thinking)}</div>`;
  }).join("");
}
function copyAnswer(message) {
  const parts = conversationTimeline(message).filter(p => p.kind === "text");
  const final = parts.filter(p => p.final);
  return (final.length ? final : parts).map(p => p.content).join("\n\n");
}
function messageHtml(message) {
  if (message.role === "user")
    return `<div class="user-content">${message.guidance ? `<span class="guidance-label">${icon("steer")}引导</span>` : ""}${escape(message.content)}${(message.attachments || []).map((a) => `<div><button class="file-link" data-file="${escape(a.path || "")}">${icon("file")}${escape(a.name || a.path)}</button></div>`).join("")}</div>`;
  const parts = conversationTimeline(message), data = activityData(message, parts), content = copyAnswer(message);
  return `<button class="turn-summary"${message.streaming || !data.expandable ? " hidden" : ""} data-toggle-thoughts aria-expanded="false"><span class="activity-label">${escape(data.label)}</span><small class="activity-count">${escape(data.count)}</small><span class="step-chevron">${icon("chevron")}</span></button><span class="turn-outcome"${!message.streaming && !data.expandable && data.outcome ? "" : " hidden"}>${escape(data.label)}</span><div class="turn-timeline">${timelineHtml(message, parts)}</div><div class="message-results">${resultFiles(message)}</div><div class="message-plan">${message.planned && !message.streaming ? '<button class="secondary-button" data-action="implement-plan" data-hint="将实施要求填入输入框">按此计划开始实施</button>' : ""}</div><div class="message-actions"${content.trim() ? "" : " hidden"}><button class="icon-button" data-copy="${escape(content)}" aria-label="复制回答">${icon("copy")}</button></div>`;
}
function updateMessage(node, message) {
  node._message = message;
  if (message.role === "user") { updateMarkup(node, messageHtml(message)); return; }
  const parts = conversationTimeline(message), data = activityData(message, parts);
  const summary = node.querySelector(".turn-summary");
  if (summary.hidden && !message.streaming && node.querySelector("details[open]")) summary.setAttribute("aria-expanded", "true");
  summary.hidden = Boolean(message.streaming || !data.expandable);
  const outcome = node.querySelector(".turn-outcome");
  outcome.hidden = Boolean(message.streaming || data.expandable || !data.outcome);
  if (!outcome.hidden) outcome.textContent = data.label;
  for (const [className, text] of [["activity-label", data.label], ["activity-count", data.count]]) {
    const part = node.querySelector(`.${className}`);
    if (part.textContent !== text) part.textContent = text;
    part.hidden = !text;
  }
  const list = node.querySelector(".turn-timeline");
  const existing = new Map([...list.children].map(slot => [slot.dataset.partKey, slot]));
  parts.forEach((part, index) => {
    let slot = existing.get(part.key);
    if (!slot) {
      slot = document.createElement("div"); slot.className = "timeline-part"; slot.dataset.partKey = part.key;
      slot.innerHTML = timelinePartHtml(part, Boolean(message.streaming), index === parts.length - 1);
    }
    slot.dataset.kind = part.kind;
    slot.dataset.foldable = String(isFoldable(part));
    const thinking = Boolean(message.streaming && index === parts.length - 1 && part.kind === "thinking" && message.working === "正在思考");
    slot.dataset.thinking = String(thinking);
    if (list.children[index] !== slot) list.insertBefore(slot, list.children[index] || null);
    const previousPart = slot._part, wasStreaming = slot._streaming;
    slot._part = part; slot._streaming = message.streaming;
    if (part.kind === "text") {
      const answer = slot.querySelector(".answer");
      answer.classList.toggle("final-answer", part.final); answer.classList.toggle("progress-answer", !part.final);
      updateMarkdown(answer, part.content, Boolean(message.streaming) && index === parts.length - 1);
    } else if (part.kind === "tool") {
      if (previousPart?.source !== part.source || previousPart?.resultSource !== part.resultSource || wasStreaming !== message.streaming) updateMarkup(slot, toolHtml(part.tool, Boolean(message.streaming)));
    }
    else {
      const detail = slot.querySelector("details"), label = detail.querySelector(".step-label");
      const text = thinking ? "正在思考" : "思考过程";
      if (label.textContent !== text) label.textContent = text;
      if (detail.open) updateMarkdown(detail.querySelector(".thinking-content"), part.content, Boolean(message.streaming));
    }
  });
  const retained = new Set(parts.map(p => p.key));
  for (const slot of [...list.children]) if (!retained.has(slot.dataset.partKey)) slot.remove();
  updateMarkup(node.querySelector(".message-results"), resultFiles(message));
  updateMarkup(node.querySelector(".message-plan"), message.planned && !message.streaming ? '<button class="secondary-button" data-action="implement-plan" data-hint="将实施要求填入输入框">按此计划开始实施</button>' : "");
  const answer = copyAnswer(message), copy = node.querySelector("[data-copy]");
  node.querySelector(".message-actions").hidden = !answer.trim();
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
  node.addEventListener("toggle", (event) => {
    if (!event.target.matches?.(".thought-step") || !event.target.open) return;
    const slot = event.target.closest(".timeline-part");
    const part = slot._part || conversationTimeline(node._message).find(p => p.key === slot.dataset.partKey);
    if (part) updateMarkdown(event.target.querySelector(".thinking-content"), part.content, Boolean(node._message.streaming));
  }, true);
  node.addEventListener("click", event => {
    const summary = event.target.closest("[data-toggle-thoughts]");
    if (!summary) return;
    const open = summary.getAttribute("aria-expanded") !== "true";
    summary.setAttribute("aria-expanded", String(open));
    for (const thought of node.querySelectorAll(".thought-step")) thought.open = open;
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
function appendLiveSegment(message, type, content) {
  message.segments ||= [];
  const last = message.segments.at(-1);
  if (last?.type === type) last.content = (last.content || "") + content;
  else message.segments.push({ type, content });
}
export function projectEvent(run, event) {
  if (event.sequence && event.sequence <= run.sequence) return;
  if (event.turn_started_at > 0) run.started = event.turn_started_at * 1000;
  if (event.activity_phase) run.phase = event.activity_phase;
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
    if (!event.turn_started_at) run.started = Date.now();
    if (state.session?.session_id === run.sessionId) {
      appendMessage({ role: "user", content: event.item?.text || "" });
      run.node = appendMessage(run.message);
    }
    return;
  }
  const m = run.message,
    type = event.type;
  if (["text", "thinking", "thinking_delta", "tool_start", "tool_result", "working_status"].includes(type)) run.lastActivityAt = Date.now();
  if (type === "run_status" && event.status === "cancelled") {
    run.stopRequested = true;
    run.cancelAcknowledged = true;
    m.stopping = true;
  } else if (type === "text") {
    m.content += event.content || "";
    appendLiveSegment(m, "text", event.content || "");
    m.working = "正在回答";
  } else if (type === "thinking" || type === "thinking_delta") {
    m.thinking += event.content || "";
    appendLiveSegment(m, "thinking", event.content || "");
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
    { run.interaction = event; m.working = "等待确认"; }
  else if (["interaction_resolved", "permission_resolved"].includes(type))
    { run.interaction = null; m.working = "正在继续处理"; }
  else if (type === "error") {
    run.error = true;
    m.error = true;
    const errorText = `\n\n${event.content || "本次任务未完成"}`;
    m.content += errorText;
    appendLiveSegment(m, "text", errorText);
  } else if (type === "done") {
    run.done = true;
    m.streaming = false;
    m.stopping = false;
    if (run.cancelAcknowledged) m.cancelled = true;
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
      if (!event.turn_started_at) run.started = Date.now();
      run.interaction = null;
      run.node = visible ? appendMessage(run.message) : null;
    }
  }
}
export function updateRail() {
  const nodes = [...$("#messages").querySelectorAll(".message.user")];
  $("#turn-index-button").hidden = !$("#messages").children.length;
  $("#message-rail").innerHTML = nodes
    .map(
      (node) =>
        `<button data-jump="${node.id}" aria-label="跳转到消息：${escape(node._message?.content?.slice(0, 90) || "历史消息")}"></button>`,
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
