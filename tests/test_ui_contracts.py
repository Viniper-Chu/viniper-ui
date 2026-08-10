"""Static S3 contract checks; these do not claim real Electron visual proof."""

from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
CSS = (ROOT / "static" / "style.css").read_text(encoding="utf-8")
APP = (ROOT / "static" / "app.js").read_text(encoding="utf-8")


class UiContractTests(unittest.TestCase):
    def test_shell_has_semantic_landmarks_and_status_regions(self) -> None:
        self.assertIn("<aside id=\"sidebar\"", HTML)
        self.assertIn('id="view-tabs"', HTML)
        self.assertIn('id="chat-view-btn"', HTML)
        self.assertIn('id="agent-view-btn"', HTML)
        self.assertIn('id="new-session-nav-btn"', HTML)
        self.assertIn('id="project-btn"', HTML)
        self.assertIn('id="customize-btn"', HTML)
        self.assertIn('id="workspace-rail"', HTML)
        self.assertIn('id="tool-area"', HTML)
        self.assertIn('id="artifact-area"', HTML)
        self.assertIn('<main id="main" aria-label="主工作区">', HTML)
        self.assertIn('role="log" aria-live="polite"', HTML)
        self.assertIn('role="status" aria-live="polite"', HTML)
        self.assertIn('id="input-area" aria-label="消息输入"', HTML)
        self.assertIn('class="welcome-icon"', APP)
        self.assertIn("今天想聊什么？", APP)
        self.assertNotIn("今天想完成什么？", APP)
        self.assertIn("只进行对话，不会调用工具或操作文件。", APP)
        self.assertNotIn("准备好了", APP)

    def test_visual_tokens_and_themes_are_local(self) -> None:
        for token in ("--color-canvas", "--color-surface", "--color-ink", "--color-divider", "--space-2", "--radius-control"):
            self.assertIn(token, CSS)
        self.assertIn(':root[data-theme="dark"]', CSS)
        self.assertIn("@media (prefers-reduced-motion: reduce)", CSS)
        self.assertNotIn("cdn.", CSS.lower())
        self.assertNotIn("<script src=\"http", HTML.lower())

    def test_narrow_and_standard_layout_contracts_exist(self) -> None:
        self.assertIn("@media (max-width: 900px)", CSS)
        self.assertIn("@media (max-width: 1100px)", CSS)
        self.assertIn("@media (max-width: 720px)", CSS)
        self.assertIn(".window-pin-button", CSS)
        self.assertIn("padding-bottom: 62px", CSS)
        self.assertIn("updateContextMeter({ schedule: false })", APP)
        self.assertIn("--color-sidebar: #f2f2f0", CSS)
        self.assertIn("--color-canvas: #0d0d0d", CSS)

    def test_session_and_window_pin_semantics_remain_distinct(self) -> None:
        self.assertIn('id="always-on-top-btn"', HTML)
        self.assertIn('class="window-pin-icon"', HTML)
        self.assertIn('/static/assets/viniper-icon.png', HTML)
        self.assertNotIn('>○ 窗口<', HTML)
        self.assertIn("data-session-pin", APP)
        self.assertNotIn("data-window-pin", APP)
        self.assertIn("setSessionPinned", APP)
        self.assertIn("toggleAlwaysOnTop", APP)

    def test_context_state_is_visible_to_ui_contract(self) -> None:
        self.assertIn('id="context-ring"', HTML)
        self.assertIn('role="status"', HTML)
        self.assertNotIn('id="context-compress-btn"', HTML)
        self.assertNotIn("compressCurrentContext", APP)
        self.assertNotIn("auto = false", APP)
        self.assertNotIn("可手动重试", APP)
        self.assertIn("scheduleContextCompression", APP)
        self.assertIn("contextCompressionBySession", APP)
        self.assertIn("lastAttemptKey", APP)
        self.assertIn('status = "running"', APP)
        self.assertIn('status = "failed"', APP)
        self.assertIn('compressionState', APP)

    def test_context_rail_is_on_demand_and_settings_use_single_two_pane_center(self) -> None:
        self.assertIn('class="context-rail hidden"', HTML)
        self.assertIn('class="settings-shell"', HTML)
        self.assertIn('class="settings-center-content"', HTML)
        self.assertIn('class="settings-nav"', HTML)
        self.assertIn("function updateContextRail()", APP)
        self.assertIn('rail.classList.add("hidden")', APP)
        self.assertIn('rail.setAttribute("aria-hidden", "true")', APP)
        self.assertIn('aria-haspopup="listbox"', HTML)
        self.assertIn("function setViewMode(mode)", APP)
        self.assertIn("function activateSettingsSection", APP)

    def test_session_groups_and_mode_view_have_runtime_hooks(self) -> None:
        self.assertIn('class="session-group"', APP)
        self.assertIn('renderGroup("已置顶"', APP)
        self.assertIn('renderGroup("最近会话"', APP)
        self.assertIn('data-settings-nav="provider"', HTML)
        self.assertIn("#main.agent-view", CSS)
        self.assertIn('class="composer-tools-left"', HTML)
        self.assertIn('class="composer-tools-right"', HTML)
        self.assertIn("#topbar", CSS)
        self.assertIn("#composer:focus-within", CSS)
        self.assertIn(".sidebar-header .brand-copy", CSS)

    def test_chat_agent_boundaries_and_structured_activity(self) -> None:
        self.assertIn('class="sidebar-nav-item agent-only"', HTML)
        self.assertIn('id="skills-view"', HTML)
        self.assertIn('自定义与技能', HTML)
        self.assertNotIn('skills-web-btn', HTML + APP)
        self.assertNotIn('skills.sh', APP)
        self.assertIn('function recordActivity(payload)', APP)
        self.assertIn('tool_start', APP)
        self.assertIn('tool_result', APP)
        self.assertIn('function updateContextRail()', APP)
        self.assertNotIn("/工具|执行|命令|读取|写入|运行/", APP)
        self.assertIn('titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden"', (ROOT / "desktop" / "main.js").read_text(encoding="utf-8"))
        self.assertIn("setTitlebarTheme", (ROOT / "desktop" / "preload.js").read_text(encoding="utf-8"))

    def test_c3_empty_chat_and_neutral_splitter_visual_seams(self) -> None:
        self.assertIn("next_session_name(mode)", (ROOT / "server.py").read_text(encoding="utf-8"))
        self.assertIn('id="account-menu-trigger"', HTML)
        self.assertIn('class="nav-icon account-menu-icon"', HTML)
        self.assertNotIn("gear-icon", HTML + CSS)
        self.assertIn("chat-empty", APP + CSS)
        self.assertIn("background: transparent", CSS[CSS.rfind("/* C3 visual seams") :])
        self.assertIn("top: calc(50% - 28px)", CSS)
        self.assertNotIn('id="change-workdir-btn"', HTML)

    def test_composer_uses_conversation_column_and_chat_hint_is_single(self) -> None:
        self.assertIn("#main > #input-area {\n  grid-column: 1 / -1;", CSS)
        self.assertIn("#main:has(#workspace-rail:not(.hidden)) > #input-area { grid-column: 1; }", CSS)
        self.assertIn('hint.classList.toggle("hidden", !agent)', APP)
        self.assertIn('hint.textContent = agent ? "输入任务，或使用 / 命令" : ""', APP)

    def test_hover_does_not_change_geometry(self) -> None:
        # Static tooltip placement may use translateX; reject only motion/glow
        # declarations that make hover alter geometry or start an animation.
        self.assertNotRegex(CSS, r"(?is)hover[^{}]*\{[^{}]*(animation|transition|scale|translateY|rotate|liquidBorder|box-shadow)")
        self.assertNotIn("transform: translateY(-1px)", CSS)
        self.assertNotIn("animation: liquidBorder 1.7s linear infinite", CSS)

    def test_local_original_icon_and_chinese_default_surface(self) -> None:
        self.assertIn("/static/assets/viniper-icon.png", HTML)
        self.assertNotIn('<script src="http', HTML.lower())
        self.assertNotIn("准备好了", HTML + APP)
        self.assertNotIn("当前任务的工具状态会显示在这里。", HTML)


if __name__ == "__main__":
    unittest.main()
