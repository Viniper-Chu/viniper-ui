import { state, escape, api } from "./api.js";
import { icon } from "./icons.js";
const box = () => document.querySelector("#popover");
let opener = null;
export function closeMenu() {
  box().hidden = true;
  opener?.setAttribute("aria-expanded", "false");
  opener = null;
}
export function showMenu(button, html) {
  if (opener === button && !box().hidden) {
    closeMenu();
    return;
  }
  closeMenu();
  opener = button;
  button.setAttribute("aria-expanded", "true");
  box().innerHTML = html;
  box().hidden = false;
  positionMenu();
  box().querySelector("button")?.focus({ preventScroll: true });
}
function positionMenu() {
  if (!opener) return;
  const r = opener.getBoundingClientRect(),
    p = box();
  const left = Math.max(12, Math.min(r.left, innerWidth - p.offsetWidth - 12));
  const availableBelow = innerHeight - r.bottom - 12;
  const top =
    availableBelow >= p.offsetHeight
      ? r.bottom + 7
      : Math.max(12, r.top - p.offsetHeight - 7);
  Object.assign(p.style, { left: `${left}px`, top: `${top}px` });
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
  return `<button class="menu-option${danger ? " danger" : ""}" data-menu-action="${action}" data-value="${escape(value)}" role="menuitemradio" aria-checked="${checked}" ${disabled ? "disabled" : ""}>${icon(image || "sparkles")}<span class="option-copy"><strong>${escape(label)}</strong>${detail ? `<small>${escape(detail)}</small>` : ""}</span>${checked ? icon("check") : ""}</button>`;
}
export function permissionIcon(id) {
  return /full|bypass/.test(id)
    ? "shieldAlert"
    : /read|review/.test(id)
      ? "eye"
      : /project|auto/.test(id)
        ? "edit"
        : "shield";
}
export function menuContent(kind) {
  const active = Boolean(
    state.runs.get(state.session?.session_id)?.active ||
      state.session?.active_run?.active,
  );
  if (kind === "add")
    return (
      "<h3>添加到这次任务</h3>" +
      option({
        label: "添加附件",
        detail: "文件、图片与文档",
        image: "plus",
        action: "attach",
      }) +
      '<div class="menu-separator"></div>' +
      option({
        label: "规划模式",
        detail: "先调研和制定计划，确认后再执行",
        image: "plan",
        action: "mode",
        value: "plan",
        checked: state.mode === "plan",
        disabled: active,
      }) +
      option({
        label: "目标模式",
        detail: "围绕明确成果持续推进，随时暂停",
        image: "target",
        action: "mode",
        value: "goal",
        checked: state.mode === "goal",
        disabled: active,
      }) +
      '<div class="menu-separator"></div>' +
      option({ label: "选择技能或插件", image: "plugin", action: "extensions" })
    );
  if (kind === "permission")
    return (
      "<h3>访问权限</h3>" +
      (state.status?.permission_modes || [])
        .map((p) =>
          option({
            label: p.label,
            detail: p.description || p.reason,
            image: permissionIcon(p.id),
            action: "permission",
            value: p.id,
            checked: state.permission === p.id,
            danger: /full|bypass/.test(p.id),
            disabled: p.enabled === false,
          }),
        )
        .join("")
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
            image: "sparkles",
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
            `<button role="radio" aria-checked="${state.reasoning === id}" data-menu-action="reasoning" data-value="${id}">${label}</button>`,
        )
        .join("") +
      "</div>"
    );
  if (kind === "context") {
    const u = state.session?.context_usage || {};
    return `<div class="context-details"><strong>上下文窗口</strong><p>${u.used_tokens ?? "—"} / ${u.context_limit ?? "—"} tokens</p><small>${escape(u.source === "real" ? "按实际模型输入计数" : u.usage_label || "等待模型用量回执")}<br>达到阈值时自动整理，原有会话记录保留。</small></div>`;
  }
  return (
    option({ label: "选择工作目录", image: "folder", action: "project" }) +
    option({
      label: "重命名会话",
      image: "edit",
      action: "rename",
      disabled: !state.session,
    }) +
    option({ label: "查看任务计划", image: "plan", action: "plan" }) +
    option({
      label: "打开工作目录",
      image: "external",
      action: "open-project",
    }) +
    option({ label: "新建会话", image: "plus", action: "new-chat" }) +
    '<div class="menu-separator"></div>' +
    option({
      label: "删除当前会话",
      image: "trash",
      action: "delete-session",
      danger: true,
      disabled: !state.session,
    })
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
  if (event.key === "Escape") closeMenu();
  if (!box().hidden && ["ArrowDown", "ArrowUp"].includes(event.key)) {
    event.preventDefault();
    const list = [...box().querySelectorAll("button:not(:disabled)")];
    const index = list.indexOf(document.activeElement);
    list[
      (index + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length
    ]?.focus();
  }
});
