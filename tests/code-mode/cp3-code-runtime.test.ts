import assert from "node:assert/strict";
import test from "node:test";
import { ProviderEvent, ProviderRequest } from "../../src/core/provider-contracts";
import { CodeSubcallInput } from "../../src/core/code-mode-contracts";
import { freezeRunContext } from "../../src/features/composition/frozen-run-context";
import { CompositionService } from "../../src/features/composition/composition-service";
import { buildCachePlan, buildContextProfile } from "../../src/features/cache/cache-plan";
import { CodeRuntimeService } from "../../src/features/code-mode/code-runtime";
import { createRunCodeTool } from "../../src/features/code-mode/run-code-tool";
import { PermissionPolicy } from "../../src/features/permissions/permission-policy";
import { ModelProvider } from "../../src/features/providers/model-provider";
import { dispatchToolCall, runAgentToolLoop } from "../../src/features/runs/tool-loop/agent-tool-loop";
import { ToolResourceCoordinator } from "../../src/features/tools/resource-lock";
import { ToolRegistry } from "../../src/features/tools/tool-registry";

test("CP3：Code Mode worker 只通过 SDK 子调用完成 batch，并保留 callId/父子关系", async () => {
  const runtime = new CodeRuntimeService();
  const calls: Array<{ callId: string; parentCallId?: string; name: string }> = [];
  const result = await runtime.run({
    runId: "run-code-1",
    sessionId: "session-code-1",
    mode: "both",
    program: "const first = await sdk.call('demo.inspect', {topic: 'one'}); const second = await sdk.call('demo.inspect', {topic: 'two'}, first.callId); return [first.text, second.text];",
    invoke: async (input) => {
      calls.push({ callId: input.callId, parentCallId: input.parentCallId, name: input.toolName });
      return { text: `结果-${String(input.input.topic)}`, data: { callId: input.callId } };
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, ["结果-one", "结果-two"]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].parentCallId, calls[0].callId);
  assert.equal(result.calls.length, 2);
});

test("CP3：Code Mode 拒绝直通 Node 能力、支持输出上限与取消", async () => {
  const runtime = new CodeRuntimeService({ maxOutputBytes: 24 });
  const rejected = await runtime.run({
    runId: "run-code-2",
    sessionId: "session-code-2",
    mode: "code",
    program: "return process.cwd();",
    invoke: async () => ({ text: "不应调用" }),
  });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error ?? "", /禁止|Node/);

  const controller = new AbortController();
  const pending = runtime.run({
    runId: "run-code-3",
    sessionId: "session-code-3",
    mode: "code",
    program: "await sdk.call('slow', {}); return 'done';",
    signal: controller.signal,
    invoke: async () => new Promise((resolve) => setTimeout(() => resolve({ text: "late" }), 500)),
  });
  controller.abort();
  const cancelled = await pending;
  assert.equal(cancelled.cancelled, true);
});

test("CP3：run_code 作为不可卸载的受管 ToolExecutor 需要宿主子调用端口", async () => {
  const tool = createRunCodeTool(new CodeRuntimeService());
  assert.equal(tool.name, "run_code");
  assert.equal(tool.readOnly, false);
  const result = await tool.execute({
    id: "code-call-1",
    name: "run_code",
    summary: "执行受管 Code Mode",
    readOnly: false,
    scope: "computer",
    input: { mode: "code", program: "return 1;" },
  }, {
    sessionId: "session-code-4",
    runId: "run-code-4",
    signal: new AbortController().signal,
  });
  assert.equal(result.isError, true);
  assert.match(result.text, /子调用|宿主/);
});

test("CP3：run_code descriptor 明确要求完整执行多个 sdk 子调用", () => {
  const tool = createRunCodeTool(new CodeRuntimeService());
  const programDescription = String((tool.inputSchema.properties as Record<string, { description?: string }>).program?.description ?? "");
  assert.match(tool.description, /不得省略|多个子调用/u);
  assert.match(tool.description, /sdk\.parallel/u);
  assert.match(programDescription, /project\.read/u);
  assert.match(programDescription, /terminal\.run/u);
  assert.match(programDescription, /sdk\.parallel/u);
});

