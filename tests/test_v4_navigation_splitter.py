"""Synthetic v4 navigation and sidebar splitter contracts.

These checks exercise pure reducers and DOM contracts; they do not claim
Electron visual acceptance or a real pointer device.
"""

from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
CSS = (ROOT / "static" / "style.css").read_text(encoding="utf-8")
APP = (ROOT / "static" / "app.js").read_text(encoding="utf-8")


class V4NavigationSplitterTests(unittest.TestCase):
    def test_window_level_nav_spans_shell_and_uses_one_line_icon_set(self) -> None:
        self.assertLess(HTML.index('<header id="topbar"'), HTML.index('<aside id="sidebar"'))
        self.assertLess(HTML.index('<header id="topbar"'), HTML.index('<main id="main"'))
        nav = HTML[HTML.index('<nav id="global-nav"'):HTML.index('</nav>', HTML.index('<nav id="global-nav"'))]
        ordered = ["menu-btn", "toggle-sidebar-btn", "search-btn", "back-btn", "forward-btn"]
        positions = [nav.index(f'id="{item}"') for item in ordered]
        self.assertEqual(positions, sorted(positions))
        self.assertEqual(nav.count('class="nav-icon"'), 5)
        for glyph in ("☰", "▣", "⌕", "←", "→"):
            self.assertNotIn(glyph, nav)
        self.assertIn("grid-template-rows: var(--titlebar-height) minmax(0, 1fr)", CSS)
        self.assertIn("#topbar { grid-column: 1 / -1; grid-row: 1;", CSS)
        self.assertIn("#sidebar { grid-column: 1; grid-row: 2;", CSS)
        self.assertIn("#sidebar-resizer { grid-column: 2; grid-row: 2;", CSS)
        self.assertIn("#main { grid-column: 3; grid-row: 2;", CSS)

    def test_v4_semantics_and_shared_commands_are_wired(self) -> None:
        self.assertNotIn("新建 Agent", HTML + APP)
        self.assertIn('data-menu-action="new-chat">新建聊天', HTML)
        self.assertIn('data-menu-action="new-agent-session">新建会话', HTML)
        self.assertIn('mode: "agent"', APP)
        self.assertIn('data-menu-action="skills">自定义与技能', HTML)
        self.assertIn('data-menu-action="settings">设置', HTML)
        for token in ("toggleSidebar(\"topbar\")", "Ctrl+B", "pointercancel", "setPointerCapture", "SIDEBAR_DRAG_THRESHOLD", "SIDEBAR_WIDTH_KEY", "sidebarPointerStartAction", "navigationOverlayState"):
            self.assertIn(token, APP)
        self.assertIn("navigateHistory(\"back\")", APP)
        self.assertIn("navigateHistory(\"forward\")", APP)
        self.assertIn("state.navigation.replaying", APP)
        self.assertIn("closeOverlayNavigation", APP)
        self.assertIn("handleGlobalMenuKeydown", APP)
        self.assertIn("openSkillsView({ history: false, recordLocation: false })", APP)
        self.assertIn("openSettingsModal({ history: true })", APP)
        self.assertIn("closeSkillsView({ restoreNavigation: false })", APP)
        self.assertIn("closeSettingsModal({ restoreNavigation: false })", APP)
        self.assertIn("returnToSkillList", APP)
        self.assertIn("setNavigationLocation({ kind: \"settings\", section: selected })", APP)

    def test_pure_gesture_navigation_and_search_reducers(self) -> None:
        script = r'''
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync("static/app.js", "utf8");
const context = {
  console, TextDecoder, TextEncoder, WeakMap,
  performance: { now: () => 0 },
  localStorage: { getItem: () => null, setItem: () => {} },
  document: { addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] },
  window: { VINIPER_APP_TITLE: "Viniper Preview" },
  setTimeout, clearTimeout, setInterval, clearInterval
};
vm.createContext(context);
vm.runInContext(source + "\nthis.__api = __VINIPER_TEST_API__;", context);
const api = context.__api;
const history0 = { current: {kind:"session", mode:"chat", sessionId:"c1"}, back: [], forward: [], replaying: false };
const history1 = api.pushNavigationLocation(history0, {kind:"session", mode:"agent", sessionId:"a1"});
const history2 = api.pushNavigationLocation(history1, {kind:"skills", skillId:"claude/shared"});
const back = api.stepNavigationHistory(history2, "back");
const forward = api.stepNavigationHistory(back, "forward");
const session = {kind:"session", mode:"agent", sessionId:"a1"};
const skillStack = {current:{kind:"skills", skillId:"claude/shared"}, back:[session, {kind:"skills"}], forward:[], replaying:false};
const settingsStack = {current:{kind:"settings", section:"appearance"}, back:[session, {kind:"settings", section:"account"}], forward:[], replaying:false};
const skillClose = api.closeOverlayNavigation(skillStack, session);
const settingsClose = api.closeOverlayNavigation(settingsStack, session);
const skillTopBack = api.stepNavigationHistory(skillStack, "back");
const overlays = [
  api.navigationOverlayState({kind:"session", mode:"agent", sessionId:"a1"}),
  api.navigationOverlayState({kind:"skills", skillId:"claude/shared"}),
  api.navigationOverlayState({kind:"session", mode:"agent", sessionId:"a1"})
];
const skills = api.buildSearchEntries(
  [{id:"c1", mode:"chat", name:"聊天一"}, {id:"a1", mode:"agent", name:"任务一"}],
  [{id:"claude/shared", name:"共享", source:"claude", path:"shared/SKILL.md"}, {id:"agents/shared", name:"共享", source:"agents", path:"shared/SKILL.md"}],
  "共享"
);
process.stdout.write(JSON.stringify({
  below: api.sidebarGestureDecision(100, 104),
  drag: api.sidebarGestureDecision(100, 106),
  cancel: api.sidebarGestureDecision(100, 106, 5),
  collapsedPointer: api.sidebarPointerStartAction({visible:false, narrow:false, button:0}),
  narrowPointer: api.sidebarPointerStartAction({visible:false, narrow:true, button:0}),
  overlays,
  back, forward,
  skillClose, settingsClose, skillTopBack,
  skillIds: skills.filter(item => item.kind === "skill").map(item => item.id),
  modeLabels: api.buildSearchEntries([{id:"c1", mode:"chat", name:"聊天"}, {id:"a1", mode:"agent", name:"任务"}], [], "").filter(item => item.kind === "session").map(item => item.detail)
}));
'''
        result = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True)
        payload = json.loads(result.stdout)
        self.assertFalse(payload["below"]["dragging"])
        self.assertTrue(payload["drag"]["dragging"])
        self.assertEqual(payload["drag"]["delta"], 6)
        self.assertEqual(payload["collapsedPointer"], "toggle")
        self.assertEqual(payload["narrowPointer"], "ignore")
        self.assertEqual(payload["overlays"], [{"skills": False, "settings": False}, {"skills": True, "settings": False}, {"skills": False, "settings": False}])
        self.assertEqual(payload["skillIds"], ["claude/shared", "agents/shared"])
        self.assertEqual(payload["modeLabels"], ["Chat · 本地会话", "Agent · 本地会话"])
        self.assertEqual(payload["back"]["current"], {"kind": "session", "mode": "agent", "sessionId": "a1"})
        self.assertEqual(payload["forward"]["current"], {"kind": "skills", "skillId": "claude/shared"})
        self.assertEqual(payload["skillClose"]["current"], {"kind": "session", "mode": "agent", "sessionId": "a1"})
        self.assertEqual(payload["skillClose"]["back"], [])
        self.assertEqual(payload["settingsClose"]["current"], {"kind": "session", "mode": "agent", "sessionId": "a1"})
        self.assertEqual(payload["settingsClose"]["back"], [])
        self.assertEqual(payload["skillTopBack"]["current"], {"kind": "skills"})

    def test_global_menu_keyboard_focus_order(self) -> None:
        script = r'''
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync("static/app.js", "utf8");
const active = { value: null };
const items = Array.from({length: 4}, (_, index) => ({
  focus() { active.value = this; },
  index
}));
const menu = { querySelectorAll() { return items; } };
const document = {
  addEventListener() {},
  querySelector(selector) { return selector === "#global-menu" ? menu : null; },
  querySelectorAll() { return []; },
  get activeElement() { return active.value; },
  documentElement: { dataset: {}, style: { setProperty() {} } },
  body: { classList: { toggle() {} }, dataset: {} }
};
const context = {
  console, TextDecoder, TextEncoder, WeakMap, document,
  performance: { now: () => 0 },
  localStorage: { getItem: () => null, setItem: () => {} },
  window: { VINIPER_APP_TITLE: "Viniper Preview", matchMedia: () => ({ matches: false }) },
  setTimeout, clearTimeout, setInterval, clearInterval
};
vm.createContext(context);
vm.runInContext(source + "\nthis.__api = __VINIPER_TEST_API__;", context);
const api = context.__api;
active.value = items[0];
const seen = [];
for (const key of ["ArrowDown", "ArrowDown", "ArrowUp", "Home", "End", "ArrowDown"]) {
  let prevented = false;
  api.handleGlobalMenuKeydown({key, preventDefault() { prevented = true; }});
  seen.push({key, index: active.value.index, prevented});
}
process.stdout.write(JSON.stringify(seen));
'''
        result = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True)
        self.assertEqual(json.loads(result.stdout), [
            {"key": "ArrowDown", "index": 1, "prevented": True},
            {"key": "ArrowDown", "index": 2, "prevented": True},
            {"key": "ArrowUp", "index": 1, "prevented": True},
            {"key": "Home", "index": 0, "prevented": True},
            {"key": "End", "index": 3, "prevented": True},
            {"key": "ArrowDown", "index": 0, "prevented": True},
        ])

    def test_overlay_and_caption_safe_area_contracts(self) -> None:
        for token in ("aria-expanded", "global-menu", "search-panel", "closeMenu({ restoreFocus: true })", "closeSearchPanel({ restoreFocus: true })", "data-search-index"):
            self.assertIn(token, HTML + APP)
        self.assertIn(".platform-win32 #topbar { padding-right: 150px;", CSS)
        self.assertIn("@media (max-width: 819px)", CSS)
        self.assertIn("#sidebar-resizer { display: none; }", CSS)
        self.assertIn("body.sidebar-collapsed #sidebar-resizer { display: grid; position: absolute;", CSS)
        self.assertIn(".sidebar-header { justify-content: space-between; display: none; }", CSS)
        self.assertIn("#sidebar-resizer::before { width: 1px; height: 100%;", CSS)
        self.assertNotIn(".global-nav .topbar-nav-button:nth-child(4), .global-nav .topbar-nav-button:nth-child(5) { display: none; }", CSS)
        self.assertIn("#session-title, #workdir-display { display: none; }", CSS)
        self.assertIn("setSidebarWidth(gesture.startWidth + decision.delta, { persist: false })", APP)
        self.assertIn("setSidebarWidth(gesture.startWidth, { persist: false })", APP)
        self.assertIn('button.title = tooltipText', APP)
        self.assertIn('"折叠侧栏"', APP)
        self.assertIn('"展开侧栏"', APP)

    def test_runtime_search_skill_keeps_origin_before_single_detail_push(self) -> None:
        script = r'''
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync("static/app.js", "utf8");
function element(hidden = true) {
  const names = new Set(hidden ? ["hidden"] : []);
  return {
    classList: {
      toggle(name, value) { if (value) names.add(name); else names.delete(name); },
      add(name) { names.add(name); },
      remove(name) { names.delete(name); },
      contains(name) { return names.has(name); }
    },
    dataset: {},
    focus() {},
    setAttribute() {},
    removeAttribute() {},
    querySelector() { return null; },
    innerHTML: "",
    value: ""
  };
}
const elements = new Map();
const selectors = ["#search-panel", "#search-btn", "#skills-view", "#settings-modal", "#skill-detail", "#skills-list", "#skills-categories", ".skills-search", "#skill-search", "#skill-detail-content", "#back-btn", "#forward-btn"];
for (const selector of selectors) elements.set(selector, element(selector !== "#skills-view"));
const document = {
  addEventListener() {},
  querySelector(selector) { if (!elements.has(selector)) elements.set(selector, element()); return elements.get(selector); },
  querySelectorAll() { return []; },
  documentElement: { dataset: {}, style: { setProperty() {} } },
  body: { classList: { toggle() {} }, dataset: {} }
};
const context = {
  console, TextDecoder, TextEncoder, WeakMap, document,
  performance: { now: () => 0 },
  localStorage: { getItem: () => null, setItem: () => {} },
  window: { VINIPER_APP_TITLE: "Viniper Preview", matchMedia: () => ({ matches: false }) },
  fetch: async (url) => ({
    ok: true,
    async json() { return url === "/api/skills" ? {skills: []} : {content: "# detail"}; }
  }),
  setTimeout, clearTimeout, setInterval, clearInterval
};
vm.createContext(context);
vm.runInContext(source + "\nthis.__api = __VINIPER_TEST_API__;", context);
const api = context.__api;
api.state.navigation = {current:{kind:"session", mode:"agent", sessionId:"a1"}, back:[], forward:[], replaying:false};
api.state.viewMode = "agent";
api.state.searchOpen = true;
await api.activateSearchResult({kind:"skill", id:"claude/shared"});
process.stdout.write(JSON.stringify({
  current: api.state.navigation.current,
  back: api.state.navigation.back,
  skillsVisible: !elements.get("#skills-view").classList.contains("hidden"),
  settingsVisible: !elements.get("#settings-modal").classList.contains("hidden")
}));
'''
        wrapper = f"(async () => {{{script}}})().catch(error => {{ console.error(error); process.exit(1); }});"
        result = subprocess.run(
            ["node", "-e", wrapper], cwd=ROOT, capture_output=True,
            text=True, encoding="utf-8", check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["current"], {"kind": "skills", "skillId": "claude/shared"})
        self.assertEqual(payload["back"], [{"kind": "session", "mode": "agent", "sessionId": "a1"}])
        self.assertTrue(payload["skillsVisible"])
        self.assertFalse(payload["settingsVisible"])


if __name__ == "__main__":
    unittest.main()
