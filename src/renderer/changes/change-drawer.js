function projectActivity(activity) {
  return activity.presentation?.kind?.startsWith("project-");
}

function lineCounts(patch = "") {
  let added = 0;
  let removed = 0;
  for (const line of patch.split(/\r?\n/u)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

export function renderChangeDrawer(elements, snapshot, session) {
  if (!elements?.list || !elements?.summary) return;
  const activities = session.activities.filter(projectActivity).slice().reverse();
  const paths = new Set(activities.flatMap((activity) => activity.presentation?.paths ?? []));
  const workspace = (snapshot.workspaces ?? []).filter((item) =>
    (item.runId && session.activeRunIds?.includes(item.runId))
    || (item.projectRoot && samePath(item.projectRoot, session.workingDirectory))).at(-1);
  const review = [...session.events].reverse().find((event) => event.type === "review.completed")?.payload?.result;

  elements.summary.textContent = activities.length
    ? `${paths.size} 个文件 · ${activities.length} 次改动`
    : session.projectAccess?.enabled ? "尚无文件改动" : "打开项目后显示改动";
  if (elements.state) {
    elements.state.textContent = workspace
      ? `${workspace.mode === "isolated" ? "隔离" : "共享"}工作区 · ${workspace.reviewOutcome ?? "待审查"}`
      : "当前会话没有工作区";
  }
  if (elements.review) {
    elements.review.textContent = workspace?.reviewOutcome || review?.outcome
      ? `自动审查 ${workspace?.reviewOutcome ?? review.outcome}`
      : "自动审查尚未运行";
  }

  elements.list.replaceChildren();
  for (const activity of activities) {
    const presentation = activity.presentation;
    const item = document.createElement("article");
    item.className = "change-item";
    const heading = document.createElement("div");
    heading.className = "change-item-heading";
    const title = document.createElement("strong");
    title.textContent = presentation.paths?.[0] ?? activity.title;
    title.title = presentation.paths?.join(" → ") ?? activity.title;
    const counts = lineCounts(presentation.patch);
    const metrics = document.createElement("span");
    metrics.className = "change-counts";
    metrics.innerHTML = `<span class="added">+${counts.added}</span><span class="removed">−${counts.removed}</span>`;
    heading.append(title, metrics);

    const meta = document.createElement("p");
    const labels = {
      write: "写入",
      edit: "编辑",
      rename: "重命名",
      delete: "删除",
      restore: "恢复",
      diff: "差异",
    };
    meta.textContent = `${labels[presentation.action] ?? presentation.action ?? "改动"} · ${activity.status}`;
    item.append(heading, meta);

    if (presentation.patch) {
      const details = document.createElement("details");
      details.className = "change-patch";
      const summary = document.createElement("summary");
      summary.textContent = presentation.patchTruncated ? "查看片段" : "查看差异";
      const patch = document.createElement("pre");
      for (const line of presentation.patch.split(/(\r?\n)/u)) {
        if (line === "\n" || line === "\r\n") {
          patch.append(document.createTextNode(line));
          continue;
        }
        const span = document.createElement("span");
        span.className = line.startsWith("+") && !line.startsWith("+++")
          ? "diff-added"
          : line.startsWith("-") && !line.startsWith("---") ? "diff-removed" : "";
        span.textContent = line;
        patch.append(span);
      }
      details.append(summary, patch);
      item.append(details);
    }
    elements.list.append(item);
  }

  if (!activities.length) {
    const empty = document.createElement("div");
    empty.className = "change-empty";
    empty.innerHTML = "<strong>没有改动</strong><span>Agent 写入文件后，差异会在这里出现。</span>";
    elements.list.append(empty);
  }
}

function samePath(left, right) {
  return String(left ?? "").replace(/[\\/]+$/u, "").toLocaleLowerCase("en-US")
    === String(right ?? "").replace(/[\\/]+$/u, "").toLocaleLowerCase("en-US");
}
