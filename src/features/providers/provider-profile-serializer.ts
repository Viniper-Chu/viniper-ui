import { ProviderProfile, ProviderProfileConfiguration, ProviderRequest } from "../../core/provider-contracts";
import { projectCachePolicy } from "./cache-policies/provider-cache-policy";
import { isProviderCapabilityEnabled, withEnabledCapabilities } from "./provider-capabilities";
import { serializeAnthropicMessages } from "./protocols/anthropic-messages/anthropic-messages-provider";
import { serializeGeminiInteractions } from "./protocols/gemini-interactions/gemini-interactions-provider";
import { serializeOpenAIChat } from "./protocols/openai-chat/openai-chat-provider";
import { serializeOpenAIResponses } from "./protocols/openai-responses/openai-responses-provider";
import { serializeSenseNova } from "./protocols/sensenova/sensenova-provider";

export function serializeProviderRequest(
  profile: ProviderProfile,
  request: ProviderRequest,
  configuration?: ProviderProfileConfiguration,
): Record<string, unknown> {
  const effectiveProfile = withEnabledCapabilities(profile, configuration);
  const effective = requestForProfile(effectiveProfile, request);
  const cache = projectCachePolicy(effectiveProfile, effective);
  switch (effectiveProfile.protocol) {
    case "openai-responses": return serializeOpenAIResponses(effective, effectiveProfile, cache.body);
    case "anthropic-messages": return serializeAnthropicMessages(effective, effectiveProfile, cache.body);
    case "gemini-interactions": return serializeGeminiInteractions(effective, effectiveProfile, cache.body, configuration?.geminiServerState);
    case "openai-chat": return serializeOpenAIChat(effective, effectiveProfile, cache.body);
    case "sensenova": return serializeSenseNova(effective);
  }
}

export function requestForProfile(profile: ProviderProfile, request: ProviderRequest): ProviderRequest {
  if (isProviderCapabilityEnabled(profile, "tools")) return request;
  return { ...request, tools: [] };
}
