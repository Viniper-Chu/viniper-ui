import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { newId } from "../../core/ids";
import { runGitCommand } from "../process/git-command-runner";
import {
  GitBranchResult,
  GitCommitResult,
  GitDiffResult,
  GitLogResult,
  GitMergeResult,
  GitService,
  GitStatusEntry,
  GitStatusResult,
  GitWorktreeResult,
} from "../../features/git/contracts";

const DEFAULT_DIFF_CHARS = 96 * 1024;
const MAX_DIFF_CHARS = 256 * 1024;
const SAFE_BRANCH = /^[A-Za-z0-9._/-]+$/u;
const FORBIDDEN = new Set(["reset", "clean", "stash", "rebase", "push", "pull", "fetch", "remote"]);

export interface LocalGitServiceOptions {
  managedRoot?: string;
  maxDiffChars?: number;
}

export class LocalGitService implements GitService {
  private readonly managedRoot: string;
  private readonly maxDiffChars: number;

  constructor(options: LocalGitServiceOptions = {}) {
    this.managedRoot = options.managedRoot ?? join(process.cwd(), "codex", "运行残留", "git-output");
    this.maxDiffChars = Math.min(Math.max(options.maxDiffChars ?? DEFAULT_DIFF_CHARS, 1024), MAX_DIFF_CHARS);
  }

  async status(repoRoot: string): Promise<GitStatusResult> {
    const topLevel = await this.run(repoRoot, ["rev-parse", "--show-toplevel"]);
    if (!topLevel.ok || !samePath(topLevel.stdout.trim(), repoRoot)) {
      return { ok: true, isGit: false, clean: false, entries: [], error: "NOT_GIT" };
    }
    const result = await this.run(repoRoot, ["status", "--porcelain=v1", "--branch", "--untracked-files=all"]);
    if (!result.ok) {
      if (result.message.includes("not a git repository") || result.message.includes("不是 git 仓库")) {
        return { ok: true, isGit: false, clean: false, entries: [], error: "NOT_GIT" };
      }
      return { ok: false, isGit: true, clean: false, entries: [], error: result.message };
    }
    const lines = result.stdout.split(/\r?\n/u).filter(Boolean);
    const branchLine = lines.find((line) => line.startsWith("## "));
    const branch = branchLine?.slice(3).split("...")[0].trim() || undefined;
    const entries = lines.filter((line) => !line.startsWith("## ")).map(parseStatusLine);
    return { ok: true, isGit: true, clean: entries.length === 0, branch, entries };
  }

