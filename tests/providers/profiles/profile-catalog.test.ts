import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CapabilityEvidence,
  ProviderProfile,
  ProviderProtocolFamily,
  ProviderRequest,
} from "../../../src/core/provider-contracts";
import { buildCachePlan, buildContextProfile } from "../../../src/features/cache/cache-plan";
import { ProviderProfileCatalog } from "../../../src/features/providers/provider-profile-catalog";
import { createProfileProvider } from "../../../src/features/providers/provider-factory";
import { serializeProviderRequest } from "../../../src/features/providers/provider-profile-serializer";
import { ProviderTransport } from "../../../src/features/providers/protocols/shared/provider-transport";

test("catalog contains exactly 4 foreign, 23 domestic and 1 custom profiles with unique complete metadata", () => {
  const catalog = new ProviderProfileCatalog();
  const profiles = catalog.list();
  assert.equal(profiles.length, 28);
  assert.equal(new Set(profiles.map((profile) => profile.id)).size, 28);
  assert.deepEqual(
    Object.fromEntries(["international", "domestic-model", "domestic-platform", "custom"].map((category) => [
      category,
      profiles.filter((profile) => profile.category === category).length,
    ])),
    { international: 4, "domestic-model": 13, "domestic-platform": 10, custom: 1 },
  );
  for (const profile of profiles) {
    assert.ok(profile.label);
    assert.ok(profile.vendor);
    assert.ok(profile.protocol);
    assert.ok(profile.endpoint.placeholder);
    assert.ok(profile.auth.length);
    assert.ok(profile.evidenceLabel);
    assert.ok(profile.cachePolicyId);
    assert.ok(profile.documentation.length > 0 || profile.category === "custom");
    assert.deepEqual(Object.keys(profile.capabilities).sort(), ["cache", "reasoning", "stream", "tools", "usage"]);
  }
});

test("all 28 profiles match the exact protocol, endpoint, auth, cache, continuation and capability fact table", () => {
  const actual = Object.fromEntries(new ProviderProfileCatalog().list().map((profile) => [profile.id, profileFact(profile)]));
  assert.deepEqual(actual, EXPECTED_PROFILE_FACTS);
});

