import { AgentEngineId } from "./agent-engine-contracts";

export type RuntimeErrorPhase = "initialization" | "queue" | "provider" | "permission" | "tool" | "persistence" | "terminal" | "coordination" | "finalization";

export interface RuntimeErrorEnvelope {
  code: string;
  message: string;
  phase: RuntimeErrorPhase;
  retryable: boolean;
  retryAfterMs?: number;
  engineId: AgentEngineId;
  sessionId: string;
  turnId?: string;
  itemId?: string;
  causeCode?: string;
  occurredAt: number;
}

export function runtimeErrorEnvelope(
  error: unknown,
  context: Omit<RuntimeErrorEnvelope, "message" | "occurredAt"> & { occurredAt?: number },
): RuntimeErrorEnvelope {
  const message = error instanceof Error ? error.message : String(error);
  const causeCode = error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
  return {
    ...context,
    message,
    occurredAt: context.occurredAt ?? Date.now(),
    ...(causeCode ? { causeCode } : {}),
  };
}
