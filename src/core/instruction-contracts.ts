export type ProjectInstructionStatusKind = "loaded" | "missing" | "error";

export interface ProjectInstructionStatus {
  status: ProjectInstructionStatusKind;
  canonicalPath: string;
  revision: string;
  bytes: number;
  message: string;
  loadedAt: number;
}

export interface ProjectInstructionReadResult {
  canonicalPath: string;
  text?: string;
  bytes?: number;
  modifiedAt?: number;
}

export interface ProjectInstructionSnapshot {
  status: ProjectInstructionStatus;
  text?: string;
}
