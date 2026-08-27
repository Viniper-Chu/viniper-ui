import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { ProviderEvent, ProviderRequest } from "../../src/core/provider-contracts";
import { ModelProvider } from "../../src/features/providers/model-provider";
import { createHarnessApplication } from "../../src/platform/bootstrap/create-harness-application";
import { UnavailableSecretVault } from "../../src/platform/security/unavailable-secret-vault";

class ReviewProjectProvider implements ModelProvider {
  readonly descriptor = {
    id: "viniper-review-runtime",
    name: "Viniper Review Runtime",
    label: "Viniper Review Runtime · 本地",
    configuration: "demo" as const,
    available: true,
    realCallsEnabled: false,
    capabilities: ["tools"],
    models: [{ id: "viniper-review-model", label: "Viniper Review Model" }],
  };
  readonly requests: ProviderRequest[] = [];

  constructor(private readonly blockedComputerPath: string) {}

  async *stream(request: ProviderRequest): AsyncIterable<ProviderEvent> {
    this.requests.push(structuredClone(request));
    const hasToolResult = request.history.some((entry) => entry.items.some((item) => item.type === "tool-result"));
    if (!hasToolResult) {
      yield {
        kind: "tool-call.completed",
        call: {
          type: "tool-call",
          callId: "review-project-write",
          name: "project.write",
          arguments: { path: "review-created.txt", content: "VINIPER_REVIEW_OK\n", mode: "create" },
          argumentsText: JSON.stringify({ path: "review-created.txt", content: "VINIPER_REVIEW_OK\n", mode: "create" }),
        },
      };
      yield {
        kind: "tool-call.completed",
        call: {
          type: "tool-call",
          callId: "review-safe-terminal",
          name: "terminal.run",
          arguments: { command: "Write-Output 'VINIPER_REVIEW_SAFE_TERMINAL_OK'", purpose: "test", timeoutMs: 8_000 },
          argumentsText: JSON.stringify({ command: "Write-Output 'VINIPER_REVIEW_SAFE_TERMINAL_OK'", purpose: "test", timeoutMs: 8_000 }),
        },
      };
      yield {
        kind: "tool-call.completed",
        call: {
          type: "tool-call",
          callId: "review-risky-terminal",
          name: "terminal.run",
          arguments: {
            command: `Set-Content -LiteralPath '${this.blockedComputerPath.replace(/'/gu, "''")}' -Value 'MUST_NOT_EXIST'`,
            purpose: "command",
            timeoutMs: 8_000,
          },
          argumentsText: JSON.stringify({ path: this.blockedComputerPath, purpose: "command" }),
        },
      };
      yield {
        kind: "tool-call.completed",
        call: {
          type: "tool-call",
          callId: "review-computer-write",
          name: "file.write",
          arguments: { path: this.blockedComputerPath, content: "MUST_NOT_EXIST\n", mode: "create" },
          argumentsText: JSON.stringify({ path: this.blockedComputerPath, content: "MUST_NOT_EXIST\n", mode: "create" }),
        },
      };
      return;
    }
    yield { kind: "text.delta", text: "规划自动审核闭环完成。" };
  }
}

