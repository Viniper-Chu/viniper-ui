import { ProviderSettingsPersistence } from "../../core/ports";
import {
  ProviderCatalogSnapshot,
  ProviderEnabledCapabilities,
  ProviderProfileConfiguration,
} from "../../core/provider-contracts";
import { ProviderConnectionSettings } from "../../core/security-contracts";
import { SecretService } from "../secrets/secret-service";
import { createProfileProvider } from "./provider-factory";
import { normalizeCapabilityOverrides } from "./provider-capabilities";
import { ProviderProfileCatalog, providerSecretId } from "./provider-profile-catalog";
import { ProviderRegistry } from "./provider-registry";
import { ProviderTransport } from "./protocols/shared/provider-transport";
import {
  GeminiServerStateBoundary,
  ModelCatalogState,
  ProviderNetworkSettings,
} from "../../core/provider-runtime-contracts";

export interface ModelCatalogRefreshResult {
  status: ModelCatalogState["status"];
  models: string[];
  removedModelIds: string[];
  message: string;
}

export type ProviderSettingsListener = (settings: ProviderConnectionSettings) => void;

export class ProviderSettingsService {
  private settings: ProviderConnectionSettings = { schemaVersion: 2, profiles: {} };
  private readonly listeners = new Set<ProviderSettingsListener>();

  constructor(
    private readonly persistence: ProviderSettingsPersistence,
    private readonly secrets: SecretService,
    private readonly registry: ProviderRegistry,
    private readonly catalog = new ProviderProfileCatalog(),
    private readonly now: () => number = Date.now,
    private readonly fetchImpl?: typeof fetch,
    private readonly allowExternalNetwork = false,
  ) {}

  async initialize(): Promise<void> {
    this.settings = this.catalog.normalizeSettings(await this.persistence.loadProviderSettings());
    await this.refreshSecretState();
  }

  subscribe(listener: ProviderSettingsListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): ProviderConnectionSettings {
    return clone(this.settings);
  }

  catalogSnapshot(): ProviderCatalogSnapshot {
    return this.catalog.snapshot(this.settings, (id) => this.secrets.isConfigured(id));
  }

