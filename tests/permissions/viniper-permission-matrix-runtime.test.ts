import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { ProviderEvent, ProviderRequest, ProviderToolCallItem } from "../../src/core/provider-contracts";
import { ModelProvider } from "../../src/features/providers/model-provider";
import { createHarnessApplication } from "../../src/platform/bootstrap/create-harness-application";
import { UnavailableSecretVault } from "../../src/platform/security/unavailable-secret-vault";

class ManualTerminalProvider implements ModelProvider {
  readonly descriptor = descriptor("viniper-manual-runtime", "viniper-manual-model");
  readonly requests: ProviderRequest[] = [];

  async *stream(request: ProviderRequest): AsyncIterable<ProviderEvent> {
    this.requests.push(structuredClone(request));
    const results = request.history.flatMap((entry) => entry.items).filter((item) => item.type === "tool-result");
    if (!results.some((item) => item.callId === "manual-terminal-allow")) {
      yield { kind: "tool-call.completed", call: toolCall("manual-terminal-allow", "terminal.run", {
        command: process.platform === "win32" ? "[Console]::Out.Write('R11C_MANUAL_ALLOW_OK')" : "printf R11C_MANUAL_ALLOW_OK",
        purpose: "test",
        timeoutMs: 8_000,
      }) };
      return;
    }
    if (!results.some((item) => item.callId === "manual-terminal-reject")) {
      yield { kind: "tool-call.completed", call: toolCall("manual-terminal-reject", "terminal.run", {
        command: process.platform === "win32" ? "Set-Content -LiteralPath 'must-not-run.txt' -Value 'MUST_NOT_RUN'" : "printf MUST_NOT_RUN > must-not-run.txt",
        purpose: "test",
        timeoutMs: 8_000,
      }) };
      return;
    }
    yield { kind: "text.delta", text: "每次询问闭环完成。" };
  }
}

class FullAccessMatrixProvider implements ModelProvider {
  readonly descriptor = descriptor("viniper-full-runtime", "viniper-full-model");
  readonly requests: ProviderRequest[] = [];

  constructor(private readonly projectRoot: string) {}

  async *stream(request: ProviderRequest): AsyncIterable<ProviderEvent> {
    this.requests.push(structuredClone(request));
    const hasToolResult = request.history.some((entry) => entry.items.some((item) => item.type === "tool-result"));
    if (hasToolResult) {
      yield { kind: "text.delta", text: "完全访问本地工具矩阵闭环完成。" };
      return;
    }
    const genericPath = join(this.projectRoot, "generic-created.txt");
    const calls = [
      toolCall("full-project-list", "project.list", {}),
      toolCall("full-project-search", "project.search", { query: "R11C_SEED" }),
      toolCall("full-project-read", "project.read", { path: "seed.txt" }),
      toolCall("full-project-write", "project.write", { path: "created.txt", content: "R11C_CREATE\n", mode: "create" }),
      toolCall("full-project-edit", "project.edit", { path: "created.txt", edits: [{ oldText: "CREATE", newText: "EDIT", expectedMatches: 1 }] }),
      toolCall("full-terminal", "terminal.run", {
        command: process.platform === "win32" ? `[Console]::Out.Write("R11C_PS7_OK|$($PSVersionTable.PSEdition)|$($PSVersionTable.PSVersion.Major)")` : `printf 'R11C_POSIX_OK|%s' "\${ZSH_VERSION:-sh}"`,
        purpose: "test",
        timeoutMs: 8_000,
      }),
      toolCall("full-delete-one", "project.delete", { path: "delete-one.txt" }),
      toolCall("full-delete-two", "project.delete", { path: "delete-two.txt" }),
      toolCall("full-file-write", "file.write", { path: genericPath, content: "GENERIC_CREATE\n", mode: "create" }),
      toolCall("full-file-edit", "file.edit", { path: genericPath, oldText: "CREATE", newText: "EDIT", expectedMatches: 1 }),
      toolCall("full-file-read", "file.read", { path: genericPath }),
      toolCall("full-file-list", "file.list", { path: this.projectRoot }),
      toolCall("full-file-delete", "file.delete", { path: genericPath }),
    ];
    for (const call of calls) yield { kind: "tool-call.completed", call };
  }
}

