import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createHarnessApplication } from "../../src/platform/bootstrap/create-harness-application";
import { UnavailableSecretVault } from "../../src/platform/security/unavailable-secret-vault";

test("P1-09 explicit project roots, tool history and Token totals recover without cross-project content", async () => {
  const residue = resolve(process.cwd(), "codex", "运行残留");
  await mkdir(residue, { recursive: true });
  const dataRoot = await mkdtemp(join(residue, "p1-recovery-data-"));
  const projectA = await mkdtemp(join(residue, "p1-recovery-a-"));
  const projectB = await mkdtemp(join(residue, "p1-recovery-b-"));
  await writeFile(join(projectA, "fact.txt"), "PROJECT_A_FACT\n", "utf8");
  await writeFile(join(projectB, "fact.txt"), "PROJECT_B_FACT\n", "utf8");
  let first: Awaited<ReturnType<typeof createHarnessApplication>> | undefined;
  let restored: Awaited<ReturnType<typeof createHarnessApplication>> | undefined;
  try {
    first = await createHarnessApplication({
      dataRoot,
      workingDirectory: projectA,
      assetsRoot: dataRoot,
      secretVault: new UnavailableSecretVault(),
      demoDelayMs: 1,
    });
    const sessionA = await first.application.createProjectSession(projectA);
    const sessionB = await first.application.createProjectSession(projectB);
    await runDemo(first, sessionA.id, "P1 读取文件：fact.txt");
    await runDemo(first, sessionB.id, "P1 读取文件：fact.txt");
    await first.runtime.flushPersistence();
    await first.application.dispose();
    first = undefined;

    restored = await createHarnessApplication({
      dataRoot,
      workingDirectory: projectA,
      assetsRoot: dataRoot,
      secretVault: new UnavailableSecretVault(),
      demoDelayMs: 1,
    });
    const snapshot = restored.application.snapshot();
    const recoveredA = snapshot.sessions.find((session) => session.id === sessionA.id)!;
    const recoveredB = snapshot.sessions.find((session) => session.id === sessionB.id)!;
    assert.equal(recoveredA.projectAccess?.enabled, true);
    assert.equal(recoveredB.projectAccess?.enabled, true);
    assert.equal(recoveredA.workingDirectory, projectA);
    assert.equal(recoveredB.workingDirectory, projectB);

    const historyA = JSON.stringify(recoveredA.providerHistory);
    const historyB = JSON.stringify(recoveredB.providerHistory);
    assert.match(historyA, /PROJECT_A_FACT/u);
    assert.doesNotMatch(historyA, /PROJECT_B_FACT/u);
    assert.match(historyB, /PROJECT_B_FACT/u);
    assert.doesNotMatch(historyB, /PROJECT_A_FACT/u);
    assert.equal(historyA.includes(projectA), false);
    assert.equal(historyB.includes(projectB), false);

    const usageA = snapshot.telemetry.sessions.find((usage) => usage.sessionId === sessionA.id);
    const usageB = snapshot.telemetry.sessions.find((usage) => usage.sessionId === sessionB.id);
    assert.equal((usageA?.cumulative.total ?? 0) > 0, true);
    assert.equal((usageB?.cumulative.total ?? 0) > 0, true);
  } finally {
    if (first) await first.application.dispose();
    if (restored) await restored.application.dispose();
    await rm(dataRoot, { recursive: true, force: true });
    await rm(projectA, { recursive: true, force: true });
    await rm(projectB, { recursive: true, force: true });
  }
});

async function runDemo(
  bundle: Awaited<ReturnType<typeof createHarnessApplication>>,
  sessionId: string,
  text: string,
): Promise<void> {
  const session = bundle.runtime.getSession(sessionId)!;
  await bundle.application.send({
    sessionId,
    text,
    attachments: [],
    selectedModel: session.selectedModel,
    permissionMode: session.permissionMode,
  });
  await waitFor(() => !bundle.runtime.isRunning(sessionId));
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for local P1 run");
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}
