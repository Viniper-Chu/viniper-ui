import { ProviderEvent, ProviderRequest } from "../../../../core/provider-contracts";
import { ModelProvider } from "../../model-provider";
import { ProviderTransport } from "../shared/provider-transport";
import {
  descriptorFor,
  numberOrNull,
  numberOrZero,
  ProtocolProviderOptions,
  stableInstructions,
  usage,
} from "../shared/protocol-helpers";
import { readSseFrames } from "../shared/sse";

export class SenseNovaProvider implements ModelProvider {
  readonly descriptor;
  private readonly transport: ProviderTransport;

  constructor(private readonly options: ProtocolProviderOptions) {
    this.descriptor = descriptorFor(options);
    this.transport = new ProviderTransport(options);
  }

  async *stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    const response = await this.transport.request({
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serializeSenseNova(request)),
    });
    if (!response.body) throw new Error("Provider 未返回流式响应体。");
    let usageRecord: SenseNovaUsage | undefined;
    for await (const frame of readSseFrames(response.body, signal)) {
      if (!frame.data || frame.data === "[DONE]") continue;
      const envelope = JSON.parse(frame.data) as SenseNovaEnvelope;
      const payload = envelope.data ?? envelope;
      const choiceDelta = payload.choices?.[0]?.delta;
      const text = typeof choiceDelta === "string"
        ? choiceDelta
        : choiceDelta?.content ?? payload.delta?.content ?? payload.content;
      if (typeof text === "string" && text) yield { kind: "text.delta", text };
      if (payload.usage) usageRecord = payload.usage;
    }
    if (usageRecord) yield { kind: "usage.completed", usage: mapSenseNovaUsage(usageRecord) };
  }
}

export function serializeSenseNova(request: ProviderRequest): Record<string, unknown> {
  return {
    model: request.selectedModel,
    messages: [
      { role: "system", content: stableInstructions(request.contextProfile.history, request.contextProfile.stableSegments) },
      ...request.history.flatMap((entry) => entry.items
        .filter((item) => item.type === "text")
        .map((item) => ({ role: entry.role === "assistant" ? "assistant" : "user", content: item.text }))),
    ],
    stream: true,
  };
}

interface SenseNovaUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface SenseNovaPayload {
  content?: string;
  delta?: { content?: string };
  choices?: Array<{ delta?: string | { content?: string } }>;
  usage?: SenseNovaUsage;
}

interface SenseNovaEnvelope extends SenseNovaPayload {
  data?: SenseNovaPayload;
}

function mapSenseNovaUsage(value: SenseNovaUsage) {
  const input = numberOrZero(value.prompt_tokens);
  const output = numberOrZero(value.completion_tokens);
  return usage({
    input,
    cacheHitInput: numberOrNull(undefined),
    cacheMissInput: numberOrNull(undefined),
    cacheWriteInput: numberOrNull(undefined),
    output,
    reasoning: 0,
    total: value.total_tokens === undefined ? input + output : numberOrZero(value.total_tokens),
  });
}
