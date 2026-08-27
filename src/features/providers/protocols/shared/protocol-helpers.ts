import {
  ProviderContentItem,
  ProviderCapabilityName,
  ProviderDescriptor,
  ProviderHistoryEntry,
  ProviderProfile,
  ProviderProfileConfiguration,
  ProviderToolDefinition,
} from "../../../../core/provider-contracts";
import { TokenUsage } from "../../../../core/telemetry-contracts";
import { isProviderCapabilityEnabled } from "../../provider-capabilities";

export interface ProtocolProviderOptions {
  profile: ProviderProfile;
  configuration: ProviderProfileConfiguration;
  resolveSecret(fieldId: string): Promise<string | null>;
  fetchImpl?: typeof fetch;
  allowExternalNetwork?: boolean;
}

export function descriptorFor(options: ProtocolProviderOptions): ProviderDescriptor {
  const models = options.configuration.models.length
    ? options.configuration.models
    : options.configuration.selectedModel ? [options.configuration.selectedModel] : [];
  return {
    id: options.profile.id,
    name: options.profile.vendor,
    label: `${options.profile.vendor} · ${protocolLabel(options.profile.protocol)} · REAL_API_UNPROVEN`,
    configuration: "configured",
    available: Boolean(models.length),
    realCallsEnabled: Boolean(models.length),
    capabilities: Object.entries(options.profile.capabilities)
      .filter(([name]) => isProviderCapabilityEnabled(options.profile, name as ProviderCapabilityName))
      .map(([name]) => name),
    models: models.map((id) => ({ id, label: id })),
    protocol: options.profile.protocol,
  };
}

export function protocolLabel(protocol: ProviderProfile["protocol"]): string {
  return ({
    "openai-responses": "OpenAI Responses",
    "anthropic-messages": "Anthropic Messages",
    "gemini-interactions": "Gemini Interactions",
    "openai-chat": "OpenAI Chat",
    sensenova: "SenseNova",
  })[protocol];
}

export function stableInstructions(history: ProviderHistoryEntry[], segments: Array<{ name: string; text: string }>): string {
  void history;
  return segments
    .filter((segment) => segment.name !== "stable-history" && segment.name !== "tool-schemas")
    .map((segment) => segment.text)
    .filter(Boolean)
    .join("\n\n");
}

export function toolDefinitions(tools: ProviderToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }));
}

export function parseArguments(argumentsText: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argumentsText || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function textFromItems(items: ProviderContentItem[]): string {
  return items.filter((item) => item.type === "text").map((item) => item.text).join("");
}

export function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

export function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : null;
}

export function usage(input: Partial<TokenUsage> & Pick<TokenUsage, "input" | "output" | "total">): TokenUsage {
  return {
    input: numberOrZero(input.input),
    cacheHitInput: input.cacheHitInput === undefined ? null : input.cacheHitInput,
    cacheMissInput: input.cacheMissInput === undefined ? null : input.cacheMissInput,
    cacheWriteInput: input.cacheWriteInput === undefined ? null : input.cacheWriteInput,
    output: numberOrZero(input.output),
    reasoning: numberOrZero(input.reasoning),
    toolUse: numberOrZero(input.toolUse),
    total: numberOrZero(input.total),
    source: input.source ?? "provider",
  };
}
