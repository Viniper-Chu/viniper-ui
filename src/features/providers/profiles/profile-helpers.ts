import {
  CapabilityEvidence,
  ProviderAuthField,
  ProviderCapabilities,
  ProviderProfile,
} from "../../../core/provider-contracts";

export const bearerAuth = (): ProviderAuthField[] => [{
  id: "api-key",
  label: "API Key",
  placement: "header",
  name: "Authorization",
  prefix: "Bearer ",
  required: true,
}];

export const anthropicAuth = (): ProviderAuthField[] => [{
  id: "api-key",
  label: "API Key",
  placement: "header",
  name: "x-api-key",
  required: true,
}];

export function capabilities(
  stream: CapabilityEvidence,
  tools: CapabilityEvidence,
  reasoning: CapabilityEvidence,
  cache: CapabilityEvidence,
  usage: CapabilityEvidence,
): ProviderCapabilities {
  return { stream, tools, reasoning, cache, usage };
}

export function fixedProfile(input: Omit<ProviderProfile, "endpoint" | "modelDiscovery"> & {
  endpoint: string;
  modelsEndpoint?: string;
}): ProviderProfile {
  const { endpoint, modelsEndpoint, ...profile } = input;
  return {
    ...profile,
    endpoint: { mode: "fixed", defaultUrl: endpoint, placeholder: endpoint },
    modelDiscovery: modelsEndpoint ? { mode: "openai-models", endpoint: modelsEndpoint } : { mode: "manual" },
  };
}

export function manualProfile(input: Omit<ProviderProfile, "endpoint" | "modelDiscovery"> & {
  placeholder: string;
  regional?: boolean;
  modelsEndpoint?: string;
}): ProviderProfile {
  const { placeholder, regional, modelsEndpoint, ...profile } = input;
  return {
    ...profile,
    endpoint: { mode: regional ? "regional" : "manual", placeholder },
    modelDiscovery: modelsEndpoint ? { mode: "openai-models", endpoint: modelsEndpoint } : { mode: "manual" },
  };
}
