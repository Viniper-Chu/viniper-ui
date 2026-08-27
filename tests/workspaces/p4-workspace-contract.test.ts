import { strict as assert } from "node:assert";
import { test } from "node:test";
import { WorkspaceService } from "../../src/features/workspaces/workspace-service";

test("P4 workspace service supports auto/shared/isolated and recoverable lifecycle", async () => {
  const service = new WorkspaceService();
  const prepared = await service.prepare({ mode: "auto", projectRoot: "C:\\fixture", runId: "run-1" });
  assert.ok(prepared.workspaceId);
  assert.ok(["shared", "isolated"].includes(prepared.mode));
  assert.ok(service.snapshot(prepared.workspaceId));
  assert.ok(service.restore(prepared.workspaceId));
});

test("P4 shared workspace does not auto-commit and unknown results are retained", async () => {
  const service = new WorkspaceService();
  const prepared = await service.prepare({ mode: "shared", projectRoot: "C:\\fixture", runId: "run-2" });
  assert.equal(service.canAutoCommit(prepared.workspaceId), false);
  assert.equal(service.canRecycle(prepared.workspaceId), false);
  assert.equal(service.snapshot(prepared.workspaceId)?.status, "retained");
});