test("manual mode asks for every independent terminal mutation and a rejection starts no process", async () => {
  const scene = await runtimeFixture("manual");
  try {
    const provider = new ManualTerminalProvider();
    scene.bundle.runtime.providerRegistry().register(provider);
    const session = await scene.bundle.runtime.createProjectSession(scene.projectRoot, "cli-explicit", "viniper");
    await scene.bundle.runtime.setProviderModel(session.id, provider.descriptor.id, "viniper-manual-model");
    await scene.bundle.runtime.setPermissionMode(session.id, "ask");
    await scene.bundle.runtime.send({
      sessionId: session.id,
      text: "逐次验证两个终端状态变更请求",
      attachments: [],
      selectedModel: "viniper-manual-model",
      permissionMode: "ask",
      origin: { kind: "user" },
    });

    await waitFor(() => scene.bundle.runtime.pendingToolApprovals().find((item) => item.callId === "manual-terminal-allow"));
    const first = scene.bundle.runtime.pendingToolApprovals().find((item) => item.callId === "manual-terminal-allow")!;
    assert.equal(await scene.bundle.runtime.resolveToolApproval(session.id, first.runId, first.callId, "allow-once"), true);
    await waitFor(() => scene.bundle.runtime.pendingToolApprovals().find((item) => item.callId === "manual-terminal-reject"));
    const second = scene.bundle.runtime.pendingToolApprovals().find((item) => item.callId === "manual-terminal-reject")!;
    assert.equal(await scene.bundle.runtime.resolveToolApproval(session.id, second.runId, second.callId, "reject"), true);
    await waitFor(() => !scene.bundle.runtime.isRunning(session.id));

    const completed = scene.bundle.runtime.getSession(session.id)!;
    const allowed = completed.activities.find((item) => item.callId === "manual-terminal-allow");
    const rejected = completed.activities.find((item) => item.callId === "manual-terminal-reject" && item.kind === "tool");
    assert.equal(allowed?.presentation?.kind, "terminal-run");
    if (allowed?.presentation?.kind === "terminal-run") {
      assert.equal(allowed.presentation.status, "completed");
      assert.match(allowed.presentation.stdout?.preview ?? "", /R11C_MANUAL_ALLOW_OK/u);
    }
    assert.equal(rejected?.status, "failed");
    assert.equal(rejected?.presentation, undefined, "rejected terminal request must not own a process result");
    await assert.rejects(readFile(join(scene.projectRoot, "must-not-run.txt"), "utf8"), { code: "ENOENT" });
    assert.equal(scene.bundle.runtime.pendingToolApprovals().length, 0);
  } finally {
    await scene.dispose();
  }
});

