export type LocalModelSource = "builtin" | "loopback" | "managed-runner" | "custom";
export type LocalModelToolCapability = "native" | "experimental_emulation" | "none";
export type LocalModelStatus = "pending-confirmation" | "installed" | "update-available" | "failed";

export interface LocalModelRegistration {
  id: string;
  label: string;
  endpoint?: string;
  runner?: string;
  source: LocalModelSource;
  license: string;
  sizeBytes?: number;
  format: string;
  compatibility: string;
  toolCapability: LocalModelToolCapability;
  version: string;
}

export interface LocalModelVersion {
  id: string;
  status: "active" | "retained" | "pending";
  registeredAt: number;
}

export interface LocalModelRecord {
  id: string;
  label: string;
  source: LocalModelSource;
  endpoint?: string;
  runner?: string;
  license: string;
  sizeBytes?: number;
  format: string;
  compatibility: string;
  toolCapability: LocalModelToolCapability;
  status: LocalModelStatus;
  versions: LocalModelVersion[];
  activeVersionId?: string;
  pendingVersionId?: string;
}

export interface LocalModelSnapshot {
  cloudDefault: true;
  records: LocalModelRecord[];
  maxConcurrency: number;
  activeRuns: number;
}
