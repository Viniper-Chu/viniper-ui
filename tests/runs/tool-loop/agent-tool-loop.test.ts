import assert from "node:assert/strict";
import { test } from "node:test";
import { ProviderEvent, ProviderRequest } from "../../../src/core/provider-contracts";
import { buildCachePlan, buildContextProfile } from "../../../src/features/cache/cache-plan";
import { ModelProvider } from "../../../src/features/providers/model-provider";
import {
  ProviderRequestBudgetExceededError,
  ProviderFinalAnswerMissingError,
  ReviewNoProgressError,
  runAgentToolLoop,
  ToolLoopLimitError,
} from "../../../src/features/runs/tool-loop/agent-tool-loop";
import { ToolRegistry } from "../../../src/features/tools/tool-registry";

test("tool loop preserves the provider call id and continues with the canonical local result", async () => {
  const provider = new ScriptedProvider([
    [{ kind: "tool-call.completed", call: toolCall("provider-call-17", "demo.inspect", "{\"topic\":\"queue\"}") }],
    [{ kind: "text.delta", text: "已完成检查" }],
  ]);
  const registry = new ToolRegistry();
  let executions = 0;
  registry.register({
    name: "demo.inspect",
    description: "检查 Demo 状态",
    readOnly: true,
    inputSchema: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"], additionalProperties: false },
    async execute(request) {
      executions += 1;
      assert.equal(request.id, "provider-call-17");
      assert.deepEqual(request.input, { topic: "queue" });
      return { toolId: request.id, text: "本地结果" };
    },
  });
  const appended = [];
  const result = await runAgentToolLoop({
    provider,
    request: providerRequest(registry, "auto"),
    toolRegistry: registry,
    projectRoot: process.cwd(),
    signal: new AbortController().signal,
    now: () => 100,
    onProviderEvent: async () => undefined,
    emit: async () => undefined,
    appendHistory: async (entries) => { appended.push(...entries); },
  });

  assert.equal(result.assistantText, "已完成检查");
  assert.equal(executions, 1);
  const continued = provider.requests[1].history.at(-1)?.items[0];
  assert.deepEqual(continued, {
    type: "tool-result",
    callId: "provider-call-17",
    name: "demo.inspect",
    content: "本地结果",
    isError: false,
  });
  assert.equal(appended.length, 3);
});

test("tool completion followed by an empty Provider turn fails instead of publishing a false success", async () => {
  const provider = new ScriptedProvider([
    [{ kind: "tool-call.completed", call: toolCall("empty-final-1", "demo.inspect", "{\"topic\":1}") }],
    [],
  ]);
  const registry = inspectRegistry();
  await assert.rejects(runAgentToolLoop({
    provider,
    request: providerRequest(registry, "auto"),
    toolRegistry: registry,
    projectRoot: process.cwd(),
    signal: new AbortController().signal,
    now: () => 100,
    onProviderEvent: async () => undefined,
    appendHistory: async () => undefined,
    emit: async () => undefined,
  }), ProviderFinalAnswerMissingError);
  assert.equal(provider.requests.length, 2, "the tool result must reach exactly one Provider follow-up");
});

test("a provisional pre-tool text cannot satisfy a later empty final Provider turn", async () => {
  const provider = new ScriptedProvider([
    [
      { kind: "text.delta", text: "我会继续检查并在完成后反馈" },
      { kind: "tool-call.completed", call: toolCall("provisional-1", "demo.inspect", "{\"topic\":1}") },
    ],
    [],
  ]);
  const registry = inspectRegistry();

  await assert.rejects(runAgentToolLoop({
    provider,
    request: providerRequest(registry, "auto"),
    toolRegistry: registry,
    projectRoot: process.cwd(),
    signal: new AbortController().signal,
    now: () => 100,
    onProviderEvent: async () => undefined,
    appendHistory: async () => undefined,
    emit: async () => undefined,
  }), ProviderFinalAnswerMissingError);
  assert.equal(provider.requests.length, 2, "the empty follow-up must not be accepted as the final answer");
});

