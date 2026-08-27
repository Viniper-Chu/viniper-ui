import { setActionButtonPresentation } from "../ui/action-button.js";

export function renderCompositionCenter(root, snapshot, actions) {
  if (!root) return;
  root.replaceChildren();
  const current = snapshot?.current;
  const currentName = current?.customName ? `自定义 · ${current.customName}` : current?.presentation?.label ?? "未加载能力方案";
  const intro = document.createElement("p");
  intro.className = "composition-current-line";
  intro.textContent = `${currentName} · 下一次运行生效`;
  root.append(intro);

  const presetGrid = document.createElement("div");
  presetGrid.className = "composition-preset-grid";
  for (const preset of snapshot?.presets ?? []) {
    const card = document.createElement("article");
    card.className = `composition-preset ${preset.id === current?.preset ? "is-current" : ""}`;
    const title = document.createElement("h4");
    title.textContent = preset.label;
    const capabilities = document.createElement("p");
    capabilities.className = "composition-primary-abilities";
    capabilities.textContent = primaryAbilities(preset.capabilities);
    const details = document.createElement("details");
    details.className = "composition-details";
    const detailsSummary = document.createElement("summary");
    detailsSummary.textContent = "能力详情";
    const detailsCopy = document.createElement("p");
    const blockerReasons = preset.blockers ?? [];
    detailsCopy.textContent = blockerReasons.length
      ? `阻塞原因：${blockerReasons.join("；")}`
      : preset.dependencies.length || preset.conflicts.length
        ? `依赖/冲突：${[...preset.dependencies, ...preset.conflicts].join("、")}`
        : `${preset.trust === "builtin" ? "内置" : "需确认"} · 无阻塞`;
    details.append(detailsSummary, detailsCopy);
    const select = document.createElement("button");
    select.type = "button";
    select.className = preset.id === current?.preset ? "chip-button active" : "chip-button";
    setActionButtonPresentation(select, preset.id === current?.preset ? "当前方案" : "应用方案", { icon: "check", iconOnly: preset.id === current?.preset });
    select.disabled = preset.id === current?.preset;
    select.addEventListener("click", () => void actions.select(preset.id));
    card.append(title, capabilities, details, select);
    presetGrid.append(card);
  }
  root.append(presetGrid);

  const custom = document.createElement("section");
  custom.className = "composition-custom-section";
  const heading = document.createElement("h4");
  heading.textContent = "自定义方案";
  custom.append(heading);
  const customNames = snapshot?.custom ?? [];
  if (!customNames.length) {
    const empty = document.createElement("p");
    empty.className = "inline-notice";
    empty.textContent = "可从上方方案复制；保存后可在下一次运行启用。";
    custom.append(empty);
  }
  for (const item of customNames) {
    const row = document.createElement("div");
    row.className = "composition-custom-row";
    const label = document.createElement("strong");
    label.textContent = `${item.name} · ${item.enabledIds.length} 项`;
    row.append(label);
    const use = document.createElement("button");
    use.type = "button";
    use.className = "chip-button";
    setActionButtonPresentation(use, "启用方案", { icon: "check", iconOnly: true });
    use.addEventListener("click", () => void actions.select("custom", item.name));
    row.append(use);
    for (const id of item.enabledIds) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "chip-button active";
      toggle.textContent = id;
      toggle.title = `停用 ${id}`;
      toggle.setAttribute("aria-label", `停用 ${id}`);
      toggle.dataset.tooltip = `停用 ${id}`;
      toggle.addEventListener("click", () => void actions.toggle(item.name, id, false));
      row.append(toggle);
    }
    custom.append(row);
  }
  const saveRow = document.createElement("div");
  saveRow.className = "composition-save-row";
  const name = document.createElement("input");
  name.type = "text";
  name.placeholder = "自定义方案名称";
  name.setAttribute("aria-label", "自定义方案名称");
  const save = document.createElement("button");
  save.type = "button";
  save.className = "quiet-button";
  save.textContent = "保存自定义方案";
  save.addEventListener("click", () => {
    const value = name.value.trim();
    if (value) void actions.copy(current?.preset ?? "standard", value);
  });
  const restore = document.createElement("button");
  restore.type = "button";
  restore.className = "quiet-button";
  restore.textContent = "恢复默认";
  restore.addEventListener("click", () => void actions.restore());
  saveRow.append(name, save, restore);
  custom.append(saveRow);
  root.append(custom);
}

function primaryAbilities(capabilities) {
  const labels = {
    "core.agent": "Agent 执行",
    "programming.tools": "文件与代码",
    "coordination.service": "跨会话协作",
    "code-mode.worker": "Code Mode",
    "workflow.runtime": "工作流",
    "token.ledger": "Token 统计",
  };
  const visible = capabilities.slice(0, 4).map((id) => labels[id] ?? id.split(".").at(-1));
  return visible.length ? visible.join(" · ") : "基础执行";
}
