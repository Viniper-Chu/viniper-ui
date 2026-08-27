import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createHarnessApplication } from "../../src/platform/bootstrap/create-harness-application";
import { createCliApplicationPort } from "../../src/platform/cli/application-port";
import { UnavailableSecretVault } from "../../src/platform/security/unavailable-secret-vault";
import { WorkflowDefinition } from "../../src/core/workflow-contracts";

test("CP4：正式 DesktopApplication 与 CLI port 共享 LSP/workflow/subagent 真源并经持久化恢复", async () => {
  const root = await mkdtemp(join(process.cwd(), "codex", "运行残留", "cp4-application-"));
  const options = {
    dataRoot: root,
    workingDirectory: root,
    assetsRoot: join(process.cwd(), "assets"),
    secretVault: new UnavailableSecretVault(),
    demoDelayMs: 1,
    approvalHostMode: "fail-closed" as const,
  };
  const definition: WorkflowDefinition = {
    id: "cp4-persisted-workflow",
    revision: 1,
    name: "持久化 CP4 工作流",
    mode: "prompt-chaining",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    steps: [{ id: "one", kind: "prompt", prompt: "只读 fixture" }],
  };
  const first = await createHarnessApplication(options);
  try {
    const desktop = first.application.snapshot();
    const cli = createCliApplicationPort(first.application);
    const cliSnapshot = await cli.getSnapshot();
    assert.deepEqual(cliSnapshot.workflows, desktop.workflows);
    assert.deepEqual(cliSnapshot.subagents, desktop.subagents);
    assert.deepEqual(await cli.getLspSnapshot!(), desktop.lsp);
    await cli.registerWorkflow!(definition);
    assert.equal((await cli.listWorkflows!()).definitions.some((item) => item.id === definition.id), true);
    const unavailable = await cli.navigateLsp!({ sessionId: desktop.activeSessionId, operation: "hover", path: "main.ts" });
    assert.equal(unavailable.status, "unavailable");
  } finally {
    await first.application.dispose();
  }
  const second = await createHarnessApplication(options);
  try {
    assert.equal(second.application.snapshot().workflows?.definitions.some((item) => item.id === definition.id), true);
    assert.equal(second.application.snapshot().lsp?.explicit, false);
  } finally {
    await second.application.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
