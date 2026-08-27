const statusLabels = {
  idle: "就绪",
  running: "运行中",
  queued: "排队中",
  waiting: "等待消息",
  cancelled: "已取消",
  failed: "失败",
};

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

export function renderActivityInspector(elements, session, permissions, actions) {
  const pendingApprovals = (permissions?.pending ?? []).filter((request) => request.sessionId === session.id);
  elements.status.textContent = pendingApprovals.length ? "等待批准" : statusLabels[session.status] ?? session.status;
  elements.reused.textContent = `${session.cachePlan.reusedContextChars} 字符`;
  elements.added.textContent = `${session.cachePlan.addedContextChars} 字符`;
  elements.activities.replaceChildren();
  elements.events.replaceChildren();

  for (const approval of pendingApprovals) {
    const item = document.createElement("section");
    item.className = "approval-card";
    item.setAttribute("aria-label", `工具批准：${approval.toolName}`);
    const heading = document.createElement("strong");
    heading.textContent = `${approval.readOnly ? "只读工具" : "状态变更工具"} · ${approval.toolName}`;
    const detail = document.createElement("p");
    detail.textContent = approval.summary || "Provider 请求执行此工具。";
    const buttons = document.createElement("div");
    buttons.className = "approval-actions";
    const reject = document.createElement("button");
    reject.className = "quiet-button";
    reject.type = "button";
    reject.textContent = "拒绝";
    reject.addEventListener("click", () => actions.resolve(approval.runId, approval.callId, "reject"));
    const allow = document.createElement("button");
    allow.className = "primary-button";
    allow.type = "button";
    allow.textContent = "仅本次允许";
    allow.addEventListener("click", () => actions.resolve(approval.runId, approval.callId, "allow-once"));
    buttons.append(reject, allow);
    item.append(heading, detail, buttons);
    elements.activities.append(item);
  }

  const restoredReceipts = new Set(session.activities
    .map((activity) => activity.presentation)
    .filter((presentation) => presentation?.action === "restore" && presentation.recoveryReceiptId)
    .map((presentation) => presentation.recoveryReceiptId));
  for (const activity of session.activities.slice(-9).reverse()) {
    const item = document.createElement("div");
    item.className = "activity-item";
    item.innerHTML = `<span class="activity-dot ${activity.status}"></span><span><span class="activity-title"></span><span class="activity-detail"></span></span>`;
    item.querySelector(".activity-title").textContent = `${activity.title}${activity.readOnly ? " · 只读" : ""}`;
    item.querySelector(".activity-detail").textContent = activity.detail;
    const presentation = activity.presentation;
    if (presentation?.kind?.startsWith("project-")) {
      const body = item.querySelector(".activity-detail").parentElement;
      const paths = document.createElement("span");
      paths.className = "activity-file-paths";
      paths.textContent = presentation.paths.join(" → ");
      body.append(paths);
      if (presentation.patch) {
        const details = document.createElement("details");
        details.className = "project-diff";
        const summary = document.createElement("summary");
        summary.textContent = presentation.patchTruncated ? "查看差异片段（可继续读取）" : "查看差异";
        const patch = document.createElement("pre");
        patch.textContent = presentation.patch;
        details.append(summary, patch);
        body.append(details);
      }
      if (presentation.recoveryReceiptId
        && presentation.recoveryStatus === "available"
        && !restoredReceipts.has(presentation.recoveryReceiptId)) {
        const restore = document.createElement("button");
        restore.type = "button";
        restore.className = "quiet-button restore-button";
        restore.textContent = "恢复删除";
        restore.addEventListener("click", () => actions.restore(presentation.recoveryReceiptId));
        body.append(restore);
      }
    } else if (presentation?.kind === "terminal-run") {
      const body = item.querySelector(".activity-detail").parentElement;
      const meta = document.createElement("span");
      meta.className = "terminal-meta";
      meta.textContent = `${presentation.status} · exit ${presentation.exitCode ?? "—"} · ${presentation.durationMs} ms · ${presentation.cwd ?? "."}`;
      body.append(meta);
      for (const streamName of ["stdout", "stderr"]) {
        const output = presentation[streamName];
        if (!output) continue;
        const details = document.createElement("details");
        details.className = "terminal-output";
        const summary = document.createElement("summary");
        summary.textContent = `${streamName} · ${output.totalBytes} 字节${output.truncated ? " · 有界首尾，可续读" : ""}`;
        const preview = document.createElement("pre");
        preview.textContent = output.preview || "（无输出）";
        details.append(summary, preview);
        if (output.truncated && actions.readOutput) {
          let nextOffset = 0;
          const more = document.createElement("button");
          more.type = "button";
          more.className = "quiet-button terminal-output-more";
          more.textContent = "续读";
          more.setAttribute("aria-label", "从头续读完整输出");
          more.title = "从头续读完整输出";
          more.dataset.tooltip = "续读完整输出";
          more.addEventListener("click", async () => {
            more.disabled = true;
            const result = await actions.readOutput({
              executionId: presentation.executionId,
              stream: streamName,
              offset: nextOffset,
              maxBytes: 16384,
            });
            if (!result?.ok) {
              more.textContent = result?.error?.message ?? "输出未能读取";
              return;
            }
            if (nextOffset === 0) preview.textContent = "";
            preview.textContent += result.text;
            nextOffset = result.nextOffset ?? nextOffset + result.bytes;
            if (result.nextOffset === null) {
              more.textContent = "已读取完整输出";
              more.title = "已读取完整输出";
              more.dataset.tooltip = "已读取完整输出";
              return;
            }
            more.disabled = false;
            more.textContent = `继续读取（偏移 ${result.nextOffset}）`;
            more.title = more.textContent;
            more.dataset.tooltip = more.textContent;
          });
          details.append(more);
        }
        body.append(details);
      }
    } else if (presentation?.kind === "terminal-output") {
      const body = item.querySelector(".activity-detail").parentElement;
      const output = document.createElement("pre");
      output.className = "terminal-output-slice";
      output.textContent = presentation.outputText || "（无输出）";
      body.append(output);
    }
    elements.activities.append(item);
  }
  if (!session.activities.length && !pendingApprovals.length) {
    const empty = document.createElement("p");
    empty.className = "activity-detail";
    empty.textContent = "暂无运行活动。";
    elements.activities.append(empty);
  }

  for (const event of session.events.slice(-12).reverse()) {
    const item = document.createElement("div");
    item.className = "event-item";
    const type = document.createElement("span");
    type.className = "event-type";
    type.textContent = event.type;
    const time = document.createElement("span");
    time.className = "event-time";
    time.textContent = formatTime(event.timestamp);
    item.append(type, time);
    elements.events.append(item);
  }
}

export { statusLabels };
