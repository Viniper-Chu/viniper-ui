import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import test from "node:test";

const ui = join(process.cwd(), "resources/viniper-ui");
const stream = require(join(ui, "static/agent-stream.js"));
const source = readFileSync(join(ui, "static/app.js"), "utf8");
function functionSource(name: string) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}
function body(text: string, step = 1) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({ start(controller) {
    for (let index = 0; index < bytes.length; index += step) controller.enqueue(bytes.slice(index, index + step));
    controller.close();
  } });
}
function python(script: string) {
  const result = spawnSync(process.platform === "win32" ? "py" : "python3", [
    ...(process.platform === "win32" ? ["-3"] : []), "-E", "-c",
    `import sys\nsys.dont_write_bytecode=True\nsys.path.insert(0, ${JSON.stringify(ui)})\n${script}`,
  ], { encoding: "utf8", timeout: 20000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("R32 one transport handles byte-split UTF8, CR/LF, multiline data, comments and final frames", async () => {
  for (const step of [1, 2, 11, 2000]) {
    const events: any[] = [];
    const input = body(': heartbeat\r\ndata:{"type":\r\ndata: "text", "content":"中文🙂"}\r\n\r\ndata: {"type":"done"}', step);
    await stream.readJsonEvents(input, (event: any) => events.push(event));
    assert.deepEqual(events, [{ type: "text", content: "中文🙂" }, { type: "done" }]);
    assert.equal(input.locked, false);
  }
});

test("R32 protocol and projection errors are not silently swallowed, and release their reader", async () => {
  for (const text of ['data: {invalid}\n\n', 'data: {"type":"text"}\n\n']) {
    const input = body(text);
    await assert.rejects(stream.readJsonEvents(input, () => { throw new Error("projection failed"); }));
    assert.equal(input.locked, false);
  }
});

test("R32 EOF cannot imply completion; authoritative state distinguishes active, terminal and replaced", async () => {
  for (const [run, kind] of [
    [{ run_id: "r", active: true, terminal: false }, "active"],
    [{ run_id: "r", active: false, terminal: true, status: "failed" }, "terminal"],
    [{ run_id: "other", active: true }, "replaced"], [null, "replaced"],
  ] as const) {
    const fetcher = async (path: string) => { assert.equal(path, "/api/runs/session%2F1"); return { ok: true, json: async () => ({ ok: true, run }) }; };
    assert.equal((await stream.confirmRunState(fetcher, "session/1", "r")).kind, kind);
  }
  await assert.rejects(stream.confirmRunState(async () => ({ ok: false, status: 503 }), "s", "r"));
});

test("R32 renderer applies every delta but batches paints per session and flushes terminal paint", () => {
  let next = 0;
  const timers = new Map<number, () => void>();
  const scheduler = stream.createRenderScheduler((callback: () => void) => { timers.set(++next, callback); return next; }, (id: number) => timers.delete(id));
  const painted: string[] = [];
  for (let i = 0; i < 1000; i++) scheduler.schedule("a", () => painted.push(`a:${i}`));
  scheduler.schedule("b", () => painted.push("b"));
  assert.equal(timers.size, 2);
  scheduler.flush("a");
  assert.deepEqual(painted, ["a:999"]);
  scheduler.cancel("b");
  assert.equal(timers.size, 0);
});

test("R32 actual send/retry/replay consumers share transport and reconnect without resending POST", async () => {
  const record: any = { sessionId: "s", active: true, runId: "" };
  const sandbox: any = {
    AgentStream: stream,
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, run: { run_id: "r", active: true, terminal: false } }) }),
    Error,
  };
  vm.createContext(sandbox);
  vm.runInContext(functionSource("consumeAgentRunResponse"), sandbox);
  const events: any[] = [];
  await assert.rejects(sandbox.consumeAgentRunResponse({ headers: { get: () => "r" }, body: body('data: {"type":"text","content":"kept"}\n\n') }, record, {}, (event: any) => events.push(event)));
  assert.equal(record.runId, "r");
  assert.equal(events[0].content, "kept");
  for (const name of ["sendMessageForSession", "doRetrySend", "resumeAgentRun"]) assert.match(functionSource(name), /consumeAgentRunResponse/);
  assert.doesNotMatch(functionSource("reconnectAgentRun"), /POST|sendMessage|doRetrySend/);
});

