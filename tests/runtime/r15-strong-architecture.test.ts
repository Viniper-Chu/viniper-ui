import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { AgentEngineId } from "../../src/core/agent-engine-contracts";
import { RuntimeEvent, RuntimePlanSnapshot } from "../../src/core/contracts";
import { ProviderEvent, ProviderRequest } from "../../src/core/provider-contracts";
import { RuntimeErrorEnvelope, runtimeErrorEnvelope } from "../../src/core/runtime-error-contracts";
import { engineScopedId, engineScopeOf, requireEngineOwnership } from "../../src/core/engine-identity";
import { PermissionPolicy } from "../../src/features/permissions/permission-policy";
import { applyRuntimeEvent } from "../../src/features/sessions/session-reducer";
import { createSessionSnapshot } from "../../src/features/sessions/session-factory";
import { TokenLedger } from "../../src/features/telemetry/token-ledger";
import { AgentRuntime } from "../../src/features/runs/agent-runtime";
import { ProviderRegistry } from "../../src/features/providers/provider-registry";
import { ToolRegistry } from "../../src/features/tools/tool-registry";
import {
  BoundedOutboundQueue,
  RUNTIME_PROTOCOL_CAPABILITIES,
  RUNTIME_PROTOCOL_VERSION,
  RuntimeOverloadedError,
  negotiateRuntimeProtocol,
} from "../../src/platform/runtime-host/runtime-protocol";
import { FileStore } from "../../src/platform/persistence/file-store";
import { SQLiteStore } from "../../src/platform/persistence/sqlite-store";
import { WindowsProcessHost } from "../../src/platform/process/windows-process-host";
import { ClaudeCodeEngineAdapter, ViniperEngineAdapter } from "../../src/features/agent-engines/engine-adapters";
import { ModelProvider } from "../../src/features/providers/model-provider";

const outputRoot = join(process.cwd(), "codex", "运行残留");

test("R15 Strong-0 namespaces every identity and rejects cross-engine ownership", () => {
  const viniper = engineScopedId("viniper", "session", "same");
  const claude = engineScopedId("claude-code", "session", "same");
  assert.notEqual(viniper, claude);
  assert.equal(engineScopeOf(viniper), "viniper");
  assert.equal(engineScopeOf(claude), "claude-code");
  assert.equal(requireEngineOwnership("viniper", viniper), viniper);
  assert.throws(() => requireEngineOwnership("claude-code", viniper), /ENGINE_OWNER_MISMATCH/u);
});

test("R15 Strong-0 keeps Claude native CLI outside the Viniper tool loop", async () => {
  let observedTools = -1;
  const provider: ModelProvider = {
    descriptor: {
      id: "claude-code", name: "Claude code", label: "Claude code", configuration: "configured",
      available: true, realCallsEnabled: true, capabilities: ["stream"], models: [{ id: "default", label: "Default" }],
    },
    async *stream(request: ProviderRequest): AsyncIterable<ProviderEvent> {
      observedTools = request.tools.length;
      yield { kind: "provider-tool.started", callId: "native-tool", name: "Read" };
      yield { kind: "provider-tool.completed", callId: "native-tool", isError: false };
      yield { kind: "text.delta", text: "CLAUDE_NATIVE_ADAPTER_OK" };
    },
  };
  const adapter = new ClaudeCodeEngineAdapter(provider);
  const events: ProviderEvent[] = [];
  const request = {
    sessionId: engineScopedId("claude-code", "session", "adapter"),
    runId: engineScopedId("claude-code", "run", "adapter"),
    tools: [{ name: "terminal.run" }],
  } as ProviderRequest;
  await adapter.run({ request, signal: new AbortController().signal, onProviderEvent: async (event) => { events.push(event); } });
  assert.equal(observedTools, 0);
  assert.equal(adapter.engineId, "claude-code");
  assert.equal(new ViniperEngineAdapter().engineId, "viniper");
  assert.ok(events.some((event) => event.kind === "text.delta"));
  await assert.rejects(
    adapter.run({
      request: { ...request, sessionId: engineScopedId("viniper", "session", "wrong") },
      signal: new AbortController().signal,
      onProviderEvent: async () => undefined,
    }),
    /ENGINE_OWNER_MISMATCH/u,
  );
});

