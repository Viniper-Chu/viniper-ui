export type TerminalCommandPurpose = "command" | "dependency" | "build" | "test" | "lint" | "typecheck";

export type TerminalExecutionStatus =
  | "completed"
  | "nonzero"
  | "not-found"
  | "timed-out"
  | "cancelled"
  | "failed";

export type TerminalDiagnosticCode =
  | "PROJECT_NOT_ENABLED"
  | "COMMAND_REQUIRED"
  | "COMMAND_TOO_LONG"
  | "PURPOSE_INVALID"
  | "TIMEOUT_INVALID"
  | "CWD_NOT_FOUND"
  | "CWD_NOT_DIRECTORY"
  | "CWD_OUTSIDE_PROJECT"
  | "PROCESS_START_FAILED"
  | "PROCESS_TERMINATION_FAILED"
  | "OUTPUT_NOT_OWNED"
  | "OUTPUT_NOT_FOUND"
  | "OUTPUT_STREAM_INVALID"
  | "OUTPUT_RANGE_INVALID";

export interface TerminalDiagnostic {
  code: TerminalDiagnosticCode;
  message: string;
}

export interface TerminalRunInput {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  purpose?: TerminalCommandPurpose;
}

export interface TerminalOutputPreview {
  preview: string;
  totalBytes: number;
  truncated: boolean;
  ref: string;
}

export interface PowerShellProcessIdentity {
  executable: string;
  edition: "Core" | "Desktop" | "unknown";
  major: number;
}

export interface TerminalRunResult {
  ok: boolean;
  executionId: string;
  status: TerminalExecutionStatus;
  purpose: TerminalCommandPurpose;
  cwd: string;
  timeoutMs: number;
  exitCode: number | null;
  durationMs: number;
  stdout: TerminalOutputPreview;
  stderr: TerminalOutputPreview;
  processIdentity?: PowerShellProcessIdentity;
  error?: TerminalDiagnostic;
}

export interface TerminalOutputHistory {
  runId: string;
  status: TerminalExecutionStatus | "running";
}

export interface TerminalOutputInput {
  executionId: string;
  stream: "stdout" | "stderr";
  offset?: number;
  maxBytes?: number;
}

export interface TerminalOutputResult {
  ok: boolean;
  executionId: string;
  stream: "stdout" | "stderr";
  status: TerminalExecutionStatus | "running";
  offset: number;
  bytes: number;
  totalBytes: number;
  text: string;
  nextOffset: number | null;
  truncated: boolean;
  complete: boolean;
  error?: TerminalDiagnostic;
}

export interface TerminalExecutionContext {
  sessionId: string;
  runId: string;
  projectRoot?: string;
  signal: AbortSignal;
}

export interface TerminalProcessRequest {
  executionId: string;
  input: TerminalRunInput & { purpose: TerminalCommandPurpose; timeoutMs: number };
}

export interface TerminalInteractiveStartResult {
  executionId: string;
  status: "running";
  transport: "conpty" | "pipes";
}

export interface TerminalInteractiveChunk {
  executionId: string;
  sequence: number;
  stream: "stdout" | "stderr";
  text: string;
  timestamp: number;
}

export type TerminalInteractiveListener = (chunk: TerminalInteractiveChunk) => void;

export interface TerminalProcessHost {
  run(request: TerminalProcessRequest, context: TerminalExecutionContext): Promise<TerminalRunResult>;
  output(input: TerminalOutputInput, context: TerminalExecutionContext): Promise<TerminalOutputResult>;
  outputForSession(input: TerminalOutputInput, sessionId: string, history?: TerminalOutputHistory): Promise<TerminalOutputResult>;
  startInteractive?(request: TerminalProcessRequest, context: TerminalExecutionContext): Promise<TerminalInteractiveStartResult>;
  writeInteractive?(executionId: string, text: string): Promise<boolean>;
  subscribeInteractive?(executionId: string, listener: TerminalInteractiveListener): () => void;
  waitInteractive?(executionId: string): Promise<TerminalRunResult>;
  stopInteractive?(executionId: string): Promise<boolean>;
  dispose(): Promise<void>;
}