test("unknown, invalid and approval-gated tools never execute and return visible error results", async () => {
  const provider = new ScriptedProvider([
    [{ kind: "tool-call.completed", call: toolCall("unknown-1", "missing.tool", "{}") }],
    [{ kind: "tool-call.completed", call: toolCall("known-1", "demo.inspect", "{}") }],
    [{ kind: "text.delta", text: "已安全停止工具" }],
  ]);
  const registry = new ToolRegistry();
  let executions = 0;
  registry.register({
    name: "demo.inspect",
    description: "检查 Demo 状态",
    readOnly: true,
    inputSchema: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"], additionalProperties: false },
    async execute(request) {
      executions += 1;
      return { toolId: request.id, text: "不应执行" };
    },
  });
  const eventTypes: string[] = [];
  await runAgentToolLoop({
    provider,
    request: providerRequest(registry, "ask"),
    toolRegistry: registry,
    projectRoot: process.cwd(),
    signal: new AbortController().signal,
    now: () => 100,
    onProviderEvent: async () => undefined,
    appendHistory: async () => undefined,
    emit: async (type) => { eventTypes.push(type); },
  });
  assert.equal(executions, 0);
  assert.equal(eventTypes.includes("interaction.requested"), true);
  assert.equal(eventTypes.includes("tool.failed"), true);
  const results = provider.requests.slice(1).map((request) => request.history.at(-1)?.items[0]);
  assert.equal(results.every((item) => item?.type === "tool-result" && item.isError), true);
});

test("tool loop stops visibly at its configured maximum instead of recursing forever", async () => {
  const repeated = Array.from({ length: 3 }, (_, index) => [
    { kind: "tool-call.completed" as const, call: toolCall(`loop-${index}`, "demo.inspect", "{}") },
  ]);
  const provider = new ScriptedProvider(repeated);
  const registry = new ToolRegistry();
  registry.register({
    name: "demo.inspect",
    description: "检查 Demo 状态",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async execute(request) { return { toolId: request.id, text: "继续" }; },
  });
  const events: string[] = [];
  await assert.rejects(runAgentToolLoop({
    provider,
    request: providerRequest(registry, "auto"),
    toolRegistry: registry,
    projectRoot: process.cwd(),
    signal: new AbortController().signal,
    now: () => 100,
    maxRounds: 3,
    onProviderEvent: async () => undefined,
    appendHistory: async () => undefined,
    emit: async (type) => { events.push(type); },
  }), (error) => error instanceof ToolLoopLimitError && error.maxRounds === 3);
  assert.equal(provider.requests.length, 3);
  assert.equal(events.at(-1), "interaction.requested");
});

test("default tool loop completes at least twelve provider tool continuation rounds", async () => {
  const toolRounds: ProviderEvent[][] = Array.from({ length: 12 }, (_, index) => [
    { kind: "tool-call.completed" as const, call: toolCall(`default-long-${index}`, "demo.inspect", "{}") },
  ]);
  toolRounds.push([{ kind: "text.delta" as const, text: "十二轮工具续接已完成" }]);
  const provider = new ScriptedProvider(toolRounds);
  const registry = new ToolRegistry();
  registry.register({
    name: "demo.inspect",
    description: "检查 Demo 状态",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async execute(request) { return { toolId: request.id, text: "继续" }; },
  });

  const result = await runAgentToolLoop({
    provider,
    request: providerRequest(registry, "auto"),
    toolRegistry: registry,
    projectRoot: process.cwd(),
    signal: new AbortController().signal,
    now: () => 100,
    onProviderEvent: async () => undefined,
    appendHistory: async () => undefined,
    emit: async () => undefined,
  });

  assert.equal(result.rounds, 13);
  assert.equal(result.assistantText, "十二轮工具续接已完成");
  assert.equal(provider.requests.length, 13);
});

test("default tool loop stops only after the twenty-fourth tool round", async () => {
  const provider = new ScriptedProvider(Array.from({ length: 25 }, (_, index) => [
    { kind: "tool-call.completed" as const, call: toolCall(`default-limit-${index}`, "demo.inspect", "{}") },
  ]));
  const registry = new ToolRegistry();
  registry.register({
    name: "demo.inspect",
    description: "检查 Demo 状态",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async execute(request) { return { toolId: request.id, text: "继续" }; },
  });

  await assert.rejects(runAgentToolLoop({
    provider,
    request: providerRequest(registry, "auto"),
    toolRegistry: registry,
    projectRoot: process.cwd(),
    signal: new AbortController().signal,
    now: () => 100,
    onProviderEvent: async () => undefined,
    appendHistory: async () => undefined,
    emit: async () => undefined,
  }), (error) => error instanceof ToolLoopLimitError && error.maxRounds === 24);
  assert.equal(provider.requests.length, 24);
});