test("CP3：正式 AgentToolLoop 广告并执行 run_code，SDK 子调用经权限与资源锁回送 Provider", async () => {
  const provider = new ScriptedProvider([
    [{
      kind: "tool-call.completed",
      call: toolCall("code-call-outer", "run_code", JSON.stringify({
        mode: "both",
        program: "const item = await sdk.call('demo.inspect', {topic: 'nested'}); return item.text;",
      })),
    }],
    [{ kind: "text.delta", text: "Code Mode 结果已回送" }],
  ]);
  const runtime = new CodeRuntimeService();
  const registry = new ToolRegistry();
  const resourceCoordinator = new ToolResourceCoordinator();
  const permissionPolicy = new PermissionPolicy("fail-closed");
  const nestedCalls: string[] = [];
  const events: Array<{ type: string; payload: unknown }> = [];
  registry.register({
    name: "demo.inspect",
    description: "检查嵌套 Demo 状态",
    readOnly: true,
    authorizationScope: "computer",
    inputSchema: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"], additionalProperties: false },
    resourceClaims: () => [{ key: "D:\\fixture-code-mode", access: "read" }],
    async execute(request) {
      nestedCalls.push(request.id);
      return { toolId: request.id, text: "嵌套结果" };
    },
  });
  registry.register(createRunCodeTool(runtime));
  await permissionPolicy.setAccess("session-a", undefined, "computer-run");
  permissionPolicy.freezeRun("session-a", "run-code-formal");

  const nestedInvoker = async (input: CodeSubcallInput) => {
    const nestedRequest = providerRequest(registry, "auto");
    nestedRequest.sessionId = input.sessionId;
    nestedRequest.runId = input.runId;
    const nestedResult = await dispatchToolCall({
      type: "tool-call",
      callId: input.callId,
      parentCallId: input.parentCallId,
      name: input.toolName,
      arguments: input.input,
      argumentsText: JSON.stringify(input.input),
      protocolItemId: input.callId,
    }, {
      request: nestedRequest,
      toolRegistry: registry,
      projectRoot: "D:\\fixture-code-mode",
      authorizationProjectRoot: "D:\\fixture-code-mode",
      signal: input.signal,
      now: () => 100,
      permissionPolicy,
      resourceCoordinator,
      runId: input.runId,
      emit: async (type, payload) => { events.push({ type, payload }); },
    }, nestedRequest.tools);
    return { text: nestedResult.content, isError: nestedResult.isError };
  };
  const request = providerRequest(registry, "auto");
  request.runId = "run-code-formal";
  const result = await runAgentToolLoop({
    provider,
    request,
    toolRegistry: registry,
    permissionPolicy,
    resourceCoordinator,
    codeSubcallInvoker: nestedInvoker,
    runId: "run-code-formal",
    projectRoot: "D:\\fixture-code-mode",
    signal: new AbortController().signal,
    now: () => 100,
    onProviderEvent: async () => undefined,
    appendHistory: async () => undefined,
    emit: async (type, payload) => { events.push({ type, payload }); },
  });

  assert.equal(result.assistantText, "Code Mode 结果已回送");
  assert.equal(nestedCalls.length, 1);
  const nestedRequested = events.find((event) => event.type === "tool.requested"
    && (event.payload as { callId?: string }).callId === "code-call-1");
  assert.equal((nestedRequested?.payload as { parentCallId?: string } | undefined)?.parentCallId, "code-call-outer");
  assert.equal(events.filter((event) => event.type === "tool.completed").length, 2);
  assert.equal(provider.requests[0].tools.some((tool) => tool.name === "run_code"), true);
  const toolResult = provider.requests[1].history.at(-1)?.items[0];
  assert.equal(toolResult?.type, "tool-result");
  if (toolResult?.type === "tool-result") assert.match(toolResult.content, /嵌套结果/u);
});

