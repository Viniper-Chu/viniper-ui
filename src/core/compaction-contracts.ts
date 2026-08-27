import { ProviderHistoryEntry } from "./provider-contracts";
import { TokenUsage } from "./telemetry-contracts";

export interface ContextSummaryGeneration {
  id: string;
  sessionId: string;
  providerId: string;
  modelId: string;
  generation: number;
  sourceHistoryIds: string[];
  text: string;
  createdAt: number;
  immutable: true;
  usage: TokenUsage;
  cache: { read: number | null; write: number | null; miss: number | null };
  status: "ready" | "failed";
  error?: string;
}

export interface ContextCompactionSnapshot {
  generations: ContextSummaryGeneration[];
  lastStatus?: "not-needed" | "generated" | "fallback";
}

export interface CompactionInput {
  sessionId: string;
  providerId: string;
  modelId: string;
  history: ProviderHistoryEntry[];
  thresholdChars?: number;
}
