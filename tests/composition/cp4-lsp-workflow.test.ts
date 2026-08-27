import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { PermissionPolicy } from "../../src/features/permissions/permission-policy";
import { NodeProjectFilesystem } from "../../src/platform/filesystem/node-project-filesystem";
import { ProjectIndexService } from "../../src/features/project-indexing/project-index-service";
import { LspService } from "../../src/features/lsp/lsp-service";
import { SubagentService } from "../../src/features/workflows/subagent-service";
import { WorkflowService } from "../../src/features/workflows/workflow-service";
import { SubagentSnapshot, WorkflowDefinition, WorkflowRuntimePort, WorkflowSnapshot } from "../../src/core/workflow-contracts";
import { CoordinationEnvelope } from "../../src/core/coordination-contracts";
import { RunCompletion, RunSnapshot, SessionSnapshot } from "../../src/core/contracts";

test("CP4：TypeScript/JavaScript LSP provider 完成四个语义操作并只返回相对位置", async () => {
  const root = await mkdtemp(join(process.cwd(), "codex", "运行残留", "cp4-lsp-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "main.ts"), "export function greet(name: string) { return name; }\nconst value = greet('x');\n", "utf8");
    const filesystem = new NodeProjectFilesystem({ protectedRoots: [join(root, ".managed")], managedRoot: join(root, ".managed") });
    const index = new ProjectIndexService();
    const lsp = new LspService({ filesystem, index, localProvider: "typescript-javascript" });
    const definition = await lsp.navigate({ sessionId: "s", projectRoot: root, operation: "definition", path: "src/main.ts", symbol: "greet" });
    const references = await lsp.navigate({ sessionId: "s", projectRoot: root, operation: "references", path: "src/main.ts", symbol: "greet" });
    const implementation = await lsp.navigate({ sessionId: "s", projectRoot: root, operation: "implementation", path: "src/main.ts", symbol: "greet" });
    const hover = await lsp.navigate({ sessionId: "s", projectRoot: root, operation: "hover", path: "src/main.ts", line: 1, character: 7 });
    for (const result of [definition, references, implementation]) assert.equal(result.source, "typescript-javascript");
    assert.equal(definition.items[0]?.path, "src/main.ts");
    assert.equal(definition.items[0]?.line, 1);
    assert.equal(references.items.some((item) => item.line === 2), true);
    assert.equal(implementation.items[0]?.path, "src/main.ts");
    assert.match(hover.hoverText ?? "", /greet/u);
    assert.equal(JSON.stringify(definition).includes(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CP4：语言服务不可用时回退 ProjectIndexService，并标记 fallback 而不伪造语义结果", async () => {
  const root = await mkdtemp(join(process.cwd(), "codex", "运行残留", "cp4-lsp-fallback-"));
  try {
    await writeFile(join(root, "main.js"), "export const marker = 1;\n", "utf8");
    const filesystem = new NodeProjectFilesystem({ protectedRoots: [join(root, ".managed")], managedRoot: join(root, ".managed") });
    const index = new ProjectIndexService();
    await index.build(root, true);
    const lsp = new LspService({ filesystem, index, localProvider: "unavailable" });
    const result = await lsp.navigate({ sessionId: "s", projectRoot: root, operation: "references", path: "main.js", symbol: "marker" });
    assert.equal(result.source, "fallback");
    assert.equal(result.status, "ok");
    assert.equal(result.items.some((item) => item.path === "main.js"), true);
    assert.equal(JSON.stringify(result).includes(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("R16：TypeScript 语义定义跨文件解析，不能把当前文件正则匹配冒充 LSP", async () => {
  const root = await mkdtemp(join(process.cwd(), "codex", "运行残留", "r16-lsp-semantic-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "commonjs", target: "es2022" }, include: ["src/**/*.ts"] }), "utf8");
    await writeFile(join(root, "src", "definition.ts"), "export function sharedMarker(value: string) { return value.length; }\n", "utf8");
    await writeFile(join(root, "src", "consumer.ts"), "import { sharedMarker } from './definition';\nexport const result = sharedMarker('ok');\n", "utf8");
    const filesystem = new NodeProjectFilesystem({ protectedRoots: [join(root, ".managed")], managedRoot: join(root, ".managed") });
    const index = new ProjectIndexService();
    const lsp = new LspService({ filesystem, index, localProvider: "typescript-javascript" });
    const definition = await lsp.navigate({ sessionId: "r16", projectRoot: root, operation: "definition", path: "src/consumer.ts", symbol: "sharedMarker", line: 2, character: 23 });
    const references = await lsp.navigate({ sessionId: "r16", projectRoot: root, operation: "references", path: "src/consumer.ts", symbol: "sharedMarker", line: 2, character: 23 });
    const hover = await lsp.navigate({ sessionId: "r16", projectRoot: root, operation: "hover", path: "src/consumer.ts", line: 2, character: 23 });
    assert.equal(definition.source, "typescript-javascript");
    assert.equal(definition.items.some((item) => item.path === "src/definition.ts"), true, JSON.stringify(definition));
    assert.equal(references.items.some((item) => item.path === "src/consumer.ts" && item.line === 2), true, JSON.stringify(references));
    assert.match(hover.hoverText ?? "", /sharedMarker/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CP4：五种 workflow 模式有不同执行语义，并通过 Runtime/Coordination 支持取消、回执和显式恢复", async () => {
  const runtime = new FakeWorkflowRuntime();
  const permission = new PermissionPolicy("fail-closed");
  await permission.setAccess("parent", undefined, "computer-runtime");
  const coordination = new FakeCoordination(runtime);
  const subagents = new SubagentService({ coordination, runtime, permission, maxConcurrent: 2 });
  const workflows = new WorkflowService({ runtime, subagents, permission, maxConcurrent: 2 });
  const base: WorkflowDefinition = {
    id: "cp4-five-modes",
    revision: 1,
    name: "CP4 五模式",
    mode: "prompt-chaining",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    steps: [{ id: "one", kind: "prompt", prompt: "完成一步" }],
  };
  const chained: WorkflowDefinition = { ...base, mode: "prompt-chaining", steps: [
    { id: "first", kind: "prompt", prompt: "先生成事实" },
    { id: "second", kind: "prompt", prompt: "再总结事实" },
  ] };
  const chainedRun = await workflows.run({ definition: chained, sessionId: "parent", permissionMode: "auto", input: {} });
  assert.equal(chainedRun.status, "completed", chainedRun.error);
  assert.equal(runtime.intents.some((intent) => intent.text.includes("上一步输出")), true);

  const routed: WorkflowDefinition = { ...base, id: "cp4-route", mode: "routing", steps: [
    { id: "route", kind: "route", prompt: "选择分支", inputKey: "route", routeBranches: [{ when: "fast", stepId: "fast" }], defaultBranchStepId: "slow" },
    { id: "fast", kind: "prompt", prompt: "快速分支" },
    { id: "slow", kind: "prompt", prompt: "慢速分支" },
  ] };
  const routedRun = await workflows.run({ definition: routed, sessionId: "parent", permissionMode: "auto", input: { route: "fast" } });
  assert.equal(routedRun.status, "completed", routedRun.error);
  assert.equal(routedRun.steps.find((step) => step.id === "fast")?.status, "completed");
  assert.equal(routedRun.steps.find((step) => step.id === "slow")?.status, "skipped");

  const parallel: WorkflowDefinition = { ...base, id: "cp4-parallel", mode: "parallelisation", steps: [
    { id: "left", kind: "parallel", prompt: "并行左" },
    { id: "right", kind: "parallel", prompt: "并行右" },
  ] };
  const parallelRun = await workflows.run({ definition: parallel, sessionId: "parent", permissionMode: "auto", input: {} });
  assert.equal(parallelRun.status, "completed", parallelRun.error);
  assert.equal(runtime.maxOverlappingSends >= 2, true);
  assert.equal(parallelRun.output?.includes("完成：并行左"), true);
  assert.equal(parallelRun.output?.includes("完成：并行右"), true);

  const delegatedDefinition: WorkflowDefinition = { ...base, id: "cp4-workers", mode: "orchestrator-workers", steps: [{ id: "worker", kind: "delegate", prompt: "执行子任务", targetSessionId: "worker" }] };
  const delegatedRun = await workflows.run({ definition: delegatedDefinition, sessionId: "parent", permissionMode: "auto", input: {} });
  assert.equal(delegatedRun.status, "completed", delegatedRun.error);
  const delegated = await subagents.spawn({ parentSessionId: "parent", targetSessionId: "worker", prompt: "执行子任务", permissionMode: "auto" });
  assert.equal(delegated.status, "completed");
  assert.equal(delegated.parentSessionId, "parent");
  assert.equal(delegated.targetSessionId, "worker");
  assert.equal(runtime.privateHistoryShared, false);
  const evaluated: WorkflowDefinition = { ...base, id: "cp4-evaluator", mode: "evaluator-optimiser", steps: [
    { id: "generate", kind: "prompt", prompt: "生成草案" },
    { id: "evaluate", kind: "evaluate", prompt: "评估草案", improvementStepId: "improve" },
    { id: "improve", kind: "prompt", prompt: "改进草案" },
  ] };
  const evaluatedRun = await workflows.run({ definition: evaluated, sessionId: "parent", permissionMode: "auto", input: {} });
  assert.equal(evaluatedRun.status, "completed", evaluatedRun.error);
  assert.equal(evaluatedRun.steps.find((step) => step.id === "evaluate")?.attempts, 1);
  assert.equal(evaluatedRun.steps.find((step) => step.id === "improve")?.attempts, 1);

  const cancelDefinition = { ...base, id: "cp4-cancel" };
  const cancelled = await workflows.run({
    definition: cancelDefinition,
    sessionId: "parent",
    permissionMode: "auto",
    input: {},
    signal: AbortSignal.timeout(1),
  });
  assert.equal(["cancelled", "failed"].includes(cancelled.status), true);
  let persisted: WorkflowSnapshot = {
    revision: 1,
    definitions: [cancelDefinition],
    runs: [{ ...cancelled, status: "running", steps: cancelled.steps.map((step) => ({ ...step, status: "running" })) }],
  };
  const recoveredService = new WorkflowService({
    runtime,
    subagents,
    permission,
    persistence: { load: async () => persisted, save: async (snapshot) => { persisted = snapshot; } },
    maxConcurrent: 2,
  });
  await recoveredService.initialize();
  await assert.rejects(() => recoveredService.recover(cancelled.id), /REQUIRES_REAUTHORIZATION/u);
  const recovered = await recoveredService.recover(cancelled.id, "reconfirm");
  assert.equal(["completed", "unknown"].includes(recovered.status), true);
  assert.equal(recovered.usage.estimatedTokens > 0, true);
});

test("CP4：委派在 delegateTask 返回前完成时仍能完成子 Agent 回执", async () => {
  const runtime = new FakeWorkflowRuntime(true);
  const permission = new PermissionPolicy("fail-closed");
  await permission.setAccess("parent", undefined, "computer-runtime");
  const coordination = new FakeCoordination(runtime);
  const subagents = new SubagentService({ coordination, runtime, permission });
  try {
    const receipt = await Promise.race([
      subagents.spawn({ parentSessionId: "parent", targetSessionId: "worker", prompt: "快速委派", permissionMode: "auto" }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("SUBAGENT_COMPLETION_TIMEOUT")), 100)),
    ]);
    assert.equal(receipt.status, "completed");
    assert.equal(receipt.output, "完成：快速委派");
  } finally {
    subagents.dispose();
  }
});

test("R8D：重启把不可恢复的活动子 Agent 收敛为 failed，绝不永久 running", async () => {
  const runtime = new FakeWorkflowRuntime();
  const permission = new PermissionPolicy("fail-closed");
  const coordination = new FakeCoordination(runtime);
  let persisted: SubagentSnapshot = {
    maxConcurrent: 2,
    active: [{ id: "subagent-interrupted", parentSessionId: "parent", targetSessionId: "worker", status: "running" as const, createdAt: 1, updatedAt: 2 }],
    recent: [],
  };
  const subagents = new SubagentService({
    coordination,
    runtime,
    permission,
    maxConcurrent: 2,
    persistence: { load: async () => persisted, save: async (snapshot) => { persisted = snapshot; } },
  });
  try {
    await subagents.initialize();
    assert.equal(subagents.snapshot().active.length, 0);
    assert.equal(subagents.snapshot().recent[0]?.status, "failed");
    assert.match(subagents.snapshot().recent[0]?.error ?? "", /重启/u);
    assert.equal(persisted.active.length, 0);
  } finally {
    subagents.dispose();
  }
});

class FakeWorkflowRuntime implements WorkflowRuntimePort {
  private readonly listeners = new Set<(completion: RunCompletion) => void | Promise<void>>();
  private counter = 0;
  constructor(private readonly completeSynchronously = false) {}
  readonly privateHistoryShared = false;
  readonly runs: RunSnapshot[] = [];
  readonly intents: Array<Parameters<WorkflowRuntimePort["send"]>[0]> = [];
  private overlappingSends = 0;
  maxOverlappingSends = 0;

  async send(intent: Parameters<WorkflowRuntimePort["send"]>[0]): Promise<{ accepted: boolean; queued: boolean; runId?: string }> {
    this.intents.push(intent);
    const runId = `run-${++this.counter}`;
    this.runs.push({ runId, sessionId: intent.sessionId, origin: intent.origin ?? { kind: "user" }, text: intent.text, status: "running", createdAt: Date.now(), updatedAt: Date.now() });
    this.overlappingSends += 1;
    this.maxOverlappingSends = Math.max(this.maxOverlappingSends, this.overlappingSends);
    const complete = () => {
      this.overlappingSends -= 1;
      const run = this.runs.find((item) => item.runId === runId)!;
      run.status = "completed";
      for (const listener of this.listeners) void listener({ runId, sessionId: intent.sessionId, origin: intent.origin ?? { kind: "user" }, status: "completed", assistantText: `完成：${intent.text}` });
    };
    if (this.completeSynchronously) complete();
    else setTimeout(complete, 4);
    return { accepted: true, queued: false, runId };
  }
  onRunCompleted(listener: (completion: RunCompletion) => void | Promise<void>): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  listRuns(sessionId?: string): RunSnapshot[] { return this.runs.filter((run) => !sessionId || run.sessionId === sessionId); }
  async cancelRun(runId: string): Promise<boolean> { const run = this.runs.find((item) => item.runId === runId); if (!run) return false; run.status = "cancelled"; return true; }
  getSession(sessionId: string): SessionSnapshot | undefined { return { id: sessionId, title: sessionId, workingDirectory: ".", selectedModel: "demo-default", selectedProviderId: "demo", permissionMode: "auto", messages: [], providerHistory: [], queue: [], activities: [], events: [], status: "idle", unread: false, pinned: false, createdAt: 0, updatedAt: 0, cachePlan: { stableSegments: [], reusablePrefix: "", currentTurn: "", reusedContextChars: 0, addedContextChars: 0, profileGeneration: 0 } }; }
}

class FakeCoordination {
  constructor(private readonly runtime: FakeWorkflowRuntime) {}
  async delegateTask(
    sourceSessionId: string,
    targetSessionId: string,
    body: string,
    onEnvelope?: (envelope: CoordinationEnvelope) => void | Promise<void>,
  ): Promise<CoordinationEnvelope> {
    const id = `delegation-${body}`;
    const envelope = { id, revision: 1, sourceSessionId, targetSessionId, type: "delegation" as const, status: "delivered" as const, body, createdAt: 0, updatedAt: 0 };
    await onEnvelope?.(envelope);
    await this.runtime.send({ sessionId: targetSessionId, text: body, attachments: [], selectedModel: "demo-default", permissionMode: "auto", origin: { kind: "delegation", envelopeId: id, sourceSessionId } });
    return envelope;
  }
}
