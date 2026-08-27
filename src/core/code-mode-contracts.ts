export type CodeMode = "native" | "code" | "both";

export interface CodeSubcallInput {
  callId: string;
  parentCallId?: string;
  runId: string;
  sessionId: string;
  toolName: string;
  input: Record<string, unknown>;
  signal: AbortSignal;
}

export interface CodeSubcallResult {
  text: string;
  data?: unknown;
  isError?: boolean;
  cancelled?: boolean;
}

export interface CodeCallRecord {
  callId: string;
  parentCallId?: string;
  toolName: string;
  status: "completed" | "failed" | "cancelled";
  textPreview: string;
}

export interface CodeRunRequest {
  runId: string;
  sessionId: string;
  mode: CodeMode;
  program: string;
  parentCallId?: string;
  bindings?: Record<string, unknown>;
  signal?: AbortSignal;
  maxParallel?: number;
  maxCalls?: number;
  maxOutputBytes?: number;
  invoke(input: CodeSubcallInput): Promise<CodeSubcallResult>;
}

export interface CodeRunResult {
  ok: boolean;
  value?: unknown;
  logs: string[];
  calls: CodeCallRecord[];
  outputTruncated: boolean;
  cancelled?: boolean;
  error?: string;
}
