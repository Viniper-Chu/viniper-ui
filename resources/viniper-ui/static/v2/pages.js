import { state, api, escape, query } from "./api.js";
import { icon } from "./icons.js";
import { toolTitle } from "./conversation.js";
import { ui } from "./ui.js";
const $ = (s) => document.querySelector(s);
let extensionLoad = 0;
function skillIcon(skill) {
  const name = skill.command || skill.id || "";
  if (/math/.test(name)) return "math";
  if (/speech/.test(name)) return "mic";
  if (/sheet|base/.test(name)) return "database";
  if (/doc|pdf|slide/.test(name)) return "document";
  if (/wiki|knowledge/.test(name)) return "book";
  if (/small-tasks/.test(name)) return "codeWindow";
  if (/calendar|task/.test(name)) return "tasks";
  return "plan";
}
export async function loadExtensions(refresh = false) {
  const generation = ++extensionLoad;
  const q = query({
    mode: "viniper",
    session_id: state.session?.session_id || "",
  });
  state.extensionStatus = { skills: "loading", plugins: "loading" };
  state.skills = [];
  state.plugins = [];
  renderExtensions();
  // Each source is independently useful. A busy Runtime must not hide
  // local skills, and an earlier refresh must not overwrite a newer one.
  await Promise.allSettled(["skills", "plugins"].map(async (kind) => {
    try {
      const data = await api(`/api/${kind}?${q}${refresh && kind === "skills" ? "&refresh=true" : ""}`, { signal: AbortSignal.timeout(15000) });
      if (generation !== extensionLoad) return;
      state[kind] = data[kind] || [];
      state.extensionStatus[kind] = "ready";
    } catch {
      if (generation !== extensionLoad) return;
      state.extensionStatus[kind] = "error";
    }
    renderExtensions();
  }));
}
function extensionEmpty(kind, emptyText) {
  const status = state.extensionStatus?.[kind];
  const label = kind === "skills" ? "本机技能" : "工具插件";
  if (status === "loading") return `<div class="empty-state loading-state" role="status"><span class="spinner"></span>正在读取${label}…</div>`;
  if (status === "error") return `<div class="empty-state">暂时无法读取${label}<button class="text-button" data-action="refresh-extensions">${icon("refresh")}重新加载</button></div>`;
  return `<div class="empty-state">${emptyText}</div>`;
}
export function renderExtensions() {
  const q = $("#extension-search").value.trim().toLocaleLowerCase();
  const matches = (x) =>
    `${x.name || ""} ${x.display_name || ""} ${x.description || ""} ${x.display_description || ""} ${x.command || ""} ${x.id || ""} ${(x.tools || []).join(" ")}`
      .toLocaleLowerCase()
      .includes(q);
  const filter = state.extensionFilter || "all";
  const plugins = state.plugins.filter(matches).sort((a,b) =>
    Number(b.id === "built-in.math-documents") - Number(a.id === "built-in.math-documents"));
  if ($("#plugins-section")) $("#plugins-section").hidden = filter === "skills";
  if ($("#skills-section")) $("#skills-section").hidden = filter === "plugins";
  document.querySelectorAll?.("[data-extension-filter]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.extensionFilter === filter));
  });
  if ($("#plugin-count")) $("#plugin-count").textContent = state.extensionStatus?.plugins === "ready" ? `${plugins.length} 项` : "";
  $("#plugin-list").innerHTML =
    plugins
      .map(
        (p) =>
          `<button class="capability-card" data-plugin="${escape(p.id)}" data-hint="${escape(p.description || p.name || p.id)}"><span class="card-icon">${icon(p.icon || "plugin")}</span><span class="capability-copy"><span class="capability-name">${escape(p.name || p.id)}</span><small>${escape(p.description || "")}</small></span>${p.status === "unavailable" ? '<small class="card-state">待配置</small>' : ""}</button>`,
      )
      .join("") || extensionEmpty("plugins", "当前没有匹配的已连接插件。");
  const favorites = [
    "local-math-documents",
    "local-math-knowledge",
    "local-small-tasks",
    "local-speech-to-text",
    "calm-task-brief",
    "karpathy-llm-wiki",
    "lark-doc",
    "lark-sheets",
  ];
  const rank = (skill) => {
    const index = favorites.indexOf(skill.command);
    return index < 0 ? favorites.length : index;
  };
  const allSkills = state.skills
    .filter(matches)
    .sort((a, b) => rank(a) - rank(b));
  const visibleSkills =
    q || state.showAllSkills ? allSkills : allSkills.slice(0, 8);
  if ($("#skill-count")) $("#skill-count").textContent = state.extensionStatus?.skills === "ready" ? `${allSkills.length} 项` : "";
  $("#skill-list").innerHTML =
    visibleSkills
      .map(
        (s) =>
          `<button class="capability-card" data-skill="${escape(s.id || s.filename)}" data-hint="${escape(s.display_description || s.description || s.name || s.id)}"><span class="card-icon">${icon(skillIcon(s))}</span><span class="capability-copy"><span class="capability-name">${escape(s.display_name || s.name || s.command || s.id)}</span><small>${escape(s.display_description || s.description || "")}</small></span>${state.selectedSkills?.includes(s.id || s.filename) ? '<small class="card-state">本轮已选</small>' : ""}</button>`,
      )
      .join("") ||
    extensionEmpty("skills", q ? "没有匹配的技能，试试其他关键词" : "尚未读取到技能，安装到本机技能目录后刷新");
  if (!q && allSkills.length > 8)
    $("#skill-list").insertAdjacentHTML(
      "beforeend",
      `<button class="secondary-button all-skills" data-action="toggle-skills">${state.showAllSkills ? "收起完整列表" : `查看全部 ${allSkills.length} 项技能`}</button>`,
    );
}
let detailVersion = 0;
let selectedSkill = "";
let detailOpener = null;
let catalogTop = 0;
let catalogOffset = 0;
let skillRecord = null;
let skillSession = "";
let skillDetailTop = 0;
let skillSaving = false;

