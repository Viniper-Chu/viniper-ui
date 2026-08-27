export type SkillSourceKind = "built-in" | "external-declarative";

export interface SkillMetadata {
  id: string;
  name: string;
  description: string;
  source: SkillSourceKind;
  packagePath: string;
}

export interface LoadedSkill extends SkillMetadata {
  body: string;
}

export interface SkillState extends SkillMetadata {
  enabledSessionIds: string[];
  loaded: boolean;
}

export interface PluginManifestV1 {
  manifestVersion: 1;
  id: string;
  name: string;
  version: string;
  capabilities: string[];
  skills: string[];
  tools: string[];
  providers: string[];
}

export interface PluginRecord {
  id: string;
  name: string;
  version: string;
  classification: "built-in" | "external-declarative" | "invalid";
  capabilities: string[];
  skills: string[];
  tools: string[];
  providers: string[];
  executable: boolean;
  error?: string;
}

/** CP5 受管扩展来源。公共来源只登记来源，不代表已经信任或可执行。 */
export type ExtensionSourceKind =
  | "built-in"
  | "official"
  | "community"
  | "custom"
  | "local"
  | "marketplace-fixture";

export type ExtensionKind = "skill" | "mcp" | "executable-plugin";
export type ExtensionTrust = "untrusted" | "trusted";
export type ExtensionLifecycleStatus = "staged" | "installed" | "enabled" | "disabled" | "failed";

export interface ManagedExtensionManifestV1 {
  manifestVersion: 1;
  id: string;
  name: string;
  version: string;
  kind: ExtensionKind;
  source: ExtensionSourceKind;
  capabilities: string[];
  tools?: string[];
  entry?: string;
  mcpEndpoint?: string;
}

export interface StagedExtensionPackage {
  stagingId: string;
  source: ExtensionSourceKind;
  packagePath: string;
  manifest: ManagedExtensionManifestV1;
}

export interface ExtensionVersionState {
  version: string;
  source: ExtensionSourceKind;
  capabilities: string[];
  tools: string[];
  entry?: string;
  packagePath: string;
  installedAt: number;
}

export interface ExtensionRecord {
  id: string;
  name: string;
  kind: ExtensionKind;
  source: ExtensionSourceKind;
  trust: ExtensionTrust;
  status: ExtensionLifecycleStatus;
  enabled: boolean;
  executable: boolean;
  capabilities: string[];
  current?: ExtensionVersionState;
  previous?: ExtensionVersionState;
  pendingUpdate?: { stagingId: string; version: string; capabilities: string[] };
  pendingRollback?: boolean;
  failure?: string;
}

export interface McpConnectionState {
  id: string;
  endpoint: string;
  configured: boolean;
  connected: boolean;
  lastError?: string;
}

export interface ExtensionSnapshot {
  skills: SkillState[];
  plugins: PluginRecord[];
  unknownCodePolicy: "not-executed";
  records?: ExtensionRecord[];
  staged?: StagedExtensionPackage[];
  mcpConnections?: McpConnectionState[];
}

export interface PersistedExtensionMetadata {
  enabledSkillsBySession: Record<string, string[]>;
  records?: ExtensionRecord[];
  staged?: StagedExtensionPackage[];
  mcpConnections?: McpConnectionState[];
}
