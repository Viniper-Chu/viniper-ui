const levels = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const canonical = id => id === "off" ? "none" : id;
export const effortLabel = id => id === "auto" ? "自动" : canonical(id) || "模型默认";

export function selectedEffort(model, requested) {
  const options = model?.reasoning_options || [];
  const value = model?.reasoning_aliases?.[requested] || canonical(requested);
  return options.includes(value) ? value : model?.default_reasoning || null;
}

export function effortControl(model, requested) {
  const options = model?.reasoning_options || [];
  const selected = selectedEffort(model, requested);
  const ticks = levels.map(id => {
    const enabled = options.includes(id);
    const alias = model?.reasoning_aliases?.[id];
    const hint = !enabled && levels.includes(alias) ? "当前部署与 " + alias + " 使用同一强度"
      : !enabled ? "当前模型不支持独立的 " + id + " 档位"
      : id === "none" && model.none_disables_thinking === false ? "最低思考强度，模型仍可能返回思考内容"
      : id === "none" && model.none_disables_thinking ? "关闭思考" : id;
    return `<button type="button" data-effort="${id}" aria-pressed="${id === selected}"
      ${enabled ? "" : "disabled"} title="${hint}">${id}</button>`;
  }).join("");
  const automatic = options.includes("auto") ? `<button type="button" class="effort-auto" data-effort="auto"
    aria-pressed="${selected === "auto"}" title="按当前任务自动选择思考深度">自动</button>` : "";
  const start = levels.indexOf(selected);
  const initial = start < 0 ? Math.max(0, levels.findIndex(id => options.includes(id))) : start;
  return `<div class="menu-separator"></div><div class="effort-control">
    <div class="effort-heading"><h3>思考深度</h3>${automatic}</div>
    <div class="effort-scale" data-manual="${start >= 0}" style="--steps:${levels.length}">
      <input type="range" min="0" max="${levels.length-1}" step="1" value="${initial}"
        aria-label="思考深度" aria-valuetext="${effortLabel(selected)}" ${levels.some(id => options.includes(id)) ? "" : "disabled"}>
      <div class="effort-ticks">${ticks}</div>
    </div></div>`;
}

export function bindEffortControl(popover, onChange) {
  function choose(control, id) {
    const buttons = [...control.querySelectorAll("[data-effort]")];
    if (!buttons.some(button => button.dataset.effort === id && !button.disabled)) return;
    for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.effort === id));
    const slider = control.querySelector("input");
    slider.closest(".effort-scale").dataset.manual = String(id !== "auto");
    if (id !== "auto") slider.value = levels.indexOf(id);
    slider.setAttribute("aria-valuetext", effortLabel(id));
    onChange(id);
  }
  popover.addEventListener("click", event => {
    const button = event.target.closest("[data-effort]");
    if (button) choose(button.closest(".effort-control"), button.dataset.effort);
  });
  popover.addEventListener("pointerdown", event => {
    if (event.target.type !== "range" || !event.target.closest(".effort-scale")) return;
    const control = event.target.closest(".effort-control");
    const ticks = control.querySelector(".effort-ticks").getBoundingClientRect();
    const index = Math.max(0, Math.min(levels.length - 1, Math.floor((event.clientX - ticks.left) / ticks.width * levels.length)));
    if (control.querySelector(`[data-effort="${levels[index]}"]`).disabled) event.preventDefault();
    else choose(control, levels[index]);
  });
  popover.addEventListener("input", event => {
    const control = event.target.closest(".effort-control");
    if (!control || event.target.type !== "range") return;
    const enabled = [...control.querySelectorAll(".effort-ticks button:enabled")].map(button => levels.indexOf(button.dataset.effort));
    if (!enabled.length) return;
    const nearest = enabled.reduce((best, next) => Math.abs(next - event.target.value) < Math.abs(best - event.target.value) ? next : best);
    choose(control, levels[nearest]);
  });
  popover.addEventListener("keydown", event => {
    if (event.target.type !== "range") return;
    const control = event.target.closest(".effort-control");
    if (!control) return;
    const enabled = [...control.querySelectorAll(".effort-ticks button:enabled")].map(button => button.dataset.effort);
    const pressed = control.querySelector(".effort-ticks [aria-pressed=true]");
    const index = enabled.indexOf(pressed?.dataset.effort);
    const positions = {ArrowLeft: index - 1, ArrowDown: index - 1, ArrowRight: index + 1, ArrowUp: index + 1, Home: 0, End: enabled.length - 1};
    if (!(event.key in positions)) return;
    event.preventDefault();
    event.stopPropagation();
    choose(control, enabled[Math.min(enabled.length - 1, Math.max(0, positions[event.key]))]);
  });
}
