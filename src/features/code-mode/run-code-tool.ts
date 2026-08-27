import { CodeMode, CodeRunRequest } from "../../core/code-mode-contracts";
import { ToolRequest } from "../../core/contracts";
import { CodeRuntimeService } from "./code-runtime";
import { ToolExecutionContext, ToolExecutor, ToolResult } from "../tools/tool-registry";

export function createRunCodeTool(runtime: CodeRuntimeService): ToolExecutor {
  return {
    name: "run_code",
    description: "在受管 Code Mode worker 中批量调用当前运行开放的工具。用户指定多个子调用时必须全部执行，不得省略或改写；优先使用 sdk.parallel。示例：await sdk.parallel([sdk.call('project.read', {path: '...'}), sdk.call('terminal.run', {command: '...', purpose: 'test'})])。",
    readOnly: false,
    authorizationScope: "computer",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", description: "native、code 或 both" },
        program: { type: "string", description: "只通过 sdk.call/sdk.parallel 的 JavaScript 程序；用户指定多个调用时不得省略。可按原样使用 sdk.parallel([sdk.call('project.read', {path: 'verify-code-mode.cjs'}), sdk.call('terminal.run', {command: 'node verify-code-mode.cjs', purpose: 'test'})])。" },
        bindings: { type: "object", description: "JSON 可序列化绑定" },
      },
      required: ["mode", "program"],
      additionalProperties: false,
    },
    async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
      const input = request.input ?? {};
      const mode = input.mode;
      const program = input.program;
      if (!isCodeMode(mode) || typeof program !== "string") return { toolId: request.id, text: "run_code 参数无效。", isError: true };
      if (!context.codeSubcallInvoker) return { toolId: request.id, text: "run_code 未获得宿主子调用端口，已安全拒绝。", isError: true };
      const result = await runtime.run({
        runId: context.runId,
        sessionId: context.sessionId,
        mode,
        program,
        parentCallId: request.id,
        bindings: isBindings(input.bindings) ? input.bindings : undefined,
        signal: context.signal,
        invoke: (subcall) => context.codeSubcallInvoker!({ ...subcall, signal: context.signal }),
      } satisfies CodeRunRequest);
      return {
        toolId: request.id,
        text: JSON.stringify({ ok: result.ok, value: result.value, logs: result.logs, calls: result.calls, outputTruncated: result.outputTruncated, error: result.error }),
        isError: !result.ok,
        cancelled: result.cancelled,
      };
    },
  };
}

function isCodeMode(value: unknown): value is CodeMode {
  return value === "native" || value === "code" || value === "both";
}

function isBindings(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
