import { ManagedArtifactRecord } from "../../core/artifact-contracts";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ArtifactRetentionSource {
  list(): ManagedArtifactRecord[] | Promise<ManagedArtifactRecord[]>;
  remove(id: string): Promise<boolean | void>;
  now?: () => number;
}

export interface ArtifactRetentionResult {
  removed: string[];
  skipped: string[];
  failed: Array<{ id: string; message: string }>;
}

export class ArtifactRetentionService {
  constructor(private readonly source: ArtifactRetentionSource) {}

  async cleanup(): Promise<ArtifactRetentionResult> {
    const result: ArtifactRetentionResult = { removed: [], skipped: [], failed: [] };
    const now = this.source.now?.() ?? Date.now();
    for (const record of await this.source.list()) {
      if (!record.regenerable || record.retention === "never") {
        result.skipped.push(record.id);
        continue;
      }
      const days = record.retention === "7d" ? 7 : record.retention === "30d" ? 30 : 90;
      if (now - record.createdAt < days * DAY_MS) {
        result.skipped.push(record.id);
        continue;
      }
      try {
        if ((await this.source.remove(record.id)) !== false) result.removed.push(record.id);
        else result.skipped.push(record.id);
      } catch (error) {
        result.failed.push({ id: record.id, message: error instanceof Error ? error.message : String(error) });
      }
    }
    return result;
  }
}
