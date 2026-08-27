import {
  ProviderEvent,
  ProviderHistoryEntry,
  ProviderModelStepItem,
  ProviderProfile,
  ProviderRequest,
} from "../../../../core/provider-contracts";
import { projectCachePolicy } from "../../cache-policies/provider-cache-policy";
import { ModelProvider } from "../../model-provider";
import { isProviderCapabilityEnabled } from "../../provider-capabilities";
import { ProviderTransport } from "../shared/provider-transport";
import {
  descriptorFor,
  numberOrNull,
  numberOrZero,
  parseArguments,
  ProtocolProviderOptions,
  stableInstructions,
  usage,
} from "../shared/protocol-helpers";
import { readSseFrames } from "../shared/sse";
import { createToolNameProjection, ToolNameProjection } from "../shared/tool-name-projection";
import { recoverDanglingToolCalls } from "../../../runs/provider-history-recovery";

export class AnthropicMessagesProvider implements ModelProvider {
  readonly descriptor;
  private readonly transport: ProviderTransport;

  constructor(private readonly options: ProtocolProviderOptions) {
    this.descriptor = descriptorFor(options);
    this.transport = new ProviderTransport(options);
  }

  async *stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    const cache = projectCachePolicy(this.options.profile, request);
    const response = await this.transport.request({
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", ...cache.headers },
      body: JSON.stringify(serializeAnthropicMessages(request, this.options.profile, cache.body)),
    });
    if (!response.body) throw new Error("Provider 未返回流式响应体。");

    const toolNames = createToolNameProjection(request.tools, { strictReverse: true });
    const blocks = new Map<number, AnthropicBlockAccumulator>();
    let reasoningStarted = false;
    let reasoningText = "";
    let usageRecord: AnthropicUsage = {};
    for await (const frame of readSseFrames(response.body, signal)) {
      if (!frame.data || frame.data === "[DONE]") continue;
      const payload = JSON.parse(frame.data) as AnthropicEvent;
      const eventType = payload.type ?? frame.event;
      if (eventType === "message_start" && payload.message?.usage) usageRecord = { ...usageRecord, ...payload.message.usage };
      if (eventType === "message_delta" && payload.usage) usageRecord = { ...usageRecord, ...payload.usage };

      if (eventType === "content_block_start" && payload.content_block) {
        const index = payload.index ?? blocks.size;
        blocks.set(index, {
          index,
          raw: clone(payload.content_block),
          argumentsText: argumentsText(payload.content_block.input),
          emitted: false,
        });
      }

      if (eventType === "content_block_delta" && payload.delta) {
        const index = payload.index ?? 0;
        const block = blocks.get(index) ?? { index, raw: { type: "unknown" }, argumentsText: "", emitted: false };
        if (payload.delta.type === "text_delta" && payload.delta.text) {
          appendString(block.raw, "text", payload.delta.text);
          yield { kind: "text.delta", text: payload.delta.text };
        } else if (payload.delta.type === "thinking_delta" && payload.delta.thinking) {
          appendString(block.raw, "thinking", payload.delta.thinking);
          if (!reasoningStarted) {
            reasoningStarted = true;
            yield { kind: "thinking.started" };
          }
          reasoningText += payload.delta.thinking;
          yield { kind: "reasoning.delta", text: payload.delta.thinking };
        } else if (payload.delta.type === "signature_delta" && payload.delta.signature) {
          appendString(block.raw, "signature", payload.delta.signature);
        } else if (payload.delta.type === "input_json_delta") {
          block.argumentsText += payload.delta.partial_json ?? "";
        } else if (payload.delta.type === "redacted_thinking_delta" && payload.delta.data) {
          appendString(block.raw, "data", payload.delta.data);
        }
        blocks.set(index, block);
      }

      if (eventType === "content_block_stop") {
        const block = blocks.get(payload.index ?? 0);
        if (!block || block.emitted) continue;
        for (const event of eventsForBlock(block, toolNames)) yield event;
        block.emitted = true;
      }
    }

    for (const block of [...blocks.values()].sort((left, right) => left.index - right.index)) {
      if (block.emitted) continue;
      for (const event of eventsForBlock(block, toolNames)) yield event;
    }
    if (reasoningStarted) {
      yield { kind: "reasoning.completed", item: { type: "reasoning", text: reasoningText, providerId: request.profileId } };
      yield { kind: "thinking.completed" };
    }
    if (Object.keys(usageRecord).length) yield { kind: "usage.completed", usage: mapAnthropicUsage(usageRecord) };
  }
}

