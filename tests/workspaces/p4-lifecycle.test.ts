import assert from "node:assert/strict";
import { execFile as nodeExecFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { GitService } from "../../src/features/git/contracts";
import { LocalGitService } from "../../src/platform/git/local-git-service";
import { WorkspaceService } from "../../src/features/workspaces/workspace-service";

const execFile = promisify(nodeExecFile);

test("P4 Git fixture covers status/diff/log, isolated commit, explicit merge and seven-day recovery", async () => {
  const fixture = await gitFixture();
  try {
    const git = new LocalGitService({ managedRoot: join(fixture.dataRoot, "git-output") });
    const clean = await git.status(fixture.projectRoot);
    assert.equal(clean.isGit, true);
    assert.equal(clean.clean, true);

    await writeFile(join(fixture.projectRoot, "README.md"), "fixture\ndelta\n", "utf8");
    const dirty = await git.status(fixture.projectRoot);
    assert.equal(dirty.clean, false);
    assert.equal(dirty.entries.some((entry) => entry.path === "README.md"), true);
    const diff = await git.diff(fixture.projectRoot);
    assert.equal(diff.ok, true);
    assert.match(diff.patch, /README\.md/u);
    assert.ok(diff.artifactId);
    assert.match(await readFile(diff.artifactPath!, "utf8"), /README\.md/u);
    assert.equal((await git.log(fixture.projectRoot)).ok, true);
    assert.equal((await git.createBranch(fixture.projectRoot, "task/visible-status")).ok, true);

    await writeFile(join(fixture.projectRoot, "README.md"), "fixture\n", "utf8");
    await execGit(fixture.projectRoot, ["status", "--porcelain"]);
    const workspace = new WorkspaceService({ dataRoot: fixture.dataRoot, git, now: () => fixture.now });
    const prepared = await workspace.prepare({ mode: "isolated", projectRoot: fixture.projectRoot, runId: "run-isolated", requiresIsolation: true });
    assert.equal(prepared.status, "isolated");
    await writeFile(join(prepared.root, "owned.txt"), "owned\n", "utf8");
    await workspace.recordOwnedPaths(prepared.workspaceId, ["owned.txt"]);
    await workspace.markCheckResult(prepared.workspaceId, true);
    await workspace.markReviewResult(prepared.workspaceId, "PASS");
    assert.equal(workspace.canAutoCommit(prepared.workspaceId), true);
    assert.equal(await workspace.commitIsolated(prepared.workspaceId, "完成隔离任务"), true);
    assert.equal(workspace.snapshot(prepared.workspaceId)?.status, "merge_ready");
    assert.equal(await workspace.merge(prepared.workspaceId), true);
    assert.equal((await readFile(join(fixture.projectRoot, "owned.txt"), "utf8")).trim(), "owned");
    assert.equal(await workspace.recycle(prepared.workspaceId), true);
    await assert.rejects(stat(prepared.root), { code: "ENOENT" });
    assert.equal(await workspace.restore(prepared.workspaceId), true);
    assert.equal((await stat(prepared.root)).isDirectory(), true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.dataRoot, { recursive: true, force: true });
  }
});

test("P4 keeps dirty and non-Git projects shared/blocked without stash or copy", async () => {
  const residue = resolve(process.cwd(), "codex", "运行残留");
  await mkdir(residue, { recursive: true });
  const dataRoot = await mkdtemp(join(residue, "phase7-p4-boundary-data-"));
  const fake: GitService = {
    status: async (root) => ({ ok: true, isGit: root.includes("non-git") ? false : true, clean: !root.includes("dirty"), entries: [] }),
    diff: async () => ({ ok: true, files: [], patch: "", truncated: false }),
    log: async () => ({ ok: true, entries: [] }),
    createBranch: async (_root, name) => ({ ok: true, name }),
    commitOwnedPaths: async () => ({ ok: true, message: "", paths: [] }),
    merge: async (_root, source, target) => ({ ok: true, status: "merged", source, target }),
    createWorktree: async (_root, path, branch) => ({ ok: true, path, branch }),
    removeWorktree: async (_root, path) => ({ ok: true, path }),
  };
  try {
    const service = new WorkspaceService({ dataRoot, git: fake });
    const dirty = await service.prepare({ mode: "isolated", projectRoot: "C:\\dirty-project", runId: "dirty", requiresIsolation: true });
    assert.equal(dirty.status, "blocked");
    const nonGit = await service.prepare({ mode: "isolated", projectRoot: "C:\\non-git-project", runId: "non-git", requiresIsolation: true });
    assert.equal(nonGit.mode, "shared");
    assert.equal(nonGit.status, "shared");
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("P4 shared workspaces have zero automatic commit and require explicit commit intent", async () => {
  const fixture = await gitFixture();
  try {
    const git = new LocalGitService({ managedRoot: join(fixture.dataRoot, "git-output") });
    const service = new WorkspaceService({ dataRoot: fixture.dataRoot, git });
    const prepared = await service.prepare({ mode: "shared", projectRoot: fixture.projectRoot, runId: "shared" });
    assert.equal(prepared.mode, "shared");
    await writeFile(join(fixture.projectRoot, "shared.txt"), "shared\n", "utf8");
    await service.recordOwnedPaths(prepared.workspaceId, ["shared.txt"]);
    await service.markCheckResult(prepared.workspaceId, true);
    await service.markReviewResult(prepared.workspaceId, "PASS");
    assert.equal(service.canAutoCommit(prepared.workspaceId), false);
    assert.equal(await service.commitShared(prepared.workspaceId, "不应直接提交"), false);
    assert.equal(await service.requestSharedCommit(prepared.workspaceId), true);
    assert.equal(await service.commitShared(prepared.workspaceId, "用户显式提交共享任务"), true);
    assert.equal((await git.status(fixture.projectRoot)).clean, true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.dataRoot, { recursive: true, force: true });
  }
});

test("P4 merge conflict stops and retains both the target conflict and isolated worktree", async () => {
  const fixture = await gitFixture();
  try {
    const git = new LocalGitService({ managedRoot: join(fixture.dataRoot, "git-output") });
    const service = new WorkspaceService({ dataRoot: fixture.dataRoot, git });
    const prepared = await service.prepare({ mode: "isolated", projectRoot: fixture.projectRoot, runId: "conflict", requiresIsolation: true });
    assert.equal(prepared.status, "isolated");
    await writeFile(join(prepared.root, "conflict.txt"), "task side\n", "utf8");
    await service.recordOwnedPaths(prepared.workspaceId, ["conflict.txt"]);
    await service.markCheckResult(prepared.workspaceId, true);
    await service.markReviewResult(prepared.workspaceId, "PASS");
    assert.equal(await service.commitIsolated(prepared.workspaceId, "隔离冲突任务"), true);
    await writeFile(join(fixture.projectRoot, "conflict.txt"), "main side\n", "utf8");
    await execGit(fixture.projectRoot, ["add", "conflict.txt"]);
    await execGit(fixture.projectRoot, ["commit", "-m", "main side conflict"]);
    assert.equal(await service.merge(prepared.workspaceId), false);
    assert.equal(service.snapshot(prepared.workspaceId)?.status, "conflicted");
    assert.equal((await stat(prepared.root)).isDirectory(), true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.dataRoot, { recursive: true, force: true });
  }
});

async function gitFixture(): Promise<{ root: string; projectRoot: string; dataRoot: string; now: number }> {
  const residue = resolve(process.cwd(), "codex", "运行残留");
  await mkdir(residue, { recursive: true });
  const root = await mkdtemp(join(residue, "phase7-p4-git-fixture-"));
  const dataRoot = await mkdtemp(join(residue, "phase7-p4-git-data-"));
  await execGit(root, ["init", "-b", "main"]);
  await execGit(root, ["config", "user.name", "P4 Fixture"]);
  await execGit(root, ["config", "user.email", "p4-fixture@example.invalid"]);
  await writeFile(join(root, "README.md"), "fixture\n", "utf8");
  await execGit(root, ["add", "README.md"]);
  await execGit(root, ["commit", "-m", "fixture baseline"]);
  return { root, projectRoot: root, dataRoot, now: Date.now() };
}

async function execGit(cwd: string, args: string[]): Promise<void> {
  await execFile("git", args, { cwd, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
}
