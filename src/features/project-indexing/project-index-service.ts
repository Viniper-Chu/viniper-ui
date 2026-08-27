import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { ProjectIndexRecord, ProjectIndexResult, ProjectIndexSnapshot } from "../../core/project-index-contracts";
import { Phase8Cp3Persistence } from "../../core/ports";

const NOISE = new Set([".git", "node_modules", "dist", "build", "out", "coverage", ".next", ".turbo"]);
const PRIVATE_BASENAMES = new Set([
  ".env", ".env.local", ".env.development", ".env.production", ".npmrc", ".pypirc", ".netrc", ".git-credentials",
  "credentials", "credentials.json", "provider-settings.json", "secrets.json",
]);
const PRIVATE_SUFFIXES = [".key", ".pem", ".p12", ".pfx", ".ppk"];
const DEFAULT_SNAPSHOT: ProjectIndexSnapshot = {
  explicit: false,
  status: "disabled",
  revision: 0,
  records: [],
  stalePaths: [],
  semantic: { enabled: false, available: false },
  checkpoint: { processed: 0, total: 0 },
  source: "index",
};

export class ProjectIndexService {
  private state: ProjectIndexSnapshot = clone(DEFAULT_SNAPSHOT);
  private root?: string;
  private pendingPaths: string[] = [];

  constructor(private readonly persistence?: Phase8Cp3Persistence, private readonly semanticAvailable = false) {}

  async initialize(): Promise<void> {
    const saved = await this.persistence?.loadProjectIndexSnapshots();
    const latest = saved?.at(-1);
    if (latest) {
      this.state = clone(latest);
      this.root = latest.projectRoot;
      this.pendingPaths = [...(latest.pendingPaths ?? [])];
    }
  }

  snapshot(): ProjectIndexSnapshot {
    return clone(this.state);
  }

  async build(projectRoot: string, explicit: boolean): Promise<ProjectIndexSnapshot> {
    if (!explicit) {
      this.pendingPaths = [];
      this.state = { ...clone(DEFAULT_SNAPSHOT), revision: this.state.revision + 1 };
      return this.snapshot();
    }
    this.root = resolve(projectRoot);
    const paths = await this.collect(this.root);
    this.state = {
      projectRoot: this.root,
      explicit: true,
      status: "indexing",
      revision: this.state.revision + 1,
      records: [],
      stalePaths: [],
      semantic: { enabled: false, available: this.semanticAvailable },
      checkpoint: { processed: 0, total: paths.length },
      pendingPaths: [...paths],
      source: "index",
    };
    this.pendingPaths = paths;
    await this.processPending();
    this.state.status = this.pendingPaths.length > 0 ? "paused" : "ready";
    await this.persist();
    return this.snapshot();
  }

  private async processPending(): Promise<void> {
    while (this.pendingPaths.length > 0 && this.state.status !== "paused") {
      const path = this.pendingPaths.shift()!;
      this.state.pendingPaths = [...this.pendingPaths];
      const record = await this.readRecord(this.root!, path);
      if (record) this.state.records.push(record);
      this.state.checkpoint.processed += 1;
    }
  }

  async indexFile(projectRoot: string, path: string): Promise<ProjectIndexSnapshot> {
    if (!this.state.explicit || !samePath(this.root, projectRoot)) return this.snapshot();
    const normalized = normalizeRelative(path);
    const record = await this.readRecord(this.root!, normalized);
    this.state.records = this.state.records.filter((item) => item.path !== normalized);
    if (record) this.state.records.push(record);
    this.state.stalePaths = this.state.stalePaths.filter((item) => item !== normalized);
    this.state.revision += 1;
    await this.persist();
    return this.snapshot();
  }

  async markDeleted(projectRoot: string, path: string): Promise<ProjectIndexSnapshot> {
    if (!samePath(this.root, projectRoot)) return this.snapshot();
    const normalized = normalizeRelative(path);
    this.state.records = this.state.records.filter((item) => item.path !== normalized);
    if (!this.state.stalePaths.includes(normalized)) this.state.stalePaths.push(normalized);
    this.state.revision += 1;
    await this.persist();
    return this.snapshot();
  }

  async markRenamed(projectRoot: string, oldPath: string, newPath: string): Promise<ProjectIndexSnapshot> {
    await this.markDeleted(projectRoot, oldPath);
    return this.indexFile(projectRoot, newPath);
  }

