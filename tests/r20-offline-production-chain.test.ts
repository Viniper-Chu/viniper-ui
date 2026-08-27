import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { ProviderEvent, ProviderRequest, ProviderToolCallItem } from "../src/core/provider-contracts";
import { ModelProvider } from "../src/features/providers/model-provider";
import { createHarnessApplication } from "../src/platform/bootstrap/create-harness-application";
import { UnavailableSecretVault } from "../src/platform/security/unavailable-secret-vault";

class GenericToolFixtureProvider implements ModelProvider {
  readonly descriptor = {
    id: "r20-generic-fixture",
    name: "R20 Generic Fixture",
    label: "R20 Generic Fixture · 离线",
    configuration: "demo" as const,
    available: true,
    realCallsEnabled: false,
    capabilities: ["tools"],
    models: [{ id: "r20-generic-model", label: "R20 Generic Model" }],
  };
  readonly requests: ProviderRequest[] = [];

  constructor(private readonly filePath: string) {}

  async *stream(request: ProviderRequest): AsyncIterable<ProviderEvent> {
    this.requests.push(structuredClone(request));
    const hasResult = request.history.some((entry) => entry.items.some((item) => item.type === "tool-result"));
    if (!hasResult) {
      yield { kind: "tool-call.completed", call: toolCall("r20-list", "file.list", { path: resolve(this.filePath, "..") }) };
      return;
    }
    yield { kind: "text.delta", text: "离线工具链闭环完成。" };
  }
}

class AskWriteFixtureProvider implements ModelProvider {
  readonly descriptor = {
    id: "r20-ask-fixture",
    name: "R20 Ask Fixture",
    label: "R20 Ask Fixture · 离线",
    configuration: "demo" as const,
    available: true,
    realCallsEnabled: false,
    capabilities: ["tools"],
    models: [{ id: "r20-ask-model", label: "R20 Ask Model" }],
  };
  readonly requests: ProviderRequest[] = [];

  constructor(private readonly filePath: string) {}

  async *stream(request: ProviderRequest): AsyncIterable<ProviderEvent> {
    this.requests.push(structuredClone(request));
    const hasResult = request.history.some((entry) => entry.items.some((item) => item.type === "tool-result"));
    if (!hasResult) {
      yield { kind: "tool-call.completed", call: toolCall("r20-write", "file.write", { path: this.filePath, content: "R20_APPROVED\n", mode: "create" }) };
      return;
    }
    yield { kind: "text.delta", text: "一次性批准后的离线写入完成。" };
  }
}

test("R20 generic no-project production chain advertises absolute file, terminal, web, GitHub and built-in coordination tools", async () => {
  const dataRoot = await mkdtemp(join(process.cwd(), "codex", "运行残留", "r20-generic-data-"));
  const workRoot = await mkdtemp(join(process.cwd(), "codex", "运行残留", "r20-generic-work-"));
  const assetsRoot = join(process.cwd(), "resources", "viniper-ui", "harness-runtime");
  const bundle = await createHarnessApplication({
    dataRoot,
    workingDirectory: workRoot,
    assetsRoot,
    secretVault: new UnavailableSecretVault(),
    demoDelayMs: 1,
  });
  const provider = new GenericToolFixtureProvider(workRoot);
  bundle.runtime.providerRegistry().register(provider);
  try {
    const session = bundle.application.snapshot().sessions[0];
    assert.equal(session.projectAccess?.enabled === true, false);
    assert.equal(await bundle.runtime.setProviderModel(session.id, provider.descriptor.id, "r20-generic-model"), true);
    await bundle.runtime.send({
      sessionId: session.id,
      text: "列出本地工作区目录",
      attachments: [],
      selectedModel: "r20-generic-model",
      permissionMode: session.permissionMode,
    });
    await waitFor(() => !bundle.runtime.isRunning(session.id));
    assert.equal(provider.requests.length, 2);
    const names = new Set(provider.requests[0].tools.map((tool) => tool.name));
    for (const required of [
      "file.open", "file.list", "file.read", "file.write", "file.edit", "file.move", "file.delete",
      "terminal.run", "terminal.output", "web.fetch", "github.repository.read",
      "coordination.send-message", "coordination.delegate-task", "coordination.wait-for-result", "coordination.read-result",
    ]) assert.equal(names.has(required), true, `missing generic tool ${required}`);
    assert.equal([...names].some((name) => name.startsWith("mcp.")), false, "未配置 MCP 时不得虚构动态工具");
    assert.equal(bundle.runtime.getSession(session.id)?.events.some((event) => event.type === "tool.completed"), true);
    assert.equal(bundle.runtime.getSession(session.id)?.messages.at(-1)?.text, "离线工具链闭环完成。");
  } finally {
    await bundle.application.dispose();
    await rm(dataRoot, { recursive: true, force: true });
    await rm(workRoot, { recursive: true, force: true });
  }
});

