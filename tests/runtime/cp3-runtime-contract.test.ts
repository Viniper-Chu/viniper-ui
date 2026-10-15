import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { ProviderRegistry } from "../../src/features/providers/provider-registry";
import { ModelProvider } from "../../src/features/providers/model-provider";
import { ProviderEvent, ProviderRequest } from "../../src/core/provider-contracts";
import { ProjectIndexRecord } from "../../src/core/project-index-contracts";
import { querySessions } from "../../src/features/sessions/session-query";
import { MemoryService } from "../../src/features/memory/memory-service";
import { SmartRoutingService } from "../../src/features/providers/model-routing-service";
import { ContextCompactionService } from "../../src/features/runs/context-compaction-service";
import { ProjectIndexService } from "../../src/features/project-indexing/project-index-service";
import { createSessionSnapshot } from "../../src/features/sessions/session-factory";
import { createHarnessApplication } from "../../src/platform/bootstrap/create-harness-application";
import { UnavailableSecretVault } from "../../src/platform/security/unavailable-secret-vault";
import { waitFor } from "../runs/runtime-fixture";

test("CP3 session query returns a bounded virtual page from 10000 retained sessions", () => {
  const sessions = Array.from({ length: 10_000 }, (_, index) => {
    const session = createSessionSnapshot("D:\\fixture-project", index + 1);
    session.id = `session-${index}`;
    session.title = index === 9_999 ? "需要定位的任务" : `任务 ${index}`;
    session.pinned = index === 9_999;
    session.updatedAt = index + 1;
    return session;
  });
  const page = querySessions(sessions, { search: "定位", offset: 0, limit: 50 });
  assert.equal(page.total, 1);
  assert.equal(page.items[0].title, "需要定位的任务");
  assert.ok(page.items.length <= 50);
  const bounded = querySessions(sessions, { offset: 0, limit: 500 });
  assert.equal(bounded.items.length, 200, "virtual query must cap a requested oversized page");
});

test("smart routing stays off by default and freezes only an eligible delegated run", async () => {
  const registry = new ProviderRegistry(0);
  const service = new SmartRoutingService(registry, () => 1_000);
  await service.initialize();
  assert.equal(service.snapshot().enabled, false);
  const fixed = service.decide({ origin: { kind: "user" }, providerId: "demo", modelId: "demo-default" });
  assert.equal(fixed.mode, "fixed");
  const unavailable = service.decide(
    { origin: { kind: "scheduler", scheduleId: "schedule-1" }, providerId: "demo", modelId: "demo-default" },
    { mode: "fixed", providerId: "missing", modelId: "missing" },
  );
  assert.equal(unavailable.providerId, "demo");
  assert.equal(unavailable.modelId, "demo-default");
  assert.equal(unavailable.fallback, true);
  await service.setEnabled(true);
  await service.setStrategy("quality");
  const delegated = service.decide({ origin: { kind: "delegation", envelopeId: "e1" }, providerId: "demo", modelId: "demo-default" });
  assert.equal(delegated.mode, "smart");
  assert.equal(delegated.fallback, false);
  assert.equal(delegated.frozenAt, 1_000);
  assert.ok(delegated.reason.length > 0);
  assert.ok(delegated.capabilities.length > 0);
});

test("memory service exposes scope/source/time, stops stale injection, and only warns at soft capacity", async () => {
  let now = 100 * 24 * 60 * 60 * 1_000;
  const service = new MemoryService(undefined, () => now);
  await service.initialize();
  const entry = await service.create({
    scope: "project",
    source: "user-explicit",
    text: "项目使用冷青色主题",
    projectRoot: "D:\\fixture-project",
  });
  assert.equal(service.selectForInjection({ projectRoot: "D:\\fixture-project" }).length, 1);
  now += 91 * 24 * 60 * 60 * 1_000;
  const stale = service.selectForInjection({ projectRoot: "D:\\fixture-project" });
  assert.equal(stale.length, 0);
  assert.equal(service.snapshot().entries[0].stale, true);
  await service.setEnabled(entry.id, false);
  assert.equal(service.snapshot().entries[0].status, "disabled");
  assert.match(service.snapshot().entries[0].createdAt.toString(), /\d/u);
});

