import assert from "node:assert/strict";
import { test } from "node:test";
import { toolsForCurrentTurn } from "../../src/features/runs/current-turn-tools";
import { ProviderRegistry } from "../../src/features/providers/provider-registry";
import { ProviderEvent, ProviderRequest } from "../../src/core/provider-contracts";
import { createRuntimeFixture, waitFor } from "./runtime-fixture";
import { ToolRegistry } from "../../src/features/tools/tool-registry";

const tool = { name: "fixture.read", description: "read", inputSchema: { type: "object" as const }, readOnly: true, permission: "auto-read-only" as const };

test("natural read-only review hides mutations without affecting quotations or a later write phase", () => {
  const write = { ...tool, name: "file.pdf.render", readOnly: false };
  const tools = [tool, write];
  for (const text of ["只读复核最终两份PDF及其源码，不要把编译成功当成页面已检查。", "只读复核PDF，不要再渲染或保存图片。", "只读复核PDF，不要再使用渲染工具。", "请只读检查这个PDF。", "本轮只读复核PDF，只使用 file.pdf.render。", "只用 fixture.read，不要再用 file.pdf.render。"])
    assert.deepEqual(toolsForCurrentTurn(text, tools), [tool]);
  for (const text of ["解释“只读检查这个PDF”的意思。", "不要只读检查PDF，请修改。", "只读检查原稿，然后生成学生版PDF。", "只读复核PDF，之后重新渲染。", "先只读复核，然后渲染页面。", "制作讲义，可只读访问现行规范。", "只读检查代码和测试，运行原有测试。", "只读核对资料.db，用终端查询NULL。"])
    assert.deepEqual(toolsForCurrentTurn(text, tools), tools);
});

test("read-only PDF follow-up blocks a provider render call and restores it for an explicit new render turn", async () => {
  const registry = new ProviderRegistry(0, []), requests: ProviderRequest[] = [];
  const tools = new ToolRegistry(); let renders = 0;
  tools.register({ ...tool, name: "file.pdf.inspect", async execute(request) { return { toolId: request.id, text: "pages" }; } });
  tools.register({ ...tool, name: "file.pdf.render", readOnly: false, async execute(request) { renders++; return { toolId: request.id, text: "rendered" }; } });
  registry.register({ descriptor: { ...registry.get("demo").descriptor }, async *stream(request): AsyncIterable<ProviderEvent> {
    requests.push(request);
    if (request.history.at(-1)?.role === "tool") { yield { kind: "text.delta", text: "已检查" }; return; }
    yield { kind: "tool-call.completed", call: { type: "tool-call", callId: `render-${requests.length}`, name: "file.pdf.render", arguments: {}, argumentsText: "{}" } };
  } });
  const fixture = await createRuntimeFixture({ registry, toolRegistry: tools });
  try {
    const session = fixture.runtime.snapshot().sessions[0];
    await fixture.runtime.setPermissionMode(session.id, "full");
    const send = async (text: string) => {
      const receipt = await fixture.runtime.send({ sessionId: session.id, text, attachments: [], selectedModel: session.selectedModel, permissionMode: "full" });
      assert.equal(receipt.accepted, true);
      await waitFor(() => !fixture.runtime.isRunning(session.id));
    };
    await send("只读复核最终两份PDF及其源码，不要把编译成功当成页面已检查。");
    assert.equal(renders, 0);
    assert.ok(requests[0].tools.some(t => t.name === "file.pdf.inspect"));
    assert.ok(requests[0].tools.every(t => t.readOnly));
    await send("现在重新渲染该PDF页面。");
    assert.equal(renders, 1);
  } finally { await fixture.dispose(); }
});

