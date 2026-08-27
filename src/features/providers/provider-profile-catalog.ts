import {
  ProviderCatalogSnapshot,
  ProviderProfile,
  ProviderProfileConfiguration,
  ProviderProfileState,
} from "../../core/provider-contracts";
import { LegacyProviderConnectionSettings, ProviderConnectionSettings } from "../../core/security-contracts";
import { withEnabledCapabilities } from "./provider-capabilities";
import { PROVIDER_PROFILES } from "./profiles";
import { GeminiServerStateSettings, ModelCatalogState, ProviderNetworkSettings } from "../../core/provider-runtime-contracts";

const CATEGORY_LABELS = {
  international: "国外模型",
  "domestic-model": "国内模型",
  "domestic-platform": "国内平台",
  custom: "自定义",
} as const;

export class ProviderProfileCatalog {
  private readonly profiles = new Map<string, ProviderProfile>();

  constructor(profiles: ProviderProfile[] = PROVIDER_PROFILES) {
    for (const profile of profiles) {
      if (this.profiles.has(profile.id)) throw new Error(`Provider profile '${profile.id}' 重复。`);
      this.profiles.set(profile.id, clone(profile));
    }
  }

  list(): ProviderProfile[] {
    return [...this.profiles.values()].map(clone);
  }

  get(profileId: string): ProviderProfile {
    const profile = this.profiles.get(profileId);
    if (!profile) throw new Error(`未知 Provider profile '${profileId}'。`);
    return clone(profile);
  }

