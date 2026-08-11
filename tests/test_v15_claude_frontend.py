"""v15 Claude Code shell frontend contracts without Provider traffic."""

from __future__ import annotations

import json
import subprocess
import unittest
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class _DomParentParser(HTMLParser):
    VOID_ELEMENTS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self) -> None:
        super().__init__()
        self.stack: list[str | None] = []
        self.parents: dict[str, str | None] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        node_id = dict(attrs).get("id")
        parent_id = next((item for item in reversed(self.stack) if item), None)
        if node_id:
            self.parents[node_id] = parent_id
        if tag not in self.VOID_ELEMENTS:
            self.stack.append(node_id)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        return

    def handle_endtag(self, tag: str) -> None:
        if self.stack:
            self.stack.pop()


class V15StaticContracts(unittest.TestCase):
    def test_header_tabs_menu_and_usage_controls_are_real_dom_controls(self) -> None:
        html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        desktop_main = (ROOT / "desktop" / "main.js").read_text(encoding="utf-8")
        design = (ROOT / "DESIGN.md").read_text(encoding="utf-8")

        parser = _DomParentParser()
        parser.feed(html)

        self.assertIn('id="agent-session-header"', html)
        self.assertIn('id="session-title-button"', html)
        self.assertIn('id="session-header-menu-button"', html)
        self.assertIn('id="workdir-display"', html)
        self.assertEqual(html.count('class="view-tab-icon"'), 2)
        self.assertIn("<span>Chat</span>", html)
        self.assertIn("<span>Agent</span>", html)
        self.assertEqual(parser.parents["workspace-mode-bar"], "app")
        self.assertEqual(parser.parents["workspace-mode-tabs-slot"], "workspace-mode-bar")
        self.assertEqual(parser.parents["view-tabs"], "workspace-mode-tabs-slot")
        self.assertEqual(parser.parents["agent-session-header"], "workspace-mode-bar")
        self.assertNotEqual(parser.parents["agent-session-header"], "topbar")
        self.assertNotEqual(parser.parents["view-tabs"], "sidebar")
        for action in ("pin", "unread", "rename", "project", "delete"):
            self.assertIn(f'data-session-action="{action}"', html)
        self.assertGreaterEqual(html.count('class="session-menu-icon"'), 5)
        for shortcut in ("P", "U", "R", "D"):
            self.assertIn(f'data-menu-key="{shortcut}"', html)

        self.assertIn("openSessionProjectMapping", app)
        self.assertIn("await switchSession(targetId", app)
        self.assertIn("changeWorkdir();", app)
        self.assertIn("renderSessionHeader", app)
        self.assertIn("shortenPath(fullPath)", app)
        self.assertNotIn('const home = "C:/Users/13968"', app)
        self.assertIn("/home\\/[^/]+", app)
        self.assertIn("selectDailyUsageRange", app)
        self.assertIn("/api/usage/daily?days=" + "$" + "{requestedDays}", app)
        self.assertIn("claude-code-stream-json-local", app)
        self.assertIn("不是官网账户额度", app)
        self.assertNotIn("daily-usage-bar-track", app)
        self.assertNotIn("daily-usage-bar", app)
        self.assertIn("minWidth: 900", desktop_main)
        self.assertIn("32px 窗口级可拖拽区", design)
        self.assertIn("五按钮全局顶栏中央永久留白", design)
        self.assertIn("第二行 `workspace-mode-bar`", design)
        self.assertIn("Agent 空态不复用 Chat 的欢迎标题或快捷胶囊", design)
        self.assertNotIn("renderer 顶部 44–48px", design)
        self.assertNotIn("顶栏中央可显示当前会话标题", design)
        self.assertNotIn("欢迎标题使用“今天想完成什么？”", design)

    def test_permission_fallback_copy_and_real_ids_match_latest_reference(self) -> None:
        app = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        expected = [
            ("default", "询问权限", "Claude 在需要权限时暂停并询问"),
            ("acceptEdits", "自动接受编辑", "自动允许文件编辑，其他高风险操作仍会询问"),
            ("plan", "计划模式", "先规划，减少直接执行动作"),
        ]
        positions = []
        for mode_id, label, description in expected:
            marker = f'id: "{mode_id}"'
            self.assertIn(marker, app)
            self.assertIn(f'label: "{label}"', app)
            self.assertIn(f'description: "{description}"', app)
            positions.append(app.index(marker))
        self.assertEqual(positions, sorted(positions))
        self.assertIn('const visible = new Set(["default", "acceptEdits", "plan", "auto", "bypassPermissions", "dontAsk"])', app)
        self.assertIn("permission_mode: permissionMode", app)


