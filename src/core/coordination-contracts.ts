import { AgentEngineId } from "./agent-engine-contracts";

export type CoordinationEnvelopeType = "message" | "delegation" | "result";
export type CoordinationEnvelopeStatus = "sent" | "delivered" | "read" | "completed";

export interface CoordinationEnvelope {
  id: string;
  /** Present on every newly-written envelope; inferred for legacy rows. */
  engineId?: AgentEngineId;
  revision: number;
  sourceSessionId: string;
  targetSessionId: string;
  type: CoordinationEnvelopeType;
  status: CoordinationEnvelopeStatus;
  body: string;
  createdAt: number;
  updatedAt: number;
  correlationId?: string;
  delegationId?: string;
}

export interface CoordinationWait {
  id: string;
  /** Present on every newly-written wait; inferred for legacy snapshots. */
  engineId?: AgentEngineId;
  sessionId: string;
  fromSessionId?: string;
  envelopeType?: CoordinationEnvelopeType;
  correlationId?: string;
  createdAt: number;
  timeoutAt?: number;
}

export interface CoordinationLink {
  engineId?: AgentEngineId;
  sourceSessionId: string;
  targetSessionId: string;
  type: CoordinationEnvelopeType;
  timestamp: number;
}

export interface CoordinationSnapshot {
  envelopes: CoordinationEnvelope[];
  waits: CoordinationWait[];
  unreadBySession: Array<{ sessionId: string; count: number }>;
  recentLinks: CoordinationLink[];
}
