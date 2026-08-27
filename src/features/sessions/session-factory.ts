import { PermissionMode, SessionSnapshot } from "../../core/contracts";
import { newId } from "../../core/ids";
import { buildCachePlan } from "../cache/cache-plan";
import { AgentEngineId, DEFAULT_AGENT_ENGINE } from "../../core/agent-engine-contracts";
import { engineScopedId } from "../../core/engine-identity";

export function createSessionSnapshot(
  workingDirectory: string,
  now = Date.now(),
  selectedModel = "demo-default",
  permissionMode: PermissionMode = "auto",
  projectAccess?: SessionSnapshot["projectAccess"],
  engineId: AgentEngineId = DEFAULT_AGENT_ENGINE,
): SessionSnapshot {
  const claudeCode = engineId === "claude-code";
  return {
    id: engineScopedId(engineId, "session", newId("session")),
    title: "新建 Agent 会话",
    workingDirectory,
    engineId,
    ...(projectAccess ? { projectAccess: { ...projectAccess } } : {}),
    selectedModel: claudeCode ? "claude-code-default" : selectedModel,
    selectedProviderId: claudeCode ? "claude-code" : "demo",
    permissionMode,
    messages: [],
    providerHistory: [],
    queue: [],
    activities: [],
    events: [],
    items: [],
    replayCursor: 0,
    status: "idle",
    unread: false,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    cachePlan: buildCachePlan(""),
  };
}
