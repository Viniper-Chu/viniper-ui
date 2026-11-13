import { api, state, escape } from "./api.js";
import { ui } from "./ui.js";

export function readingSize(id) {
  return ({xs: "13px", sm: "14px", normal: "15px", lg: "17px", xl: "19px"})[id] || "15px";
}

export function preferenceFields() {
  return Array.from(document.querySelectorAll("#settings-fields [data-pref]"), row => {
    const panel = row.closest('[role="tabpanel"]');
    return {
      label: row.dataset.pref, name: row.dataset.control || row.querySelector("[name]").name, sectionId: panel.id,
      section: panel.querySelector("h2").textContent, aliases: row.dataset.alias || "",
    };
  });
}

export function focusPreference(name) {
  const field = form().elements[name];
  if (!field) return;
  const control = field instanceof RadioNodeList ? [...field].find(input => input.checked) || field[0] : field;
  control.focus();
}

export function clearPreferenceSearch() {
  document.querySelector("#preference-query").value = "";
  document.querySelector("#preference-results").hidden = true;
  form().hidden = false;
}

export function setupPreferenceSearch(openField) {
  const input = document.querySelector("#preference-query");
  const results = document.querySelector("#preference-results");
  const list = document.querySelector("#preference-matches");
  input.addEventListener("input", () => {
    const query = input.value.trim().toLocaleLowerCase();
    results.hidden = !query;
    form().hidden = Boolean(query);
    if (!query) return;
    const matches = preferenceFields().filter(field =>
      [field.label, field.name, field.section, field.aliases].join(" ").toLocaleLowerCase().includes(query));
    list.innerHTML = matches.map(field =>
      `<button class="preference-match" data-match="${escape(field.name)}" data-panel="${escape(field.sectionId)}"><span>${escape(field.label)}</span><small>${escape(field.section)}</small></button>`
    ).join("") || "<p role=\"status\">没有匹配的设置</p>";
    results.parentElement.scrollTop = 0;
  });
  list.addEventListener("click", event => {
    const match = event.target.closest("button[data-match]");
    if (match) openField(match.dataset.panel, match.dataset.match);
  });
  input.addEventListener("keydown", event => {
    if (event.isComposing || results.hidden) return;
    const first = list.querySelector("button");
    if (first && ["ArrowDown", "Enter"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "Enter") first.click();
      else first.focus();
    }
  });
}

export function selectSettingsSection(id) {
  clearPreferenceSearch();
  document.querySelector(".preferences-content").scrollTop = 0;
  for (const tab of document.querySelectorAll("[data-settings-section]")) {
    const selected = tab.dataset.settingsSection === id;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.getElementById(tab.dataset.settingsSection).hidden = !selected;
  }
}
let baseline = null;
let pending = null;
let saving = false;
const form = () => document.querySelector("#settings-form");
const result = () => document.querySelector("#settings-result");

export function loadSettings() {
  if (pending) return pending;
  if (saving || (baseline && changed().length)) return;
  pending = readSettings().finally(() => { pending = null; });
  return pending;
}

async function readSettings() {
  const fields = document.querySelector("#settings-fields");
  fields.disabled = true;
  form().querySelector(".form-actions").hidden = false;
  const save = form().querySelector("[type=submit]");
  save.disabled = true;
  save.dataset.hint = "正在读取设置";
  form().querySelector("[data-action=reload-settings]").hidden = true;
  result().textContent = "正在读取设置…";
  try {
    const [settings, instructions] = await Promise.all([
      api("/api/settings?mode=viniper"),
      api("/api/agent-instructions?mode=viniper"),
    ]);
    const s = settings.settings || {},
      p = s.provider || {};
    const form = document.querySelector("#settings-form");
    form.querySelector(".size-options").innerHTML = settings.font_sizes.map(size =>
      `<label><input type="radio" name="font-size" value="${escape(size.id)}"><span>${escape(size.label)}</span></label>`
    ).join("");
    const values = {
      "provider-label": p.label || "",
      "provider-id": p.id || "custom",
      "base-url": p.base_url || "",
      "model-id": p.model || state.model,
      "api-key": "",
      theme: s.appearance?.theme || "system",
      "font-size": s.appearance?.font_size || "normal",
      workdir: s.workspace?.default_root || state.workdir,
      instructions:
        instructions.content || instructions.instructions?.content || "",
    };
    if (
      p.id &&
      ![...form.elements["provider-id"].options].some((o) => o.value === p.id)
    )
      form.elements["provider-id"].add(new Option(p.label || p.id, p.id));
    for (const [key, value] of Object.entries(values))
      form.elements[key].value = value;
    form.elements["api-key"].placeholder = p.api_key_configured
      ? "已安全保存；留空保留现有密钥"
      : "输入 API key";
    baseline = values;
    fields.disabled = false;
    document.querySelector("#browse-workdir").hidden = !window.viniperDesktop?.chooseProject;
    syncSettings();
  } catch (error) {
    baseline = null;
    save.dataset.hint = "重新读取设置后可以保存";
    result().textContent = "未能读取设置";
    form().querySelector("[data-action=reload-settings]").hidden = false;
    throw error;
  }
}