test("native Viniper can bind an existing session to a project and grant review actions for one run", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "viniper-review-data-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "viniper-review-project-"));
  const bundle = await createHarnessApplication({
    dataRoot,
    assetsRoot: dataRoot,
    workingDirectory: dataRoot,
    secretVault: new UnavailableSecretVault(),
    demoDelayMs: 1,
  });
  try {
    const blockedComputerPath = join(dataRoot, "review-computer-write.txt");
    const provider = new ReviewProjectProvider(blockedComputerPath);
    bundle.runtime.providerRegistry().register(provider);
    const existing = bundle.runtime.getSession(bundle.runtime.snapshot().activeSessionId)!;
    const rebound = await bundle.runtime.enableProjectAccess(existing.id, projectRoot, "cli-explicit");
    assert.equal(rebound.id, existing.id, "binding the native workdir must preserve the Harness session owner");
    assert.equal(rebound.projectAccess?.enabled, true);
    assert.equal(await bundle.runtime.setProviderModel(existing.id, provider.descriptor.id, "viniper-review-model"), true);
    assert.equal(await bundle.runtime.setPermissionMode(existing.id, "review"), true);
    assert.equal(await bundle.runtime.setPermissionAccess(existing.id, "project-run"), true);

    await bundle.runtime.send({
      sessionId: existing.id,
      text: "按本轮计划创建 review-created.txt",
      attachments: [],
      selectedModel: "viniper-review-model",
      permissionMode: "review",
      origin: { kind: "user" },
    });
    await waitFor(() => !bundle.runtime.isRunning(existing.id));

    assert.equal(await readFile(join(projectRoot, "review-created.txt"), "utf8"), "VINIPER_REVIEW_OK\n");
    await assert.rejects(readFile(blockedComputerPath, "utf8"), { code: "ENOENT" });
    assert.equal(bundle.runtime.pendingToolApprovals().length, 0, "review project action must not create a manual card");
    const requested = bundle.runtime.getSession(existing.id)!.events.find((event) =>
      event.type === "tool.requested" && (event.payload as { callId?: string }).callId === "review-project-write");
    assert.match(String((requested?.payload as { detail?: string } | undefined)?.detail || ""), /review-project-approved/u);
    const safeTerminal = bundle.runtime.getSession(existing.id)!.activities.find((activity) => activity.callId === "review-safe-terminal");
    assert.equal(safeTerminal?.presentation?.kind, "terminal-run");
    if (safeTerminal?.presentation?.kind === "terminal-run") {
      assert.equal(safeTerminal.presentation.status, "completed");
      assert.match(safeTerminal.presentation.stdout?.preview ?? "", /VINIPER_REVIEW_SAFE_TERMINAL_OK/u);
    }
    const riskyTerminal = bundle.runtime.getSession(existing.id)!.activities.find((activity) => activity.callId === "review-risky-terminal" && activity.kind === "tool");
    assert.equal(riskyTerminal?.status, "failed");
    assert.equal(riskyTerminal?.presentation, undefined, "review rejection must occur before a terminal process owns a result");
    const riskyRequested = bundle.runtime.getSession(existing.id)!.events.find((event) =>
      event.type === "tool.requested" && (event.payload as { callId?: string }).callId === "review-risky-terminal");
    assert.match(String((riskyRequested?.payload as { detail?: string } | undefined)?.detail || ""), /review-risk-rejected/u);
    const riskyFailed = bundle.runtime.getSession(existing.id)!.events.find((event) =>
      event.type === "tool.failed" && (event.payload as { callId?: string }).callId === "review-risky-terminal");
    assert.equal((riskyFailed?.payload as { reason?: string } | undefined)?.reason, "review-risk-rejected");
    assert.equal((riskyFailed?.payload as { toolName?: string } | undefined)?.toolName, "terminal.run");
    assert.match(String((riskyFailed?.payload as { detail?: string } | undefined)?.detail || ""), /review-risk-rejected/u);
    const blocked = bundle.runtime.getSession(existing.id)!.events.find((event) =>
      event.type === "tool.requested" && (event.payload as { callId?: string }).callId === "review-computer-write");
    assert.match(String((blocked?.payload as { detail?: string } | undefined)?.detail || ""), /review-risk-rejected/u);
    assert.equal(bundle.runtime.getSession(existing.id)!.events.some((event) =>
      event.type === "interaction.requested"
      && (event.payload as { callId?: string; status?: string }).callId === "review-computer-write"
      && (event.payload as { status?: string }).status === "failed"), true);
  } finally {
    await bundle.application.dispose();
    await rm(dataRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

async function waitFor(predicate: () => boolean, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for Viniper review run");
}
