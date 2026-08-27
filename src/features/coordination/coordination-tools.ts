import { ToolRequest } from "../../core/contracts";
import { ToolExecutionContext, ToolExecutor, ToolResult } from "../tools/tool-registry";
import { CoordinationService } from "./coordination-service";

export function createCoordinationTools(service: CoordinationService): ToolExecutor[] {
  return [
    new SendCoordinationMessageTool(service),
    new DelegateCoordinationTaskTool(service),
    new WaitForCoordinationResultTool(service),
    new ReadCoordinationResultTool(service),
  ];
}

class SendCoordinationMessageTool implements ToolExecutor {
  readonly name = "coordination.send-message";
  readonly description = "向另一个本地 Agent 会话发送显式消息信封。";
  readonly readOnly = false;
  readonly inputSchema = coordinationInputSchema();

  constructor(private readonly service: CoordinationService) {}

  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    const sourceSessionId = context.sessionId;
    const targetSessionId = textInput(request, "targetSessionId");
    const text = textInput(request, "text");
    const envelope = await this.service.sendMessage(sourceSessionId, targetSessionId, text);
    return { toolId: request.id, text: "协作消息已送达目标会话。", data: { envelopeId: envelope.id } };
  }
}

class DelegateCoordinationTaskTool implements ToolExecutor {
  readonly name = "coordination.delegate-task";
  readonly description = "把任务委派到另一个本地 Agent 会话的独立队列。";
  readonly readOnly = false;
  readonly inputSchema = coordinationInputSchema();

  constructor(private readonly service: CoordinationService) {}

  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    const sourceSessionId = context.sessionId;
    const targetSessionId = textInput(request, "targetSessionId");
    const text = textInput(request, "text");
    const envelope = await this.service.delegateTask(sourceSessionId, targetSessionId, text);
    return { toolId: request.id, text: "任务已进入目标会话。", data: { envelopeId: envelope.id } };
  }
}

class WaitForCoordinationResultTool implements ToolExecutor {
  readonly name = "coordination.wait-for-result";
  readonly description = "按来源会话和委派关联 ID 等待结果；立即返回等待句柄，不占用运行槽。";
  readonly readOnly = true;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      sourceSessionId: { type: "string" as const, description: "结果来源会话 ID" },
      correlationId: { type: "string" as const, description: "委派信封 ID" },
      timeoutMs: { type: "number" as const, description: "可选等待超时毫秒数" },
    },
    required: ["sourceSessionId", "correlationId"],
    additionalProperties: false,
  };

  constructor(private readonly service: CoordinationService) {}

  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    const sourceSessionId = textInput(request, "sourceSessionId");
    const correlationId = textInput(request, "correlationId");
    const timeout = request.input?.timeoutMs;
    const timeoutMs = typeof timeout === "number" && Number.isFinite(timeout) ? timeout : undefined;
    const result = await this.service.waitForMessage(context.sessionId, {
      fromSessionId: sourceSessionId,
      envelopeType: "result",
      correlationId,
      ...(timeoutMs ? { timeoutMs } : {}),
    });
    return { toolId: request.id, text: result.waiting ? "已登记结果等待。" : "匹配结果已到达。", data: result };
  }
}

class ReadCoordinationResultTool implements ToolExecutor {
  readonly name = "coordination.read-result";
  readonly description = "读取并标记属于当前会话的协作结果。";
  readonly readOnly = true;
  readonly inputSchema = {
    type: "object" as const,
    properties: { envelopeId: { type: "string" as const, description: "结果信封 ID" } },
    required: ["envelopeId"],
    additionalProperties: false,
  };

  constructor(private readonly service: CoordinationService) {}

  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    const envelope = await this.service.readEnvelope(context.sessionId, textInput(request, "envelopeId"));
    if (!envelope || envelope.type !== "result") throw new Error("结果不存在或不属于当前会话。");
    return { toolId: request.id, text: envelope.body, data: { envelopeId: envelope.id, correlationId: envelope.correlationId } };
  }
}

function coordinationInputSchema() {
  return {
    type: "object" as const,
    properties: {
      targetSessionId: { type: "string" as const, description: "目标会话 ID" },
      text: { type: "string" as const, description: "消息或委派内容" },
    },
    required: ["targetSessionId", "text"],
    additionalProperties: false,
  };
}

function textInput(request: ToolRequest, key: string): string {
  const value = request.input?.[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`工具输入缺少 ${key}。`);
  return value.trim();
}
