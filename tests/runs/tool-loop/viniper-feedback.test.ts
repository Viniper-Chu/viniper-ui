import assert from "node:assert/strict";
import { test } from "node:test";
import { ProviderEvent, ProviderRequest, ProviderToolCallItem } from "../../../src/core/provider-contracts";
import { buildCachePlan, buildContextProfile } from "../../../src/features/cache/cache-plan";
import { ModelProvider } from "../../../src/features/providers/model-provider";
import { ProviderTransportError } from "../../../src/features/providers/protocols/shared/provider-transport";
import { PermissionPolicy } from "../../../src/features/permissions/permission-policy";
import { ToolRegistry } from "../../../src/features/tools/tool-registry";
import { ToolResourceCoordinator } from "../../../src/features/tools/resource-lock";
import {
  dispatchToolCall, ReviewExecutionPlan, runAgentToolLoop,
} from "../../../src/features/runs/tool-loop/agent-tool-loop";

test("review never treats repeated edits as verification", async () => {
  const fixture = setup([
    [callEvent("write-1", "project.write")],
    [callEvent("write-2", "project.write")],
    [callEvent("write-3", "project.write")],
    [{ kind: "text.delta", text: "文件已经写好，还需要运行测试。" }],
  ]);
  await runAgentToolLoop(fixture.options);
  assert.equal(fixture.plan.steps.find((step) => step.id === "verify")?.status, "pending");
  assert.equal(fixture.plan.steps.find((step) => step.id === "execute")?.status, "in_progress");
  const projections = fixture.events.filter((event) => event.type === "plan.updated");
  assert.equal(projections.some((event) => JSON.stringify(event.payload).includes("人工确认")), false);
});

test("review confirms verification only after a successful post-edit check", async () => {
  const fixture = setup([
    [callEvent("write", "project.write")],
    [callEvent("read", "project.read")],
    [{ kind: "text.delta", text: "已检查文件。" }],
  ]);
  await runAgentToolLoop(fixture.options);
  assert.deepEqual(fixture.plan.steps.map((step) => step.status), ["completed", "completed", "completed"]);
});

test("review does not complete a failed action when the Provider returns a final explanation", async () => {
  const fixture = setup([
    [callEvent("failed-write", "project.write")],
    [{ kind: "text.delta", text: "写入失败，需要调整目录。" }],
  ], { writeFails: true });
  await runAgentToolLoop(fixture.options);
  assert.equal(fixture.plan.steps.some((step) => step.status === "blocked"), true);
  assert.equal(fixture.plan.steps.find((step) => step.id === "verify")?.status, "pending");
});

test("review allows equivalent polling inputs when their results changed", async () => {
  const fixture = setup([
    [callEvent("poll-1", "project.read")],
    [callEvent("poll-2", "project.read")],
    [{ kind: "text.delta", text: "后台任务已完成。" }],
  ], { changingReads: true });
  const result = await runAgentToolLoop(fixture.options);
  assert.equal(result.assistantText, "后台任务已完成。");
  assert.equal(fixture.provider.requests.length, 3);
});

test("a cancelled run cannot open a Provider stream", async () => {
  const fixture = setup([[{ kind: "text.delta", text: "must not run" }]]);
  fixture.controller.abort();
  await assert.rejects(runAgentToolLoop(fixture.options), /取消/u);
  assert.equal(fixture.provider.requests.length, 0);
});

test("Provider deltas reach the run while the generator is still waiting for the rest", async () => {
  const fixture = setup([]);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { started = resolve; });
  fixture.provider.stream = async function* () {
    yield { kind: "text.delta", text: "第一段" };
    started();
    await gate;
    yield { kind: "text.delta", text: "第二段" };
  };
  const received: string[] = [];
  const running = runAgentToolLoop({ ...fixture.options, onProviderEvent: async (event) => {
    if (event.kind === "text.delta") received.push(event.text);
  } });
  try {
    await entered;
    assert.deepEqual(received, ["第一段"]);
  } finally { release(); await running; }
  assert.deepEqual(received, ["第一段", "第二段"]);
});

test("a transport failure after visible text preserves the text without retrying or duplicating it", async () => {
  const fixture = setup([]);
  let attempts = 0;
  fixture.provider.stream = async function* () {
    attempts += 1;
    yield { kind: "text.delta", text: "部分输出" };
    throw new ProviderTransportError("server");
  };
  const received: string[] = [];
  await assert.rejects(runAgentToolLoop({ ...fixture.options, onProviderEvent: async (event) => {
    if (event.kind === "text.delta") received.push(event.text);
  } }), ProviderTransportError);
  assert.deepEqual(received, ["部分输出"]);
  assert.equal(attempts, 1);
});

test("cancellation during retry backoff returns without opening another request", async () => {
  const fixture = setup([]);
  let attempts = 0;
  fixture.provider.stream = async function* () { attempts += 1; throw new ProviderTransportError("server"); };
  const start = performance.now();
  await assert.rejects(runAgentToolLoop({
    ...fixture.options, providerRetryDelayMs: 5_000,
    onProviderRetry: () => { setTimeout(() => fixture.controller.abort(), 20); },
  }), /取消/u);
  assert.equal(attempts, 1);
  assert.ok(performance.now() - start < 1000, "stop should interrupt the retry delay");
});