test("R32 stale model-usage response cannot overwrite the new selection", async () => {
  let resolve!: (value: any) => void;
  const state: any = { sessionId: "s", viewMode: "viniper", selectedModel: "old", contextUsage: { sentinel: true } };
  const sandbox: any = { state, encodeURIComponent, fetch: () => new Promise((done) => { resolve = done; }) };
  vm.createContext(sandbox);
  vm.runInContext(functionSource("refreshContextUsageForSelectedModel"), sandbox);
  const promise = sandbox.refreshContextUsageForSelectedModel();
  state.selectedModel = "new";
  resolve({ ok: true, json: async () => ({ ok: true, usage: { model: "old", used_tokens: 100 } }) });
  assert.equal(await promise, null);
  assert.deepEqual(state.contextUsage, { sentinel: true });
});

test("R32 cancelling during reconnect unlocks only its owner after backend acknowledgement", async () => {
  for (const ok of [true, false]) {
    const interaction = { request_id: "permission-1" };
    const record: any = { active: true, status: "waiting_input", pendingInteraction: interaction, waitingInput: true };
    const other = { active: true };
    const sandbox: any = {
      state: { isStreaming: true, sessionId: "s" },
      SessionRunRegistry: {get: () => record, update: (_id: string, patch: any) => Object.assign(record, patch), finish: (_id: string, status: string) => Object.assign(record, { active: false, status })},
      SessionTransportRegistry: {get: () => null},
      fetch: async () => ({ ok, status: ok ? 200 : 503 }),
      showInlineStatus() {}, syncCurrentSessionRuntimeUi() {}, encodeURIComponent,
    };
    vm.createContext(sandbox); vm.runInContext(functionSource("cancelCurrentTask"), sandbox);
    await sandbox.cancelCurrentTask();
    assert.equal(record.active, !ok);
    assert.equal(record.status, ok ? "cancelled" : "waiting_input");
    if (!ok) assert.equal(record.pendingInteraction, interaction);
    assert.equal(other.active, true);
  }
});

test("R32 packaged model migration is idempotent, preserves secrets/custom deployments and canonicalizes old Flash", () => {
  python(String.raw`
import copy
from model_catalog import *
assert capacity_provider_id({'id':'anthropic','base_url':'https://api.deepseek.com/anthropic'})=='deepseek'
assert capacity_provider_id({'id':'anthropic','base_url':'https://proxy.example/anthropic'})=='anthropic'
assert deepseek_model_options()[0]['id'] == 'deepseek-flash'
assert deepseek_model_options()[0]['label'] == 'DeepSeek V4.1 Flash'
for old in ('deepseek-v4-flash', 'deepseek-v4-flash[1m]', 'deepseek-v4-flash-vision-exp', 'deepseek-flash[1m]'):
    original={'model':old, 'base_url':'https://api.deepseek.com/anthropic/', 'secret_ref':'keep', 'api_key':'fixture-not-real', 'extra':{'unchanged':True}, 'models':[{'id':old}, {'id':'deepseek-flash'}, {'id':'custom', 'label':'Keep'}]}
    before=copy.deepcopy(original)
    result=migrate_official_deepseek_provider(original)
    assert original == before
    assert result['model']=='deepseek-flash'
    assert [i['id'] for i in result['models']]==['deepseek-flash','custom']
    assert result['secret_ref']==original['secret_ref'] and result['api_key']==original['api_key']
    assert migrate_official_deepseek_provider(result)==result
    original['base_url']='https://proxy.example/anthropic'
    assert migrate_official_deepseek_provider(original)==original
assert migrate_official_deepseek_provider({'model':'deepseek-v4-pro','base_url':'https://api.deepseek.com'})['model']=='deepseek-v4-pro'
`);
  const boundary = require(join(ui, "harness_provider_boundary.js"));
  for (const alias of ["deepseek-v4-flash", "deepseek-flash[1m]", "deepseek-v4-flash-vision-exp"]) assert.equal(boundary.normalizeProviderModel(alias), "deepseek-flash");
});

