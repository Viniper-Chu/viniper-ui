import { preferenceFields } from "./preferences.js";
import { escape, state } from "./api.js";
import { icon } from "./icons.js";

export function setupNavigator(actions) {
  const dialog = document.querySelector("#navigator");
  const input = document.querySelector("#navigator-query");
  const list = document.querySelector("#navigator-list");
  let items = [], visible = [], selected = 0;

  function workItems() {
    const items = [];
    for (const button of document.querySelectorAll("#starters [data-prompt]")) {
      items.push({ group: "工作", label: button.textContent.trim(), glyph: button.querySelector("[data-icon]").dataset.icon,
        run: () => actions.applyStarter(button) });
    }
    items.push({ group: "工作", label: "新建会话", glyph: "compose", run: actions.newChat });
    for (const session of state.sessions) {
      const id = session.id || session.session_id;
      if (!id) continue;
      items.push({ group: "会话", label: session.name || "未命名会话", hint: session.workdir || "",
        detail: (session.workdir || "").split(/[\\/]/).filter(Boolean).at(-1),
        glyph: session.pinned ? "pin" : "chat", run: () => actions.selectSession(id) });
    }
    for (const [view, label, glyph] of [["extensions","技能与插件","grid"],["tasks","目标与任务","tasks"],["settings","设置与模型","settings"]]) {
      items.push({group:"页面", label, glyph, run:() => actions.view(view)});
    }
    for (const field of preferenceFields()) {
      items.push({group:"设置", label:field.label, detail:field.section, hint:[field.name,field.aliases].join(" "), glyph:"settings",
        run:() => actions.openPreference(field.sectionId, field.name)});
    }
    return items;
  }
  // Read the already-filtered result buttons so the index follows exactly the same delivery policy as the transcript.
  function turnItems() {
    const questions = [], files = new Map();
    for (const message of document.querySelectorAll("#messages .message")) {
      if (message.classList.contains("user")) {
        const label = message._message?.content?.trim() || "附件";
        questions.push({group:"提问与引导",label,glyph:message._message?.guidance ? "steer" : "chat",run:() => actions.jumpToMessage(message.id)});
      }
      for (const file of message.querySelectorAll(".message-results [data-file]")) {
        const path = file.dataset.file;
        if (!path || files.has(path)) continue;
        const label = path.split(/[\\/]/).filter(Boolean).at(-1) || path;
        files.set(path,{group:"交付文件",label,detail: file.classList.contains("result-file") ? "" : "源码目录",
          hint:path,glyph:file.classList.contains("result-file") ? "document" : "folder",run:() => actions.openFile(path)});
      }
    }
    return [...files.values(), ...questions];
  }
  function highlight(index, scroll = false) {
    selected = index;
    for (const row of list.querySelectorAll("[data-nav-index]"))
      row.setAttribute("aria-selected",String(Number(row.dataset.navIndex) === selected));
    const chosen = list.querySelector('[aria-selected="true"]');
    if (chosen) {
      input.setAttribute("aria-activedescendant",chosen.id);
      if (scroll) chosen.scrollIntoView({block:"nearest"});
    } else input.removeAttribute("aria-activedescendant");
  }
  function render() {
    const query = input.value.trim().toLocaleLowerCase();
    visible = items.filter(item => [item.label,item.detail,item.group,item.hint].filter(Boolean).join(" ").toLocaleLowerCase().includes(query));
    let group = "";
    const rows = visible.map((item,index) => {
      const title = group === item.group ? "" : '<div class="navigator-group" role="presentation">'+escape(item.group)+'</div>';
      group = item.group;
      return title + '<div role="option" aria-selected="false" id="nav-result-'+index+'" data-nav-index="'+index+'" data-hint="'+escape(item.group === "设置" ? "定位到" + item.detail + "中的" + item.label : item.hint || item.label)+'">'
        + icon(item.glyph) + '<span class="nav-result-title">'+escape(item.label)+'</span>'
        + (item.detail ? '<small>'+escape(item.detail)+'</small>' : '') + '</div>';
    });
    list.innerHTML = rows.join("") || '<p class="nav-empty" role="status">没有匹配的结果</p>';
    list.scrollTop = 0;
    highlight(0);
  }
  async function choose(index) {
    const item = visible[index];
    if (!item) return;
    dialog.close();
    try { await item.run(); } catch (error) { actions.toast(error.message,true); }
  }
  input.addEventListener("input",render);
  input.addEventListener("keydown",event => {
    if (event.isComposing) return;
    if (event.key === "Enter") {event.preventDefault();choose(selected);return;}
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (visible.length) highlight((selected+(event.key==="ArrowDown"?1:-1)+visible.length)%visible.length,true);
    }
  });
  list.addEventListener("click",event => {
    const row = event.target.closest("[data-nav-index]");
    if (row) choose(Number(row.dataset.navIndex));
  });
  dialog.querySelector("[data-nav-close]").addEventListener("click",()=>dialog.close());
  dialog.addEventListener("click",event => {
    if (event.target !== dialog) return;
    const r=dialog.getBoundingClientRect();
    if (event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom) dialog.close();
  });
  return kind => {
    if (document.querySelector("dialog[open]")) return;
    actions.closeMenu();
    const index = kind === "turn-index";
    dialog.querySelector("h2").textContent = index ? "会话目录" : "快速查找";
    dialog.querySelector("[data-nav-close]").setAttribute("aria-label",index ? "关闭会话目录" : "关闭快速查找");
    input.placeholder = index ? "查找本次提问或交付文件" : "查找会话、操作或页面";
    items = index ? turnItems() : workItems();
    input.value = "";
    render(); dialog.showModal(); input.focus();
  };
}