test("a repeated provider callId reuses the canonical result without executing the tool twice", async () => {
  const duplicate = toolCall("same-call", "demo.inspect", "{}");
  const provider = new ScriptedProvider([
    [{ kind: "tool-call.completed", call: duplicate }],
    [{ kind: "tool-call.completed", call: duplicate }],
    [{ kind: "text.delta", text: "重复调用已收口" }],
  ]);
  const registry = new ToolRegistry();
  let executions = 0;
  registry.register({
    name: "demo.inspect",
    description: "检查 Demo 状态",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async execute(request) {
      executions += 1;
      return { toolId: request.id, text: "唯一结果" };
    },
  });
  const result = await runAgentToolLoop({
    provider,
    request: providerRequest(registry, "auto"),
    toolRegistry: registry,
    projectRoot: process.cwd(),
    signal: new AbortController().signal,
    now: () => 100,
    onProviderEvent: async () => undefined,
    appendHistory: async () => undefined,
    emit: async () => undefined,
  });
  assert.equal(result.assistantText, "重复调用已收口");
  assert.equal(executions, 1);
  assert.deepEqual(provider.requests.slice(1).map((request) => request.history.at(-1)?.items[0]), [
    { type: "tool-result", callId: "same-call", name: "demo.inspect", content: "唯一结果", isError: false },
    { type: "tool-result", callId: "same-call", name: "demo.inspect", content: "唯一结果", isError: false },
  ]);
});

test("registered but unadvertised tools are rejected before execution", async () => {
  const provider = new ScriptedProvider([
    [{ kind: "tool-call.completed", call: toolCall("unadvertised-1", "project.read", "{}") }],
    [{ kind: "text.delta", text: "已安全拒绝" }],
  ]);
  const registry = new ToolRegistry();
  let executions = 0;
  registry.register({
    name: "project.read",
    description: "读取项目",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async execute(request) {
      executions += 1;
      return { toolId: request.id, text: "不应执行" };
    },
  });
  const request = providerRequest(registry, "auto");
  request.tools = [];
  await runAgentToolLoop({
    provider,
    request,
    toolRegistry: registry,
    projectRoot: process.cwd(),
    signal: new AbortController().signal,
    now: () => 100,
    onProviderEvent: async () => undefined,
    appendHistory: async () => undefined,
    emit: async () => undefined,
  });
  assert.equal(executions, 0);
  const result = provider.requests[1].history.at(-1)?.items[0];
  assert.equal(result?.type, "tool-result");
  if (result?.type === "tool-result") {
    assert.equal(result.isError, true);
    assert.match(result.content, /未向本次运行开放|未广告/u);
  }
});

test("provider request budget is reserved before every stream and never overshoots", async () => {
  const provider = new ScriptedProvider(Array.from({ length: 8 }, (_, index) => [
    { kind: "tool-call.completed" as const, call: toolCall(`budget-${index}`, "demo.inspect", JSON.stringify({ topic: index })) },
  ]));
  const registry = inspectRegistry();
  const events: Array<{ type: string; payload: unknown }> = [];

  await assert.rejects(runAgentToolLoop({
    provider,
    request: providerRequest(registry, "auto"),
    toolRegistry: registry,
    projectRoot: process.cwd(),
    signal: new AbortController().signal,
    now: () => 100,
    maxProviderRequests: 3,
    onProviderEvent: async () => undefined,
    appendHistory: async () => undefined,
    emit: async (type, payload) => { events.push({ type, payload }); },
  }), (error) => error instanceof ProviderRequestBudgetExceededError
    && error.limit === 3
    && error.started === 3);

  assert.equal(provider.requests.length, 3, "the fourth Provider stream must never start");
  assert.equal(events.some(({ type, payload }) => type === "interaction.requested"
    && (payload as { reason?: string }).reason === "budget_exhausted"), true);
});

