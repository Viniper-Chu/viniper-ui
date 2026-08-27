import type { CachePlan, ContextProfile, PermissionMode } from "./contracts";
import type { ProviderToolDefinition } from "./provider-contracts";
import type { FrozenProviderSnapshot, ReviewPolicy } from "./programming-contracts";

export type CompositionKind =
  | "tool"
  | "skill-source"
  | "prompt-section"
  | "interceptor"
  | "workflow"
  | "model-provider"
  | "semantic-navigation";

export type CompositionHost = "desktop" | "cli" | "any";
export type CompositionSessionScope = "all" | "selected" | "project";
export type CompositionPreset = "standard" | "deepseek-efficient" | "minimal" | "custom";

export interface CapabilityDefinition {
  id: string;
  version: string;
  kind: CompositionKind;
  source: string;
  hostScope?: CompositionHost[];
  sessionScope?: CompositionSessionScope;
  required?: boolean;
  dependencies?: string[];
  conflicts?: string[];
  before?: string[];
  after?: string[];
  trust?: "builtin" | "trusted" | "user-confirmed" | "untrusted";
  permissionNeeds?: string[];
  presentation?: { label: string; description?: string; category?: string };
  presets?: CompositionPreset[];
}

export interface CompositionDecision {
  id: string;
  version?: string;
  kind?: CompositionKind;
  source?: string;
  enabled: boolean;
  reason: string;
  order?: number;
  presentation?: CapabilityDefinition["presentation"];
}

export interface CompositionPlan {
  revision: number;
  preset: CompositionPreset;
  /** Concrete saved name when preset is custom; preserved in each run snapshot. */
  customName?: string;
  host: CompositionHost;
  sessionScope: CompositionSessionScope;
  enabled: CompositionDecision[];
  blocked: CompositionDecision[];
  order: string[];
  presentation: {
    label: string;
    summary: string;
    enabledCount: number;
    blockedCount: number;
  };
}

export interface CompositionCompileInput {
  host: CompositionHost;
  preset: CompositionPreset;
  sessionScope?: CompositionSessionScope;
  enabledIds?: string[];
  customPreset?: string;
}

export interface CustomCompositionPreset {
  name: string;
  enabledIds: string[];
  order?: string[];
}

export interface CompositionPresetDescriptor {
  id: CompositionPreset;
  label: string;
  purpose: string;
  modelRecommendations: string[];
  capabilities: string[];
  dependencies: string[];
  conflicts: string[];
  blockers: string[];
  trust: "builtin" | "user-confirmed";
  permissionNeeds: string[];
  frozen: "current-run" | "next-run";
}

export interface CompositionCenterSnapshot {
  current: CompositionPlan;
  presets: CompositionPresetDescriptor[];
  custom: CustomCompositionPreset[];
  customSelected?: string;
}

/** The small immutable shape that the run context carries for a loaded Skill. */
export interface FrozenSkillSnapshot {
  id: string;
  version: string;
  body: string;
  name?: string;
  description?: string;
  source?: string;
}

export interface FrozenExtensionSnapshot {
  [extensionId: string]: {
    version?: string;
    trusted: boolean;
    enabled: boolean;
    tools: string[];
    capabilities?: string[];
  };
}

export interface FrozenProjectInstructions {
  status: "loaded" | "not-configured" | "error";
  text?: string;
  source?: string;
}

export interface FrozenPermissionSnapshot {
  mode: PermissionMode;
  access?: string;
}

export interface FrozenRunContext {
  readonly runId: string;
  readonly sessionId: string;
  readonly provider: Readonly<FrozenProviderSnapshot>;
  readonly composition: Readonly<CompositionPlan>;
  readonly toolDescriptors: readonly ProviderToolDefinition[];
  readonly skills: readonly FrozenSkillSnapshot[];
  readonly extensions: Readonly<FrozenExtensionSnapshot>;
  readonly projectInstructions: Readonly<FrozenProjectInstructions>;
  readonly permission: Readonly<FrozenPermissionSnapshot>;
  readonly review: Readonly<{ policy: ReviewPolicy }>;
  readonly cache: Readonly<{
    stablePrefix: string;
    generation: number;
    plan?: CachePlan;
    profile?: ContextProfile;
  }>;
  readonly workflow: Readonly<{ enabled: boolean; mode?: string }>;
  readonly steering: Readonly<{ inboxId: string; enabled?: boolean }>;
}

export type FrozenRunContextInput = Omit<FrozenRunContext, "provider" | "composition" | "toolDescriptors" | "skills" | "extensions" | "projectInstructions" | "permission" | "review" | "cache" | "workflow" | "steering"> & {
  provider: FrozenProviderSnapshot;
  composition: CompositionPlan;
  toolDescriptors: ProviderToolDefinition[];
  skills: FrozenSkillSnapshot[];
  extensions: FrozenExtensionSnapshot;
  projectInstructions: FrozenProjectInstructions;
  permission: FrozenPermissionSnapshot;
  review: { policy: ReviewPolicy };
  cache: { stablePrefix: string; generation: number; plan?: CachePlan; profile?: ContextProfile };
  workflow: { enabled: boolean; mode?: string };
  steering: { inboxId: string; enabled?: boolean };
};
