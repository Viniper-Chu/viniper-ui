import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { ToolRequest } from "../../core/contracts";
import { ToolExecutionContext, ToolExecutor, ToolResult } from "../tools/tool-registry";
import { FileOpener } from "./contracts";

export interface GenericFileToolOptions {
  recoveryRoot?: string;
}

/**
 * File tools deliberately use the same ToolRegistry/Application Port as
 * project tools, but accept absolute paths for the generic Agent.  They do
 * not bypass permission policy: every mutating operation is computer-scoped
 * and therefore remains approval-gated outside full access.
 */
export function createFileTools(opener: FileOpener, options: GenericFileToolOptions = {}): ToolExecutor[] {
  return [
    new OpenFileTool(opener),
    new GenericFileListTool(),
    new GenericFileReadTool(),
    new GenericFileWriteTool(),
    new GenericFileEditTool(),
    new GenericFileMoveTool(),
    new GenericFileDeleteTool(options.recoveryRoot),
  ];
}

class OpenFileTool implements ToolExecutor {
  readonly name = "file.open";
  readonly description = "用电脑已关联的原生应用打开一个绝对文件路径，例如桌面上的 PDF、图片或文档。";
  readonly readOnly = false;
  readonly authorizationScope = "computer" as const;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      path: { type: "string" as const, description: "要打开文件的绝对路径。" },
    },
    required: ["path"],
    additionalProperties: false,
  };

  constructor(private readonly opener: FileOpener) {}

  async execute(request: ToolRequest, _context: ToolExecutionContext): Promise<ToolResult> {
    const path = typeof request.input?.path === "string" ? request.input.path : "";
    const result = await this.opener.open(path);
    return {
      toolId: request.id,
      text: JSON.stringify(result),
      data: result,
      displayText: result.ok ? `已用系统默认应用打开：${result.path}` : result.error?.message ?? "文件未能打开。",
      isError: !result.ok,
    };
  }
}

abstract class GenericFileToolBase {
  readonly authorizationScope = "computer" as const;

  protected path(input: unknown, field = "path"): string {
    const value = input && typeof input === "object" ? (input as Record<string, unknown>)[field] : undefined;
    if (typeof value !== "string" || !value.trim() || !isAbsolute(value.trim())) {
      throw new Error(`${field} 需要绝对路径。`);
    }
    return resolve(value.trim());
  }

  protected result(request: ToolRequest, value: unknown, displayText: string, isError = false): ToolResult {
    return { toolId: request.id, text: JSON.stringify(value), data: value, displayText, isError };
  }
}

class GenericFileReadTool extends GenericFileToolBase implements ToolExecutor {
  readonly name = "file.read";
  readonly description = "读取绝对路径的 UTF-8 文本。局部修改用 startLine/lineCount 只读相关行；截断时用 nextOffset 作为 offset 续读。SQLite 数据库用 file.sqlite.inspect/query，DOCX 用 file.docx.inspect；本工具不能解析二进制文档。";
  readonly readOnly = true;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      path: { type: "string" as const },
      startLine: { type: "number" as const, minimum: 1, description: "从第几行开始，正整数，默认 1。" },
      lineCount: { type: "number" as const, minimum: 1, description: "本次需要的行数，正整数，例如 80。" },
      offset: { type: "number" as const, minimum: 0, description: "使用上次回执的 nextOffset 续读，优先于 startLine。" },
      maxChars: { type: "number" as const, minimum: 1 },
    },
    required: ["path"],
    additionalProperties: false,
  };

  async execute(request: ToolRequest, _context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const path = this.path(request.input);
      const input = request.input as Record<string, unknown>;
      const buffer = await readFile(path);
      if (/^\.(pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|webp|zip)$/iu.test(extname(path)) || buffer.includes(0)) {
        return this.result(request, { ok: false, path, error: "TEXT_FILE_REQUIRED" }, "此文件不是纯文本，请使用对应文档、图片工具或本机解析程序。", true);
      }
      const source = buffer.toString("utf8");
      const lineStarts = [0, ...Array.from(source.matchAll(/\n/gu), (match) => match.index! + 1)];
      const totalLines = source.length ? lineStarts.length - (source.endsWith("\n") ? 1 : 0) : 0;
      const requestedLine = integer(input.startLine, 1, 1);
      const offset = input.offset === undefined ? lineStarts[requestedLine - 1] ?? source.length : Math.min(source.length, integer(input.offset, 0, 0));
      const startLine = lineStarts.filter((start) => start <= offset).length;
      const end = input.lineCount === undefined ? source.length : lineStarts[startLine - 1 + integer(input.lineCount, 1, 1)] ?? source.length;
      const maxChars = Math.min(200_000, integer(input.maxChars, 40_000, 1));
      let nextOffset = Math.min(end, offset + maxChars);
      // Keep a UTF-16 surrogate pair together at the chunk boundary.
      if (nextOffset < end && /[\uD800-\uDBFF]/u.test(source[nextOffset - 1] ?? "")) nextOffset += 1;
      const content = source.slice(offset, nextOffset);
      const truncated = nextOffset < source.length;
      return this.result(request, {
        ok: true, path, content, startLine, totalLines, offset, truncated,
        ...(truncated ? { nextOffset } : {}),
      }, `已读取 ${path}（从第 ${startLine} 行，${content.length} 字符${truncated ? "，后续可续读" : ""}）。`);
    } catch (error) {
      return this.result(request, { ok: false, error: errorMessage(error) }, errorMessage(error), true);
    }
  }
}

