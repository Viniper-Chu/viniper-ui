import { setActionButtonPresentation } from "../ui/action-button.js";

export function renderScheduleCenter(elements, scheduler, sessions, providers, actions) {
  renderTargetOptions(elements.target, sessions);
  renderModelOptions(elements.model, providers);
  elements.list.replaceChildren();
  for (const schedule of scheduler.definitions) {
    const item = document.createElement("article");
    item.className = `schedule-item ${schedule.enabled ? "active" : "paused"}`;
    const heading = document.createElement("div");
    heading.className = "schedule-heading";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = schedule.name;
    const meta = document.createElement("small");
    const status = schedule.status ?? (schedule.enabled ? "active" : "paused");
    const previews = scheduler.previews?.[schedule.id] ?? [];
    const timeZone = schedule.schedule.timeZone ? ` · ${schedule.schedule.timeZone}` : "";
    const previewText = previews.length ? ` · 预览 ${previews.map((preview) => formatDate(preview.at)).join("、")}` : "";
    const model = modelSelectionLabel(schedule.modelSelection, providers);
    meta.textContent = schedule.enabled && schedule.nextRunAt
      ? `${model} · 下次 ${formatDate(schedule.nextRunAt)}${previewText}`
      : `${model} · ${statusLabel(status)}${timeZone}`;
    copy.append(title, meta);
    const controls = document.createElement("div");
    controls.className = "row-actions";
    if (status === "deleted") {
      controls.append(actionButton("恢复", () => actions.restore?.(schedule.id), { icon: "restore", iconOnly: true }));
    } else {
      controls.append(
        actionButton(schedule.enabled ? "暂停" : "恢复", () => actions.toggle(schedule.id, !schedule.enabled), { icon: schedule.enabled ? "pause" : "restore", iconOnly: true }),
        actionButton("立即运行", () => actions.runNow(schedule.id), { icon: "play", iconOnly: true }),
        actionButton("删除", () => actions.remove(schedule.id), { icon: "remove", iconOnly: true }),
      );
    }
    heading.append(copy, controls);
    const prompt = document.createElement("p");
    prompt.textContent = schedule.prompt;
    item.append(heading, prompt);
    elements.list.append(item);
  }
  if (!scheduler.definitions.length) elements.list.append(empty("还没有自动任务。设置一个近未来时间即可观察应用运行时触发。"));

  elements.history.replaceChildren();
  for (const record of scheduler.history.slice(0, 8)) {
    const row = document.createElement("div");
    row.className = `history-row ${record.status}`;
    row.textContent = `${formatDate(record.triggeredAt)} · ${record.status === "accepted" ? "已进入运行时" : "失败"} · ${record.detail}`;
    elements.history.append(row);
  }
  if (!scheduler.history.length) elements.history.append(empty("暂无触发历史。"));
}

function renderModelOptions(select, providers) {
  if (!select) return;
  const selected = select.value;
  select.replaceChildren();
  for (const provider of providers.filter((item) => item.available)) {
    for (const model of provider.models) {
      const option = document.createElement("option");
      option.value = JSON.stringify({ providerId: provider.id, modelId: model.id });
      option.textContent = `${provider.name} · ${model.label}`;
      select.append(option);
    }
  }
  if ([...select.options].some((option) => option.value === selected)) select.value = selected;
}

function modelSelectionLabel(selection, providers) {
  if (!selection || selection.mode === "inherit") return "跟随会话模型";
  if (selection.mode === "smart") {
    return `智能 · ${selection.strategy === "quality" ? "质量" : selection.strategy === "lightweight" ? "轻量" : "均衡"}`;
  }
  const provider = providers.find((item) => item.id === selection.providerId);
  const model = provider?.models.find((item) => item.id === selection.modelId);
  return `${provider?.name ?? selection.providerId} · ${model?.label ?? selection.modelId}`;
}

function renderTargetOptions(select, sessions) {
  const selected = select.value;
  select.replaceChildren();
  for (const session of sessions) {
    const option = document.createElement("option");
    option.value = `session:${session.id}`;
    option.textContent = `现有会话 · ${session.title}`;
    select.append(option);
  }
  const isolated = document.createElement("option");
  isolated.value = "new-session";
  isolated.textContent = "每次新建隔离会话";
  select.append(isolated);
  if ([...select.options].some((option) => option.value === selected)) select.value = selected;
}

function actionButton(label, action, options) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "text-button";
  setActionButtonPresentation(button, label, options);
  button.addEventListener("click", action);
  return button;
}

function empty(text) {
  const element = document.createElement("p");
  element.className = "empty-copy";
  element.textContent = text;
  return element;
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusLabel(status) {
  return {
    active: "运行中",
    paused: "已暂停",
    deleted: "已删除（可恢复）",
    "waiting-permission": "等待批准",
    "project-invalid": "项目不可用",
    "imported-timezone": "已导入时区",
    "overlap-pending": "等待补跑",
  }[status] ?? status;
}