test("cancelling while a tool is announced prevents execution even in full access", async () => {
  const fixture = setup([]);
  fixture.options.request.permissionMode = "full";
  fixture.options.emit = async (type, payload) => {
    fixture.events.push({ type, payload });
    if (type === "tool.requested") fixture.controller.abort();
  };
  await assert.rejects(dispatchToolCall(call("cancel-write", "project.write"), fixture.options, fixture.options.request.tools), /取消/u);
  assert.equal(fixture.writes(), 0);
  assert.equal(fixture.events.some((event) => event.type === "tool.cancelled"), true);
});

test("a tool cancellation is never returned to the Provider as a successful result", async () => {
  const fixture = setup([]);
  fixture.registry.register({
    name: "project.cancelled",
    description: "Cancelled tool",
    readOnly: true,
    inputSchema: { type: "object", properties: {} },
    async execute(request) { return { toolId: request.id, text: "已取消", cancelled: true }; },
  });
  fixture.options.request.tools = fixture.registry.descriptors();
  const result = await dispatchToolCall(call("cancelled", "project.cancelled"), fixture.options, fixture.options.request.tools);
  assert.equal(result.isError, true);
  assert.equal(fixture.events.some((event) => event.type === "tool.cancelled"), true);
});

test("cancelling a resource wait closes the waiting card and tool activity", async () => {
  const fixture = setup([]);
  const coordinator = new ToolResourceCoordinator();
  const claims = [{ key: "project-resource", access: "write" as const }];
  const lease = await coordinator.acquire(claims, new AbortController().signal);
  fixture.registry.register({
    name: "project.locked",
    description: "Wait for project",
    readOnly: true,
    inputSchema: { type: "object", properties: {} },
    resourceClaims: () => claims,
    async execute(request) { return { toolId: request.id, text: "must not execute" }; },
  });
  fixture.options.request.tools = fixture.registry.descriptors();
  fixture.options.emit = async (type, payload) => {
    fixture.events.push({ type, payload });
    if (type === "interaction.requested") fixture.controller.abort();
  };
  try {
    await assert.rejects(dispatchToolCall(call("locked", "project.locked"), {
      ...fixture.options, resourceCoordinator: coordinator,
    }, fixture.options.request.tools), /取消/u);
    const wait = fixture.events.find((event) => event.type === "interaction.requested")?.payload as { id: string };
    assert.equal(fixture.events.some((event) => event.type === "interaction.resolved"
      && (event.payload as { activityId?: string }).activityId === wait.id), true);
    assert.equal(fixture.events.some((event) => event.type === "tool.cancelled"), true);
  } finally { lease.release(); }
});

function setup(rounds: ProviderEvent[][], flags: { writeFails?: boolean; changingReads?: boolean } = {}) {
  const provider = new ScriptedProvider(rounds);
  const registry = new ToolRegistry();
  let writes = 0;
  let reads = 0;
  registry.register({
    name: "project.write", description: "Write project", readOnly: false, authorizationScope: "project",
    inputSchema: { type: "object", properties: {} },
    async execute(request) { writes += 1; return { toolId: request.id, text: flags.writeFails ? "failed" : "written", isError: flags.writeFails === true }; },
  });
  registry.register({
    name: "project.read", description: "Read project", readOnly: true, authorizationScope: "project",
    inputSchema: { type: "object", properties: {} },
    async execute(request) { reads += 1; return { toolId: request.id, text: flags.changingReads ? `status ${reads}` : "checked" }; },
  });
  const contextProfile = buildContextProfile({ providerId: "scripted", modelId: "scripted-model", tools: registry.descriptors(), history: [] });
  const request: ProviderRequest = {
    sessionId: "session-feedback", profileId: "scripted", selectedModel: "scripted-model", permissionMode: "review",
    tools: registry.descriptors(), history: [], contextProfile, cachePlan: buildCachePlan("检查", contextProfile),
  };
  const plan: ReviewExecutionPlan = {
    id: "feedback-plan", checkpointId: "inspect", steps: [
      { id: "inspect", title: "检查", status: "in_progress" },
      { id: "execute", title: "执行", status: "pending" },
      { id: "verify", title: "验证", status: "pending" },
    ],
  };
  const events: Array<{ type: string; payload: unknown }> = [];
  const controller = new AbortController();
  const policy = new PermissionPolicy("interactive", () => 100);
  void policy.setAccess(request.sessionId, "C:/project", "project-run");
  policy.freezeRun(request.sessionId, "feedback-run", "C:/project");
  const options = {
    provider, request, toolRegistry: registry, runId: "feedback-run", projectRoot: "C:/project",
    permissionPolicy: policy, signal: controller.signal, now: () => 100, reviewPlan: plan,
    onProviderEvent: async () => undefined,
    appendHistory: async () => undefined,
    emit: async (type: string, payload: unknown) => { events.push({ type, payload }); },
  };
  return { options, provider, registry, plan, events, controller, writes: () => writes };
}

class ScriptedProvider implements ModelProvider {
  readonly descriptor = {
    id: "scripted", name: "Scripted", label: "本地测试", configuration: "demo" as const,
    available: true, realCallsEnabled: false, capabilities: ["tools"], models: [{ id: "scripted-model", label: "Scripted" }],
  };
  readonly requests: ProviderRequest[] = [];
  constructor(private readonly rounds: ProviderEvent[][]) {}
  async *stream(request: ProviderRequest): AsyncIterable<ProviderEvent> {
    this.requests.push(request);
    yield* this.rounds[this.requests.length - 1] ?? [];
  }
}

function call(callId: string, name: string): ProviderToolCallItem {
  return { type: "tool-call", callId, name, argumentsText: "{}", arguments: {}, protocolItemId: callId };
}

function callEvent(callId: string, name: string): ProviderEvent {
  return { kind: "tool-call.completed", call: call(callId, name) };
}
