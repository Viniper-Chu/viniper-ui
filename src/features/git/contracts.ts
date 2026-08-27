export interface GitStatusEntry {
  path: string;
  index: string;
  worktree: string;
  status: string;
  conflicted: boolean;
}

export interface GitStatusResult {
  ok: boolean;
  isGit: boolean;
  clean: boolean;
  branch?: string;
  entries: GitStatusEntry[];
  error?: string;
}

export interface GitDiffResult {
  ok: boolean;
  files: string[];
  patch: string;
  truncated: boolean;
  artifactId?: string;
  artifactPath?: string;
  nextCursor?: number | null;
  error?: string;
}

export interface GitLogEntry {
  time: string;
  author: string;
  subject: string;
}

export interface GitLogResult {
  ok: boolean;
  entries: GitLogEntry[];
  error?: string;
}

export interface GitBranchResult {
  ok: boolean;
  name: string;
  error?: string;
}

export interface GitCommitResult {
  ok: boolean;
  message: string;
  paths: string[];
  error?: string;
}

export interface GitMergeResult {
  ok: boolean;
  status: "merged" | "conflicted" | "failed";
  source: string;
  target: string;
  error?: string;
}

export interface GitWorktreeResult {
  ok: boolean;
  path: string;
  branch?: string;
  error?: string;
}

export interface GitService {
  status(repoRoot: string): Promise<GitStatusResult>;
  diff(repoRoot: string, options?: { maxChars?: number; cursor?: number }): Promise<GitDiffResult>;
  log(repoRoot: string, limit?: number): Promise<GitLogResult>;
  createBranch(repoRoot: string, name: string, base?: string): Promise<GitBranchResult>;
  commitOwnedPaths(repoRoot: string, paths: string[], message: string, ownedPaths: string[]): Promise<GitCommitResult>;
  merge(repoRoot: string, source: string, target: string): Promise<GitMergeResult>;
  createWorktree(repoRoot: string, path: string, branch: string): Promise<GitWorktreeResult>;
  removeWorktree(repoRoot: string, path: string): Promise<GitWorktreeResult>;
}
