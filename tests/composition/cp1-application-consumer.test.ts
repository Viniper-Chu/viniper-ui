import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createHarnessApplication } from "../../src/platform/bootstrap/create-harness-application";
import {
  CliInjectableApplicationService,
  createCliApplicationPort,
} from "../../src/platform/cli/application-port";
import { UnavailableSecretVault } from "../../src/platform/security/unavailable-secret-vault";

test("CP1：桌面与 CLI application port 读取同一 Runtime 能力组合计划", async () => {
  const outputRoot = join(process.cwd(), "codex", "运行残留");
  await mkdir(outputRoot, { recursive: true });
  const root = await mkdtemp(join(outputRoot, "cp1-application-"));
  const dataRoot = join(root, "data");
  const projectRoot = join(root, "project");
  await mkdir(projectRoot, { recursive: true });
  const bundle = await createHarnessApplication({
    dataRoot,
    workingDirectory: projectRoot,
    assetsRoot: join(process.cwd(), "assets"),
    secretVault: new UnavailableSecretVault(),
    demoDelayMs: 1,
  });
  try {
    const desktopSnapshot = bundle.application.snapshot();
    const cli = createCliApplicationPort(bundle.application as unknown as CliInjectableApplicationService);
    const cliSnapshot = await cli.getSnapshot();
    assert.ok(desktopSnapshot.composition);
    assert.deepEqual(cliSnapshot.composition, desktopSnapshot.composition);
    assert.equal(desktopSnapshot.composition?.preset, "standard");
  } finally {
    await bundle.application.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
