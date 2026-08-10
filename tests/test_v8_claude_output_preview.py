"""Contracts for the v8 Claude-like output stream and zero-height empty layers."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

import server


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
CSS = (ROOT / "static" / "style.css").read_text(encoding="utf-8")
SERVER = (ROOT / "server.py").read_text(encoding="utf-8")


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


class V8ClaudeOutputPreviewTests(unittest.TestCase):
    def test_topbar_sidebar_and_agent_footer_match_new_contract(self) -> None:
        self.assertNotIn('class="topbar-title-group topbar-spacer"', HTML)
        self.assertIn('id="agent-session-header"', HTML)
        self.assertIn('id="session-title"', HTML)
        self.assertIn('id="workdir-display"', HTML)
        self.assertIn('class="composer-tools-left"', HTML)
        self.assertIn('class="composer-tools-right"', HTML)
        final = CSS[CSS.rfind("/* v8 Claude output and composer contract") :]
        self.assertIn("#sidebar::after", final)
        self.assertIn("display: none; content: none", final)
        self.assertIn(".view-tabs { margin: 10px 12px 8px; }", final)
        self.assertIn("#input-actions .composer-tools-right { margin-left: auto; }", final)
        v15 = CSS[CSS.rfind("/* v15: Claude Code-aligned session chrome") :]
        self.assertIn('body[data-view-mode="chat"] #agent-session-header', v15)
        self.assertIn('body[data-view-mode="agent"] #agent-session-header:not(.hidden)', v15)

    def test_empty_layers_are_explicitly_hidden_and_attachment_state_reopens(self) -> None:
        script = r'''
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync("static/app.js", "utf8") + "\nthis.__api = __VINIPER_TEST_API__;";
const values = new Set(["hidden"]);
const contextFiles = {
  innerHTML: "",
  classList: {
    toggle(name, force) { if (force) values.add(name); else values.delete(name); },
    contains(name) { return values.has(name); }
  },
  setAttribute(name, value) { this[name] = value; }
};
const document = {
  addEventListener() {}, querySelector(selector) { return selector === "#context-files" ? contextFiles : null; },
  querySelectorAll() { return []; }, documentElement: {dataset:{},style:{setProperty(){}}}, body:{classList:{toggle(){}},dataset:{}}
};
const context = {console,TextDecoder,TextEncoder,WeakMap,document,performance:{now:()=>0},localStorage:{getItem:()=>null,setItem(){}},window:{VINIPER_APP_TITLE:"Viniper Preview",matchMedia:()=>({matches:false})},requestAnimationFrame:(fn)=>fn(),setTimeout,clearTimeout,setInterval,clearInterval};
vm.createContext(context); vm.runInContext(source, context);
context.__api.state.contextFiles = [];
context.__api.renderContextFiles();
const empty = {hidden:values.has("hidden"), html:contextFiles.innerHTML, aria:contextFiles["aria-hidden"]};
context.__api.state.contextFiles = [{name:"参考.png",size:12,type:"text/plain"}];
context.__api.renderContextFiles();
const attached = {hidden:values.has("hidden"), hasName:contextFiles.innerHTML.includes("参考.png"), aria:contextFiles["aria-hidden"]};
process.stdout.write(JSON.stringify({empty,attached}));
'''
        payload = run_node(script)
        self.assertEqual(payload["empty"], {"hidden": True, "html": "", "aria": "true"})
        self.assertEqual(payload["attached"], {"hidden": False, "hasName": True, "aria": "false"})
        final = CSS[CSS.rfind("/* v8 Claude output and composer contract") :]
        self.assertIn("#context-files.hidden", final)
        self.assertIn("#slash-suggestions.hidden", final)

    def test_legacy_cache_paths_are_removed_without_auto_file_cards(self) -> None:
        script = r'''
const fs = require("fs"); const vm = require("vm");
const source = fs.readFileSync("static/app.js", "utf8") + "\nthis.__api = __VINIPER_TEST_API__;";
const document={addEventListener(){},querySelector(){return null;},querySelectorAll(){return[];},documentElement:{dataset:{},style:{setProperty(){}}},body:{classList:{toggle(){}},dataset:{}}};
const context={console,TextDecoder,TextEncoder,WeakMap,document,performance:{now:()=>0},localStorage:{getItem:()=>null,setItem(){}},window:{VINIPER_APP_TITLE:"Viniper Preview",matchMedia:()=>({matches:false})},setTimeout,clearTimeout,setInterval,clearInterval};
vm.createContext(context); vm.runInContext(source, context);
const legacy="正常回答\n\n修改的文件：\nD:\\work\\Cache_Data\\data_0\nD:\\work\\sessions.js";
const normal="请查看 D:\\work\\README.md";
process.stdout.write(JSON.stringify({legacy:context.__api.renderAssistantContentHtml(legacy),normal:context.__api.renderAssistantContentHtml(normal)}));
'''
        payload = run_node(script)
        self.assertIn("正常回答", payload["legacy"])
        self.assertNotIn("Cache_Data", payload["legacy"])
        self.assertNotIn("artifact-card", payload["normal"])
        self.assertIn("README.md", payload["normal"])

    def test_real_thinking_and_structured_artifacts_replace_synthetic_output(self) -> None:
        self.assertNotIn("正在通过 Claude Code 分析请求", SERVER)
        self.assertNotIn("正在通过 {active_shell_label", SERVER)
        self.assertNotIn("changed_files_summary", SERVER)
        self.assertIn('{"type": "artifact", "path": path, "name": Path(path).name, "status": "success"}', SERVER)
        self.assertNotIn('renderArtifactCards(value)', APP)
        self.assertNotIn('alert(`打开文件失败', APP)
        self.assertIn('status.textContent = "文件已不存在"', APP)

    def test_file_watcher_ignores_codex_residue_and_desktop(self) -> None:
        with tempfile.TemporaryDirectory(dir=ROOT / "codex" / "运行残留") as raw:
            workdir = Path(raw)
            (workdir / "project.txt").write_text("before", encoding="utf-8")
            residue = workdir / "codex" / "运行残留"
            residue.mkdir(parents=True)
            (residue / "data_0").write_text("before", encoding="utf-8")
            roots = server.file_change_watch_roots(workdir)
            before = server.snapshot_watch_files(roots)
            (workdir / "project.txt").write_text("after", encoding="utf-8")
            (residue / "data_0").write_text("after", encoding="utf-8")
            changed = server.changed_watch_files(before, roots)
        self.assertEqual(roots, [workdir.resolve()])
        self.assertEqual([Path(item).name for item in changed], ["project.txt"])


if __name__ == "__main__":
    unittest.main()