test("R20 ask mode exposes one pending approval, rejects stale correlation, and executes exactly once", async () => {
  const dataRoot = await mkdtemp(join(process.cwd(), "codex", "运行残留", "r20-ask-data-"));
  const workRoot = await mkdtemp(join(process.cwd(), "codex", "运行残留", "r20-ask-work-"));
  const filePath = join(workRoot, "approved.txt");
  const assetsRoot = join(process.cwd(), "resources", "viniper-ui", "harness-runtime");
  const bundle = await createHarnessApplication({
    dataRoot,
    workingDirectory: workRoot,
    assetsRoot,
    secretVault: new UnavailableSecretVault(),
    demoDelayMs: 1,
  });
  const provider = new AskWriteFixtureProvider(filePath);
  bundle.runtime.providerRegistry().register(provider);
  try {
    const session = await bundle.runtime.createSession(workRoot, { enabled: true, selectedBy: "cli-explicit" }, "viniper");
    assert.equal(await bundle.runtime.setProviderModel(session.id, provider.descriptor.id, "r20-ask-model"), true);
    assert.equal(await bundle.runtime.setPermissionMode(session.id, "ask"), true);
    await bundle.runtime.send({
      sessionId: session.id,
      text: "创建一个临时 Markdown 验证文件",
      attachments: [],
      selectedModel: "r20-ask-model",
      permissionMode: "ask",
    });
    await waitFor(() => bundle.runtime.pendingToolApprovals().some((item) => item.callId === "r20-write"));
    const pending = bundle.runtime.pendingToolApprovals().find((item) => item.callId === "r20-write")!;
    assert.equal(await bundle.runtime.resolveToolApproval(session.id, "stale-run", pending.callId, "allow-once"), false);
    assert.equal(await bundle.runtime.resolveToolApproval(session.id, pending.runId, pending.callId, "allow-once"), true);
    assert.equal(await bundle.runtime.resolveToolApproval(session.id, pending.runId, pending.callId, "allow-once"), false);
    await waitFor(() => !bundle.runtime.isRunning(session.id));
    assert.equal(await readFile(filePath, "utf8"), "R20_APPROVED\n");
    const current = bundle.runtime.getSession(session.id)!;
    assert.equal(current.events.filter((event) => event.type === "tool.completed").length, 1);
    assert.equal(current.events.filter((event) => event.type === "interaction.resolved").length, 1);
    assert.equal(bundle.runtime.pendingToolApprovals().length, 0);
  } finally {
    await bundle.application.dispose();
    await rm(dataRoot, { recursive: true, force: true });
    await rm(workRoot, { recursive: true, force: true });
  }
});

test("R20 Application Port bounds a stalled terminal queue and invokes cancellation", async () => {
  const root = process.cwd();
  const python = process.platform === "win32" ? "py" : "python3";
  const args = process.platform === "win32" ? ["-3", "-c"] : ["-c"];
  const script = [
    "import asyncio, sys",
    `sys.path.insert(0, ${JSON.stringify(join(root, "resources", "viniper-ui").replaceAll("\\", "/"))})`,
    "from harness_application_port import await_run_queue_message, HarnessTerminalTimeoutError",
    "async def main():",
    "    queue = asyncio.Queue()",
    "    cancelled = []",
    "    async def cancel(): cancelled.append(True)",
    "    try:",
    "        await await_run_queue_message(queue, 0.02, cancel)",
    "    except HarnessTerminalTimeoutError as error:",
    "        assert error.code == 'terminal-timeout'",
    "    else:",
    "        raise AssertionError('stalled queue unexpectedly completed')",
    "    assert cancelled == [True]",
    "asyncio.run(main())",
  ].join("\n");
  const result = spawnSync(python, [...args, script], {
    cwd: root,
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.signal, null);
});

function toolCall(callId: string, name: string, arguments_: Record<string, unknown>): ProviderToolCallItem {
  return { type: "tool-call", callId, name, arguments: arguments_, argumentsText: JSON.stringify(arguments_) };
}

async function waitFor(predicate: () => boolean, timeoutMs = 12_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error("R20 fixture timed out");
}
