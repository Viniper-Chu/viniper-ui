import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { ToolRequest } from "../../src/core/contracts";
import { ProviderEvent, ProviderRequest } from "../../src/core/provider-contracts";
import { ModelProvider } from "../../src/features/providers/model-provider";
import { ToolExecutionContext, ToolExecutor, ToolResult } from "../../src/features/tools/tool-registry";
import { createHarnessApplication } from "../../src/platform/bootstrap/create-harness-application";
import { UnavailableSecretVault } from "../../src/platform/security/unavailable-secret-vault";

class P2MutationProvider implements ModelProvider {
  readonly descriptor = {
    id: "p2-local-fake",
    name: "P2 Local Fake",
    label: "P2 Local Fake · 本地",
    configuration: "demo" as const,
    available: true,
    realCallsEnabled: false,
    capabilities: ["tools"],
    models: [{ id: "p2-local-model", label: "P2 Local Model" }],
  };
  readonly requests: ProviderRequest[] = [];

  async *stream(request: ProviderRequest): AsyncIterable<ProviderEvent> {
    this.requests.push(structuredClone(request));
    if (this.requests.length === 1 || this.requests.length === 2) {
      yield {
        kind: "tool-call.completed",
        call: toolCall("p2-same-write-call", "project.write", {
          path: "created-by-agent.txt",
          mode: "create",
          content: "P2_PROVIDER_HISTORY_FACT\n",
        }),
      };
      return;
    }
    if (this.requests.length === 3) {
      yield {
        kind: "tool-call.completed",
        call: toolCall("p2-delete-call", "project.delete", { path: "created-by-agent.txt" }),
      };
      return;
    }
    yield { kind: "text.delta", text: "P2 本地工具闭环完成。" };
  }
}

class P2RejectedProvider implements ModelProvider {
  readonly descriptor = {
    id: "p2-reject-fake",
    name: "P2 Reject Fake",
    label: "P2 Reject Fake · 本地",
    configuration: "demo" as const,
    available: true,
    realCallsEnabled: false,
    capabilities: ["tools"],
    models: [{ id: "p2-reject-model", label: "P2 Reject Model" }],
  };
  readonly requests: ProviderRequest[] = [];

  async *stream(request: ProviderRequest): AsyncIterable<ProviderEvent> {
    this.requests.push(structuredClone(request));
    if (this.requests.length === 1) {
      yield {
        kind: "tool-call.completed",
        call: toolCall("p2-rejected-write", "project.write", {
          path: "must-not-exist.txt",
          mode: "create",
          content: "MUST_NOT_BE_WRITTEN\n",
        }),
      };
      return;
    }
    yield { kind: "text.delta", text: "拒绝已进入 Provider continuation。" };
  }
}

class P2ConcurrentProvider implements ModelProvider {
  readonly descriptor = {
    id: "p2-concurrent-fake",
    name: "P2 Concurrent Fake",
    label: "P2 Concurrent Fake · 本地",
    configuration: "demo" as const,
    available: true,
    realCallsEnabled: false,
    capabilities: ["tools"],
    models: [{ id: "p2-concurrent-model", label: "P2 Concurrent Model" }],
  };

  async *stream(request: ProviderRequest): AsyncIterable<ProviderEvent> {
    const hasResult = request.history.some((entry) => entry.items.some((item) => item.type === "tool-result"));
    if (!hasResult) {
      yield {
        kind: "tool-call.completed",
        call: toolCall(`lock-${request.sessionId}`, "project.lock-probe", { path: "shared.txt" }),
      };
      return;
    }
    yield { kind: "text.delta", text: "资源锁闭环完成。" };
  }
}

class P2LockProbeTool implements ToolExecutor {
  readonly name = "project.lock-probe";
  readonly description = "P2 本地资源锁探针";
  readonly readOnly = false;
  readonly authorizationScope = "project" as const;
  readonly inputSchema = {
    type: "object" as const,
    properties: { path: { type: "string" as const } },
    required: ["path"],
    additionalProperties: false,
  };
  active = 0;
  maxActive = 0;
  readonly order: string[] = [];

