// One floating hint for the shell, including controls created while a task streams.
const controls = "button, summary, [data-nav-index]";
function hintFor(control) {
  if (control.matches("summary")) {
    const subject = control.dataset.hint || "详情";
    return (control.parentElement.open ? "收起" : "展开") + subject;
  }
  if (control.hasAttribute("data-nav-close")) return control.getAttribute("aria-label") + "  Esc";
  if (control.hasAttribute("data-toggle-thoughts")) {
    return (control.getAttribute("aria-expanded") === "true" ? "收起" : "展开") + "本轮思考与工具记录";
  }
  if (control.dataset.file) return "打开 " + control.dataset.file;
  if (control.dataset.jump) return control.getAttribute("aria-label");
  return control.dataset.hint || control.getAttribute("aria-label") || control.textContent.trim();
}

export function setupTooltips() {
  const tip = document.createElement("div");
  tip.id = "control-hint";
  tip.popover = "manual";
  tip.setAttribute("role", "tooltip");
  document.body.append(tip);
  let owner = null, upcoming, leaving;
  const observer = new MutationObserver(paint);
  const size = new ResizeObserver(paint);
  function hide() {
    clearTimeout(upcoming);
    clearTimeout(leaving);
    observer.disconnect();
    size.disconnect();
    if (tip.matches(":popover-open")) tip.hidePopover();
    if (owner) {
      const ids = (owner.getAttribute("aria-describedby") || "").split(/\s+/).filter(id => id && id !== tip.id);
      if (ids.length) owner.setAttribute("aria-describedby", ids.join(" "));
      else owner.removeAttribute("aria-describedby");
    }
    owner = null;
  }
  function paint() {
    if (!owner || !owner.isConnected || !owner.getClientRects().length || owner.closest("[hidden]")) return hide();
    const modal = document.querySelector("dialog:modal");
    if (modal && !modal.contains(owner)) return hide();
    let text = hintFor(owner);
    if (text && !document.body.classList.contains("platform-mac") && owner.dataset.hint?.includes("⌘")) {
      text = text.replace(/⇧⌘(?=[A-Z])/g, "Ctrl+Shift+").replace(/⌘(?=Enter|[A-Z,])/g, "Ctrl+");
    }
    if (!text) return hide();
    if (tip.textContent !== text) tip.textContent = text;
    if (!tip.matches(":popover-open")) tip.showPopover();
    const box = owner.getBoundingClientRect();
    const gap = 6, edge = 8;
    const left = Math.max(edge, Math.min(box.left + (box.width - tip.offsetWidth) / 2, innerWidth - tip.offsetWidth - edge));
    const above = box.top - tip.offsetHeight - gap;
    const top = above >= edge ? above : Math.max(edge, Math.min(box.bottom + gap, innerHeight - tip.offsetHeight - edge));
    tip.style.left = Math.round(left) + "px";
    tip.style.top = Math.round(top) + "px";
  }
  function schedule(target, delay) {
    if (!target) return;
    clearTimeout(leaving);
    if (target === owner) return;
    hide();
    owner = target;
    upcoming = setTimeout(() => {
      if (!owner.isConnected) return hide();
      (owner.closest("dialog") || document.body).append(tip);
      const ids = (owner.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
      owner.setAttribute("aria-describedby", [...new Set([...ids, tip.id])].join(" "));
      observer.observe(owner, {subtree:true, childList:true, characterData:true, attributes:true,
        attributeFilter:["aria-label","aria-expanded","data-hint","disabled","hidden"]});
      size.observe(owner);
      paint();
    }, delay);
  }
  document.addEventListener("pointerover", event => {
    if (event.pointerType === "touch") return;
    if (tip.contains(event.target)) { clearTimeout(leaving); return; }
    schedule(event.target.closest(controls), 420);
  }, true);
  document.addEventListener("pointerout", event => {
    if (!owner || owner.contains(event.relatedTarget) || tip.contains(event.relatedTarget)) return;
    if (owner.contains(event.target) || tip.contains(event.target)) {
      clearTimeout(leaving);
      leaving = setTimeout(hide, 100);
    }
  }, true);
  document.addEventListener("focusin", event => {
    const control = event.target.closest(controls);
    if (control?.matches(":focus-visible")) schedule(control, 260);
  });
  document.addEventListener("focusout", event => { if (owner === event.target) hide(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape") hide(); }, true);
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("scroll", hide, {capture:true, passive:true});
  document.addEventListener("close", hide, true);
  window.addEventListener("blur", hide);
  window.addEventListener("resize", hide);
}
