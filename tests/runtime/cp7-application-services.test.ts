import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { createHarnessApplication } from "../../src/platform/bootstrap/create-harness-application";
import { createCliApplicationPort } from "../../src/platform/cli/application-port";
import { UnavailableSecretVault } from "../../src/platform/security/unavailable-secret-vault";

test("CP7 desktop and CLI consume one application service for archive, settings, diagnostics, and update boundaries", async () => {
  const root = await mkdtemp(join(resolve(process.cwd(), "codex", "运行残留"), "cp7-application-services-"));
  const project = await mkdtemp(join(root, "project-"));
  const dataRoot = join(root, "data");
  const fixture = await createHarnessApplication({
    dataRoot,
    workingDirectory: project,
    assetsRoot: dataRoot,
    secretVault: new UnavailableSecretVault(),
    demoDelayMs: 1,
    defaultProjectAccess: { enabled: true, selectedBy: "cli-explicit" },
  });
  try {
    const snapshot = fixture.application.snapshot();
    assert.equal(snapshot.settings?.closeBehavior, "ask");
    assert.equal(snapshot.settings?.diagnosticsConsent, false);
    const cli = createCliApplicationPort(fixture.application);
    assert.equal((await cli.checkUpdates!("preview") as { status: string }).status, "unavailable");
    await cli.setProductSetting!("maxConcurrentRuns", 4);
    assert.equal(fixture.application.snapshot().settings?.maxConcurrentRuns, 4);
    const archivePath = join(root, "export.vharchive.json");
    await cli.exportArchive!({ targetPath: archivePath, scope: { kind: "all" } });
    const archive = JSON.parse(await readFile(archivePath, "utf8")) as { manifest: { schemaVersion: number }; data: { sessions: unknown[]; secrets?: unknown } };
    assert.equal(archive.manifest.schemaVersion, 1);
    assert.ok(archive.data.sessions.length >= 1);
    assert.equal("secrets" in archive.data, false);
    const diagnostic = await cli.getDiagnosticsPreview!("missing-run");
    assert.equal(diagnostic.containsCredentialValues, false);
  } finally {
    await fixture.application.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