class GenericFileListTool extends GenericFileToolBase implements ToolExecutor {
  readonly name = "file.list";
  readonly description = "列出指定绝对目录下的文件与子目录名称，不读取文件内容。";
  readonly readOnly = true;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      path: { type: "string" as const, description: "要列出的绝对目录路径。" },
      includeHidden: { type: "boolean" as const },
      maxEntries: { type: "number" as const },
    },
    required: ["path"],
    additionalProperties: false,
  };

  async execute(request: ToolRequest, _context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const input = request.input as Record<string, unknown>;
      const path = this.path(input);
      const includeHidden = input.includeHidden === true;
      const maxEntries = Math.max(1, Math.min(2_000, Number(input.maxEntries ?? 500)));
      const entries = (await readdir(path, { withFileTypes: true }))
        .filter((entry) => includeHidden || !entry.name.startsWith("."))
        .sort((left, right) => left.name.localeCompare(right.name, "en"))
        .slice(0, maxEntries)
        .map((entry) => ({ name: entry.name, type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other" }));
      return this.result(request, { ok: true, path, entries, truncated: entries.length >= maxEntries }, `已列出 ${path}（${entries.length} 项）。`);
    } catch (error) {
      return this.result(request, { ok: false, error: errorMessage(error) }, errorMessage(error), true);
    }
  }
}

class GenericFileWriteTool extends GenericFileToolBase implements ToolExecutor {
  readonly name = "file.write";
  readonly description = "创建或替换指定绝对路径的 UTF-8 文本文件。";
  readonly readOnly = false;
  readonly inputSchema = {
    type: "object" as const,
    properties: { path: { type: "string" as const }, content: { type: "string" as const }, mode: { type: "string" as const, enum: ["create", "replace"] } },
    required: ["path", "content"],
    additionalProperties: false,
  };

  async execute(request: ToolRequest, _context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const input = request.input as Record<string, unknown>;
      const path = this.path(input);
      if (needsStructuredTool(path)) return this.result(request, { ok: false, path, error: "STRUCTURED_FILE_REQUIRED" }, "此文件需要文档、图片或数据库工具，不能用纯文本覆盖。", true);
      const content = typeof input.content === "string" ? input.content : "";
      const mode = input.mode === "replace" ? "replace" : "create";
      if (mode === "create") {
        try { await stat(path); return this.result(request, { ok: false, path, error: "PATH_ALREADY_EXISTS" }, "目标文件已存在。", true); } catch { /* create path */ }
      }
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, { encoding: "utf8" });
      return this.result(request, { ok: true, path, bytes: Buffer.byteLength(content, "utf8"), mode }, `已写入 ${path}。`);
    } catch (error) {
      return this.result(request, { ok: false, error: errorMessage(error) }, errorMessage(error), true);
    }
  }
}