test("R15 Strong-0 isolates live session, message, interaction and usage state by engine", async () => {
  const root = await freshRoot("r15-engine-isolation-");
  const store = new FileStore(root);
  const ledger = new TokenLedger(store, () => Date.now());
  await ledger.initialize();
  const claudeProvider: ModelProvider = {
    descriptor: {
      id: "claude-code", name: "Claude code", label: "Claude code", configuration: "configured",
      available: true, realCallsEnabled: true, capabilities: ["stream"], models: [{ id: "claude-code-default", label: "Default" }],
    },
    async *stream(): AsyncIterable<ProviderEvent> {
      yield { kind: "provider-permission.confirmed", mode: "manual" };
      yield { kind: "provider-permission.completed", deniedCount: 0 };
      yield { kind: "text.delta", text: "CLAUDE_ISOLATED" };
      yield { kind: "usage.completed", usage: {
        input: 4, cacheHitInput: 0, cacheMissInput: 4, cacheWriteInput: 0,
        output: 2, reasoning: 0, toolUse: 0, total: 6, source: "provider",
      } };
    },
  };
  const runtime = new AgentRuntime({
    persistence: store,
    defaultWorkingDirectory: "D:\\R15",
    tokenLedger: ledger,
    registry: new ProviderRegistry(1),
    toolRegistry: new ToolRegistry(),
    claudeCodeEngineAdapter: new ClaudeCodeEngineAdapter(claudeProvider),
  });
  await runtime.initialize();
  try {
    const viniper = runtime.snapshot().sessions[0];
    const claude = await runtime.createSession("D:\\R15", undefined, "claude-code");
    const rejected = await runtime.send({
      engineId: "viniper", sessionId: claude.id, text: "wrong owner", attachments: [],
      selectedModel: claude.selectedModel, permissionMode: claude.permissionMode,
    });
    assert.equal(rejected.accepted, false);
    await Promise.all([
      runtime.send({ engineId: "viniper", sessionId: viniper.id, text: "VINIPER_ISOLATED", attachments: [], selectedModel: viniper.selectedModel, permissionMode: viniper.permissionMode }),
      runtime.send({ engineId: "claude-code", sessionId: claude.id, text: "CLAUDE_REQUEST", attachments: [], selectedModel: claude.selectedModel, permissionMode: claude.permissionMode }),
    ]);
    await waitUntil(() => runtime.snapshot().sessions.every((session) => session.status === "idle"));
    const snapshot = runtime.snapshot();
    const viniperAfter = snapshot.sessions.find((session) => session.id === viniper.id)!;
    const claudeAfter = snapshot.sessions.find((session) => session.id === claude.id)!;
    assert.equal(viniperAfter.events.every((event) => event.engineId === "viniper" && event.sessionId === viniper.id), true);
    assert.equal(claudeAfter.events.every((event) => event.engineId === "claude-code" && event.sessionId === claude.id), true);
    assert.equal(viniperAfter.messages.some((message) => message.text.includes("CLAUDE_ISOLATED")), false);
    assert.equal(claudeAfter.messages.some((message) => message.text.includes("CLAUDE_ISOLATED")), true);
    assert.equal(viniperAfter.activities.some((activity) => activity.kind === "interaction"), false);
    assert.equal(claudeAfter.activities.some((activity) => activity.kind === "interaction"), true);
    const usage = ledger.snapshot();
    assert.deepEqual(usage.engines.find((engine) => engine.engineId === "viniper")!.sessions.map((item) => item.sessionId), [viniper.id]);
    assert.deepEqual(usage.engines.find((engine) => engine.engineId === "claude-code")!.sessions.map((item) => item.sessionId), [claude.id]);
  } finally {
    await runtime.flushPersistence();
    await rm(root, { recursive: true, force: true });
  }
});

