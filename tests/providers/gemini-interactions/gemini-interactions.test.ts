import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GeminiInteractionsProvider,
  serializeGeminiInteractions,
} from "../../../src/features/providers/protocols/gemini-interactions/gemini-interactions-provider";
import {
  assertProtocolErrorAndCancellation,
  providerOptions,
  protocolRequest,
  runProtocolToolLoop,
  testProfile,
  withProtocolFake,
} from "../protocol-test-kit";

test("Gemini Interactions fake rebuilds indexed official steps and replays them unchanged", async () => {
  await withProtocolFake((_request, index) => index === 0 ? [
    { event: "interaction.created", data: { event_type: "interaction.created", interaction: { id: "interaction-1" } } },
    { event: "step.start", data: { event_type: "step.start", index: 0, step: { type: "thought" } } },
    { event: "step.delta", data: { event_type: "step.delta", index: 0, delta: { type: "thought_summary", content: { type: "text", text: "检查上下文" } } } },
    { event: "step.delta", data: { event_type: "step.delta", index: 0, delta: { type: "thought_signature", signature: "opaque-gemini-signature" } } },
    { event: "step.stop", data: { event_type: "step.stop", index: 0 } },
    { event: "step.start", data: { event_type: "step.start", index: 1, step: { type: "future_model_step", signature: "opaque-future-step" } } },
    { event: "step.stop", data: { event_type: "step.stop", index: 1 } },
    { event: "step.start", data: { event_type: "step.start", index: 2, step: { id: "function-step-1", type: "function_call", name: "demo.inspect", arguments: {} } } },
    { event: "step.delta", data: { event_type: "step.delta", index: 2, delta: { type: "arguments_delta", arguments: "{\"topic\":" } } },
    { event: "step.delta", data: { event_type: "step.delta", index: 2, delta: { type: "arguments_delta", arguments: "\"queue\"}" } } },
    { event: "step.stop", data: { event_type: "step.stop", index: 2 } },
    { event: "interaction.completed", data: { event_type: "interaction.completed", interaction: { id: "interaction-1", usage: { total_input_tokens: 16, total_output_tokens: 3, total_tokens: 19, total_cached_tokens: 9, total_thought_tokens: 2, total_tool_use_tokens: 1 } } } },
  ] : [
    { event: "interaction.created", data: { event_type: "interaction.created", interaction: { id: "interaction-2" } } },
    { event: "step.start", data: { event_type: "step.start", index: 0, step: { type: "model_output", content: [] } } },
    { event: "step.delta", data: { event_type: "step.delta", index: 0, delta: { type: "text", text: "Gemini 完成" } } },
    { event: "step.stop", data: { event_type: "step.stop", index: 0 } },
    { event: "interaction.completed", data: { event_type: "interaction.completed", interaction: { id: "interaction-2", usage: { total_input_tokens: 8, total_output_tokens: 3, total_tokens: 11, total_cached_tokens: 6, total_thought_tokens: 0, total_tool_use_tokens: 0 } } } },
  ], async (endpoint, requests) => {
    const profile = testProfile("gemini-interactions", endpoint);
    const provider = new GeminiInteractionsProvider(providerOptions(profile));
    const outcome = await runProtocolToolLoop(provider, protocolRequest(profile));
    assert.equal(outcome.result.assistantText, "Gemini 完成");
    assert.deepEqual(outcome.executedCallIds, ["function-step-1"]);
    assert.equal(requests[0].body.store, false);
    assert.equal("previous_interaction_id" in requests[1].body, false);
    assert.deepEqual(requests[0].body.tools, [{
      type: "function",
      name: "demo.inspect",
      description: "检查本地 Demo",
      parameters: {
        type: "object",
        properties: { topic: { type: "string" } },
        required: ["topic"],
        additionalProperties: false,
      },
    }]);
    assert.equal(JSON.stringify(requests[0].body.tools).includes("function_declarations"), false);
    const input = requests[1].body.input as Array<Record<string, unknown>>;
    assert.deepEqual(input, [
      { type: "user_input", content: [{ type: "text", text: "检查队列" }] },
      { type: "thought", signature: "opaque-gemini-signature", summary: [{ type: "text", text: "检查上下文" }] },
      { type: "future_model_step", signature: "opaque-future-step" },
      { id: "function-step-1", type: "function_call", name: "demo.inspect", arguments: { topic: "queue" } },
      { type: "function_result", name: "demo.inspect", call_id: "function-step-1", result: [{ type: "text", text: "本地工具结果：队列正常" }] },
    ]);
    const firstUsage = outcome.projected.find((event) => event.kind === "usage.completed");
    assert.deepEqual(firstUsage, {
      kind: "usage.completed",
      usage: { input: 16, cacheHitInput: 9, cacheMissInput: 7, cacheWriteInput: null, output: 3, reasoning: 2, toolUse: 1, total: 19, source: "provider" },
    });

    const nextRequest = protocolRequest(profile);
    nextRequest.history.push(...outcome.appendedHistory, {
      id: "user-next",
      role: "user",
      items: [{ type: "text", text: "继续" }],
    });
    const nextInput = serializeGeminiInteractions(nextRequest, profile).input as Array<Record<string, unknown>>;
    assert.equal(nextInput.some((item) => item.type === "model_output"
      && JSON.stringify(item.content) === JSON.stringify([{ type: "text", text: "Gemini 完成" }])), true);
    assert.deepEqual(nextInput.at(-1), { type: "user_input", content: [{ type: "text", text: "继续" }] });
  });
});

test("Gemini Interactions maps representative errors and cancellation", async () => {
  await withProtocolFake(() => [], async (endpoint) => {
    const profile = testProfile("gemini-interactions", endpoint);
    await assertProtocolErrorAndCancellation((model) => new GeminiInteractionsProvider(providerOptions(profile, model)), profile);
  });
});
