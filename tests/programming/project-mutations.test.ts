import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";

interface MutationContext {
  sessionId: string;
  runId: string;
}

interface ChangeResult {
  ok: boolean;
  action: string;
  paths: string[];
  beforeBytes: number;
  afterBytes: number;
  diff?: {
    artifactId: string;
    patch: string;
    truncated: boolean;
    nextCursor: number | null;
  };
  recovery?: {
    receiptId: string;
    originalPath: string;
    status: string;
  };
  error?: { code: string; message: string };
}

interface DiffResult extends ChangeResult {
  artifacts: Array<{ artifactId: string; action: string; paths: string[] }>;
}

interface MutableProjectFilesystem {
  canonicalizeProjectRoot(path: string): Promise<string>;
  write(root: string, input: unknown, context: MutationContext, signal?: AbortSignal): Promise<ChangeResult>;
  edit(root: string, input: unknown, context: MutationContext, signal?: AbortSignal): Promise<ChangeResult>;
  move(root: string, input: unknown, context: MutationContext, signal?: AbortSignal): Promise<ChangeResult>;
  delete(root: string, input: unknown, context: MutationContext, signal?: AbortSignal): Promise<ChangeResult>;
  restore(root: string, input: unknown, context: MutationContext, signal?: AbortSignal): Promise<ChangeResult>;
  diff(root: string, input: unknown, context: MutationContext, signal?: AbortSignal): Promise<DiffResult>;
}

type FilesystemConstructor = new (options?: unknown) => MutableProjectFilesystem;

function loadFilesystem(): FilesystemConstructor {
  return (require("../../src/platform/filesystem/node-project-filesystem") as {
    NodeProjectFilesystem: FilesystemConstructor;
  }).NodeProjectFilesystem;
}

async function fixture(options: { failCommit?: () => boolean } = {}) {
  const residue = resolve(process.cwd(), "codex", "运行残留");
  await mkdir(residue, { recursive: true });
  const root = await mkdtemp(join(residue, "phase7-p2-project-"));
  const managedRoot = await mkdtemp(join(residue, "phase7-p2-data-"));
  const protectedRoot = await mkdtemp(join(residue, "phase7-p2-harness-"));
  await writeFile(join(root, "existing.txt"), "alpha\nbeta\ngamma\n", "utf8");
  await writeFile(join(root, ".env"), "SECRET_MUST_STAY_UNTOUCHED\n", "utf8");
  await writeFile(join(root, ".env.example"), "PUBLIC_TEMPLATE=yes\n", "utf8");
  await mkdir(join(root, ".git"));
  await writeFile(join(root, ".git", "config"), "PRIVATE_GIT_CONFIG\n", "utf8");
  const Filesystem = loadFilesystem();
  const filesystem = new Filesystem({
    protectedRoots: [managedRoot, protectedRoot],
    managedRoot,
    beforeAtomicCommit: async () => {
      if (options.failCommit?.()) throw new Error("FIXTURE_COMMIT_FAILURE");
    },
  });
  const canonical = await filesystem.canonicalizeProjectRoot(root);
  return {
    root,
    managedRoot,
    protectedRoot,
    canonical,
    filesystem,
    context: { sessionId: "session-p2", runId: "run-p2" },
    dispose: async () => {
      await rm(root, { recursive: true, force: true });
      await rm(managedRoot, { recursive: true, force: true });
      await rm(protectedRoot, { recursive: true, force: true });
    },
  };
}

