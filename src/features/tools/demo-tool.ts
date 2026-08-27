import { ToolRequest } from "../../core/contracts";
import { ToolExecutionContext, ToolExecutor, ToolResult } from "./tool-registry";

export class DemoReadOnlyTool implements ToolExecutor {
  readonly name = "demo.read-only-preview" as const;
  readonly description = "预览 Demo 会话上下文，不访问真实文件。";
  readonly readOnly = true;
  readonly inputSchema = {
    type: "object",
    properties: { fixture: { type: "string", enum: ["pending-tool"] } },
    additionalProperties: false,
  } as const;

  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    if (request.input?.fixture === "pending-tool" && process.env.VINIPER_DEMO_FIXTURE === "pending-tool") {
      await pauseFixture(context.signal, 1_600);
    }
    return {
      toolId: request.id,
      text: "只读 Demo 完成：未访问文件系统、Shell、网络、凭据或用户数据。",
    };
  }
}

function pauseFixture(signal: AbortSignal, milliseconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Demo fixture cancelled"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Demo fixture cancelled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
