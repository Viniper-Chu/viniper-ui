import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
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
  readonly description = "读取指定绝对路径的 UTF-8 文本文件。";
  readonly readOnly = true;
  readonly inputSchema = {
    type: "object" as const,
    properties: { path: { type: "string" as const }, maxChars: { type: "number" as const } },
    required: ["path"],
    additionalProperties: false,
  };

  async execute(request: ToolRequest, _context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const path = this.path(request.input);
      const maxChars = Math.max(1, Math.min(200_000, Number((request.input as Record<string, unknown>)?.maxChars ?? 40_000)));
      const content = (await readFile(path, "utf8")).slice(0, maxChars);
      return this.result(request, { ok: true, path, content, truncated: content.length >= maxChars }, `已读取 ${path}。`);
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
