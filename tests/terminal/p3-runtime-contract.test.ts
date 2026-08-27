import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { ProviderEvent, ProviderRequest } from "../../src/core/provider-contracts";
import { ModelProvider } from "../../src/features/providers/model-provider";
import { createHarnessApplication } from "../../src/platform/bootstrap/create-harness-application";
import { UnavailableSecretVault } from "../../src/platform/security/unavailable-secret-vault";

class P3TerminalProvider implements ModelProvider {
  readonly descriptor = {
    id: "p3-terminal-fake",
    name: "P3 Terminal Fake",
    label: "P3 Terminal Fake · 本地",
    configuration: "demo" as const,
    available: true,
    realCallsEnabled: false,
    capabilities: ["tools"],
    models: [{ id: "p3-terminal-model", label: "P3 Terminal Model" }],
  };
  readonly requests: ProviderRequest[] = [];
  readonly commands = new Map<string, string>();
  duplicateFirstCall = false;
  continueOutput = false;

  async *stream(request: ProviderRequest): AsyncIterable<ProviderEvent> {
    this.requests.push(structuredClone(request));
    const results = request.history
      .flatMap((entry) => entry.items)
      .filter((item) => item.type === "tool-result");
    const runResult = results.find((item) => item.name === "terminal.run");
    const outputResult = results.find((item) => item.name === "terminal.output");
    if (!runResult) {
      const call = toolCall(`terminal-run-${request.sessionId}`, "terminal.run", {
        command: this.commands.get(request.sessionId) ?? "[Console]::Out.Write('P3_DEFAULT')",
        purpose: "test",
        timeoutMs: 8_000,
      });
      yield { kind: "tool-call.completed", call };
      if (this.duplicateFirstCall) yield { kind: "tool-call.completed", call: structuredClone(call) };
      return;
    }
    if (this.continueOutput && !outputResult && !runResult.isError) {
      const parsed = JSON.parse(runResult.content) as { executionId: string };
      yield {
        kind: "tool-call.completed",
        call: toolCall(`terminal-output-${request.sessionId}`, "terminal.output", {
          executionId: parsed.executionId,
          stream: "stdout",
          offset: 0,
          maxBytes: 4096,
        }),
      };
      return;
    }
    yield { kind: "text.delta", text: "P3 本地终端工具闭环完成。" };
  }
}

test("P3 formal Runtime advertises terminal for generic and project sessions and preserves callId/output continuation", async () => {
  const scene = await runtimeFixture();
  try {
    const provider = new P3TerminalProvider();
    provider.duplicateFirstCall = true;
    provider.continueOutput = true;
    scene.bundle.runtime.providerRegistry().register(provider);
    const ordinarySessionId = scene.bundle.runtime.snapshot().activeSessionId;
    const session = await scene.bundle.application.createProjectSession(scene.projectRoot);
    provider.commands.set(session.id, "[Console]::Out.Write('P3_RUNTIME_OUTPUT')");
    await scene.bundle.application.setProviderModel(session.id, provider.descriptor.id, "p3-terminal-model");
    await scene.bundle.application.setPermissionMode(session.id, "full");
    await scene.bundle.application.send({
      sessionId: session.id,
      text: "运行 P3 本地终端并续读输出",
      attachments: [],
      selectedModel: "p3-terminal-model",
      permissionMode: "full",
    });
    await waitFor(() => !scene.bundle.runtime.isRunning(session.id));

    assert.equal(provider.requests.length, 3);
    assert.deepEqual(
      provider.requests[0].tools.filter((tool) => tool.name.startsWith("terminal.")).map((tool) => [tool.name, tool.readOnly]),
      [["terminal.output", true], ["terminal.run", false]],
    );
    const historyText = JSON.stringify(provider.requests.flatMap((request) => request.history));
    assert.match(historyText, /P3_RUNTIME_OUTPUT/u);
    assert.doesNotMatch(historyText, new RegExp(escapeRegExp(scene.dataRoot), "iu"));
    assert.doesNotMatch(historyText, /stdout\.log|stderr\.log/u);

    const completed = scene.bundle.runtime.getSession(session.id)!;
    const runActivities = completed.activities.filter((activity) => activity.toolName === "terminal.run");
    assert.equal(runActivities.length, 1, "duplicate callId starts exactly one process");
    assert.equal(runActivities[0].presentation?.kind, "terminal-run");
    if (runActivities[0].presentation?.kind === "terminal-run") {
      assert.equal(runActivities[0].presentation.status, "completed");
      assert.equal(runActivities[0].presentation.exitCode, 0);
      assert.match(runActivities[0].presentation.stdout?.preview ?? "", /P3_RUNTIME_OUTPUT/u);
    }
    assert.equal(completed.activities.some((activity) => activity.toolName === "terminal.output"), true);

    const ordinary = scene.bundle.runtime.getSession(ordinarySessionId)!;
    await scene.bundle.application.setProviderModel(ordinary.id, provider.descriptor.id, "p3-terminal-model");
    await scene.bundle.application.setPermissionMode(ordinary.id, "full");
    await scene.bundle.application.send({
      sessionId: ordinary.id,
      text: "普通会话不应看到终端工具",
      attachments: [],
      selectedModel: "p3-terminal-model",
      permissionMode: "full",
    });
    await waitFor(() => !scene.bundle.runtime.isRunning(ordinary.id));
    const ordinaryRequest = provider.requests.find((request) => request.sessionId === ordinary.id)!;
    assert.equal(ordinaryRequest.tools.some((tool) => tool.name.startsWith("terminal.")), true);
  } finally {
    await scene.dispose();
  }
});

