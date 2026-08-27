import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createOpenAIChatToolNameProjection,
  OpenAIChatProvider,
  serializeOpenAIChat,
} from "../../../src/features/providers/protocols/openai-chat/openai-chat-provider";
import { DOMESTIC_MODEL_PROFILES } from "../../../src/features/providers/profiles/domestic-models";
import {
  assertProtocolErrorAndCancellation,
  providerOptions,
  protocolRequest,
  runProtocolToolLoop,
  testProfile,
  withProtocolFake,
} from "../protocol-test-kit";

test("OpenAI Chat fake handles DeepSeek reasoning, fragmented tool calls and tool_call_id continuation", async () => {
  await withProtocolFake((_request, index) => index === 0 ? [
    { data: { choices: [{ delta: { reasoning_content: "先检查" } }] } },
    { data: { choices: [{ delta: { tool_calls: [{ index: 0, id: "chat-call-1", function: { name: "demo.", arguments: "{\"topic\":" } }] } }] } },
    { data: { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "inspect", arguments: "\"queue\"}" } }] } }] } },
    { data: { choices: [], usage: { prompt_tokens: 14, completion_tokens: 4, total_tokens: 18, prompt_cache_hit_tokens: 6, prompt_cache_miss_tokens: 8, completion_tokens_details: { reasoning_tokens: 2 } } } },
    { data: "[DONE]" },
  ] : [
    { data: { choices: [{ delta: { content: "Chat 完成" } }] } },
    { data: { choices: [], usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 } } },
    { data: "[DONE]" },
  ], async (endpoint, requests) => {
    const profile = testProfile("openai-chat", endpoint);
    const provider = new OpenAIChatProvider(providerOptions(profile));
    const outcome = await runProtocolToolLoop(provider, protocolRequest(profile));
    assert.equal(outcome.result.assistantText, "Chat 完成");
    assert.deepEqual(outcome.executedCallIds, ["chat-call-1"]);
    const secondMessages = requests[1].body.messages as Array<Record<string, unknown>>;
    assert.equal(secondMessages.some((message) => message.role === "tool" && message.tool_call_id === "chat-call-1"), true);
    const assistant = secondMessages.find((message) => message.role === "assistant" && Array.isArray(message.tool_calls));
    assert.equal((assistant?.tool_calls as Array<{ id: string }>)[0].id, "chat-call-1");
    const usages = outcome.projected.filter((event) => event.kind === "usage.completed");
    assert.equal(usages.length, 2);
    assert.deepEqual(usages[1], {
      kind: "usage.completed",
      usage: { input: 9, cacheHitInput: null, cacheMissInput: null, cacheWriteInput: null, output: 3, reasoning: 0, toolUse: 0, total: 12, source: "provider" },
    });
  });
});

test("OpenAI Chat maps representative errors and cancellation", async () => {
  await withProtocolFake(() => [], async (endpoint) => {
    const profile = testProfile("openai-chat", endpoint);
    await assertProtocolErrorAndCancellation((model) => new OpenAIChatProvider(providerOptions(profile, model)), profile);
  });
});

test("DeepSeek profile exposes only the current V4 model facts", () => {
  const deepseek = DOMESTIC_MODEL_PROFILES.find((profile) => profile.id === "deepseek")!;
  const currentModels = (deepseek as typeof deepseek & { currentModels?: string[] }).currentModels;
  assert.deepEqual(currentModels, ["deepseek-v4-flash", "deepseek-v4-pro"]);
});

test("DeepSeek session user_id stays stable, isolated and inside its serializer boundary", () => {
  const deepseek = DOMESTIC_MODEL_PROFILES.find((profile) => profile.id === "deepseek")!;
  const firstRequest = { ...protocolRequest(deepseek, "deepseek-v4-flash"), sessionId: "session-one" };
  const secondRequest = { ...protocolRequest(deepseek, "deepseek-v4-flash"), sessionId: "session-two" };
  const first = serializeOpenAIChat(firstRequest, deepseek);
  const repeated = serializeOpenAIChat(firstRequest, deepseek);
  const second = serializeOpenAIChat(secondRequest, deepseek);
  assert.equal(typeof first.user_id, "string");
  assert.match(String(first.user_id), /^[A-Za-z0-9_-]{1,512}$/u);
  assert.equal(first.user_id, repeated.user_id);
  assert.notEqual(first.user_id, second.user_id);

  const generic = testProfile("openai-chat", "https://local.invalid/v1/chat/completions");
  assert.equal(serializeOpenAIChat(protocolRequest(generic), generic).user_id, undefined);
});

