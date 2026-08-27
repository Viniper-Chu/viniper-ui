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
import { GeminiServerStateSettings } from "../../../../core/provider-runtime-contracts";

export class GeminiInteractionsProvider implements ModelProvider {
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
      body: JSON.stringify(serializeGeminiInteractions(request, this.options.profile, cache.body, this.options.configuration.geminiServerState)),
    });
    if (!response.body) throw new Error("Provider 未返回流式响应体。");

    const steps = new Map<number, GeminiStepAccumulator>();
    let reasoningStarted = false;
    let reasoningText = "";
    let interactionId: string | undefined;
    let usageRecord: GeminiUsage | undefined;

    for await (const frame of readSseFrames(response.body, signal)) {
      if (!frame.data || frame.data === "[DONE]") continue;
      const payload = JSON.parse(frame.data) as GeminiEvent;
      const eventType = payload.event_type ?? frame.event ?? payload.type;
      interactionId = payload.interaction?.id ?? payload.interaction_id ?? interactionId;

      if (eventType === "step.start" && payload.step && isStepIndex(payload.index)) {
        steps.set(payload.index, createStepAccumulator(payload.index, payload.step));
      }

      if (eventType === "step.delta" && payload.delta && isStepIndex(payload.index)) {
        const current = steps.get(payload.index);
        if (!current) continue;
        if (payload.delta.type === "arguments_delta") {
          current.argumentsText += payload.delta.arguments ?? "";
        } else if (payload.delta.type === "text" && payload.delta.text) {
          appendModelText(current.modelContent, payload.delta.text);
          yield { kind: "text.delta", text: payload.delta.text };
        } else if (payload.delta.type === "thought_summary" && payload.delta.content?.text) {
          current.thoughtSummary.push(clone(payload.delta.content));
          if (!reasoningStarted) {
            reasoningStarted = true;
            yield { kind: "thinking.started" };
          }
          reasoningText += payload.delta.content.text;
          yield { kind: "reasoning.delta", text: payload.delta.content.text, itemId: current.id };
        } else if (payload.delta.type === "thought_signature" && payload.delta.signature) {
          current.signature += payload.delta.signature;
        }
      }

      if (eventType === "step.stop" && isStepIndex(payload.index)) {
        const current = steps.get(payload.index);
        if (!current || current.emitted) continue;
        for (const event of eventsForStoppedStep(current)) yield event;
        current.emitted = true;
      }

      if (payload.usage) usageRecord = payload.usage;
      if (payload.interaction?.usage) usageRecord = payload.interaction.usage;
    }

    if (reasoningStarted) {
      yield { kind: "reasoning.completed", item: { type: "reasoning", text: reasoningText, providerId: request.profileId } };
      yield { kind: "thinking.completed" };
    }
    if (interactionId) yield { kind: "continuation.updated", item: { type: "continuation", interactionId } };
    if (usageRecord) yield { kind: "usage.completed", usage: mapGeminiUsage(usageRecord) };
  }
}

export function serializeGeminiInteractions(
  request: ProviderRequest,
  profile: ProviderProfile,
  cacheBody: Record<string, unknown> = {},
  serverState?: GeminiServerStateSettings,
): Record<string, unknown> {
  const serverStateEnabled = serverState?.enabled === true;
  const continuation = [...request.history]
    .reverse()
    .flatMap((entry) => [...entry.items].reverse())
    .find((item) => item.type === "continuation" && "interactionId" in item && item.interactionId);
  return {
    model: request.selectedModel,
    system_instruction: stableInstructions(request.contextProfile.history, request.contextProfile.stableSegments),
    input: geminiInput(request.history),
    tools: (isProviderCapabilityEnabled(profile, "tools") ? request.tools : []).map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    })),
    stream: true,
    store: serverStateEnabled,
    ...(serverStateEnabled && profile.continuationMode === "server-optional" && continuation?.type === "continuation"
      ? { previous_interaction_id: continuation.interactionId }
      : {}),
    ...cacheBody,
  };
}

function geminiInput(history: ProviderHistoryEntry[]): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];
  for (const entry of history) {
    if (entry.role === "user") {
      const content = entry.items
        .filter((item) => item.type === "text")
        .map((item) => ({ type: "text", text: item.text }));
      if (content.length) input.push({ type: "user_input", content });
      continue;
    }
    if (entry.role === "tool") {
      for (const item of entry.items) {
        if (item.type !== "tool-result") continue;
        input.push({
          type: "function_result",
          name: item.name,
          call_id: item.callId,
          result: [{ type: "text", text: item.content }],
        });
      }
      continue;
    }

    const rawSteps = entry.items.filter((item): item is ProviderModelStepItem =>
      item.type === "provider-step" && item.protocol === "gemini-interactions");
    if (rawSteps.length) {
      input.push(...rawSteps.map((item) => clone(item.step)));
      continue;
    }
    for (const item of entry.items) {
      if (item.type === "text") input.push({ type: "text", text: item.text });
      if (item.type === "reasoning") input.push({ type: "thought", ...(item.itemId ? { id: item.itemId } : {}), summary: [{ type: "text", text: item.text }] });
      if (item.type === "tool-call") input.push({
        type: "function_call",
        id: item.protocolItemId ?? item.callId,
        name: item.name,
        arguments: item.arguments,
      });
    }
  }
  return input;
}