test("P2-01 project.write distinguishes create/replace and a failed atomic commit leaves no partial file", async () => {
  let failCommit = false;
  const scene = await fixture({ failCommit: () => failCommit });
  try {
    const created = await scene.filesystem.write(scene.canonical, {
      path: "created.txt",
      mode: "create",
      content: "created\n",
    }, scene.context);
    assert.equal(created.ok, true);
    assert.equal(created.action, "create");
    assert.equal(await readFile(join(scene.root, "created.txt"), "utf8"), "created\n");

    const conflict = await scene.filesystem.write(scene.canonical, {
      path: "created.txt",
      mode: "create",
      content: "must-not-overwrite\n",
    }, scene.context);
    assert.equal(conflict.ok, false);
    assert.equal(conflict.error?.code, "PATH_ALREADY_EXISTS");
    assert.equal(await readFile(join(scene.root, "created.txt"), "utf8"), "created\n");

    const replaced = await scene.filesystem.write(scene.canonical, {
      path: "existing.txt",
      mode: "replace",
      content: "atomically replaced\n",
    }, scene.context);
    assert.equal(replaced.ok, true);
    assert.equal(replaced.action, "replace");
    assert.equal(await readFile(join(scene.root, "existing.txt"), "utf8"), "atomically replaced\n");

    failCommit = true;
    const failed = await scene.filesystem.write(scene.canonical, {
      path: "existing.txt",
      mode: "replace",
      content: "partial-must-never-appear\n",
    }, scene.context);
    assert.equal(failed.ok, false);
    assert.equal(await readFile(join(scene.root, "existing.txt"), "utf8"), "atomically replaced\n");
    assert.deepEqual((await readdir(scene.root)).filter((name) => name.includes("viniper-tmp")), []);
  } finally {
    await scene.dispose();
  }
});

test("P2-01 project.edit validates every exact replacement before one atomic commit", async () => {
  const scene = await fixture();
  try {
    const changed = await scene.filesystem.edit(scene.canonical, {
      path: "existing.txt",
      edits: [
        { oldText: "alpha", newText: "ALPHA", expectedMatches: 1 },
        { oldText: "gamma", newText: "GAMMA", expectedMatches: 1 },
      ],
    }, scene.context);
    assert.equal(changed.ok, true);
    assert.equal(changed.action, "edit");
    assert.equal(await readFile(join(scene.root, "existing.txt"), "utf8"), "ALPHA\nbeta\nGAMMA\n");

    const beforeConflict = await readFile(join(scene.root, "existing.txt"), "utf8");
    const conflict = await scene.filesystem.edit(scene.canonical, {
      path: "existing.txt",
      edits: [
        { oldText: "beta", newText: "BETA", expectedMatches: 1 },
        { oldText: "missing", newText: "never", expectedMatches: 1 },
      ],
    }, scene.context);
    assert.equal(conflict.ok, false);
    assert.equal(conflict.error?.code, "EDIT_CONFLICT");
    assert.equal(await readFile(join(scene.root, "existing.txt"), "utf8"), beforeConflict);
  } finally {
    await scene.dispose();
  }
});

test("P2-02 move and recoverable delete/restore are conflict-safe", async () => {
  const scene = await fixture();
  try {
    const moved = await scene.filesystem.move(scene.canonical, {
      sourcePath: "existing.txt",
      targetPath: "renamed.txt",
    }, scene.context);
    assert.equal(moved.ok, true);
    assert.equal(await readFile(join(scene.root, "renamed.txt"), "utf8"), "alpha\nbeta\ngamma\n");

    const deleted = await scene.filesystem.delete(scene.canonical, { path: "renamed.txt" }, scene.context);
    assert.equal(deleted.ok, true);
    assert.equal(deleted.action, "delete");
    assert.equal(deleted.recovery?.status, "available");
    await assert.rejects(readFile(join(scene.root, "renamed.txt"), "utf8"), { code: "ENOENT" });

    await writeFile(join(scene.root, "renamed.txt"), "new occupant\n", "utf8");
    const restoreConflict = await scene.filesystem.restore(scene.canonical, {
      receiptId: deleted.recovery?.receiptId,
    }, { ...scene.context, runId: "restore-conflict" });
    assert.equal(restoreConflict.ok, false);
    assert.equal(restoreConflict.error?.code, "RESTORE_TARGET_EXISTS");
    assert.equal(await readFile(join(scene.root, "renamed.txt"), "utf8"), "new occupant\n");

    await rm(join(scene.root, "renamed.txt"));
    const restored = await scene.filesystem.restore(scene.canonical, {
      receiptId: deleted.recovery?.receiptId,
    }, { ...scene.context, runId: "restore-success" });
    assert.equal(restored.ok, true);
    assert.equal(restored.action, "restore");
    assert.equal(await readFile(join(scene.root, "renamed.txt"), "utf8"), "alpha\nbeta\ngamma\n");

    await rm(join(scene.root, "renamed.txt"));
    const replay = await scene.filesystem.restore(scene.canonical, {
      receiptId: deleted.recovery?.receiptId,
    }, { ...scene.context, runId: "restore-replay" });
    assert.equal(replay.ok, false);
    assert.equal(replay.error?.code, "RECOVERY_NOT_FOUND");
    await assert.rejects(readFile(join(scene.root, "renamed.txt"), "utf8"), { code: "ENOENT" });
  } finally {
    await scene.dispose();
  }
});

