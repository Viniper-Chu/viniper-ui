import { state, escape, api } from "./api.js";
import { icon } from "./icons.js";
const box = () => document.querySelector("#popover");
let opener = null;
export function closeMenu() {
  box().hidden = true;
  opener?.setAttribute("aria-expanded", "false");
  opener = null;
}
export function showMenu(button, html, { kind = "default" } = {}) {
  if (opener === button && !box().hidden) {
    closeMenu();
    return;
  }
  closeMenu();
  opener = button;
  button.setAttribute("aria-expanded", "true");
  box().dataset.kind = kind;
  if (kind === "session") box().setAttribute("role", "menu");
  else box().removeAttribute("role");
  box().innerHTML = html;
  box().hidden = false;
  positionMenu();
  box().querySelector("button")?.focus({ preventScroll: true });
}
function positionMenu() {
  if (!opener) return;
  const r = opener.getBoundingClientRect(),
    p = box();
  p.style.maxHeight = `${Math.max(120, Math.max(r.top - 20, innerHeight - r.bottom - 20))}px`;
  const left = Math.max(12, Math.min(r.left, innerWidth - p.offsetWidth - 12));
  const availableBelow = innerHeight - r.bottom - 12;
  const top =
    availableBelow >= p.offsetHeight
      ? r.bottom + 8
      : Math.max(12, r.top - p.offsetHeight - 8);
  Object.assign(p.style, { left: `${left}px`, top: `${top}px` });
  p.dataset.placement = top < r.top ? "above" : "below";
}
export function option({
  label,
  detail = "",
  image = "",
  action = "",
  value = "",
  checked = false,
  danger = false,
  disabled = false,
}) {
  const selection = ["mode", "model"].includes(action);
  const hints = {
    attach: "选择题图或其他本地文件", plan: "查看当前会话的任务计划", "open-project": "在系统中打开此会话的工作目录",
    rename: "修改此会话的名称", "delete-session": "移除此会话的聊天记录", "new-chat": "开始新会话  ⌘K",
  };
  let hint = hints[action] || detail || label;
  if (action === "model") hint = checked ? "当前模型：" + label : "切换到 " + label;
  if (action === "mode") hint = checked ? "退出" + label : detail;
  if (disabled) hint = action === "mode" ? "当前任务结束后可切换模式" : detail || "创建会话后可使用此操作";
  return `<button data-hint="${escape(hint)}" class="menu-option${danger ? " danger" : ""}" data-menu-action="${action}" data-value="${escape(value)}" role="${selection ? "menuitemradio" : "menuitem"}" ${selection ? `aria-checked="${checked}"` : ""} ${disabled ? "disabled" : ""}>${icon(image || "plugin")}<span class="option-copy"><strong>${escape(label)}</strong>${detail ? `<small>${escape(detail)}</small>` : ""}</span>${checked ? icon("check") : ""}</button>`;
}
export function sessionMenuContent(session) {
  const id = session?.id || session?.session_id || "";
  const active = Boolean(state.runs.get(id)?.active || session?.active_run?.active);
  return option({ label: "重命名会话", image: "edit", action: "rename", value: id, disabled: !id }) +
    option({ label: session?.pinned ? "取消置顶" : "置顶会话", image: "pin", action: "pin-session", value: id, disabled: !id }) +
    '<div class="menu-separator"></div>' +
    option({ label: "删除会话", detail: active ? "请先停止正在运行的任务" : "", image: "trash", action: "delete-session", value: id, danger: true, disabled: !id || active });
}
export function menuContent(kind) {
  const active = Boolean(
    state.runs.get(state.session?.session_id)?.active ||
      state.session?.active_run?.active,
  );
  if (kind === "add")
    return (
      option({
        label: "添加附件",
        image: "plus",
        action: "attach",
      }) +
      '<div class="menu-separator"></div>' +
      option({
        label: "规划模式",
        detail: "只读调研，确认后执行",
        image: "plan",
        action: "mode",
        value: "plan",
        checked: state.mode === "plan",
        disabled: active,
      }) +
      option({
        label: "目标模式",
        detail: "跨轮次推进，可随时暂停",
        image: "target",
        action: "mode",
        value: "goal",
        checked: state.mode === "goal",
        disabled: active,
      }) +
      '<div class="menu-separator"></div>' +
      option({ label: "选择技能或插件", image: "plugin", action: "extensions" })
    );
  if (kind === "model")
    return (
      "<h3>模型</h3>" +
      (state.status?.models || [])
        .map((m) => {
          const id = m.id || m.value || m.model;
          return option({
            label: m.label || m.name || id,
            detail: m.description || "",
            image: "model",
            action: "model",
            value: id,
            checked: state.model === id,
          });
        })
        .join("") +
      '<div class="menu-separator"></div><h3>智能程度</h3><div class="effort-options" role="group" aria-label="智能程度">' +
      (
        state.status?.local_agent?.reasoning_options || [
          "off",
          "low",
          "medium",
          "high",
        ]
      )
        .map((id) => [
          id,
          { off: "关闭", minimal: "极低", low: "低", medium: "中", high: "高" }[
            id
          ] || id,
        ])
        .map(
          ([id, label]) =>
            `<button role="radio" aria-checked="${state.reasoning === id}" data-menu-action="reasoning" data-value="${id}" data-hint="将智能程度设为${escape(label)}">${label}</button>`,
        )
        .join("") +
      "</div>" + '<div class="menu-separator"></div>' + option({ label: "模型连接设置", image: "settings", action: "connection-settings" })
    );
  if (kind === "context") {
    const u = state.session?.context_usage || {};
    return `<div class="context-details"><strong>上下文窗口</strong><p>${u.used_tokens ?? "—"} / ${u.context_limit ?? "—"} tokens</p><small>${escape(u.source === "real" ? "按实际模型输入计数" : u.usage_label || "等待模型用量回执")}<br>达到阈值时自动整理，原有会话记录保留。</small></div>`;
  }
  return (
    option({ label: "选择工作目录", image: "folder", action: "project" }) +
    option({ label: "查看任务计划", image: "plan", action: "plan" }) +
    option({
      label: "打开工作目录",
      image: "external",
      action: "open-project",
    }) +
    option({ label: "新建会话", image: "plus", action: "new-chat" }) +
    '<div class="menu-separator"></div>' +
    sessionMenuContent(state.session)
  );
}
window.addEventListener("resize", closeMenu);
document.addEventListener("pointerdown", (event) => {
  if (
    !box().hidden &&
    !box().contains(event.target) &&
    !opener?.contains(event.target)
  )
    closeMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !box().hidden) {
    const trigger = opener;
    closeMenu();
    trigger?.focus({ preventScroll: true });
  }
  if (event.key === "Tab" && !box().hidden) closeMenu();
  if (!box().hidden && ["ArrowDown", "ArrowUp"].includes(event.key)) {
    event.preventDefault();
    const list = [...box().querySelectorAll("button:not(:disabled)")];
    const index = list.indexOf(document.activeElement);
    list[
      (index + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length
    ]?.focus();
  }
});