test("every profile has a serializer, endpoint fail-closed rule, and complete auth projection", async () => {
  const catalog = new ProviderProfileCatalog();
  for (const profile of catalog.list()) {
    const configuredEndpoint = profile.endpoint.defaultUrl ?? `https://local.invalid/${profile.id}/generate`;
    const configuration = {
      profileId: profile.id,
      endpoint: profile.endpoint.mode === "fixed" ? undefined : configuredEndpoint,
      models: ["contract-model"],
      selectedModel: "contract-model",
      connectionState: "ready" as const,
      message: "contract",
    };
    const request = providerRequest(profile.id);
    const serialized = serializeProviderRequest(profile, request);
    assert.equal(serialized.model, "contract-model", profile.id);
    assert.equal(JSON.stringify(serialized).includes("undefined"), false, profile.id);
    if (profile.capabilities.tools === "unsupported") {
      assert.equal(serializedTools(serialized).length, 0, profile.id);
    }

    if (profile.endpoint.mode !== "fixed") {
      const missing = new ProviderTransport({ profile, configuration: { ...configuration, endpoint: undefined }, resolveSecret: async () => "fixture-value", fetchImpl: async () => new Response("{}") });
      assert.throws(() => missing.endpoint(), /无效/u, profile.id);
    }

    let capturedUrl = "";
    let capturedHeaders = new Headers();
    const transport = new ProviderTransport({
      profile,
      configuration,
      resolveSecret: async (fieldId) => `fixture-${profile.id}-${fieldId}`,
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedHeaders = new Headers(init?.headers);
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    await transport.request({ method: "POST" });
    for (const field of profile.auth) {
      const expected = `${field.prefix ?? ""}fixture-${profile.id}-${field.id}`;
      if (field.placement === "header") assert.equal(capturedHeaders.get(field.name), expected, `${profile.id}:${field.id}`);
      else assert.equal(new URL(capturedUrl).searchParams.get(field.name), expected, `${profile.id}:${field.id}`);
    }
    if (profile.id === "gemini") {
      assert.equal(capturedHeaders.get("x-goog-api-key"), "fixture-gemini-api-key");
      assert.equal(new URL(capturedUrl).searchParams.has("key"), false);
    }
  }
});

test("manual endpoints stay unselectable until endpoint, credentials and model are all present", () => {
  const catalog = new ProviderProfileCatalog();
  const settings = catalog.normalizeSettings(null);
  const profile = catalog.list().find((item) => item.endpoint.mode === "manual")!;
  settings.profiles[profile.id].models = ["manual-model"];
  settings.profiles[profile.id].selectedModel = "manual-model";
  let state = catalog.state(settings, profile.id, () => true);
  assert.equal(state.endpointReady, false);
  assert.equal(state.selectable, false);
  settings.profiles[profile.id].endpoint = "https://local.invalid/v1/chat/completions";
  state = catalog.state(settings, profile.id, () => true);
  assert.equal(state.endpointReady, true);
  assert.equal(state.selectable, true);
});

test("tool capability evidence and effective model switches are separate", async () => {
  const catalog = new ProviderProfileCatalog();
  for (const profileId of ["baichuan", "yi", "modelscope", "unicom-yuanjing"]) {
    const profile = catalog.get(profileId);
    assert.equal(serializedTools(serializeProviderRequest(profile, providerRequest(profileId))).length, 0, profileId);
  }
  for (const profileId of ["stepfun", "deepseek"]) {
    const profile = catalog.get(profileId);
    assert.equal(serializedTools(serializeProviderRequest(profile, providerRequest(profileId))).length, 1, profileId);
  }

  const settings = catalog.normalizeSettings(null);
  const configuration = settings.profiles["openai-compatible"];
  configuration.endpoint = "https://local.invalid/v1/chat/completions";
  configuration.models = ["custom-model"];
  configuration.selectedModel = "custom-model";
  configuration.enabledCapabilitiesByModel = {
    "custom-model": { stream: true, usage: true, tools: false, reasoning: false, cache: false },
  };
  const request = providerRequest("openai-compatible");
  request.selectedModel = "custom-model";
  assert.equal(serializedTools(serializeProviderRequest(catalog.get("openai-compatible"), request, configuration)).length, 0);

  let capturedBody: Record<string, unknown> = {};
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response([
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"custom-call\",\"function\":{\"name\":\"demo.inspect\",\"arguments\":\"{}\"}}]}}]}",
      "",
      "data: [DONE]",
      "",
    ].join("\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;
  const disabled = createProfileProvider({
    profile: catalog.effectiveProfile(settings, "openai-compatible"),
    configuration,
    resolveSecret: async () => "local-fixture",
    fetchImpl,
  });
  await assert.rejects(async () => {
    for await (const _event of disabled.stream(request, new AbortController().signal)) void _event;
  }, /未启用工具能力/u);
  assert.equal(serializedTools(capturedBody).length, 0);

  configuration.enabledCapabilitiesByModel["custom-model"].tools = true;
  const enabled = createProfileProvider({
    profile: catalog.effectiveProfile(settings, "openai-compatible"),
    configuration,
    resolveSecret: async () => "local-fixture",
    fetchImpl,
  });
  const events = [];
  for await (const event of enabled.stream(request, new AbortController().signal)) events.push(event);
  assert.equal(serializedTools(capturedBody).length, 1);
  assert.equal(events.some((event) => event.kind === "tool-call.completed"), true);
});

function providerRequest(profileId: string): ProviderRequest {
  const tools = [{
    name: "demo.inspect",
    description: "本地检查",
    inputSchema: { type: "object" as const, properties: {}, additionalProperties: false },
    readOnly: true,
    permission: "auto-read-only" as const,
  }];
  const history = [{ id: "user-1", role: "user" as const, items: [{ type: "text" as const, text: "contract" }] }];
  const contextProfile = buildContextProfile({ providerId: profileId, modelId: "contract-model", tools, history: [] });
  return {
    sessionId: "session-contract",
    profileId,
    selectedModel: "contract-model",
    permissionMode: "auto",
    history,
    tools,
    contextProfile,
    cachePlan: buildCachePlan("contract", contextProfile),
  };
}

function serializedTools(serialized: Record<string, unknown>): unknown[] {
  const tools = serialized.tools;
  return Array.isArray(tools) ? tools : [];
}

const OFFICIAL = "officially-documented" as const;
const DEPENDENT = "profile-dependent" as const;
const UNCONFIRMED = "manual-unconfirmed" as const;
const UNSUPPORTED = "unsupported" as const;
const BEARER = ["header|Authorization|Bearer "];
const ANTHROPIC_KEY = ["header|x-api-key|"];

const EXPECTED_PROFILE_FACTS = {
  openai: fact("openai-responses", "fixed", "https://api.openai.com/v1/responses", BEARER, "openai-gpt", "server-optional", OFFICIAL, OFFICIAL, OFFICIAL, "openai-models", "https://api.openai.com/v1/models"),
  anthropic: fact("anthropic-messages", "fixed", "https://api.anthropic.com/v1/messages", ANTHROPIC_KEY, "anthropic-auto", "stateless", OFFICIAL, OFFICIAL, OFFICIAL),
  xai: fact("openai-responses", "fixed", "https://api.x.ai/v1/responses", BEARER, "xai", "server-optional", OFFICIAL, OFFICIAL, OFFICIAL, "openai-models", "https://api.x.ai/v1/models"),
  gemini: fact("gemini-interactions", "fixed", "https://generativelanguage.googleapis.com/v1/interactions", ["header|x-goog-api-key|"], "gemini-implicit", "stateless", OFFICIAL, OFFICIAL, OFFICIAL),
  deepseek: fact("openai-chat", "fixed", "https://api.deepseek.com/chat/completions", BEARER, "provider-reported", "local-history", OFFICIAL, OFFICIAL, OFFICIAL, "openai-models", "https://api.deepseek.com/models"),
  "zhipu-glm": fact("openai-chat", "fixed", "https://open.bigmodel.cn/api/paas/v4/chat/completions", BEARER, "provider-reported", "local-history", OFFICIAL, OFFICIAL, OFFICIAL),
  "moonshot-kimi": fact("openai-chat", "fixed", "https://api.moonshot.cn/v1/chat/completions", BEARER, "provider-reported", "local-history", OFFICIAL, OFFICIAL, OFFICIAL),
  minimax: fact("anthropic-messages", "fixed", "https://api.minimaxi.com/anthropic/v1/messages", ANTHROPIC_KEY, "minimax-auto", "stateless", OFFICIAL, OFFICIAL, OFFICIAL),
  stepfun: fact("openai-chat", "fixed", "https://api.stepfun.com/v1/chat/completions", BEARER, "unconfirmed", "local-history", OFFICIAL, DEPENDENT, UNCONFIRMED),
  "iflytek-spark": fact("openai-chat", "fixed", "https://spark-api-open.xf-yun.com/x2/chat/completions", BEARER, "unconfirmed", "local-history", OFFICIAL, OFFICIAL, UNCONFIRMED),
  baichuan: fact("openai-chat", "fixed", "https://api.baichuan-ai.com/v1/chat/completions", BEARER, "unconfirmed", "local-history", UNCONFIRMED, DEPENDENT, UNCONFIRMED),
  yi: fact("openai-chat", "fixed", "https://api.lingyiwanwu.com/v1/chat/completions", BEARER, "unconfirmed", "local-history", UNCONFIRMED, DEPENDENT, UNCONFIRMED),
  sensenova: fact("sensenova", "fixed", "https://api.sensenova.cn/v1/llm/chat-completions", BEARER, "unsupported", "stateless", UNSUPPORTED, UNSUPPORTED, UNSUPPORTED),
  "xiaomi-mimo": fact("openai-responses", "fixed", "https://api.xiaomimimo.com/v1/responses", BEARER, "mimo-local-history", "local-history", OFFICIAL, OFFICIAL, OFFICIAL),
  longcat: fact("anthropic-messages", "fixed", "https://api.longcat.chat/anthropic/v1/messages", BEARER, "provider-reported", "stateless", OFFICIAL, OFFICIAL, DEPENDENT, "openai-models", "https://api.longcat.chat/v1/models"),
  "360-zhinao": fact("openai-responses", "manual", undefined, BEARER, "unconfirmed", "local-history", DEPENDENT, DEPENDENT, DEPENDENT),
  "ant-ling": fact("anthropic-messages", "fixed", "https://api.ant-ling.com/anthropic/v1/messages", ANTHROPIC_KEY, "unconfirmed", "stateless", OFFICIAL, OFFICIAL, UNCONFIRMED),
  "alibaba-bailian": fact("openai-responses", "regional", undefined, BEARER, "provider-reported", "server-optional", OFFICIAL, OFFICIAL, OFFICIAL),
  "volcengine-ark": fact("openai-responses", "fixed", "https://ark.cn-beijing.volces.com/api/v3/responses", BEARER, "provider-reported", "server-optional", OFFICIAL, OFFICIAL, OFFICIAL),
  "tencent-tokenhub": fact("openai-responses", "regional", undefined, BEARER, "provider-reported", "server-optional", OFFICIAL, OFFICIAL, OFFICIAL),
  "baidu-qianfan": fact("openai-responses", "fixed", "https://qianfan.baidubce.com/v2/responses", BEARER, "provider-reported", "server-optional", OFFICIAL, OFFICIAL, DEPENDENT),
  "huawei-maas": fact("openai-chat", "regional", undefined, BEARER, "provider-reported", "local-history", OFFICIAL, OFFICIAL, OFFICIAL),
  "ctyun-telechat": fact("openai-chat", "manual", undefined, ["header|X-APP-ID|", "header|Order-Num|", "header|Authorization|Bearer "], "unconfirmed", "local-history", OFFICIAL, DEPENDENT, UNCONFIRMED),
  "unicom-yuanjing": fact("openai-chat", "fixed", "https://maas-api.ai-yuanjing.com/openapi/compatible-mode/v1/chat/completions", BEARER, "unconfirmed", "local-history", DEPENDENT, DEPENDENT, UNCONFIRMED),
  siliconflow: fact("openai-chat", "fixed", "https://api.siliconflow.cn/v1/chat/completions", BEARER, "provider-reported", "local-history", OFFICIAL, OFFICIAL, DEPENDENT, "openai-models", "https://api.siliconflow.cn/v1/models"),
  modelscope: fact("openai-chat", "fixed", "https://api-inference.modelscope.cn/v1/chat/completions", BEARER, "unconfirmed", "local-history", DEPENDENT, DEPENDENT, UNCONFIRMED, "openai-models", "https://api-inference.modelscope.cn/v1/models"),
  "jdcloud-joybuilder": fact("openai-chat", "manual", undefined, BEARER, "unconfirmed", "local-history", OFFICIAL, DEPENDENT, UNCONFIRMED),
  "openai-compatible": fact("openai-chat", "manual", undefined, BEARER, "unsupported", "local-history", UNCONFIRMED, UNCONFIRMED, UNCONFIRMED),
};

function profileFact(profile: ProviderProfile) {
  return {
    protocol: profile.protocol,
    endpoint: { mode: profile.endpoint.mode, defaultUrl: profile.endpoint.defaultUrl },
    modelDiscovery: { mode: profile.modelDiscovery.mode, endpoint: profile.modelDiscovery.endpoint },
    auth: profile.auth.map((field) => `${field.placement}|${field.name}|${field.prefix ?? ""}`),
    cachePolicyId: profile.cachePolicyId,
    continuationMode: profile.continuationMode,
    capabilities: {
      tools: profile.capabilities.tools,
      reasoning: profile.capabilities.reasoning,
      cache: profile.capabilities.cache,
    },
  };
}

function fact(
  protocol: ProviderProtocolFamily,
  endpointMode: ProviderProfile["endpoint"]["mode"],
  defaultUrl: string | undefined,
  auth: string[],
  cachePolicyId: string,
  continuationMode: ProviderProfile["continuationMode"],
  tools: CapabilityEvidence,
  reasoning: CapabilityEvidence,
  cache: CapabilityEvidence,
  modelDiscoveryMode: ProviderProfile["modelDiscovery"]["mode"] = "manual",
  modelEndpoint?: string,
) {
  return {
    protocol,
    endpoint: { mode: endpointMode, defaultUrl },
    modelDiscovery: { mode: modelDiscoveryMode, endpoint: modelEndpoint },
    auth,
    cachePolicyId,
    continuationMode,
    capabilities: { tools, reasoning, cache },
  };
}
