import assert from "node:assert/strict";
import { test } from "node:test";
import { ArtifactRetentionService } from "../../src/features/artifact-retention/artifact-retention-service";
import { ManagedArtifactRecord } from "../../src/core/artifact-contracts";

test("CP4 retention removes only registered regenerable artifacts and never formal output", async () => {
  const records: ManagedArtifactRecord[] = [
    { id: "old-regenerable", sessionId: "s", runId: "r", kind: "review", relativePath: "artifacts/r/old", state: "complete", sizeBytes: 1, createdAt: 1, regenerable: true, retention: "7d" },
    { id: "old-formal", sessionId: "s", runId: "r", kind: "session-output", relativePath: "artifacts/r/formal", state: "complete", sizeBytes: 1, createdAt: 1, regenerable: false, retention: "never" },
  ];
  const removed: string[] = [];
  const service = new ArtifactRetentionService({
    list: async () => structuredClone(records),
    remove: async (id) => { removed.push(id); },
    now: () => 8 * 24 * 60 * 60 * 1000,
  });
  const result = await service.cleanup();
  assert.deepEqual(result.removed, ["old-regenerable"]);
  assert.deepEqual(removed, ["old-regenerable"]);
});