class V15RendererHarness(unittest.TestCase):
    maxDiff = None

    def run_harness(self, viewport: str) -> dict:
        electron = ROOT / "desktop" / "node_modules" / "electron" / "dist" / "electron.exe"
        self.assertTrue(electron.exists(), "Electron test runtime is missing")
        result = subprocess.run(
            [str(electron), str(ROOT / "tests" / "v15_renderer_harness.js"), viewport],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=35,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertNotIn("__harnessError", payload, payload.get("__harnessError"))
        return payload

    def assert_main_contracts(self, payload: dict) -> None:
        usage = payload["initialUsage"]
        self.assertEqual(usage["status"], "ready")
        self.assertEqual(usage["actualCells"], 30)
        self.assertGreaterEqual(usage["deepestCells"], 1)
        self.assertFalse(usage["hasBar"])
        self.assertTrue(usage["exactTitle"])
        self.assertIn("本机 Claude Code stream-json", usage["sourceText"])
        self.assertIn("不是官网账户额度", usage["sourceText"])
        self.assertIn("活跃天数2", usage["activeDaysText"].replace(" ", ""))
        self.assertEqual(usage["intensities"], [0, 1, 3, 4])
        self.assertEqual(usage["range30Pressed"], "true")

        self.assertEqual(payload["rangeUsage"], {
            "range7Pressed": "true",
            "actualCells": 7,
            "requested7": True,
        })
        self.assertIn("尚未记录", payload["zeroUsage"]["guidance"])
        self.assertEqual(payload["zeroUsage"]["zeroCells"], 30)
        self.assertIn("暂不可用", payload["errorUsage"])
        self.assertIn("不会用估算值", payload["errorUsage"])

        header = payload["headerBefore"]
        self.assertFalse(header["hidden"])
        self.assertEqual(header["title"], "会话 Alpha")
        self.assertTrue(header["path"].startswith("..."))
        self.assertEqual(header["pathDisplay"], "block")
        self.assertEqual(
            header["fullPathTitle"],
            "D:/Viniper/projects/alpha/very-long-working-directory/with-a-complete-readable-path",
        )
        self.assertIn(header["fullPathTitle"], header["fullPathAria"])
        self.assertEqual(payload["pathShortening"], {
            "windows": "~/work/project",
            "wsl": "~/work/project",
            "other": "D:/shared/work/project",
        })
        self.assertEqual(payload["renameClick"], {
            "inlineOpen": True,
            "inputRole": "textbox",
            "inputValue": "会话 Alpha",
            "selected": True,
            "putCallsBeforeConfirm": 0,
        })

        menu = payload["headerMenu"]
        self.assertTrue(menu["open"])
        self.assertEqual(menu["target"], "A")
        self.assertEqual(menu["expanded"], "true")
        self.assertEqual(menu["projectLabel"], "添加到项目")
        self.assertEqual(menu["icons"], 5)
        self.assertEqual(menu["shortcuts"], ["P", "U", "R", "›", "D"])
        self.assertEqual(payload["sidebarMenu"], {
            "open": True,
            "sameElement": True,
            "target": "A",
        })
        self.assertEqual(payload["headerMenuAfterSessionRender"], {
            "open": True,
            "target": "A",
            "expanded": "true",
        })
        self.assertEqual(payload["projectMapping"], {
            "sessionId": "B",
            "modalOpen": True,
            "inputValue": "D:/Viniper/projects/beta",
            "savedWorkdir": "D:/Viniper/projects/beta/mapped-project",
            "currentWorkdir": "D:/Viniper/projects/beta/mapped-project",
        })
        self.assertEqual(payload["menuActions"]["pin"], {
            "currentSessionId": "A",
            "targetPinned": True,
            "currentPinned": False,
        })
        self.assertEqual(payload["menuActions"]["unread"], {
            "currentSessionId": "A",
            "targetUnread": True,
            "currentUnread": False,
        })
        self.assertEqual(payload["menuActions"]["rename"], {
            "currentSessionId": "A",
            "targetName": "会话 Beta 已重命名",
            "currentName": "会话 Alpha",
        })
        self.assertEqual(payload["menuActions"]["delete"], {
            "currentSessionId": "A",
            "targetExists": False,
            "currentExists": True,
        })
        self.assertEqual(payload["menuActions"]["putTargets"], [
            {"url": "/api/sessions/B", "body": {"pinned": True}},
            {"url": "/api/sessions/B", "body": {"unread": True}},
            {"url": "/api/sessions/B", "body": {"name": "会话 Beta 已重命名"}},
            {"url": "/api/sessions/B", "body": {"workdir": "D:/Viniper/projects/beta/mapped-project"}},
            {"url": "/api/sessions/B", "body": {"permission_mode": "plan"}},
        ])
        self.assertEqual(payload["menuActions"]["deleteTargets"], ["/api/sessions/B"])

        self.assertEqual(
            payload["permissionOptions"],
            [
                {
                    "id": "default",
                    "label": "询问权限",
                    "description": "Claude 在需要权限时暂停并询问",
                    "title": "询问权限：Claude 在需要权限时暂停并询问",
                },
                {
                    "id": "acceptEdits",
                    "label": "自动接受编辑",
                    "description": "自动允许文件编辑，其他高风险操作仍会询问",
                    "title": "自动接受编辑：自动允许文件编辑，其他高风险操作仍会询问",
                },
                {
                    "id": "plan",
                    "label": "计划模式",
                    "description": "先规划，减少直接执行动作",
                    "title": "计划模式：先规划，减少直接执行动作",
                },
                {
                    "id": "auto",
                    "label": "自动模式",
                    "description": "请先满足 Claude Code 自动模式的设置与运行时能力",
                    "title": "自动模式：请先满足 Claude Code 自动模式的设置与运行时能力",
                },
                {
                    "id": "bypassPermissions",
                    "label": "跳过权限",
                    "description": "请先在设置中明确启用跳过权限",
                    "title": "跳过权限：请先在设置中明确启用跳过权限",
                },
                {
                    "id": "dontAsk",
                    "label": "不询问",
                    "description": "CLI 模式：未预批准的工具会被自动拒绝",
                    "title": "不询问：CLI 模式：未预批准的工具会被自动拒绝",
                },
            ],
        )
        agent_body = payload["requests"]["agent"]
        self.assertEqual(agent_body["message"], "计划任务")
        self.assertEqual(agent_body["permission_mode"], "plan")
        self.assertEqual(agent_body["attachments"], [])
        self.assertEqual(payload["requests"]["chat"], {"message": "普通消息", "model": "fake"})
        self.assertEqual(payload["chatHeader"], {"hidden": True, "bodyMode": "chat"})
        self.assertEqual(payload["tabs"], {
            "chatIcon": True,
            "agentIcon": True,
            "labels": ["Chat", "Agent"],
        })
        surface = payload["surfaceGeometry"]
        self.assertEqual(surface["headerParent"], "workspace-mode-bar")
        self.assertEqual(surface["tabsParent"], "workspace-mode-tabs-slot")
        self.assertFalse(surface["topbarContainsHeader"])
        self.assertFalse(surface["sidebarContainsTabs"])
        self.assertTrue(surface["sameHorizontalBand"])
        self.assertTrue(surface["headerAfterTabs"])
        self.assertLessEqual(surface["bandCenterDelta"], 1)
        self.assertLessEqual(surface["mainTopDelta"], 1)
        self.assertLessEqual(surface["sidebarTopDelta"], 1)
        self.assertFalse(surface["headerOverflowsViewport"])
        self.assertEqual(payload["pathShortening"], {
            "windows": "~/work/project",
            "wsl": "~/work/project",
            "other": "D:/shared/work/project",
        })

    def test_renderer_closes_all_six_frontend_flows_at_900_by_700(self) -> None:
        payload = self.run_harness("900x700")
        self.assert_main_contracts(payload)
        self.assertEqual(payload["geometry"]["width"], 900)
        self.assertEqual(payload["geometry"]["height"], 700)
        self.assertFalse(payload["geometry"]["horizontalOverflow"])

    def test_renderer_remains_usable_at_1280_by_800(self) -> None:
        payload = self.run_harness("1280x800")
        self.assert_main_contracts(payload)
        self.assertEqual(payload["geometry"]["width"], 1280)
        self.assertEqual(payload["geometry"]["height"], 800)
        self.assertFalse(payload["geometry"]["horizontalOverflow"])


if __name__ == "__main__":
    unittest.main()
