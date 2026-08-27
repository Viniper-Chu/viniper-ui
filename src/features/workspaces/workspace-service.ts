import { join } from "node:path";
import { newId } from "../../core/ids";
import { WorkspacePersistence } from "../../core/ports";
import {
  WorkspaceMode,
  WorkspacePreparationInput,
  WorkspacePreparationResult,
  WorkspaceSnapshot,
} from "../../core/programming-contracts";
import { GitService } from "../git/contracts";
import { LocalGitService } from "../../platform/git/local-git-service";

export interface WorkspaceServiceOptions {
  dataRoot?: string;
  git?: GitService;
  persistence?: WorkspacePersistence;
  now?: () => number;
  retentionDays?: number;
  onWorkspaceRoot?: (root: string) => void;
}

export class WorkspaceServiceError extends Error {}

export class WorkspaceService {
  private readonly dataRoot: string;
  private readonly git: GitService;
  private readonly persistence?: WorkspacePersistence;
  private readonly now: () => number;
  private readonly retentionMs: number;
  private readonly onWorkspaceRoot?: (root: string) => void;
  private readonly records = new Map<string, WorkspaceSnapshot>();
  private initialized = false;

  constructor(options: WorkspaceServiceOptions = {}) {
    this.dataRoot = options.dataRoot ?? join(process.cwd(), "codex", "运行残留", "p4-workspaces");
    this.git = options.git ?? new LocalGitService({ managedRoot: join(this.dataRoot, "git-output") });
    this.persistence = options.persistence;
    this.now = options.now ?? Date.now;
    this.retentionMs = (options.retentionDays ?? 7) * 24 * 60 * 60 * 1000;
    this.onWorkspaceRoot = options.onWorkspaceRoot;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    for (const record of (await this.persistence?.loadWorkspaces()) ?? []) this.records.set(record.id, record);
    this.initialized = true;
  }

