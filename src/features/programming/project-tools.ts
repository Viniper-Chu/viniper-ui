import { resolve } from "node:path";
import { ProjectToolPresentation, ToolRequest } from "../../core/contracts";
import { ToolExecutionContext, ToolExecutor, ToolResult } from "../tools/tool-registry";
import { ToolResourceClaim } from "../tools/resource-lock";
import {
  ProjectChangeResult,
  ProjectDeleteInput,
  ProjectDiffInput,
  ProjectDiffResult,
  ProjectEditInput,
  ProjectFilesystem,
  ProjectListInput,
  ProjectListResult,
  ProjectMoveInput,
  ProjectReadInput,
  ProjectReadResult,
  ProjectSearchInput,
  ProjectSearchResult,
  ProjectWriteInput,
} from "./contracts";

export function createProgrammingTools(filesystem: ProjectFilesystem): ToolExecutor[] {
  return [
    new ProjectListTool(filesystem),
    new ProjectSearchTool(filesystem),
    new ProjectReadTool(filesystem),
    new ProjectWriteTool(filesystem),
    new ProjectEditTool(filesystem),
    new ProjectMoveTool(filesystem),
    new ProjectDeleteTool(filesystem),
    new ProjectDiffTool(filesystem),
  ];
}

abstract class ProjectToolBase {
  readonly authorizationScope = "project" as const;

  protected claim(context: ToolExecutionContext, path: string | undefined, access: "read" | "write"): ToolResourceClaim[] {
    if (!context.projectRoot) return [];
    return [{ key: resolve(context.projectRoot, path?.trim() || "."), access }];
  }
}

class ProjectListTool extends ProjectToolBase implements ToolExecutor {
  readonly name = "project.list";
  readonly description = "列出当前项目内指定相对目录的直接子项。";
  readonly readOnly = true;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      path: { type: "string" as const, description: "项目内相对目录；省略表示项目根。" },
      limit: { type: "number" as const, description: "最多返回条目数，默认 100，最高 500。" },
    },
    additionalProperties: false,
  };

  constructor(private readonly filesystem: ProjectFilesystem) { super(); }
  resourceClaims(request: ToolRequest, context: ToolExecutionContext): ToolResourceClaim[] {
    return this.claim(context, stringInput(request, "path"), "read");
  }
  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    if (!context.projectRoot) return projectNotEnabled(request);
    const result = await this.filesystem.list(context.projectRoot, (request.input ?? {}) as ProjectListInput, context.signal);
    return toolResult(request, result, result.ok
      ? `已列出 ${result.path} 的 ${result.entries.length} 个直接子项${result.truncated ? "，结果已按上限截断" : ""}。`
      : result.error?.message ?? "目录未能列出。");
  }
}

class ProjectSearchTool extends ProjectToolBase implements ToolExecutor {
  readonly name = "project.search";
  readonly description = "在当前项目内实时搜索路径和文本内容。";
  readonly readOnly = true;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      query: { type: "string" as const, description: "要匹配的路径或正文文本。" },
      path: { type: "string" as const, description: "可选的项目内相对搜索范围。" },
      maxResults: { type: "number" as const, description: "最多返回结果数，默认 50，最高 100。" },
    },
    required: ["query"],
    additionalProperties: false,
  };

  constructor(private readonly filesystem: ProjectFilesystem) { super(); }
  resourceClaims(request: ToolRequest, context: ToolExecutionContext): ToolResourceClaim[] {
    return this.claim(context, stringInput(request, "path"), "read");
  }
  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    if (!context.projectRoot) return projectNotEnabled(request);
    const result = await this.filesystem.search(context.projectRoot, request.input as unknown as ProjectSearchInput, context.signal);
    return toolResult(request, result, result.ok
      ? `已在 ${result.path} 实时搜索“${result.query}”，找到 ${result.results.length} 条路径/正文结果${result.truncated ? "，结果已截断" : ""}。`
      : result.error?.message ?? "项目搜索未完成。");
  }
}

class ProjectReadTool extends ProjectToolBase implements ToolExecutor {
  readonly name = "project.read";
  readonly description = "按可选行范围读取当前项目内的 UTF-8 文本文件。";
  readonly readOnly = true;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      path: { type: "string" as const, description: "项目内相对文件路径。" },
      startLine: { type: "number" as const, description: "可选起始行，行号从 1 开始。" },
      endLine: { type: "number" as const, description: "可选结束行，包含该行。" },
    },
    required: ["path"],
    additionalProperties: false,
  };

  constructor(private readonly filesystem: ProjectFilesystem) { super(); }
  resourceClaims(request: ToolRequest, context: ToolExecutionContext): ToolResourceClaim[] {
    return this.claim(context, stringInput(request, "path"), "read");
  }
  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    if (!context.projectRoot) return projectNotEnabled(request);
    const result = await this.filesystem.read(context.projectRoot, request.input as unknown as ProjectReadInput, context.signal);
    const range = result.range ? `第 ${result.range.startLine}–${result.range.endLine} 行` : "";
    return toolResult(request, result, result.ok
      ? `已读取 ${result.path} ${range}${result.truncated ? "，内容已按上限截断" : ""}。`
      : result.error?.message ?? "文件未能读取。");
  }
}

