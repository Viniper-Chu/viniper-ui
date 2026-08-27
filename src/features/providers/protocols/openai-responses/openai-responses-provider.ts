import {
  ProviderEvent,
  ProviderHistoryEntry,
  ProviderProfile,
  ProviderRequest,
  ProviderToolCallItem,
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
  toolDefinitions,
  usage,
} from "../shared/protocol-helpers";
import { readSseFrames } from "../shared/sse";

export class OpenAIResponsesProvider implements ModelProvider {
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
      body: JSON.stringify(serializeOpenAIResponses(request, this.options.profile, cache.body)),
    });
    if (!response.body) throw new Error("Provider 未返回流式响应体。");

    const calls = new Map<string, ResponseCallAccumulator>();
    let responseId: string | undefined;
    let reasoningStarted = false;
    let reasoningText = "";
    let reasoningItemId: string | undefined;
    let completedUsage: ReturnType<typeof mapResponsesUsage> | undefined;
    for await (const frame of readSseFrames(response.body, signal)) {
      if (!frame.data || frame.data === "[DONE]") continue;
      const payload = JSON.parse(frame.data) as ResponsesEvent;
      const type = payload.type ?? frame.event;
      if (typeof payload.response?.id === "string") responseId = payload.response.id;
      if (type === "response.output_text.delta" && typeof payload.delta === "string") {
        yield { kind: "text.delta", text: payload.delta };
      }
      if ((type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") && typeof payload.delta === "string") {
        if (!reasoningStarted) {
          reasoningStarted = true;
          yield { kind: "thinking.started" };
        }
        reasoningText += payload.delta;
        reasoningItemId = payload.item_id ?? reasoningItemId;
        yield { kind: "reasoning.delta", text: payload.delta, itemId: payload.item_id };
      }
      if (type === "response.output_item.added" || type === "response.output_item.done") mergeResponseItem(calls, payload.item, payload.output_index);
      if (type === "response.function_call_arguments.delta") mergeArguments(calls, payload);
      if (payload.response?.usage) completedUsage = mapResponsesUsage(payload.response.usage);
    }
    if (reasoningStarted) {
      yield {
        kind: "reasoning.completed",
        item: { type: "reasoning", text: reasoningText, itemId: reasoningItemId, providerId: request.profileId },
      };
      yield { kind: "thinking.completed" };
    }
    for (const call of calls.values()) {
      yield {
        kind: "tool-call.completed",
        call: {
          type: "tool-call",
          callId: call.callId,
          name: call.name,
          argumentsText: call.argumentsText,
          arguments: parseArguments(call.argumentsText),
          protocolItemId: call.itemId,
        },
      };
    }
    if (responseId) yield { kind: "continuation.updated", item: { type: "continuation", responseId } };
    if (completedUsage) yield { kind: "usage.completed", usage: completedUsage };
  }
}

export function serializeOpenAIResponses(
  request: ProviderRequest,
  profile: ProviderProfile,
  cacheBody: Record<string, unknown> = {},
): Record<string, unknown> {
  const continuation = [...request.history]
    .reverse()
    .flatMap((entry) => [...entry.items].reverse())
    .find((item) => item.type === "continuation" && item.responseId);
  const useServerContinuation = profile.continuationMode === "server-optional" && continuation?.type === "continuation";
  const history = useServerContinuation ? historyAfterLastContinuation(request.history) : request.history;
  const explicitCache = isExplicitCache(cacheBody) && !useServerContinuation;
  const { input, instructions } = responseInputWithStableBreakpoint(request, profile, explicitCache, history);
  return {
    model: request.selectedModel,
    ...(instructions ? { instructions } : {}),
    input,
    tools: toolDefinitions(isProviderCapabilityEnabled(profile, "tools") ? request.tools : []),
    stream: true,
    ...(useServerContinuation ? { previous_response_id: continuation.responseId } : {}),
    ...cacheBody,
  };
}

function responseInputWithStableBreakpoint(
  request: ProviderRequest,
  profile: ProviderProfile,
  explicitCache: boolean,
  history: ProviderHistoryEntry[],
): { input: Array<Record<string, unknown>>; instructions: string } {
  const instructions = stableInstructions(request.contextProfile.history, request.contextProfile.stableSegments);
  if (!explicitCache) {
    return {
      input: responseInput(history, profile.preserveReasoningItems ?? false),
      instructions,
    };
  }

  const stableIds = new Set(request.contextProfile.history.map((entry) => entry.id));
  const stableEntries = history.filter((entry) => stableIds.has(entry.id));
  const dynamicEntries = history.filter((entry) => !stableIds.has(entry.id));
  const stableInput = responseInput(stableEntries, profile.preserveReasoningItems ?? false);
  let breakpointPlaced = markLastSupportedInputText(stableInput);
  if (!breakpointPlaced && instructions) {
    stableInput.push({
      role: "developer",
      content: [{
        type: "input_text",
        text: instructions,
        prompt_cache_breakpoint: { mode: "explicit" },
      }],
    });
    breakpointPlaced = true;
  }
  return {
    input: [...stableInput, ...responseInput(dynamicEntries, profile.preserveReasoningItems ?? false)],
    instructions: breakpointPlaced && stableEntries.length === 0 ? "" : instructions,
  };
}