test("DeepSeek projects canonical dotted tool names to valid protocol aliases and restores them", async () => {
  let firstProjected = "";
  await withProtocolFake((captured, index) => {
    if (index > 0) return [
      { data: { choices: [{ delta: { content: "DeepSeek 工具闭环完成" } }] } },
      { data: { choices: [], usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24, prompt_cache_hit_tokens: 8, prompt_cache_miss_tokens: 12 } } },
      { data: "[DONE]" },
    ];
    const tools = captured.body.tools as Array<{ function: { name: string } }>;
    const projected = tools[0].function.name;
    firstProjected = projected;
    return [
      { data: { choices: [{ delta: { tool_calls: [{ index: 0, id: "deepseek-call-1", function: { name: projected, arguments: "{\"topic\":\"queue\"}" } }] } }] } },
      { data: { choices: [], usage: { prompt_tokens: 18, completion_tokens: 3, total_tokens: 21, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 18 } } },
      { data: "[DONE]" },
    ];
  }, async (endpoint, requests) => {
    const base = DOMESTIC_MODEL_PROFILES.find((profile) => profile.id === "deepseek")!;
    const profile = { ...base, endpoint: { ...base.endpoint, defaultUrl: endpoint } };
    const provider = new OpenAIChatProvider(providerOptions(profile, "deepseek-v4-flash"));
    const outcome = await runProtocolToolLoop(provider, protocolRequest(profile, "deepseek-v4-flash"));
    assert.match(firstProjected, /^[A-Za-z0-9_-]{1,64}$/u);
    assert.notEqual(firstProjected, "demo.inspect");
    assert.deepEqual(outcome.executedCallIds, ["deepseek-call-1"]);
    const secondMessages = requests[1].body.messages as Array<Record<string, unknown>>;
    const assistant = secondMessages.find((message) => Array.isArray(message.tool_calls));
    const assistantName = ((assistant?.tool_calls as Array<{ function: { name: string } }>)[0]).function.name;
    assert.match(assistantName, /^[A-Za-z0-9_-]{1,64}$/u);
    assert.notEqual(assistantName, "demo.inspect");
    const toolMessage = secondMessages.find((message) => message.role === "tool")!;
    assert.equal(toolMessage.name, undefined);
  });
});

test("DeepSeek tool projection rejects an alias collision while other OpenAI Chat profiles stay unchanged", () => {
  const deepseek = DOMESTIC_MODEL_PROFILES.find((profile) => profile.id === "deepseek")!;
  const canonical = "demo.inspect";
  const collidingLegalName = `vh_${Buffer.from(canonical, "utf8").toString("base64url")}`;
  const definition = (name: string) => ({
    name,
    description: "fixture",
    inputSchema: { type: "object" as const, properties: {}, additionalProperties: false },
    readOnly: true,
    permission: "auto-read-only" as const,
  });
  assert.throws(
    () => createOpenAIChatToolNameProjection(deepseek, [definition(canonical), definition(collidingLegalName)]),
    /投射冲突/u,
  );

  const generic = testProfile("openai-chat", "https://local.invalid/v1/chat/completions");
  const serialized = serializeOpenAIChat(protocolRequest(generic), generic);
  const name = (serialized.tools as Array<{ function: { name: string } }>)[0].function.name;
  assert.equal(name, canonical);
});

test("DeepSeek keeps tool-call reasoning only and serializes text-less assistant content as an empty string", () => {
  const deepseek = DOMESTIC_MODEL_PROFILES.find((profile) => profile.id === "deepseek")!;
  const base = protocolRequest(deepseek, "deepseek-v4-flash");
  const serialized = serializeOpenAIChat({
    ...base,
    history: [
      {
        id: "plain-reasoning",
        role: "assistant",
        items: [{ type: "reasoning", text: "plain-hidden" }],
      },
      {
        id: "tool-reasoning",
        role: "assistant",
        items: [
          { type: "reasoning", text: "required-passback" },
          { type: "tool-call", callId: "call-1", name: "demo.inspect", arguments: {}, argumentsText: "{}" },
        ],
      },
    ],
  }, deepseek);
  const assistants = (serialized.messages as Array<Record<string, unknown>>).filter((message) => message.role === "assistant");
  assert.equal(assistants[0].content, "");
  assert.equal(assistants[0].reasoning_content, undefined);
  assert.equal(assistants[1].content, "");
  assert.equal(assistants[1].reasoning_content, "required-passback");
});
