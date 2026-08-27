import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createHarnessApplication } from "../../src/platform/bootstrap/create-harness-application";
import { createCliApplicationPort } from "../../src/platform/cli/application-port";
import { UnavailableSecretVault } from "../../src/platform/security/unavailable-secret-vault";

test("CP2：正式 Runtime 的 steer/inject 经桌面与 CLI 同源快照回执", async () => {
  const root = await mkdtemp(join(process.cwd(), "codex", "运行残留", "cp2-runtime-"));
  const bundle = await createHarnessApplication({
    dataRoot: root,
    workingDirectory: root,
    assetsRoot: join(process.cwd(), "assets"),
    secretVault: new UnavailableSecretVault(),
    demoDelayMs: 80,
  });
  try {
    const sessionId = bundle.application.snapshot().activeSessionId;
    const cli = createCliApplicationPort(bundle.application);
    const accepted = await cli.send({
      sessionId,
      text: "开始一个可被 steer 的本地 Demo 运行",
      attachments: [],
      selectedModel: "demo-default",
      permissionMode: "auto",
    });
    assert.equal(accepted.accepted, true);
    let runId: string | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      runId = bundle.application.snapshot().runs?.find((run) => run.sessionId === sessionId && ["running", "queued"].includes(run.status))?.runId;
      if (runId) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(runId);
    const steer = await cli.steer!(runId, "下一步优先报告当前状态");
    const inject = await bundle.application.inject(runId, { source: "cp2", note: "只读 fixture" });
    assert.equal((steer as { status: string }).status, "queued");
    assert.equal((inject as { status: string }).status, "queued");
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const run = bundle.application.snapshot().runs?.find((item) => item.runId === runId);
      if (run && ["completed", "failed", "cancelled"].includes(run.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const snapshot = bundle.application.snapshot();
    const receipts = snapshot.steering?.receipts.filter((item) => item.runId === runId) ?? [];
    assert.deepEqual(receipts.map((item) => item.status), ["delivered", "delivered"]);
    const steeringEvents = snapshot.sessions.find((session) => session.id === sessionId)?.events.filter((event) => event.type === "steering.updated") ?? [];
    assert.ok(steeringEvents.some((event) => (event.payload as { receipt?: { status?: string } }).receipt?.status === "queued"));
    assert.ok(steeringEvents.some((event) => (event.payload as { receipt?: { status?: string } }).receipt?.status === "delivered"));
    const cliSnapshot = await cli.getSnapshot();
    assert.deepEqual(cliSnapshot.steering, snapshot.steering);
  } finally {
    await bundle.application.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
