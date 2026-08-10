"""Behavioral contracts for the v6 continuous title band and message stream."""

from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
CSS = (ROOT / "static" / "style.css").read_text(encoding="utf-8")


def run_node(script: str) -> dict:
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    return json.loads(result.stdout)


class V6RenderingTests(unittest.TestCase):
    def test_static_v6_seams_and_mode_boundaries(self) -> None:
        self.assertNotIn('$("#session-title").textContent', APP)
        self.assertIn('const path = $("#workdir-display");', APP)
        self.assertIn('const visible = state.viewMode === "agent" && Boolean(state.sessionId);', APP)
        self.assertIn('body[data-view-mode="chat"] #agent-session-header', CSS)
        self.assertNotIn('$(".topbar-title-group")?.classList.toggle', APP)
        self.assertIn('roleClass === "system" && label', APP)
        self.assertIn('border-bottom: 0;', CSS)
        self.assertIn('background: var(--color-canvas);', CSS[CSS.rfind("/* v6 Claude message stream") :])
        self.assertIn('.message-total-time,', CSS)
        self.assertIn('.tool-summary', CSS)
        self.assertIn('.artifact-summary', CSS)
        self.assertIn('.thinking-icon', CSS)
        self.assertIn('body[data-view-mode="agent"] .message.user {\n  margin-left: auto;', CSS)
        self.assertIn('body[data-view-mode="chat"] .message.user { margin-left: auto;', CSS)

    def test_add_message_never_mutates_blank_topbar_spacer(self) -> None:
        script = r'''
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync("static/app.js", "utf8") +
  "\nthis.__api = { state, addMessage };";
const classOps = [];
const makeClassList = (id) => ({
  add() {}, remove() {},
  toggle(name, value) { if (id === ".topbar-title-group") classOps.push([name, Boolean(value)]); }
});
const nodes = {
  ".welcome": { remove() {} },
  "#chat-container": { classList: makeClassList("#chat-container") },
  ".topbar-title-group": { classList: makeClassList(".topbar-title-group") },
  "#messages": { insertAdjacentHTML() {}, querySelector() { return {}; } },
  "#workspace-rail": { classList: makeClassList("#workspace-rail"), setAttribute() {} },
  "#tool-area": { classList: makeClassList("#tool-area"), querySelector() { return null; } },
  "#artifact-area": { classList: makeClassList("#artifact-area"), querySelector() { return null; }, innerHTML: "" },
  "#messages .message:last-child .msg-content": {}
};
const document = {
  addEventListener() {},
  querySelector(selector) { return nodes[selector] || null; },
  querySelectorAll() { return []; },
  documentElement: { dataset: {}, style: { setProperty() {} } },
  body: { classList: makeClassList("body"), dataset: {} }
};
const context = {
  console, TextDecoder, TextEncoder, WeakMap, document,
  performance: { now: () => 0 },
  localStorage: { getItem: () => null, setItem() {} },
  window: { VINIPER_APP_TITLE: "Viniper Preview", matchMedia: () => ({ matches: false }) },
  requestAnimationFrame: (fn) => fn(),
  setTimeout, clearTimeout, setInterval, clearInterval
};
vm.createContext(context);
vm.runInContext(source, context);
context.__api.state.viewMode = "chat";
context.__api.addMessage("user", "Chat 文本");
context.__api.state.viewMode = "agent";
context.__api.addMessage("user", "Agent 任务");
process.stdout.write(JSON.stringify({ classOps }));
'''
        payload = run_node(script)
        self.assertEqual(payload["classOps"], [])

    def test_tool_pairing_and_flat_stream_markup(self) -> None:
        script = r'''
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync("static/app.js", "utf8") +
  "\nthis.__api = { mergeActivitySegments, renderMessageSegments };";
const document = { addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, documentElement: { dataset: {}, style: { setProperty() {} } }, body: { classList: { toggle() {} }, dataset: {} } };
const context = {
  console, TextDecoder, TextEncoder, WeakMap, document,
  performance: { now: () => 0 },
  localStorage: { getItem: () => null, setItem() {} },
  window: { VINIPER_APP_TITLE: "Viniper Preview", matchMedia: () => ({ matches: false }) },
  setTimeout, clearTimeout, setInterval, clearInterval
};
vm.createContext(context);
vm.runInContext(source, context);
const interleaved = [
  {type:"tool_start", tool_id:"A", name:"读取", status:"running"},
  {type:"tool_start", tool_id:"B", name:"搜索", status:"running"},
  {type:"tool_result", tool_id:"A", status:"完成", content:"A 完成"},
  {type:"tool_result", tool_id:"B", status:"完成", content:"B 完成"},
  {type:"artifact", path:"reports/a.md"},
  {type:"text", content:"最终回复"}
];
const noId = [
  {type:"tool_start", name:"读取", status:"running"},
  {type:"tool_result", status:"完成", content:"读取完成"},
  {type:"tool_result", status:"失败", content:"孤立结果"}
];
const merged = context.__api.mergeActivitySegments(interleaved);
const html = context.__api.renderMessageSegments([
  {type:"thinking", content:"先思考", elapsed_seconds:2, activeThinking:false},
  ...interleaved
], {totalElapsedSeconds:4});
const pendingHtml = context.__api.renderMessageSegments([
  {type:"tool_start", tool_id:"pending", name:"运行", status:"running"}
]);
process.stdout.write(JSON.stringify({
  merged: merged.map(item => ({type:item.type, id:item.tool_id ?? null, hasStart:Boolean(item.start), hasResult:Boolean(item.result)})),
  noId: context.__api.mergeActivitySegments(noId).map(item => ({type:item.type, hasStart:Boolean(item.start), hasResult:Boolean(item.result)})),
  toolSummaryCount: (html.match(/class="tool-summary tool-summary-/g) || []).length,
  activityStartCount: (html.match(/data-activity="tool_start"/g) || []).length,
  activityResultCount: (html.match(/data-activity="tool_result"/g) || []).length,
  thinkingCount: (html.match(/class="thinking-panel/g) || []).length,
  artifactCount: (html.match(/class="artifact-summary"/g) || []).length,
  pending: pendingHtml.includes('class="tool-summary tool-summary-pending"'),
  hasTotal: html.includes("message-total-time") || html.includes("完成于 4秒"),
  hasLegacyLabels: html.includes("使用工具：") || html.includes("工具结果："),
  hasFinalText: html.includes("msg-text-segment")
}));
'''
        payload = run_node(script)
        self.assertEqual(payload["merged"], [
            {"type": "tool_summary", "id": "A", "hasStart": True, "hasResult": True},
            {"type": "tool_summary", "id": "B", "hasStart": True, "hasResult": True},
            {"type": "artifact", "id": None, "hasStart": False, "hasResult": False},
            {"type": "text", "id": None, "hasStart": False, "hasResult": False},
        ])
        self.assertEqual(payload["noId"], [
            {"type": "tool_summary", "hasStart": True, "hasResult": True},
            {"type": "tool_summary", "hasStart": False, "hasResult": True},
        ])
        self.assertEqual(payload["toolSummaryCount"], 2)
        self.assertEqual(payload["activityStartCount"], 0)
        self.assertEqual(payload["activityResultCount"], 0)
        self.assertEqual(payload["thinkingCount"], 1)
        self.assertEqual(payload["artifactCount"], 1)
        self.assertTrue(payload["pending"])
        self.assertFalse(payload["hasTotal"])
        self.assertFalse(payload["hasLegacyLabels"])
        self.assertTrue(payload["hasFinalText"])

    def test_thinking_streaming_and_complete_details_state(self) -> None:
        script = r'''
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync("static/app.js", "utf8") +
  "\nthis.__api = { renderMessageSegments };";
const document = { addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, documentElement: { dataset: {}, style: { setProperty() {} } }, body: { classList: { toggle() {} }, dataset: {} } };
const context = { console, TextDecoder, TextEncoder, WeakMap, document, performance: { now: () => 0 }, localStorage: { getItem: () => null, setItem() {} }, window: { VINIPER_APP_TITLE: "Viniper Preview", matchMedia: () => ({ matches: false }) }, setTimeout, clearTimeout, setInterval, clearInterval };
vm.createContext(context);
vm.runInContext(source, context);
const streaming = context.__api.renderMessageSegments([{type:"thinking", content:"处理中", activeThinking:true, elapsed_seconds:1}], {activeThinking:true});
const complete = context.__api.renderMessageSegments([{type:"thinking", content:"已处理", activeThinking:false, elapsed_seconds:1}], {activeThinking:false});
process.stdout.write(JSON.stringify({streaming, complete}));
'''
        payload = run_node(script)
        self.assertIn('<details class="thinking-panel streaming"', payload["streaming"])
        self.assertIn(" open>", payload["streaming"])
        self.assertIn("正在思考…", payload["streaming"])
        self.assertIn('<details class="thinking-panel"', payload["complete"])
        self.assertNotIn(" open>", payload["complete"])
        self.assertIn("思考过程", payload["complete"])


if __name__ == "__main__":
    unittest.main()
