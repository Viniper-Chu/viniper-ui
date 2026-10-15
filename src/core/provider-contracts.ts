import type { CachePlan, ContextProfile, PermissionMode } from "./contracts";
import type { FrozenRunContext } from "./composition-contracts";
import type { TokenUsage } from "./telemetry-contracts";
import type {
  GeminiServerStateSettings,
  ModelCatalogState,
  ProviderNetworkSettings,
  ProviderNetworkSnapshot,
} from "./provider-runtime-contracts";

export type ProviderProtocolFamily =
  | "openai-responses"
  | "anthropic-messages"
  | "gemini-interactions"
  | "openai-chat"
  | "sensenova";

export type ProviderCategory = "international" | "domestic-model" | "domestic-platform" | "custom";
export type CapabilityEvidence =
  | "officially-documented"
  | "profile-dependent"
  | "manual-unconfirmed"
  | "unsupported";

export interface ProviderCapabilities {
  stream: CapabilityEvidence;
  tools: CapabilityEvidence;
  reasoning: CapabilityEvidence;
  cache: CapabilityEvidence;
  usage: CapabilityEvidence;
}

export type ProviderCapabilityName = keyof ProviderCapabilities;
export type ProviderEnabledCapabilities = Record<ProviderCapabilityName, boolean>;

export interface ProviderEndpointProfile {
  mode: "fixed" | "regional" | "manual";
  defaultUrl?: string;
  placeholder: string;
}

export interface ProviderAuthField {
  id: string;
  label: string;
  placement: "header" | "query";
  name: string;
  prefix?: string;
  required: boolean;
}

export interface ProviderModelDiscovery {
  mode: "openai-models" | "manual";
  endpoint?: string;
}

export interface ProviderProfile {
  id: string;
  label: string;
  category: ProviderCategory;
  vendor: string;
  protocol: ProviderProtocolFamily;
  endpoint: ProviderEndpointProfile;
  auth: ProviderAuthField[];
  staticHeaders?: Record<string, string>;
  modelDiscovery: ProviderModelDiscovery;
  capabilities: ProviderCapabilities;
  enabledCapabilities?: ProviderEnabledCapabilities;
  evidenceLevel: Exclude<CapabilityEvidence, "unsupported">;
  evidenceLabel: string;
  documentation: string[];
  cachePolicyId: string;
  continuationMode: "server-optional" | "local-history" | "stateless";
  preserveReasoningItems?: boolean;
  currentModels?: string[];
}

export interface ProviderProfileConfiguration {
  profileId: string;
  endpoint?: string;
  models: string[];
  selectedModel?: string;
  customAuthMode?: "bearer" | "x-api-key" | "api-key";
  enabledCapabilitiesByModel?: Record<string, Partial<ProviderEnabledCapabilities>>;
  connectionState: "not-configured" | "ready" | "checking" | "connected" | "failed";
  message: string;
  lastCheckedAt?: number;
  modelCatalog?: ModelCatalogState;
  network?: ProviderNetworkSettings;
  geminiServerState?: GeminiServerStateSettings;
}

export interface ProviderProfileState {
  profile: ProviderProfile;
  configuration: ProviderProfileConfiguration;
  enabledCapabilities: ProviderEnabledCapabilities;
  configuredFields: Array<{ fieldId: string; configured: boolean }>;
  endpointReady: boolean;
  credentialsReady: boolean;
  selectable: boolean;
  realApiStatus: "REAL_API_UNPROVEN";
  network: ProviderNetworkSnapshot;
  geminiServerState: GeminiServerStateSettings;
}

export interface ProviderCatalogSnapshot {
  profiles: ProviderProfileState[];
  categories: Array<{ id: ProviderCategory; label: string; count: number }>;
  realApiStatus: "REAL_API_UNPROVEN";
}

export interface ProviderDescriptor {
  id: string;
  name: string;
  label: string;
  configuration: "demo" | "configured" | "not-connected";
  available: boolean;
  realCallsEnabled: boolean;
  capabilities: string[];
  models: Array<{ id: string; label: string }>;
  protocol?: ProviderProtocolFamily;
}