class ProjectWriteTool extends ProjectToolBase implements ToolExecutor {
  readonly name = "project.write";
  readonly description = "原子创建或明确替换当前项目内的 UTF-8 文本文件。";
  readonly readOnly = false;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      path: { type: "string" as const, description: "项目内相对文件路径。" },
      content: { type: "string" as const, description: "完整 UTF-8 文本内容。" },
      mode: { type: "string" as const, description: "create（默认，不覆盖）或 replace（仅替换现有文件）。" },
    },
    required: ["path", "content"],
    additionalProperties: false,
  };

  constructor(private readonly filesystem: ProjectFilesystem) { super(); }
  resourceClaims(request: ToolRequest, context: ToolExecutionContext): ToolResourceClaim[] {
    return this.claim(context, stringInput(request, "path"), "write");
  }
  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    if (!context.projectRoot) return projectNotEnabled(request);
    const result = await this.filesystem.write(
      context.projectRoot,
      request.input as unknown as ProjectWriteInput,
      mutationContext(context),
      context.signal,
    );
    return changeToolResult(request, result, result.ok
      ? `${result.action === "create" ? "已创建" : "已原子替换"} ${result.paths[0]}。`
      : result.error?.message ?? "文件写入未完成。");
  }
}

class ProjectEditTool extends ProjectToolBase implements ToolExecutor {
  readonly name = "project.edit";
  readonly description = "校验全部精确旧文本后，一次原子提交一个或多个局部替换。";
  readonly readOnly = false;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      path: { type: "string" as const, description: "项目内相对文件路径。" },
      edits: { type: "array" as const, description: "oldText/newText/expectedMatches 组成的替换清单。" },
    },
    required: ["path", "edits"],
    additionalProperties: false,
  };

  constructor(private readonly filesystem: ProjectFilesystem) { super(); }
  resourceClaims(request: ToolRequest, context: ToolExecutionContext): ToolResourceClaim[] {
    return this.claim(context, stringInput(request, "path"), "write");
  }
  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    if (!context.projectRoot) return projectNotEnabled(request);
    const result = await this.filesystem.edit(
      context.projectRoot,
      request.input as unknown as ProjectEditInput,
      mutationContext(context),
      context.signal,
    );
    return changeToolResult(request, result, result.ok
      ? `已原子编辑 ${result.paths[0]}。`
      : result.error?.message ?? "精确编辑未完成。");
  }
}

class ProjectMoveTool extends ProjectToolBase implements ToolExecutor {
  readonly name = "project.move";
  readonly description = "在当前项目内移动或重命名一个文件或目录，默认不覆盖目标。";
  readonly readOnly = false;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      sourcePath: { type: "string" as const, description: "项目内源相对路径。" },
      targetPath: { type: "string" as const, description: "项目内目标相对路径。" },
    },
    required: ["sourcePath", "targetPath"],
    additionalProperties: false,
  };

  constructor(private readonly filesystem: ProjectFilesystem) { super(); }
  resourceClaims(request: ToolRequest, context: ToolExecutionContext): ToolResourceClaim[] {
    return [
      ...this.claim(context, stringInput(request, "sourcePath"), "write"),
      ...this.claim(context, stringInput(request, "targetPath"), "write"),
    ];
  }
  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    if (!context.projectRoot) return projectNotEnabled(request);
    const result = await this.filesystem.move(
      context.projectRoot,
      request.input as unknown as ProjectMoveInput,
      mutationContext(context),
      context.signal,
    );
    return changeToolResult(request, result, result.ok
      ? `已将 ${result.paths[0]} 移动到 ${result.paths[1]}，未覆盖既有目标。`
      : result.error?.message ?? "移动未完成。");
  }
}

class ProjectDeleteTool extends ProjectToolBase implements ToolExecutor {
  readonly name = "project.delete";
  readonly description = "将当前项目内的明确路径移入本次 run 的可恢复区，并返回恢复回执。";
  readonly readOnly = false;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      path: { type: "string" as const, description: "项目内要移入可恢复区的相对路径。" },
    },
    required: ["path"],
    additionalProperties: false,
  };

  constructor(private readonly filesystem: ProjectFilesystem) { super(); }
  resourceClaims(request: ToolRequest, context: ToolExecutionContext): ToolResourceClaim[] {
    return this.claim(context, stringInput(request, "path"), "write");
  }
  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    if (!context.projectRoot) return projectNotEnabled(request);
    const result = await this.filesystem.delete(
      context.projectRoot,
      request.input as unknown as ProjectDeleteInput,
      mutationContext(context),
      context.signal,
    );
    return changeToolResult(request, result, result.ok
      ? `已将 ${result.paths[0]} 移入可恢复区；恢复回执 ${result.recovery?.receiptId}。`
      : result.error?.message ?? "可恢复删除未完成。");
  }
}

