import { ProviderCapabilityName, ProviderDescriptor, ProviderProfile } from "../../core/provider-contracts";
import { DemoProvider } from "./demo-provider";
import { ModelProvider } from "./model-provider";
import { isProviderCapabilityEnabled } from "./provider-capabilities";
import { PROVIDER_PROFILES } from "./profiles";

export class ProviderRegistry {
  private readonly providers = new Map<string, ModelProvider>();
  private readonly descriptors: ProviderDescriptor[];

  constructor(demoDelayMs = 500, profiles: ProviderProfile[] = PROVIDER_PROFILES) {
    const demo = new DemoProvider(demoDelayMs);
    this.providers.set(demo.descriptor.id, demo);
    this.descriptors = [demo.descriptor, ...profiles.map(profilePlaceholder)];
  }

  get(id: string): ModelProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`Provider '${id}' 在 v1.6.0 Stable 中仅提供配置占位。`);
    return provider;
  }

  list(): ProviderDescriptor[] {
    return this.descriptors.map((descriptor) => ({
      ...descriptor,
      capabilities: [...descriptor.capabilities],
      models: descriptor.models.map((model) => ({ ...model })),
    }));
  }

  register(provider: ModelProvider): void {
    this.providers.set(provider.descriptor.id, provider);
    const index = this.descriptors.findIndex((descriptor) => descriptor.id === provider.descriptor.id);
    const descriptor = { ...provider.descriptor, capabilities: [...provider.descriptor.capabilities], models: [...provider.descriptor.models] };
    if (index >= 0) this.descriptors[index] = descriptor;
    else this.descriptors.push(descriptor);
  }

  registerDescriptor(descriptor: ProviderDescriptor): void {
    const index = this.descriptors.findIndex((item) => item.id === descriptor.id);
    const copy = { ...descriptor, capabilities: [...descriptor.capabilities], models: descriptor.models.map((model) => ({ ...model })) };
    if (index >= 0) this.descriptors[index] = copy;
    else this.descriptors.push(copy);
  }

  unregister(id: string): void {
    if (id === "demo") return;
    this.providers.delete(id);
    const descriptor = this.descriptors.find((item) => item.id === id);
    if (descriptor) {
      descriptor.available = false;
      descriptor.configuration = "not-connected";
      descriptor.realCallsEnabled = false;
      descriptor.models = [];
    }
  }
}

function profilePlaceholder(profile: ProviderProfile): ProviderDescriptor {
  return {
    id: profile.id,
    name: profile.label,
    label: `${profile.label} · ${profile.protocol} · 尚未连接`,
    configuration: "not-connected",
    available: false,
    realCallsEnabled: false,
    capabilities: Object.entries(profile.capabilities)
      .filter(([capability]) => isProviderCapabilityEnabled(profile, capability as ProviderCapabilityName))
      .map(([capability]) => capability),
    models: [],
    protocol: profile.protocol,
  };
}
