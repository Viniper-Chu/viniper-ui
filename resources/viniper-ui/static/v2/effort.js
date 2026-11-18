const levels = ["low", "medium", "high", "xhigh", "max"];
export const effortLabel = id => ({low: "light", xhigh: "extra high"}[id] || id || "auto");

export function selectedEffort(model, requested) {
  const options = model?.reasoning_options || [];
  return options.includes(requested) ? requested : model?.default_reasoning || null;
}

export function effortControl(model, requested) {
  const options = model?.reasoning_options || [];
  const selected = selectedEffort(model, requested);
  const ticks = levels.map(id => effortButton(id, selected, options.includes(id))).join("");
  const other = ["off", "minimal"].filter(id => options.includes(id)).map(id => effortButton(id, selected, true)).join("");
  const index = levels.indexOf(selected);
  return `<div class="menu-separator"></div><h3>Thinking effort</h3>
    <div class="effort-control">
      <input type="range" min="0" max="4" step="1" value="${Math.max(0,index)}"
        aria-label="Thinking effort" aria-valuetext="${effortLabel(selected)}" ${levels.some(id => options.includes(id)) ? "" : "disabled"}>
      <div class="effort-ticks">${ticks}</div>${other ? `<div class="effort-other">${other}</div>` : ""}
    </div>`;
}

function effortButton(id, selected, enabled) {
  return `<button type="button" data-effort="${id}" aria-pressed="${id === selected}" ${enabled ? "" : "disabled"}
    title="${enabled ? effortLabel(id) : "当前模型不支持独立的 " + effortLabel(id) + " 档位"}">${effortLabel(id)}</button>`;
}

export function bindEffortControl(popover, onChange) {
  function choose(control, id) {
    const buttons = [...control.querySelectorAll("[data-effort]")];
    if (!buttons.some(button => button.dataset.effort === id && !button.disabled)) return;
    for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.effort === id));
    const slider = control.querySelector("input");
    slider.value = Math.max(0, levels.indexOf(id));
    slider.setAttribute("aria-valuetext", effortLabel(id));
    onChange(id);
  }
  popover.addEventListener("click", event => {
    const button = event.target.closest("[data-effort]");
    if (button) choose(button.closest(".effort-control"), button.dataset.effort);
  });
  popover.addEventListener("input", event => {
    const control = event.target.closest(".effort-control");
    if (!control || event.target.type !== "range") return;
    const enabled = [...control.querySelectorAll(".effort-ticks button:enabled")].map(button => levels.indexOf(button.dataset.effort));
    const nearest = enabled.reduce((best, next) => Math.abs(next - event.target.value) < Math.abs(best - event.target.value) ? next : best);
    choose(control, levels[nearest]);
  });
  popover.addEventListener("keydown", event => {
    if (event.target.type !== "range") return;
    const control = event.target.closest(".effort-control");
    const enabled = [...control.querySelectorAll(".effort-ticks button:enabled")].map(button => button.dataset.effort);
    const current = levels[Number(event.target.value)];
    const index = enabled.indexOf(current);
    const positions = {ArrowLeft: index - 1, ArrowDown: index - 1, ArrowRight: index + 1, ArrowUp: index + 1, Home: 0, End: enabled.length - 1};
    if (!(event.key in positions)) return;
    event.preventDefault();
    event.stopPropagation();
    choose(control, enabled[Math.min(enabled.length - 1, Math.max(0, positions[event.key]))]);
  });
}
