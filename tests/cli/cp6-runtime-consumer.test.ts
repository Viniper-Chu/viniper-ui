import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createHarnessApplication } from "../../src/platform/bootstrap/create-harness-application";
import { createCliApplicationPort } from "../../src/platform/cli/application-port";
import { CliController } from "../../src/platform/cli/controller";
import { UnavailableSecretVault } from "../../src/platform/security/unavailable-secret-vault";
import { RecordingPresenter } from "./fixture";

test("CP6 desktop and CLI expose the same model/network/server-state/retry snapshot", async () => {
  const rootBase = resolve(process.cwd(), "codex", "运行残留");
  await mkdir(rootBase, { recursive: true });
  const dataRoot = await mkdtemp(join(rootBase, "cp6-application-consumer-"));
  const projectRoot = await mkdtemp(join(rootBase, "cp6-application-project-"));
  const fixture = await createHarnessApplication({
    dataRoot,
    workingDirectory: projectRoot,
    assetsRoot: dataRoot,
    secretVault: new UnavailableSecretVault(),
    demoDelayMs: 1,
    defaultProjectAccess: { enabled: true, selectedBy: "cli-explicit" },
  });
  const presenter = new RecordingPresenter();
  const controller = new CliController(createCliApplicationPort(fixture.application), presenter);
  try {
    const initial = fixture.application.snapshot();
    assert.equal(initial.localModels?.cloudDefault, true);
    assert.equal(initial.localModels?.maxConcurrency, 1);
    const deepseek = initial.providerCatalog.profiles.find((item) => item.profile.id === "deepseek")!;
    const gemini = initial.providerCatalog.profiles.find((item) => item.profile.id === "gemini")!;
    assert.equal(deepseek.network.mode, "system");
    assert.equal(deepseek.network.tlsVerification, "required");
    assert.equal(gemini.geminiServerState.enabled, false);

    await controller.initialize();
    assert.equal(await controller.runNonInteractive("CP6 本地 Demo 回归"), 0);
    await controller.executeLine("/runs");
    const runs = [...presenter.events].reverse().find((event) => event.type === "runs")!;
    const run = (runs.data.items as Array<{ providerAttempt?: { attempt: number; maxAttempts: number; status: string } }>)[0];
    assert.deepEqual(run.providerAttempt, { attempt: 1, maxAttempts: 5, status: "succeeded" });
  } finally {
    controller.dispose();
    await fixture.application.dispose();
    await rm(dataRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("CP6 local model metadata uses the application service and survives restart", async () => {
  const rootBase = resolve(process.cwd(), "codex", "运行残留");
  await mkdir(rootBase, { recursive: true });
  const dataRoot = await mkdtemp(join(rootBase, "cp6-local-model-restart-"));
  const projectRoot = await mkdtemp(join(rootBase, "cp6-local-model-project-"));
  const options = {
    dataRoot,
    workingDirectory: projectRoot,
    assetsRoot: dataRoot,
    secretVault: new UnavailableSecretVault(),
    demoDelayMs: 1,
    defaultProjectAccess: { enabled: true as const, selectedBy: "cli-explicit" as const },
  };
  const first = await createHarnessApplication(options);
  try {
    assert.equal(await first.application.registerLocalModel({
      id: "restart-fixture",
      label: "重启 Fixture",
      endpoint: "http://127.0.0.1:47833/v1",
      source: "loopback",
      license: "fixture",
      format: "openai-compatible",
      compatibility: "fixture",
      toolCapability: "experimental_emulation",
      version: "1.0.0",
    }), true);
    assert.equal(await first.application.confirmLocalModel("restart-fixture", "1.0.0"), true);
    assert.equal(first.application.snapshot().providers.some((provider) => provider.id === "local-model:restart-fixture"), true);
    assert.equal(await first.application.setProviderModel(
      first.application.snapshot().activeSessionId,
      "local-model:restart-fixture",
      "restart-fixture",
    ), true);
    await first.application.dispose();
    const second = await createHarnessApplication(options);
    try {
      assert.equal(second.application.snapshot().localModels?.records[0]?.activeVersionId, "1.0.0");
    } finally {
      await second.application.dispose();
    }
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("CP6 confirmed OpenAI-compatible loopback model runs through the formal runtime", async () => {
  const rootBase = resolve(process.cwd(), "codex", "运行残留");
  await mkdir(rootBase, { recursive: true });
  const dataRoot = await mkdtemp(join(rootBase, "cp6-local-model-run-"));
  const projectRoot = await mkdtemp(join(rootBase, "cp6-local-model-run-project-"));
  const fixture = await createHarnessApplication({
    dataRoot,
    workingDirectory: projectRoot,
    assetsRoot: dataRoot,
    secretVault: new UnavailableSecretVault(),
    demoDelayMs: 1,
    providerFetchImpl: (async () => new Response([
      "data: {\"choices\":[{\"delta\":{\"content\":\"本地 loopback 完成\"}}]}",
      "",
      "data: [DONE]",
      "",
    ].join("\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } })) as typeof fetch,
  });
  try {
    assert.equal(await fixture.application.registerLocalModel({
      id: "run-fixture",
      label: "运行 Fixture",
      endpoint: "http://127.0.0.1:47834/v1/chat/completions",
      source: "loopback",
      license: "fixture",
      format: "openai-compatible",
      compatibility: "fixture",
      toolCapability: "none",
      version: "1.0.0",
    }), true);
    assert.equal(await fixture.application.confirmLocalModel("run-fixture", "1.0.0"), true);
    const sessionId = fixture.application.snapshot().activeSessionId;
    assert.equal(await fixture.application.setProviderModel(sessionId, "local-model:run-fixture", "run-fixture"), true);
    const selectedSession = fixture.application.snapshot().sessions.find((item) => item.id === sessionId)!;
    const completion = new Promise<{ status: string }>((resolveCompletion) => {
      fixture.runtime.onRunCompleted((result) => resolveCompletion(result));
    });
    const send = await fixture.application.send({
      sessionId,
      text: "使用本地模型",
      attachments: [],
      selectedModel: "run-fixture",
      permissionMode: selectedSession.permissionMode,
    });
    assert.equal((send as { accepted: boolean }).accepted, true, JSON.stringify(send));
    assert.equal((await completion).status, "completed");
    assert.match(fixture.application.snapshot().sessions[0].messages.at(-1)?.text ?? "", /本地 loopback 完成/u);
  } finally {
    await fixture.application.dispose();
    await rm(dataRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});