export function backToExtensions(restoreFocus = true) {
  detailVersion++;
  selectedSkill = "";
  const detail = $("#extension-detail");
  const wasOpen = !detail.hidden || !$("#skill-editor").hidden;
  $("#skill-editor").hidden = true;
  skillRecord = null;
  detail.hidden = true;
  $("#extension-catalog").hidden = false;
  if (wasOpen && restoreFocus) {
    $("#extensions-view").scrollTop = catalogTop;
    const trigger = detailOpener && document.querySelector(detailOpener);
    if (trigger) $("#extensions-view").scrollTop += trigger.getBoundingClientRect().top - catalogOffset;
    (trigger || $("#extension-search")).focus({ preventScroll: true });
  }
}

function extensionDetail(title, glyph, selector) {
  detailVersion++;
  detailOpener = selector;
  if ($("#extension-detail").hidden && $("#skill-editor").hidden) {
    catalogTop = $("#extensions-view").scrollTop;
    catalogOffset = document.querySelector(selector)?.getBoundingClientRect().top || 0;
  }
  $("#skill-editor").hidden = true;
  skillRecord = null;
  selectedSkill = "";
  $("#extension-catalog").hidden = true;
  $("#extension-detail").hidden = false;
  $("#detail-icon").innerHTML = icon(glyph);
  $("#detail-title").textContent = title;
  $("#detail-content").innerHTML = "";
  $("#detail-actions").hidden = true;
  $("#extensions-view").scrollTop = 0;
  $("#detail-title").focus({ preventScroll: true });
  return detailVersion;
}

export function showPlugin(id) {
  const plugin = state.plugins.find(item => item.id === id);
  if (!plugin) return;
  extensionDetail(plugin.name || id, plugin.icon || "plugin", `[data-plugin="${CSS.escape(id)}"]`);
  const tools = plugin.tools || [];
  const rows = tools.map(name => {
    const label = toolTitle(name);
    return `<li>${icon("activityTool")}<span>${escape(label)}</span>${label !== name ? `<code>${escape(name)}</code>` : ""}</li>`;
  }).join("");
  $("#detail-content").innerHTML =
    (plugin.description ? `<p class="detail-intro">${escape(plugin.description)}</p>` : "") +
    (plugin.status === "unavailable" ? '<p class="status-note">待配置</p>' : "") +
    (rows ? `<h2 class="group-title">工具<span class="section-count">${tools.length} 项</span></h2><label class="field search-field tool-search"><span aria-hidden="true">${icon("search")}</span><input type="search" id="tool-search" aria-label="筛选插件工具" placeholder="查找工具名称或 ID"></label><ul class="tool-directory">${rows}</ul><p id="no-matching-tool" role="status" hidden>没有匹配的工具</p>` : "");
  const search = $("#tool-search");
  if (search) search.addEventListener("input", () => {
    const query = search.value.trim().toLocaleLowerCase();
    const rows = [...document.querySelectorAll("#detail-content .tool-directory li")];
    for (const row of rows) row.hidden = !row.textContent.toLocaleLowerCase().includes(query);
    $("#no-matching-tool").hidden = rows.some(row => !row.hidden);
  });
}