export function serializeAnthropicMessages(
  request: ProviderRequest,
  profile: ProviderProfile,
  cacheBody: Record<string, unknown> = {},
): Record<string, unknown> {
  const cacheControl = isDeepSeekAnthropicModel(profile, request.selectedModel) ? undefined : cacheBody.cache_control;
  const toolNames = createToolNameProjection(request.tools, { strictReverse: true });
  const systemText = stableInstructions(request.contextProfile.history, request.contextProfile.stableSegments);
  return {
    model: request.selectedModel,
    max_tokens: 4096,
    stream: true,
    ...(cacheControl ? { cache_control: cacheControl } : {}),
    tools: (isProviderCapabilityEnabled(profile, "tools") ? request.tools : []).map((tool) => ({
      name: toolNames.toProvider(tool.name),
      description: tool.description,
      input_schema: tool.inputSchema,
    })),
    system: systemText ? [{ type: "text", text: systemText }] : [],
    messages: anthropicMessages(sanitizeAnthropicHistory(request.history), toolNames),
  };
}

/**
 * Project persisted history into the strict Anthropic role/block contract.
 *
 * Provider history is append-only and may contain an empty failed assistant,
 * a stale tool result, or a provider-step from a different protocol after a
 * restart. Those entries remain in the local session for auditability, but are
 * not allowed to become an invalid Messages payload. Tool results are kept
 * only while they match the immediately preceding assistant tool-use set;
 * missing results are closed with the deterministic recovery result before the
 * next user turn.
 */
export function sanitizeAnthropicHistory(history: ProviderHistoryEntry[]): ProviderHistoryEntry[] {
  const recovered = recoverDanglingToolCalls(history).history;
  const projected: ProviderHistoryEntry[] = [];
  let pendingCalls = new Map<string, string>();
  const closePending = (): void => {
    if (pendingCalls.size === 0) return;
    projected.push({
      id: `recovered-tool-result:${projected.at(-1)?.id ?? "history"}`,
      role: "tool",
      items: [...pendingCalls.entries()].map(([callId, name]) => ({
        type: "tool-result" as const,
        callId,
        name,
        content: "工具调用在工作台重启时未完成；已安全结束，可继续当前会话。",
        isError: true,
      })),
    });
    pendingCalls = new Map();
  };

  for (const entry of recovered) {
    if (entry.role === "assistant") {
      closePending();
      const items = entry.items.filter(isAnthropicHistoryItem);
      if (items.length === 0) continue;
      projected.push({ ...clone(entry), items });
      pendingCalls = new Map(toolCallsFromItems(items));
      continue;
    }
    if (entry.role === "tool") {
      if (pendingCalls.size === 0) continue;
      const results = entry.items.filter((item): item is Extract<ProviderHistoryEntry["items"][number], { type: "tool-result" }> =>
        item.type === "tool-result" && pendingCalls.has(item.callId));
      if (results.length === 0) continue;
      for (const result of results) pendingCalls.delete(result.callId);
      projected.push({ ...clone(entry), items: results });
      continue;
    }
    closePending();
    const items = entry.items.filter(isAnthropicHistoryItem);
    if (items.length > 0) projected.push({ ...clone(entry), items });
  }
  closePending();
  return projected;
}

function isAnthropicHistoryItem(item: ProviderHistoryEntry["items"][number]): boolean {
  if (item.type === "text" || item.type === "reasoning" || item.type === "tool-call" || item.type === "tool-result") return true;
  if (item.type !== "provider-step" || item.protocol !== "anthropic-messages") return false;
  const type = item.step?.type;
  return type === "thinking" || type === "text" || type === "tool_use" || type === "redacted_thinking";
}

function toolCallsFromItems(items: ProviderHistoryEntry["items"]): Array<[string, string]> {
  const calls = new Map<string, string>();
  for (const item of items) {
    if (item.type === "tool-call" && item.callId) calls.set(item.callId, item.name);
    if (item.type === "provider-step" && item.protocol === "anthropic-messages" && item.step?.type === "tool_use") {
      const id = typeof item.step.id === "string" ? item.step.id : "";
      if (id) calls.set(id, typeof item.step.name === "string" ? item.step.name : "");
    }
  }
  return [...calls.entries()];
}

function isDeepSeekAnthropicModel(profile: ProviderProfile, model: string): boolean {
  return profile.id === "anthropic" && /^(deepseek-v4-pro|deepseek-v4-flash)$/u.test(model);
}