  async diff(repoRoot: string, options: { maxChars?: number; cursor?: number } = {}): Promise<GitDiffResult> {
    const result = await this.run(repoRoot, ["diff", "--no-ext-diff", "--binary", "--"]);
    if (!result.ok) return { ok: false, files: [], patch: "", truncated: false, error: result.message };
    const patch = result.stdout;
    const files = [...patch.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gmu)].map((match) => match[2]);
    const cursor = Math.max(0, options.cursor ?? 0);
    const limit = Math.min(Math.max(options.maxChars ?? this.maxDiffChars, 1024), MAX_DIFF_CHARS);
    const visible = patch.slice(cursor, cursor + limit);
    const truncated = cursor + visible.length < patch.length;
    const artifactId = newId("git-diff");
    const artifactPath = join(this.managedRoot, `${artifactId}.patch`);
    await mkdir(this.managedRoot, { recursive: true });
    await writeFile(artifactPath, patch, "utf8");
    return {
      ok: true,
      files,
      patch: visible,
      truncated,
      artifactId,
      artifactPath,
      nextCursor: truncated ? cursor + visible.length : null,
    };
  }

  async log(repoRoot: string, limit = 20): Promise<GitLogResult> {
    const bounded = Math.min(Math.max(Math.trunc(limit), 1), 100);
    const result = await this.run(repoRoot, ["log", "-n", String(bounded), "--date=iso-strict", "--format=%cI%x09%an%x09%s"]);
    if (!result.ok) return { ok: false, entries: [], error: result.message };
    const entries = result.stdout.split(/\r?\n/u).filter(Boolean).map((line) => {
      const [time = "", author = "", ...subject] = line.split("\t");
      return { time, author, subject: subject.join("\t") };
    });
    return { ok: true, entries };
  }

  async createBranch(repoRoot: string, name: string, base = "HEAD"): Promise<GitBranchResult> {
    validateBranch(name);
    const result = await this.run(repoRoot, ["branch", name, base]);
    return result.ok ? { ok: true, name } : { ok: false, name, error: result.message };
  }

  async commitOwnedPaths(repoRoot: string, paths: string[], message: string, ownedPaths: string[]): Promise<GitCommitResult> {
    const cleanPaths = uniqueRelativePaths(paths);
    const owned = new Set(uniqueRelativePaths(ownedPaths));
    if (!cleanPaths.length || cleanPaths.some((path) => !owned.has(path))) {
      return { ok: false, message, paths: [], error: "COMMIT_PATH_NOT_OWNED" };
    }
    if (!message.trim()) return { ok: false, message, paths: [], error: "COMMIT_MESSAGE_REQUIRED" };
    const status = await this.status(repoRoot);
    if (!status.ok || !status.isGit) return { ok: false, message, paths: [], error: "NOT_GIT" };
    const staged = await this.run(repoRoot, ["diff", "--cached", "--name-only"]);
    if (!staged.ok) return { ok: false, message, paths: [], error: staged.message };
    const stagedPaths = staged.stdout.split(/\r?\n/u).filter(Boolean);
    if (stagedPaths.some((path) => !owned.has(normalizeRelative(path)))) {
      return { ok: false, message, paths: [], error: "PRE_STAGED_PATH_NOT_OWNED" };
    }
    const add = await this.run(repoRoot, ["add", "--", ...cleanPaths]);
    if (!add.ok) return { ok: false, message, paths: [], error: add.message };
    const cached = await this.run(repoRoot, ["diff", "--cached", "--name-only"]);
    if (!cached.ok) return { ok: false, message, paths: [], error: cached.message };
    const cachedPaths = cached.stdout.split(/\r?\n/u).filter(Boolean).map(normalizeRelative);
    if (cachedPaths.some((path) => !owned.has(path))) {
      return { ok: false, message, paths: [], error: "STAGED_PATH_NOT_OWNED" };
    }
    const commit = await this.run(repoRoot, ["-c", "user.name=Viniper workstation", "-c", "user.email=local@viniper.invalid", "commit", "-m", message.trim()]);
    return commit.ok
      ? { ok: true, message: message.trim(), paths: cachedPaths }
      : { ok: false, message: message.trim(), paths: [], error: commit.message };
  }

  async merge(repoRoot: string, source: string, target: string): Promise<GitMergeResult> {
    validateBranch(source);
    validateBranch(target);
    const before = await this.status(repoRoot);
    if (!before.ok || !before.isGit) return { ok: false, status: "failed", source, target, error: "NOT_GIT" };
    if (!before.clean) return { ok: false, status: "failed", source, target, error: "TARGET_DIRTY" };
    const switchResult = await this.run(repoRoot, ["switch", target]);
    if (!switchResult.ok) return { ok: false, status: "failed", source, target, error: switchResult.message };
    const merged = await this.run(repoRoot, ["merge", "--no-ff", source, "-m", `合并任务分支 ${source}`]);
    if (merged.ok) return { ok: true, status: "merged", source, target };
    const after = await this.status(repoRoot);
    return {
      ok: false,
      status: after.entries.some((entry) => entry.conflicted) ? "conflicted" : "failed",
      source,
      target,
      error: merged.message,
    };
  }

  async createWorktree(repoRoot: string, path: string, branch: string): Promise<GitWorktreeResult> {
    validateBranch(branch);
    const status = await this.status(repoRoot);
    if (!status.ok || !status.isGit) return { ok: false, path, branch, error: "NOT_GIT" };
    if (!status.clean) return { ok: false, path, branch, error: "SOURCE_DIRTY" };
    const existing = await this.run(repoRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    const args = existing.ok
      ? ["worktree", "add", path, branch]
      : ["worktree", "add", "-b", branch, path, "HEAD"];
    const result = await this.run(repoRoot, args);
    return result.ok ? { ok: true, path, branch } : { ok: false, path, branch, error: result.message };
  }

  async removeWorktree(repoRoot: string, path: string): Promise<GitWorktreeResult> {
    const result = await this.run(repoRoot, ["worktree", "remove", path]);
    return result.ok ? { ok: true, path } : { ok: false, path, error: result.message };
  }

  /** Contract-only probe used by tests; never executes arbitrary user text. */
  async runRawForTest(command: string): Promise<void> {
    const args = command.trim().split(/\s+/u).filter(Boolean);
    validateArgs(args);
  }

  private async run(cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string; message: string }> {
    validateArgs(args);
    try {
      const result = await runGitCommand(cwd, args);
      return { ok: true, stdout: result.stdout, message: result.stderr };
    } catch (error) {
      const candidate = error as { stdout?: string; stderr?: string; message?: string };
      return { ok: false, stdout: candidate.stdout ?? "", message: candidate.stderr?.trim() || candidate.message || "git 命令失败。" };
    }
  }
}

function validateArgs(args: string[]): void {
  const command = gitCommand(args);
  if (!command || FORBIDDEN.has(command) || args.some((arg) => ["--hard", "--force", "-f"].includes(arg))) {
    throw new Error("当前产品边界禁止 reset/clean/stash/rebase/远端同步或强制 Git 操作。");
  }
  if (args.includes("--") && args.some((arg, index) => index > args.indexOf("--") && arg.startsWith("-"))) {
    throw new Error("Git 路径参数不允许继续注入选项。");
  }
}

function gitCommand(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "-c") {
      index += 1;
      continue;
    }
    if (args[index]?.startsWith("-")) continue;
    return args[index]?.toLocaleLowerCase("en-US");
  }
  return undefined;
}

function parseStatusLine(line: string): GitStatusEntry {
  const index = line[0] ?? " ";
  const worktree = line[1] ?? " ";
    const path = line.slice(3).replace(/^"|"$/u, "");
  const status = `${index}${worktree}`;
  return { path, index, worktree, status, conflicted: ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(status) };
}

function validateBranch(name: string): void {
  if (!SAFE_BRANCH.test(name) || name.startsWith("/") || name.endsWith("/") || name.includes("..")) {
    throw new Error("分支名不符合受管 Git 规则。");
  }
}

function uniqueRelativePaths(paths: string[]): string[] {
  return [...new Set(paths.map(normalizeRelative).filter(Boolean))];
}

function normalizeRelative(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/^\.\//u, "").replace(/^\/+|\/+$/gu, "");
}

function samePath(left: string, right: string): boolean {
  return resolve(left).replace(/[\\/]+$/u, "").toLocaleLowerCase("en-US")
    === resolve(right).replace(/[\\/]+$/u, "").toLocaleLowerCase("en-US");
}
