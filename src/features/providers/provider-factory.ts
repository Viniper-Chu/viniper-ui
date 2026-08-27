import { ProviderProfile, ProviderProfileConfiguration } from "../../core/provider-contracts";
import { ModelProvider } from "./model-provider";
import { AnthropicMessagesProvider } from "./protocols/anthropic-messages/anthropic-messages-provider";
import { GeminiInteractionsProvider } from "./protocols/gemini-interactions/gemini-interactions-provider";
import { OpenAIChatProvider } from "./protocols/openai-chat/openai-chat-provider";
import { OpenAIResponsesProvider } from "./protocols/openai-responses/openai-responses-provider";
import { SenseNovaProvider } from "./protocols/sensenova/sensenova-provider";
import { isProviderCapabilityEnabled } from "./provider-capabilities";

export function createProfileProvider(input: {
  profile: ProviderProfile;
  configuration: ProviderProfileConfiguration;
  resolveSecret(fieldId: string): Promise<string | null>;
  fetchImpl?: typeof fetch;
  allowExternalNetwork?: boolean;
}): ModelProvider {
  let provider: ModelProvider;
  switch (input.profile.protocol) {
    case "openai-responses": provider = new OpenAIResponsesProvider(input); break;
    case "anthropic-messages": provider = new AnthropicMessagesProvider(input); break;
    case "gemini-interactions": provider = new GeminiInteractionsProvider(input); break;
    case "openai-chat": provider = new OpenAIChatProvider(input); break;
    case "sensenova": provider = new SenseNovaProvider(input); break;
  }
  return !isProviderCapabilityEnabled(input.profile, "tools")
    ? new NoToolProvider(provider)
    : provider;
}

class NoToolProvider implements ModelProvider {
  readonly descriptor;

  constructor(private readonly inner: ModelProvider) {
    this.descriptor = inner.descriptor;
  }

  async *stream(request: Parameters<ModelProvider["stream"]>[0], signal: AbortSignal) {
    for await (const event of this.inner.stream({ ...request, tools: [] }, signal)) {
      if (event.kind === "tool-call.completed") {
        throw new Error("当前 Provider/model 未启用工具能力，已拒绝其工具调用。");
      }
      yield event;
    }
  }
}
