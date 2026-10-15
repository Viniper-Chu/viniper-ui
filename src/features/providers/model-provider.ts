import { ProviderActivityEvent, ProviderDescriptor, ProviderEvent, ProviderRequest } from "../../core/provider-contracts";
import { LocalAgentPolicy } from "../local-models/local-agent-policy";

export interface ModelProvider {
  readonly descriptor: ProviderDescriptor;
  runtimePolicyFor?(model: string): LocalAgentPolicy | undefined;
  analyzeImage?(input: { model: string; image: string; prompt: string; reasoning?: string }, signal: AbortSignal, onActivity?: (event: ProviderActivityEvent) => Promise<void>): Promise<{ text: string; usage?: import("../../core/telemetry-contracts").TokenUsage }>;
  stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>;
}
