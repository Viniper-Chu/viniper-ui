import assert from "node:assert/strict";
import { test } from "node:test";
import { ProviderProfile } from "../../src/core/provider-contracts";
import { projectCachePolicy } from "../../src/features/providers/cache-policies/provider-cache-policy";
import { protocolRequest, testProfile } from "../providers/protocol-test-kit";

test("GPT 5.6 explicit caching uses only official request fields", () => {
  const profile = cacheProfile("openai", "openai-gpt");
  const projection = projectCachePolicy(profile, protocolRequest(profile, "gpt-5.6-contract"));
  assert.deepEqual(projection.body, {
    prompt_cache_key: "openai:gpt-5.6-contract:generation-1:tools-demo.inspect",
    prompt_cache_options: { mode: "explicit", ttl: "30m" },
  });
  assert.deepEqual(projection.headers, {});
  assert.equal(JSON.stringify(projection).includes("retention"), false);
  assert.equal(JSON.stringify(projection).includes("stable-prefix-end"), false);

  const older = projectCachePolicy(profile, protocolRequest(profile, "gpt-5.5-contract"));
  assert.deepEqual(older.body, {});
});

test("cache projections stay profile-specific for xAI, Anthropic and MiniMax", () => {
  const xai = cacheProfile("xai", "xai");
  const xaiProjection = projectCachePolicy(xai, protocolRequest(xai, "grok-contract"));
  assert.deepEqual(xaiProjection.body, { prompt_cache_key: "xai:grok-contract:generation-1:tools-demo.inspect" });
  assert.deepEqual(xaiProjection.headers, {});

  const anthropic = cacheProfile("anthropic", "anthropic-auto");
  assert.deepEqual(projectCachePolicy(anthropic, protocolRequest(anthropic)).body, {
    cache_control: { type: "ephemeral" },
  });

  const minimax = cacheProfile("minimax", "minimax-auto");
  const minimaxProjection = projectCachePolicy(minimax, protocolRequest(minimax));
  assert.deepEqual(minimaxProjection.body, {});
  assert.equal(JSON.stringify(minimaxProjection).includes("cache_control"), false);

  const compatible = cacheProfile("openai-compatible", "provider-reported");
  const compatibleProjection = projectCachePolicy(compatible, protocolRequest(compatible, "gpt-5.6-compatible"));
  assert.deepEqual(compatibleProjection.body, {});
});

function cacheProfile(id: string, cachePolicyId: string): ProviderProfile {
  return {
    ...testProfile(id === "anthropic" || id === "minimax" ? "anthropic-messages" : "openai-responses", "http://127.0.0.1:9/v1/fake"),
    id,
    cachePolicyId,
  };
}