test("full access completes the enabled local file/project/terminal matrix without permission cards", async () => {
  const scene = await runtimeFixture("full");
  try {
    await writeFile(join(scene.projectRoot, "seed.txt"), "R11C_SEED\n", "utf8");
    await writeFile(join(scene.projectRoot, "delete-one.txt"), "DELETE_ONE\n", "utf8");
    await writeFile(join(scene.projectRoot, "delete-two.txt"), "DELETE_TWO\n", "utf8");
    const provider = new FullAccessMatrixProvider(scene.projectRoot);
    scene.bundle.runtime.providerRegistry().register(provider);
    const session = await scene.bundle.runtime.createProjectSession(scene.projectRoot, "cli-explicit", "viniper");
    await scene.bundle.runtime.setProviderModel(session.id, provider.descriptor.id, "viniper-full-model");
    await scene.bundle.runtime.setPermissionMode(session.id, "full");
    await scene.bundle.runtime.send({
      sessionId: session.id,
      text: "执行完全访问本地安全工具矩阵",
      attachments: [],
      selectedModel: "viniper-full-model",
      permissionMode: "full",
      origin: { kind: "user" },
    });
    await waitFor(() => !scene.bundle.runtime.isRunning(session.id), 20_000);

    const completed = scene.bundle.runtime.getSession(session.id)!;
    const toolActivities = completed.activities.filter((item) => item.kind === "tool");
    const expectedCalls = [
      "full-project-list", "full-project-search", "full-project-read", "full-project-write", "full-project-edit",
      "full-terminal", "full-delete-one", "full-delete-two", "full-file-write", "full-file-edit",
      "full-file-read", "full-file-list", "full-file-delete",
    ];
    assert.deepEqual(expectedCalls.filter((callId) => !toolActivities.some((item) => item.callId === callId && item.status === "completed")), []);
    assert.equal(completed.activities.some((item) => item.kind === "interaction" && item.title === "等待工具权限"), false);
    assert.equal(scene.bundle.runtime.pendingToolApprovals().length, 0);
    assert.equal(await readFile(join(scene.projectRoot, "created.txt"), "utf8"), "R11C_EDIT\n");
    await assert.rejects(readFile(join(scene.projectRoot, "delete-one.txt"), "utf8"), { code: "ENOENT" });
    await assert.rejects(readFile(join(scene.projectRoot, "delete-two.txt"), "utf8"), { code: "ENOENT" });
    await assert.rejects(readFile(join(scene.projectRoot, "generic-created.txt"), "utf8"), { code: "ENOENT" });

    const terminal = toolActivities.find((item) => item.callId === "full-terminal");
    assert.equal(terminal?.presentation?.kind, "terminal-run");
    if (terminal?.presentation?.kind === "terminal-run") {
      assert.equal(terminal.presentation.status, "completed");
      assert.equal(terminal.presentation.exitCode, 0);
      if (process.platform === "win32") {
        assert.match(terminal.presentation.stdout?.preview ?? "", /R11C_PS7_OK\|Core\|7/u);
        assert.equal(terminal.presentation.processIdentity?.edition, "Core");
        assert.equal((terminal.presentation.processIdentity?.major ?? 0) >= 7, true);
        assert.match(terminal.presentation.processIdentity?.executable ?? "", /pwsh(?:\.exe)?$/iu);
      } else {
        assert.match(terminal.presentation.stdout?.preview ?? "", /R11C_POSIX_OK\|\S+/u);
        assert.equal(terminal.presentation.processIdentity, undefined);
      }
    }
    const deletions = toolActivities.filter((item) => ["full-delete-one", "full-delete-two"].includes(item.callId || ""));
    assert.equal(deletions.every((item) => item.presentation?.kind === "project-change" && Boolean(item.presentation.recoveryReceiptId)), true);
  } finally {
    await scene.dispose();
  }
});

function descriptor(id: string, modelId: string) {
  return {
    id,
    name: id,
    label: `${id} · 本地`,
    configuration: "demo" as const,
    available: true,
    realCallsEnabled: false,
    capabilities: ["tools"],
    models: [{ id: modelId, label: modelId }],
  };
}

function toolCall(callId: string, name: string, args: Record<string, unknown>): ProviderToolCallItem {
  return { type: "tool-call", callId, name, arguments: args, argumentsText: JSON.stringify(args) };
}

async function runtimeFixture(label: string) {
  const dataRoot = await mkdtemp(join(tmpdir(), `viniper-${label}-data-`));
  const projectRoot = await mkdtemp(join(tmpdir(), `viniper-${label}-project-`));
  const bundle = await createHarnessApplication({
    dataRoot,
    assetsRoot: dataRoot,
    workingDirectory: dataRoot,
    secretVault: new UnavailableSecretVault(),
    demoDelayMs: 1,
  });
  return {
    dataRoot,
    projectRoot,
    bundle,
    dispose: async () => {
      await bundle.application.dispose();
      await rm(dataRoot, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    },
  };
}

async function waitFor<T>(predicate: () => T, timeoutMs = 12_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for Viniper permission matrix");
}
