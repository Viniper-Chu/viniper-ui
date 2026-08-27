import { resolve } from "node:path";
import { TerminalToolPresentation, ToolRequest } from "../../core/contracts";
import { ToolExecutionContext, ToolExecutor, ToolResult } from "../tools/tool-registry";
import { ToolResourceClaim } from "../tools/resource-lock";
import { TerminalOutputInput, TerminalOutputResult, TerminalRunInput, TerminalRunResult } from "./contracts";
import { TerminalService } from "./terminal-service";

export function createTerminalTools(service: TerminalService): ToolExecutor[] {
  return [new TerminalRunTool(service), new TerminalOutputTool(service)];
}

class TerminalRunTool implements ToolExecutor {
  readonly name = "terminal.run";
  readonly description = "在当前显式项目中运行受控 PowerShell 命令，并保留可续读的 stdout/stderr。";
  readonly readOnly = false;
  readonly authorizationScope = "project" as const;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      command: { type: "string" as const, description: "要在 Windows PowerShell 中运行的本机命令。" },
      cwd: { type: "string" as const, description: "可选的项目内相对工作目录；默认项目根。" },
      timeoutMs: { type: "number" as const, description: "可解释超时，默认 120000 毫秒，范围 100–1800000。" },
      purpose: { type: "string" as const, description: "command/dependency/build/test/lint/typecheck 之一。" },
    },
    required: ["command"],
    additionalProperties: false,
  };

  constructor(private readonly service: TerminalService) {}

  resourceClaims(_request: ToolRequest, context: ToolExecutionContext): ToolResourceClaim[] {
    return context.projectRoot ? [{ key: resolve(context.projectRoot), access: "write" }] : [];
  }

  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    const result = await this.service.run(request.input as unknown as TerminalRunInput, context);
    const displayText = terminalRunSummary(result);
    return {
      toolId: request.id,
      text: JSON.stringify(result),
      data: result,
      displayText,
      presentation: terminalRunPresentation(result, displayText),
      isError: !result.ok,
      cancelled: result.status === "cancelled",
    };
  }
}

class TerminalOutputTool implements ToolExecutor {
  readonly name = "terminal.output";
  readonly description = "按不透明 executionId 续读本次 run 拥有的 stdout 或 stderr 有界范围。";
  readonly readOnly = true;
  readonly authorizationScope = "project" as const;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      executionId: { type: "string" as const, description: "terminal.run 返回的不透明执行标识。" },
      stream: { type: "string" as const, description: "stdout 或 stderr。" },
      offset: { type: "number" as const, description: "从 0 开始的字节偏移。" },
      maxBytes: { type: "number" as const, description: "本次最多读取字节数，默认 8192，最高 65536。" },
    },
    required: ["executionId", "stream"],
    additionalProperties: false,
  };

  constructor(private readonly service: TerminalService) {}

  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    const result = await this.service.output(request.input as unknown as TerminalOutputInput, context);
    const displayText = terminalOutputSummary(result);
    return {
      toolId: request.id,
      text: JSON.stringify(result),
      data: result,
      displayText,
      presentation: terminalOutputPresentation(result, displayText),
      isError: !result.ok,
    };
  }
}

function terminalRunSummary(result: TerminalRunResult): string {
  switch (result.status) {
    case "completed": return `终端命令已完成，退出码 0；stdout ${result.stdout.totalBytes} 字节，stderr ${result.stderr.totalBytes} 字节。`;
    case "nonzero": return `终端命令以非零退出码 ${result.exitCode ?? "未知"} 结束。`;
    case "not-found": return "终端命令不存在，未混同为普通非零退出。";
    case "timed-out": return `终端命令在 ${result.timeoutMs} 毫秒后超时，所属进程树已终止。`;
    case "cancelled": return "终端命令已由当前 run 取消，所属进程树已终止。";
    case "failed": return result.error?.message ?? "终端命令未能启动。";
  }
}

function terminalOutputSummary(result: TerminalOutputResult): string {
  if (!result.ok) return result.error?.message ?? "终端输出未能读取。";
  return `已读取 ${result.stream} 第 ${result.offset}–${result.offset + result.bytes} 字节${result.truncated ? "，仍有后续输出" : "，已到当前末尾"}。`;
}

function terminalRunPresentation(result: TerminalRunResult, summary: string): TerminalToolPresentation {
  return {
    kind: "terminal-run",
    executionId: result.executionId,
    status: result.status,
    purpose: result.purpose,
    summary,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    cwd: result.cwd,
    stdout: { ...result.stdout },
    stderr: { ...result.stderr },
    ...(result.processIdentity ? { processIdentity: { ...result.processIdentity } } : {}),
  };
}

function terminalOutputPresentation(result: TerminalOutputResult, summary: string): TerminalToolPresentation {
  return {
    kind: "terminal-output",
    executionId: result.executionId,
    status: result.status,
    summary,
    exitCode: null,
    durationMs: 0,
    stream: result.stream,
    offset: result.offset,
    bytes: result.bytes,
    totalBytes: result.totalBytes,
    nextOffset: result.nextOffset,
    outputText: result.text,
  };
}
