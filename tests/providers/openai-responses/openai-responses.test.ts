import assert from "node:assert/strict";
import { test } from "node:test";
import { OpenAIResponsesProvider, serializeOpenAIResponses } from "../../../src/features/providers/protocols/openai-responses/openai-responses-provider";
import {
  assertProtocolErrorAndCancellation,
  providerOptions,
  protocolRequest,
  runProtocolToolLoop,
  testProfile,
  withProtocolFake,
} from "../protocol-test-kit";

test("OpenAI Responses fake completes text-tool-result-final loop with IDs, reasoning and usage/cache", async () => {
  await withProtocolFake((request, index) => index === 0 ? [
    { event: "response.created", data: { type: "response.created", response: { id: "resp-1" } } },
    { event: "response.reasoning_summary_text.delta", data: { type: "response.reasoning_summary_text.delta", item_id: "reasoning-1", delta: "分析队列" } },
    { event: "response.output_item.added", data: { type: "response.output_item.added", output_index: 0, item: { id: "item-1", type: "function_call", call_id: "call-resp-1", name: "demo.inspect" } } },
    { event: "response.function_call_arguments.delta", data: { type: "response.function_call_arguments.delta", item_id: "item-1", output_index: 0, delta: "{\"topic\":" } },
    { event: "response.function_call_arguments.delta", data: { type: "response.function_call_arguments.delta", item_id: "item-1", output_index: 0, delta: "\"queue\"}" } },
    { event: "response.completed", data: { type: "response.completed", response: { id: "resp-1", usage: { input_tokens: 20, output_tokens: 4, total_tokens: 24, input_tokens_details: { cached_tokens: 8, cache_write_tokens: 3 }, output_tokens_details: { reasoning_tokens: 2 } } } } },
  ] : [
    { event: "response.output_text.delta", data: { type: "response.output_text.delta", delta: "Responses 完成" } },
    { event: "response.completed", data: { type: "response.completed", response: { id: "resp-2", usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15, input_tokens_details: { cached_tokens: 10, cache_write_tokens: 0 } } } } },
  ], async (endpoint, requests) => {
    const profile = { ...testProfile("openai-responses", endpoint), id: "openai", cachePolicyId: "openai-gpt", continuationMode: "server-optional" as const };
    const provider = new OpenAIResponsesProvider(providerOptions(profile, "gpt-5.6-fake"));
    const outcome = await runProtocolToolLoop(provider, protocolRequest(profile, "gpt-5.6-fake"));

    assert.equal(outcome.result.assistantText, "Responses 完成");
    assert.deepEqual(outcome.executedCallIds, ["call-resp-1"]);
    assert.equal(requests.length, 2);
    const first = requests[0].body;
    assert.equal(first.prompt_cache_key, "openai:gpt-5.6-fake:generation-1:tools-demo.inspect");
    assert.deepEqual(first.prompt_cache_options, { mode: "explicit", ttl: "30m" });
    assert.equal("retention" in (first.prompt_cache_options as Record<string, unknown>), false);
    assert.equal("breakpoint" in (first.prompt_cache_options as Record<string, unknown>), false);
    const firstInput = first.input as Array<{ role?: string; content?: Array<Record<string, unknown>> }>;
    const markedBlocks = firstInput.flatMap((item) => item.content ?? []).filter((block) => "prompt_cache_breakpoint" in block);
    assert.equal(markedBlocks.length, 1);
    assert.equal(markedBlocks[0].type, "input_text");
    assert.deepEqual(markedBlocks[0].prompt_cache_breakpoint, { mode: "explicit" });
    const markedMessageIndex = firstInput.findIndex((item) => item.content?.includes(markedBlocks[0]));
    const currentUserIndex = firstInput.findIndex((item) => item.role === "user" && item.content?.some((block) => block.text === "检查队列"));
    assert.equal(markedMessageIndex < currentUserIndex, true);
    const secondInput = requests[1].body.input as Array<Record<string, unknown>>;
    assert.equal(secondInput.some((item) => item.type === "function_call"), false);
    assert.equal(secondInput.some((item) => item.role === "user"), false);
    assert.equal(secondInput.some((item) => item.type === "function_call_output" && item.call_id === "call-resp-1"), true);
    assert.equal(requests[1].body.previous_response_id, "resp-1");
    assert.equal(outcome.projected.filter((event) => event.kind === "usage.completed").length, 2);
  });
});

