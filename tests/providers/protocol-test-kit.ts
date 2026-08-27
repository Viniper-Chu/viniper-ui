import assert from "node:assert/strict";
import { createServer, IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import {
  ProviderCapabilities,
  ProviderEvent,
  ProviderProfile,
  ProviderProtocolFamily,
  ProviderRequest,
} from "../../src/core/provider-contracts";
import { buildCachePlan, buildContextProfile } from "../../src/features/cache/cache-plan";
import { ModelProvider } from "../../src/features/providers/model-provider";
import { runAgentToolLoop } from "../../src/features/runs/tool-loop/agent-tool-loop";
import { ToolRegistry } from "../../src/features/tools/tool-registry";

export interface CapturedRequest {
  body: Record<string, unknown>;
  headers: IncomingHttpHeaders;
}

export interface FakeSseEvent {
  event?: string;
  data: unknown;
}

export async function withProtocolFake(
  eventsFor: (request: CapturedRequest, index: number) => FakeSseEvent[],
  run: (endpoint: string, requests: CapturedRequest[]) => Promise<void>,
): Promise<void> {
  const requests: CapturedRequest[] = [];
  const server = createServer(async (request, response) => {
    const body = JSON.parse(await readBody(request)) as Record<string, unknown>;
    const captured = { body, headers: request.headers };
    requests.push(captured);
    const model = String(body.model ?? "");
    const errorStatus = /^error-(\d+)$/u.exec(model)?.[1];
    if (errorStatus) {
      response.writeHead(Number(errorStatus), { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "sensitive body must not surface", token: "fixture-secret" } }));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    response.flushHeaders();
    if (model === "cancel") {
      setTimeout(() => response.end(), 2_000).unref();
      return;
    }
    await writeFragmented(response, eventsFor(captured, requests.length - 1));
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}/v1/fake`, requests);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

export function testProfile(protocol: ProviderProtocolFamily, endpoint: string): ProviderProfile {
  return {
    id: `fake-${protocol}`,
    label: `Fake ${protocol}`,
    category: "custom",
    vendor: `Fake ${protocol}`,
    protocol,
    endpoint: { mode: "fixed", defaultUrl: endpoint, placeholder: endpoint },
    auth: [{ id: "api-key", label: "API Key", placement: "header", name: "Authorization", prefix: "Bearer ", required: true }],
    modelDiscovery: { mode: "manual" },
    capabilities: allCapabilities(protocol === "sensenova" ? "unsupported" : "officially-documented"),
    evidenceLevel: "officially-documented",
    evidenceLabel: "本地 fake",
    documentation: [],
    cachePolicyId: protocol === "anthropic-messages" ? "anthropic-auto" : protocol === "gemini-interactions" ? "gemini-implicit" : "provider-reported",
    continuationMode: protocol === "gemini-interactions" ? "stateless" : "local-history",
  };
}

export function providerOptions(profile: ProviderProfile, model = "fake-model") {
  return {
    profile,
    configuration: {
      profileId: profile.id,
      endpoint: profile.endpoint.defaultUrl,
      models: [model],
      selectedModel: model,
      connectionState: "connected" as const,
      message: "本地 fake",
    },
    resolveSecret: async () => "local-fake-credential",
  };
}

export function protocolRequest(profile: ProviderProfile, model = "fake-model"): ProviderRequest {
  const tools = [{
    name: "demo.inspect",
    description: "检查本地 Demo",
    inputSchema: { type: "object" as const, properties: { topic: { type: "string" as const } }, required: ["topic"], additionalProperties: false },
    readOnly: true,
    permission: "auto-read-only" as const,
  }];
  const history = [{ id: "user-1", role: "user" as const, items: [{ type: "text" as const, text: "检查队列" }] }];
  const contextProfile = buildContextProfile({ providerId: profile.id, modelId: model, tools, history: [] });
  return {
    sessionId: "session-fake",
    profileId: profile.id,
    selectedModel: model,
    permissionMode: "auto",
    history,
    tools,
    contextProfile,
    cachePlan: buildCachePlan("检查队列", contextProfile),
  };
}

export async function runProtocolToolLoop(provider: ModelProvider, request: ProviderRequest) {
  const registry = new ToolRegistry();
  const executedCallIds: string[] = [];
  registry.register({
    name: "demo.inspect",
    description: "检查本地 Demo",
    readOnly: true,
    inputSchema: request.tools[0].inputSchema,
    async execute(toolRequest) {
      executedCallIds.push(toolRequest.id);
      return { toolId: toolRequest.id, text: "本地工具结果：队列正常" };
    },
  });
  const projected: ProviderEvent[] = [];
  const appendedHistory: ProviderRequest["history"] = [];
  const result = await runAgentToolLoop({
    provider,
    request,
    toolRegistry: registry,
    projectRoot: process.cwd(),
    signal: new AbortController().signal,
    now: () => 100,
    onProviderEvent: async (event) => { projected.push(event); },
    appendHistory: async (entries) => { appendedHistory.push(...JSON.parse(JSON.stringify(entries)) as ProviderRequest["history"]); },
    emit: async () => undefined,
  });
  return { result, projected, executedCallIds, appendedHistory };
}

export async function assertProtocolErrorAndCancellation(
  createProvider: (model: string) => ModelProvider,
  profile: ProviderProfile,
): Promise<void> {
  for (const [model, pattern] of [
    ["error-401", /鉴权/u],
    ["error-402", /余额|配额/u],
    ["error-429", /频繁/u],
    ["error-503", /暂时不可用/u],
  ] as const) {
    const iterator = createProvider(model).stream(protocolRequest(profile, model), new AbortController().signal)[Symbol.asyncIterator]();
    await assert.rejects(iterator.next(), (error) => {
      const text = error instanceof Error ? error.message : String(error);
      return pattern.test(text) && !text.includes("fixture-secret");
    });
  }

  const controller = new AbortController();
  const iterator = createProvider("cancel").stream(protocolRequest(profile, "cancel"), controller.signal)[Symbol.asyncIterator]();
  const pending = iterator.next();
  setTimeout(() => controller.abort(), 20).unref();
  await assert.rejects(pending, /取消|abort/iu);
}

function allCapabilities(tools: "officially-documented" | "unsupported"): ProviderCapabilities {
  return {
    stream: "officially-documented",
    tools,
    reasoning: tools,
    cache: tools,
    usage: "officially-documented",
  };
}

async function writeFragmented(response: ServerResponse, events: FakeSseEvent[]): Promise<void> {
  response.write(": keep-alive\n\n");
  response.write("\n");
  for (const item of events) {
    const frame = `${item.event ? `event: ${item.event}\n` : ""}data: ${typeof item.data === "string" ? item.data : JSON.stringify(item.data)}\n\n`;
    const first = Math.max(1, Math.floor(frame.length / 3));
    const second = Math.max(first + 1, Math.floor(frame.length * 2 / 3));
    response.write(frame.slice(0, first));
    await nextTurn();
    response.write(frame.slice(first, second));
    await nextTurn();
    response.write(frame.slice(second));
  }
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