test("P3 permission freeze covers manual review, auto review and full access without pre-approval execution", async (context) => {
  const cases = [
    { name: "manual rejects", mode: "ask" as const, pending: true, decision: "reject" as const, status: "failed" },
    { name: "auto reviews", mode: "auto" as const, pending: true, decision: "allow-once" as const, status: "completed" },
    { name: "full access", mode: "full" as const, pending: false, status: "completed" },
  ];

  for (const item of cases) {
    await context.test(item.name, async () => {
      const scene = await runtimeFixture();
      try {
        const provider = new P3TerminalProvider();
        scene.bundle.runtime.providerRegistry().register(provider);
        const session = await scene.bundle.application.createProjectSession(scene.projectRoot);
        provider.commands.set(session.id, `[Console]::Out.Write('${item.name.replace(/[^a-z]/giu, "_")}')`);
        await scene.bundle.application.setProviderModel(session.id, provider.descriptor.id, "p3-terminal-model");
        await scene.bundle.application.setPermissionMode(session.id, item.mode);
        await scene.bundle.application.send({
          sessionId: session.id,
          text: `P3 权限 ${item.name}`,
          attachments: [],
          selectedModel: "p3-terminal-model",
          permissionMode: item.mode,
        });

        const callId = `terminal-run-${session.id}`;
        if (item.pending) {
          await waitFor(() => scene.bundle.runtime.pendingToolApprovals().some((approval) => approval.callId === callId));
          await assert.rejects(stat(join(scene.dataRoot, "terminal-output")), { code: "ENOENT" });
          const pendingApproval = scene.bundle.runtime.pendingToolApprovals().find((approval) => approval.callId === callId)!;
          assert.equal(await scene.bundle.application.resolveToolApproval(session.id, pendingApproval.runId, callId, item.decision!), true);
        }
        await waitFor(() => !scene.bundle.runtime.isRunning(session.id));
        const terminal = scene.bundle.runtime.getSession(session.id)!.activities.find((activity) => activity.toolName === "terminal.run")!;
        assert.equal(terminal.status, item.status);
        if (item.status === "completed") assert.equal(terminal.presentation?.kind, "terminal-run");
      } finally {
        await scene.dispose();
      }
    });
  }
});

