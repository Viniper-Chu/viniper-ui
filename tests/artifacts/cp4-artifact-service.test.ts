import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { ArtifactPersistence } from "../../src/core/ports";
import { ManagedArtifactRecord } from "../../src/core/artifact-contracts";
import { ManagedArtifactService } from "../../src/features/tool-output/managed-artifact-service";

class MemoryArtifacts implements ArtifactPersistence {
  records = new Map<string, ManagedArtifactRecord>();
  async loadArtifacts() { return [...this.records.values()]; }
  async saveArtifact(record: ManagedArtifactRecord) { this.records.set(record.id, structuredClone(record)); }
  async deleteArtifact(id: string) { this.records.delete(id); }
}

test("CP4 artifact service stores complete tool output and returns bounded continuation", async () => {
  const tempRoot = "D:\\Viniper workstation\\codex\\运行残留";
  await mkdir(tempRoot, { recursive: true });
  const root = await mkdtemp(join(tempRoot, "cp4-artifacts-"));
  try {
    const service = new ManagedArtifactService({ dataRoot: root, persistence: new MemoryArtifacts(), now: () => 100 });
    await service.initialize();
    const written = await service.writeText({ sessionId: "session-1", runId: "run-1", kind: "tool-output", text: "0123456789", regenerable: false });
    assert.equal(written.ok, true);
    if (!written.ok) return;
    const first = await service.read({ artifactId: written.record.id, runId: "run-1", offset: 0, maxBytes: 4 });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.text, "0123");
    assert.equal(first.nextOffset, 4);
    const second = await service.read({ artifactId: written.record.id, runId: "run-1", offset: 4, maxBytes: 99 });
    if (!second.ok) return;
    assert.equal(second.text, "456789");
    const denied = await service.read({ artifactId: written.record.id, runId: "run-2", offset: 0, maxBytes: 4 });
    assert.equal(denied.ok, false);
    assert.equal(denied.error.code, "ARTIFACT_NOT_OWNED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CP4 artifact write failure is explicit and never silently projects the full result", async () => {
  const tempRoot = "D:\\Viniper workstation\\codex\\运行残留";
  await mkdir(tempRoot, { recursive: true });
  const root = await mkdtemp(join(tempRoot, "cp4-artifact-failure-"));
  try {
    await writeFile(join(root, "artifacts"), "not-a-directory", "utf8");
    const service = new ManagedArtifactService({ dataRoot: root, persistence: new MemoryArtifacts(), now: () => 100 });
    await service.initialize();
    const result = await service.writeText({ sessionId: "s", runId: "r", kind: "tool-output", text: "sensitive complete output", regenerable: false });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "ARTIFACT_WRITE_FAILED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
