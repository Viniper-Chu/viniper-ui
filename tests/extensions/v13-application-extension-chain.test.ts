import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { ProviderEvent, ProviderRequest } from "../../src/core/provider-contracts";
import { ModelProvider } from "../../src/features/providers/model-provider";
import { createHarnessApplication } from "../../src/platform/bootstrap/create-harness-application";
import { createCliApplicationPort } from "../../src/platform/cli/application-port";
import { UnavailableSecretVault } from "../../src/platform/security/unavailable-secret-vault";
import { waitFor } from "../runs/runtime-fixture";

test("RA-04 Skill 经 application port 进入目录、会话快照与稳定前缀，并可按端口禁用", async () => {
  const residue = resolve(process.cwd(), "codex", "运行残留");
  await mkdir(residue, { recursive: true });
  const dataRoot = await mkdtemp(join(residue, "v13-skill-application-"));
  const projectRoot = await mkdtemp(join(residue, "v13-skill-project-"));
  const packageRoot = join(dataRoot, "skill-package");
  const marker = "V13_SKILL_MARKER_HARBOR";
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "extension.json"), JSON.stringify({
    manifestVersion: 1,
    id: "fixture.skill",
    name: "Fixture Marker Skill",
    version: "1.0.0",
    kind: "skill",
    source: "local",
    capabilities: ["context:fixture"],
  }), "utf8");
  await writeFile(join(packageRoot, "SKILL.md"), [
    "---",
    "id: fixture.skill",
    "name: Fixture Marker Skill",
    "description: 为本地验收提供唯一可检索标记",
    "---",
    `唯一验收标记：${marker}`,
  ].join("\n"), "utf8");

  const bundle = await createHarnessApplication({
    dataRoot,
    workingDirectory: projectRoot,
    assetsRoot: dataRoot,
    secretVault: new UnavailableSecretVault(),
    demoDelayMs: 1,
  });
  const port = createCliApplicationPort(bundle.application);
  try {
    const sessionId = bundle.application.snapshot().activeSessionId;
    const staged = await port.stageExtension!({ source: "local", location: packageRoot });
    await port.installExtension!(staged.stagingId);
    assert.equal(bundle.application.snapshot().extensions.skills.some((skill) => skill.id === "fixture.skill"), false);

    assert.equal(await port.trustExtension!("fixture.skill", "1.0.0"), true);
    assert.equal(await port.enableExtension!("fixture.skill", true), true);
    const installed = bundle.application.snapshot().extensions.skills.find((skill) => skill.id === "fixture.skill");
    assert.ok(installed, "已信任且启用的 Skill 必须进入 SkillCatalog 视图");
    assert.deepEqual(installed.enabledSessionIds, []);
    assert.equal(await port.setSkillEnabled!(sessionId, "fixture.skill", true), true);
    assert.deepEqual(
      bundle.application.snapshot().extensions.skills.find((skill) => skill.id === "fixture.skill")?.enabledSessionIds,
      [sessionId],
    );

    const session = bundle.application.snapshot().sessions.find((item) => item.id === sessionId)!;
    await bundle.application.send({
      sessionId,
      text: "请回答已安装 Skill 的技能标记",
      attachments: [],
      selectedModel: session.selectedModel,
      permissionMode: session.permissionMode,
    });
    await waitFor(() => !bundle.runtime.isRunning(sessionId), 5_000);
    const afterRun = bundle.application.snapshot().sessions.find((item) => item.id === sessionId)!;
    assert.match(afterRun.messages.at(-1)?.text ?? "", new RegExp(marker, "u"));
    assert.match(
      afterRun.cachePlan.stableSegments.find((segment) => segment.name === "skills")?.text ?? "",
      new RegExp(marker, "u"),
    );
    assert.equal(bundle.application.snapshot().extensions.skills.find((skill) => skill.id === "fixture.skill")?.loaded, true);

    assert.equal(await port.setSkillEnabled!(sessionId, "fixture.skill", false), true);
    assert.deepEqual(
      bundle.application.snapshot().extensions.skills.find((skill) => skill.id === "fixture.skill")?.enabledSessionIds,
      [],
    );
    assert.equal(await port.enableExtension!("fixture.skill", false), true);
    assert.equal(bundle.application.snapshot().extensions.skills.some((skill) => skill.id === "fixture.skill"), false);
  } finally {
    await bundle.application.dispose();
    await rm(dataRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

class PluginChainProvider implements ModelProvider {
  readonly descriptor = {
    id: "fixture.plugin-provider",
    name: "Fixture Plugin Provider",
    label: "Fixture Plugin Provider · 本地 fake",
    configuration: "demo" as const,
    available: true,
    realCallsEnabled: false,
    capabilities: ["tools"],
    models: [{ id: "fixture-plugin-model", label: "Fixture Plugin Model" }],
  };
  readonly requests: ProviderRequest[] = [];

  async *stream(request: ProviderRequest, _signal: AbortSignal): AsyncIterable<ProviderEvent> {
    this.requests.push(structuredClone(request));
    const result = request.history
      .flatMap((entry) => entry.items)
      .find((item) => item.type === "tool-result" && item.name === "fixture.echo");
    if (!result && request.tools.some((tool) => tool.name === "fixture.echo")) {
      yield {
        kind: "tool-call.completed",
        call: {
          type: "tool-call",
          callId: "plugin-call-1",
          name: "fixture.echo",
          arguments: { text: "PLUGIN_CHAIN_RESULT" },
          argumentsText: JSON.stringify({ text: "PLUGIN_CHAIN_RESULT" }),
        },
      };
      return;
    }
    const resultContent = result?.type === "tool-result" ? result.content : undefined;
    yield { kind: "text.delta", text: resultContent ? `插件续轮已收到：${resultContent}` : "新 run 未广告插件工具。" };
  }
}

test("RA-05 受管插件经正式 Runtime/ToolLoop 完成 schema、一次批准、进程与 Provider 续轮", async () => {
  const residue = resolve(process.cwd(), "codex", "运行残留");
  await mkdir(residue, { recursive: true });
  const dataRoot = await mkdtemp(join(residue, "v13-plugin-application-"));
  const projectRoot = await mkdtemp(join(residue, "v13-plugin-project-"));
  const packageRoot = join(dataRoot, "plugin-package");
  const invocationText = "PLUGIN_CHAIN_RESULT";
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "extension.json"), JSON.stringify({
    manifestVersion: 1,
    id: "fixture.echo",
    name: "Fixture Echo Plugin",
    version: "1.0.0",
    kind: "executable-plugin",
    source: "local",
    capabilities: ["tools:fixture.echo"],
    tools: ["fixture.echo"],
    entry: "index.cjs",
  }), "utf8");
  await writeFile(join(packageRoot, "index.cjs"), [
    "let input = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', chunk => input += chunk);",
    "process.stdin.on('end', () => {",
    "  const request = JSON.parse(input);",
    `  process.stdout.write(JSON.stringify({ ok: true, text: ${JSON.stringify(invocationText)}, payload: request.payload }) + '\\n');`,
    "});",
  ].join("\n"), "utf8");

  const bundle = await createHarnessApplication({
    dataRoot,
    workingDirectory: projectRoot,
    assetsRoot: dataRoot,
    secretVault: new UnavailableSecretVault(),
    defaultProjectAccess: { enabled: true, selectedBy: "desktop-picker" },
    demoDelayMs: 1,
  });
  const provider = new PluginChainProvider();
  bundle.runtime.providerRegistry().register(provider);
  try {
    const app = bundle.application;
    const session = app.snapshot().sessions[0];
    const staged = await app.stageExtension({ source: "local", location: packageRoot });
    await app.installExtension(staged.stagingId);
    await app.trustExtension("fixture.echo", "1.0.0");
    await app.enableExtension("fixture.echo", true);
    assert.equal(await app.setProviderModel(session.id, provider.descriptor.id, "fixture-plugin-model"), true);
    assert.equal(await app.setPermissionAccess(session.id, "computer-run"), true, "先申请本 run 的 computer access");

    const selected = app.snapshot().sessions.find((item) => item.id === session.id)!;
    await app.send({
      sessionId: selected.id,
      text: "请调用 fixture.echo 完成插件闭环",
      attachments: [],
      selectedModel: selected.selectedModel,
      permissionMode: selected.permissionMode,
    });
    await waitFor(() => !bundle.runtime.isRunning(selected.id), 8_000);
    assert.equal(provider.requests.length, 2, "fake Provider 应完成工具首轮与续轮");
    assert.equal(provider.requests[0].tools.some((tool) => tool.name === "fixture.echo"), true);
    assert.equal(provider.requests[1].history.flatMap((entry) => entry.items).some((item) => item.type === "tool-result" && item.name === "fixture.echo"), true);
    const completed = app.snapshot().sessions.find((item) => item.id === selected.id)!.events.filter((event) => event.type === "tool.completed");
    assert.equal(completed.length, 1, "受管进程只能执行一次");
    assert.match(app.snapshot().sessions.find((item) => item.id === selected.id)!.messages.at(-1)?.text ?? "", /PLUGIN_CHAIN_RESULT/u);

    await app.enableExtension("fixture.echo", false);
    const beforeSecond = provider.requests.length;
    const nextSession = app.snapshot().sessions.find((item) => item.id === selected.id)!;
    await app.send({
      sessionId: nextSession.id,
      text: "请调用 fixture.echo；若未开放请如实说明",
      attachments: [],
      selectedModel: nextSession.selectedModel,
      permissionMode: nextSession.permissionMode,
    });
    await waitFor(() => !bundle.runtime.isRunning(nextSession.id), 8_000);
    assert.equal(provider.requests.length, beforeSecond + 1);
    assert.equal(provider.requests.at(-1)!.tools.some((tool) => tool.name === "fixture.echo"), false, "禁用后新 run 不得广告工具");
    assert.equal(app.snapshot().sessions.find((item) => item.id === selected.id)!.events.filter((event) => event.type === "tool.completed").length, 1);
  } finally {
    await appDispose(bundle);
    await rm(dataRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

async function appDispose(bundle: Awaited<ReturnType<typeof createHarnessApplication>>): Promise<void> {
  await bundle.application.dispose();
}
