import { escape } from "./api.js";
import { icon } from "./icons.js";

export function editRoom(dialog, session, models, currentModel, save) {
  if (!models.length) throw new Error("请先配置可用模型");
  const first = models.find(m => m.id === currentModel) || models[0];
  const initial = session?.members || [
    { name: "主答", role: "解答问题，需要时分配任务", model: first.id },
    { name: "复核", role: "核验推导和结果", model: first.id },
  ];
  function row(member) {
    const options = models.map(m => `<option value="${escape(m.id)}" ${m.id === member.model ? "selected" : ""}>${escape(m.label || m.id)}</option>`).join("");
    const missing = member.model && !models.some(m => m.id === member.model);
    return `<fieldset class="room-member"><legend>成员</legend>
      <label>群内称呼<input name="member-name" maxlength="24" required value="${escape(member.name)}"></label>
      <label>模型<select name="member-model" required>${missing ? '<option value="" selected>重新选择模型</option>' : ""}${options}</select></label>
      <button type="button" class="icon-button" data-remove-member aria-label="移除成员" data-hint="移除这位成员">${icon("close")}</button>
      <label class="room-role">分工<input name="member-role" required maxlength="180" value="${escape(member.role)}"></label></fieldset>`;
  }
  dialog(session ? "群成员" : "新建群聊",
    `<label class="field">群聊名称<input name="room-name" required maxlength="100" value="${escape(session?.name || "数学群聊")}"></label>
    <div class="room-roster">${initial.map(row).join("")}</div>
    <button type="button" class="text-button" data-invite>${icon("plus")}添加成员</button>
    <p class="room-note">首位成员接题，可交给队友。受邀发言的模型会收到本群上下文。</p>`,
    {label:session ? "保存" : "创建群聊", onSubmit: data => {
      const names = data.getAll("member-name"), roles = data.getAll("member-role"), ids = data.getAll("member-model");
      return save({name:data.get("room-name").trim(), members:names.map((name,i) => ({name:name.trim(),role:roles[i].trim(),model:ids[i]}))});
    }});
  const roster = document.querySelector(".room-roster"), invite = document.querySelector("[data-invite]");
  function refresh() {
    const rows = [...roster.children];
    invite.disabled = rows.length >= 6;
    rows.forEach((r,i) => {
      r.querySelector("legend").textContent = i === 0 ? "主接成员" : "成员 " + (i + 1);
      r.querySelector("[data-remove-member]").disabled = rows.length <= 2;
    });
  }
  invite.onclick = () => {
    roster.insertAdjacentHTML("beforeend", row({name:"",role:"",model:first.id}));
    refresh(); roster.lastElementChild.querySelector("input").focus();
  };
  roster.onclick = event => {
    const remove = event.target.closest("[data-remove-member]");
    if (remove && roster.children.length > 2) { remove.closest("fieldset").remove(); refresh(); }
  };
  refresh();
}
