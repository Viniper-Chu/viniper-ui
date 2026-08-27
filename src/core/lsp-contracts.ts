export type LspOperation = "definition" | "references" | "implementation" | "hover";
export type LspSource = "typescript-javascript" | "fallback" | "unavailable";

export interface LspLocation {
  path: string;
  line: number;
  character: number;
  name?: string;
}

export interface LspRequest {
  sessionId: string;
  projectRoot: string;
  operation: LspOperation;
  path: string;
  symbol?: string;
  line?: number;
  character?: number;
  signal?: AbortSignal;
}

export interface LspResult {
  ok: boolean;
  operation: LspOperation;
  source: LspSource;
  status: "ok" | "unavailable" | "cancelled" | "error";
  items: LspLocation[];
  hoverText?: string;
  error?: string;
}

export interface LspSnapshot {
  projectRoot?: string;
  explicit: boolean;
  provider: LspSource;
  lastOperation?: LspOperation;
  status: "ready" | "fallback" | "unavailable";
}
