import assert from "node:assert/strict";
import { test } from "node:test";
import { SenseNovaProvider } from "../../../src/features/providers/protocols/sensenova/sensenova-provider";
import {
  assertProtocolErrorAndCancellation,
  providerOptions,
  protocolRequest,
  testProfile,
  withProtocolFake,
} from "../protocol-test-kit";

test("SenseNova fake maps custom data/SSE and usage while keeping tools/cache unsupported", async () => {
  await withProtocolFake(() => [
    { data: { data: { delta: { content: "商汤" } } } },
    { data: { data: { choices: [{ delta: "完成" }], usage: { prompt_tokens: 11, completion_tokens: 2, total_tokens: 13 } } } },
    { data: "[DONE]" },
  ], async (endpoint, requests) => {
    const profile = testProfile("sensenova", endpoint);
    const provider = new SenseNovaProvider(providerOptions(profile));
    const events = [];
    for await (const event of provider.stream(protocolRequest(profile), new AbortController().signal)) events.push(event);
    assert.equal(events.filter((event) => event.kind === "text.delta").map((event) => event.kind === "text.delta" ? event.text : "").join(""), "商汤完成");
    assert.deepEqual(events.at(-1), {
      kind: "usage.completed",
      usage: { input: 11, cacheHitInput: null, cacheMissInput: null, cacheWriteInput: null, output: 2, reasoning: 0, toolUse: 0, total: 13, source: "provider" },
    });
    assert.equal("tools" in requests[0].body, false);
    assert.equal("cache_control" in requests[0].body, false);
    assert.equal(profile.capabilities.tools, "unsupported");
    assert.equal(profile.capabilities.cache, "unsupported");
  });
});

test("SenseNova maps representative errors and cancellation", async () => {
  await withProtocolFake(() => [], async (endpoint) => {
    const profile = testProfile("sensenova", endpoint);
    await assertProtocolErrorAndCancellation((model) => new SenseNovaProvider(providerOptions(profile, model)), profile);
  });
});