interface GeminiUsage {
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_tokens?: number;
  total_cached_tokens?: number;
  total_thought_tokens?: number;
  total_tool_use_tokens?: number;
}

interface GeminiEvent {
  type?: string;
  event_type?: string;
  index?: number;
  interaction_id?: string;
  interaction?: { id?: string; usage?: GeminiUsage };
  step?: Record<string, unknown> & { id?: unknown; type?: unknown; name?: unknown; arguments?: unknown };
  delta?: {
    type?: string;
    text?: string;
    arguments?: string;
    signature?: string;
    content?: { type?: string; text?: string };
  };
  usage?: GeminiUsage;
}

interface GeminiStepAccumulator {
  index: number;
  id: string;
  start: Record<string, unknown>;
  argumentsText: string;
  modelContent: Array<Record<string, unknown>>;
  thoughtSummary: Array<Record<string, unknown>>;
  signature: string;
  emitted: boolean;
}

function eventsForStoppedStep(step: GeminiStepAccumulator): ProviderEvent[] {
  const raw = clone(step.start);
  if (raw.type === "model_output") {
    raw.content = clone(step.modelContent);
    return [{ kind: "model-step.completed", item: modelStep(raw) }];
  }
  if (raw.type === "thought") {
    raw.signature = step.signature;
    raw.summary = clone(step.thoughtSummary);
    return [{ kind: "model-step.completed", item: modelStep(raw) }];
  }
  if (raw.type === "function_call") {
    const parsed = step.argumentsText
      ? parseArguments(step.argumentsText)
      : raw.arguments && typeof raw.arguments === "object"
        ? raw.arguments as Record<string, unknown>
        : {};
    raw.id = step.id;
    raw.arguments = clone(parsed);
    return [
      { kind: "model-step.completed", item: modelStep(raw) },
      {
        kind: "tool-call.completed",
        call: {
          type: "tool-call",
          callId: step.id,
          name: typeof raw.name === "string" ? raw.name : "",
          argumentsText: step.argumentsText || JSON.stringify(parsed),
          arguments: parsed,
          protocolItemId: step.id,
        },
      },
    ];
  }
  return [{ kind: "model-step.completed", item: modelStep(raw) }];
}

function modelStep(step: Record<string, unknown>): ProviderModelStepItem {
  return { type: "provider-step", protocol: "gemini-interactions", step };
}

function createStepAccumulator(index: number, step: Record<string, unknown> & { id?: unknown; arguments?: unknown }): GeminiStepAccumulator {
  const raw = clone(step);
  return {
    index,
    id: typeof raw.id === "string" && raw.id ? raw.id : `gemini-step-${index}`,
    start: raw,
    argumentsText: argumentsText(raw.arguments),
    modelContent: Array.isArray(raw.content) ? clone(raw.content as Array<Record<string, unknown>>) : [],
    thoughtSummary: Array.isArray(raw.summary) ? clone(raw.summary as Array<Record<string, unknown>>) : [],
    signature: typeof raw.signature === "string" ? raw.signature : "",
    emitted: false,
  };
}

function isStepIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function appendModelText(content: Array<Record<string, unknown>>, text: string): void {
  const last = content.at(-1);
  if (last?.type === "text" && typeof last.text === "string") last.text += text;
  else content.push({ type: "text", text });
}

function argumentsText(value: unknown): string {
  if (typeof value === "string") return value;
  return value && typeof value === "object" && Object.keys(value as object).length ? JSON.stringify(value) : "";
}

function mapGeminiUsage(value: GeminiUsage) {
  const input = numberOrZero(value.total_input_tokens);
  const output = numberOrZero(value.total_output_tokens);
  return usage({
    input,
    cacheHitInput: numberOrNull(value.total_cached_tokens),
    cacheMissInput: value.total_input_tokens === undefined || value.total_cached_tokens === undefined
      ? null
      : Math.max(0, input - numberOrZero(value.total_cached_tokens)),
    cacheWriteInput: null,
    output,
    reasoning: numberOrZero(value.total_thought_tokens),
    toolUse: numberOrZero(value.total_tool_use_tokens),
    total: value.total_tokens === undefined ? input + output : numberOrZero(value.total_tokens),
  });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