test("provider request budgets are owned by each run and never shared", async () => {
  const registry = inspectRegistry();
  const makeProvider = (prefix: string) => new ScriptedProvider(Array.from({ length: 4 }, (_, index) => [
    { kind: "tool-call.completed" as const, call: toolCall(`${prefix}-${index}`, "demo.inspect", JSON.stringify({ topic: index })) },
  ]));
  const execute = async (provider: ScriptedProvider) => assert.rejects(runAgentToolLoop({
    provider,
    request: providerRequest(registry, "auto"),
    toolRegistry: registry,
    projectRoot: process.cwd(),
    signal: new AbortController().signal,
    now: () => 100,
    maxProviderRequests: 2,
    onProviderEvent: async () => undefined,
    appendHistory: async () => undefined,
    emit: async () => undefined,
  }), (error) => error instanceof ProviderRequestBudgetExceededError
    && error.limit === 2
    && error.started === 2);
  const first = makeProvider("first");
  const second = makeProvider("second");

  await Promise.all([execute(first), execute(second)]);

  assert.equal(first.requests.length, 2);
  assert.equal(second.requests.length, 2);
});

test("review owns a structured checkpoint and stops equivalent read-only calls before another stream", async () => {
  const repeated = Array.from({ length: 6 }, (_, index) => [
    { kind: "tool-call.completed" as const, call: toolCall(`review-read-${index}`, "demo.inspect", '{"topic":"same"}') },
  ]);
  const provider = new ScriptedProvider(repeated);
  const registry = inspectRegistry();
  const events: Array<{ type: string; payload: unknown }> = [];
  const request = providerRequest(registry, "auto");
  request.permissionMode = "review";

  await assert.rejects(runAgentToolLoop({
    provider,
    request,
    toolRegistry: registry,
    projectRoot: process.cwd(),
    signal: new AbortController().signal,
    now: () => 100,
    maxProviderRequests: 6,
    reviewPlan: {
      id: "review-plan-run-a",
      steps: [
        { id: "inspect", title: "检查当前状态", status: "in_progress" },
        { id: "execute", title: "执行计划内动作", status: "pending" },
        { id: "verify", title: "核对结果", status: "pending" },
      ],
      checkpointId: "inspect",
    },
    onProviderEvent: async () => undefined,
    appendHistory: async () => undefined,
    emit: async (type, payload) => { events.push({ type, payload }); },
  }), (error) => error instanceof ReviewNoProgressError
    && error.checkpointId === "inspect");

  assert.equal(provider.requests.length, 2, "the third equivalent read-only request must not start");
  assert.equal(events.some(({ type, payload }) => type === "run.checkpoint"
    && (payload as { reviewPlan?: { checkpointId?: string } }).reviewPlan?.checkpointId === "inspect"), true);
  assert.equal(events.some(({ type, payload }) => type === "interaction.requested"
    && (payload as { reason?: string }).reason === "review_no_progress"), true);
});

function inspectRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    name: "demo.inspect",
    description: "检查 Demo 状态",
    readOnly: true,
    inputSchema: { type: "object", properties: { topic: { type: "number" } }, additionalProperties: false },
    async execute(request) { return { toolId: request.id, text: "只读结果" }; },
  });
  return registry;
}

class ScriptedProvider implements ModelProvider {
  readonly descriptor = {
    id: "scripted",
    name: "Scripted",
    label: "本地测试 Provider",
    configuration: "demo" as const,
    available: true,
    realCallsEnabled: false,
    capabilities: ["tools"],
    models: [{ id: "scripted-model", label: "Scripted" }],
  };
  readonly requests: ProviderRequest[] = [];

  constructor(private readonly rounds: ProviderEvent[][]) {}

  async *stream(request: ProviderRequest): AsyncIterable<ProviderEvent> {
    this.requests.push(clone(request));
    for (const event of this.rounds[this.requests.length - 1] ?? []) yield event;
  }
}

function providerRequest(registry: ToolRegistry, permissionMode: "ask" | "auto"): ProviderRequest {
  const tools = registry.descriptors();
  const history = [{ id: "user-1", role: "user" as const, items: [{ type: "text" as const, text: "检查" }] }];
  const contextProfile = buildContextProfile({ providerId: "scripted", modelId: "scripted-model", tools, history: [] });
  return {
    sessionId: "session-a",
    profileId: "scripted",
    selectedModel: "scripted-model",
    permissionMode,
    history,
    tools,
    contextProfile,
    cachePlan: buildCachePlan("检查", contextProfile),
  };
}

function toolCall(callId: string, name: string, argumentsText: string) {
  return {
    type: "tool-call" as const,
    callId,
    name,
    argumentsText,
    arguments: JSON.parse(argumentsText) as Record<string, unknown>,
    protocolItemId: callId,
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
