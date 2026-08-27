import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createHarnessApplication } from "../../src/platform/bootstrap/create-harness-application";
import { createCliApplicationPort } from "../../src/platform/cli/application-port";
import { CLI_EXIT_CODE } from "../../src/platform/cli/contracts";
import { CliController } from "../../src/platform/cli/controller";
import { UnavailableSecretVault } from "../../src/platform/security/unavailable-secret-vault";
import { RecordingPresenter } from "./fixture";

test("CLI port drives the shared formal Harness application instead of static output", async () => {
  const outputRoot = resolve(process.cwd(), "codex", "工作输出", "cli-preview");
  await mkdir(outputRoot, { recursive: true });
  const root = await mkdtemp(join(outputRoot, "real-harness-"));
  const projectRoot = await mkdtemp(join(outputRoot, "real-harness-project-"));
  const fixture = await createHarnessApplication({
    dataRoot: root,
    workingDirectory: projectRoot,
    assetsRoot: root,
    secretVault: new UnavailableSecretVault(),
    demoDelayMs: 5,
  });
  const presenter = new RecordingPresenter();
  const port = createCliApplicationPort(fixture.application);
  await port.openProjectSession(projectRoot);
  const controller = new CliController(port, presenter);
  try {
    await controller.initialize();
    const firstSessionId = fixture.application.snapshot().activeSessionId;
    assert.equal(fixture.application.snapshot().sessions.find((item) => item.id === firstSessionId)?.projectAccess?.enabled, true);
    await controller.executeLine("/new 第二会话");
    const secondSessionId = fixture.application.snapshot().activeSessionId;
    assert.notEqual(secondSessionId, firstSessionId);

    await controller.executeLine(`/use ${firstSessionId}`);
    await controller.executeLine(`/send ${secondSessionId} 来自真实协作服务`);
    await controller.executeLine(`/use ${secondSessionId}`);
    await controller.executeLine("/inbox");
    const inbox = [...presenter.events].reverse().find((event) => event.type === "inbox")!;
    assert.deepEqual(
      (inbox.data.items as Array<{ body: string }>).map((item) => item.body),
      ["来自真实协作服务"],
    );

    const exitCode = await controller.runNonInteractive("真实本地 Demo 闭环");
    assert.equal(exitCode, CLI_EXIT_CODE.completed);
    const eventTypes = presenter.events.map((event) => event.type);
    assert.equal(eventTypes.includes("tool.requested"), true);
    assert.equal(eventTypes.includes("tool.completed"), true);
    assert.equal(eventTypes.includes("message.delta"), true);
    assert.equal(eventTypes.includes("run.completed"), true);
    const requested = presenter.events.find((event) => event.type === "tool.requested")!;
    const completed = presenter.events.find((event) => event.type === "tool.completed")!;
    assert.equal(requested.data.status, "running");
    assert.equal(requested.data.detail, "{}");
    assert.match(String(completed.data.result), /^只读 Demo 完成/u);
    const session = fixture.application.snapshot().sessions.find((item) => item.id === secondSessionId)!;
    assert.match(session.messages.at(-1)?.text ?? "", /^\[Demo Provider\] Agent 回复：真实本地 Demo 闭环/u);

    await controller.executeLine("/tokens");
    const tokens = [...presenter.events].reverse().find((event) => event.type === "tokens")!;
    assert.equal((tokens.data.providerFinal as { source: string }).source, "provider");
    assert.equal((tokens.data.providerFinal as { total: number }).total > 0, true);
    assert.equal(fixture.application.snapshot().secrets.encryptionAvailable, false);
  } finally {
    controller.dispose();
    fixture.application.dispose();
    await fixture.runtime.flushPersistence();
    await rm(root, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("P1-01 a fresh CLI data root starts with exactly one cli-explicit project session", async () => {
  const outputRoot = resolve(process.cwd(), "codex", "运行残留");
  await mkdir(outputRoot, { recursive: true });
  const dataRoot = await mkdtemp(join(outputRoot, "cli-first-start-data-"));
  const projectRoot = await mkdtemp(join(outputRoot, "cli-first-start-project-"));
  const options = {
    dataRoot,
    workingDirectory: projectRoot,
    assetsRoot: dataRoot,
    secretVault: new UnavailableSecretVault(),
    demoDelayMs: 1,
    defaultProjectAccess: { enabled: true as const, selectedBy: "cli-explicit" as const },
  };
  const fixture = await createHarnessApplication(options);
  try {
    const port = createCliApplicationPort(fixture.application);
    await port.openProjectSession(projectRoot);
    const snapshot = fixture.application.snapshot();
    assert.equal(snapshot.sessions.length, 1);
    assert.equal(snapshot.activeSessionId, snapshot.sessions[0].id);
    assert.deepEqual(snapshot.sessions[0].projectAccess, { enabled: true, selectedBy: "cli-explicit" });
    assert.equal(snapshot.sessions[0].workingDirectory, projectRoot);
  } finally {
    fixture.application.dispose();
    await rm(dataRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("CP5 DesktopApplication 与 CLI port 共享受管扩展投影", async () => {
  const outputRoot = resolve(process.cwd(), "codex", "运行残留");
  await mkdir(outputRoot, { recursive: true });
  const dataRoot = await mkdtemp(join(outputRoot, "cp5-application-extension-"));
  const packageRoot = join(dataRoot, "local-skill");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "extension.json"), JSON.stringify({
    manifestVersion: 1,
    id: "fixture.skill",
    name: "Fixture Skill",
    version: "1.0.0",
    kind: "skill",
    source: "custom",
    capabilities: ["context:fixture"],
  }), "utf8");
  const projectRoot = await mkdtemp(join(outputRoot, "cp5-application-project-"));
  const fixture = await createHarnessApplication({
    dataRoot,
    workingDirectory: projectRoot,
    assetsRoot: dataRoot,
    secretVault: new UnavailableSecretVault(),
  });
  try {
    const port = createCliApplicationPort(fixture.application);
    const staged = await port.stageExtension!({ source: "custom", location: packageRoot });
    await port.installExtension!(staged.stagingId);
    assert.equal(fixture.application.snapshot().extensions.records?.[0]?.id, "fixture.skill");
    assert.equal((await port.getSnapshot()).extensions.records?.[0]?.source, "custom");
    assert.equal(await port.trustExtension!("fixture.skill", "1.0.0"), true);
    assert.equal(await port.enableExtension!("fixture.skill", true), true);
    const final = await port.getSnapshot();
    assert.equal(final.extensions.records?.[0]?.trust, "trusted");
    assert.equal(final.extensions.records?.[0]?.enabled, true);
  } finally {
    await fixture.application.dispose();
    await rm(dataRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});