function changed() {
  return Object.keys(baseline || {}).filter(name => form().elements[name].value !== baseline[name]);
}

function previewAppearance() {
  const preview = document.querySelector("#reading-preview");
  const {theme} = form().elements;
  const dark = theme.value === "dark" || (theme.value === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  preview.dataset.theme = dark ? "dark" : "light";
  preview.style.setProperty("--preview-size", readingSize(form().elements["font-size"].value));
  if (!preview.querySelector(".preview-answer").hasChildNodes()) {
    preview.querySelector(".preview-answer").innerHTML = globalThis.ViniperMarkdown.render("由 $f(x)=(x-1)^2$ 可知，当 $x=1$ 时，函数取得最小值 $0$。");
  }
}

export function syncSettings(message) {
  if (!baseline) return;
  const dirty = changed().length > 0;
  result().textContent = message ?? (dirty ? "有未保存的更改" : "");
  form().querySelector(".form-actions").hidden = !dirty && !result().textContent;
  const save = form().querySelector("[type=submit]");
  save.disabled = !dirty || saving;
  save.hidden = !dirty && !saving;
  save.dataset.hint = saving ? "正在保存更改" : dirty ? "保存各分区已修改的设置" : "没有需要保存的更改";
  form().querySelector("[data-action=discard-settings]").hidden = !dirty || saving;
  previewAppearance();
}

export function discardSettings() {
  if (!baseline || saving) return;
  for (const [name, value] of Object.entries(baseline)) form().elements[name].value = value;
  syncSettings();
}

export async function saveSettings() {
  if (!baseline || saving || !changed().length) return;
  const fields = [...changed()];
  const values = form().elements;
  saving = true;
  document.querySelector("#settings-fields").disabled = true;
  syncSettings("正在保存…");
  try {
    if (fields.includes("api-key")) {
      if (!window.viniperDesktop?.saveProviderSecret) throw new Error("请在 Viniper 桌面应用中保存密钥");
      const stored = await window.viniperDesktop.saveProviderSecret("viniper", values["api-key"].value);
      if (!stored.ok) throw new Error("钥匙串未完成保存");
      values["api-key"].value = "";
      values["api-key"].placeholder = "已安全保存，留空保留现有密钥";
    }
    const mappings = {
      "provider-label": ["provider", "label"], "provider-id": ["provider", "id"],
      "base-url": ["provider", "base_url"], "model-id": ["provider", "model"],
      theme: ["appearance", "theme"], "font-size": ["appearance", "font_size"], workdir: ["workspace", "default_root"],
    };
    const settings = {};
    const preferences = fields.filter(name => mappings[name]);
    for (const name of preferences) {
      const [group, key] = mappings[name];
      (settings[group] ||= {})[key] = values[name].value;
    }
    if (preferences.length) {
      await api("/api/settings", { method: "PUT", body: { mode: "viniper", settings } });
      for (const name of preferences) baseline[name] = values[name].value;
      if (preferences.includes("model-id")) state.model = values["model-id"].value;
    }
    if (fields.includes("instructions")) {
      await api("/api/agent-instructions", { method: "PUT", body: { mode: "viniper", content: values.instructions.value } });
      baseline.instructions = values.instructions.value;
    }
    await ui.loadStatus();
    result().textContent = "设置已保存";
  } catch (error) {
    result().textContent = changed().length ? "仍有更改尚未保存" : "设置已写入，状态刷新失败";
    throw error;
  } finally {
    saving = false;
    document.querySelector("#settings-fields").disabled = false;
    syncSettings(result().textContent);
  }
}
