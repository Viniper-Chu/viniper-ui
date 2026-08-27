import assert from "node:assert/strict";
import test from "node:test";
import { DiagnosticsService } from "../../src/features/diagnostics/diagnostics-service";

test("CP7 diagnostics are minimal by default, scoped to one run, previewable, and upload is fail-closed", async () => {
  const service = new DiagnosticsService({ officialEndpoint: undefined });
  await service.initialize();
  service.record({ runId: "run-1", level: "info", code: "run.started", message: "消息正文不应进入诊断", command: "npm test", path: "C:\\secret\\project", secretPath: "C:\\Users\\person\\.ssh\\id_ed25519" });
  assert.equal(service.snapshot().detailedRunId, undefined);
  assert.equal(JSON.stringify(service.snapshot()).includes("消息正文"), false);
  assert.equal(service.beginDetailed("run-1"), true);
  service.record({ runId: "run-1", level: "debug", code: "tool.output", message: "仍不应导出", output: "file body" });
  const preview = service.previewExport("run-1");
  assert.ok(preview.fields.length > 0);
  assert.equal(JSON.stringify(preview).includes("file body"), false);
  assert.equal(JSON.stringify(preview).includes("id_ed25519"), false);
  service.endRun("run-1");
  assert.equal(service.snapshot().detailedRunId, undefined);
  assert.equal(service.queueUpload("run-1").status, "unavailable");
});