  async setEndpoint(profileId: string, endpoint: string): Promise<boolean> {
    const profile = this.catalog.get(profileId);
    const normalized = endpoint.trim().replace(/\/+$/u, "");
    if (!/^https?:\/\//u.test(normalized)) return false;
    const configuration = this.configuration(profileId);
    configuration.endpoint = normalized;
    configuration.connectionState = this.hasCredentials(profileId) ? "ready" : "not-configured";
    configuration.message = profile.endpoint.mode === "fixed"
      ? "端点覆写已保存；真实连接尚未验证。"
      : "手工端点已保存；真实连接尚未验证。";
    this.registry.unregister(profileId);
    await this.persist();
    return true;
  }

  async setManualModel(profileId: string, model: string): Promise<boolean> {
    this.catalog.get(profileId);
    const normalized = model.trim();
    if (!normalized) return false;
    const configuration = this.configuration(profileId);
    configuration.models = [...new Set([...configuration.models, normalized])];
    configuration.selectedModel = normalized;
    configuration.connectionState = this.hasCredentials(profileId) ? "ready" : "not-configured";
    configuration.message = "模型 ID 已保存；尚未通过真实账户验证。";
    await this.persistAndSync();
    return true;
  }

  async setCustomOptions(input: {
    authMode: "bearer" | "x-api-key" | "api-key";
    capabilities: Partial<ProviderEnabledCapabilities>;
  }): Promise<boolean> {
    const configuration = this.configuration("openai-compatible");
    configuration.customAuthMode = input.authMode;
    this.writeCapabilityOverrides("openai-compatible", configuration, input.capabilities);
    configuration.message = "自定义能力声明已保存；由用户声明，不代表真实验证。";
    await this.persistAndSync();
    return true;
  }

  async setEnabledCapabilities(
    profileId: string,
    capabilities: Partial<ProviderEnabledCapabilities>,
  ): Promise<boolean> {
    const configuration = this.configuration(profileId);
    this.writeCapabilityOverrides(profileId, configuration, capabilities);
    configuration.message = configuration.selectedModel
      ? `当前模型 ${configuration.selectedModel} 的能力开关已保存；未确认能力仍不代表真实验证。`
      : "Provider 能力开关已保存；未确认能力仍不代表真实验证。";
    await this.persistAndSync();
    return true;
  }

  async saveSecret(profileId: string, fieldId: string, value: string): Promise<{ configured: boolean; message: string }> {
    this.authField(profileId, fieldId);
    const result = await this.secrets.setSecret(providerSecretId(profileId, fieldId), value);
    await this.refreshSecretState(profileId);
    return result;
  }

  async deleteSecret(profileId: string, fieldId: string): Promise<{ configured: false; message: string }> {
    this.authField(profileId, fieldId);
    const result = await this.secrets.deleteSecret(providerSecretId(profileId, fieldId));
    await this.refreshSecretState(profileId);
    return result;
  }

  async testConnection(profileId: string, signal = new AbortController().signal): Promise<{
    connected: boolean;
    models: string[];
    message: string;
  }> {
    const profile = this.catalog.effectiveProfile(this.settings, profileId);
    const state = this.catalog.state(this.settings, profileId, (id) => this.secrets.isConfigured(id));
    const configuration = this.configuration(profileId);
    if (!state.endpointReady) return { connected: false, models: [], message: "请先填写有效的完整端点。" };
    if (!state.credentialsReady) return { connected: false, models: [], message: "请先保存全部必需凭据。" };
    if (profile.modelDiscovery.mode !== "openai-models") {
      configuration.connectionState = "ready";
      configuration.message = "此 Provider 没有统一模型发现接口；请手工填写模型 ID。";
      await this.persistAndSync();
      return { connected: false, models: [...configuration.models], message: configuration.message };
    }

    const result = await this.refreshModelCatalog(profileId, signal);
    return {
      connected: result.status === "current" || result.status === "changed",
      models: [...result.models],
      message: result.message,
    };
  }

  async refreshModelCatalog(
    profileId: string,
    signal = new AbortController().signal,
  ): Promise<ModelCatalogRefreshResult> {
    const profile = this.catalog.effectiveProfile(this.settings, profileId);
    const state = this.catalog.state(this.settings, profileId, (id) => this.secrets.isConfigured(id));
    const configuration = this.configuration(profileId);
    if (!state.endpointReady || !state.credentialsReady) {
      return this.catalogRefreshFailure(configuration, "请先填写有效端点并保存必需凭据。", false);
    }
    const modelCatalog = ensureModelCatalog(configuration);
    if (profile.modelDiscovery.mode !== "openai-models") {
      configuration.modelCatalog = {
        ...modelCatalog,
        status: configuration.models.length ? "current" : "unknown",
        message: "此 Provider 没有统一模型发现接口；请手工填写模型 ID。",
      };
      configuration.connectionState = "ready";
      configuration.message = configuration.modelCatalog.message;
      await this.persistAndSync();
      return {
        status: configuration.modelCatalog?.status ?? "unknown",
        models: [...configuration.models],
        removedModelIds: [],
        message: configuration.message,
      };
    }

    const attemptAt = this.now();
    configuration.modelCatalog = {
      ...modelCatalog,
      status: "checking",
      lastAttemptAt: attemptAt,
      message: "正在读取模型列表；不会生成内容。",
    };
    configuration.connectionState = "checking";
    configuration.message = configuration.modelCatalog?.message ?? "正在读取模型列表；不会生成内容。";
    this.publish();
    try {
      const transport = new ProviderTransport({
        profile,
        configuration,
        allowExternalNetwork: this.allowExternalNetwork,
        resolveSecret: (fieldId) => this.secrets.readForProvider(providerSecretId(profileId, fieldId)),
        fetchImpl: this.fetchImpl,
      });
      const response = await transport.request(
        { method: "GET", signal },
        discoveryEndpoint(profile.modelDiscovery.endpoint, transport.endpoint(), profile.endpoint.defaultUrl),
      );
      const payload = await response.json() as { data?: Array<{ id?: unknown }>; models?: Array<{ name?: unknown }> };
      const models = [...(payload.data ?? []).map((item) => item.id), ...(payload.models ?? []).map((item) => item.name)]
        .filter((id): id is string => typeof id === "string" && Boolean(id.trim()));
      const uniqueModels = [...new Set(models)];
      if (!uniqueModels.length) throw new Error("模型列表为空。");
      const previousModels = modelCatalog.lastSuccessfulAt ? [...configuration.models] : [];
      const removedModelIds = previousModels.filter((model) => !uniqueModels.includes(model));
      const status = removedModelIds.length > 0 ? "changed" : "current";
      const successfulAt = this.now();
      configuration.models = uniqueModels;
      configuration.selectedModel = configuration.selectedModel && uniqueModels.includes(configuration.selectedModel)
        ? configuration.selectedModel
        : uniqueModels[0];
      configuration.lastCheckedAt = successfulAt;
      configuration.connectionState = "connected";
      configuration.message = `已读取 ${uniqueModels.length} 个模型；未发起生成。`;
      configuration.modelCatalog = {
        status,
        lastAttemptAt: attemptAt,
        lastSuccessfulAt: successfulAt,
        removedModelIds,
        message: configuration.message,
      };
      await this.persistAndSync();
      return { status, models: [...uniqueModels], removedModelIds, message: configuration.message };
    } catch (error) {
      const message = error instanceof Error ? error.message : "模型目录刷新失败。";
      return this.catalogRefreshFailure(configuration, message, true, attemptAt);
    }
  }

  async refreshStaleModelCatalogs(now = this.now()): Promise<void> {
    for (const profile of this.catalog.list()) {
      const configuration = this.configuration(profile.id);
      const state = this.catalog.state(this.settings, profile.id, (id) => this.secrets.isConfigured(id));
      const modelCatalog = ensureModelCatalog(configuration);
      const stale = !modelCatalog.lastSuccessfulAt
        || now - modelCatalog.lastSuccessfulAt > 24 * 60 * 60 * 1000;
      if (profile.modelDiscovery.mode !== "openai-models" || !stale || !state.credentialsReady) continue;
      await this.refreshModelCatalog(profile.id);
    }
  }

  async setNetworkSettings(profileId: string, input: ProviderNetworkSettings): Promise<boolean> {
    const configuration = this.configuration(profileId);
    if (input.tlsVerification !== "required") return false;
    if (input.mode === "profile" && input.proxyUrl) {
      try {
        const parsed = new URL(input.proxyUrl);
        if (!parsed.host) return false;
      } catch {
        return false;
      }
    }
    configuration.network = {
      mode: input.mode === "profile" ? "profile" : "system",
      ...(input.proxyUrl ? { proxyUrl: input.proxyUrl } : {}),
      ...(input.proxyKind ? { proxyKind: input.proxyKind } : {}),
      ...(input.proxyCredentialRef ? { proxyCredentialRef: input.proxyCredentialRef } : {}),
      ...(input.customCaRef ? { customCaRef: input.customCaRef } : {}),
      tlsVerification: "required",
    };
    configuration.message = "网络设置已保存；TLS 校验始终开启。";
    await this.persistAndSync();
    return true;
  }

  async setGeminiServerState(
    profileId: string,
    input: { enabled: boolean; boundary?: GeminiServerStateBoundary },
  ): Promise<boolean> {
    const profile = this.catalog.get(profileId);
    if (profile.protocol !== "gemini-interactions") return false;
    const configuration = this.configuration(profileId);
    if (input.enabled && (!input.boundary || Object.values(input.boundary).some((item) => !item.trim()))) return false;
    configuration.geminiServerState = {
      enabled: input.enabled,
      ...(input.enabled && input.boundary ? { boundary: clone(input.boundary) } : {}),
      localHistoryAuthoritative: true,
      remoteDeleteOnDisable: false,
    };
    configuration.message = input.enabled
      ? "Gemini server-state 已启用；保存/保留/删除边界来自当前端点声明。"
      : "Gemini server-state 已关闭；本地历史仍是权威，未声明远端删除。";
    await this.persistAndSync();
    return true;
  }

  isModelAvailable(profileId: string, model: string): boolean {
    if (profileId === "demo") return model === "demo-default";
    const configuration = this.settings.profiles[profileId];
    return Boolean(configuration?.models.includes(model));
  }

  async refreshSecretState(profileId?: string): Promise<void> {
    const ids = profileId ? [profileId] : this.catalog.list().map((profile) => profile.id);
    for (const id of ids) {
      const configuration = this.configuration(id);
      const state = this.catalog.state(this.settings, id, (secretId) => this.secrets.isConfigured(secretId));
      if (!state.credentialsReady) {
        configuration.connectionState = "not-configured";
        configuration.message = "请保存全部必需凭据；界面不会回显明文。";
      } else if (configuration.connectionState === "not-configured" || configuration.connectionState === "failed") {
        configuration.connectionState = "ready";
        configuration.message = configuration.models.length
          ? "凭据与模型已配置；真实调用仍未验证。"
          : "凭据已配置；请获取或填写模型 ID。";
      }
    }
    await this.persistAndSync();
  }

  private configuration(profileId: string): ProviderProfileConfiguration {
    const configuration = this.settings.profiles[profileId];
    if (!configuration) throw new Error(`未知 Provider profile '${profileId}'。`);
    return configuration;
  }

  private authField(profileId: string, fieldId: string): void {
    const profile = this.catalog.effectiveProfile(this.settings, profileId);
    if (!profile.auth.some((field) => field.id === fieldId)) throw new Error("该 Provider 未声明此凭据字段。");
  }

  private hasCredentials(profileId: string): boolean {
    return this.catalog.state(this.settings, profileId, (id) => this.secrets.isConfigured(id)).credentialsReady;
  }

  private writeCapabilityOverrides(
    profileId: string,
    configuration: ProviderProfileConfiguration,
    capabilities: Partial<ProviderEnabledCapabilities>,
  ): void {
    const profile = this.catalog.get(profileId);
    const modelKey = configuration.selectedModel ?? "*";
    configuration.enabledCapabilitiesByModel ??= {};
    configuration.enabledCapabilitiesByModel[modelKey] = normalizeCapabilityOverrides(profile, capabilities);
  }

  private async persistAndSync(): Promise<void> {
    this.syncRegistry();
    await this.persist();
  }

  private async catalogRefreshFailure(
    configuration: ProviderProfileConfiguration,
    message: string,
    persist: boolean,
    attemptAt = this.now(),
  ): Promise<ModelCatalogRefreshResult> {
    const previous = ensureModelCatalog(configuration);
    configuration.modelCatalog = {
      ...previous,
      status: "failed",
      lastAttemptAt: attemptAt,
      removedModelIds: [...previous.removedModelIds],
      message,
    };
    configuration.connectionState = "failed";
    configuration.message = message;
    if (persist) await this.persist();
    return {
      status: "failed",
      models: [...configuration.models],
      removedModelIds: [...previous.removedModelIds],
      message,
    };
  }

  private syncRegistry(): void {
    for (const profile of this.catalog.list()) {
      const state = this.catalog.state(this.settings, profile.id, (id) => this.secrets.isConfigured(id));
      if (!state.selectable) {
        this.registry.unregister(profile.id);
        continue;
      }
      this.registry.register(createProfileProvider({
        profile: state.profile,
        configuration: state.configuration,
        allowExternalNetwork: this.allowExternalNetwork,
        resolveSecret: (fieldId) => this.secrets.readForProvider(providerSecretId(profile.id, fieldId)),
        fetchImpl: this.fetchImpl,
      }));
    }
  }

  private async persist(): Promise<void> {
    await this.persistence.saveProviderSettings(this.snapshot());
    this.publish();
  }

  private publish(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

function discoveryEndpoint(configured: string | undefined, generationEndpoint: string, defaultGenerationEndpoint?: string): string {
  const generationWasOverridden = Boolean(defaultGenerationEndpoint && generationEndpoint !== defaultGenerationEndpoint);
  if (!generationWasOverridden && configured && /^https?:\/\//u.test(configured)) return configured;
  const url = new URL(generationEndpoint);
  if (!generationWasOverridden && configured) {
    url.pathname = configured.startsWith("/") ? configured : `/${configured}`;
    return url.toString();
  }
  url.pathname = url.pathname
    .replace(/\/chat\/completions\/?$/u, "/models")
    .replace(/\/responses\/?$/u, "/models")
    .replace(/\/interactions\/?$/u, "/models");
  return url.toString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function ensureModelCatalog(configuration: ProviderProfileConfiguration): ModelCatalogState {
  configuration.modelCatalog ??= { status: "unknown", removedModelIds: [], message: "模型目录尚未刷新。" };
  configuration.modelCatalog.removedModelIds ??= [];
  return configuration.modelCatalog;
}
