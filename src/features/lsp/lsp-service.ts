import { relative, resolve } from "node:path";
import type * as TypeScript from "typescript";
import { LspRequest, LspResult, LspSnapshot } from "../../core/lsp-contracts";
import { ProjectFilesystem } from "../programming/contracts";
import { ProjectIndexService } from "../project-indexing/project-index-service";

const ts: typeof TypeScript = loadTypeScript();

export interface LspServiceOptions {
  filesystem: ProjectFilesystem;
  index: ProjectIndexService;
  localProvider?: "typescript-javascript" | "unavailable";
}

/** Host-owned TypeScript/JavaScript semantic seam with an explicit index fallback. */
export class LspService {
  private readonly provider: "typescript-javascript" | "unavailable";
  private state: LspSnapshot = { explicit: false, provider: "unavailable", status: "unavailable" };

  constructor(private readonly options: LspServiceOptions) { this.provider = options.localProvider ?? "typescript-javascript"; }
  snapshot(): LspSnapshot { return clone(this.state); }

  async navigate(input: LspRequest): Promise<LspResult> {
    if (!input.projectRoot.trim() || !input.path.trim()) return this.fail(input, "语义导航需要明确项目和相对路径。", "error");
    if (input.signal?.aborted) return this.fail(input, "语义导航已取消。", "cancelled");
    if (this.provider === "unavailable") {
      this.state = { projectRoot: input.projectRoot, explicit: true, provider: "unavailable", lastOperation: input.operation, status: "fallback" };
      return this.fallback(input);
    }
    if (!isScriptPath(input.path)) return this.fail(input, "当前本地语义 Provider 只支持 TypeScript/JavaScript 文件。", "unavailable");
    try {
      const project = createTypeScriptProject(input.projectRoot);
      const file = resolve(input.projectRoot, input.path);
      const source = project.service.getProgram()?.getSourceFile(file);
      if (!source) return this.semanticUnavailable(input, "TypeScript 项目未包含当前文件；已回退项目索引。");
      const position = semanticPosition(source.text, input);
      let items: LspResult["items"] = [];
      let hoverText: string | undefined;
      if (input.operation === "definition") items = locations(input.projectRoot, project.service.getDefinitionAtPosition(file, position) ?? []);
      if (input.operation === "implementation") items = locations(input.projectRoot, project.service.getImplementationAtPosition(file, position) ?? []);
      if (input.operation === "references") items = locations(input.projectRoot, (project.service.findReferences(file, position) ?? []).flatMap((group) => group.references));
      if (input.operation === "hover") {
        const info = project.service.getQuickInfoAtPosition(file, position);
        hoverText = info ? [ts.displayPartsToString(info.displayParts), ts.displayPartsToString(info.documentation)].filter(Boolean).join("\n") : undefined;
      }
      this.state = { projectRoot: input.projectRoot, explicit: true, provider: "typescript-javascript", lastOperation: input.operation, status: "ready" };
      return { ok: true, operation: input.operation, source: "typescript-javascript", status: "ok", items, ...(hoverText ? { hoverText } : {}) };
    } catch {
      return this.semanticUnavailable(input, "TypeScript 语义服务不可用；已明确回退项目索引。");
    }
  }

  private async semanticUnavailable(input: LspRequest, reason: string): Promise<LspResult> {
    this.state = { projectRoot: input.projectRoot, explicit: true, provider: "unavailable", lastOperation: input.operation, status: "fallback" };
    const result = await this.fallback(input);
    return { ...result, error: result.items.length ? reason : `${reason} Index fallback 未找到匹配。` };
  }

  private async fallback(input: LspRequest): Promise<LspResult> {
    if (!input.symbol?.trim()) return this.fail(input, "语言服务不可用；回退搜索需要符号或关键词。", "unavailable");
    const result = await this.options.index.search(input.projectRoot, input.symbol);
    const items = result.results.filter((item) => isScriptPath(item.path)).map((item) => ({ path: item.path, line: 1, character: 0, name: input.symbol }));
    return { ok: true, operation: input.operation, source: "fallback", status: "ok", items, ...(items.length === 0 ? { error: "Index fallback 未找到匹配；没有伪造语义位置。" } : {}) };
  }

  private fail(input: LspRequest, error: string, status: LspResult["status"]): LspResult {
    return { ok: false, operation: input.operation, source: this.provider === "unavailable" ? "fallback" : this.provider, status, items: [], error };
  }
}

function createTypeScriptProject(projectRoot: string): { service: TypeScript.LanguageService } {
  const configPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, "tsconfig.json");
  const parsed = configPath
    ? ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config ?? {}, ts.sys, projectRoot)
    : { fileNames: ts.sys.readDirectory(projectRoot, [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]), options: { allowJs: true } as TypeScript.CompilerOptions };
  const versions = new Map(parsed.fileNames.map((file) => [file, String(ts.sys.getModifiedTime?.(file)?.getTime() ?? 0)]));
  const host: TypeScript.LanguageServiceHost = {
    getCompilationSettings: () => parsed.options,
    getScriptFileNames: () => parsed.fileNames,
    getScriptVersion: (file) => versions.get(file) ?? "0",
    getScriptSnapshot: (file) => { const text = ts.sys.readFile(file); return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text); },
    getCurrentDirectory: () => projectRoot,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
  };
  return { service: ts.createLanguageService(host, ts.createDocumentRegistry()) };
}

function semanticPosition(text: string, input: LspRequest): number {
  const lines = text.split(/\r?\n/u);
  const line = Math.max(1, input.line ?? 1);
  const prefix = lines.slice(0, line - 1).reduce((sum, item) => sum + item.length + 1, 0);
  const current = lines[line - 1] ?? "";
  const requested = Math.max(0, input.character ?? 0);
  const symbol = input.symbol?.trim();
  const symbolAtLine = symbol ? current.indexOf(symbol, Math.min(requested, current.length)) : -1;
  return prefix + (symbolAtLine >= 0 ? symbolAtLine : Math.min(requested, current.length));
}

function locations(projectRoot: string, entries: readonly TypeScript.DocumentSpan[]): LspResult["items"] {
  return entries.map((entry) => {
    const source = ts.createSourceFile(entry.fileName, ts.sys.readFile(entry.fileName) ?? "", ts.ScriptTarget.Latest, true);
    const point = source.getLineAndCharacterOfPosition(entry.textSpan.start);
    return { path: relative(projectRoot, entry.fileName).replace(/\\/gu, "/"), line: point.line + 1, character: point.character };
  });
}

function isScriptPath(path: string): boolean { return /\.(?:[cm]?js|jsx|tsx?)$/iu.test(path); }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function loadTypeScript(): typeof TypeScript {
  try {
    return require("typescript") as typeof TypeScript;
  } catch {
    return require(resolve(__dirname, "../../../../vendor/typescript.js")) as typeof TypeScript;
  }
}
