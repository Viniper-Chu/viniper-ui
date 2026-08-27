import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { createHarnessApplication } from "../../src/platform/bootstrap/create-harness-application";
import { createCliApplicationPort } from "../../src/platform/cli/application-port";
import { UnavailableSecretVault } from "../../src/platform/security/unavailable-secret-vault";

test("CP5：DesktopApplication 与 CLI 通过同一 application port 持久化能力方案与具体 customName", async () => {
  const root = await mkdtemp(join(process.cwd(), "codex", "运行残留", "cp5-application-"));
  const dataRoot = join(root, "data");
  const options = {
    dataRoot,
    workingDirectory: root,
    assetsRoot: join(process.cwd(), "assets"),
    secretVault: new UnavailableSecretVault(),
    demoDelayMs: 1,
    approvalHostMode: "fail-closed" as const,
  };
  const first = await createHarnessApplication(options);
  try {
    const port = createCliApplicationPort(first.application);
    const copied = await port.copyCompositionPreset!("deepseek-efficient", "CP5 代码方案");
    assert.equal(copied.current.preset, "custom");
    assert.equal(copied.current.customName, "CP5 代码方案");
    assert.equal((await port.getSnapshot()).composition?.customName, "CP5 代码方案");
    assert.equal((await port.getCompositionCenter!()).customSelected, "CP5 代码方案");
  } finally {
    await first.application.dispose();
  }

  const second = await createHarnessApplication(options);
  try {
    const restored = await createCliApplicationPort(second.application).getCompositionCenter!();
    assert.equal(restored.current.customName, "CP5 代码方案");
    assert.equal(restored.customSelected, "CP5 代码方案");
  } finally {
    await second.application.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
