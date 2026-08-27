import assert from "node:assert/strict";
import { test } from "node:test";
import { AnthropicMessagesProvider } from "../../../src/features/providers/protocols/anthropic-messages/anthropic-messages-provider";
import { encodeProviderToolName } from "../../../src/features/providers/protocols/shared/tool-name-projection";
import {
  assertProtocolErrorAndCancellation,
  providerOptions,
  protocolRequest,
  runProtocolToolLoop,
  testProfile,
  withProtocolFake,
} from "../protocol-test-kit";

test("Anthropic Messages fake replays signed thinking, redacted thinking and tool_use in original order", async () => {
  const providerToolName = encodeProviderToolName("demo.inspect");
  await withProtocolFake((_request, index) => index === 0 ? [
    { event: "message_start", data: { type: "message_start", message: { usage: { input_tokens: 18, cache_creation_input_tokens: 3, cache_read_input_tokens: 7 } } } },
    { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } } },
    { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "检查计划" } } },
    { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "opaque-signature-fixture" } } },
    { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
    { event: "content_block_start", data: { type: "content_block_start", index: 1, content_block: { type: "redacted_thinking", data: "opaque-redacted-fixture" } } },
    { event: "content_block_stop", data: { type: "content_block_stop", index: 1 } },
    { event: "content_block_start", data: { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "tool-use-1", name: providerToolName, input: {} } } },
    { event: "content_block_delta", data: { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "{\"topic\":" } } },
    { event: "content_block_delta", data: { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "\"queue\"}" } } },
    { event: "content_block_stop", data: { type: "content_block_stop", index: 2 } },
    { event: "message_delta", data: { type: "message_delta", usage: { output_tokens: 4 } } },
  ] : [
    { event: "message_start", data: { type: "message_start", message: { usage: { input_tokens: 9, cache_read_input_tokens: 6, cache_creation_input_tokens: 0 } } } },
    { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
    { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Claude 完成" } } },
    { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
    { event: "message_delta", data: { type: "message_delta", usage: { output_tokens: 3 } } },
  ], async (endpoint, requests) => {
    const profile = testProfile("anthropic-messages", endpoint);
    const provider = new AnthropicMessagesProvider(providerOptions(profile));
    const outcome = await runProtocolToolLoop(provider, protocolRequest(profile));
    assert.equal(outcome.result.assistantText, "Claude 完成");
    assert.deepEqual(outcome.executedCallIds, ["tool-use-1"]);
    const secondMessages = requests[1].body.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
    const assistant = secondMessages.find((message) => message.role === "assistant");
    assert.deepEqual(assistant?.content, [
      { type: "thinking", thinking: "检查计划", signature: "opaque-signature-fixture" },
      { type: "redacted_thinking", data: "opaque-redacted-fixture" },
      { type: "tool_use", id: "tool-use-1", name: providerToolName, input: { topic: "queue" } },
    ]);
    assert.equal(secondMessages.flatMap((message) => message.content).some((item) => item.type === "tool_result" && item.tool_use_id === "tool-use-1"), true);
    assert.equal(Array.isArray(requests[0].body.tools), true);
    assert.equal(Array.isArray(requests[0].body.system), true);
    assert.deepEqual(requests[0].body.cache_control, { type: "ephemeral" });
    assert.equal(JSON.stringify(requests[0].body.tools).includes("cache_control"), false);
    assert.equal(JSON.stringify(requests[0].body.system).includes("cache_control"), false);
    const usageEvents = outcome.projected.filter((event) => event.kind === "usage.completed");
    assert.equal(usageEvents.length, 2);
    assert.deepEqual(usageEvents[0], {
      kind: "usage.completed",
      usage: { input: 28, cacheHitInput: 7, cacheMissInput: 18, cacheWriteInput: 3, output: 4, reasoning: 0, toolUse: 0, total: 32, source: "provider" },
    });
  });
});

test("Anthropic Messages maps representative errors and cancellation", async () => {
  await withProtocolFake(() => [], async (endpoint) => {
    const profile = testProfile("anthropic-messages", endpoint);
    await assertProtocolErrorAndCancellation((model) => new AnthropicMessagesProvider(providerOptions(profile, model)), profile);
  });
});