test("xAI Responses uses body cache key, no Chat routing header, and continuation sends only new tool output", async () => {
  await withProtocolFake((_request, index) => index === 0 ? [
    { event: "response.output_item.added", data: { type: "response.output_item.added", item: { id: "xai-item-1", type: "function_call", call_id: "xai-call-1", name: "demo.inspect", arguments: "{\"topic\":\"queue\"}" } } },
    { event: "response.completed", data: { type: "response.completed", response: { id: "xai-response-1", usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 } } } },
  ] : [
    { event: "response.output_text.delta", data: { type: "response.output_text.delta", delta: "Grok 完成" } },
    { event: "response.completed", data: { type: "response.completed", response: { id: "xai-response-2", usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 } } } },
  ], async (endpoint, requests) => {
    const profile = { ...testProfile("openai-responses", endpoint), id: "xai", cachePolicyId: "xai", continuationMode: "server-optional" as const };
    const provider = new OpenAIResponsesProvider(providerOptions(profile, "grok-fake"));
    const outcome = await runProtocolToolLoop(provider, protocolRequest(profile, "grok-fake"));
    assert.equal(outcome.result.assistantText, "Grok 完成");
    assert.equal(requests[0].body.prompt_cache_key, "xai:grok-fake:generation-1:tools-demo.inspect");
    assert.equal(requests[0].headers["x-grok-conv-id"], undefined);
    assert.equal(requests[1].body.previous_response_id, "xai-response-1");
    const input = requests[1].body.input as Array<Record<string, unknown>>;
    assert.equal(input.length, 1);
    assert.equal(input[0].type, "function_call_output");
    assert.equal(input[0].call_id, "xai-call-1");
  });
});

test("OpenAI Responses maps representative HTTP errors and cancellation without leaking response bodies", async () => {
  await withProtocolFake(() => [], async (endpoint) => {
    const profile = testProfile("openai-responses", endpoint);
    await assertProtocolErrorAndCancellation(
      (model) => new OpenAIResponsesProvider(providerOptions(profile, model)),
      profile,
    );
  });
});

test("MiMo Responses uses local structured continuation, retains reasoning, and omits unsupported continuation fields", () => {
  const profile = {
    ...testProfile("openai-responses", "http://127.0.0.1:9/v1/responses"),
    id: "xiaomi-mimo",
    continuationMode: "local-history" as const,
    preserveReasoningItems: true,
    cachePolicyId: "mimo-local-history",
  };
  const request = protocolRequest(profile, "mimo-fake");
  request.history.push({
    id: "assistant-1",
    role: "assistant",
    items: [
      { type: "reasoning", itemId: "reasoning-mimo-1", text: "保留推理项", providerId: "xiaomi-mimo" },
      { type: "continuation", responseId: "ignored-response" },
      { type: "tool-call", callId: "mimo-call-1", protocolItemId: "mimo-item-1", name: "demo.inspect", arguments: { topic: "queue" }, argumentsText: "{\"topic\":\"queue\"}" },
    ],
  });
  request.history.push({ id: "tool-1", role: "tool", items: [{ type: "tool-result", callId: "mimo-call-1", name: "demo.inspect", content: "结果", isError: false }] });
  const serialized = serializeOpenAIResponses(request, profile);
  assert.equal("background" in serialized, false);
  assert.equal("previous_response_id" in serialized, false);
  assert.equal("context_management" in serialized, false);
  const input = serialized.input as Array<Record<string, unknown>>;
  assert.equal(input.some((item) => item.type === "reasoning" && item.id === "reasoning-mimo-1"), true);
  assert.equal(input.some((item) => item.type === "function_call_output" && item.call_id === "mimo-call-1"), true);
});

test("GPT explicit breakpoint marks the last stable history input_text and remains OpenAI GPT 5.6 specific", () => {
  const openaiProfile = { ...testProfile("openai-responses", "http://127.0.0.1:9/v1/responses"), id: "openai", cachePolicyId: "openai-gpt" };
  const request = protocolRequest(openaiProfile, "gpt-5.6-contract");
  const stable = { id: "stable-user", role: "user" as const, items: [{ type: "text" as const, text: "稳定历史" }] };
  request.contextProfile.history = [stable];
  request.history = [stable, ...request.history];
  const serialized = serializeOpenAIResponses(request, openaiProfile, {
    prompt_cache_key: "stable-key",
    prompt_cache_options: { mode: "explicit", ttl: "30m" },
  });
  const input = serialized.input as Array<{ role?: string; content?: Array<Record<string, unknown>> }>;
  const stableBlock = input.find((item) => item.role === "user" && item.content?.some((block) => block.text === "稳定历史"))?.content?.[0];
  assert.deepEqual(stableBlock?.prompt_cache_breakpoint, { mode: "explicit" });

  const older = serializeOpenAIResponses(protocolRequest(openaiProfile, "gpt-5.5-contract"), openaiProfile, {});
  assert.equal("prompt_cache_options" in older, false);
  assert.equal(JSON.stringify(older).includes("prompt_cache_breakpoint"), false);
  const xai = { ...openaiProfile, id: "xai", cachePolicyId: "xai" };
  const xaiSerialized = serializeOpenAIResponses(protocolRequest(xai, "grok-contract"), xai, { prompt_cache_key: "xai-key" });
  assert.equal("prompt_cache_options" in xaiSerialized, false);
  assert.equal(JSON.stringify(xaiSerialized).includes("prompt_cache_breakpoint"), false);
});
