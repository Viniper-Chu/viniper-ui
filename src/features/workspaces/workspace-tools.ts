import { ToolRequest } from "../../core/contracts";
import { ToolExecutionContext, ToolExecutor, ToolResult } from "../tools/tool-registry";
import { WorkspaceService } from "./workspace-service";

export function createWorkspaceTools(workspaces: WorkspaceService): ToolExecutor[] {
  return [new WorkspaceStatusTool(workspaces)];
}

class WorkspaceStatusTool implements ToolExecutor {
  readonly name = "workspace.status";
  readonly description = "读取当前工作区模式、状态、检查和审查回执；路径仅以相对项目路径投影。";
  readonly readOnly = true;
  readonly authorizationScope = "project" as const;
  readonly inputSchema = { type: "object" as const, properties: {}, additionalProperties: false };
  constructor(private readonly workspaces: WorkspaceService) {}
  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    if (!context.workspaceId) return denied(request, "当前运行没有工作区回执。", "WORKSPACE_NOT_PREPARED");
    const record = this.workspaces.snapshot(context.workspaceId);
    if (!record) return denied(request, "工作区回执不存在。", "WORKSPACE_NOT_FOUND");
    const safe = {
      id: record.id,
      mode: record.mode,
      status: record.status,
      branchName: record.branchName,
      ownedPaths: record.ownedPaths,
      checksPassed: record.checksPassed,
      reviewOutcome: record.reviewOutcome,
      mergeStatus: record.mergeStatus,
      recoveryUntil: record.recoveryUntil,
      reason: record.reason,
    };
    return { toolId: request.id, text: JSON.stringify(safe), data: safe, displayText: `工作区状态：${record.status}。` };
  }
}

function denied(request: ToolRequest, message: string, code: string): ToolResult {
  const data = { ok: false, error: { code, message } };
  return { toolId: request.id, text: JSON.stringify(data), data, displayText: message, isError: true };
}
