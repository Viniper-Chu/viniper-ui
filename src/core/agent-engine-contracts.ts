export type AgentEngineId = "viniper" | "claude-code";

export type AgentEngineCapabilityStatus = "supported" | "adapter" | "unavailable" | "unproven";

export interface AgentEngineCapability {
  id: "conversation" | "streaming" | "tools" | "permissions" | "queue" | "cancel" | "steering" | "attachments";
  label: string;
  status: AgentEngineCapabilityStatus;
  note: string;
}

export interface AgentEngineSnapshot {
  id: AgentEngineId;
  name: "Viniper" | "Claude code";
  runtime: "harness-runtime" | "claude-code-adapter";
  status: "ready" | "unavailable";
  version?: string;
  transport: "application-port" | "native-cli" | "wsl-cli" | "not-detected";
  summary: string;
  commonActions: Array<"create-session" | "open-project" | "send" | "cancel" | "rename" | "set-model" | "set-permission">;
  capabilities: AgentEngineCapability[];
}

export interface ClaudeCodeCommandSpec {
  executable: string;
  prefixArgs: string[];
  transport: "native-cli" | "wsl-cli";
  version: string;
  useSpawnCwd: boolean;
}

export interface ClaudeCodeProbeResult {
  available: boolean;
  transport: "native-cli" | "wsl-cli" | "not-detected";
  version?: string;
  message: string;
  command?: ClaudeCodeCommandSpec;
}

export const DEFAULT_AGENT_ENGINE: AgentEngineId = "viniper";

export function sessionAgentEngine(engineId?: AgentEngineId): AgentEngineId {
  return engineId === "claude-code" ? "claude-code" : DEFAULT_AGENT_ENGINE;
}
