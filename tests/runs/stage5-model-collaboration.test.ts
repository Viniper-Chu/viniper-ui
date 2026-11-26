import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { buildContextProfile } from "../../src/features/cache/cache-plan";
import { filterLocalModelTools, documentHints, relevantFileTools } from "../../src/features/runs/current-turn-tools";
import { validateToolInput } from "../../src/features/runs/tool-loop/tool-input-validator";
import { OpenAIChatProvider, serializeOpenAIChat } from "../../src/features/providers/protocols/openai-chat/openai-chat-provider";
import { boundLocalRequest, clearLocalCompactionAnchors } from "../../src/features/local-models/local-request-budget";
import { providerOptions, protocolRequest, testProfile } from "../providers/protocol-test-kit";
import type { ProviderToolDefinition } from "../../src/core/provider-contracts";
import type { LocalAgentPolicy } from "../../src/features/local-models/local-agent-policy";

test("M0 & M6: OpenAI Chat maps llama.cpp timings (cache_n/prompt_n) and repairs completed fenced/trailing-comma tool JSON", async () => {
  const profile = testProfile("openai-chat", "http://127.0.0.1/v1/chat/completions");
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (obj: unknown) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`));
      send({
        choices: [{
          delta: {
            tool_calls: [{ index: 0, id: "call-1", function: { name: "math.rational.evaluate", arguments: '```json\n{"expressions": ["1/2+1/3",],}\n```' } }],
          },
          finish_reason: "tool_calls",
        }],
        timings: { cache_n: 8192, prompt_n: 256, prompt_ms: 3100, predicted_n: 42, predicted_ms: 900 },
      });
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  const provider = new OpenAIChatProvider({ ...providerOptions(profile), fetchImpl: async () => new Response(source) });
  const events = [];
  for await (const event of provider.stream(protocolRequest(profile), new AbortController().signal)) events.push(event);
  const usageEvent = events.find((e) => e.kind === "usage.completed");
  assert.ok(usageEvent && usageEvent.kind === "usage.completed");
  assert.equal(usageEvent.usage.cacheHitInput, 8192);
  assert.equal(usageEvent.usage.cacheMissInput, 256);
  assert.equal(usageEvent.usage.input, 8448);

  const toolEvent = events.find((e) => e.kind === "tool-call.completed");
  assert.ok(toolEvent && toolEvent.kind === "tool-call.completed");
  assert.equal(toolEvent.call.argumentsError, undefined);
  assert.deepEqual(toolEvent.call.arguments, { expressions: ["1/2+1/3"] });
});

test("M2: hostInstructions appears once in system project segment and strips legacy per-turn duplicate headers", () => {
  const profile = testProfile("openai-chat", "http://127.0.0.1/v1/chat/completions");
  const hostInstructions = "[通用 Agent 收尾指令]\n及时结束。\n\n[Viniper Harness 独立指令]\n长篇协作规范正文";
  const contextProfile = buildContextProfile({
    hostInstructions,
    projectInstructions: "工程本地规则",
  });
  const req = protocolRequest(profile);
  req.contextProfile = contextProfile;
  req.history = [
    {
      id: "u1",
      role: "user",
      items: [{ type: "text", text: `${hostInstructions}\n\n[当前请求]\n第一问：求定义域` }],
    },
    { id: "a1", role: "assistant", items: [{ type: "text", text: "定义域为 R。" }] },
    { id: "u2", role: "user", items: [{ type: "text", text: "第二问：求单调区间" }] },
  ];
  const body = serializeOpenAIChat(req, profile);
  const messages = body.messages as Array<{ role: string; content: string }>;
  assert.equal(messages[0].role, "system");
  assert.ok(messages[0].content.includes("长篇协作规范正文"));
  assert.equal(messages[1].content, "第一问：求定义域");
  assert.equal(messages[3].content, "第二问：求单调区间");
});

test("M1 & M5: local model trims redundant desktop tools while keeping rational & animated-svg hints across turns", () => {
  const mk = (name: string): ProviderToolDefinition => ({
    name,
    description: name,
    inputSchema: { type: "object" },
    readOnly: true,
    permission: "auto-read-only",
  });
  const all = [
    "demo.read-only-preview", "file.read", "file.write", "file.edit", "project.read", "project.edit",
    "git.status", "coordination.send-message", "workspace.prepare", "review.run", "github.repository.read",
    "web.search", "terminal.run", "math.quadratic.check", "math.rational.evaluate",
  ].map(mk);
  const filtered = filterLocalModelTools(all, "请修改当前目录下的脚本并验算 (1/2+1/3)^2");
  const names = filtered.map((t) => t.name);
  assert.ok(names.includes("file.read") && names.includes("terminal.run"));
  assert.ok(!names.includes("demo.read-only-preview"));
  assert.ok(!names.includes("project.read"));
  assert.ok(!names.includes("coordination.send-message"));
  assert.ok(!names.includes("git.status"));
  assert.ok(!names.includes("web.search"));

  // Rational hint persists on follow-up turn without repeating keywords
  const turn1Hints = documentHints("请复算算式 (1/2+1/3)^2");
  assert.ok(turn1Hints.includes("rational"));
  const turn2Tools = relevantFileTools("把结果代回上一步", filtered, false, turn1Hints);
  assert.ok(turn2Tools.some((t) => t.name === "math.rational.evaluate"));
});

test("M3: session-scoped local compaction reuses byte-identical summary prefix across subsequent turns", async () => {
  clearLocalCompactionAnchors();
  const policy: LocalAgentPolicy = {
    endpoint: "http://127.0.0.1:18080/v1",
    model: "inkling-2-mini",
    contextTokens: 2000,
    compactAtTokens: 1200,
    outputTokens: 400,
    maxIterations: 10,
    defaultReasoning: "low",
    reasoningBudgets: {},
    parallelToolCalls: false,
    structuredToolsJson: true,
    helperRevision: "1",
    visionEnabled: false,
  };
  const fakeTransport: any = {
    async request(init: { body: string }, url: string) {
      const payload = JSON.parse(init.body);
      if (url.endsWith("/apply-template")) {
        const prompt = JSON.stringify(payload.messages);
        return new Response(JSON.stringify({ prompt }));
      }
      const tokens = Array.from({ length: Math.ceil(String(payload.content).length / 2) }, (_, i) => i);
      return new Response(JSON.stringify({ tokens }));
    },
  };
  const oldTurns = [
    { role: "user", content: "第一题长背景 ".repeat(90) },
    { role: "assistant", content: "第一题解答 ".repeat(90) },
    { role: "user", content: "第二题长背景 ".repeat(90) },
    { role: "assistant", content: "第二题解答 ".repeat(90) },
    { role: "user", content: "第三题近期问题" },
    { role: "assistant", content: "第三题近期回答" },
  ];
  const bodyTurn4 = { messages: [{ role: "system", content: "SYS" }, ...oldTurns, { role: "user", content: "第四题追问" }] };
  const r4 = await boundLocalRequest(bodyTurn4, policy, fakeTransport, new AbortController().signal, 0, [], "sess-anchor-1");
  assert.ok(r4.inputAfter <= 1200);
  const summaryTurn4 = bodyTurn4.messages[1].content;

  // Next turn appends turn 4 answer + turn 5 question: summary message at index 1 must stay byte-identical
  const bodyTurn5 = {
    messages: [
      { role: "system", content: "SYS" },
      ...oldTurns,
      { role: "user", content: "第四题追问" },
      { role: "assistant", content: "第四题简短回答" },
      { role: "user", content: "第五题追问" },
    ],
  };
  const r5 = await boundLocalRequest(bodyTurn5, policy, fakeTransport, new AbortController().signal, 0, [], "sess-anchor-1");
  assert.ok(r5.inputAfter <= 1200);
  assert.equal(bodyTurn5.messages[1].content, summaryTurn4, "immutable summary prefix preserved across turns");
});

test("M6: validateToolInput safely coerces scalar/array/boolean/numeric-string mismatches and validates nested objects", () => {
  const schema = {
    type: "object" as const,
    properties: {
      expressions: { type: "array" as const, items: { type: "string" as const } },
      level_family: {
        type: "object" as const,
        properties: {
          a: { type: "string" as const },
          lower_open: { type: "boolean" as const },
        },
        additionalProperties: false,
      },
      limit: { type: "integer" as const },
    },
    required: ["expressions"],
    additionalProperties: false,
  };
  const args: Record<string, unknown> = {
    expressions: "(1/2+1/3)^2",
    level_family: { a: 1, lower_open: "true" },
    limit: "20",
  };
  const res = validateToolInput(schema, args);
  assert.equal(res.valid, true, res.message);
  assert.deepEqual(args.expressions, ["(1/2+1/3)^2"]);
  assert.deepEqual(args.level_family, { a: "1", lower_open: true });
  assert.equal(args.limit, 20);

  const badNested: Record<string, unknown> = {
    expressions: ["1+1"],
    level_family: { a: "1", bogus: 123 },
  };
  assert.equal(validateToolInput(schema, badNested).valid, false);
});

test("M7: discussion.py keeps user question and prior replies ahead of per-turn handoff directives", () => {
  const py = spawnSync("python3", ["-I", "-B", "-c", `
import asyncio, sys
sys.path.insert(0, "tests/fixtures")
import importlib
mod = importlib.import_module("discussion-check")
asyncio.run(mod.check())
print("DISCUSSION_OK")
`], { encoding: "utf8", timeout: 15000 });
  assert.equal(py.status, 0, py.stderr || py.stdout);
  assert.match(py.stdout, /DISCUSSION_OK/);
});
