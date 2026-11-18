import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DiagnosticEntry, DiagnosticPreview, DiagnosticsSnapshot } from "../../core/cp7-contracts";

export interface DiagnosticsPersistence {
  count(): number;
  read(limit?: number, runId?: string): DiagnosticEntry[];
  append(entries: readonly DiagnosticEntry[]): void;
}

export interface DiagnosticUploadTransport {
  enqueue(report: DiagnosticPreview): Promise<void>;
}

export interface DiagnosticsServiceOptions {
  officialEndpoint?: string;
  persistence?: DiagnosticsPersistence;
  uploadTransport?: DiagnosticUploadTransport;
}

const RECENT_ENTRIES = 100;

export class DiagnosticsService {
  private entries: DiagnosticEntry[] = [];
  private detailedRunId?: string;
  private consent = false;
  private queuedUploads: string[] = [];
  private failedUploads: string[] = [];
  private pending: DiagnosticEntry[] = [];
  private totalEntries = 0;
  private persistenceError?: string;

  constructor(private readonly options: DiagnosticsServiceOptions = {}) {}

  async initialize(): Promise<void> {
    const store = this.options.persistence;
    if (store) {
      this.totalEntries = store.count();
      this.entries = store.read(RECENT_ENTRIES);
    }
  }

  async flush(): Promise<void> { this.persistPending(); }

  private persistPending(): void {
    if (!this.pending.length || !this.options.persistence) return;
    try {
      this.options.persistence.append(this.pending);
      this.pending.length = 0;
      this.persistenceError = undefined;
    } catch (error) {
      this.persistenceError = error instanceof Error ? error.message : String(error);
    }
  }

  private history(limit?: number, runId?: string): DiagnosticEntry[] {
    const store = this.options.persistence;
    if (!store || (runId === undefined && limit !== undefined && limit <= RECENT_ENTRIES)) {
      const entries = runId === undefined ? this.entries : this.entries.filter(entry => entry.runId === runId);
      return entries.slice(limit === undefined ? 0 : Math.max(0, entries.length - limit)).map(entry => ({...entry}));
    }
    const pending = runId === undefined ? this.pending : this.pending.filter(entry => entry.runId === runId);
    const retained = limit === undefined ? pending : pending.slice(Math.max(0, pending.length - limit));
    return store.read(limit === undefined ? undefined : limit - retained.length, runId).concat(retained.map(entry => ({...entry})));
  }

  setConsent(enabled: boolean): void { this.consent = enabled; }

  beginDetailed(runId: string): boolean {
    if (!runId) return false;
    this.detailedRunId = runId;
    return true;
  }

  endRun(runId: string): void {
    if (this.detailedRunId === runId) this.detailedRunId = undefined;
  }

  record(input: Record<string, unknown>): void {
    const level = input.level === "debug" || input.level === "warn" || input.level === "error" ? input.level : "info";
    const entry: DiagnosticEntry = {
      timestamp: typeof input.timestamp === "number" ? input.timestamp : Date.now(),
      ...(typeof input.runId === "string" ? { runId: input.runId } : {}),
      level,
      code: typeof input.code === "string" ? input.code : "runtime.event",
      ...(typeof input.status === "string" ? { status: input.status } : {}),
      ...(typeof input.attempt === "number" ? { attempt: input.attempt } : {}),
      ...(typeof input.durationMs === "number" ? { durationMs: input.durationMs } : {}),
      ...(typeof input.count === "number" ? { count: input.count } : {}),
      ...(typeof input.artifactRef === "string" ? { artifactRef: input.artifactRef } : {}),
      ...(typeof input.runId === "string" && input.runId === this.detailedRunId ? { detailed: true } : {}),
    };
    this.entries.push(entry);
    this.totalEntries++;
    if (this.options.persistence) {
      if (this.entries.length > RECENT_ENTRIES) this.entries.shift();
      this.pending.push(entry);
      this.persistPending();
    }
  }

  snapshot(recent?: number): DiagnosticsSnapshot {
    const entries = this.history(recent === undefined ? undefined : Math.max(0, Math.floor(recent)));
    return { ...(recent === undefined ? {} : { totalEntries: this.totalEntries }), entries, ...(this.detailedRunId ? { detailedRunId: this.detailedRunId } : {}), consent: this.consent, queuedUploads: [...this.queuedUploads], failedUploads: [...this.failedUploads], ...(this.persistenceError ? { persistenceError: this.persistenceError } : {}) };
  }

  previewExport(runId?: string): DiagnosticPreview {
    const fields = this.history(undefined, runId);
    return { ...(runId ? { runId } : {}), fields, containsMessageBodies: false, containsCommandBodies: false, containsCredentialValues: false };
  }

  async exportPreview(runId: string | undefined, targetPath: string): Promise<DiagnosticPreview> {
    const preview = this.previewExport(runId);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, JSON.stringify(preview, null, 2), "utf8");
    return preview;
  }

  queueUpload(runId?: string): { status: "queued" | "unavailable"; reason?: string } {
    if (!this.consent) return { status: "unavailable", reason: "诊断上传未获得主动同意。" };
    if (!this.options.officialEndpoint || !isLoopback(this.options.officialEndpoint) || !this.options.uploadTransport) return { status: "unavailable", reason: "未配置本机诊断端点。" };
    const id = runId ?? `diagnostics-${Date.now()}`;
    this.queuedUploads.push(id);
    void this.options.uploadTransport.enqueue(this.previewExport(runId)).catch(() => {
      this.queuedUploads = this.queuedUploads.filter((item) => item !== id);
      this.failedUploads.push(id);
    });
    return { status: "queued" };
  }
}

function isLoopback(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  } catch {
    return false;
  }
}
