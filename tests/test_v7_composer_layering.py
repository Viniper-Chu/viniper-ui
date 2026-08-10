"""DOM and mode contracts for the v7 Claude Code composer layering."""

from __future__ import annotations

import json
import subprocess
import unittest
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
CSS = (ROOT / "static" / "style.css").read_text(encoding="utf-8")


class DomTree(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parent: dict[str, str | None] = {}
        self.classes: dict[str, set[str]] = {}
        self.stack: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        element_id = values.get("id")
        token = element_id or f"@{tag}:{values.get('class') or ''}"
        self.parent[token] = self.stack[-1] if self.stack else None
        if element_id:
            self.classes[element_id] = set((values.get("class") or "").split())
        if tag not in {"input", "img", "br", "hr", "meta", "link"}:
            self.stack.append(token)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        return

    def handle_endtag(self, tag: str) -> None:
        if self.stack:
            self.stack.pop()

    def ancestors(self, element_id: str) -> list[str]:
        result: list[str] = []
        current = self.parent.get(element_id)
        while current:
            result.append(current)
            current = self.parent.get(current)
        return result


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


class V7ComposerLayeringTests(unittest.TestCase):
    def test_dom_moves_non_send_controls_below_bordered_composer(self) -> None:
        parser = DomTree()
        parser.feed(HTML)
        self.assertIn("composer", parser.parent)
        self.assertIn("input-actions", parser.parent)
        self.assertIn("@div:composer-stack", parser.ancestors("input-actions"))
        self.assertNotIn("composer", parser.ancestors("input-actions"))

        for element_id in ("user-input", "slash-suggestions", "submit-actions", "send-btn", "stop-btn"):
            self.assertIn("composer", parser.ancestors(element_id), element_id)
        for element_id in ("model-select", "permission-select", "context-meter", "file-btn", "file-input", "plus-menu"):
            self.assertIn("input-actions", parser.ancestors(element_id), element_id)
            self.assertNotIn("composer", parser.ancestors(element_id), element_id)

        final_layer = CSS[CSS.rfind("/* v7 Claude Code composer layering") :]
        self.assertIn("#input-actions.composer-tools-row", final_layer)
        self.assertIn('#composer[data-surface="agent-composer"] + #input-actions', final_layer)
        self.assertIn('#composer[data-surface="chat-composer"] + #input-actions', final_layer)
        self.assertIn("#composer[data-surface=\"agent-composer\"] #submit-actions", final_layer)
        self.assertIn("#context-files:empty", final_layer)
        mode_block = APP[APP.find("function updateModeChrome"):APP.find("function toggleSidebar")]
        self.assertIn('node.id === "slash-suggestions"', mode_block)
        self.assertIn('node.matches?.("[data-peer-picker]")', mode_block)
        self.assertIn("hideSlashSuggestions();", mode_block)
        self.assertIn("renderPeerMenu();", mode_block)

    def test_set_view_mode_keeps_surfaces_and_toggles_agent_only_controls(self) -> None:
        script = r'''
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync("static/app.js", "utf8") +
  "\nthis.__api = __VINIPER_TEST_API__;";
const makeClassList = () => {
  const values = new Set();
  return {
    add(...items) { items.forEach(item => values.add(item)); },
    remove(...items) { items.forEach(item => values.delete(item)); },
    toggle(item, force) {
      if (force === undefined) { if (values.has(item)) values.delete(item); else values.add(item); }
      else if (force) values.add(item); else values.delete(item);
      return values.has(item);
    },
    contains(item) { return values.has(item); }
  };
};
const makeNode = (id) => ({
  id, dataset: {}, value: "", textContent: "", innerHTML: "",
  classList: makeClassList(),
  setAttribute() {}, removeAttribute() {},
  closest() { return null; }
});
const nodes = {};
const ids = ["#context-files", "#slash-suggestions", "#plus-menu", "#composer", "#main", "#chat-container", "#user-input", "#new-session-nav-label", "#new-session-title", "#new-chat-btn", "#drop-overlay", ".composer-hint"];
ids.forEach(id => { nodes[id] = makeNode(id); });
nodes["#composer"].dataset.surface = "chat-composer";
const agentOnly = ["#permission-select", "#context-meter", "#file-btn", "#slash-suggestions", "#drop-overlay"].map(makeNode);
nodes["#slash-suggestions"] = agentOnly[3];
nodes["#drop-overlay"] = agentOnly[4];
nodes["#model-select"] = makeNode("#model-select");
nodes["#permission-select"] = agentOnly[0];
nodes["#model-select"].value = "fake-model";
nodes["#permission-select"].value = "ask";
nodes["#user-input"].value = "";
nodes["#slash-suggestions"].classList.add("hidden");
const document = {
  activeElement: null,
  addEventListener() {},
  querySelector(selector) { return nodes[selector] || null; },
  querySelectorAll(selector) { return selector === ".agent-only" ? agentOnly : []; },
  documentElement: { dataset: {}, style: { setProperty() {} } },
  body: { dataset: {}, classList: makeClassList() }
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
context.__api.state.messages = [{role:"user", content:"fixture"}];
context.__api.state.contextFiles = [];
context.__api.setViewMode("agent");
const agent = {
  mode: document.body.dataset.viewMode,
  surface: nodes["#composer"].dataset.surface,
  agentOnlyVisible: agentOnly.filter(node => !node.classList.contains("hidden")).length,
  modelValue: nodes["#model-select"].value,
  permissionValue: nodes["#permission-select"].value
};
nodes["#user-input"].value = "/";
document.activeElement = nodes["#user-input"];
context.__api.updateSlashSuggestions();
const slashOpen = {
  hidden: nodes["#slash-suggestions"].classList.contains("hidden"),
  rendered: nodes["#slash-suggestions"].innerHTML.length > 0
};
context.__api.hideSlashSuggestions();
const slashClosed = nodes["#slash-suggestions"].classList.contains("hidden");
context.__api.setViewMode("chat");
const chat = {
  mode: document.body.dataset.viewMode,
  surface: nodes["#composer"].dataset.surface,
  agentOnlyVisible: agentOnly.filter(node => !node.classList.contains("hidden")).length,
  slashHidden: nodes["#slash-suggestions"].classList.contains("hidden"),
  modelValue: nodes["#model-select"].value,
  permissionValue: nodes["#permission-select"].value,
  inputPlaceholder: nodes["#user-input"].placeholder || nodes["#user-input"].getAttribute?.("placeholder") || ""
};
process.stdout.write(JSON.stringify({agent, slashOpen, slashClosed, chat}));
'''
        payload = run_node(script)
        self.assertEqual(payload["agent"], {"mode": "agent", "surface": "agent-composer", "agentOnlyVisible": 4, "modelValue": "fake-model", "permissionValue": "ask"})
        self.assertEqual(payload["slashOpen"], {"hidden": False, "rendered": True})
        self.assertTrue(payload["slashClosed"])
        self.assertEqual(payload["chat"]["mode"], "chat")
        self.assertEqual(payload["chat"]["surface"], "chat-composer")
        self.assertEqual(payload["chat"]["agentOnlyVisible"], 0)
        self.assertTrue(payload["chat"]["slashHidden"])
        self.assertEqual(payload["chat"]["modelValue"], "fake-model")
        self.assertEqual(payload["chat"]["permissionValue"], "ask")


if __name__ == "__main__":
    unittest.main()
