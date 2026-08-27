import {
  ProviderEvent,
  ProviderHistoryEntry,
  ProviderProfile,
  ProviderRequest,
  ProviderToolCallItem,
  ProviderToolDefinition,
} from "../../../../core/provider-contracts";
import { ModelProvider } from "../../model-provider";
import { projectCachePolicy } from "../../cache-policies/provider-cache-policy";
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
import {
  createToolNameProjection,
  identityToolNameProjection,
  ToolNameProjection,
} from "../shared/tool-name-projection";

export class OpenAIChatProvider implements ModelProvider {
  readonly descriptor;
  private readonly transport: ProviderTransport;

  constructor(private readonly options: ProtocolProviderOptions) {
    this.descriptor = descriptorFor(options);
    this.transport = new ProviderTransport(options);
  }

  async discoverModels(signal = new AbortController().signal): Promise<string[]> {
    const endpoint = modelEndpoint(this.transport.endpoint(), this.options.profile.modelDiscovery.endpoint);
    const response = await this.transport.request({ method: "GET", signal }, endpoint);
    const payload = await response.json() as { data?: Array<{ id?: unknown }> };
    return (payload.data ?? []).map((item) => item.id).filter((id): id is string => typeof id === "string" && Boolean(id));
  }

  async *stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    const toolNames = createOpenAIChatToolNameProjection(this.options.profile, request.tools);
    const cache = projectCachePolicy(this.options.profile, request);
    const response = await this.transport.request({
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", ...cache.headers },
      body: JSON.stringify(serializeOpenAIChat(request, this.options.profile, this.options.profile.cachePolicyId === "provider-reported" ? {} : cache.body)),
    });
    if (!response.body) throw new Error("Provider 未返回流式响应体。");

    const calls = new Map<number, ToolCallAccumulator>();
    let reasoningStarted = false;
    let reasoningText = "";
    for await (const frame of readSseFrames(response.body, signal)) {
      if (!frame.data || frame.data === "[DONE]") continue;
      const payload = JSON.parse(frame.data) as ChatChunk;
      for (const choice of payload.choices ?? []) {
        const delta = choice.delta ?? {};
        const reasoning = delta.reasoning_content ?? delta.reasoning ?? "";
        if (reasoning) {
          if (!reasoningStarted) {
            reasoningStarted = true;
            yield { kind: "thinking.started" };
          }
          reasoningText += reasoning;
          yield { kind: "reasoning.delta", text: reasoning };
        }
        if (delta.content) yield { kind: "text.delta", text: delta.content };
        for (const fragment of delta.tool_calls ?? []) mergeToolCall(calls, fragment);
      }
      if (payload.usage) yield { kind: "usage.completed", usage: mapChatUsage(payload.usage) };
    }
    if (reasoningStarted) {
      yield { kind: "reasoning.completed", item: { type: "reasoning", text: reasoningText, providerId: request.profileId } };
      yield { kind: "thinking.completed" };
    }
    for (const [index, call] of [...calls.entries()].sort(([left], [right]) => left - right)) {
      const callId = call.callId || `chat-call-${index}`;
      yield {
        kind: "tool-call.completed",
        call: {
          type: "tool-call",
          callId,
          name: toolNames.toCanonical(call.name),
          argumentsText: call.argumentsText,
          arguments: parseArguments(call.argumentsText),
          protocolItemId: callId,
        },
      };
    }
  }
}

export function serializeOpenAIChat(
  request: ProviderRequest,
  profile: ProviderProfile,
  cacheBody: Record<string, unknown> = {},
): Record<string, unknown> {
  const instructions = stableInstructions(request.contextProfile.history, request.contextProfile.stableSegments);
  const toolNames = createOpenAIChatToolNameProjection(profile, request.tools);
  return {
    model: request.selectedModel,
    messages: [
      ...(instructions ? [{ role: "system", content: instructions }] : []),
      ...chatMessages(request.history, profile, toolNames),
    ],
    tools: (isProviderCapabilityEnabled(profile, "tools") ? request.tools : []).map((tool) => ({
      type: "function",
      function: { name: toolNames.toProvider(tool.name), description: tool.description, parameters: tool.inputSchema },
    })),
    stream: true,
    stream_options: { include_usage: true },
    ...(profile.id === "deepseek" ? { user_id: deepSeekSessionUserId(request.sessionId) } : {}),
    ...cacheBody,
  };
}

