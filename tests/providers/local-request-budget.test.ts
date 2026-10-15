import assert from "node:assert/strict";
import { test } from "node:test";
import { boundLocalRequest } from "../../src/features/local-models/local-request-budget";
import { LocalAgentPolicy } from "../../src/features/local-models/local-agent-policy";
import { ProviderTransport } from "../../src/features/providers/protocols/shared/provider-transport";
import { providerOptions, testProfile } from "./protocol-test-kit";

const policy: LocalAgentPolicy = { endpoint: "http://127.0.0.1:19876/v1", model: "local", contextTokens: 16384,
  compactAtTokens: 12288, outputTokens: 4096, maxIterations: 96, defaultReasoning: "medium", reasoningBudgets: {},
  parallelToolCalls: false, structuredToolsJson: false, helperRevision: "test", visionEnabled: false };

function fixture() {
  const rendered: any[] = [];
  const transport = new ProviderTransport({ ...providerOptions(testProfile("openai-chat", policy.endpoint)),
    fetchImpl: async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith("/apply-template")) {
        rendered.push(body);
        return new Response(JSON.stringify({ prompt: JSON.stringify(body) }));
      }
      assert.ok(String(url).endsWith("/tokenize"));
      // CPU fixture: one Chinese character per token, deliberately unlike chars/3.
      return new Response(JSON.stringify({ tokens: Array.from({ length: body.content.length }, () => 1) }));
    } });
  return { rendered, transport };
}

test("local budget counts system, schemas and Chinese history; keeps active task and call/result pairs after tool growth", async () => {
  const { rendered, transport } = fixture();
  const system = "系统与技能".repeat(300), current = "当前任务：只读取新资料，禁止重做历史修改。";
  const body: any = { messages: [ { role: "system", content: system },
    { role: "user", content: "旧需求".repeat(3400) }, { role: "assistant", content: "已完成" },
    { role: "user", content: current } ], tools: [{ function: { name: "file.read", description: "工具说明".repeat(300) } }],
    chat_template_kwargs: { enable_thinking: false } };
  const first = await boundLocalRequest(body, policy, transport, new AbortController().signal);
  assert.ok(first && first.inputBefore > 12288 && first.inputAfter <= 12288);
  assert.equal(first.outputReserved, 4096);
  assert.equal(body.messages[0].content, system);
  assert.equal(body.messages.at(-1).content, current);
  assert.deepEqual(rendered[0].tools, body.tools);
  assert.deepEqual(rendered[0].chat_template_kwargs, { enable_thinking: false });
  body.messages.push({ role: "assistant", content: "", tool_calls: [{ id: "read-1", function: { name: "file.read", arguments: '{"path":"/资料.txt"}' } }] },
    { role: "tool", tool_call_id: "read-1", content: '来源 /资料.txt\n' + "新增中文内容".repeat(3000) + '\n结尾=42' });
  const second = await boundLocalRequest(body, policy, transport, new AbortController().signal);
  assert.ok(second && second.toolResults === 1 && second.inputAfter <= 12288);
  assert.equal(body.messages.at(-2).tool_calls[0].id, body.messages.at(-1).tool_call_id);
  assert.match(body.messages.at(-1).content, /资料.txt/u);
  assert.match(body.messages.at(-1).content, /结尾=42/u);
  assert.ok(body.messages.some((message: any) => message.content === current));
});

test("local budget rejects an oversized current instruction without truncating it or sending a generation", async () => {
  const { transport } = fixture();
  const current = "必须完整保留当前要求".repeat(2000);
  const body = { messages: [{ role: "user", content: current }] };
  await assert.rejects(boundLocalRequest(body, policy, transport, new AbortController().signal), /原始会话已保留/u);
  assert.equal(body.messages[0].content, current);
});

test("local budget rolls completed live-turn scripts into evidence and preserves recent calls and source history", async () => {
  const { transport } = fixture();
  const current = "从本机题库选10题，保留完整来源和教师解答。";
  const messages: any[] = [{ role: "system", content: "执行当前用户要求" }, { role: "user", content: current }];
  for (let index = 0; index < 12; index++) {
    messages.push({ role: "assistant", reasoning_content: "过程思考".repeat(40), tool_calls: [{
      id: `call-${index}`, function: { name: "file.write", arguments: JSON.stringify({ path: `/资料/题${index}.tex`, content: "已写入的长文稿".repeat(240) }) },
    }] }, { role: "tool", tool_call_id: `call-${index}`, content: JSON.stringify({ ok: true, path: `/资料/题${index}.tex`, bytes: 4320, mode: "create" }) });
  }
  const original = JSON.stringify(messages);
  const body = { messages: structuredClone(messages) };
  const latest = structuredClone(body.messages.slice(-4));
  const reduced = await boundLocalRequest(body, policy, transport, new AbortController().signal);
  assert.ok(reduced.inputBefore > 12288 && reduced.inputAfter <= 12288);
  assert.ok(reduced.toolResults > 0);
  assert.equal(JSON.stringify(messages), original);
  assert.equal(body.messages[1].content, current);
  assert.deepEqual(body.messages.slice(-4), latest);
  const summary = body.messages.find((message) => String(message.content).includes("本轮已结束的工具调用摘录"));
  assert.match(summary.content, /题0\.tex/u);
  assert.match(summary.content, /"ok":true/u);
  assert.match(summary.content, /"mode":"create"/u);
  assert.match(summary.content, /不是新的指令/u);
  for (let index = 0; index < body.messages.length; index++) {
    const message = body.messages[index];
    if (message.role === "tool") assert.ok(body.messages[index - 1].tool_calls.some((call: any) => call.id === message.tool_call_id));
    for (const call of message.tool_calls ?? []) assert.doesNotThrow(() => JSON.parse(call.function.arguments));
  }
});