test("context compaction keeps original history and creates immutable summary with separate usage", async () => {
  const service = new ContextCompactionService(undefined, undefined, () => 2_000);
  await service.initialize();
  const history = Array.from({ length: 4 }, (_, index) => ({
    id: `h-${index}`,
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    items: [{ type: "text" as const, text: `${"长上下文 ".repeat(400)}${index}` }],
  }));
  const result = await service.maybeCompact({ sessionId: "s1", providerId: "demo", modelId: "demo-default", history, thresholdChars: 100 });
  assert.equal(result.status, "generated");
  assert.equal(history.length, 4);
  const projected = service.projectHistory("s1", history);
  assert.ok(projected.length < history.length);
  assert.equal(service.snapshot().generations[0].immutable, true);
  assert.equal(service.snapshot().generations[0].usage.source, "estimated");
  assert.equal(service.snapshot().generations[0].cache.read, null);
});

test("project index is explicit-only, excludes secret/noise paths, supports symbol/text/path and live fallback", async () => {
  const root = await mkdtemp(join(process.cwd(), "codex", "运行残留", "cp3-index-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules"), { recursive: true });
    await writeFile(join(root, "src", "main.ts"), "export function 冷青任务() { return '事实'; }\n", "utf8");
    await writeFile(join(root, ".env"), "DEEPSEEK_API_KEY=never-index", "utf8");
    await writeFile(join(root, "node_modules", "ignored.ts"), "never-index", "utf8");
    const service = new ProjectIndexService();
    const refused = await service.build(root, false);
    assert.equal(refused.status, "disabled");
    const ready = await service.build(root, true);
    assert.equal(ready.status, "ready");
    assert.equal(ready.semantic.enabled, false);
    const symbol = await service.search(root, "冷青任务");
    assert.ok(symbol.results.some((item) => item.match === "symbol"));
    assert.equal(symbol.results.some((item) => item.path === ".env"), false);
    assert.equal(symbol.results.some((item) => item.path.includes("node_modules")), false);
    await service.markDeleted(root, "src/main.ts");
    assert.ok(service.snapshot().stalePaths.includes("src/main.ts"));
    const fallback = await service.search(root, "事实");
    assert.ok(["index", "live-fallback"].includes(fallback.source));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("project index pauses under resource pressure and resumes from its persisted checkpoint", async (context) => {
  const root = await mkdtemp(join(process.cwd(), "codex", "运行残留", "cp3-index-pause-"));
  try {
    await Promise.all(Array.from({ length: 120 }, (_, index) => writeFile(join(root, `file-${index}.ts`), `export const item${index} = ${index};\n`, "utf8")));
    const service = new ProjectIndexService();
    // A small index can finish between the 10 ms polling ticks. Hold its
    // first file read so pause is tested during work regardless of disk speed.
    const reader = service as unknown as { readRecord(root: string, path: string): Promise<ProjectIndexRecord | undefined> };
    const readRecord = reader.readRecord.bind(service);
    let signalReading!: () => void;
    let releaseRead!: () => void;
    const reading = new Promise<void>((resolve) => { signalReading = resolve; });
    const released = new Promise<void>((resolve) => { releaseRead = resolve; });
    context.mock.method(reader, "readRecord", async (projectRoot: string, path: string) => {
      signalReading();
      await released;
      return readRecord(projectRoot, path);
    });
    const building = service.build(root, true);
    try {
      await Promise.race([reading, building.then(() => { throw new Error("Index completed without entering a file read"); })]);
      assert.equal(service.snapshot().status, "indexing");
      const paused = await service.pause();
      assert.equal(paused.status, "paused");
      assert.ok((paused.checkpoint.processed ?? 0) < paused.checkpoint.total);
    } finally {
      releaseRead();
      await building;
    }
    const resumed = await service.resume();
    assert.equal(resumed.status, "ready");
    assert.equal(resumed.checkpoint.processed, resumed.checkpoint.total);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop and CLI application consumers share retained sessions, memory, routing and index state across restart", async () => {
  const dataRoot = await mkdtemp(join(process.cwd(), "codex", "运行残留", "cp3-application-"));
  const projectRoot = await mkdtemp(join(process.cwd(), "codex", "运行残留", "cp3-project-"));
  const assetsRoot = join(process.cwd(), "assets");
  try {
    await writeFile(join(projectRoot, "事实.ts"), "export const 事实 = '来自显式项目';\n", "utf8");
    const first = await createHarnessApplication({
      dataRoot,
      workingDirectory: process.cwd(),
      assetsRoot,
      secretVault: new UnavailableSecretVault(),
    });
    const projectSession = await first.application.createProjectSession(projectRoot);
    const created = await first.application.createMemory({
      scope: "personal",
      source: "user-explicit",
      text: "用户明确保留的偏好",
    });
    await first.application.setSmartRoutingEnabled(true);
    const index = await first.application.buildProjectIndex(projectSession.id) as { status: string };
    assert.equal(index.status, "ready");
    const search = await first.application.searchProjectIndex(projectSession.id, "事实") as { results: unknown[] };
    assert.ok(search.results.length > 0);
    const page = first.application.querySessions({ project: projectRoot, limit: 10 });
    assert.equal(page.total, 1);
    assert.equal(first.application.snapshot().smartRouting?.enabled, true);
    assert.ok(first.application.snapshot().memories?.entries.some((entry) => entry.id === (created as { id: string }).id));
    assert.equal(await first.application.deleteSession(projectSession.id), true, "session deletion must be explicit");
    assert.equal(first.application.snapshot().sessions.some((session) => session.id === projectSession.id), false);
    await first.application.dispose();

    const second = await createHarnessApplication({
      dataRoot,
      workingDirectory: process.cwd(),
      assetsRoot,
      secretVault: new UnavailableSecretVault(),
    });
    try {
      assert.equal(second.application.snapshot().memories?.entries.some((entry) => entry.text === "用户明确保留的偏好"), true);
      assert.equal(second.application.snapshot().smartRouting?.enabled, true);
      assert.equal(second.application.snapshot().projectIndexes?.[0]?.status, "ready");
    } finally {
      await second.application.dispose();
    }
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("runtime sends memory and routing through one frozen Provider request without silent model fallback", async () => {
  const root = await mkdtemp(join(process.cwd(), "codex", "运行残留", "cp3-freeze-"));
  const assetsRoot = join(process.cwd(), "assets");
  const bundle = await createHarnessApplication({
    dataRoot: root,
    workingDirectory: process.cwd(),
    assetsRoot,
    secretVault: new UnavailableSecretVault(),
  });
  const provider = new CaptureProvider();
  bundle.runtime.providerRegistry().register(provider);
  const session = bundle.runtime.snapshot().sessions[0];
  await bundle.runtime.setProviderModel(session.id, provider.descriptor.id, provider.descriptor.models[0].id);
  await bundle.application.createMemory({ scope: "personal", source: "user-explicit", text: "固定 Provider 请求中的记忆事实" });
  await bundle.application.setSmartRoutingEnabled(true);
  await bundle.application.setSmartRoutingStrategy("quality");
  try {
    const result = await bundle.runtime.send({
      sessionId: session.id,
      text: "委派任务需要保持固定 Provider 请求中的记忆事实与模型冻结",
      attachments: [],
      selectedModel: provider.descriptor.models[0].id,
      permissionMode: session.permissionMode,
      origin: { kind: "delegation", sourceSessionId: session.id, envelopeId: "cp3-freeze-delegation" },
    });
    assert.equal(result.accepted, true);
    await waitFor(() => provider.request !== undefined);
    assert.ok(provider.request?.contextProfile.stableSegments.some((segment) => segment.text.includes("固定 Provider 请求中的记忆事实")));
    assert.equal(provider.request?.profileId, provider.descriptor.id);
    assert.equal(await bundle.runtime.setProviderModel(session.id, "demo", "demo-default"), false, "running run cannot switch frozen model");
    const run = bundle.runtime.listRuns(session.id).at(-1);
    assert.equal(run?.providerSnapshot?.modelId, provider.descriptor.models[0].id);
    assert.equal(run?.routing?.mode, "smart");
    provider.release();
    await waitFor(() => bundle.runtime.listRuns(session.id).at(-1)?.status === "completed");
  } finally {
    provider.release();
    await bundle.application.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("automatic assistant captures stay visible in memory but do not re-enter the stable Provider prefix", async () => {
  const memory = new MemoryService(undefined, () => 1_000);
  await memory.captureSession("session-a", "D:\\project", "模型刚刚给出的回答");
  await memory.create({
    scope: "session-auto",
    source: "user-explicit",
    sessionId: "session-a",
    projectRoot: "D:\\project",
    text: "用户明确保存的会话事实",
  });
  assert.equal(memory.snapshot().entries.length, 2, "automatic capture remains user-visible");
  const injected = memory.selectForInjection({
    sessionId: "session-a",
    projectRoot: "D:\\project",
    excludeAutomaticSessionCapture: true,
  });
  assert.deepEqual(injected.map((entry) => entry.text), ["用户明确保存的会话事实"]);
});

test("memory retrieval is relevance bounded and the per-run disabled gate injects nothing", async () => {
  const memory = new MemoryService(undefined, () => 2_000);
  await memory.create({ scope: "personal", source: "user-explicit", text: "R14 用户偏好冷青色界面" });
  const relevant = memory.selectForInjection({ sessionId: "session-a", queryText: "请沿用冷青色界面", enabled: true });
  const unrelated = memory.selectForInjection({ sessionId: "session-a", queryText: "解释二次函数顶点", enabled: true });
  const disabled = memory.selectForInjection({ sessionId: "session-a", queryText: "冷青色", enabled: false });
  assert.equal(relevant.length, 1);
  assert.equal(unrelated.length, 0);
  assert.equal(disabled.length, 0);
});

test("two completed runs keep the real Provider header stable and append only to history", async () => {
  const root = await mkdtemp(join(process.cwd(), "codex", "运行残留", "cache-prefix-runtime-"));
  const bundle = await createHarnessApplication({
    dataRoot: root,
    workingDirectory: process.cwd(),
    assetsRoot: join(process.cwd(), "assets"),
    secretVault: new UnavailableSecretVault(),
    demoDelayMs: 0,
  });
  const provider = new ImmediateCaptureProvider();
  bundle.runtime.providerRegistry().register(provider);
  const session = bundle.runtime.snapshot().sessions[0];
  await bundle.runtime.setProviderModel(session.id, provider.descriptor.id, provider.descriptor.models[0].id);
  try {
    for (const text of ["第一轮", "第二轮"]) {
      const accepted = await bundle.runtime.send({
        sessionId: session.id,
        text,
        attachments: [],
        selectedModel: provider.descriptor.models[0].id,
        permissionMode: session.permissionMode,
      });
      assert.equal(accepted.accepted, true);
      await waitFor(() => bundle.runtime.listRuns(session.id).at(-1)?.status === "completed");
    }
    assert.equal(provider.requests.length, 2);
    const [first, second] = provider.requests;
    const header = (request: ProviderRequest) => request.contextProfile.stableSegments
      .filter((segment) => segment.name !== "stable-history")
      .map((segment) => ({ name: segment.name, text: segment.text }));
    assert.deepEqual(header(second), header(first), "automatic memory must not rewrite system/project/skills/tools");
    assert.deepEqual(second.history.slice(0, first.history.length), first.history, "later request must append to prior durable history");
    assert.ok(bundle.application.snapshot().memories?.entries.some((entry) => entry.source === "session-auto"));
  } finally {
    await bundle.application.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime injects a relevant explicit memory and honors the host-owned disabled gate on the next run", async () => {
  const root = await mkdtemp(join(process.cwd(), "codex", "运行残留", "r14-memory-runtime-"));
  const bundle = await createHarnessApplication({
    dataRoot: root,
    workingDirectory: process.cwd(),
    assetsRoot: join(process.cwd(), "assets"),
    secretVault: new UnavailableSecretVault(),
    demoDelayMs: 0,
  });
  const provider = new ImmediateCaptureProvider();
  bundle.runtime.providerRegistry().register(provider);
  const session = bundle.runtime.snapshot().sessions[0];
  await bundle.runtime.setProviderModel(session.id, provider.descriptor.id, provider.descriptor.models[0].id);
  await bundle.application.createMemory({ scope: "personal", source: "user-explicit", text: "R14 记住薄荷青偏好" });
  try {
    const first = await bundle.runtime.send({
      sessionId: session.id,
      text: "请使用薄荷青偏好",
      attachments: [],
      selectedModel: provider.descriptor.models[0].id,
      permissionMode: session.permissionMode,
      memoryEnabled: true,
    });
    assert.equal(first.accepted, true);
    await waitFor(() => provider.requests.length === 1 && bundle.runtime.listRuns(session.id).at(-1)?.status === "completed");
    assert.equal(provider.requests[0].contextProfile.stableSegments.some((segment) => segment.text.includes("R14 记住薄荷青偏好")), true);
    const second = await bundle.runtime.send({
      sessionId: session.id,
      text: "再次使用薄荷青偏好",
      attachments: [],
      selectedModel: provider.descriptor.models[0].id,
      permissionMode: session.permissionMode,
      memoryEnabled: false,
    });
    assert.equal(second.accepted, true);
    await waitFor(() => provider.requests.length === 2 && bundle.runtime.listRuns(session.id).at(-1)?.status === "completed");
    assert.equal(provider.requests[1].contextProfile.stableSegments.some((segment) => segment.text.includes("R14 记住薄荷青偏好")), false);
  } finally {
    await bundle.application.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

class CaptureProvider implements ModelProvider {
  readonly descriptor = {
    id: "cp3-capture-provider",
    name: "CP3 Capture Provider",
    label: "CP3 Capture Provider · 本地 fake",
    configuration: "demo" as const,
    available: true,
    realCallsEnabled: false,
    capabilities: ["streaming", "reasoning", "cache"],
    models: [{ id: "cp3-capture-model", label: "CP3 Capture Model" }],
  };
  request?: ProviderRequest;
  private releaseGate!: () => void;
  private readonly gate = new Promise<void>((resolve) => { this.releaseGate = resolve; });

  async *stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    this.request = structuredClone(request);
    await Promise.race([this.gate, new Promise<void>((_, reject) => signal.addEventListener("abort", () => reject(new Error("capture cancelled")), { once: true }))]);
    if (signal.aborted) return;
    yield { kind: "text.delta", text: "本地 fake 已完成" };
  }

  release(): void { this.releaseGate(); }
}

class ImmediateCaptureProvider implements ModelProvider {
  readonly descriptor = {
    id: "cache-prefix-capture",
    name: "Cache Prefix Capture",
    label: "Cache Prefix Capture · 本地 fake",
    configuration: "demo" as const,
    available: true,
    realCallsEnabled: false,
    capabilities: ["stream", "usage"],
    models: [{ id: "cache-prefix-model", label: "cache-prefix-model" }],
  };
  readonly requests: ProviderRequest[] = [];

  async *stream(request: ProviderRequest): AsyncIterable<ProviderEvent> {
    this.requests.push(JSON.parse(JSON.stringify(request)) as ProviderRequest);
    yield { kind: "text.delta", text: "已完成。" };
    yield {
      kind: "usage.completed",
      usage: {
        input: 12,
        cacheHitInput: this.requests.length > 1 ? 10 : 0,
        cacheMissInput: this.requests.length > 1 ? 2 : 12,
        cacheWriteInput: null,
        output: 2,
        reasoning: 0,
        toolUse: 0,
        total: 14,
        source: "provider",
      },
    };
  }
}
