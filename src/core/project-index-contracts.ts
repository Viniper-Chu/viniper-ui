export type ProjectIndexStatus = "disabled" | "indexing" | "ready" | "paused" | "failed";

export interface ProjectIndexRecord {
  path: string;
  modifiedAt: number;
  text: string;
  symbols: string[];
  stale: boolean;
}

export interface ProjectIndexSnapshot {
  projectRoot?: string;
  explicit: boolean;
  status: ProjectIndexStatus;
  revision: number;
  records: ProjectIndexRecord[];
  stalePaths: string[];
  semantic: { enabled: boolean; available: boolean };
  checkpoint: { processed: number; total: number };
  pendingPaths?: string[];
  source: "index" | "live-fallback";
}

export interface ProjectIndexResult {
  results: Array<{
    path: string;
    match: "path" | "text" | "symbol";
    snippet: string;
    source: "index" | "live";
  }>;
  source: "index" | "live-fallback";
  truncated: boolean;
}