test("current-turn tool scope distinguishes an instruction from quoted text or a later task phase", () => {
  assert.deepEqual(toolsForCurrentTurn("本轮不使用工具，只回复就绪。", [tool]), []);
  for (const text of ["解释“不使用工具”这句话。", "写入文件：\n```\n不使用工具\n```", "> 不使用工具\n这是之前的要求，现在读取。", "先不使用工具，然后使用文件工具。", "现在读取文件。"])
    assert.deepEqual(toolsForCurrentTurn(text, [tool]), [tool]);
});

test("Runtime blocks even a provider-emitted tool in a no-tool turn and restores tools next turn", async () => {
  const registry = new ProviderRegistry(0, []);
  const requests: ProviderRequest[] = [];
  let executed = 0;
  const tools = new ToolRegistry();
  tools.register({ ...tool, async execute(request) { executed += 1; return { toolId: request.id, text: "read result" }; } });
  registry.register({
    descriptor: { ...registry.get("demo").descriptor },
    async *stream(request): AsyncIterable<ProviderEvent> {
      requests.push(request);
      if (request.history.at(-1)?.role === "tool") { yield { kind: "text.delta", text: "已处理" }; return; }
      yield { kind: "tool-call.completed", call: { type: "tool-call", callId: `call-${requests.length}`, name: tool.name, arguments: {}, argumentsText: "{}" } };
    },
  });
  const fixture = await createRuntimeFixture({ registry, toolRegistry: tools });
  try {
    const session = fixture.runtime.snapshot().sessions[0];
    await fixture.runtime.setPermissionMode(session.id, "full");
    const send = async (text: string) => {
      const result = await fixture.runtime.send({ sessionId: session.id, text, attachments: [], selectedModel: session.selectedModel, permissionMode: "full" });
      assert.equal(result.accepted, true);
      await waitFor(() => !fixture.runtime.isRunning(session.id));
    };
    await send("本轮不使用工具，只回复就绪。");
    assert.equal(executed, 0);
    assert.deepEqual(requests[0].tools, []);
    assert.deepEqual(requests[0].frozenRunContext?.toolDescriptors, []);
    assert.equal(fixture.runtime.snapshot().sessions[0].providerHistory.flatMap((entry) => entry.items).some((item) => item.type === "tool-result" && item.isError), true);
    await send("现在读取文件。");
    assert.equal(executed, 1);
    assert.ok(requests.at(-1)?.tools.some((item) => item.name === tool.name));
  } finally { await fixture.dispose(); }
});

test("planning exposes read-only tools and denies a model-requested mutation even with full access", async () => {
  const registry = new ProviderRegistry(0, []), requests: ProviderRequest[] = [];
  const tools = new ToolRegistry(); let writes = 0;
  tools.register({ ...tool, async execute(request) { return { toolId: request.id, text: "read" }; } });
  tools.register({ ...tool, name: "fixture.write", readOnly: false, async execute(request) { writes++; return { toolId: request.id, text: "changed" }; } });
  registry.register({ descriptor: { ...registry.get("demo").descriptor }, async *stream(request): AsyncIterable<ProviderEvent> {
    requests.push(request);
    if (request.history.at(-1)?.role === "tool") { yield {kind:"text.delta",text:"先调研，再修改并验证。"}; return; }
    yield {kind:"tool-call.completed",call:{type:"tool-call",callId:"planning-write",name:"fixture.write",arguments:{},argumentsText:"{}"}};
  }});
  const fixture = await createRuntimeFixture({registry,toolRegistry:tools});
  try {
    const session=fixture.runtime.snapshot().sessions[0];
    await fixture.runtime.setPermissionMode(session.id,"full");
    await fixture.runtime.send({sessionId:session.id,text:"调研后制定修改方案",attachments:[],selectedModel:session.selectedModel,permissionMode:"full",planning:true});
    await waitFor(()=>!fixture.runtime.isRunning(session.id));
    assert.equal(writes,0);
    assert.ok(requests.length>=2);
    assert.ok(requests.every(r=>r.tools.every(t=>t.readOnly)));
    assert.ok(requests[0].tools.some(t=>t.name===tool.name));
    assert.ok(fixture.runtime.snapshot().sessions[0].providerHistory.flatMap(e=>e.items).some(i=>i.type==='tool-result'&&i.isError));
  } finally {await fixture.dispose();}
});

