import { ToolRequest } from "../../core/contracts";
import { ToolExecutionContext, ToolExecutor, ToolResult } from "../tools/tool-registry";
import { GitService } from "./contracts";
import { WorkspaceService } from "../workspaces/workspace-service";

export function createGitTools(git: GitService, workspaces: WorkspaceService): ToolExecutor[] {
  return [
    new GitStatusTool(git),
    new GitDiffTool(git),
    new GitLogTool(git),
    new GitBranchTool(git),
    new GitCommitTool(workspaces),
    new GitMergeTool(workspaces),
  ];
}

class GitStatusTool implements ToolExecutor {
  readonly name = "git.status";
  readonly description = "读取当前项目的结构化 Git 状态；只读。";
  readonly readOnly = true;
  readonly authorizationScope = "project" as const;
  readonly inputSchema = { type: "object" as const, properties: {}, additionalProperties: false };
  constructor(private readonly git: GitService) {}
  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    if (!context.projectRoot) return denied(request, "当前运行没有显式项目。", "PROJECT_NOT_ENABLED");
    const result = await this.git.status(context.projectRoot);
    return resultFor(request, modelSafe(result), !result.ok);
  }
}

class GitDiffTool implements ToolExecutor {
  readonly name = "git.diff";
  readonly description = "读取有界 Git 差异，并保留可续读的本地受管差异 artifact。";
  readonly readOnly = true;
  readonly authorizationScope = "project" as const;
  readonly inputSchema = {
    type: "object" as const,
    properties: { maxChars: { type: "number" as const }, cursor: { type: "number" as const } },
    additionalProperties: false,
  };
  constructor(private readonly git: GitService) {}
  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    if (!context.projectRoot) return denied(request, "当前运行没有显式项目。", "PROJECT_NOT_ENABLED");
    const input = request.input ?? {};
    const result = await this.git.diff(context.projectRoot, {
      maxChars: typeof input.maxChars === "number" ? input.maxChars : undefined,
      cursor: typeof input.cursor === "number" ? input.cursor : undefined,
    });
    return resultFor(request, modelSafe(result), !result.ok, result.ok ? `Git 差异已读取，共 ${result.files.length} 个文件。` : result.error);
  }
}

class GitLogTool implements ToolExecutor {
  readonly name = "git.log";
  readonly description = "读取时间、作者和主题组成的结构化 Git 历史；不展示提交标识。";
  readonly readOnly = true;
  readonly authorizationScope = "project" as const;
  readonly inputSchema = { type: "object" as const, properties: { limit: { type: "number" as const } }, additionalProperties: false };
  constructor(private readonly git: GitService) {}
  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    if (!context.projectRoot) return denied(request, "当前运行没有显式项目。", "PROJECT_NOT_ENABLED");
    const value = request.input?.limit;
    const result = await this.git.log(context.projectRoot, typeof value === "number" ? value : undefined);
    return resultFor(request, result, !result.ok);
  }
}

class GitBranchTool implements ToolExecutor {
  readonly name = "git.branch.create";
  readonly description = "创建受管任务分支；需要本次项目权限批准。";
  readonly readOnly = false;
  readonly authorizationScope = "project" as const;
  readonly inputSchema = {
    type: "object" as const,
    properties: { name: { type: "string" as const }, base: { type: "string" as const } },
    required: ["name"], additionalProperties: false,
  };
  constructor(private readonly git: GitService) {}
  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    if (!context.projectRoot) return denied(request, "当前运行没有显式项目。", "PROJECT_NOT_ENABLED");
    const result = await this.git.createBranch(context.projectRoot, stringInput(request, "name") ?? "", stringInput(request, "base") ?? "HEAD");
    return resultFor(request, result, !result.ok);
  }
}

class GitCommitTool implements ToolExecutor {
  readonly name = "git.commit";
  readonly description = "提交本 run 已证明拥有的路径；共享工作区需要用户显式提交意图。";
  readonly readOnly = false;
  readonly authorizationScope = "project" as const;
  readonly inputSchema = {
    type: "object" as const,
    properties: { paths: { type: "array" as const, items: { type: "string" as const } }, message: { type: "string" as const } },
    required: ["message"], additionalProperties: false,
  };
  constructor(private readonly workspaces: WorkspaceService) {}
  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    if (!context.workspaceId) return denied(request, "当前运行没有工作区回执。", "WORKSPACE_NOT_PREPARED");
    const record = this.workspaces.snapshot(context.workspaceId);
    if (!record) return denied(request, "工作区回执不存在。", "WORKSPACE_NOT_FOUND");
    if (record.mode === "shared" && !context.commitRequested) return denied(request, "共享工作区提交必须由用户显式请求。", "SHARED_COMMIT_NOT_REQUESTED");
    if (record.mode === "shared") await this.workspaces.requestSharedCommit(record.id);
    const inputPaths = Array.isArray(request.input?.paths) ? request.input?.paths.filter((item): item is string => typeof item === "string") : undefined;
    const ok = record.mode === "isolated"
      ? await this.workspaces.commitIsolated(record.id, stringInput(request, "message") ?? "", inputPaths)
      : await this.workspaces.commitShared(record.id, stringInput(request, "message") ?? "", inputPaths);
    return resultFor(request, { ok, status: ok ? "committed" : "rejected" }, !ok);
  }
}

class GitMergeTool implements ToolExecutor {
  readonly name = "git.merge";
  readonly description = "显式合并已通过检查与审查的隔离工作区；冲突现场会保留。";
  readonly readOnly = false;
  readonly authorizationScope = "project" as const;
  readonly inputSchema = { type: "object" as const, properties: {}, additionalProperties: false };
  constructor(private readonly workspaces: WorkspaceService) {}
  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    if (!context.workspaceId) return denied(request, "当前运行没有工作区回执。", "WORKSPACE_NOT_PREPARED");
    const ok = await this.workspaces.merge(context.workspaceId);
    return resultFor(request, { ok, status: ok ? "merged" : "retained" }, !ok);
  }
}

function resultFor(request: ToolRequest, data: unknown, isError: boolean, displayText?: string): ToolResult {
  return { toolId: request.id, text: JSON.stringify(data), data, displayText: displayText ?? JSON.stringify(data), isError };
}

function denied(request: ToolRequest, message: string, code: string): ToolResult {
  return resultFor(request, { ok: false, error: { code, message } }, true, message);
}

function stringInput(request: ToolRequest, key: string): string | undefined {
  return typeof request.input?.[key] === "string" ? request.input[key] as string : undefined;
}

function modelSafe(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const candidate = value as Record<string, unknown>;
  const { artifactPath: _artifactPath, ...rest } = candidate;
  return rest;
}
