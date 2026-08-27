import assert from "node:assert/strict";
import { execFile as nodeExecFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { ProviderEvent, ProviderRequest } from "../../src/core/provider-contracts";
import { ModelProvider } from "../../src/features/providers/model-provider";
import { createHarnessApplication } from "../../src/platform/bootstrap/create-harness-application";
import { UnavailableSecretVault } from "../../src/platform/security/unavailable-secret-vault";

const execFile = promisify(nodeExecFile);

class P4LocalProvider implements ModelProvider {
  readonly descriptor = {
    id: "p4-local-fake",
    name: "P4 Local Fake",
    label: "P4 Local Fake · 本地",
    configuration: "demo" as const,
    available: true,
    realCallsEnabled: false,
    capabilities: ["tools"],
    models: [{ id: "p4-local-model", label: "P4 Local Model" }],
  };
  readonly requests: ProviderRequest[] = [];

  async *stream(request: ProviderRequest): AsyncIterable<ProviderEvent> {
    this.requests.push(structuredClone(request));
    const prompt = request.history.flatMap((entry) => entry.items).find((item) => item.type === "text")?.text ?? "";
    if (prompt.includes("只读审查")) {
      yield { kind: "text.delta", text: "PASS\nsuggestion: 只读审查完成" };
      return;
    }
    if (request.history.length === 1 && request.history[0].role === "user") {
      yield { kind: "tool-call.completed", call: toolCall("p4-write", "project.write", { path: "answer.txt", content: "P4_REAL_CHAIN\n", mode: "create" }) };
      return;
    }
    const results = request.history.flatMap((entry) => entry.items).filter((item) => item.type === "tool-result");
    if (results.some((item) => item.name === "project.write") && !results.some((item) => item.name === "terminal.run")) {
      yield { kind: "tool-call.completed", call: toolCall("p4-test", "terminal.run", { command: "[Console]::Out.Write('P4_TEST_OK')", purpose: "test", timeoutMs: 8_000 }) };
      return;
    }
    if (request.tools.some((tool) => tool.name === "project.write") && results.some((item) => item.name === "terminal.run")) {
      yield { kind: "text.delta", text: "P4 主运行已完成。" };
      return;
    }
    yield { kind: "text.delta", text: "PASS\nsuggestion: 只读审查完成" };
  }
}

test("P4 Runtime drives project write -> terminal test -> automatic read-only review -> isolated commit", async () => {
  const residue = resolve(process.cwd(), "codex", "运行残留");
  await mkdir(residue, { recursive: true });
  const dataRoot = await mkdtemp(join(residue, "phase7-p4-runtime-data-"));
  const projectRoot = await mkdtemp(join(residue, "phase7-p4-runtime-project-"));
  try {
    await execGit(projectRoot, ["init", "-b", "main"]);
    await execGit(projectRoot, ["config", "user.name", "P4 Runtime Fixture"]);
    await execGit(projectRoot, ["config", "user.email", "p4-runtime@example.invalid"]);
    await writeFile(join(projectRoot, "README.md"), "p4 runtime\n", "utf8");
    await execGit(projectRoot, ["add", "README.md"]);
    await execGit(projectRoot, ["commit", "-m", "fixture baseline"]);
    const bundle = await createHarnessApplication({ dataRoot, workingDirectory: projectRoot, assetsRoot: dataRoot, secretVault: new UnavailableSecretVault(), demoDelayMs: 1 });
    const provider = new P4LocalProvider();
    bundle.runtime.providerRegistry().register(provider);
    const session = await bundle.application.createProjectSession(projectRoot);
    await bundle.application.setProviderModel(session.id, provider.descriptor.id, "p4-local-model");
    await bundle.application.setPermissionMode(session.id, "full");
    await bundle.application.send({
      sessionId: session.id,
      text: "编辑文件并运行测试，然后审查",
      attachments: [],
      selectedModel: "p4-local-model",
      permissionMode: "full",
      workspaceMode: "isolated",
      reviewPolicy: "auto",
    });
    await waitFor(() => !bundle.runtime.isRunning(session.id), 10_000);
    const snapshot = bundle.runtime.snapshot();
    const workspace = snapshot.workspaces?.at(-1);
    assert.ok(workspace);
    assert.equal(workspace.mode, "isolated");
    assert.equal(workspace.reviewOutcome, "PASS");
    assert.equal(workspace.status, "merge_ready");
    assert.deepEqual(workspace.ownedPaths, ["answer.txt"]);
    assert.equal(provider.requests.length, 4, "主运行两轮 + 本地只读 review 一轮，provider 仍为 fake");
    assert.equal(provider.requests.at(-1)?.tools.some((tool) => tool.name === "git.commit"), false);
    assert.equal(provider.requests.at(-1)?.tools.some((tool) => tool.name === "terminal.run"), false);
    assert.doesNotMatch(JSON.stringify(provider.requests), new RegExp(escapeRegExp(dataRoot), "iu"));
    assert.doesNotMatch(JSON.stringify(provider.requests), new RegExp(escapeRegExp(projectRoot), "iu"));
    assert.equal(await bundle.workspaceService.merge(workspace.id), true);
    assert.equal((await readFile(join(projectRoot, "answer.txt"), "utf8")).trim(), "P4_REAL_CHAIN");
    await bundle.application.dispose();
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

function toolCall(callId: string, name: string, argumentsValue: Record<string, unknown>) {
  return { type: "tool-call" as const, callId, name, arguments: argumentsValue, argumentsText: JSON.stringify(argumentsValue) };
}

async function execGit(cwd: string, args: string[]): Promise<void> {
  await execFile("git", args, { cwd, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("等待 P4 Runtime 完成超时。");
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"); }
