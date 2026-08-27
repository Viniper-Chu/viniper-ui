export type MemoryScope = "session-auto" | "project" | "personal";
export type MemorySource = "session-auto" | "project-derived" | "user-explicit";
export type MemoryStatus = "active" | "disabled" | "deleted";

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  source: MemorySource;
  text: string;
  sessionId?: string;
  projectRoot?: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
  useCount: number;
  status: MemoryStatus;
  stale: boolean;
  staleReason?: "age" | "conflict";
}

export interface MemorySnapshot {
  entries: MemoryEntry[];
  capacityWarning: boolean;
  capacity: number;
}

export interface MemoryCreateInput {
  scope: MemoryScope;
  source: MemorySource;
  text: string;
  sessionId?: string;
  projectRoot?: string;
}