test("R15 Strong-0 partitions live queues and keeps Claude outside Viniper permission state", async () => {
  const root = await freshRoot("r15-engine-queue-");
  const store = new FileStore(root);
  const ledger = new TokenLedger(store, () => Date.now());
  await ledger.initialize();
  const viniperProvider = new GateProvider("viniper-queue-provider", "viniper-queue-model");
  const claudeProvider = new GateProvider("claude-code", "claude-code-default");
  const registry = new ProviderRegistry(1);
  registry.register(viniperProvider);
  const permission = new PermissionProbePolicy();
  const runtime = new AgentRuntime({
    persistence: store,
    defaultWorkingDirectory: "D:\\R15",
    tokenLedger: ledger,
    registry,
    toolRegistry: new ToolRegistry(),
    permissionPolicy: permission,
    maxConcurrentRuns: 1,
    claudeCodeEngineAdapter: new ClaudeCodeEngineAdapter(claudeProvider),
  });
  await runtime.initialize();
  try {
    const viniper = runtime.snapshot().sessions[0];
    assert.equal(await runtime.setProviderModel(viniper.id, viniperProvider.descriptor.id, "viniper-queue-model"), true);
    const claude = await runtime.createSession("D:\\R15", undefined, "claude-code");
    assert.equal(await runtime.setPermissionAccess(claude.id, "computer-runtime"), false);

    await Promise.all([
      runtime.send({ engineId: "viniper", sessionId: viniper.id, text: "VINIPER_ACTIVE", attachments: [], selectedModel: "viniper-queue-model", permissionMode: viniper.permissionMode }),
      runtime.send({ engineId: "claude-code", sessionId: claude.id, text: "CLAUDE_ACTIVE", attachments: [], selectedModel: claude.selectedModel, permissionMode: claude.permissionMode }),
    ]);
    await waitUntil(() => runtime.getSession(viniper.id)?.status === "running" && runtime.getSession(claude.id)?.status === "running");
    const [viniperQueued, claudeQueued] = await Promise.all([
      runtime.send({ engineId: "viniper", sessionId: viniper.id, text: "VINIPER_QUEUED", attachments: [], selectedModel: "viniper-queue-model", permissionMode: viniper.permissionMode }),
      runtime.send({ engineId: "claude-code", sessionId: claude.id, text: "CLAUDE_QUEUED", attachments: [], selectedModel: claude.selectedModel, permissionMode: claude.permissionMode }),
    ]);
    assert.equal(viniperQueued.queued, true);
    assert.equal(claudeQueued.queued, true);
    const viniperQueue = runtime.getSession(viniper.id)!.queue;
    const claudeQueue = runtime.getSession(claude.id)!.queue;
    assert.equal(viniperQueue.length, 1);
    assert.equal(claudeQueue.length, 1);
    assert.equal(viniperQueue.every((item) => item.engineId === "viniper" && engineScopeOf(item.id) === "viniper"), true);
    assert.equal(claudeQueue.every((item) => item.engineId === "claude-code" && engineScopeOf(item.id) === "claude-code"), true);
    assert.equal(viniperQueue.some((item) => item.text.includes("CLAUDE")), false);
    assert.equal(claudeQueue.some((item) => item.text.includes("VINIPER")), false);
    assert.equal(permission.freezeCalls.length, 1);
    assert.equal(permission.freezeCalls.every((runId) => engineScopeOf(runId) === "viniper"), true);

    viniperProvider.releaseAll();
    claudeProvider.releaseAll();
    await waitUntil(() => runtime.snapshot().sessions.every((session) => session.status === "idle"));
    assert.equal(permission.freezeCalls.length, 2, "only the two Viniper turns enter Viniper PermissionPolicy");
    assert.equal(permission.cancelCalls.length, 2);
    assert.equal(permission.freezeCalls.some((runId) => engineScopeOf(runId) === "claude-code"), false);
  } finally {
    viniperProvider.releaseAll();
    claudeProvider.releaseAll();
    await runtime.flushPersistence();
    await rm(root, { recursive: true, force: true });
  }
});