test("P3 runtime cancellation terminates only the owning session process tree", async () => {
  const scene = await runtimeFixture();
  const secondProject = await mkdtemp(join(scene.residueRoot, "phase7-p3-runtime-project-b-"));
  try {
    const childFixture = [
      "const { spawn } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      "const child = spawn(process.execPath, ['-e', \"const fs=require('node:fs');const p=process.argv[1];setInterval(()=>fs.appendFileSync(p,'x'),25)\", process.argv[2]], { stdio: 'ignore' });",
      "writeFileSync(process.argv[3], String(child.pid));",
      "setInterval(() => {}, 1000);",
    ].join("\n");
    await writeFile(join(scene.projectRoot, "spawn-child.cjs"), childFixture, "utf8");
    const provider = new P3TerminalProvider();
    scene.bundle.runtime.providerRegistry().register(provider);
    const cancelledSession = await scene.bundle.application.createProjectSession(scene.projectRoot);
    const survivingSession = await scene.bundle.application.createProjectSession(secondProject);
    provider.commands.set(cancelledSession.id, "node spawn-child.cjs heartbeat.txt child.pid");
    provider.commands.set(survivingSession.id, "Start-Sleep -Milliseconds 550; [Console]::Out.Write('SURVIVED')");
    for (const session of [cancelledSession, survivingSession]) {
      await scene.bundle.application.setProviderModel(session.id, provider.descriptor.id, "p3-terminal-model");
      await scene.bundle.application.setPermissionMode(session.id, "full");
      await scene.bundle.application.send({
        sessionId: session.id,
        text: `P3 进程隔离 ${session.id}`,
        attachments: [],
        selectedModel: "p3-terminal-model",
        permissionMode: "full",
      });
    }
    await waitForFile(join(scene.projectRoot, "child.pid"));
    assert.equal(await scene.bundle.application.cancel(cancelledSession.id), true);
    await waitFor(() => !scene.bundle.runtime.isRunning(cancelledSession.id) && !scene.bundle.runtime.isRunning(survivingSession.id), 8_000);

    const cancelled = scene.bundle.runtime.getSession(cancelledSession.id)!;
    const survived = scene.bundle.runtime.getSession(survivingSession.id)!;
    assert.equal(cancelled.events.some((event) => event.type === "run.cancelled"), true);
    const cancelledTool = cancelled.activities.find((activity) => activity.toolName === "terminal.run")!;
    assert.equal(cancelledTool.status, "cancelled", JSON.stringify(cancelledTool));
    assert.equal(cancelledTool.presentation?.kind, "terminal-run");
    if (cancelledTool.presentation?.kind === "terminal-run") assert.equal(cancelledTool.presentation.status, "cancelled");
    assert.equal(survived.events.some((event) => event.type === "run.completed"), true);
    const survivingTool = survived.activities.find((activity) => activity.toolName === "terminal.run")!;
    assert.equal(survivingTool.status, "completed");
    assert.match(survivingTool.presentation?.kind === "terminal-run" ? survivingTool.presentation.stdout?.preview ?? "" : "", /SURVIVED/u);

    await new Promise((resolveWait) => setTimeout(resolveWait, 120));
    const firstSize = (await stat(join(scene.projectRoot, "heartbeat.txt"))).size;
    await new Promise((resolveWait) => setTimeout(resolveWait, 260));
    assert.equal((await stat(join(scene.projectRoot, "heartbeat.txt"))).size, firstSize);
    assert.match(await readFile(join(scene.projectRoot, "child.pid"), "utf8"), /^\d+$/u);
  } finally {
    await rm(secondProject, { recursive: true, force: true });
    await scene.dispose();
  }
});

async function runtimeFixture() {
  const residueRoot = resolve(process.cwd(), "codex", "运行残留");
  await mkdir(residueRoot, { recursive: true });
  const dataRoot = await mkdtemp(join(residueRoot, "phase7-p3-runtime-data-"));
  const projectRoot = await mkdtemp(join(residueRoot, "phase7-p3-runtime-project-"));
  const bundle = await createHarnessApplication({
    dataRoot,
    workingDirectory: projectRoot,
    assetsRoot: dataRoot,
    secretVault: new UnavailableSecretVault(),
    demoDelayMs: 1,
  });
  return {
    residueRoot,
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

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for P3 runtime state");
    await new Promise((resolveWait) => setTimeout(resolveWait, 15));
  }
}

async function waitForFile(path: string, timeoutMs = 4_000): Promise<void> {
  const started = Date.now();
  while (true) {
    try {
      await stat(path);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${path}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
