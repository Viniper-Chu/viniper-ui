import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { createHarnessApplication } from "../../src/platform/bootstrap/create-harness-application";
import { UnavailableSecretVault } from "../../src/platform/security/unavailable-secret-vault";

test("Viniper is the only advertised engine; archived engine-owned records remain distinct", async () => {
  const residueRoot = join(process.cwd(), "codex", "运行残留");
  await mkdir(residueRoot, { recursive: true });
  const root = await mkdtemp(join(residueRoot, "agent-engine-contract-"));
  const projectRoot = join(root, "project");
  await mkdir(projectRoot, { recursive: true });
  const bundle = await createHarnessApplication({
    dataRoot: join(root, "data"),
    workingDirectory: projectRoot,
    assetsRoot: join(process.cwd(), "assets"),
    secretVault: new UnavailableSecretVault(),
    demoDelayMs: 1,
    claudeCode: {
      enabled: true,
      probe: {
        available: false,
        transport: "not-detected",
        message: "fixture unavailable",
      },
    },
  });

  try {
    const viniper = await bundle.application.createSession("viniper");
    const claude = await bundle.application.createSession("claude-code");
    assert.equal(viniper.engineId, "viniper");
    assert.equal(viniper.selectedProviderId, "demo");
    assert.equal(claude.engineId, "claude-code");
    assert.equal(claude.selectedProviderId, "claude-code");
    assert.equal(claude.selectedModel, "claude-code-default");

    assert.equal(await bundle.application.renameSession(claude.id, "Claude 独立状态"), true);
    const snapshot = bundle.application.snapshot();
    assert.equal(snapshot.sessions.find((session) => session.id === claude.id)?.title, "Claude 独立状态");
    assert.notEqual(snapshot.sessions.find((session) => session.id === viniper.id)?.title, "Claude 独立状态");
    assert.deepEqual(snapshot.agentEngines?.map((engine) => engine.id), ["viniper"]);
    assert.equal(snapshot.agentEngines?.find((engine) => engine.id === "viniper")?.status, "ready");
    assert.equal(snapshot.agentEngines?.find((engine) => engine.id === "claude-code"), undefined);
  } finally {
    await bundle.application.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("native Harness permission control maps stable native sessions before resolving", async () => {
  const bridgePath = resolve(
    process.cwd(),
    "resources",
    "viniper-ui",
    "harness_runtime_bridge.js",
  );
  const bridge = await readFile(bridgePath, "utf8");
  assert.match(bridge, /const mapped = mappedHarnessSession\(sessionId\)/u);
  assert.match(bridge, /resolveToolApproval\(harnessSessionId, runId, callId, decision\)/u);
  assert.match(bridge, /permission resolve requires session_id, run_id and call_id/u);
  assert.match(bridge, /VINIPER_HARNESS_REVIEW_PROVIDER_LIMIT/u);
  assert.match(bridge, /providerRequestLimits:\s*\{ review: reviewProviderLimit \}/u);
  const nativePort = await readFile(resolve(
    process.cwd(),
    "resources",
    "viniper-ui",
    "harness_application_port.py",
  ), "utf8");
  assert.match(nativePort, /Plan-mode policy rejections are terminal policy outcomes/u);
  assert.match(nativePort, /status in \{"failed", "rejected"\}/u);
  assert.match(nativePort, /"VINIPER_HARNESS_REVIEW_PROVIDER_LIMIT"/u);
});