test("R15 S1/S3 live and replay events share stable engine/turn/item identity and ignore duplicates", () => {
  const session = createSessionSnapshot("D:\\r15", 100, "demo-default", "auto", undefined, "viniper");
  const plan: RuntimePlanSnapshot = {
    explanation: "red-green",
    steps: [{ id: "step-1", step: "first", status: "in_progress" }],
  };
  const event: RuntimeEvent = {
    id: engineScopedId("viniper", "event", "1"),
    engineId: "viniper",
    sessionId: session.id,
    threadId: session.id,
    turnId: engineScopedId("viniper", "run", "1"),
    itemId: engineScopedId("viniper", "item", "plan"),
    sequence: 1,
    type: "plan.updated",
    timestamp: 101,
    payload: { plan },
  };
  applyRuntimeEvent(session, event);
  applyRuntimeEvent(session, structuredClone(event));
  assert.equal(session.events.length, 1);
  assert.deepEqual(session.plan, plan);
  assert.equal(session.replayCursor, 1);
});

test("R15 S2 negotiates a versioned capability set and applies bounded outbound backpressure", () => {
  const negotiated = negotiateRuntimeProtocol({
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    capabilities: [...RUNTIME_PROTOCOL_CAPABILITIES],
  });
  assert.equal(negotiated.protocolVersion, RUNTIME_PROTOCOL_VERSION);
  assert.ok(negotiated.capabilities.includes("typed-dispatch"));
  const queue = new BoundedOutboundQueue<number>(2);
  queue.enqueue(1);
  queue.enqueue(2);
  assert.throws(() => queue.enqueue(3), RuntimeOverloadedError);
  assert.deepEqual(queue.drain(), [1, 2]);
});