function deepSeekSessionUserId(sessionId: string): string {
  const safeSessionId = sessionId.replace(/[^A-Za-z0-9_-]/gu, "_") || "session";
  return `viniper_${safeSessionId}`.slice(0, 512);
}

export type OpenAIChatToolNameProjection = ToolNameProjection;

export function createOpenAIChatToolNameProjection(
  profile: ProviderProfile,
  tools: ProviderToolDefinition[],
): OpenAIChatToolNameProjection {
  if (profile.id !== "deepseek") return identityToolNameProjection();
  return createToolNameProjection(tools, { strictReverse: false });
}

function chatMessages(
  history: ProviderHistoryEntry[],
  profile: ProviderProfile,
  toolNames: OpenAIChatToolNameProjection,
): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];
  for (const entry of history) {
    if (entry.role === "user") {
      messages.push({ role: "user", content: entry.items.filter((item) => item.type === "text").map((item) => item.text).join("") });
      continue;
    }
    if (entry.role === "tool") {
      for (const item of entry.items) {
        if (item.type === "tool-result") {
          messages.push({
            role: "tool",
            tool_call_id: item.callId,
            ...(profile.id === "deepseek" ? {} : { name: item.name }),
            content: item.content,
          });
        }
      }
      continue;
    }
    const content = entry.items.filter((item) => item.type === "text").map((item) => item.text).join("");
    const reasoning = entry.items.filter((item) => item.type === "reasoning").map((item) => item.text).join("");
    const toolCalls = entry.items.filter((item): item is ProviderToolCallItem => item.type === "tool-call").map((item) => ({
      id: item.callId,
      type: "function",
      function: { name: toolNames.toProvider(item.name), arguments: item.argumentsText },
    }));
    messages.push({
      role: "assistant",
      // DeepSeek's official harness replays an empty string for text-less
      // assistant turns.  null can make a durable reasoning-only turn poison
      // every later request with a 400.
      content,
      // DeepSeek requires reasoning passback on tool-call turns.  It ignores
      // reasoning from plain turns, so omitting it keeps later append-only
      // prefixes smaller without changing conversation semantics.
      ...(toolCalls.length && reasoning ? { reasoning_content: reasoning } : {}),
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    });
  }
  return messages;
}

interface ChatChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning?: string;
      reasoning_content?: string;
      tool_calls?: Array<{ id?: string; index?: number; function?: { name?: string; arguments?: string } }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
    cache_write_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

interface ToolCallAccumulator {
  callId: string;
  name: string;
  argumentsText: string;
}

function mergeToolCall(calls: Map<number, ToolCallAccumulator>, fragment: {
  id?: string;
  index?: number;
  function?: { name?: string; arguments?: string };
}): void {
  const index = fragment.index ?? 0;
  const current = calls.get(index) ?? { callId: "", name: "", argumentsText: "" };
  if (fragment.id) current.callId = fragment.id;
  if (fragment.function?.name) current.name += fragment.function.name;
  if (fragment.function?.arguments) current.argumentsText += fragment.function.arguments;
  calls.set(index, current);
}

function mapChatUsage(value: NonNullable<ChatChunk["usage"]>) {
  const input = numberOrZero(value.prompt_tokens);
  const output = numberOrZero(value.completion_tokens);
  const cacheHit = value.prompt_cache_hit_tokens ?? value.prompt_tokens_details?.cached_tokens;
  const cacheWrite = value.cache_write_tokens ?? value.prompt_tokens_details?.cache_write_tokens;
  return usage({
    input,
    cacheHitInput: numberOrNull(cacheHit),
    cacheMissInput: value.prompt_cache_miss_tokens === undefined ? null : numberOrZero(value.prompt_cache_miss_tokens),
    cacheWriteInput: numberOrNull(cacheWrite),
    output,
    reasoning: numberOrZero(value.completion_tokens_details?.reasoning_tokens),
    total: value.total_tokens === undefined ? input + output : numberOrZero(value.total_tokens),
  });
}

function modelEndpoint(endpoint: string, configured?: string): string {
  if (configured && /^https?:\/\//u.test(configured)) return configured;
  const url = new URL(endpoint);
  if (configured) {
    url.pathname = configured.startsWith("/") ? configured : `/${configured}`;
    return url.toString();
  }
  url.pathname = url.pathname.replace(/\/chat\/completions\/?$/u, "/models").replace(/\/responses\/?$/u, "/models");
  return url.toString();
}
