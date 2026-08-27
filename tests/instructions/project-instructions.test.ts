import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { ProviderEvent, ProviderRequest } from "../../src/core/provider-contracts";
import { ProviderRegistry } from "../../src/features/providers/provider-registry";
import { ModelProvider } from "../../src/features/providers/model-provider";
import { AgentRuntime } from "../../src/features/runs/agent-runtime";
import { ProjectInstructionService } from "../../src/features/instructions/project-instruction-service";
import { TokenLedger } from "../../src/features/telemetry/token-ledger";
import { ToolRegistry } from "../../src/features/tools/tool-registry";
import { FileStore } from "../../src/platform/persistence/file-store";
import { FileProjectInstructionSource } from "../../src/platform/persistence/file-project-instruction-source";

test("AGENTS.md is a stable per-run project instruction snapshot and changes on the next run", async () => {
  const fixture = await createInstructionFixture();
  try {
    await writeFile(join(fixture.workingDirectory, "AGENTS.md"), "PROJECT_MARKER_ALPHA", "utf8");
    const firstRun = fixture.runtime.send(intent(fixture.runtime));
    await waitFor(() => fixture.provider.requests.length === 1);
    await writeFile(join(fixture.workingDirectory, "AGENTS.md"), "PROJECT_MARKER_BETA", "utf8");
    fixture.provider.releaseFirstRun();
    await firstRun;
    await waitFor(() => activeSession(fixture.runtime).status === "idle");

    await fixture.runtime.send(intent(fixture.runtime));
    await waitFor(() => fixture.provider.requests.length === 2 && activeSession(fixture.runtime).status === "idle");

    const firstProject = projectSegment(fixture.provider.requests[0]);
    const secondProject = projectSegment(fixture.provider.requests[1]);
    assert.match(firstProject, /PROJECT_MARKER_ALPHA/u);
    assert.doesNotMatch(firstProject, /PROJECT_MARKER_BETA/u);
    assert.match(secondProject, /PROJECT_MARKER_BETA/u);
    assert.equal(
      fixture.provider.requests[1].contextProfile.generation,
      fixture.provider.requests[0].contextProfile.generation + 1,
    );
  } finally {
    fixture.provider.releaseFirstRun();
    await fixture.runtime.flushPersistence();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("an AGENTS.md larger than 128 KiB fails diagnostically before any Provider request", async () => {
  const fixture = await createInstructionFixture();
  try {
    await writeFile(join(fixture.workingDirectory, "AGENTS.md"), "x".repeat(128 * 1024 + 1), "utf8");
    fixture.provider.releaseFirstRun();
    await fixture.runtime.send(intent(fixture.runtime));
    await waitFor(() => activeSession(fixture.runtime).status === "failed");
    assert.equal(fixture.provider.requests.length, 0);
    assert.match(activeSession(fixture.runtime).activities.at(-1)?.detail ?? "", /AGENTS\.md.*128 KiB/iu);
  } finally {
    fixture.provider.releaseFirstRun();
    await fixture.runtime.flushPersistence();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

class CapturingProvider implements ModelProvider {
  readonly descriptor = {
    id: "instructions-capture",
    name: "Instructions Capture",
    label: "本地项目指令测试 Provider",
    configuration: "demo" as const,
    available: true,
    realCallsEnabled: false,
    capabilities: [],
    models: [{ id: "capture-model", label: "Capture Model" }],
  };
  readonly requests: ProviderRequest[] = [];
  private releaseFirst!: () => void;
  private readonly firstGate = new Promise<void>((resolve) => { this.releaseFirst = resolve; });

  releaseFirstRun(): void { this.releaseFirst(); }

  async *stream(request: ProviderRequest): AsyncIterable<ProviderEvent> {
    this.requests.push(structuredClone(request));
    if (this.requests.length === 1) await this.firstGate;
    yield { kind: "text.delta", text: "完成" };
  }
}

async function createInstructionFixture() {
  const outputRoot = join(process.cwd(), "codex", "运行残留");
  await mkdir(outputRoot, { recursive: true });
  const root = await mkdtemp(join(outputRoot, "instructions-red-"));
  const workingDirectory = join(root, "workspace");
  await mkdir(workingDirectory, { recursive: true });
  const store = new FileStore(join(root, "data"));
  const telemetry = new TokenLedger(store);
  await telemetry.initialize();
  const registry = new ProviderRegistry(0);
  const provider = new CapturingProvider();
  registry.register(provider);
  const runtime = new AgentRuntime({
    persistence: store,
    defaultWorkingDirectory: workingDirectory,
    defaultProjectAccess: { enabled: true, selectedBy: "cli-explicit" },
    tokenLedger: telemetry,
    registry,
    toolRegistry: new ToolRegistry(),
    instructionLoader: new ProjectInstructionService(new FileProjectInstructionSource()),
  });
  await runtime.initialize();
  const session = activeSession(runtime);
  assert.equal(await runtime.setProviderModel(session.id, provider.descriptor.id, provider.descriptor.models[0].id), true);
  return { root, workingDirectory, runtime, provider };
}

function activeSession(runtime: AgentRuntime) {
  const snapshot = runtime.snapshot();
  return snapshot.sessions.find((session) => session.id === snapshot.activeSessionId)!;
}

function intent(runtime: AgentRuntime) {
  const session = activeSession(runtime);
  return { sessionId: session.id, text: "读取项目指令", attachments: [], selectedModel: session.selectedModel, permissionMode: session.permissionMode };
}

function projectSegment(request: ProviderRequest): string {
  return request.contextProfile.stableSegments.find((segment) => segment.name === "project")?.text ?? "";
}

async function waitFor(predicate: () => boolean, timeoutMs = 1600): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for project-instructions state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