function historyAfterLastContinuation(history: ProviderHistoryEntry[]): ProviderHistoryEntry[] {
  let continuationEntry = -1;
  let continuationItem = -1;
  for (let entryIndex = history.length - 1; entryIndex >= 0; entryIndex -= 1) {
    const itemIndex = [...history[entryIndex].items].reverse().findIndex((item) => item.type === "continuation" && item.responseId);
    if (itemIndex < 0) continue;
    continuationEntry = entryIndex;
    continuationItem = history[entryIndex].items.length - 1 - itemIndex;
    break;
  }
  if (continuationEntry < 0) return history;
  const tail: ProviderHistoryEntry[] = [];
  const remainingItems = history[continuationEntry].items.slice(continuationItem + 1);
  if (remainingItems.length) tail.push({ ...history[continuationEntry], items: remainingItems });
  tail.push(...history.slice(continuationEntry + 1));
  return tail;
}

function markLastSupportedInputText(input: Array<Record<string, unknown>>): boolean {
  for (let messageIndex = input.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const content = input[messageIndex].content;
    if (!Array.isArray(content)) continue;
    for (let contentIndex = content.length - 1; contentIndex >= 0; contentIndex -= 1) {
      const block = content[contentIndex] as Record<string, unknown>;
      if (block.type !== "input_text" && block.type !== "input_image" && block.type !== "input_file") continue;
      block.prompt_cache_breakpoint = { mode: "explicit" };
      return true;
    }
  }
  return false;
}

function isExplicitCache(cacheBody: Record<string, unknown>): boolean {
  const options = cacheBody.prompt_cache_options;
  return Boolean(options && typeof options === "object" && (options as Record<string, unknown>).mode === "explicit");
}

function responseInput(history: ProviderHistoryEntry[], preserveReasoningItems: boolean): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];
  for (const entry of history) {
    for (const item of entry.items) {
      if (item.type === "text") {
        input.push({
          role: entry.role === "assistant" ? "assistant" : "user",
          content: [{ type: entry.role === "assistant" ? "output_text" : "input_text", text: item.text }],
        });
      } else if (item.type === "reasoning" && (preserveReasoningItems || item.itemId)) {
        input.push({
          type: "reasoning",
          ...(item.itemId ? { id: item.itemId } : {}),
          summary: [{ type: "summary_text", text: item.text }],
        });
      } else if (item.type === "tool-call") {
        input.push({
          type: "function_call",
          ...(item.protocolItemId ? { id: item.protocolItemId } : {}),
          call_id: item.callId,
          name: item.name,
          arguments: item.argumentsText,
        });
      } else if (item.type === "tool-result") {
        input.push({ type: "function_call_output", call_id: item.callId, output: item.content });
      }
    }
  }
  return input;
}

interface ResponsesEvent {
  type?: string;
  delta?: string;
  item_id?: string;
  output_index?: number;
  item?: {
    id?: string;
    type?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
  };
  response?: {
    id?: string;
    usage?: ResponsesUsage;
  };
}

interface ResponsesUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
}

interface ResponseCallAccumulator {
  itemId: string;
  callId: string;
  name: string;
  argumentsText: string;
}

function mergeResponseItem(
  calls: Map<string, ResponseCallAccumulator>,
  item: ResponsesEvent["item"],
  outputIndex = 0,
): void {
  if (item?.type !== "function_call") return;
  const key = item.id ?? `response-call-${outputIndex}`;
  const current = calls.get(key) ?? { itemId: key, callId: "", name: "", argumentsText: "" };
  if (item.id) current.itemId = item.id;
  if (item.call_id) current.callId = item.call_id;
  if (item.name) current.name = item.name;
  if (item.arguments !== undefined) current.argumentsText = item.arguments;
  calls.set(key, current);
}

function mergeArguments(calls: Map<string, ResponseCallAccumulator>, payload: ResponsesEvent): void {
  const key = payload.item_id ?? `response-call-${payload.output_index ?? 0}`;
  const current = calls.get(key) ?? { itemId: key, callId: "", name: "", argumentsText: "" };
  current.argumentsText += payload.delta ?? "";
  calls.set(key, current);
}

function mapResponsesUsage(value: ResponsesUsage) {
  const input = numberOrZero(value.input_tokens);
  const output = numberOrZero(value.output_tokens);
  return usage({
    input,
    cacheHitInput: numberOrNull(value.input_tokens_details?.cached_tokens),
    cacheMissInput: value.input_tokens === undefined || value.input_tokens_details?.cached_tokens === undefined
      ? null
      : Math.max(0, input - numberOrZero(value.input_tokens_details.cached_tokens)),
    cacheWriteInput: numberOrNull(value.input_tokens_details?.cache_write_tokens),
    output,
    reasoning: numberOrZero(value.output_tokens_details?.reasoning_tokens),
    total: value.total_tokens === undefined ? input + output : numberOrZero(value.total_tokens),
  });
}
