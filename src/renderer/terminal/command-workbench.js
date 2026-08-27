import { setActionButtonPresentation } from "../ui/action-button.js";

const TERMINAL_ACTIVITY_PREFIX = "terminal-";

export function renderCommandWorkbench(elements, session, options) {
  const stream = elements.stream;
  if (!stream) return;
  const activities = (session?.activities ?? []).filter((activity) => {
    const kind = activity.presentation?.kind ?? "";
    return activity.toolName?.startsWith("terminal.") || kind.startsWith(TERMINAL_ACTIVITY_PREFIX);
  });
  stream.replaceChildren();
  if (activities.length === 0) {
    const empty = document.createElement("p");
    empty.className = "command-workbench-empty";
    empty.textContent = "提交 Agent 任务后，命令、工具与 stdout / stderr 会沿同一条执行轨道出现。";
    stream.append(empty);
    if (elements.status) elements.status.textContent = "等待 Agent 通过 terminal.run 执行";
    return;
  }

  for (const activity of activities.slice(-6)) {
    const row = document.createElement("article");
    row.className = `terminal-stream-row ${activity.status}`;
    const marker = document.createElement("span");
    marker.className = "terminal-stream-marker";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = "—";
    const body = document.createElement("div");
    body.className = "terminal-stream-body";
    const heading = document.createElement("div");
    heading.className = "terminal-stream-heading";
    const title = document.createElement("strong");
    title.textContent = activity.title || activity.toolName || "工具";
    const state = document.createElement("span");
    state.textContent = terminalStatusLabel(activity.status);
    heading.append(title, state);
    const detail = document.createElement("p");
    detail.textContent = activity.detail || "正在等待工具结果。";
    body.append(heading, detail);
    const presentation = activity.presentation;
    if (presentation?.kind === "terminal-run") {
      for (const stream of ["stdout", "stderr"]) {
        const preview = presentation[stream];
        appendOutput(body, stream, preview?.preview, preview?.truncated, preview?.totalBytes);
        if (preview?.truncated) {
          appendContinueButton(body, {
            executionId: presentation.executionId,
            stream,
            nextOffset: 0,
          }, options);
        }
        const continued = options.continuations.get(`${activity.id}:${presentation.executionId}:${stream}`);
        if (continued) {
          appendOutput(body, stream, continued.text, continued.nextOffset !== null, continued.totalBytes, true);
          appendContinueButton(body, { ...continued, executionId: presentation.executionId }, options);
        }
      }
    } else if (presentation?.kind === "terminal-output") {
      appendOutput(body, presentation.stream, presentation.outputText, presentation.nextOffset !== null, presentation.totalBytes);
      appendContinueButton(body, presentation, options);
    }
    row.append(marker, body);
    stream.append(row);
  }
  if (elements.status) elements.status.textContent = `${activities.length} 条终端活动 · 完整输出可按范围续读`;
}

function appendOutput(parent, stream, text, truncated, totalBytes, continued = false) {
  if (!text && !totalBytes) return;
  const wrapper = document.createElement("div");
  wrapper.className = `terminal-output ${stream}${continued ? " continued" : ""}`;
  const label = document.createElement("span");
  label.className = "terminal-output-label";
  label.textContent = `${stream} · ${totalBytes ?? 0} 字节`;
  const content = document.createElement("code");
  content.textContent = text || "（空）";
  wrapper.append(label, content);
  if (truncated) {
    const hint = document.createElement("span");
    hint.className = "terminal-output-more";
    hint.textContent = "可续读";
    wrapper.append(hint);
  }
  parent.append(wrapper);
}

function appendContinueButton(parent, presentation, options) {
  if (!presentation || presentation.nextOffset === null || presentation.nextOffset === undefined) return;
  const executionId = presentation.executionId;
  const stream = presentation.stream || "stdout";
  if (!executionId || !options?.readOutput) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "quiet-button terminal-output-continue";
  const label = `继续读取 ${stream}`;
  setActionButtonPresentation(button, label, { icon: "continue", iconOnly: true });
  button.addEventListener("click", async () => {
    button.disabled = true;
    setActionButtonPresentation(button, `正在读取 ${stream}…`, { icon: "continue", iconOnly: true });
    try {
      await options.readOutput({ executionId, stream, offset: presentation.nextOffset, maxBytes: 8192 });
    } finally {
      button.disabled = false;
      setActionButtonPresentation(button, label, { icon: "continue", iconOnly: true });
    }
  });
  parent.append(button);
}

function terminalStatusLabel(status) {
  return {
    running: "运行中",
    waiting: "等待",
    completed: "已完成",
    cancelled: "已取消",
    failed: "失败",
  }[status] ?? status;
}
