import assert from "node:assert/strict";
import test from "node:test";
import { OpenAIResponsesProvider } from "../../src/features/providers/protocols/openai-responses/openai-responses-provider";
import { AnthropicMessagesProvider } from "../../src/features/providers/protocols/anthropic-messages/anthropic-messages-provider";
import { protocolRequest, providerOptions, testProfile } from "./protocol-test-kit";

test("the chosen effort reaches the official transport only for a matching model and endpoint", async () => {
  const openai = "https://api.openai.com/v1/responses";
  const claude = "https://api.anthropic.com/v1/messages";
  for (const [protocol, endpoint, model, effort, expected] of [
    ["openai-responses", openai, "gpt-6.2-sol", "max", {reasoning: {effort: "max"}}],
    ["openai-responses", openai, "gpt-6.2-sol", "none", {}],
    ["openai-responses", openai, "gpt-5.5-2026-04-23", "none", {reasoning: {effort: "none"}}],
    ["openai-responses", openai, "gpt-5.5-pro", "none", {}],
    ["openai-responses", "https://example.invalid/v1/responses", "gpt-6.2-sol", "max", {}],
    ["anthropic-messages", claude, "claude-opus-4-7", "xhigh", {output_config:{effort:"xhigh"}, thinking:{type:"adaptive"}}],
    ["anthropic-messages", claude, "claude-sonnet-4-6", "xhigh", {}],
    ["anthropic-messages", claude, "claude-fable-5", "max", {output_config:{effort:"max"}}],
  ] as const) {
    const profile = testProfile(protocol, endpoint);
    let sent: Record<string, unknown> | undefined;
    const options = { ...providerOptions(profile, model), allowExternalNetwork:true,
      fetchImpl: async (_: unknown, init?: RequestInit) => {
        sent = JSON.parse(String(init?.body));
        return new Response("data: [DONE]\n\n", {headers:{"content-type":"text/event-stream"}});
      } };
    const provider = protocol === "openai-responses" ? new OpenAIResponsesProvider(options) : new AnthropicMessagesProvider(options);
    const request = {...protocolRequest(profile, model), reasoning: effort};
    for await (const _ of provider.stream(request, new AbortController().signal)) { /* Drain fixture stream. */ }
    assert.ok(sent);
    const fields = Object.fromEntries(Object.entries(sent).filter(([key]) => ["reasoning","thinking","output_config"].includes(key)));
    assert.deepEqual(fields, expected);
  }
});
