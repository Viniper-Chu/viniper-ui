const workspaceLabels = {
  shared: "共享",
  isolated: "隔离",
  retained: "保留现场",
  blocked: "未准备",
  commit_ready: "待提交",
  merge_ready: "待合并",
  merged: "已合并",
  conflicted: "冲突保留",
  recoverable: "七天可恢复",
  committed: "已提交",
  preparing: "准备中",
};

export function renderWorkspacePanel(elements, snapshot, session) {
  const candidates = (snapshot.workspaces ?? []).filter((item) =>
    (item.runId && item.runId === session.activeRunId)
    || (item.projectRoot && session.projectAccess?.enabled && samePath(item.projectRoot, session.workingDirectory)));
  const workspace = candidates.at(-1);
  elements.status.replaceChildren();
  elements.review.replaceChildren();
  if (!workspace) {
    elements.status.textContent = session.projectAccess?.enabled ? "项目工作区：尚未开始本 run" : "未打开项目；工作区能力不可用";
    elements.review.textContent = "自动审查：未触发";
    elements.section.dataset.state = "idle";
    return;
  }
  elements.status.textContent = `${workspaceLabels[workspace.status] ?? workspace.status} · ${workspaceLabels[workspace.mode] ?? workspace.mode}`
    + (workspace.ownedPaths?.length ? ` · ${workspace.ownedPaths.length} 个受管路径` : "");
  const review = workspace.reviewOutcome ?? "未触发";
  elements.review.textContent = `审查：${review}${workspace.checksPassed ? " · 检查通过" : " · 尚无通过检查"}`;
  elements.section.dataset.state = workspace.status;
}

function samePath(left, right) {
  return String(left).replace(/[\\/]+$/u, "").toLocaleLowerCase("en-US")
    === String(right).replace(/[\\/]+$/u, "").toLocaleLowerCase("en-US");
}
