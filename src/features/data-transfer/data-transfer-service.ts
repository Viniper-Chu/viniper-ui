import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative } from "node:path";
import { ArchiveDataset, ArchiveFile, ArchiveScope, ImportPreview } from "../../core/cp7-contracts";

export interface ArchiveRepository {
  exportData(scope: ArchiveScope): Promise<ArchiveDataset>;
  previewMerge(data: ArchiveDataset): Promise<Pick<ImportPreview, "additions" | "conflicts">>;
  merge(data: ArchiveDataset): Promise<void>;
}

export interface DataTransferServiceOptions {
  dataRoot: string;
  repository: ArchiveRepository;
}

export class DataTransferService {
  constructor(private readonly options: DataTransferServiceOptions) {}

  async exportArchive(input: { targetPath: string; scope: ArchiveScope }): Promise<{ path: string; manifest: ArchiveFile["manifest"] }> {
    const data = sanitizeDataset(await this.options.repository.exportData(input.scope));
    const artifacts = data.artifacts ?? [];
    const manifest: ArchiveFile["manifest"] = {
      format: "viniper-harness-archive",
      schemaVersion: 1,
      createdAt: Date.now(),
      scope: input.scope,
      artifactRefs: artifacts.map((artifact) => artifact.ref),
    };
    const archive: ArchiveFile = { manifest, data };
    await atomicJsonWrite(input.targetPath, archive);
    return { path: input.targetPath, manifest };
  }

  async stageImport(sourcePath: string): Promise<{ stagingId: string; path: string }> {
    const stagingId = randomUUID();
    const path = join(this.options.dataRoot, "transfer", "staging", `${stagingId}.vharchive.json`);
    await mkdir(dirname(path), { recursive: true });
    await copyFile(sourcePath, path);
    return { stagingId, path };
  }

  async previewImport(stagingId: string): Promise<ImportPreview> {
    const parsed = await this.readStaged(stagingId);
    if (!parsed.ok) return parsed.preview;
    const result = await this.options.repository.previewMerge(parsed.archive.data);
    return { ok: true, schemaVersion: 1, additions: result.additions, conflicts: result.conflicts, errors: [] };
  }

  async mergeImport(stagingId: string, confirmed: boolean): Promise<ImportPreview> {
    if (!confirmed) throw new Error("IMPORT_CONFIRM_REQUIRED");
    const parsed = await this.readStaged(stagingId);
    if (!parsed.ok) throw new Error(parsed.preview.errors.join("; ") || "归档校验失败。");
    const preview = await this.previewImport(stagingId);
    if (!preview.ok) throw new Error(preview.errors.join("; ") || "归档校验失败。");
    await this.options.repository.merge(parsed.archive.data);
    return preview;
  }

  async discardStaging(stagingId: string): Promise<void> {
    await rm(join(this.options.dataRoot, "transfer", "staging", `${stagingId}.vharchive.json`), { force: true });
  }

  private async readStaged(stagingId: string): Promise<
    | { ok: true; archive: ArchiveFile }
    | { ok: false; preview: ImportPreview }
  > {
    const path = join(this.options.dataRoot, "transfer", "staging", `${stagingId}.vharchive.json`);
    try {
      const archive = JSON.parse(await readFile(path, "utf8")) as ArchiveFile;
      const errors = validateArchive(archive);
      if (errors.length > 0) return { ok: false, preview: { ok: false, additions: 0, conflicts: [], errors } };
      return { ok: true, archive };
    } catch (error) {
      return { ok: false, preview: { ok: false, additions: 0, conflicts: [], errors: [error instanceof Error ? error.message : "归档读取失败。"] } };
    }
  }
}

function validateArchive(value: unknown): string[] {
  if (!value || typeof value !== "object") return ["归档不是对象。"];
  const candidate = value as Partial<ArchiveFile>;
  if (!candidate.manifest || candidate.manifest.format !== "viniper-harness-archive") return ["归档格式不受支持。"];
  if (candidate.manifest.schemaVersion !== 1) return ["归档 schema 版本不受支持。"];
  if (!candidate.data || typeof candidate.data !== "object") return ["归档数据缺失。"];
  for (const artifact of candidate.data.artifacts ?? []) {
    if (!artifact || typeof artifact.ref !== "string" || isAbsolute(artifact.ref) || artifact.ref.includes("..")) {
      return ["归档包含非相对产物引用。"];
    }
  }
  return [];
}

function sanitizeDataset(value: ArchiveDataset): ArchiveDataset {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const output: Record<string, unknown> = {};
  for (const key of ["sessions", "messages", "events", "runs", "coordination", "scheduler", "usage", "providerSettings", "extensionMetadata", "memories", "fileReferences", "artifacts"]) {
    if (key in source) output[key] = stripSensitive(source[key]);
  }
  return output as ArchiveDataset;
}

function stripSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSensitive);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^(secret|password|token|apiKey|api_key|privateKey|credential)$/iu.test(key)) continue;
    output[key] = stripSensitive(item);
  }
  return output;
}

async function atomicJsonWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { encoding: "utf8", flag: "wx" });
  await rename(temp, path).catch(async (error) => { await rm(temp, { force: true }); throw error; });
}
