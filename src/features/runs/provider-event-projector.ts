import {
  ActivityRecord,
  ProviderEvent,
  RuntimeEventType,
  SessionSnapshot,
} from "../../core/contracts";
import { sessionAgentEngine } from "../../core/agent-engine-contracts";
import { engineScopedId } from "../../core/engine-identity";

export interface ProviderProjectionContext {
  session: SessionSnapshot;
  assistantMessageId: string;
  thinkingActivityId: string;
  now: () => number;
  emit(type: RuntimeEventType, payload: unknown): Promise<void>;
  appendText(text: string): void;
  providerLabel: string;
}

export async function projectProviderEvent(
  providerEvent: ProviderEvent,
  context: ProviderProjectionContext,
): Promise<void> {
  switch (providerEvent.kind) {
    case "provider.request.started":
      await context.emit("provider.request.started", providerEvent);
      break;
    case "provider.activity":
      await context.emit("provider.activity", { phase: providerEvent.phase, receivedCharacters: providerEvent.receivedCharacters });
      break;
    case "context.budget":
      await context.emit("context.budget", providerEvent);
      break;
    case "context.compacted":
      await context.emit("context.compacted", providerEvent);
      break;
    case "thinking.started":
      if (context.session.activities.some((activity) => activity.id === context.thinkingActivityId)) break;
      await context.emit("thinking.started", {
        id: context.thinkingActivityId,
        kind: "thinking",
        title: `${context.providerLabel} 推理`,
        detail: `${context.providerLabel} 正在准备回复。`,
        status: "running",
        createdAt: context.now(),
      } satisfies ActivityRecord);
      break;
    case "thinking.completed":
      if (context.session.activities.some((activity) => activity.id === context.thinkingActivityId)) {
        await context.emit("thinking.completed", { activityId: context.thinkingActivityId });
      }
      break;
    case "reasoning.completed":
      if (context.session.activities.some((activity) => activity.id === context.thinkingActivityId)) {
        await context.emit("thinking.completed", { activityId: context.thinkingActivityId });
      }
      break;
    case "reasoning.delta":
      if (!context.session.activities.some((activity) => activity.id === context.thinkingActivityId)) {
        await context.emit("thinking.started", {
          id: context.thinkingActivityId,
          kind: "thinking",
          title: `${context.providerLabel} 推理`,
          detail: `${context.providerLabel} 正在准备回复。`,
          status: "running",
          createdAt: context.now(),
        } satisfies ActivityRecord);
      }
      await context.emit("thinking.delta", { activityId: context.thinkingActivityId, text: providerEvent.text });
      break;
    case "text.delta":
      context.appendText(providerEvent.text);
      await context.emit("message.delta", {
        messageId: context.assistantMessageId,
        text: providerEvent.text,
        createdAt: context.now(),
      });
      break;
    case "provider-tool.started":
      await context.emit("tool.requested", {
        id: providerActivityId("tool", providerEvent.callId, sessionAgentEngine(context.session.engineId)),
        kind: "tool",
        title: `${context.providerLabel} · ${providerEvent.name}`,
        detail: `${context.providerLabel} 正在执行 ${providerEvent.name}。`,
        status: "running",
        callId: providerEvent.callId,
        toolName: providerEvent.name,
        createdAt: context.now(),
      } satisfies ActivityRecord);
      break;
    case "provider-tool.completed":
      await context.emit(providerEvent.isError ? "tool.failed" : "tool.completed", {
        activityId: providerActivityId("tool", providerEvent.callId, sessionAgentEngine(context.session.engineId)),
        result: providerEvent.isError ? `${context.providerLabel} 工具执行失败。` : `${context.providerLabel} 工具已完成。`,
      });
      break;
    case "provider-permission.confirmed":
      await context.emit("interaction.requested", {
        id: providerActivityId("permission", context.assistantMessageId, sessionAgentEngine(context.session.engineId)),
        kind: "interaction",
        title: `${context.providerLabel} 权限模式`,
        detail: `CLI 已确认 ${providerEvent.mode}。`,
        status: "running",
        createdAt: context.now(),
      } satisfies ActivityRecord);
      break;
    case "provider-permission.completed":
      await context.emit("interaction.resolved", {
        activityId: providerActivityId("permission", context.assistantMessageId, sessionAgentEngine(context.session.engineId)),
        decision: providerEvent.deniedCount === 0 ? "allow-once" : "reject",
        detail: providerEvent.deniedCount === 0
          ? `${context.providerLabel} 本次权限流程已完成，无拒绝项。`
          : `${context.providerLabel} 本次返回 ${providerEvent.deniedCount} 个权限拒绝项。`,
      });
      break;
    case "provider.failed":
      break;
    case "tool-call.completed":
    case "continuation.updated":
    case "model-step.completed":
      break;
    case "usage.estimated":
    case "usage.completed":
      break;
  }
}

function providerActivityId(kind: "tool" | "permission", source: string, engineId: "viniper" | "claude-code"): string {
  return engineScopedId(engineId, "item", `provider-${kind}-${source.replace(/[^a-zA-Z0-9_-]+/gu, "-").slice(0, 120)}`);
}
