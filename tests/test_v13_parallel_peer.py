"""v13 native peer and renderer session-isolation regressions."""

from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

from agent_runtime import WslAgentRuntime
from native_peer import ClaudeCrossSessionAdapter, evaluate_peer_capability


ROOT = Path(__file__).resolve().parents[1]


class AgentViewBoundaryTests(unittest.TestCase):
    def test_agent_view_schema_is_lifecycle_only_and_not_peer_evidence(self) -> None:
        payload = json.dumps([
            {
                "id": "background-1",
                "state": "running",
                "cwd": "/mnt/d/work",
                "kind": "background",
                "startedAt": "2026-08-09T00:00:00Z",
            }
        ])

        def fake_run(command):
            return subprocess.CompletedProcess(command, 0, stdout=payload, stderr="")

        runtime = WslAgentRuntime(command_runner=fake_run)
        rows = runtime.list_agent_view_sessions()
        self.assertEqual(rows[0]["id"], "background-1")
        self.assertEqual(rows[0]["state"], "running")
        self.assertNotIn("sessionId", rows[0])

        capability = evaluate_peer_capability(
            "2.1.226 (Claude Code)",
            {"tools": ["SendMessage"], "slash_commands": ["agents"]},
            registry_supported=True,
        )
        self.assertFalse(capability.available)
        self.assertFalse(capability.agent_registry)
        self.assertEqual(capability.discovery, "unavailable")

        slash_only = evaluate_peer_capability(
            "2.1.226 (Claude Code)",
            {"tools": ["SendMessage"], "slash_commands": ["list-agents"]},
            registry_supported=True,
        )
        self.assertFalse(slash_only.available)

    def test_only_explicit_list_agents_and_send_message_surface_enables_peer_gate(self) -> None:
        capability = evaluate_peer_capability(
            "2.1.226 (Claude Code)",
            {"tools": ["Read", "ListAgents", "SendMessage"], "slash_commands": ["agents"]},
            registry_supported=False,
        )
        self.assertTrue(capability.available)
        self.assertTrue(capability.list_agents_tool)
        self.assertTrue(capability.send_message)
        self.assertEqual(capability.discovery, "ListAgents")


class NativeSendResultTests(unittest.TestCase):
    @staticmethod
    def _start(peer: ClaudeCrossSessionAdapter, tool_id: str) -> None:
        result = peer.observe_event("sender", {
            "type": "assistant",
            "message": {"content": [{
                "type": "tool_use",
                "id": tool_id,
                "name": "SendMessage",
                "input": {"to": "target-ref", "message": "继续检查"},
            }]},
        })
        assert result and result[0]["status"] == "sending"

    def test_send_message_requires_explicit_success_and_understands_nested_cli_result(self) -> None:
        peer = ClaudeCrossSessionAdapter()

        self._start(peer, "unknown")
        unknown = peer.observe_event("sender", {
            "type": "user",
            "message": {"content": [{
                "type": "tool_result",
                "tool_use_id": "unknown",
                "content": json.dumps({"message": "completed without delivery enum"}),
            }]},
        })
        self.assertEqual(unknown[0]["status"], "failed")

        self._start(peer, "success")
        delivered = peer.observe_event("sender", {
            "type": "user",
            "message": {"content": [{
                "type": "tool_result",
                "tool_use_id": "success",
                "content": json.dumps({"data": {"success": True, "message": "sent", "msg_id": "m1"}}),
            }]},
        })
        self.assertEqual(delivered[0]["status"], "delivered")

        self._start(peer, "failure")
        failed = peer.observe_event("sender", {
            "type": "user",
            "message": {"content": [{
                "type": "tool_result",
                "tool_use_id": "failure",
                "content": {"data": {"success": False, "message": "target unavailable"}},
            }]},
        })
        self.assertEqual(failed[0]["status"], "failed")

    def test_targets_require_current_sender_list_agents_roster_and_viniper_intersection(self) -> None:
        peer = ClaudeCrossSessionAdapter()
        peer.observe_init(
            "sender", "2.1.226",
            {"tools": ["ListAgents", "SendMessage"], "slash_commands": []},
            registry_supported=False,
        )
        runs = {
            "sender": {"claude_session_id": "claude-sender", "peer_name": "sender-ref", "display_name": "发送方"},
            "target": {"claude_session_id": "claude-target", "peer_name": "target-ref", "display_name": "目标"},
            "not-listed": {"claude_session_id": "claude-other", "peer_name": "other-ref", "display_name": "未列出"},
        }
        self.assertEqual(peer.reachable_targets("sender", runs, current_session_id="sender"), [])

        peer.observe_event("sender", {
            "type": "assistant",
            "message": {"content": [{"type": "tool_use", "id": "list-1", "name": "ListAgents", "input": {}}]},
        })
        peer.observe_event("sender", {
            "type": "user",
            "message": {"content": [{
                "type": "tool_result", "tool_use_id": "list-1",
                "content": {"listing": "Peer sessions (2):\ntarget-ref [live] · /workspace · interactive\nforeign-ref · /tmp · interactive"},
            }]},
        })
        targets = peer.reachable_targets("sender", runs, current_session_id="sender")
        self.assertTrue(peer.roster_observed("sender"))
        self.assertEqual([item["session_id"] for item in targets], ["target"])