class ProjectDiffTool extends ProjectToolBase implements ToolExecutor {
  readonly name = "project.diff";
  readonly description = "读取本 run 的结构化文件差异，或按不透明 artifactId 继续读取有界 patch。";
  readonly readOnly = true;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      path: { type: "string" as const, description: "可选项目内相对路径筛选。" },
      artifactId: { type: "string" as const, description: "可选的不透明完整差异引用。" },
      cursor: { type: "number" as const, description: "继续读取时的字符游标。" },
      maxChars: { type: "number" as const, description: "本次最多返回字符数，最高 12000。" },
    },
    additionalProperties: false,
  };

  constructor(private readonly filesystem: ProjectFilesystem) { super(); }
  resourceClaims(_request: ToolRequest, context: ToolExecutionContext): ToolResourceClaim[] {
    return this.claim(context, ".", "read");
  }
  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    if (!context.projectRoot) return projectNotEnabled(request);
    const result = await this.filesystem.diff(
      context.projectRoot,
      (request.input ?? {}) as ProjectDiffInput,
      mutationContext(context),
      context.signal,
    );
    const display = result.ok
      ? `已读取 ${result.artifacts.length} 项本 run 文件差异${result.diff?.truncated ? "，patch 已按上限截断，可继续读取" : ""}。`
      : result.error?.message ?? "差异未能读取。";
    return {
      toolId: request.id,
      text: JSON.stringify(projectForModel(result)),
      displayText: display,
      data: result,
      ...(result.ok ? { presentation: diffPresentation(result, display) } : {}),
      isError: !result.ok,
    };
  }
}

function mutationContext(context: ToolExecutionContext) {
  return { sessionId: context.sessionId, runId: context.runId };
}

function toolResult(
  request: ToolRequest,
  data: ProjectListResult | ProjectSearchResult | ProjectReadResult,
  displayText: string,
): ToolResult {
  return {
    toolId: request.id,
    text: JSON.stringify(projectForModel(data)),
    displayText,
    data,
    isError: !data.ok,
  };
}

function changeToolResult(request: ToolRequest, data: ProjectChangeResult, displayText: string): ToolResult {
  return {
    toolId: request.id,
    text: JSON.stringify(projectForModel(data)),
    displayText,
    data,
    ...(data.ok ? { presentation: changePresentation(data, displayText) } : {}),
    isError: !data.ok,
  };
}

export function changePresentation(result: ProjectChangeResult, summary: string): ProjectToolPresentation {
  return {
    kind: result.action === "restore" ? "project-restore" : "project-change",
    action: result.action,
    paths: [...result.paths],
    summary,
    beforeBytes: result.beforeBytes,
    afterBytes: result.afterBytes,
    ...(result.diff ? {
      patch: result.diff.patch,
      patchTruncated: result.diff.truncated,
      artifactId: result.diff.artifactId,
      nextCursor: result.diff.nextCursor,
    } : {}),
    ...(result.recovery ? {
      recoveryReceiptId: result.recovery.receiptId,
      recoveryStatus: result.recovery.status,
    } : {}),
  };
}

function diffPresentation(result: ProjectDiffResult, summary: string): ProjectToolPresentation {
  return {
    kind: "project-diff",
    action: "diff",
    paths: [...result.paths],
    summary,
    beforeBytes: result.beforeBytes,
    afterBytes: result.afterBytes,
    ...(result.diff ? {
      patch: result.diff.patch,
      patchTruncated: result.diff.truncated,
      artifactId: result.diff.artifactId,
      nextCursor: result.diff.nextCursor,
    } : {}),
  };
}

function projectForModel(data: ProjectListResult | ProjectSearchResult | ProjectReadResult | ProjectChangeResult | ProjectDiffResult): unknown {
  const candidate = data as typeof data & { projectRoot?: string };
  const { projectRoot: _internalProjectRoot, error, ...safeData } = candidate;
  return {
    ...safeData,
    ...(error ? { error: { code: error.code, message: error.message } } : {}),
  };
}

function projectNotEnabled(request: ToolRequest): ToolResult {
  const message = "本次运行没有显式打开项目；project.* 未执行。";
  return {
    toolId: request.id,
    text: JSON.stringify({ ok: false, error: { code: "PROJECT_NOT_ENABLED", message } }),
    displayText: message,
    isError: true,
  };
}

function stringInput(request: ToolRequest, key: string): string | undefined {
  const value = request.input?.[key];
  return typeof value === "string" ? value : undefined;
}
