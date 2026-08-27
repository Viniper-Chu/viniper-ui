import { AgentEngineId } from "./agent-engine-contracts";

export type UsageSource = "estimated" | "provider";

export interface TokenUsage {
  input: number;
  cacheHitInput: number | null;
  cacheMissInput: number | null;
  cacheWriteInput: number | null;
  output: number;
  reasoning: number;
  toolUse: number;
  total: number;
  source: UsageSource;
}

export interface RunUsageSnapshot {
  engineId?: AgentEngineId;
  runId: string;
  sessionId: string;
  usage: TokenUsage;
  status: "estimating" | "reconciled" | "unreconciled";
  startedAt: number;
  updatedAt: number;
}

export interface SessionUsageSummary {
  engineId?: AgentEngineId;
  sessionId: string;
  cumulative: TokenUsage;
  currentRun?: RunUsageSnapshot;
  latestRun?: RunUsageSnapshot;
}

export interface EngineUsageSummary {
  engineId: AgentEngineId;
  sessions: SessionUsageSummary[];
  cumulative: TokenUsage;
}

export interface TelemetrySnapshot {
  sessions: SessionUsageSummary[];
  appCumulative: TokenUsage;
  engines: EngineUsageSummary[];
}