class RendererRunStateTests(unittest.TestCase):
    def test_same_workdir_parallelism_warns_without_claiming_isolation(self) -> None:
        source = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        script = r'''
const fs=require("fs"),vm=require("vm");
const source=fs.readFileSync("static/app.js","utf8")+"\nthis.__api={parallelWorkdirConflict};";
const document={documentElement:{dataset:{}},body:{classList:{toggle(){}}},addEventListener(){},querySelector(){return null;},querySelectorAll(){return[];}};
const context={console,TextDecoder,TextEncoder,WeakMap,document,performance:{now:()=>0},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},window:{VINIPER_APP_TITLE:"Viniper Preview",matchMedia:()=>({matches:false}),addEventListener(){}},setTimeout,clearTimeout,setInterval,clearInterval,requestAnimationFrame:(fn)=>fn(),URL:{createObjectURL:()=>"",revokeObjectURL(){}},File,fetch:async()=>({ok:true,json:async()=>({})}),alert(){}};
vm.createContext(context);vm.runInContext(source,context);
const rows=[{id:"A",mode:"agent",workdir:"D:\\repo",runtime_state:"running",name:"A"},{id:"B",mode:"agent",workdir:"d:/repo/",runtime_state:"idle",name:"B"},{id:"C",mode:"agent",workdir:"D:/other",runtime_state:"running",name:"C"}];
process.stdout.write(JSON.stringify({same:context.__api.parallelWorkdirConflict("B","D:/repo",rows)?.id||null,other:context.__api.parallelWorkdirConflict("B","D:/else",rows)}));
'''
        result = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {"same": "A", "other": None})
        self.assertNotIn("worktree", source.lower())

    def test_background_events_rebuild_current_dom_without_detached_node_writes(self) -> None:
        script = r'''
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync("static/app.js", "utf8") +
  "\nthis.__api = {state, SessionRunRegistry, SessionTransportRegistry, createStreamRenderer, renderSessionRun};";
const classList = () => ({
  values: new Set(), add(name) { this.values.add(name); }, remove(name) { this.values.delete(name); },
  contains(name) { return this.values.has(name); },
  toggle(name, force) { if (force === undefined ? !this.values.has(name) : force) this.values.add(name); else this.values.delete(name); }
});
function makeArticle(sessionId) {
  const content = {innerHTML: "", querySelector() { return null; }, querySelectorAll() { return []; }};
  return {
    dataset: {runSessionId: sessionId}, isConnected: true, classList: classList(), content,
    querySelector(selector) { return selector === ".msg-content" ? content : null; },
    querySelectorAll() { return []; }
  };
}
let articles = [];
const document = {
  documentElement: {dataset: {}}, body: {classList: classList()}, activeElement: null,
  addEventListener() {},
  querySelector(selector) { return null; },
  querySelectorAll(selector) { return selector === "[data-run-session-id]" ? articles : []; },
  createElement() { return {className: "", textContent: "", remove() {}}; }
};
const context = {
  console, TextDecoder, TextEncoder, WeakMap, document,
  performance: {now: (() => { let value = 0; return () => ++value; })()},
  localStorage: {getItem: () => null, setItem() {}, removeItem() {}},
  window: {VINIPER_APP_TITLE: "Viniper Preview", matchMedia: () => ({matches: false}), addEventListener() {}, setInterval, clearInterval},
  setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: (fn) => fn(),
  URL: {createObjectURL: () => "blob:test", revokeObjectURL() {}},
  File, TextDecoderStream: undefined,
  fetch: async () => ({ok: true, json: async () => ({})}), alert() {}
};
vm.createContext(context);
vm.runInContext(source, context);
const api = context.__api;
api.SessionRunRegistry.start("A", {mode: "agent"});
api.SessionRunRegistry.start("B", {mode: "agent"});
const rendererA = api.createStreamRenderer("A");
const rendererB = api.createStreamRenderer("B");

const oldA = makeArticle("A");
articles = [oldA];
api.state.sessionId = "A";
rendererA.append("text", "A1");
if (!oldA.content.innerHTML.includes("A1")) throw new Error("visible A did not render");

oldA.isConnected = false;
const currentB = makeArticle("B");
articles = [currentB];
api.state.sessionId = "B";
rendererA.append("text", "A2");
rendererB.append("text", "B1");
if (oldA.content.innerHTML.includes("A2")) throw new Error("background A wrote detached DOM");

const currentA = makeArticle("A");
articles = [currentA];
api.state.sessionId = "A";
api.renderSessionRun("A");
for (let index = 0; index < 10; index += 1) {
  api.state.sessionId = index % 2 ? "A" : "B";
  articles = [api.state.sessionId === "A" ? currentA : currentB];
  api.renderSessionRun(api.state.sessionId);
}
api.state.sessionId = "A";
articles = [currentA];
api.renderSessionRun("A");

const snapshot = api.SessionRunRegistry.snapshot("A");
const serialized = JSON.stringify(snapshot);
if (!currentA.content.innerHTML.includes("A1") || !currentA.content.innerHTML.includes("A2")) throw new Error("A state was not rebuilt");
if (currentA.content.innerHTML.includes("B1")) throw new Error("B stream leaked into A");
if (/abortController|reader|isConnected|innerHTML/.test(serialized)) throw new Error("run registry retained transport or DOM state");
process.stdout.write(JSON.stringify({cursor: snapshot.cursor, segments: snapshot.segments.map((item) => item.content), old: oldA.content.innerHTML, current: currentA.content.innerHTML}));
'''
        result = subprocess.run(
            ["node", "-e", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertGreaterEqual(payload["cursor"], 2)
        self.assertEqual(payload["segments"], ["A1A2"])
        self.assertNotIn("A2", payload["old"])

    def test_frontend_cancel_and_interaction_state_are_isolated_per_session(self) -> None:
        script = r'''
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync("static/app.js", "utf8") +
  "\nthis.__api = {state, SessionRunRegistry, SessionTransportRegistry, createStreamRenderer, cancelCurrentTask};";
const classList = () => ({add() {}, remove() {}, contains() { return false; }, toggle() {}});
const document = {
  documentElement: {dataset: {}}, body: {classList: classList()}, activeElement: null,
  addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
  createElement() { return {remove() {}}; }
};
const calls = [];
const context = {
  console, TextDecoder, TextEncoder, WeakMap, AbortController, document,
  performance: {now: () => 1},
  localStorage: {getItem: () => null, setItem() {}, removeItem() {}},
  window: {VINIPER_APP_TITLE: "Viniper Preview", matchMedia: () => ({matches: false}), addEventListener() {}, setInterval: () => 0, clearInterval() {}},
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, requestAnimationFrame: (fn) => fn(),
  URL: {createObjectURL: () => "blob:test", revokeObjectURL() {}}, File, TextDecoderStream: undefined,
  fetch: async (url, options) => { calls.push([url, options?.method]); return {ok: true, json: async () => ({})}; }, alert() {}
};
vm.createContext(context);
vm.runInContext(source, context);
const api = context.__api;
const abortA = new AbortController();
const abortB = new AbortController();
api.SessionRunRegistry.start("A", {mode: "agent"});
api.SessionRunRegistry.start("B", {mode: "agent"});
api.SessionTransportRegistry.start("A", {abortController: abortA});
api.SessionTransportRegistry.start("B", {abortController: abortB});
api.createStreamRenderer("A").appendInteraction({
  type: "interaction_request", kind: "permission", request_id: "request-a", session_id: "A",
  tool_name: "Bash", allowed_actions: ["deny", "allow_once"]
});
if (api.SessionRunRegistry.get("B").pendingInteraction) throw new Error("A interaction leaked into B");
api.state.sessionId = "A";
api.SessionRunRegistry.mirror("A");
(async () => {
  await api.cancelCurrentTask();
  if (!abortA.signal.aborted || abortB.signal.aborted) throw new Error("cancel crossed session transport boundary");
  if (api.SessionRunRegistry.get("A").pendingInteraction) throw new Error("A interaction survived cancel");
  if (!api.SessionRunRegistry.get("B").active) throw new Error("B run was stopped with A");
  if (calls.length !== 1 || !calls[0][0].endsWith("/api/chat/A/cancel")) throw new Error("wrong cancel endpoint");
  process.stdout.write(JSON.stringify({aCancelled: abortA.signal.aborted, bActive: api.SessionRunRegistry.get("B").active, calls}));
})().catch((error) => { console.error(error); process.exitCode = 1; });
'''
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True, encoding="utf-8"
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["bActive"], True)

    def test_peer_picker_is_absent_until_native_gate_and_target_are_verified(self) -> None:
        script = r'''
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync("static/app.js", "utf8") + "\nthis.__api = {state, renderPeerMenu, setViewMode};";
const classList = () => ({values: new Set(), add(n) {this.values.add(n);}, remove(n) {this.values.delete(n);}, contains(n) {return this.values.has(n);}, toggle(n,f) {if(f)this.values.add(n);else this.values.delete(n);}});
const wrapper = {id:"", hidden: false, classList: classList(), attrs: {}, matches(s) {return s === "[data-peer-picker]";}, setAttribute(k,v) {this.attrs[k]=String(v);}};
const button = {disabled: false, classList: classList(), attrs: {}, setAttribute(k,v) {this.attrs[k]=String(v);}};
const label = {textContent: ""};
const menu = {classList: classList(), innerHTML: ""};
const nodes = {"[data-peer-picker]": wrapper, "#peer-picker-button": button, "#peer-picker-label": label, "#peer-menu": menu};
const document = {documentElement:{dataset:{}}, body:{dataset:{},classList:classList()}, addEventListener(){}, querySelector(s){return nodes[s]||null;}, querySelectorAll(s){return s === ".agent-only" ? [wrapper] : [];}};
const context = {console, TextDecoder, TextEncoder, WeakMap, document, performance:{now:()=>0}, localStorage:{getItem:()=>null,setItem(){},removeItem(){}}, window:{VINIPER_APP_TITLE:"Viniper Preview",matchMedia:()=>({matches:false}),addEventListener(){}}, setTimeout,clearTimeout,setInterval,clearInterval,requestAnimationFrame:(fn)=>fn(),URL:{createObjectURL:()=>"",revokeObjectURL(){}},File,fetch:async()=>({ok:true,json:async()=>({})}),alert(){}};
vm.createContext(context); vm.runInContext(source, context); const api=context.__api;
api.state.viewMode="agent"; api.state.sessionId="A";
api.state.peerCapability={available:false,verified:false,reason:"unsupported",discovery:"unavailable",targets:[]};
api.renderPeerMenu(); const hiddenBefore=wrapper.hidden;
api.setViewMode("agent"); const hiddenAfterModeSwitch=wrapper.hidden && wrapper.classList.contains("hidden");
api.state.peerCapability={available:true,verified:true,reason:"",discovery:"ListAgents",targets:[{session_id:"B",peer_name:"b-ref",display_name:"B",kind:"interactive"}]};
api.renderPeerMenu();
process.stdout.write(JSON.stringify({hiddenBefore,hiddenAfterModeSwitch,hiddenAfter:wrapper.hidden,disabled:button.disabled,aria:wrapper.attrs["aria-hidden"]}));
'''
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True, encoding="utf-8"
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {
            "hiddenBefore": True, "hiddenAfterModeSwitch": True,
            "hiddenAfter": False, "disabled": False, "aria": "false"
        })


if __name__ == "__main__":
    unittest.main()