function anthropicMessages(history: ProviderHistoryEntry[], toolNames: ToolNameProjection): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];
  const appendUserContent = (content: Array<Record<string, unknown>>, prepend = false): void => {
    if (!content.length) return;
    const previous = messages[messages.length - 1];
    if (previous?.role === "user" && Array.isArray(previous.content)) {
      previous.content = prepend
        ? [...content, ...previous.content]
        : [...previous.content, ...content];
      return;
    }
    messages.push({ role: "user", content });
  };
  for (const entry of history) {
    if (entry.role === "tool") {
      const content = entry.items
        .filter((item) => item.type === "tool-result")
        .map((item) => ({ type: "tool_result", tool_use_id: item.callId, content: item.content, is_error: item.isError }));
      // DeepSeek's Anthropic-compatible endpoint requires the tool result to
      // remain the first block of the user turn. If a legacy replay already
      // placed user text beside it, prepend rather than creating another
      // adjacent user message.
      appendUserContent(content, true);
      continue;
    }
    if (entry.role === "user") {
      const content = entry.items.filter((item) => item.type === "text").map((item) => ({ type: "text", text: item.text }));
      appendUserContent(content);
      continue;
    }

    const opaqueBlocks = entry.items.filter((item): item is ProviderModelStepItem =>
      item.type === "provider-step" && item.protocol === "anthropic-messages");
    if (opaqueBlocks.length) {
      messages.push({ role: "assistant", content: opaqueBlocks.map((item) => clone(item.step)) });
      continue;
    }
    const content: Array<Record<string, unknown>> = [];
    for (const item of entry.items) {
      if (item.type === "text") content.push({ type: "text", text: item.text });
      if (item.type === "reasoning") content.push({ type: "thinking", thinking: item.text });
      if (item.type === "tool-call") content.push({ type: "tool_use", id: item.callId, name: toolNames.toProvider(item.name), input: item.arguments });
    }
    if (content.length) messages.push({ role: "assistant", content });
  }
  return messages;
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface AnthropicEvent {
  type?: string;
  index?: number;
  message?: { usage?: AnthropicUsage };
  usage?: AnthropicUsage;
  content_block?: Record<string, unknown> & { type?: unknown; id?: unknown; name?: unknown; input?: unknown };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    signature?: string;
    partial_json?: string;
    data?: string;
  };
}

interface AnthropicBlockAccumulator {
  index: number;
  raw: Record<string, unknown>;
  argumentsText: string;
  emitted: boolean;
}

function eventsForBlock(block: AnthropicBlockAccumulator, toolNames: ToolNameProjection): ProviderEvent[] {
  const raw = clone(block.raw);
  if (raw.type === "tool_use") {
    const parsed = block.argumentsText
      ? parseArguments(block.argumentsText)
      : raw.input && typeof raw.input === "object"
        ? raw.input as Record<string, unknown>
        : {};
    raw.input = clone(parsed);
    const callId = typeof raw.id === "string" && raw.id ? raw.id : `anthropic-tool-${block.index}`;
    return [
      { kind: "model-step.completed", item: opaqueBlock(raw) },
      {
        kind: "tool-call.completed",
        call: {
          type: "tool-call",
          callId,
          name: typeof raw.name === "string" ? toolNames.toCanonical(raw.name) : "",
          argumentsText: block.argumentsText || JSON.stringify(parsed),
          arguments: parsed,
          protocolItemId: callId,
        },
      },
    ];
  }
  return [{ kind: "model-step.completed", item: opaqueBlock(raw) }];
}

function opaqueBlock(step: Record<string, unknown>): ProviderModelStepItem {
  return { type: "provider-step", protocol: "anthropic-messages", step };
}

function appendString(target: Record<string, unknown>, key: string, delta: string): void {
  target[key] = `${typeof target[key] === "string" ? target[key] : ""}${delta}`;
}

function argumentsText(value: unknown): string {
  if (typeof value === "string") return value;
  return value && typeof value === "object" && Object.keys(value as object).length ? JSON.stringify(value) : "";
}

function mapAnthropicUsage(value: AnthropicUsage) {
  const cacheMissInput = numberOrZero(value.input_tokens);
  const cacheHitInput = numberOrZero(value.cache_read_input_tokens);
  const cacheWriteInput = numberOrZero(value.cache_creation_input_tokens);
  const input = cacheMissInput + cacheHitInput + cacheWriteInput;
  const output = numberOrZero(value.output_tokens);
  return usage({
    input,
    cacheHitInput: numberOrNull(value.cache_read_input_tokens),
    cacheMissInput: numberOrNull(value.input_tokens),
    cacheWriteInput: numberOrNull(value.cache_creation_input_tokens),
    output,
    reasoning: 0,
    toolUse: 0,
    total: input + output,
  });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
