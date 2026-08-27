import {
  ProviderCapabilityName,
  ProviderEnabledCapabilities,
  ProviderProfile,
  ProviderProfileConfiguration,
} from "../../core/provider-contracts";

export const PROVIDER_CAPABILITY_NAMES: ProviderCapabilityName[] = [
  "stream",
  "tools",
  "reasoning",
  "cache",
  "usage",
];

export function resolveEnabledCapabilities(
  profile: ProviderProfile,
  configuration?: ProviderProfileConfiguration,
): ProviderEnabledCapabilities {
  const profileOverrides = configuration?.enabledCapabilitiesByModel?.["*"] ?? {};
  const modelOverrides = configuration?.selectedModel
    ? configuration.enabledCapabilitiesByModel?.[configuration.selectedModel] ?? {}
    : {};
  const overrides = { ...profileOverrides, ...modelOverrides };
  return Object.fromEntries(PROVIDER_CAPABILITY_NAMES.map((name) => {
    const evidence = profile.capabilities[name];
    if (evidence === "unsupported") return [name, false];
    if (overrides[name] !== undefined) return [name, Boolean(overrides[name])];
    return [name, evidence === "officially-documented"];
  })) as ProviderEnabledCapabilities;
}

export function withEnabledCapabilities(
  profile: ProviderProfile,
  configuration?: ProviderProfileConfiguration,
): ProviderProfile {
  return {
    ...profile,
    enabledCapabilities: configuration
      ? resolveEnabledCapabilities(profile, configuration)
      : profile.enabledCapabilities ?? resolveEnabledCapabilities(profile),
  };
}

export function isProviderCapabilityEnabled(profile: ProviderProfile, name: ProviderCapabilityName): boolean {
  return profile.enabledCapabilities?.[name] ?? profile.capabilities[name] === "officially-documented";
}

export function normalizeCapabilityOverrides(
  profile: ProviderProfile,
  requested: Partial<ProviderEnabledCapabilities>,
): Partial<ProviderEnabledCapabilities> {
  return Object.fromEntries(PROVIDER_CAPABILITY_NAMES.map((name) => [
    name,
    profile.capabilities[name] === "unsupported" ? false : Boolean(requested[name]),
  ])) as Partial<ProviderEnabledCapabilities>;
}