class GenericFileEditTool extends GenericFileToolBase implements ToolExecutor {
  readonly name = "file.edit";
  readonly description = "按明确 oldText/newText 编辑指定绝对路径的 UTF-8 文本文件。";
  readonly readOnly = false;
  readonly inputSchema = {
    type: "object" as const,
    properties: { path: { type: "string" as const }, oldText: { type: "string" as const }, newText: { type: "string" as const }, expectedMatches: { type: "number" as const } },
    required: ["path", "oldText", "newText"],
    additionalProperties: false,
  };

  async execute(request: ToolRequest, _context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const input = request.input as Record<string, unknown>;
      const path = this.path(input);
      if (needsStructuredTool(path)) return this.result(request, { ok: false, path, error: "STRUCTURED_FILE_REQUIRED" }, "此文件需要专用工具，不能按纯文本替换。", true);
      const oldText = String(input.oldText ?? "");
      const newText = String(input.newText ?? "");
      const source = await readFile(path, "utf8");
      const matches = oldText ? source.split(oldText).length - 1 : 0;
      const expected = Number.isInteger(input.expectedMatches) ? Number(input.expectedMatches) : 1;
      if (!oldText || matches !== expected) return this.result(request, { ok: false, path, matches, error: "EDIT_CONFLICT" }, "编辑匹配数不符，未写入。", true);
      await writeFile(path, source.split(oldText).join(newText), "utf8");
      return this.result(request, { ok: true, path, matches }, `已编辑 ${path}。`);
    } catch (error) {
      return this.result(request, { ok: false, error: errorMessage(error) }, errorMessage(error), true);
    }
  }
}

class GenericFileMoveTool extends GenericFileToolBase implements ToolExecutor {
  readonly name = "file.move";
  readonly description = "移动指定绝对路径的文件。";
  readonly readOnly = false;
  readonly inputSchema = {
    type: "object" as const,
    properties: { sourcePath: { type: "string" as const }, targetPath: { type: "string" as const } },
    required: ["sourcePath", "targetPath"],
    additionalProperties: false,
  };

  async execute(request: ToolRequest, _context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const input = request.input as Record<string, unknown>;
      const sourcePath = this.path(input, "sourcePath");
      const targetPath = this.path(input, "targetPath");
      await mkdir(dirname(targetPath), { recursive: true });
      await rename(sourcePath, targetPath);
      return this.result(request, { ok: true, sourcePath, targetPath }, `已移动文件到 ${targetPath}。`);
    } catch (error) {
      return this.result(request, { ok: false, error: errorMessage(error) }, errorMessage(error), true);
    }
  }
}

class GenericFileDeleteTool extends GenericFileToolBase implements ToolExecutor {
  readonly name = "file.delete";
  readonly description = "可恢复地删除指定绝对路径文件；回执可用于恢复。";
  readonly readOnly = false;
  readonly inputSchema = {
    type: "object" as const,
    properties: { path: { type: "string" as const } },
    required: ["path"],
    additionalProperties: false,
  };

  constructor(private readonly recoveryRoot?: string) { super(); }

  async execute(request: ToolRequest, _context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const path = this.path(request.input);
      if (!this.recoveryRoot) return this.result(request, { ok: false, path, error: "RECOVERY_UNAVAILABLE" }, "当前会话没有可恢复删除目录。", true);
      const receiptId = `file-recovery-${randomUUID()}`;
      const target = resolve(this.recoveryRoot, receiptId, path.split(/[\\/]/u).pop() || "file");
      await mkdir(dirname(target), { recursive: true });
      await rename(path, target);
      return this.result(request, { ok: true, path, receiptId, recoveryPath: target }, `已可恢复删除 ${path}。`);
    } catch (error) {
      return this.result(request, { ok: false, error: errorMessage(error) }, errorMessage(error), true);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function integer(value: unknown, fallback: number, minimum: number): number {
  return Number.isInteger(value) && Number(value) >= minimum ? Number(value) : fallback;
}

function needsStructuredTool(path: string): boolean {
  return /^\.(docx?|xlsx?|pptx?|pdf|sqlite3?|db|png|jpe?g|webp|gif|zip)$/iu.test(extname(path));
}
