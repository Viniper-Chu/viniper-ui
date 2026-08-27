import { ProviderProfile, ProviderRequest } from "../../../core/provider-contracts";
import { isProviderCapabilityEnabled } from "../provider-capabilities";

export interface CacheProjection {
  body: Record<string, unknown>;
  headers: Record<string, string>;
  key: string;
  status: "configured" | "provider-reported" | "implicit" | "unconfirmed" | "unsupported";
}

export function projectCachePolicy(profile: ProviderProfile, request: ProviderRequest): CacheProjection {
  const key = stableCacheKey(request);
  if (!isProviderCapabilityEnabled(profile, "cache")) {
    return {
      body: {},
      headers: {},
      key,
      status: profile.capabilities.cache === "unsupported" ? "unsupported" : "unconfirmed",
    };
  }
  switch (profile.cachePolicyId) {
    case "openai-gpt":
      return isGpt56OrLater(request.selectedModel)
        ? {
            body: {
              prompt_cache_key: key,
              prompt_cache_options: { mode: "explicit", ttl: "30m" },
            },
            headers: {},
            key,
            status: "configured",
          }
        : { body: {}, headers: {}, key, status: "provider-reported" };
    case "anthropic-auto":
      return {
        body: { cache_control: { type: "ephemeral" } },
        headers: {},
        key,
        status: "configured",
      };
    case "xai":
      return {
        body: { prompt_cache_key: key },
        headers: {},
        key,
        status: "configured",
      };
    case "minimax-auto":
      return { body: {}, headers: {}, key, status: "implicit" };
    case "gemini-implicit":
      return { body: { store: false }, headers: {}, key, status: "implicit" };
    case "provider-reported":
      return { body: {}, headers: {}, key, status: "provider-reported" };
    case "mimo-local-history":
      return { body: {}, headers: {}, key, status: "provider-reported" };
    case "unsupported":
      return { body: {}, headers: {}, key, status: "unsupported" };
    default:
      return { body: {}, headers: {}, key, status: "unconfirmed" };
  }
}

export function stableCacheKey(request: ProviderRequest): string {
  return [
    request.profileId,
    request.selectedModel,
    `generation-${request.contextProfile.generation}`,
    `tools-${request.contextProfile.toolSchemaVersion}`,
  ].join(":");
}

function isGpt56OrLater(model: string): boolean {
  const match = /^gpt-5\.(\d+)/u.exec(model);
  return Boolean(match && Number(match[1]) >= 6);
}
