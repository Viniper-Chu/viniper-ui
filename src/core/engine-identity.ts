import { AgentEngineId } from "./agent-engine-contracts";

const ENGINE_PREFIX: Record<AgentEngineId, string> = {
  viniper: "viniper",
  "claude-code": "claude_code",
};

const PREFIX_ENGINE = new Map(Object.entries(ENGINE_PREFIX).map(([engineId, prefix]) => [prefix, engineId as AgentEngineId]));

export type EngineIdentityKind =
  | "session"
  | "run"
  | "event"
  | "item"
  | "queue"
  | "approval"
  | "envelope"
  | "wait"
  | "subagent"
  | "usage";

export function engineScopedId(engineId: AgentEngineId, kind: EngineIdentityKind, rawId: string): string {
  const safe = rawId.trim().replace(/[^A-Za-z0-9._-]+/gu, "_");
  if (!safe) throw new Error("ENGINE_IDENTITY_EMPTY: identity payload is empty");
  return `${ENGINE_PREFIX[engineId]}__${kind}__${safe}`;
}

export function engineScopeOf(value: string): AgentEngineId | undefined {
  const separator = value.indexOf("__");
  if (separator <= 0) return undefined;
  return PREFIX_ENGINE.get(value.slice(0, separator));
}

export function requireEngineOwnership(engineId: AgentEngineId, value: string): string {
  const owner = engineScopeOf(value);
  if (owner !== engineId) {
    throw new Error(`ENGINE_OWNER_MISMATCH: ${value} belongs to ${owner ?? "unscoped"}, expected ${engineId}`);
  }
  return value;
}

export function engineIdentityKey(engineId: AgentEngineId, value: string): string {
  const owner = engineScopeOf(value);
  if (owner && owner !== engineId) requireEngineOwnership(engineId, value);
  return `${ENGINE_PREFIX[engineId]}::${value}`;
}