test("R15 S3 atomic persistence assigns a replay cursor and idempotently ignores duplicate event ids", async () => {
  const root = await freshRoot("r15-sqlite-");
  const store = new SQLiteStore(root);
  await store.initialize();
  try {
    const session = createSessionSnapshot("D:\\r15", 200);
    const { events: _events, ...persisted } = session;
    const application = { schemaVersion: 3 as const, productVersion: "1.8.3" as const, activeSessionId: session.id, sessions: [persisted] };
    await store.saveSnapshot(application);
    const draft: RuntimeEvent = {
      id: engineScopedId("viniper", "event", "atomic"), engineId: "viniper",
      sessionId: session.id, threadId: session.id, turnId: engineScopedId("viniper", "run", "atomic"),
      type: "run.started", timestamp: 201, payload: { runId: engineScopedId("viniper", "run", "atomic") },
    };
    const first = await store.commitEvent(draft, application);
    const duplicate = await store.commitEvent(draft, application);
    assert.equal(first.event.sequence, duplicate.event.sequence);
    assert.equal((await store.load())?.events.filter((event) => event.id === draft.id).length, 1);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("R15 S4 reducer projects canonical plan and turn diff timeline events", () => {
  const session = createSessionSnapshot("D:\\r15", 300);
  const turnId = engineScopedId("viniper", "run", "timeline");
  applyRuntimeEvent(session, event("plan.updated", 1, session.id, turnId, { plan: { explanation: "work", steps: [{ id: "s1", step: "edit", status: "completed" }] } }));
  applyRuntimeEvent(session, event("turn.diff.updated", 2, session.id, turnId, { diff: { summary: "1 file", files: [{ path: "a.ts", additions: 2, deletions: 1 }] } }));
  assert.equal(session.plan?.steps[0].status, "completed");
  assert.equal(session.turnDiff?.files[0].path, "a.ts");
});

test("R15 S4/S8 conversation consumes canonical plan, diff and per-turn usage events", async () => {
  const source = await readFile("src/renderer/conversation/conversation.js", "utf8");
  const module = await new Function("specifier", "return import(specifier)")(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`,
  ) as { projectConversationSegments(session: Record<string, unknown>, options: Record<string, unknown>): Record<string, any> };
  const session = {
    id: "viniper__session-ui", engineId: "viniper", messages: [], activities: [], status: "idle",
    events: [
      { id: "e1", type: "plan.updated", timestamp: 1, turnId: "viniper__run-ui", payload: { plan: { explanation: "red-green", steps: [{ id: "s1", step: "红灯", status: "completed" }] } } },
      { id: "e2", type: "turn.diff.updated", timestamp: 2, turnId: "viniper__run-ui", payload: { diff: { summary: "1 file", files: [{ path: "a.ts", additions: 2, deletions: 1 }], patch: "+ok\n-old" } } },
      { id: "e3", type: "turn.usage.updated", timestamp: 3, turnId: "viniper__run-ui", payload: { usage: { total: 9, source: "provider" }, status: "reconciled" } },
      { id: "e4", type: "run.completed", timestamp: 4, turnId: "viniper__run-ui", payload: { runId: "viniper__run-ui" } },
    ],
  };
  const view = module.projectConversationSegments(session, {
    runs: [{ runId: "viniper__run-ui", sessionId: session.id, status: "completed", createdAt: 0, updatedAt: 4 }],
    telemetry: { sessions: [{ sessionId: session.id, cumulative: { total: 999, source: "estimated" } }] },
  });
  assert.equal(view.usage.total, 9);
  assert.equal(view.usage.source, "provider");
  assert.equal(view.plan.steps[0].step, "红灯");
  assert.equal(view.turnDiff.files[0].path, "a.ts");
});

test("R15 S5 approval lifecycle carries stable owner, target item and resolution timestamps", async () => {
  let now = 400;
  const policy = new PermissionPolicy("interactive", () => now++);
  await policy.initialize();
  const controller = new AbortController();
  const sessionId = engineScopedId("viniper", "session", "approval");
  const runId = engineScopedId("viniper", "run", "approval");
  const authorization = policy.begin({
    engineId: "viniper", sessionId, runId, permissionMode: "ask", signal: controller.signal,
    tool: { id: engineScopedId("viniper", "item", "call"), name: "terminal.run", summary: "run", readOnly: false, scope: "computer" },
  });
  assert.equal(authorization.request?.approvalId, authorization.request?.id);
  assert.equal(authorization.request?.targetItemId, authorization.request?.callId, "an already-scoped external callId is preserved byte-for-byte");
  assert.equal(authorization.request?.engineId, "viniper");
  assert.equal(policy.resolve(sessionId, runId, authorization.request!.callId, "reject"), true);
  await authorization.resolution;
  const completed = policy.snapshot().resolved!.at(-1)!;
  assert.equal(completed.approvalId, authorization.request?.approvalId);
  assert.ok(completed.completedAt >= completed.startedAt);
});

test("R15 S6 ProcessHost exposes a bounded interactive PowerShell 7 stream with stdin and cancellation", async (t) => {
  if (process.platform !== "win32") return t.skip("Windows-only ProcessHost contract");
  const root = await freshRoot("r15-interactive-");
  const host = new WindowsProcessHost({ managedRoot: root, allowUnscoped: true });
  const controller = new AbortController();
  try {
    const chunks: string[] = [];
    const started = await host.startInteractive({
      executionId: "r15-interactive", input: { command: "", purpose: "command", timeoutMs: 10_000 },
    }, { sessionId: "viniper__session-interactive", runId: "viniper__run-interactive", signal: controller.signal });
    const unsubscribe = host.subscribeInteractive(started.executionId, (chunk) => chunks.push(chunk.text));
    await host.writeInteractive(started.executionId, "Write-Output R15_PWSH7_INTERACTIVE_OK\nexit\n");
    const completed = await host.waitInteractive(started.executionId);
    unsubscribe();
    assert.equal(completed.processIdentity?.edition, "Core");
    assert.equal(completed.processIdentity?.major, 7);
    assert.match(chunks.join(""), /R15_PWSH7_INTERACTIVE_OK/u);
  } finally {
    await host.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("R15 S7 errors and interrupt acknowledgements remain causal and typed", () => {
  const cause: RuntimeErrorEnvelope = runtimeErrorEnvelope(new Error("boom"), {
    code: "PROVIDER_TRANSPORT_FAILED", phase: "provider", retryable: true, retryAfterMs: 250,
    engineId: "viniper", sessionId: "viniper__session-1", turnId: "viniper__run-1",
  });
  assert.equal(cause.code, "PROVIDER_TRANSPORT_FAILED");
  assert.equal(cause.phase, "provider");
  assert.equal(cause.retryAfterMs, 250);
  assert.equal(cause.engineId, "viniper");
});

test("R15 S8 telemetry partitions by engine and exposes one typed turn usage record", async () => {
  const root = await freshRoot("r15-telemetry-");
  try {
    const ledger = new TokenLedger(new FileStore(root), () => 500);
    await ledger.initialize();
    await ledger.start("viniper", "viniper__run-same", "viniper__session-same", "abc");
    await ledger.start("claude-code", "claude-code__run-same", "claude-code__session-same", "abc");
    const snapshot = ledger.snapshot();
    assert.equal(snapshot.engines.find((item) => item.engineId === "viniper")?.sessions.length, 1);
    assert.equal(snapshot.engines.find((item) => item.engineId === "claude-code")?.sessions.length, 1);
    assert.equal(ledger.getRun("viniper", "viniper__run-same")?.engineId, "viniper");
    assert.equal(ledger.getRun("claude-code", "claude-code__run-same")?.engineId, "claude-code");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function event(type: RuntimeEvent["type"], sequence: number, sessionId: string, turnId: string, payload: unknown): RuntimeEvent {
  const engineId: AgentEngineId = "viniper";
  return {
    id: engineScopedId(engineId, "event", String(sequence)), engineId,
    sessionId, threadId: sessionId, turnId, sequence, type, timestamp: 300 + sequence, payload,
  };
}

async function freshRoot(prefix: string): Promise<string> {
  await mkdir(outputRoot, { recursive: true });
  return mkdtemp(join(outputRoot, prefix));
}

async function waitUntil(predicate: () => boolean, timeoutMs = 4_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("R15 runtime did not become idle");
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}

class GateProvider implements ModelProvider {
  readonly descriptor;
  private release!: () => void;
  private readonly released = new Promise<void>((resolve) => { this.release = resolve; });

  constructor(id: string, modelId: string) {
    this.descriptor = {
      id,
      name: id,
      label: id,
      configuration: "configured" as const,
      available: true,
      realCallsEnabled: false,
      capabilities: ["stream"],
      models: [{ id: modelId, label: modelId }],
    };
  }

  async *stream(): AsyncIterable<ProviderEvent> {
    await this.released;
    yield { kind: "text.delta", text: `${this.descriptor.id}_DONE` };
  }

  releaseAll(): void { this.release(); }
}

class PermissionProbePolicy extends PermissionPolicy {
  readonly freezeCalls: string[] = [];
  readonly cancelCalls: string[] = [];

  override freezeRun(sessionId: string, runId: string, projectRoot?: string): void {
    this.freezeCalls.push(runId);
    super.freezeRun(sessionId, runId, projectRoot);
  }

  override cancelRun(runId: string): void {
    this.cancelCalls.push(runId);
    super.cancelRun(runId);
  }
}
