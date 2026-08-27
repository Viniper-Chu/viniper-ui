export type ArtifactKind =
  | "tool-output"
  | "terminal-output"
  | "git-diff"
  | "project-diff"
  | "review"
  | "audit"
  | "memory"
  | "session-output";

export type ArtifactRetention = "7d" | "30d" | "90d" | "never";
export type ArtifactState = "complete" | "incomplete" | "failed";

export interface ManagedArtifactRecord {
  id: string;
  sessionId: string;
  runId: string;
  kind: ArtifactKind;
  relativePath: string;
  state: ArtifactState;
  sizeBytes: number;
  createdAt: number;
  regenerable: boolean;
  retention: ArtifactRetention;
  mediaType?: string;
  incompleteReason?: string;
}

export interface ArtifactWriteInput {
  sessionId: string;
  runId: string;
  kind: ArtifactKind;
  text: string;
  regenerable: boolean;
  retention?: ArtifactRetention;
  mediaType?: string;
}

export interface ArtifactReadInput {
  artifactId: string;
  runId: string;
  offset?: number;
  maxBytes?: number;
}

export type ArtifactReadResult =
  | {
      ok: true;
      artifactId: string;
      offset: number;
      bytes: number;
      totalBytes: number;
      text: string;
      nextOffset: number | null;
      truncated: boolean;
      complete: boolean;
    }
  | {
      ok: false;
      error: { code: "ARTIFACT_NOT_FOUND" | "ARTIFACT_NOT_OWNED" | "ARTIFACT_INCOMPLETE" | "ARTIFACT_RANGE_INVALID" | "ARTIFACT_READ_FAILED"; message: string };
    };

export interface ArtifactSnapshot {
  records: ManagedArtifactRecord[];
}