test("P2-01/P2-02 diff is structured, bounded and continuable without absolute managed paths", async () => {
  const scene = await fixture();
  try {
    const content = Array.from({ length: 250 }, (_, index) => `new line ${index}`).join("\n");
    const changed = await scene.filesystem.write(scene.canonical, {
      path: "large-change.txt",
      mode: "create",
      content,
    }, scene.context);
    assert.equal(changed.ok, true);
    assert.equal(changed.diff?.truncated, true);
    assert.equal(Boolean(changed.diff?.artifactId), true);
    assert.equal(JSON.stringify(changed).includes(scene.canonical), false);
    assert.equal(JSON.stringify(changed).includes(scene.managedRoot), false);

    const first = await scene.filesystem.diff(scene.canonical, {
      artifactId: changed.diff?.artifactId,
      maxChars: 1_000,
    }, scene.context);
    assert.equal(first.ok, true);
    assert.equal((first.diff?.patch.length ?? Number.POSITIVE_INFINITY) <= 1_000, true);
    assert.equal(first.diff?.truncated, true);
    assert.equal(typeof first.diff?.nextCursor, "number");
    const second = await scene.filesystem.diff(scene.canonical, {
      artifactId: changed.diff?.artifactId,
      cursor: first.diff?.nextCursor,
      maxChars: 1_000,
    }, scene.context);
    assert.equal(second.ok, true);
    assert.notEqual(second.diff?.patch, first.diff?.patch);
    assert.equal(JSON.stringify([first, second]).includes(scene.managedRoot), false);
  } finally {
    await scene.dispose();
  }
});

test("P2-01 protected, secret and escaping mutation targets remain zero-write while templates stay usable", async () => {
  const scene = await fixture();
  try {
    const secretBefore = await readFile(join(scene.root, ".env"), "utf8");
    for (const path of ["../escape.txt", ".env", ".git/config"]) {
      const result = await scene.filesystem.write(scene.canonical, {
        path,
        mode: "replace",
        content: "MUST_NOT_APPEAR\n",
      }, scene.context);
      assert.equal(result.ok, false, path);
    }
    assert.equal(await readFile(join(scene.root, ".env"), "utf8"), secretBefore);
    await assert.rejects(readFile(resolve(scene.root, "..", "escape.txt"), "utf8"), { code: "ENOENT" });

    const template = await scene.filesystem.write(scene.canonical, {
      path: ".env.example",
      mode: "replace",
      content: "PUBLIC_TEMPLATE=updated\n",
    }, scene.context);
    assert.equal(template.ok, true);
    assert.equal(await readFile(join(scene.root, ".env.example"), "utf8"), "PUBLIC_TEMPLATE=updated\n");

    await assert.rejects(
      scene.filesystem.canonicalizeProjectRoot(scene.protectedRoot),
      /受管|不能作为项目|保护/u,
    );
  } finally {
    await scene.dispose();
  }
});