test("CP3：standard 不广告 run_code，deepseek-efficient 才纳入 Code Mode 能力组合", () => {
  const composition = new CompositionService();
  assert.equal(composition.snapshot().enabled.some((item) => item.id === "code-mode.worker"), false);
  composition.setPreset("deepseek-efficient");
  assert.equal(composition.snapshot().enabled.some((item) => item.id === "code-mode.worker"), true);
});

test("CP3：旧 FrozenRunContext 拒绝运行开始后新增的工具且不执行", async () => {
  const provider = new ScriptedProvider([
    [{ kind: "tool-call.completed", call: toolCall("new-tool-call", "new.tool", "{}") }],
    [{ kind: "text.delta", text: "已拒绝新增工具" }],
  ]);
  const registry = new ToolRegistry();
  let executions = 0;
  registry.register({
    name: "old.tool",
    description: "旧工具",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async execute(request) { executions += 1; return { toolId: request.id, text: "旧结果" }; },
  });
  registry.register({
    name: "new.tool",
    description: "运行中新增工具",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async execute(request) { executions += 1; return { toolId: request.id, text: "不应执行" }; },
  });
  const request = providerRequest(registry, "auto");
  const frozenTools = request.tools.filter((tool) => tool.name === "old.tool");
  const frozen = freezeRunContext({
    runId: "run-frozen-code",
    sessionId: "session-a",
    provider: {
      providerId: request.profileId,
      profileId: request.profileId,
      modelId: request.selectedModel,
      permissionMode: request.permissionMode,
      tools: frozenTools,
      cachePlan: request.cachePlan,
      contextProfile: request.contextProfile,
    },
    composition: new CompositionService().snapshot(),
    toolDescriptors: frozenTools,
    skills: [],
    extensions: {},
    projectInstructions: { status: "not-configured" },
    permission: { mode: request.permissionMode },
    review: { policy: "off" },
    cache: { stablePrefix: request.cachePlan.reusablePrefix, generation: request.cachePlan.profileGeneration },
    workflow: { enabled: false },
    steering: { inboxId: "run-frozen-code" },
  });
  request.frozenRunContext = frozen;
  await runAgentToolLoop({
    provider,
    request,
    toolRegistry: registry,
    frozenRunContext: frozen,
    signal: new AbortController().signal,
    now: () => 100,
    onProviderEvent: async () => undefined,
    appendHistory: async () => undefined,
    emit: async () => undefined,
  });
  assert.equal(executions, 0);
  const toolResult = provider.requests[1].history.at(-1)?.items[0];
  assert.equal(toolResult?.type, "tool-result");
  if (toolResult?.type === "tool-result") assert.equal(toolResult.isError, true);
});

class ScriptedProvider implements ModelProvider {
  readonly descriptor = {
    id: "scripted-code-mode",
    name: "Scripted Code Mode",
    label: "本地 Code Mode 测试 Provider",
    configuration: "demo" as const,
    available: true,
    realCallsEnabled: false,
    capabilities: ["tools"],
    models: [{ id: "scripted-code-mode", label: "Scripted Code Mode" }],
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
  const history = [{ id: "user-code", role: "user" as const, items: [{ type: "text" as const, text: "执行 Code Mode" }] }];
  const contextProfile = buildContextProfile({ providerId: "scripted-code-mode", modelId: "scripted-code-mode", tools, history: [] });
  return {
    sessionId: "session-a",
    profileId: "scripted-code-mode",
    selectedModel: "scripted-code-mode",
    permissionMode,
    history,
    tools,
    contextProfile,
    cachePlan: buildCachePlan("执行 Code Mode", contextProfile),
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
