import { mkdir, open, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { ArtifactReadInput, ArtifactReadResult, ArtifactSnapshot, ArtifactWriteInput, ManagedArtifactRecord } from "../../core/artifact-contracts";
import { ArtifactFileRegistrar, ArtifactPersistence } from "../../core/ports";
import { newId } from "../../core/ids";

const DEFAULT_RETENTION = "never" as const;
const DEFAULT_RANGE_BYTES = 8_192;
const MAX_RANGE_BYTES = 65_536;

export type ArtifactWriteResult =
  | { ok: true; record: ManagedArtifactRecord }
  | { ok: false; error: { code: "ARTIFACT_WRITE_FAILED"; message: string } };

export class ManagedArtifactService implements ArtifactFileRegistrar {
  private readonly records = new Map<string, ManagedArtifactRecord>();
  private initialized = false;

  constructor(private readonly options: {
    dataRoot: string;
    persistence: ArtifactPersistence;
    now?: () => number;
  }) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    for (const record of await this.options.persistence.loadArtifacts()) this.records.set(record.id, structuredClone(record));
    this.initialized = true;
  }

  snapshot(): ArtifactSnapshot {
    return { records: [...this.records.values()].map((record) => structuredClone(record)) };
  }

  async writeText(input: ArtifactWriteInput): Promise<ArtifactWriteResult> {
    const id = newId("artifact");
    const relativePath = join("artifacts", input.runId, `${id}.txt`).split(sep).join("/");
    const record: ManagedArtifactRecord = {
      id,
      sessionId: input.sessionId,
      runId: input.runId,
      kind: input.kind,
      relativePath,
      state: "incomplete",
      sizeBytes: Buffer.byteLength(input.text, "utf8"),
      createdAt: this.options.now?.() ?? Date.now(),
      regenerable: input.regenerable,
      retention: input.retention ?? DEFAULT_RETENTION,
      ...(input.mediaType ? { mediaType: input.mediaType } : {}),
    };
    const absolutePath = this.resolveManagedPath(relativePath);
    try {
      await mkdir(resolve(this.options.dataRoot, "artifacts", input.runId), { recursive: true });
      await writeFile(absolutePath, input.text, { encoding: "utf8", flag: "wx" });
      record.state = "complete";
      this.records.set(record.id, record);
      await this.options.persistence.saveArtifact(record);
      return { ok: true, record: structuredClone(record) };
    } catch (error) {
      record.incompleteReason = error instanceof Error ? error.message : String(error);
      try { await this.options.persistence.saveArtifact(record); } catch { /* the original write error is the useful result */ }
      this.records.set(record.id, record);
      return { ok: false, error: { code: "ARTIFACT_WRITE_FAILED", message: `受管产物写入失败：${record.incompleteReason}` } };
    }
  }

  async captureToolResult(input: {
    sessionId: string;
    runId: string;
    toolName: string;
    text: string;
    isError: boolean;
  }): Promise<ArtifactWriteResult> {
    return this.writeText({
      sessionId: input.sessionId,
      runId: input.runId,
      kind: input.toolName.startsWith("terminal.") ? "terminal-output" : input.toolName === "project.diff" ? "project-diff" : "tool-output",
      text: input.text,
      // Full tool output is a formal run artifact.  It is never an automatic-retention
      // candidate; separately registered regenerable review material may opt into 7/30/90d.
      regenerable: false,
      retention: "never",
      mediaType: input.isError ? "application/problem+json" : "application/json",
    });
  }

  async registerExistingFile(input: {
    sessionId: string;
    runId: string;
    kind: "terminal-output" | "git-diff" | "project-diff" | "audit";
    absolutePath: string;
    retention?: "7d" | "30d" | "90d" | "never";
  }): Promise<ManagedArtifactRecord> {
    const absolutePath = resolve(input.absolutePath);
    const root = resolve(this.options.dataRoot);
    if (absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`)) throw new Error("受管产物路径越界。");
    const metadata = await stat(absolutePath);
    const record: ManagedArtifactRecord = {
      id: newId("artifact"),
      sessionId: input.sessionId,
      runId: input.runId,
      kind: input.kind,
      relativePath: relative(root, absolutePath).split(sep).join("/"),
      state: "complete",
      sizeBytes: metadata.size,
      createdAt: this.options.now?.() ?? Date.now(),
      regenerable: false,
      retention: input.retention ?? "never",
      mediaType: "text/plain",
    };
    this.records.set(record.id, record);
    await this.options.persistence.saveArtifact(record);
    return structuredClone(record);
  }

  async read(input: ArtifactReadInput): Promise<ArtifactReadResult> {
    const record = this.records.get(input.artifactId);
    if (!record) return failure("ARTIFACT_NOT_FOUND", "未找到该受管产物引用。");
    if (record.runId !== input.runId) return failure("ARTIFACT_NOT_OWNED", "该产物不属于本次 run；未读取文件。");
    if (record.state !== "complete") return failure("ARTIFACT_INCOMPLETE", "该产物尚未完整写入，不能读取。");
    const offset = input.offset ?? 0;
    const maxBytes = input.maxBytes ?? DEFAULT_RANGE_BYTES;
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_RANGE_BYTES || offset > record.sizeBytes) {
      return failure("ARTIFACT_RANGE_INVALID", "产物续读范围无效。");
    }
    const length = Math.min(maxBytes, record.sizeBytes - offset);
    try {
      const file = await open(this.resolveManagedPath(record.relativePath), "r");
      try {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await file.read(buffer, 0, length, offset);
        const nextOffset = offset + bytesRead < record.sizeBytes ? offset + bytesRead : null;
        return {
          ok: true,
          artifactId: record.id,
          offset,
          bytes: bytesRead,
          totalBytes: record.sizeBytes,
          text: buffer.subarray(0, bytesRead).toString("utf8"),
          nextOffset,
          truncated: nextOffset !== null,
          complete: nextOffset === null,
        };
      } finally {
        await file.close();
      }
    } catch (error) {
      return failure("ARTIFACT_READ_FAILED", `受管产物读取失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async modelProjection(record: ManagedArtifactRecord): Promise<string> {
    if (record.state !== "complete") return `[artifact ${record.id} incomplete]`;
    const head = await this.read({ artifactId: record.id, runId: record.runId, offset: 0, maxBytes: DEFAULT_RANGE_BYTES });
    if (!head.ok) return `[artifact ${record.id} unavailable: ${head.error.code}]`;
    if (!head.truncated) return head.text;
    const tailOffset = Math.max(DEFAULT_RANGE_BYTES, record.sizeBytes - DEFAULT_RANGE_BYTES);
    const tail = await this.read({ artifactId: record.id, runId: record.runId, offset: tailOffset, maxBytes: DEFAULT_RANGE_BYTES });
    if (!tail.ok) return head.text;
    return `${head.text}\n… 中间内容已存入受管产物 ${record.id}，可按范围续读 …\n${tail.text}`;
  }

  async remove(id: string): Promise<boolean> {
    const record = this.records.get(id);
    if (!record) return false;
    await rm(this.resolveManagedPath(record.relativePath), { force: true });
    await this.options.persistence.deleteArtifact(id);
    this.records.delete(id);
    return true;
  }

  list(): ManagedArtifactRecord[] {
    return [...this.records.values()].map((record) => structuredClone(record));
  }

  private resolveManagedPath(relativePath: string): string {
    const root = resolve(this.options.dataRoot);
    const candidate = resolve(root, relativePath);
    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) throw new Error("受管产物路径越界。");
    return candidate;
  }
}

function failure(
  code: "ARTIFACT_NOT_FOUND" | "ARTIFACT_NOT_OWNED" | "ARTIFACT_INCOMPLETE" | "ARTIFACT_RANGE_INVALID" | "ARTIFACT_READ_FAILED",
  message: string,
): ArtifactReadResult {
  return { ok: false, error: { code, message } };
}
