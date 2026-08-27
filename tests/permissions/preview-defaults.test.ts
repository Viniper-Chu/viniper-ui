import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createHarnessApplication } from "../../src/platform/bootstrap/create-harness-application";
import { UnavailableSecretVault } from "../../src/platform/security/unavailable-secret-vault";

test("desktop Preview alone migrates existing sessions to full access and enables built-in Skills", async () => {
  const residue = resolve(process.cwd(), "codex", "运行残留");
  await mkdir(residue, { recursive: true });
  const dataRoot = await mkdtemp(join(residue, "preview-v016-defaults-"));
  const assetsRoot = join(dataRoot, "assets");
  await cp(resolve(process.cwd(), "skills"), join(assetsRoot, "skills"), { recursive: true });
  const projectRoot = process.cwd();
  const bundle = await createHarnessApplication({
    dataRoot,
    workingDirectory: process.cwd(),
    assetsRoot,
    secretVault: new UnavailableSecretVault(),
    previewFullAccessDefaults: true,
  });
  try {
    const session = bundle.application.snapshot().sessions[0];
    assert.equal(session.permissionMode, "full");
    const builtIns = bundle.application.snapshot().extensions.skills.filter((skill) => skill.source === "built-in");
    assert.equal(builtIns.length > 0, true);
    assert.equal(builtIns.every((skill) => skill.enabledSessionIds.includes(session.id)), true);

    const openedProject = await bundle.application.openProjectSession(projectRoot);
    assert.equal(openedProject.permissionMode, "full");
    const refreshedBuiltIns = bundle.application.snapshot().extensions.skills.filter((skill) => skill.source === "built-in");
    assert.equal(refreshedBuiltIns.every((skill) => skill.enabledSessionIds.includes(openedProject.id)), true);
  } finally {
    await bundle.application.dispose();
    await rm(dataRoot, { recursive: true, force: true });
  }
});
