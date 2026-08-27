export type ModelCatalogStatus = "unknown" | "checking" | "current" | "changed" | "failed";

export interface ModelCatalogState {
  status: ModelCatalogStatus;
  lastSuccessfulAt?: number;
  lastAttemptAt?: number;
  removedModelIds: string[];
  message: string;
}

export type ProviderNetworkMode = "system" | "profile";

export interface ProviderNetworkSettings {
  mode: ProviderNetworkMode;
  proxyUrl?: string;
  proxyKind?: "http" | "https" | "socks";
  proxyCredentialRef?: string;
  customCaRef?: string;
  tlsVerification: "required";
}

export interface ProviderNetworkSnapshot {
  mode: ProviderNetworkMode;
  proxyConfigured: boolean;
  proxyHost?: string;
  customCaConfigured: boolean;
  tlsVerification: "required";
}

export interface GeminiServerStateBoundary {
  save: string;
  retention: string;
  delete: string;
}

export interface GeminiServerStateSettings {
  enabled: boolean;
  boundary?: GeminiServerStateBoundary;
  localHistoryAuthoritative: true;
  remoteDeleteOnDisable: false;
}

export interface ProviderAttemptSnapshot {
  attempt: number;
  maxAttempts: number;
  status: "idle" | "running" | "waiting" | "succeeded" | "failed";
  errorKind?: string;
}
