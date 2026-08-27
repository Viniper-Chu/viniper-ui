import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { createHarnessApplication } from "../../src/platform/bootstrap/create-harness-application";
import { createCliApplicationPort } from "../../src/platform/cli/application-port";
import { UnavailableSecretVault } from "../../src/platform/security/unavailable-secret-vault";

test("CLI consumes CP3 session, routing and memory state through the formal application port", async () => {
  const root = await mkdtemp(join(process.cwd(), "codex", "运行残留", "cp3-cli-"));
  const bundle = await createHarnessApplication({
    dataRoot: root,
    workingDirectory: process.cwd(),
    assetsRoot: join(process.cwd(), "assets"),
    secretVault: new UnavailableSecretVault(),
  });
  try {
    const port = createCliApplicationPort(bundle.application);
    const page = await port.querySessions?.({ status: "idle", limit: 10 });
    assert.equal(page?.total, 1);
    assert.equal(await port.setSmartRoutingEnabled?.(true), true);
    assert.equal(await port.setSmartRoutingStrategy?.("lightweight"), true);
    await port.createMemory?.({ scope: "personal", source: "user-explicit", text: "CLI 正式端口记忆" });
    const snapshot = await port.getSnapshot();
    assert.equal(snapshot.smartRouting?.enabled, true);
    assert.equal(snapshot.smartRouting?.strategy, "lightweight");
    assert.equal(snapshot.memories?.entries.some((entry) => entry.text === "CLI 正式端口记忆"), true);
  } finally {
    await bundle.application.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