export async function showSkill(id) {
  const record = state.skills.find(item => (item.id || item.filename) === id);
  const generation = extensionDetail(record?.display_name || record?.name || id, skillIcon(record || {}), `[data-skill="${CSS.escape(id)}"]`);
  $("#detail-content").innerHTML = '<p role="status">正在读取技能…</p>';
  skillSession = state.session?.session_id || "";
  try {
    const skill = await api(`/api/skills/${encodeURIComponent(id)}?${query({ mode: "viniper", session_id: state.session?.session_id || "" })}`);
    if (generation !== detailVersion) return;
    skillRecord = skill;
    const body = String(skill.content || "").replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim();
    $("#detail-content").innerHTML = `<div class="answer skill-body">${globalThis.ViniperMarkdown.render(body)}</div>`;
    selectedSkill = id;
    const running = state.runs.get(state.session?.session_id)?.active || state.session?.active_run?.active;
    $("#detail-actions button").textContent = running ? "用于下一轮任务" : "用于当前任务";
    $("#detail-actions [data-action=edit-skill]").hidden = !skill.editable;
    $("#detail-actions").hidden = false;
  } catch {
    if (generation !== detailVersion) return;
    $("#detail-content").innerHTML = `<p role="status">未能读取技能</p><button class="secondary-button" data-skill="${escape(id)}">重新读取</button>`;
  }
}

export function useSelectedSkill() {
  if (!selectedSkill) return;
  state.selectedSkills = [...new Set([...(state.selectedSkills || []), selectedSkill])];
  ui.view("chat");
  ui.syncComposer();
  $("#prompt").focus();
}

export function editSkill() {
  if (!skillRecord?.editable || skillSaving) return;
  skillDetailTop = $("#extensions-view").scrollTop;
  $("#extension-detail").hidden = true;
  $("#skill-editor").hidden = false;
  const form = $("#skill-edit-form");
  form.elements.content.value = skillRecord.content;
  $("#skill-editor-source").textContent = skillRecord.display_name || skillRecord.filename;
  form.querySelector("[role=status]").textContent = "";
  $("#extensions-view").scrollTop = 0;
  form.elements.content.focus({preventScroll:true});
}

export function cancelSkillEdit() {
  if (skillSaving) return;
  $("#skill-editor").hidden = true;
  $("#extension-detail").hidden = false;
  $("#extensions-view").scrollTop = skillDetailTop;
  $("#detail-actions [data-action=edit-skill]").focus({preventScroll:true});
}

export async function saveSkill() {
  if (skillSaving || !skillRecord?.editable) return;
  const id = selectedSkill, generation = detailVersion;
  const form = $("#skill-edit-form");
  const submit = form.querySelector("[type=submit]");
  skillSaving = submit.disabled = true;
  form.elements.content.readOnly = true;
  try {
    await api(`/api/skills/${encodeURIComponent(id)}?${query({session_id:skillSession})}`, {
      method:"PUT", body:{original:skillRecord.content, content:form.elements.content.value},
    });
    if (generation !== detailVersion) return;
    await loadExtensions(true);
    if (generation !== detailVersion) return;
    await showSkill(id);
    $("#extensions-view").scrollTop = skillDetailTop;
    ui.toast("技能说明已保存");
  } catch (error) { form.querySelector("[role=status]").textContent = error.message; }
  finally { skillSaving = submit.disabled = false; form.elements.content.readOnly = false; }
}