test("document tools remain available on the third follow-up without repeating the filename", async () => {
  const registry = new ProviderRegistry(0, []), requests: ProviderRequest[] = [];
  const tools = new ToolRegistry();
  tools.register({ ...tool, name: "file.sqlite.query", async execute(request) { return { toolId: request.id, text: "rows" }; } });
  registry.register({ descriptor: { ...registry.get("demo").descriptor }, async *stream(request): AsyncIterable<ProviderEvent> {
    requests.push(request);
    yield { kind: "text.delta", text: "已核对" };
  } });
  const fixture = await createRuntimeFixture({ registry, toolRegistry: tools });
  try {
    const session = fixture.runtime.snapshot().sessions[0];
    for (const text of ["查看库存.db", "继续核对这份数据库", "最后只读检查A、B库存", "本轮不使用工具，只回复就绪。"]) {
      await fixture.runtime.send({ sessionId: session.id, text, attachments: [], selectedModel: session.selectedModel, permissionMode: "auto" });
      await waitFor(() => !fixture.runtime.isRunning(session.id));
    }
    assert.equal(requests.length, 4);
    assert.ok(requests.slice(0, 3).every(request => request.tools.some(t => t.name === "file.sqlite.query")));
    assert.deepEqual(requests[3].tools, []);
  } finally { await fixture.dispose(); }
});

test("steering aborts a streaming answer immediately and resumes with the correction", async () => {
  const registry=new ProviderRegistry(0,[]), requests: ProviderRequest[]=[];
  let started=false, aborted=false;
  registry.register({descriptor:{...registry.get('demo').descriptor},async *stream(request,signal):AsyncIterable<ProviderEvent>{
    requests.push(request);
    if(requests.length===1){
      started=true;yield {kind:'text.delta',text:'正在整理初步结果。'};
      await new Promise<void>(resolve=>{ const stop=()=>{aborted=true;resolve();}; signal.aborted?stop():signal.addEventListener('abort',stop,{once:true}); });
      yield {kind:'text.delta',text:'不应出现的旧输出'};
    }
    else yield {kind:'text.delta',text:'已按补充方向修正。'};
  }});
  const fixture=await createRuntimeFixture({registry});
  try{
    const session=fixture.runtime.snapshot().sessions[0];
    await fixture.runtime.send({sessionId:session.id,text:'整理结果',attachments:[],selectedModel:session.selectedModel,permissionMode:'auto'});
    await waitFor(()=>started);
    const run=fixture.runtime.listRuns(session.id).find(r=>r.status==='running')!;
    assert.ok(run);
    const receipt=await fixture.runtime.steer(run.runId,'优先报告仍未解决的问题');
    assert.equal(receipt.status,'queued');assert.equal(aborted,true);
    await waitFor(()=>!fixture.runtime.isRunning(session.id));
    assert.equal(requests.length,2);
    const last=requests[1].history.at(-1)!;
    assert.equal(last.role,'user');
    assert.ok(last.items.some(i=>i.type==='text'&&i.text==='优先报告仍未解决的问题'));
    assert.ok(requests[1].history.flatMap(e=>e.items).some(i=>i.type==='text'&&i.text==='正在整理初步结果。'));
    assert.ok(!requests[1].history.flatMap(e=>e.items).some(i=>i.type==='text'&&i.text.includes('不应出现')));
    assert.equal(fixture.runtime.listRuns(session.id).at(-1)?.status,'completed');
  }finally{await fixture.dispose();}
});

