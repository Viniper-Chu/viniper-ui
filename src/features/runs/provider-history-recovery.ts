import {
  ProviderHistoryEntry,
  ProviderToolResultItem,
} from "../../core/provider-contracts";

const RECOVERY_RESULT_PREFIX = "recovered-tool-result";
const RECOVERY_RESULT_TEXT = "工具调用在工作台重启时未完成；已安全结束，可继续当前会话。";

export interface DanglingToolRecovery {
  history: ProviderHistoryEntry[];
  recoveredCallIds: string[];
  changed: boolean;
}

/**
 * Close an assistant tool call that was persisted without its tool result.
 *
 * A crash can leave the assistant provider-step/tool-call in SQLite while the
 * follow-up result was never committed. Anthropic requires the next message
 * after that assistant block to contain a matching tool_result. Recovery is
 * deterministic and idempotent: it only inserts an explicit failed result
 * immediately after the affected assistant entry and never rewrites user or
 * assistant text.
 */
export function recoverDanglingToolCalls(history: ProviderHistoryEntry[]): DanglingToolRecovery {
  let changed = false;
  const normalized = history.map(clone).filter((entry) => {
    if (entry.role !== "assistant" || hasRenderableAssistantItem(entry)) return true;
    changed = true;
    return false;
  });
  const recoveredCallIds: string[] = [];

  for (let index = 0; index < normalized.length; index += 1) {
    const entry = normalized[index];
    if (entry.role !== "assistant") continue;
    const calls = toolCalls(entry);
    if (calls.length === 0) continue;

    const resolved = new Set<string>();
    let nextIndex = index + 1;
    while (nextIndex < normalized.length && normalized[nextIndex]?.role === "tool") {
      for (const callId of toolResultCallIds(normalized[nextIndex])) resolved.add(callId);
      nextIndex += 1;
    }
    const missing = calls.filter((call) => !resolved.has(call.callId));
    if (missing.length === 0) continue;

    const resultItems = missing.map((call) => recoveredResult(call));
    const immediate = normalized[index + 1];
    if (immediate?.role === "tool") {
      immediate.items = [...immediate.items, ...resultItems];
    } else {
      normalized.splice(index + 1, 0, {
        id: `${RECOVERY_RESULT_PREFIX}:${entry.id}`,
        role: "tool",
        items: resultItems,
      });
    }
    recoveredCallIds.push(...missing.map((call) => call.callId));
    changed = true;
    index += immediate?.role === "tool" ? 0 : 1;
  }

  return {
    history: normalized,
    recoveredCallIds,
    changed,
  };
}

function hasRenderableAssistantItem(entry: ProviderHistoryEntry): boolean {
  return entry.items.some((item) => {
    if (item.type === "text" || item.type === "reasoning") return item.text.trim().length > 0;
    if (item.type === "tool-call") return Boolean(item.callId);
    if (item.type !== "provider-step" || item.protocol !== "anthropic-messages") return false;
    const type = item.step?.type;
    return type === "thinking" || type === "text" || type === "tool_use" || type === "redacted_thinking";
  });
}

function toolCalls(entry: ProviderHistoryEntry): Array<{ callId: string; name: string }> {
  const calls = new Map<string, { callId: string; name: string }>();
  for (const item of entry.items) {
    if (item.type === "tool-call" && item.callId) {
      calls.set(item.callId, { callId: item.callId, name: item.name });
      continue;
    }
    if (item.type !== "provider-step" || item.protocol !== "anthropic-messages") continue;
    const step = item.step;
    if (step.type !== "tool_use" || typeof step.id !== "string" || !step.id) continue;
    const name = typeof step.name === "string" ? step.name : "";
    if (!calls.has(step.id)) calls.set(step.id, { callId: step.id, name });
  }
  return [...calls.values()];
}

function toolResultCallIds(entry: ProviderHistoryEntry): string[] {
  if (entry.role !== "tool") return [];
  return entry.items
    .filter((item): item is ProviderToolResultItem => item.type === "tool-result" && Boolean(item.callId))
    .map((item) => item.callId);
}

function recoveredResult(call: { callId: string; name: string }): ProviderToolResultItem {
  return {
    type: "tool-result",
    callId: call.callId,
    name: call.name,
    content: RECOVERY_RESULT_TEXT,
    isError: true,
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
