import { state, api, escape, query } from "./api.js";
import { icon } from "./icons.js";
import { ui } from "./ui.js";
const $ = (s) => document.querySelector(s);
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
export async function loadExtensions() {
  const q = query({
    mode: "viniper",
    session_id: state.session?.session_id || "",
  });
  const [skills, plugins] = await Promise.all([
    api(`/api/skills?${q}`),
    api(`/api/plugins?${q}`),
  ]);
  state.skills = skills.skills || [];
  state.plugins = plugins.plugins || [];
  renderExtensions();
}
export function renderExtensions() {
  const q = $("#extension-search").value.toLocaleLowerCase();
  const matches = (x) =>
    `${x.name || ""} ${x.display_name || ""} ${x.description || ""} ${x.display_description || ""}`
      .toLocaleLowerCase()
      .includes(q);
  $("#plugin-list").innerHTML =
    state.plugins
      .filter(matches)
      .map(
        (p) =>
          `<button class="capability-card" data-plugin="${escape(p.id)}"><span class="card-icon">${icon(p.icon || "plugin")}</span><h3>${escape(p.name || p.id)}</h3><p>${escape(p.description || "已接入 Viniper 工具，可在对话中使用。")}</p><span class="card-state">${escape(p.status === "unavailable" ? "待配置" : "已内置")}</span></button>`,
      )
      .join("") || '<div class="empty-state">当前没有匹配的已连接插件。</div>';
  const favorites = [
    "local-small-tasks",
    "local-math-documents",
    "local-math-knowledge",
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
  $("#skill-list").innerHTML =
    visibleSkills
      .map(
        (s) =>
          `<button class="capability-card" data-skill="${escape(s.id || s.filename)}"><span class="card-icon">${icon(skillIcon(s))}</span><h3>${escape(s.display_name || s.name || s.command || s.id)}</h3><p>${escape(s.display_description || s.description || "打开查看这项技能的操作规则")}</p><span class="card-state">${escape(s.display_category || s.source || "本机技能")}</span></button>`,
      )
      .join("") ||
    '<div class="empty-state">未找到技能。安装到本机技能目录后点击刷新。</div>';
  if (!q && allSkills.length > 8)
    $("#skill-list").insertAdjacentHTML(
      "beforeend",
      `<button class="secondary-button all-skills" data-action="toggle-skills">${state.showAllSkills ? "收起完整列表" : `查看全部 ${allSkills.length} 项技能`}</button>`,
    );
}
export async function showSkill(id) {
  const skill = await api(
    `/api/skills/${encodeURIComponent(id)}?${query({ mode: "viniper", session_id: state.session?.session_id || "" })}`,
  );
  const source = String(skill.content || ""),
    body = source
      .replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
      .trim();
  const running =
    state.runs.get(state.session?.session_id)?.active ||
    state.session?.active_run?.active;
  ui.dialog(
    skill.display_name || skill.filename,
    `<div class="answer">${globalThis.ViniperMarkdown.render(body)}</div>`,
    {
      label: running ? "用于下一轮任务" : "用于当前任务",
      onSubmit: () => {
        state.selectedSkills = [id];
        ui.view("chat");
        ui.syncComposer();
        $("#prompt").focus();
      },
    },
  );
}
const statusLabel = {
  active: "进行中",
  running: "进行中",
  complete: "已完成",
  completed: "已完成",
  paused: "已暂停",
  blocked: "待继续",
  waiting: "等待处理",
  failed: "失败",
  budget_limited: "达到预算",
  scheduled: "已启用",
  disabled: "已暂停",
};
export async function loadTasks() {
  const [goals, schedules] = await Promise.all([
    api("/api/goals?mode=viniper"),
    api("/api/schedules"),
  ]);
  state.goals = goals.goals || [];
  state.schedules = schedules.schedules || [];
  renderTasks();
}
function renderTasks() {
  $("#goal-list").innerHTML =
    state.goals
      .map(
        (g) =>
          `<article class="task-card"><span class="card-icon">${icon("target")}</span><div class="task-info"><h3>${escape(g.title)}</h3><p>${escape(statusLabel[g.runtime_status] || statusLabel[g.status] || g.status)} · ${g.turn_count || 0} 轮${g.max_turns ? ` / ${g.max_turns} 轮上限` : ""}</p><p>${escape(g.current_step || g.last_error || "")}</p></div><div class="task-controls"><button class="icon-button" data-session="${escape(g.session_id)}" aria-label="打开目标会话" title="打开会话">${icon("chat")}</button>${g.status !== "complete" ? `<button class="icon-button" data-task-action="${g.status === "active" ? "stop" : "continue"}" data-goal-id="${g.id}" aria-label="${g.status === "active" ? "暂停" : "继续"}" title="${g.status === "active" ? "暂停" : "继续"}">${icon(g.status === "active" ? "pause" : "play")}</button>` : ""}<button class="icon-button" data-task-action="delete" data-goal-id="${g.id}" aria-label="删除目标">${icon("trash")}</button></div></article>`,
      )
      .join("") ||
    `<div class="empty-state task-empty"><span class="empty-icon">${icon("target")}</span><div><h3>给一件事，设定目标</h3><p>写清要交付的成果，Viniper 会持续推进，并保留每轮进展。</p><button class="secondary-button" data-action="new-goal">开始一个目标${icon("arrowRight")}</button></div></div>`;
  $("#schedule-list").innerHTML =
    state.schedules
      .map(
        (s) =>
          `<article class="task-card"><span class="card-icon">${icon("clock")}</span><div class="task-info"><h3>${escape(s.title || s.name)}</h3><p>${escape(s.cron || s.cronExpression || "")} · ${s.enabled ? "已启用" : "已暂停"}</p><p>${escape(s.last_error || s.last_result || s.lastStatus || "应用运行时按计划执行；错过的时间不会集中补跑。")}</p></div><div class="task-controls">${s.native_session_id ? `<button class="icon-button" data-session="${escape(s.native_session_id)}" aria-label="打开任务会话">${icon("chat")}</button>` : ""}<button class="icon-button" data-task-action="edit" data-schedule-id="${s.id}" aria-label="编辑定时任务">${icon("edit")}</button><button class="icon-button" data-schedule-id="${s.id}" data-task-action="${s.enabled ? "pause" : "resume"}" aria-label="${s.enabled ? "暂停" : "恢复"}">${icon(s.enabled ? "pause" : "play")}</button><button class="icon-button" data-schedule-id="${s.id}" data-task-action="delete" aria-label="删除定时任务">${icon("trash")}</button></div></article>`,
      )
      .join("") ||
    `<div class="empty-state task-empty"><span class="empty-icon">${icon("clock")}</span><div><h3>让重复工作，按时开始</h3><p>为整理、检查和例行任务安排时间，结果保留在会话中。</p><button class="secondary-button" data-action="new-schedule">添加定时任务${icon("plus")}</button></div></div>`;
}
export async function taskAction(action, goalId, scheduleId) {
  if (action === "edit") {
    const s = state.schedules.find((item) => item.id === scheduleId);
    ui.dialog(
      "编辑定时任务",
      `<label class="field">名称<input name="title" value="${escape(s.title || s.name)}" required></label><label class="field">任务内容<textarea name="prompt" rows="4" required>${escape(s.prompt)}</textarea></label><label class="field">Cron<input name="cron" value="${escape(s.cron)}" required></label>`,
      {
        label: "保存",
        onSubmit: async (data) => {
          await api(`/api/schedules/${scheduleId}`, {
            method: "PATCH",
            body: {
              action: "edit",
              title: data.get("title"),
              prompt: data.get("prompt"),
              cron: data.get("cron"),
              time_zone: s.schedule?.timeZone || "Asia/Shanghai",
            },
          });
          await loadTasks();
        },
      },
    );
    return;
  }
  const path = goalId ? `/api/goals/${goalId}` : `/api/schedules/${scheduleId}`;
  if (action === "delete") {
    ui.dialog("移除任务", "<p>移除这项任务？相关对话和项目文件会保留。</p>", {
      label: "移除",
      danger: true,
      onSubmit: async () => {
        await api(path, { method: "DELETE" });
        if (state.view === "tasks") await loadTasks();
      },
    });
    return;
  }
  await api(path, { method: "PATCH", body: { action } });
  if (state.view === "tasks") await loadTasks();
  ui.toast(action === "continue" || action === "resume" ? "已继续" : "已暂停");
}
export function openSchedule() {
  ui.dialog(
    "添加定时任务",
    `<label class="field">名称<input name="title" required maxlength="100" placeholder="例如：整理本周项目进展"></label><label class="field">任务内容<textarea name="prompt" rows="4" required placeholder="写清要完成的任务与可检查的结果"></textarea></label><div class="form-grid"><label class="field">执行时间<select name="preset"><option value="0 9 * * 1-5">工作日 09:00</option><option value="0 20 * * *">每天 20:00</option><option value="0 9 * * 1">每周一 09:00</option><option value="custom">自定义 Cron</option></select></label><label class="field">Cron 表达式<input name="cron" placeholder="0 9 * * 1-5"></label></div><p>时区：Asia/Shanghai。应用运行时执行，启动时不补跑漏掉的任务；会话忙碌时等待空闲后执行一次。默认沿用当前模型和权限。</p>`,
    {
      label: "创建",
      onSubmit: async (data) => {
        await api("/api/schedules", {
          method: "POST",
          body: {
            title: data.get("title"),
            prompt: data.get("prompt"),
            cron:
              data.get("preset") === "custom"
                ? data.get("cron")
                : data.get("preset"),
            session_id: state.session?.session_id || "",
            workdir: state.workdir,
            model: state.model,
            permission_mode: state.permission,
            time_zone: "Asia/Shanghai",
          },
        });
        await loadTasks();
      },
    },
  );
  const preset = $("#dialog select[name=preset]");
  const cron = $("#dialog input[name=cron]");
  const syncPreset = () => {
    const custom = preset.value === "custom";
    cron.closest("label").hidden = !custom;
    cron.disabled = !custom;
    cron.required = custom;
  };
  preset.addEventListener("change", syncPreset);
  syncPreset();
}
export async function loadSettings() {
  const [settings, instructions] = await Promise.all([
    api("/api/settings?mode=viniper"),
    api("/api/agent-instructions?mode=viniper"),
  ]);
  const s = settings.settings || {},
    p = s.provider || {};
  const form = $("#settings-form");
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
  $("#settings-result").textContent = "";
}
export async function saveSettings() {
  const form = $("#settings-form"),
    data = new FormData(form),
    button = form.querySelector("[type=submit]");
  button.disabled = true;
  try {
    const secret = String(data.get("api-key") || "");
    if (secret) {
      if (!window.viniperDesktop?.saveProviderSecret)
        throw new Error("请在 Viniper 桌面应用中保存密钥");
      const result = await window.viniperDesktop.saveProviderSecret(
        "viniper",
        secret,
      );
      if (!result.ok) throw new Error("钥匙串未完成保存，原密钥已保留");
      form.elements["api-key"].value = "";
    }
    await api("/api/settings", {
      method: "PUT",
      body: {
        mode: "viniper",
        settings: {
          provider: {
            id: data.get("provider-id"),
            label: data.get("provider-label"),
            base_url: data.get("base-url"),
            model: data.get("model-id"),
          },
          appearance: {
            theme: data.get("theme"),
            font_size: data.get("font-size"),
          },
          workspace: { default_root: data.get("workdir") },
        },
      },
    });
    await api("/api/agent-instructions", {
      method: "PUT",
      body: { mode: "viniper", content: data.get("instructions") },
    });
    state.model = String(data.get("model-id"));
    await ui.loadStatus();
    $("#settings-result").textContent = "设置已保存";
    ui.toast("设置已保存");
  } finally {
    button.disabled = false;
  }
}
