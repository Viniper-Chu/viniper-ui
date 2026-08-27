import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { DataTransferService } from "../../src/features/data-transfer/data-transfer-service";
import { CredentialBundleService } from "../../src/features/credential-transfer/credential-bundle-service";

test("CP7 ordinary archive is non-secret, versioned, relative, and failed import does not write", async () => {
  const rootBase = resolve(process.cwd(), "codex", "运行残留");
  await mkdir(rootBase, { recursive: true });
  const root = await mkdtemp(join(rootBase, "cp7-transfer-"));
  try {
    let merges = 0;
    const service = new DataTransferService({
      dataRoot: root,
      repository: {
        exportData: async () => ({
          sessions: [{ id: "s1", title: "本地会话" }],
          artifacts: [{ ref: "artifacts/s1/output.txt", content: "安全正文" }],
          providerSettings: { profileId: "demo", secretRef: "provider.demo" },
        }),
        previewMerge: async () => ({ conflicts: [], additions: 1 }),
        merge: async () => { merges += 1; },
      },
    });
    const target = join(root, "exports", "selected.vharchive.json");
    const exported = await service.exportArchive({ targetPath: target, scope: { kind: "session", sessionId: "s1" } });
    const raw = await readFile(exported.path, "utf8");
    const parsed = JSON.parse(raw) as { manifest: { schemaVersion: number; format: string }; data: { artifacts: Array<{ ref: string }> } };
    assert.equal(parsed.manifest.format, "viniper-harness-archive");
    assert.equal(parsed.manifest.schemaVersion, 1);
    assert.ok(parsed.data.artifacts.every((entry) => !entry.ref.includes(":\\") && !entry.ref.startsWith("/")));
    assert.equal(raw.includes("api-key-value"), false);

    const invalid = join(root, "invalid.vharchive.json");
    await import("node:fs/promises").then(({ writeFile }) => writeFile(invalid, "{\"manifest\":{\"schemaVersion\":999}}", "utf8"));
    const staged = await service.stageImport(invalid);
    const preview = await service.previewImport(staged.stagingId);
    assert.equal(preview.ok, false);
    await assert.rejects(() => service.mergeImport(staged.stagingId, false));
    assert.equal(merges, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CP7 credential bundle selects entries and rejects wrong password/corrupt package without writes", async () => {
  const rootBase = resolve(process.cwd(), "codex", "运行残留");
  await mkdir(rootBase, { recursive: true });
  const root = await mkdtemp(join(rootBase, "cp7-credentials-"));
  try {
    const values = new Map([["provider.demo", "fixture-secret"], ["provider.other", "other-secret"]]);
    let writes = 0;
    const service = new CredentialBundleService({
      vault: {
        listPortable: async () => [...values.keys()].map((id) => ({ id, label: id, configured: true })),
        read: async (id: string) => values.get(id) ?? undefined,
        write: async (id: string, value: string) => { writes += 1; values.set(id, value); },
      },
    });
    const bundlePath = join(root, "secret.vhsecrets");
    await service.exportBundle({ targetPath: bundlePath, entryIds: ["provider.demo"], password: "correct horse" });
    const bundleText = await readFile(bundlePath, "utf8");
    assert.equal(bundleText.includes("fixture-secret"), false);
    await assert.rejects(() => service.importBundle({ sourcePath: bundlePath, password: "wrong", confirm: true }));
    assert.equal(writes, 0);
    const corrupt = join(root, "corrupt.vhsecrets");
    await import("node:fs/promises").then(({ writeFile }) => writeFile(corrupt, bundleText.replace(/.$/, "x"), "utf8"));
    await assert.rejects(() => service.importBundle({ sourcePath: corrupt, password: "correct horse", confirm: true }));
    assert.equal(writes, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
