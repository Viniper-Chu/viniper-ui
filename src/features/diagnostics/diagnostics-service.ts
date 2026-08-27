import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DiagnosticEntry, DiagnosticPreview, DiagnosticsSnapshot } from "../../core/cp7-contracts";

export interface DiagnosticsPersistence {
  load(): Promise<DiagnosticEntry[]>;
  save(entries: DiagnosticEntry[]): Promise<void>;
}

export interface DiagnosticUploadTransport {
  enqueue(report: DiagnosticPreview): Promise<void>;
}

export interface DiagnosticsServiceOptions {
  officialEndpoint?: string;
  persistence?: DiagnosticsPersistence;
  uploadTransport?: DiagnosticUploadTransport;
}

export class DiagnosticsService {
  private entries: DiagnosticEntry[] = [];
  private detailedRunId?: string;
  private consent = false;
  private queuedUploads: string[] = [];
  private failedUploads: string[] = [];
  private persistChain: Promise<void> = Promise.resolve();
  private persistenceError?: string;

  constructor(private readonly options: DiagnosticsServiceOptions = {}) {}

  async initialize(): Promise<void> {
    this.entries = (await this.options.persistence?.load()) ?? [];
  }

  async flush(): Promise<void> { await this.persistChain; }

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
    if (this.options.persistence) {
      const copy = this.entries.map((item) => ({ ...item }));
      this.persistChain = this.persistChain.then(() => this.options.persistence!.save(copy)).catch((error) => {
        this.persistenceError = error instanceof Error ? error.message : String(error);
      });
    }
  }

  snapshot(): DiagnosticsSnapshot {
    return { entries: this.entries.map((entry) => ({ ...entry })), ...(this.detailedRunId ? { detailedRunId: this.detailedRunId } : {}), consent: this.consent, queuedUploads: [...this.queuedUploads], failedUploads: [...this.failedUploads], ...(this.persistenceError ? { persistenceError: this.persistenceError } : {}) };
  }

  previewExport(runId?: string): DiagnosticPreview {
    const fields = this.entries.filter((entry) => !runId || entry.runId === runId).map((entry) => ({ ...entry }));
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