test("steering interrupts prefill without output and discards undispatched tool calls", async () => {
  for (const prefill of [true, false]) {
    const registry = new ProviderRegistry(0, []), requests: ProviderRequest[] = [];
    const tools = new ToolRegistry(); let ready = false, writes = 0;
    tools.register({ ...tool, async execute(request) { writes++; return { toolId: request.id, text: "unexpected" }; } });
    registry.register({ descriptor: { ...registry.get("demo").descriptor }, async *stream(request, signal): AsyncIterable<ProviderEvent> {
      requests.push(request);
      if (requests.length > 1) { yield { kind: "text.delta", text: "新方向" }; return; }
      if (!prefill) yield { kind: "tool-call.completed", call: { type: "tool-call", name: tool.name, callId: "not-started", arguments: {}, argumentsText: "{}" } };
      ready = true;
      await new Promise<void>(resolve => signal.aborted ? resolve() : signal.addEventListener("abort", () => resolve(), { once: true }));
    } });
    const fixture = await createRuntimeFixture({ registry, toolRegistry: tools });
    try {
      const session = fixture.runtime.snapshot().sessions[0];
      await fixture.runtime.send({ sessionId: session.id, text: "读取内容", attachments: [], selectedModel: session.selectedModel, permissionMode: "auto" });
      await waitFor(() => ready);
      const run = fixture.runtime.listRuns(session.id).find(r => r.status === "running")!;
      await fixture.runtime.steer(run.runId, "改为只回答状态");
      await waitFor(() => !fixture.runtime.isRunning(session.id));
      assert.equal(requests.length, 2); assert.equal(writes, 0);
      assert.ok(!requests[1].history.flatMap(e => e.items).some(i => i.type === "tool-call"));
      assert.equal(fixture.runtime.listSteering(run.runId)[0].status, "delivered");
    } finally { await fixture.dispose(); }
  }
});

test("steering cancels an active tool, keeps its result and skips the remaining old batch", async () => {
  const registry = new ProviderRegistry(0, []), requests: ProviderRequest[] = [], executed: string[] = [];
  const tools = new ToolRegistry(); let ready = false, stopped = false;
  tools.register({ ...tool, async execute(request, context) {
    executed.push(request.id); ready = true;
    await new Promise<void>(resolve => context.signal.aborted ? resolve() : context.signal.addEventListener("abort", () => resolve(), { once: true }));
    stopped = true;
    return { toolId: request.id, text: "已停止，保留已完成部分", cancelled: true };
  } });
  registry.register({ descriptor: { ...registry.get("demo").descriptor }, async *stream(request): AsyncIterable<ProviderEvent> {
    requests.push(request);
    if (requests.length > 1) { yield { kind: "text.delta", text: "已按引导继续" }; return; }
    for (const callId of ["active", "not-started"]) yield { kind: "tool-call.completed", call: { type: "tool-call", name: tool.name, callId, arguments: {}, argumentsText: "{}" } };
  } });
  const fixture = await createRuntimeFixture({ registry, toolRegistry: tools });
  try {
    const session = fixture.runtime.snapshot().sessions[0];
    await fixture.runtime.send({ sessionId: session.id, text: "读取内容", attachments: [], selectedModel: session.selectedModel, permissionMode: "auto" });
    await waitFor(() => ready);
    const run = fixture.runtime.listRuns(session.id).find(r => r.status === "running")!;
    await fixture.runtime.steer(run.runId, "停止读取，只汇报当前状态");
    await waitFor(() => !fixture.runtime.isRunning(session.id));
    assert.ok(stopped); assert.deepEqual(executed, ["active"]);
    const results = requests[1].history.flatMap(e => e.items).filter(i => i.type === "tool-result");
    assert.equal(results.length, 2);
    assert.ok(results.every(i => i.isError));
    assert.match(results[0].content, /保留已完成部分/);
    assert.match(results[1].content, /未执行/);
    assert.equal(fixture.runtime.listRuns(session.id).at(-1)?.status, "completed");
  } finally { await fixture.dispose(); }
});