test("R33 narrow composer never hides descendant model menu or picker labels", () => {
  const css = readFileSync(join(ui,"static/style.css"),"utf8");
  assert.doesNotMatch(css,/\.anchored-control\s+span\s*\{\s*display:\s*none/u);
  assert.match(css,/\.anchored-control\s*>\s*span\s*\{\s*display:\s*none/u);
});

test("R33 bottom-right picker replaces unavailable remembered IDs with an actual current option", () => {
  const sandbox: any = {};
  vm.createContext(sandbox); vm.runInContext(functionSource("resolvePickerModel"), sandbox);
  const models = [{id:"deepseek-flash",label:"DeepSeek V4.1 Flash"}];
  for (const remembered of ["deepseek-v4-pro","deepseek-v4-flash","deepseek-v4-flash[1m]","deepseek-flash",null]) {
    assert.equal(sandbox.resolvePickerModel(models,remembered,"deepseek-v4-pro"),"deepseek-flash");
  }
  assert.equal(sandbox.resolvePickerModel([{id:"custom"},{id:"other"}],"custom","other"),"custom");
});

test("R33 bottom-right preset migrates old Pro/Flash lists without rewriting custom deployments", () => {
  python(String.raw`
import copy
from model_catalog import *
assert [item['id'] for item in deepseek_model_options()] == ['deepseek-flash']
for endpoint in OFFICIAL_DEEPSEEK_ENDPOINTS:
    for flash in ('deepseek-v4-flash', 'deepseek-v4-flash[1m]', 'deepseek-flash'):
        for selected in ('deepseek-v4-pro', flash):
            original={'base_url':endpoint,'model':selected,'secret_ref':'preserve','models':[{'id':'deepseek-v4-pro','label':'Old Pro'},{'id':flash,'label':'Old Flash'}]}
            before=copy.deepcopy(original)
            migrated=migrate_official_deepseek_provider(original)
            assert original == before
            assert migrated['model']=='deepseek-flash' and migrated['secret_ref']=='preserve'
            assert [(i['id'],i['label']) for i in migrated['models']]==[('deepseek-flash','DeepSeek V4.1 Flash')]
            assert migrate_official_deepseek_provider(migrated)==migrated
            original['base_url']='https://custom.example/anthropic'
            assert migrate_official_deepseek_provider(original)==original
custom={'base_url':'https://api.deepseek.com','model':'deepseek-v4-pro','models':[{'id':'deepseek-v4-pro'},{'id':'deepseek-flash'},{'id':'custom','label':'Keep'}]}
assert len(migrate_official_deepseek_provider(custom)['models'])==3
assert migrate_official_deepseek_provider(custom)['model']=='deepseek-v4-pro'
`);
});

test("R32 bounded backend replay reports a gap, preserves order, and survives subscriber disconnect", () => {
  python(String.raw`
import asyncio
from agent_run_coordinator import AgentRunCoordinator
async def main():
    gate=asyncio.Event()
    async def produce():
        for i in range(100): yield {'type':'text','content':str(i)}
        await gate.wait()
        yield {'type':'done'}
    coordinator=AgentRunCoordinator(max_events=64)
    record=coordinator.start('s',produce)
    await asyncio.sleep(0)
    assert len(record.events)==64 and record.events.maxlen==64
    gap=[event async for event in coordinator.subscribe('s',record.run_id,after_sequence=0)]
    assert gap[0]['type']=='replay_gap'
    stream=coordinator.subscribe('s',record.run_id,after_sequence=98)
    assert (await anext(stream))['sequence']==99
    await stream.aclose()
    assert coordinator.has_active('s')
    gate.set()
    await record.task
    replay=[event async for event in coordinator.subscribe('s',record.run_id,after_sequence=99)]
    assert [event['sequence'] for event in replay]==[100,101]
    assert coordinator.snapshot('s')['terminal'] is True
asyncio.run(main())
`);
});

test("R32 collaboration projection does not reconfigure an existing running owner", async () => {
  const bridge = readFileSync(join(ui, "harness_runtime_bridge.js"), "utf8");
  const start = bridge.indexOf("async function ensureCollaborationSessions(");
  const calls: string[] = [];
  const existing = { id: "h-running", status: "running", selectedModel: "user-choice" };
  const sandbox: any = {
    sessionMap: { sessions: { old: { harnessSessionId: existing.id } } },
    runtime: { getSession: () => existing },
    fsp: { stat: async (path: string) => path === "missing" ? null : ({isDirectory:()=>true}) },
    configureProvider: async (row: any) => { calls.push(`configure:${row.native_session_id}`); return {}; },
    ensureSession: async (row: any, _provider: any, options: any) => { assert.equal(options.setActive,false); calls.push(`ensure:${row.native_session_id}`); return {id:"h-new"}; },
  };
  vm.createContext(sandbox);
  vm.runInContext(bridge.slice(start, bridge.indexOf("\n}",start)+2),sandbox);
  const result = await sandbox.ensureCollaborationSessions([{native_session_id:"old",workdir:"obsolete managed path",model:"new default"},{native_session_id:"new"},{native_session_id:"orphan",workdir:"missing"}]);
  assert.deepEqual(calls,["configure:new","ensure:new"]);
  assert.equal(result[0].harness_session_id,existing.id);
  assert.equal(result[2].state,"unavailable");
  assert.match(result[2].reason,/历史会话仍保留/);
  assert.equal(existing.status,"running"); assert.equal(existing.selectedModel,"user-choice");
});
