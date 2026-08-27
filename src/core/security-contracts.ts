export interface SecretReference {
  id: string;
  configured: boolean;
  updatedAt: number;
}

export interface SecretSnapshot {
  encryptionAvailable: boolean;
  references: SecretReference[];
  message: string;
}

export interface ProviderConnectionSettings {
  schemaVersion: 2;
  profiles: Record<string, import("./provider-contracts").ProviderProfileConfiguration>;
}

export interface LegacyProviderConnectionSettings {
  deepseekBaseUrl: string;
  deepseekModels: string[];
  deepseekLastCheckedAt?: number;
  deepseekConnectionState: "not-configured" | "ready" | "checking" | "connected" | "failed";
  deepseekMessage: string;
}