  async search(projectRoot: string, query: string): Promise<ProjectIndexResult> {
    if (!this.state.explicit || !samePath(this.root, projectRoot) || this.state.status === "disabled") {
      return { results: [], source: "live-fallback", truncated: false };
    }
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    const results = this.state.records.flatMap((record) => {
      const matches: ProjectIndexResult["results"] = [];
      if (record.path.toLocaleLowerCase("zh-CN").includes(needle)) {
        matches.push({ path: record.path, match: "path", snippet: record.path, source: "index" });
      }
      if (record.symbols.some((symbol) => symbol.toLocaleLowerCase("zh-CN").includes(needle))) {
        matches.push({ path: record.path, match: "symbol", snippet: record.symbols.find((symbol) => symbol.toLocaleLowerCase("zh-CN").includes(needle)) ?? needle, source: "index" });
      }
      const line = record.text.split(/\r?\n/u).find((item) => item.toLocaleLowerCase("zh-CN").includes(needle));
      if (line) matches.push({ path: record.path, match: "text", snippet: line.slice(0, 240), source: "index" });
      return matches;
    }).slice(0, 100);
    if (results.length > 0 && this.state.stalePaths.length === 0) {
      return { results, source: "index", truncated: results.length >= 100 };
    }
    const live = await this.liveSearch(this.root, needle);
    return { results: dedupe([...results, ...live]), source: "live-fallback", truncated: false };
  }

  async setSemanticEnabled(enabled: boolean): Promise<ProjectIndexSnapshot> {
    this.state.semantic = { enabled: enabled && this.semanticAvailable, available: this.semanticAvailable };
    this.state.revision += 1;
    await this.persist();
    return this.snapshot();
  }

  async pause(): Promise<ProjectIndexSnapshot> {
    if (this.state.status === "indexing") this.state.status = "paused";
    this.state.revision += 1;
    await this.persist();
    return this.snapshot();
  }

  async resume(): Promise<ProjectIndexSnapshot> {
    if (this.state.status === "paused") {
      this.state.status = "indexing";
      this.state.revision += 1;
      await this.processPending();
      this.state.status = this.pendingPaths.length > 0 ? "paused" : "ready";
      await this.persist();
    }
    return this.snapshot();
  }

  private async collect(root: string): Promise<string[]> {
    const result: string[] = [];
    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
        const relativePath = normalizeRelative(relative(root, join(directory, entry.name)));
        if (isBlocked(relativePath)) continue;
        const absolute = join(directory, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile()) result.push(relativePath);
      }
    };
    await visit(root);
    return result;
  }

  private async readRecord(root: string, path: string): Promise<ProjectIndexRecord | undefined> {
    if (isBlocked(path)) return undefined;
    try {
      const absolute = join(root, path);
      const metadata = await stat(absolute);
      if (!metadata.isFile() || metadata.size > 128 * 1024) return undefined;
      const text = await readFile(absolute, "utf8");
      const symbols = [...text.matchAll(/\b(?:export\s+)?(?:function|class|interface|const|let|type)\s+([\w\u4e00-\u9fff$]+)/gu)]
        .map((match) => match[1]);
      return { path, modifiedAt: metadata.mtimeMs, text, symbols, stale: false };
    } catch {
      return undefined;
    }
  }

  private async liveSearch(root: string | undefined, query: string): Promise<ProjectIndexResult["results"]> {
    if (!root) return [];
    const paths = await this.collect(root);
    const matches: ProjectIndexResult["results"] = [];
    for (const path of paths) {
      const record = await this.readRecord(root, path);
      if (!record) continue;
      if (record.path.toLocaleLowerCase("zh-CN").includes(query)) matches.push({ path, match: "path", snippet: path, source: "live" });
      const line = record.text.split(/\r?\n/u).find((item) => item.toLocaleLowerCase("zh-CN").includes(query));
      if (line) matches.push({ path, match: "text", snippet: line.slice(0, 240), source: "live" });
    }
    return matches.slice(0, 100);
  }

  private async persist(): Promise<void> {
    if (this.state.projectRoot) await this.persistence?.saveProjectIndexSnapshot(this.snapshot());
  }
}

function isBlocked(path: string): boolean {
  const segments = path.split("/").filter(Boolean);
  if (segments.some((segment) => NOISE.has(segment))) return true;
  const name = basename(path).toLocaleLowerCase();
  if (PRIVATE_BASENAMES.has(name) || PRIVATE_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true;
  return false;
}

function normalizeRelative(path: string): string {
  return path.replace(/[\\]+/gu, "/").replace(/^\.\//u, "");
}

function samePath(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && resolve(left) === resolve(right));
}

function dedupe(values: ProjectIndexResult["results"]): ProjectIndexResult["results"] {
  const seen = new Set<string>();
  return values.filter((item) => {
    const key = `${item.path}|${item.match}|${item.snippet}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
