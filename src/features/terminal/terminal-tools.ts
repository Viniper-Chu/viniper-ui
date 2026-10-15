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
  readonly description = process.platform === "win32"
    ? "在当前项目中运行 PowerShell 7 脚本，保留可续读的输出。"
    : `在当前项目中运行 ${process.platform === "darwin" ? "zsh" : "POSIX shell"} 脚本，保留可续读的输出。`;
  readonly readOnly = false;
  readonly authorizationScope = "project" as const;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      command: { type: "string" as const, description: process.platform === "win32" ? "直接提供 PowerShell 7 脚本；宿主已是 pwsh，不要再包一层 pwsh / powershell -Command，以免变量提前展开。The host is already PowerShell 7; pass the script directly." : "直接提供当前系统 shell 脚本（macOS 为 zsh）；使用 POSIX 路径和命令。无需再次包装 shell -c；不会加载用户启动脚本。" },
      cwd: { type: "string" as const, description: "可选的项目内相对工作目录；默认项目根。" },
      timeoutMs: { type: "number" as const, description: "可解释超时，默认 120000 毫秒，范围 100–1800000。" },
      purpose: { type: "string" as const, enum: ["command", "dependency", "build", "test", "lint", "typecheck"], description: "command/dependency/build/test/lint/typecheck 之一。" },
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
    const captureFailure = result.status === "nonzero"
      && /(?:^|[\s/;|&])screencapture(?:\s|$)/u.test(String(request.input?.command ?? ""))
      && /could not create image from display/iu.test(`${result.stdout.preview}\n${result.stderr.preview}`);
    const hint = captureFailure ? "macOS 未生成截图。可能是屏幕录制权限或当前显示会话不可捕获；该错误不能确定具体原因。条件未改变时不要反复换路径、安装组件或重复截图，不可声称已截图或发送。" : undefined;
    const displayText = hint ?? terminalRunSummary(result);
    return {
      toolId: request.id,
      text: JSON.stringify({ ...result, ...(hint ? { hint } : {}) }),
      data: { ...result, ...(hint ? { hint } : {}) },
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