  resourceClaims(request: ToolRequest, context: ToolExecutionContext) {
    return [{ key: resolve(context.projectRoot!, String(request.input?.path)), access: "write" as const }];
  }

  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.order.push(`start:${context.sessionId}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 60));
    this.order.push(`end:${context.sessionId}`);
    this.active -= 1;
    return { toolId: request.id, text: JSON.stringify({ ok: true, path: "shared.txt" }) };
  }
}

test("P2-01/P2-02/P2-03 formal Runtime preserves callId, structured events, bounded history and user recovery", async () => {
  const scene = await runtimeFixture();
  try {
    const provider = new P2MutationProvider();
    scene.bundle.runtime.providerRegistry().register(provider);
    const session = await scene.bundle.application.createProjectSession(scene.projectRoot);
    assert.equal(await scene.bundle.application.setProviderModel(session.id, provider.descriptor.id, "p2-local-model"), true);
    assert.equal(await scene.bundle.application.setPermissionMode(session.id, "ask"), true);
    await scene.bundle.application.send({
      sessionId: session.id,
      text: "执行 P2 本地写入、去重和删除",
      attachments: [],
      selectedModel: "p2-local-model",
      permissionMode: "ask",
    });

    await waitFor(() => scene.bundle.runtime.pendingToolApprovals().some((item) => item.callId === "p2-same-write-call"));
    const firstApproval = scene.bundle.runtime.pendingToolApprovals().find((approval) => approval.callId === "p2-same-write-call")!;
    assert.equal(await scene.bundle.application.resolveToolApproval(session.id, firstApproval.runId, "p2-same-write-call", "allow-once"), true);
    await waitFor(() => scene.bundle.runtime.pendingToolApprovals().some((item) => item.callId === "p2-delete-call"));
    const deleteApproval = scene.bundle.runtime.pendingToolApprovals().find((approval) => approval.callId === "p2-delete-call")!;
    assert.equal(await scene.bundle.application.resolveToolApproval(session.id, deleteApproval.runId, "p2-delete-call", "allow-once"), true);
    await waitFor(() => !scene.bundle.runtime.isRunning(session.id));

    assert.equal(provider.requests.length, 4);
    assert.deepEqual(provider.requests[0].tools.filter((tool) => tool.name.startsWith("project.")).map((tool) => [tool.name, tool.readOnly]), [
      ["project.delete", false],
      ["project.diff", true],
      ["project.edit", false],
      ["project.list", true],
      ["project.move", false],
      ["project.read", true],
      ["project.search", true],
      ["project.write", false],
    ]);
    await assert.rejects(readFile(join(scene.projectRoot, "created-by-agent.txt"), "utf8"), { code: "ENOENT" });

    const historyText = JSON.stringify(provider.requests.flatMap((request) => request.history));
    assert.doesNotMatch(historyText, new RegExp(escapeRegExp(scene.projectRoot), "iu"));
    assert.doesNotMatch(historyText, new RegExp(escapeRegExp(scene.dataRoot), "iu"));
    assert.match(historyText, /P2_PROVIDER_HISTORY_FACT/u);
    assert.equal((historyText.match(/p2-same-write-call/gu) ?? []).length > 1, true, "duplicate callId is continued without a second write");

    const completed = scene.bundle.runtime.getSession(session.id)!;
    const completedEvents = completed.events.filter((event) => event.type === "tool.completed");
    const presentations = completedEvents
      .map((event) => (event.payload as { presentation?: { action?: string; recoveryReceiptId?: string } }).presentation)
      .filter(Boolean);
    assert.equal(presentations.some((item) => item?.action === "create"), true);
    const deletion = presentations.find((item) => item?.action === "delete");
    assert.equal(Boolean(deletion?.recoveryReceiptId), true);
    const requested = completed.events.find((event) => event.type === "tool.requested"
      && (event.payload as { callId?: string }).callId === "p2-same-write-call")!;
    assert.equal((requested.payload as { status: string }).status, "waiting", "append-only requested payload remains unchanged");

    const restored = await scene.bundle.application.restoreProjectChange(session.id, deletion!.recoveryReceiptId!);
    assert.equal((restored as { ok: boolean }).ok, true);
    assert.equal(await readFile(join(scene.projectRoot, "created-by-agent.txt"), "utf8"), "P2_PROVIDER_HISTORY_FACT\n");
    assert.equal(provider.requests.length, 4, "user recovery never triggers another Provider request");
    const afterRestore = scene.bundle.runtime.getSession(session.id)!;
    assert.equal(afterRestore.activities.some((activity) =>
      activity.presentation && "action" in activity.presentation && activity.presentation.action === "restore"), true);
  } finally {
    await scene.dispose();
  }
});

test("P2-03 a rejected state-changing tool performs zero filesystem writes", async () => {
  const scene = await runtimeFixture();
  try {
    const provider = new P2RejectedProvider();
    scene.bundle.runtime.providerRegistry().register(provider);
    const session = await scene.bundle.application.createProjectSession(scene.projectRoot);
    await scene.bundle.application.setProviderModel(session.id, provider.descriptor.id, "p2-reject-model");
    await scene.bundle.application.setPermissionMode(session.id, "ask");
    await scene.bundle.application.send({
      sessionId: session.id,
      text: "这次拒绝写入",
      attachments: [],
      selectedModel: "p2-reject-model",
      permissionMode: "ask",
    });
    await waitFor(() => scene.bundle.runtime.pendingToolApprovals().some((item) => item.callId === "p2-rejected-write"));
    const rejectedApproval = scene.bundle.runtime.pendingToolApprovals().find((approval) => approval.callId === "p2-rejected-write")!;
    assert.equal(await scene.bundle.application.resolveToolApproval(session.id, rejectedApproval.runId, "p2-rejected-write", "reject"), true);
    await waitFor(() => !scene.bundle.runtime.isRunning(session.id));
    await assert.rejects(readFile(join(scene.projectRoot, "must-not-exist.txt"), "utf8"), { code: "ENOENT" });
    const result = provider.requests[1].history.at(-1)?.items[0];
    assert.equal(result?.type, "tool-result");
    if (result?.type === "tool-result") assert.equal(result.isError, true);
  } finally {
    await scene.dispose();
  }
});

test("P2-03 two formal Runtime sessions serialize the same advertised project resource", async () => {
  const scene = await runtimeFixture();
  try {
    const provider = new P2ConcurrentProvider();
    const probe = new P2LockProbeTool();
    scene.bundle.runtime.providerRegistry().register(provider);
    scene.bundle.toolRegistry.register(probe);
    const first = await scene.bundle.application.createProjectSession(scene.projectRoot);
    const second = await scene.bundle.application.createProjectSession(scene.projectRoot);
    for (const session of [first, second]) {
      await scene.bundle.application.setProviderModel(session.id, provider.descriptor.id, "p2-concurrent-model");
      await scene.bundle.application.setPermissionMode(session.id, "full");
      await scene.bundle.application.send({
        sessionId: session.id,
        text: `并发资源锁 ${session.id}`,
        attachments: [],
        selectedModel: "p2-concurrent-model",
        permissionMode: "full",
      });
    }
    await waitFor(() => !scene.bundle.runtime.isRunning(first.id) && !scene.bundle.runtime.isRunning(second.id));

    assert.equal(probe.maxActive, 1, "same path is never executed concurrently across sessions");
    assert.equal(probe.order.length, 4);
    assert.equal(scene.bundle.runtime.getSession(first.id)?.events.some((event) => event.type === "tool.completed"), true);
    assert.equal(scene.bundle.runtime.getSession(second.id)?.events.some((event) => event.type === "tool.completed"), true);
    const waited = [first.id, second.id].some((sessionId) => scene.bundle.runtime.getSession(sessionId)?.events.some((event) =>
      event.type === "interaction.requested"
      && (event.payload as { title?: string }).title === "等待项目资源"));
    assert.equal(waited, true);
  } finally {
    await scene.dispose();
  }
});

async function runtimeFixture() {
  const residue = resolve(process.cwd(), "codex", "运行残留");
  await mkdir(residue, { recursive: true });
  const dataRoot = await mkdtemp(join(residue, "phase7-p2-runtime-data-"));
  const projectRoot = await mkdtemp(join(residue, "phase7-p2-runtime-project-"));
  await writeFile(join(projectRoot, "seed.txt"), "seed\n", "utf8");
  const bundle = await createHarnessApplication({
    dataRoot,
    workingDirectory: projectRoot,
    assetsRoot: dataRoot,
    secretVault: new UnavailableSecretVault(),
    demoDelayMs: 1,
  });
  return {
    dataRoot,
    projectRoot,
    bundle,
    dispose: async () => {
      bundle.application.dispose();
      await bundle.runtime.flushPersistence();
      await rm(dataRoot, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    },
  };
}

function toolCall(callId: string, name: string, args: Record<string, unknown>) {
  return {
    type: "tool-call" as const,
    callId,
    name,
    arguments: args,
    argumentsText: JSON.stringify(args),
    protocolItemId: callId,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 4_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for P2 runtime state");
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
