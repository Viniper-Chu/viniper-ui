import { setActionButtonPresentation } from "../ui/action-button.js";

export function renderExtensionCenter(elements, extensions, activeSessionId, actions) {
  const query = elements.search.value.trim().toLocaleLowerCase("zh-CN");
  elements.managed.replaceChildren();
  for (const record of (extensions.records ?? []).filter((item) => `${item.name} ${item.id} ${item.source} ${item.kind}`.toLocaleLowerCase("zh-CN").includes(query))) {
    const item = document.createElement("article");
    item.className = `extension-row managed-extension ${record.status}`;
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = record.name;
    const detail = document.createElement("p");
    detail.textContent = `${record.kind} · 来源 ${record.source} · 当前 ${record.current?.version ?? "未安装"} · 上一版 ${record.previous?.version ?? "无"}`;
    const meta = document.createElement("small");
    meta.textContent = `${record.trust === "trusted" ? "已信任" : "未信任"} · ${record.enabled ? "已启用" : "未启用"} · 能力：${record.capabilities.join("、") || "无"}${record.failure ? ` · 失败：${record.failure}` : ""}`;
    copy.append(title, detail, meta);
    const controls = document.createElement("div");
    controls.className = "row-actions";
    if (record.trust !== "trusted" && record.current?.version) {
      const trust = document.createElement("button");
      trust.type = "button";
      trust.className = "chip-button";
      setActionButtonPresentation(trust, "信任当前版");
      trust.addEventListener("click", () => actions.trust(record.id, record.current.version));
      controls.append(trust);
    } else {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = record.enabled ? "chip-button active" : "chip-button";
      setActionButtonPresentation(toggle, record.enabled ? "停用扩展" : "启用扩展", { icon: "power", iconOnly: true });
      toggle.setAttribute("aria-pressed", String(record.enabled));
      toggle.addEventListener("click", () => actions.enable(record.id, !record.enabled));
      controls.append(toggle);
    }
    if (record.previous) {
      const rollback = document.createElement("button");
      rollback.type = "button";
      rollback.className = "chip-button";
      setActionButtonPresentation(rollback, record.pendingRollback ? "确认回退" : "请求回退");
      rollback.addEventListener("click", () => record.pendingRollback
        ? actions.confirmRollback(record.id)
        : actions.requestRollback(record.id));
      controls.append(rollback);
    }
    item.append(copy, controls);
    elements.managed.append(item);
  }
  if (!elements.managed.childElementCount) {
    const empty = document.createElement("p");
    empty.className = "extension-empty-state";
    empty.textContent = "暂无已安装的受管扩展。";
    elements.managed.append(empty);
  }
  elements.skills.replaceChildren();
  for (const skill of extensions.skills.filter((item) => `${item.name} ${item.description}`.toLocaleLowerCase("zh-CN").includes(query))) {
    const enabled = skill.enabledSessionIds.includes(activeSessionId);
    const item = document.createElement("article");
    item.className = "extension-row";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = skill.name;
    const description = document.createElement("p");
    description.textContent = skill.description;
    const meta = document.createElement("small");
    meta.textContent = `${skill.source === "built-in" ? "内置" : "外部声明式"} · ${skill.loaded ? "正文已按需加载" : "仅已读取元数据"}`;
    copy.append(title, description, meta);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = enabled ? "chip-button active" : "chip-button";
    setActionButtonPresentation(toggle, enabled ? "停用 Skill" : "启用 Skill", { icon: "power", iconOnly: true });
    toggle.setAttribute("aria-pressed", String(enabled));
    toggle.addEventListener("click", () => actions.setSkill(skill.id, !enabled));
    item.append(copy, toggle);
    elements.skills.append(item);
  }

  elements.plugins.replaceChildren();
  for (const plugin of extensions.plugins.filter((item) => `${item.name} ${item.id}`.toLocaleLowerCase("zh-CN").includes(query))) {
    const item = document.createElement("article");
    item.className = `extension-row plugin ${plugin.classification}`;
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = plugin.name;
    const description = document.createElement("p");
    description.textContent = plugin.classification === "built-in"
      ? `内置能力：${plugin.capabilities.join("、") || "无"}`
      : plugin.classification === "external-declarative"
        ? "仅发现并校验清单；不会执行未知代码。"
        : plugin.error ?? "清单无效。";
    const meta = document.createElement("small");
    meta.textContent = `${plugin.id} · v${plugin.version} · ${plugin.executable ? "内置可执行" : "不执行"}`;
    copy.append(title, description, meta);
    item.append(copy);
    elements.plugins.append(item);
  }
}