  normalizeSettings(
    saved: ProviderConnectionSettings | LegacyProviderConnectionSettings | null,
  ): ProviderConnectionSettings {
    const normalized: ProviderConnectionSettings = { schemaVersion: 2, profiles: {} };
    for (const profile of this.profiles.values()) {
      normalized.profiles[profile.id] = defaultConfiguration(profile);
    }
    if (!saved) return normalized;
    if (isCurrentSettings(saved)) {
      for (const profile of this.profiles.values()) {
        const configured = saved.profiles[profile.id];
        if (!configured) continue;
        normalized.profiles[profile.id] = normalizeConfiguration(profile, configured);
      }
      return normalized;
    }

    const baseUrl = saved.deepseekBaseUrl.replace(/\/+$/u, "");
    normalized.profiles.deepseek = normalizeConfiguration(this.get("deepseek"), {
      profileId: "deepseek",
      endpoint: /\/chat\/completions$/u.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`,
      models: saved.deepseekModels,
      selectedModel: saved.deepseekModels[0],
      connectionState: saved.deepseekConnectionState,
      message: saved.deepseekMessage,
      lastCheckedAt: saved.deepseekLastCheckedAt,
    });
    return normalized;
  }

  effectiveProfile(settings: ProviderConnectionSettings, profileId: string): ProviderProfile {
    const profile = this.get(profileId);
    const configuration = settings.profiles[profileId];
    const effective = withEnabledCapabilities(profile, configuration);
    if (profileId !== "openai-compatible" || !configuration) return effective;
    const authMode = configuration.customAuthMode ?? "bearer";
    return {
      ...effective,
      auth: [{
        id: "api-key",
        label: "API Key",
        placement: "header",
        name: authMode === "bearer" ? "Authorization" : authMode,
        prefix: authMode === "bearer" ? "Bearer " : undefined,
        required: true,
      }],
    };
  }

  snapshot(
    settings: ProviderConnectionSettings,
    isSecretConfigured: (secretId: string) => boolean,
  ): ProviderCatalogSnapshot {
    const profiles = this.list().map((profile) => this.state(settings, profile.id, isSecretConfigured));
    return {
      profiles,
      categories: (Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>).map((id) => ({
        id,
        label: CATEGORY_LABELS[id],
        count: profiles.filter((state) => state.profile.category === id).length,
      })),
      realApiStatus: "REAL_API_UNPROVEN",
    };
  }

  state(
    settings: ProviderConnectionSettings,
    profileId: string,
    isSecretConfigured: (secretId: string) => boolean,
  ): ProviderProfileState {
    const profile = this.effectiveProfile(settings, profileId);
    const configuration = clone(settings.profiles[profileId] ?? defaultConfiguration(profile));
    const configuredFields = profile.auth.map((field) => ({
      fieldId: field.id,
      configured: isSecretConfigured(providerSecretId(profile.id, field.id)),
    }));
    const endpoint = configuration.endpoint?.trim() || profile.endpoint.defaultUrl;
    const endpointReady = Boolean(endpoint && /^https?:\/\//u.test(endpoint));
    const credentialsReady = profile.auth
      .filter((field) => field.required)
      .every((field) => configuredFields.find((item) => item.fieldId === field.id)?.configured);
    const modelReady = Boolean(configuration.selectedModel || configuration.models.length);
    return {
      profile,
      configuration,
      enabledCapabilities: { ...profile.enabledCapabilities! },
      configuredFields,
      endpointReady,
      credentialsReady,
      selectable: endpointReady && credentialsReady && modelReady,
      realApiStatus: "REAL_API_UNPROVEN",
      network: networkSnapshot(configuration.network ?? defaultNetworkSettings()),
      geminiServerState: clone(configuration.geminiServerState ?? defaultGeminiServerState()),
    };
  }
}

function isCurrentSettings(
  settings: ProviderConnectionSettings | LegacyProviderConnectionSettings,
): settings is ProviderConnectionSettings {
  return "schemaVersion" in settings && settings.schemaVersion === 2;
}

export function providerSecretId(profileId: string, fieldId: string): string {
  return profileId === "deepseek" && fieldId === "api-key"
    ? "provider.deepseek"
    : `provider.${profileId}.${fieldId}`;
}

function defaultConfiguration(profile: ProviderProfile): ProviderProfileConfiguration {
  const currentModels = [...(profile.currentModels ?? [])];
  return {
    profileId: profile.id,
    endpoint: profile.endpoint.defaultUrl,
    models: currentModels,
    selectedModel: currentModels[0],
    connectionState: "not-configured",
    message: profile.modelDiscovery.mode === "manual"
      ? "保存凭据并填写模型 ID；真实连接尚未验证。"
      : "保存凭据后可读取模型列表；不会生成内容。",
    modelCatalog: defaultModelCatalog(),
    network: defaultNetworkSettings(),
    geminiServerState: defaultGeminiServerState(),
    ...(profile.id === "openai-compatible" ? {
      customAuthMode: "bearer" as const,
      enabledCapabilitiesByModel: {
        "*": { stream: true, usage: true, tools: false, reasoning: false, cache: false },
      },
    } : {}),
  };
}

function normalizeConfiguration(
  profile: ProviderProfile,
  input: ProviderProfileConfiguration,
): ProviderProfileConfiguration {
  const cloned = clone(input) as ProviderProfileConfiguration & {
    customCapabilities?: Record<string, boolean>;
  };
  const legacyCapabilities = cloned.customCapabilities;
  delete cloned.customCapabilities;
  const savedModels = [...new Set((input.models ?? []).map((model) => model.trim()).filter(Boolean))];
  const models = savedModels.length ? savedModels : [...(profile.currentModels ?? [])];
  return {
    ...defaultConfiguration(profile),
    ...cloned,
    profileId: profile.id,
    endpoint: input.endpoint?.trim() || profile.endpoint.defaultUrl,
    models,
    selectedModel: input.selectedModel && models.includes(input.selectedModel)
      ? input.selectedModel
      : models[0],
    enabledCapabilitiesByModel: clone(
      input.enabledCapabilitiesByModel
      ?? (legacyCapabilities ? { "*": legacyCapabilities } : defaultConfiguration(profile).enabledCapabilitiesByModel),
    ),
    modelCatalog: normalizeModelCatalog(input.modelCatalog),
    network: normalizeNetworkSettings(input.network),
    geminiServerState: normalizeGeminiServerState(input.geminiServerState),
  };
}

function defaultModelCatalog(): ModelCatalogState {
  return { status: "unknown", removedModelIds: [], message: "模型目录尚未刷新。" };
}

function normalizeModelCatalog(input: ModelCatalogState | undefined): ModelCatalogState {
  return {
    ...defaultModelCatalog(),
    ...(input ?? {}),
    removedModelIds: [...new Set(input?.removedModelIds ?? [])],
  };
}

function defaultNetworkSettings(): ProviderNetworkSettings {
  return { mode: "system", tlsVerification: "required" };
}

function normalizeNetworkSettings(input: ProviderNetworkSettings | undefined): ProviderNetworkSettings {
  if (!input || input.tlsVerification !== "required") return defaultNetworkSettings();
  return {
    mode: input.mode === "profile" ? "profile" : "system",
    ...(input.proxyUrl ? { proxyUrl: input.proxyUrl } : {}),
    ...(input.proxyKind ? { proxyKind: input.proxyKind } : {}),
    ...(input.proxyCredentialRef ? { proxyCredentialRef: input.proxyCredentialRef } : {}),
    ...(input.customCaRef ? { customCaRef: input.customCaRef } : {}),
    tlsVerification: "required",
  };
}

function defaultGeminiServerState(): GeminiServerStateSettings {
  return {
    enabled: false,
    localHistoryAuthoritative: true,
    remoteDeleteOnDisable: false,
  };
}

function normalizeGeminiServerState(input: GeminiServerStateSettings | undefined): GeminiServerStateSettings {
  const base = defaultGeminiServerState();
  return {
    ...base,
    ...(input?.enabled ? { enabled: true } : {}),
    ...(input?.boundary ? { boundary: clone(input.boundary) } : {}),
  };
}

function networkSnapshot(input: ProviderNetworkSettings): ProviderProfileState["network"] {
  let proxyHost: string | undefined;
  if (input.proxyUrl) {
    try { proxyHost = new URL(input.proxyUrl).host; } catch { proxyHost = undefined; }
  }
  return {
    mode: input.mode,
    proxyConfigured: Boolean(input.proxyUrl || input.proxyCredentialRef),
    ...(proxyHost ? { proxyHost } : {}),
    customCaConfigured: Boolean(input.customCaRef),
    tlsVerification: "required",
  };
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
