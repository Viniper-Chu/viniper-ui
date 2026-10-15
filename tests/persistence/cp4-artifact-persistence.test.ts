import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { ManagedArtifactService } from "../../src/features/tool-output/managed-artifact-service";
import { SQLiteStore } from "../../src/platform/persistence/sqlite-store";

test("CP4 artifact references survive SQLite restart without storing output in the snapshot", async () => {
  const tempRoot = join(process.cwd(), "codex", "运行残留");
  await mkdir(tempRoot, { recursive: true });
  const root = await mkdtemp(join(tempRoot, "cp4-sqlite-artifacts-"));
  const first = new SQLiteStore(root);
  const second = new SQLiteStore(root);
  try {
    await first.initialize();
    const service = new ManagedArtifactService({ dataRoot: root, persistence: first, now: () => 50 });
    await service.initialize();
    const result = await service.writeText({ sessionId: "session-1", runId: "run-1", kind: "tool-output", text: "managed output", regenerable: false });
    assert.equal(result.ok, true);
    await first.close();
    await second.initialize();
    const restored = new ManagedArtifactService({ dataRoot: root, persistence: second });
    await restored.initialize();
    assert.equal(restored.list().length, 1);
    assert.equal(restored.list()[0].runId, "run-1");
    assert.equal(JSON.stringify(restored.snapshot()).includes("managed output"), false);
  } finally {
    await first.close().catch(() => undefined);
    await second.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
