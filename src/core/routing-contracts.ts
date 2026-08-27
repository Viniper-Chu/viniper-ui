import { IntentOrigin } from "./contracts";

export type SmartRoutingStrategy = "quality" | "balanced" | "lightweight";

export interface RoutingCandidate {
  providerId: string;
  modelId: string;
  label: string;
  capabilities: string[];
  cacheImpact: "reusable" | "unknown" | "none";
}

export interface RoutingDecision extends RoutingCandidate {
  mode: "fixed" | "smart";
  enabled: boolean;
  eligible: boolean;
  fallback: boolean;
  reason: string;
  frozenAt: number;
}

export interface RoutingSnapshot {
  enabled: boolean;
  strategy: SmartRoutingStrategy;
  lastDecision?: RoutingDecision;
}

export interface RoutingInput {
  origin: IntentOrigin;
  providerId: string;
  modelId: string;
}
