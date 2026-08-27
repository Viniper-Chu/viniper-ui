import { LocalModelRecord } from "../../core/local-model-contracts";
import { ProviderProfile, ProviderProfileConfiguration } from "../../core/provider-contracts";
import { OpenAIChatProvider } from "../providers/protocols/openai-chat/openai-chat-provider";

export function createLocalModelProvider(record: LocalModelRecord, fetchImpl?: typeof fetch): OpenAIChatProvider | undefined {
  if (!record.endpoint || !record.activeVersionId) return undefined;
  const profile: ProviderProfile = {
    id: `local-model:${record.id}`,
    label: record.label,
    category: "custom",
    vendor: "本地模型",
    protocol: "openai-chat",
    endpoint: { mode: "fixed", defaultUrl: record.endpoint, placeholder: record.endpoint },
    auth: [],
    modelDiscovery: { mode: "manual" },
    capabilities: {
      stream: "officially-documented",
      tools: record.toolCapability === "none" ? "unsupported" : "profile-dependent",
      reasoning: "profile-dependent",
      cache: "unsupported",
      usage: "officially-documented",
    },
    enabledCapabilities: {
      stream: true,
      tools: record.toolCapability !== "none",
      reasoning: false,
      cache: false,
      usage: true,
    },
    evidenceLevel: "officially-documented",
    evidenceLabel: "LOCAL_LOOPBACK",
    documentation: [],
    cachePolicyId: "provider-reported",
    continuationMode: "local-history",
    currentModels: [record.id],
  };
  const configuration: ProviderProfileConfiguration = {
    profileId: profile.id,
    endpoint: record.endpoint,
    models: [record.id],
    selectedModel: record.id,
    connectionState: "connected",
    message: "本地 loopback 模型；不使用云端凭据。",
    network: { mode: "system", tlsVerification: "required" },
    modelCatalog: { status: "current", removedModelIds: [], message: "来自用户已确认的本地模型登记。" },
    geminiServerState: { enabled: false, localHistoryAuthoritative: true, remoteDeleteOnDisable: false },
  };
  return new OpenAIChatProvider({
    profile,
    configuration,
    allowExternalNetwork: false,
    fetchImpl,
    resolveSecret: async () => null,
  });
}