export interface ProviderTextItem {
  type: "text";
  text: string;
}

export interface ProviderReasoningItem {
  type: "reasoning";
  text: string;
  itemId?: string;
  providerId?: string;
}

export interface ProviderToolCallItem {
  type: "tool-call";
  callId: string;
  parentCallId?: string;
  name: string;
  arguments: Record<string, unknown>;
  argumentsText: string;
  argumentsError?: "output-limit" | "invalid-json";
  protocolItemId?: string;
}

export interface ProviderToolResultItem {
  type: "tool-result";
  callId: string;
  name: string;
  content: string;
  isError: boolean;
  providerUsage?: TokenUsage;
}

export interface ProviderContinuationItem {
  type: "continuation";
  responseId?: string;
  interactionId?: string;
}

export interface ProviderModelStepItem {
  type: "provider-step";
  protocol: ProviderProtocolFamily;
  step: Record<string, unknown>;
}

export type ProviderContentItem =
  | ProviderTextItem
  | ProviderReasoningItem
  | ProviderToolCallItem
  | ProviderToolResultItem
  | ProviderContinuationItem
  | ProviderModelStepItem;

export interface ProviderHistoryEntry {
  id: string;
  role: "user" | "assistant" | "tool";
  items: ProviderContentItem[];
}

export interface JsonSchema {
  type: "object";
  properties?: Record<string, { type: "string" | "number" | "boolean" | "object" | "array"; description?: string }>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ProviderToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  readOnly: boolean;
  permission: "auto-read-only" | "approval-required";
}

export interface ProviderRequest {
  /** Runtime-owned engine namespace; mandatory for new Runtime requests. */
  engineId?: import("./agent-engine-contracts").AgentEngineId;
  sessionId: string;
  /** Runtime-owned working root; adapters may use it but Renderer never supplies it. */
  workingDirectory?: string;
  runId?: string;
  profileId: string;
  selectedModel: string;
  permissionMode: PermissionMode;
  history: ProviderHistoryEntry[];
  currentUserText?: string;
  tools: ProviderToolDefinition[];
  cachePlan: CachePlan;
  contextProfile: ContextProfile;
  reasoning?: string;
  /** The immutable run snapshot used by Provider projection and tool loop. */
  frozenRunContext?: FrozenRunContext;
}

export interface LocalContextReduction {
  inputBefore: number;
  inputAfter: number;
  outputReserved: number;
  historyTurns: number;
  toolResults: number;
}

export type ProviderActivityEvent = Extract<ProviderEvent, { kind: "provider.request.started" | "provider.activity" }>;

export type ProviderEvent =
  | { kind: "provider.request.started"; phase: "local-prefill" | "local-image"; timeoutSeconds: number; inputCount: number }
  | { kind: "provider.activity"; phase: "tool-input" | "image-output"; receivedCharacters: number }
  | { kind: "context.budget"; inputCount: number; windowSize: number; outputReserved: number }
  | ({ kind: "context.compacted" } & LocalContextReduction)
  | { kind: "thinking.started" }
  | { kind: "thinking.completed" }
  | { kind: "text.delta"; text: string }
  | { kind: "provider-tool.started"; callId: string; name: string }
  | { kind: "provider-tool.completed"; callId: string; isError: boolean }
  | { kind: "provider-permission.confirmed"; mode: string }
  | { kind: "provider-permission.completed"; deniedCount: number }
  | { kind: "provider.failed"; code: string; message: string }
  | { kind: "reasoning.delta"; text: string; itemId?: string }
  | { kind: "reasoning.completed"; item: ProviderReasoningItem }
  | { kind: "tool-call.completed"; call: ProviderToolCallItem }
  | { kind: "continuation.updated"; item: ProviderContinuationItem }
  | { kind: "model-step.completed"; item: ProviderModelStepItem }
  | { kind: "usage.estimated"; usage: TokenUsage }
  | { kind: "usage.completed"; usage: TokenUsage };