  async prepare(input: WorkspacePreparationInput): Promise<WorkspacePreparationResult> {
    await this.initialize();
    const id = newId("workspace");
    const now = this.now();
    const status = await this.git.status(input.projectRoot);
    const mustIsolate = input.mode !== "shared" && status.isGit;
    if (!mustIsolate || !status.isGit) {
      const record: WorkspaceSnapshot = {
        id,
        runId: input.runId,
        projectRoot: input.projectRoot,
        root: input.projectRoot,
        mode: "shared",
        status: input.mode === "shared" ? "retained" : "shared",
        ownedPaths: [],
        checksPassed: false,
        mergeStatus: "not-requested",
        reason: status.isGit ? "shared-mode" : "non-git-project-shared",
        createdAt: now,
        updatedAt: now,
      };
      this.records.set(id, record);
      await this.persist();
      return { workspaceId: id, mode: "shared", root: record.root, status: record.status, reason: record.reason };
    }
    if (!status.ok || !status.clean) {
      const record: WorkspaceSnapshot = {
        id,
        runId: input.runId,
        projectRoot: input.projectRoot,
        root: input.projectRoot,
        mode: "isolated",
        status: "blocked",
        ownedPaths: [],
        checksPassed: false,
        mergeStatus: "not-requested",
        reason: "原项目不干净或 Git 状态不确定；未 stash、复制或覆盖原目录。",
        createdAt: now,
        updatedAt: now,
      };
      this.records.set(id, record);
      await this.persist();
      return { workspaceId: id, mode: "isolated", root: record.root, status: record.status, reason: record.reason };
    }

    const branchName = `viniper/task-${id.replace(/[^A-Za-z0-9/-]/gu, "-")}`;
    const root = join(this.dataRoot, "workspaces", id);
    const worktree = await this.git.createWorktree(input.projectRoot, root, branchName);
    if (worktree.ok) this.onWorkspaceRoot?.(root);
    const record: WorkspaceSnapshot = {
      id,
      runId: input.runId,
      projectRoot: input.projectRoot,
      root,
      mode: "isolated",
      status: worktree.ok ? "isolated" : "blocked",
      branchName,
      ownedPaths: [],
      checksPassed: false,
      mergeStatus: "not-requested",
      reason: worktree.ok ? "clean-git-isolated-worktree" : worktree.error ?? "隔离工作区创建失败。",
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(id, record);
    await this.persist();
    return { workspaceId: id, mode: "isolated", root, status: record.status, reason: record.reason };
  }

  snapshot(id: string): WorkspaceSnapshot | undefined {
    const record = this.records.get(id);
    return record ? clone(record) : undefined;
  }

  list(): WorkspaceSnapshot[] {
    return [...this.records.values()].sort((left, right) => left.createdAt - right.createdAt).map(clone);
  }

  async recordOwnedPaths(id: string, paths: string[]): Promise<boolean> {
    const record = this.required(id);
    const normalized = [...new Set(paths.map(normalizeRelative).filter(Boolean))];
    record.ownedPaths = [...new Set([...record.ownedPaths, ...normalized])];
    record.updatedAt = this.now();
    await this.persist();
    return true;
  }

  async markCheckResult(id: string, passed: boolean, reason?: string): Promise<boolean> {
    const record = this.required(id);
    record.checksPassed = passed;
    record.reason = reason ?? record.reason;
    record.status = passed && record.mode === "isolated" ? "commit_ready" : record.status;
    record.updatedAt = this.now();
    await this.persist();
    return true;
  }

  async markReviewResult(id: string, outcome: WorkspaceSnapshot["reviewOutcome"]): Promise<boolean> {
    const record = this.required(id);
    record.reviewOutcome = outcome;
    record.status = outcome === "PASS" && record.checksPassed && record.mode === "isolated" ? "commit_ready" : record.status;
    record.updatedAt = this.now();
    await this.persist();
    return true;
  }

  canAutoCommit(id: string): boolean {
    const record = this.records.get(id);
    return Boolean(record && record.mode === "isolated" && record.status !== "blocked"
      && record.checksPassed && record.reviewOutcome === "PASS" && record.ownedPaths.length > 0);
  }

  canRecycle(id: string): boolean {
    const record = this.records.get(id);
    return Boolean(record && record.mode === "isolated" && record.status === "merged");
  }

  async commitIsolated(id: string, message: string, paths?: string[]): Promise<boolean> {
    const record = this.required(id);
    if (!this.canAutoCommit(id)) return false;
    const result = await this.git.commitOwnedPaths(record.root, paths ?? record.ownedPaths, message, record.ownedPaths);
    if (!result.ok) {
      record.reason = result.error;
      record.updatedAt = this.now();
      await this.persist();
      return false;
    }
    record.status = "merge_ready";
    record.commitMessage = result.message;
    record.taskCommit = "created";
    record.mergeStatus = "ready";
    record.updatedAt = this.now();
    await this.persist();
    return true;
  }

  async requestSharedCommit(id: string): Promise<boolean> {
    const record = this.required(id);
    if (record.mode !== "shared") return false;
    record.status = "commit_ready";
    record.mergeStatus = "ready";
    record.reason = "用户显式请求共享工作区提交。";
    record.updatedAt = this.now();
    await this.persist();
    return true;
  }

  async commitShared(id: string, message: string, paths?: string[]): Promise<boolean> {
    const record = this.required(id);
    if (record.mode !== "shared" || record.status !== "commit_ready") return false;
    const result = await this.git.commitOwnedPaths(record.root, paths ?? record.ownedPaths, message, record.ownedPaths);
    if (!result.ok) return false;
    record.status = "committed";
    record.commitMessage = result.message;
    record.taskCommit = "created";
    record.updatedAt = this.now();
    await this.persist();
    return true;
  }

  async merge(id: string): Promise<boolean> {
    const record = this.required(id);
    if (record.mode !== "isolated" || record.status !== "merge_ready" || !record.branchName || !record.projectRoot) return false;
    const target = (await this.git.status(record.projectRoot)).branch;
    if (!target) return false;
    const result = await this.git.merge(record.projectRoot, record.branchName, target);
    record.mergeStatus = result.status === "merged" ? "merged" : result.status === "conflicted" ? "conflicted" : "not-requested";
    record.status = result.status === "merged" ? "merged" : result.status === "conflicted" ? "conflicted" : record.status;
    record.reason = result.error ?? record.reason;
    record.updatedAt = this.now();
    await this.persist();
    return result.ok;
  }

  async recycle(id: string): Promise<boolean> {
    const record = this.required(id);
    if (!this.canRecycle(id) || !record.projectRoot) return false;
    const status = await this.git.status(record.projectRoot);
    if (!status.ok || !status.clean) return false;
    const removed = await this.git.removeWorktree(record.projectRoot, record.root);
    if (!removed.ok) return false;
    record.status = "recoverable";
    record.recoveryUntil = this.now() + this.retentionMs;
    record.updatedAt = this.now();
    await this.persist();
    return true;
  }

  async restore(id: string): Promise<boolean> {
    const record = this.required(id);
    if (record.mode === "shared") return true;
    if (record.status !== "recoverable" || !record.branchName || !record.projectRoot || !record.recoveryUntil) return false;
    if (record.recoveryUntil < this.now()) return false;
    const worktree = await this.git.createWorktree(record.projectRoot, record.root, record.branchName);
    if (!worktree.ok) return false;
    record.status = "merge_ready";
    record.updatedAt = this.now();
    await this.persist();
    return true;
  }

  private required(id: string): WorkspaceSnapshot {
    const record = this.records.get(id);
    if (!record) throw new WorkspaceServiceError(`工作区 ${id} 不存在。`);
    return record;
  }

  private async persist(): Promise<void> {
    await this.persistence?.saveWorkspaces(this.list());
  }
}

function normalizeRelative(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/^\.\//u, "").replace(/^\/+|\/+$/gu, "");
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
