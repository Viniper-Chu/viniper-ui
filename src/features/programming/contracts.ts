export type ProjectDiagnosticCode =
  | "PROJECT_NOT_FOUND"
  | "PROJECT_NOT_DIRECTORY"
  | "PROJECT_NOT_READABLE"
  | "PATH_INVALID"
  | "PATH_OUTSIDE_PROJECT"
  | "PATH_PROTECTED"
  | "PATH_NOT_FOUND"
  | "PATH_NOT_DIRECTORY"
  | "PATH_NOT_FILE"
  | "FILE_BINARY"
  | "FILE_UNSUPPORTED_ENCODING"
  | "FILE_TOO_LARGE"
  | "RANGE_INVALID"
  | "QUERY_REQUIRED"
  | "PATH_ALREADY_EXISTS"
  | "WRITE_MODE_INVALID"
  | "EDIT_INVALID"
  | "EDIT_CONFLICT"
  | "FILE_CHANGED"
  | "MUTATION_TOO_LARGE"
  | "RECOVERY_NOT_FOUND"
  | "RESTORE_TARGET_EXISTS"
  | "RECOVERY_FAILED"
  | "DIFF_NOT_FOUND"
  | "DIFF_CURSOR_INVALID";

export interface ProjectDiagnostic {
  code: ProjectDiagnosticCode;
  message: string;
  sentToModel: false;
}

export interface ProjectListInput {
  path?: string;
  limit?: number;
}

export interface ProjectListEntry {
  name: string;
  type: "file" | "directory" | "symlink" | "other";
  path: string;
}

export interface ProjectListResult {
  ok: boolean;
  projectRoot: string;
  path: string;
  entries: ProjectListEntry[];
  limit: number;
  truncated: boolean;
  blockedCount: number;
  error?: ProjectDiagnostic;
}

export interface ProjectSearchInput {
  query: string;
  path?: string;
  maxResults?: number;
}

export interface ProjectSearchMatch {
  path: string;
  line: number | null;
  snippet: string;
  match: "path" | "text";
  source: "live";
}

export interface ProjectSearchResult {
  ok: boolean;
  projectRoot: string;
  query: string;
  path: string;
  results: ProjectSearchMatch[];
  maxResults: number;
  scannedFiles: number;
  truncated: boolean;
  source: "live";
  error?: ProjectDiagnostic;
}

export interface ProjectReadInput {
  path: string;
  startLine?: number;
  endLine?: number;
}

export interface ProjectReadResult {
  ok: boolean;
  projectRoot: string;
  path: string;
  textStatus: "text" | "binary" | "unsupported-encoding" | "too-large";
  encoding: "utf-8" | null;
  lines: Array<{ number: number; text: string }>;
  range: { startLine: number; endLine: number; totalLines: number } | null;
  truncated: boolean;
  bytes: number;
  error?: ProjectDiagnostic;
}

export interface ProjectMutationContext {
  sessionId: string;
  runId: string;
}

export interface ProjectWriteInput {
  path: string;
  content: string;
  mode?: "create" | "replace";
}

export interface ProjectEditOperation {
  oldText: string;
  newText: string;
  expectedMatches: number;
}

export interface ProjectEditInput {
  path: string;
  edits: ProjectEditOperation[];
}

export interface ProjectMoveInput {
  sourcePath: string;
  targetPath: string;
}

export interface ProjectDeleteInput {
  path: string;
}

export interface ProjectRestoreInput {
  receiptId: string;
}

export interface ProjectDiffInput {
  path?: string;
  artifactId?: string;
  cursor?: number;
  maxChars?: number;
}

export type ProjectMutationAction = "create" | "replace" | "edit" | "move" | "delete" | "restore";

export interface ProjectDiffSlice {
  artifactId: string;
  patch: string;
  truncated: boolean;
  nextCursor: number | null;
  summary: {
    filesChanged: number;
    linesAdded: number;
    linesRemoved: number;
  };
}

export interface ProjectRecoveryReceipt {
  receiptId: string;
  originalPath: string;
  status: "available" | "restored";
}

export interface ProjectChangeResult {
  ok: boolean;
  action: ProjectMutationAction;
  paths: string[];
  beforeBytes: number;
  afterBytes: number;
  source: "live";
  diff?: ProjectDiffSlice;
  recovery?: ProjectRecoveryReceipt;
  error?: ProjectDiagnostic;
}

export interface ProjectDiffArtifactSummary {
  artifactId: string;
  action: ProjectMutationAction;
  paths: string[];
  beforeBytes: number;
  afterBytes: number;
}

export interface ProjectDiffResult {
  ok: boolean;
  action: "diff";
  paths: string[];
  beforeBytes: number;
  afterBytes: number;
  source: "live";
  artifacts: ProjectDiffArtifactSummary[];
  diff?: ProjectDiffSlice;
  error?: ProjectDiagnostic;
}

export interface ProjectFilesystem {
  canonicalizeProjectRoot(path: string): Promise<string>;
  list(projectRoot: string, input: ProjectListInput, signal?: AbortSignal): Promise<ProjectListResult>;
  search(projectRoot: string, input: ProjectSearchInput, signal?: AbortSignal): Promise<ProjectSearchResult>;
  read(projectRoot: string, input: ProjectReadInput, signal?: AbortSignal): Promise<ProjectReadResult>;
  write(
    projectRoot: string,
    input: ProjectWriteInput,
    context: ProjectMutationContext,
    signal?: AbortSignal,
  ): Promise<ProjectChangeResult>;
  edit(
    projectRoot: string,
    input: ProjectEditInput,
    context: ProjectMutationContext,
    signal?: AbortSignal,
  ): Promise<ProjectChangeResult>;
  move(
    projectRoot: string,
    input: ProjectMoveInput,
    context: ProjectMutationContext,
    signal?: AbortSignal,
  ): Promise<ProjectChangeResult>;
  delete(
    projectRoot: string,
    input: ProjectDeleteInput,
    context: ProjectMutationContext,
    signal?: AbortSignal,
  ): Promise<ProjectChangeResult>;
  restore(
    projectRoot: string,
    input: ProjectRestoreInput,
    context: ProjectMutationContext,
    signal?: AbortSignal,
  ): Promise<ProjectChangeResult>;
  diff(
    projectRoot: string,
    input: ProjectDiffInput,
    context: ProjectMutationContext,
    signal?: AbortSignal,
  ): Promise<ProjectDiffResult>;
}

export class ProjectFilesystemError extends Error {
  constructor(readonly code: ProjectDiagnosticCode, message: string) {
    super(message);
  }
}
