"""Offline contracts for the v5 Agent surface, account menu, and density seam."""

from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
CSS = (ROOT / "static" / "style.css").read_text(encoding="utf-8")
MAIN = (ROOT / "desktop" / "main.js").read_text(encoding="utf-8")


class V5AgentAccountDensityTests(unittest.TestCase):
    def test_agent_surface_reuses_structured_transcript_without_duplicate_rail(self) -> None:
        self.assertIn('chatContainer.dataset.surface = nextMode === "agent" ? "agent-workspace" : "chat-conversation"', APP)
        self.assertIn('composer.dataset.surface = nextMode === "agent" ? "agent-composer" : "chat-composer"', APP)
        self.assertIn('class="sidebar-nav-item agent-only"', HTML)
        self.assertIn('id="agent-view-btn"', HTML)
        self.assertNotIn("agent-activity-stream", HTML + APP)
        self.assertIn('data-activity="tool_summary"', APP)
        self.assertIn('data-activity="artifact"', APP)
        self.assertIn('id="agent-daily-usage"', APP)
        self.assertIn('class="daily-usage-heatmap"', APP)
        self.assertIn('id="session-title"', HTML)
        self.assertIn('id="workdir-display"', HTML)
        self.assertIn('id="agent-session-header"', HTML)
        self.assertNotIn('} / ${sessionLabel}`', APP)
        self.assertIn("#main.agent-view .agent-welcome", CSS)
        self.assertIn("#main.agent-view #messages:has(> .agent-welcome)", CSS)
        self.assertIn("#main.agent-view #chat-container:has(#messages > .agent-welcome)", CSS)

    def test_account_menu_transition_hover_click_and_leave(self) -> None:
        script = r'''
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync("static/app.js", "utf8");
const document = { addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, documentElement: {dataset:{}, style:{setProperty(){}}}, body:{classList:{toggle(){}}, dataset:{}} };
const context = { console, TextDecoder, TextEncoder, WeakMap, document, performance:{now:()=>0}, localStorage:{getItem:()=>null,setItem(){}}, window:{VINIPER_APP_TITLE:"Viniper Preview", matchMedia:()=>({matches:false})}, setTimeout, clearTimeout, setInterval, clearInterval };
vm.createContext(context);
vm.runInContext(source + "\nthis.__api = __VINIPER_TEST_API__;", context);
const api = context.__api;
const states = [
  api.accountMenuTransition({open:false,pinned:false}, "hover"),
  api.accountMenuTransition({open:true,pinned:false}, "click"),
  api.accountMenuTransition({open:true,pinned:true}, "leave"),
  api.accountMenuTransition({open:true,pinned:true}, "click"),
  api.accountMenuTransition({open:true,pinned:false}, "leave")
];
process.stdout.write(JSON.stringify(states));
'''
        result = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True)
        self.assertEqual(json.loads(result.stdout), [
            {"open": True, "pinned": False, "focus": False},
            {"open": True, "pinned": True, "focus": True},
            {"open": True, "pinned": True, "focus": False},
            {"open": False, "pinned": False, "focus": False},
            {"open": False, "pinned": False, "focus": False},
        ])
        self.assertIn('account-menu[data-open="true"]', CSS)
        self.assertNotIn('.sidebar-footer:hover .account-menu', CSS)
        self.assertNotIn('.sidebar-footer:focus-within .account-menu', CSS)

    def test_density_has_one_titlebar_token_and_native_overlay_constant(self) -> None:
        self.assertIn("--titlebar-height: 32px", CSS)
        self.assertIn("grid-template-rows: var(--titlebar-height) minmax(0, 1fr)", CSS)
        self.assertIn("top: var(--titlebar-height)", CSS)
        self.assertIn("inset: var(--titlebar-height) 0 0", CSS)
        self.assertIn("const TITLEBAR_HEIGHT = 32;", MAIN)
        self.assertIn("height: TITLEBAR_HEIGHT", MAIN)
        self.assertNotIn("height: 48", MAIN)
        self.assertIn("--density-control: 28px", CSS)
        self.assertIn("--density-chat-composer: 92px", CSS)
        self.assertIn("--density-agent-composer: 68px", CSS)
        self.assertIn("min-height: var(--density-control);", CSS)
        self.assertIn("max-height: var(--density-control);", CSS)
        final_layer = CSS[CSS.rfind("/* v5 density") :]
        # Only titlebar/grid/inset anchors are density seams.  Content artwork
        # (for example the Agent empty-state mark) is allowed to remain 36px.
        density_anchors = (
            r"#app\s*\{[^{}]*(?:height|min-height|top|inset|grid-template-rows)\s*:[^;{}]*(?:48|46|36|34)px",
            r"#topbar\s*\{[^{}]*(?:height|min-height|top|inset|grid-template-rows)\s*:[^;{}]*(?:48|46|36|34)px",
            r"\.global-menu,\s*\.search-panel\s*\{[^{}]*(?:height|min-height|top|inset|grid-template-rows)\s*:[^;{}]*(?:48|46|36|34)px",
            r"\.sidebar-header\s*\{[^{}]*(?:height|min-height|top|inset|grid-template-rows)\s*:[^;{}]*(?:48|46|36|34)px",
            r"body\.sidebar-collapsed\s+#sidebar-resizer\s*\{[^{}]*(?:height|min-height|top|inset|grid-template-rows)\s*:[^;{}]*(?:48|46|36|34)px",
            r"\.skills-view\s*\{[^{}]*(?:height|min-height|top|inset|grid-template-rows)\s*:[^;{}]*(?:48|46|36|34)px",
        )
        for pattern in density_anchors:
            self.assertNotRegex(final_layer, pattern)

    def test_account_menu_has_real_actions_and_renderer_shortcut(self) -> None:
        self.assertIn('data-account-action="settings"', HTML)
        self.assertIn('data-account-action="update"', HTML)
        self.assertIn('data-account-action="diagnostics"', HTML)
        self.assertIn('class="nav-icon account-menu-icon"', HTML)
        self.assertIn('event.key === ","', APP)
        self.assertIn('void openSettingsModal({ history: true });', APP)
        self.assertIn('state.accountMenuOpen', APP)
        self.assertIn('closeAccountMenu({ restoreFocus: true })', APP)


if __name__ == "__main__":
    unittest.main()