test("completed terminal excerpts retain cwd, valid argument JSON and the actual exit receipt", async () => {
  const { transport } = fixture();
  const body = { messages: [ { role: "user", content: "核对已完成的提取操作，再继续" },
    { role: "assistant", tool_calls: [{ id: "extract", function: { name: "terminal.run", arguments: JSON.stringify({ cwd: "/资料/来源", command: "python3 extract.py source.docx\n" + "重复脚本内容".repeat(2500) + "\noutput.txt" }) } }] },
    { role: "tool", tool_call_id: "extract", content: '{"ok":true,"exitCode":0,"stdout":"","executionId":"exec-1"}' },
  ] };
  await boundLocalRequest(body, policy, transport, new AbortController().signal);
  const args = JSON.parse(body.messages[1].tool_calls![0].function.arguments);
  assert.equal(args.cwd, "/资料/来源");
  assert.match(args.command, /python3 extract.py source\.docx/u);
  assert.match(args.command, /中间内容已省略/u);
  assert.match(args.command, /output\.txt/u);
  assert.match(String(body.messages[2].content), /"exitCode":0/u);
  assert.match(String(body.messages[2].content), /exec-1/u);
});

test("local budget never compacts an unfinished parallel call batch or its arguments", async () => {
  const { transport } = fixture();
  const request = { role: "assistant", tool_calls: [
    { id: "done", function: { name: "file.write", arguments: JSON.stringify({ path: "/a", content: "必须保留".repeat(3500) }) } },
    { id: "pending", function: { name: "file.read", arguments: '{"path":"/b"}' } },
  ] };
  const body = { messages: [{ role: "user", content: "保留当前任务" }, request, { role: "tool", tool_call_id: "done", content: '{"ok":true}' }] };
  const before = JSON.stringify(request);
  await assert.rejects(boundLocalRequest(body, policy, transport, new AbortController().signal), /原始会话已保留/u);
  assert.equal(JSON.stringify(request), before);
  assert.equal(body.messages.length, 3);
});

test("local budget can excerpt one completed large write while retaining the call/result boundary", async () => {
  const { transport } = fixture();
  const body = { messages: [ { role: "user", content: "写完文件再编译" },
    { role: "assistant", tool_calls: [{ id: "write", function: { name: "file.write", arguments: JSON.stringify({ path: "/资料/教师.tex", content: "完整解答".repeat(4000) }) } }] },
    { role: "tool", tool_call_id: "write", content: '{"ok":true,"path":"/资料/教师.tex","bytes":48000,"mode":"create"}' },
  ] };
  const reduced = await boundLocalRequest(body, policy, transport, new AbortController().signal);
  assert.ok(reduced.inputAfter <= 12288);
  assert.equal(reduced.toolResults, 1);
  assert.equal(body.messages.length, 3);
  const args = JSON.parse(body.messages[1].tool_calls![0].function.arguments);
  assert.equal(args.path, "/资料/教师.tex");
  assert.match(args.content, /中间内容已省略/u);
  assert.equal(body.messages[1].tool_calls![0].id, body.messages[2].tool_call_id);
  assert.match(String(body.messages[2].content), /"bytes":48000/u);
});

test("long live turns have one bounded recap and keep a native last tool result for the chat template", async () => {
  for (const length of [36, 72]) {
    const { transport } = fixture();
    const body: any = { messages: [{ role: "user", content: "继续已完成的文档工作，不重做旧写入" }] };
    for (let index = 0; index < length; index++) {
      body.messages.push({ role: "assistant", tool_calls: [{ id: `call-${index}`, function: {
        name: "file.write", arguments: JSON.stringify({ path: `/资料/分段${index}.tex`, content: "连续写入内容".repeat(400) }),
      } }] }, { role: "tool", tool_call_id: `call-${index}`, content: JSON.stringify({ ok: true, path: `/资料/分段${index}.tex`, bytes: 7200 }) });
    }
    const original = structuredClone(body);
    const reduced = await boundLocalRequest(body, policy, transport, new AbortController().signal);
    assert.ok(reduced.inputAfter <= 12288);
    assert.equal(reduced.outputReserved, 4096);
    const recaps = body.messages.filter((message: any) => String(message.content).startsWith("本轮已结束的工具调用摘录"));
    assert.equal(recaps.length, 1);
    assert.ok(recaps[0].content.length < 6200);
    assert.equal(body.messages.at(-1).role, "tool");
    assert.equal(body.messages.at(-1).tool_call_id, `call-${length - 1}`);
    assert.equal(body.messages.at(-2).tool_calls[0].id, `call-${length - 1}`);
    assert.deepEqual(body.messages.at(-1), original.messages.at(-1));
  }
});
