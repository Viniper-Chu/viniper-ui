import { IntentOrigin, QueuedIntent, SessionSnapshot } from "../../core/contracts";
import { ReviewPolicy, WorkspaceMode } from "../../core/programming-contracts";
import { newId } from "../../core/ids";
import { sessionAgentEngine } from "../../core/agent-engine-contracts";
import { engineScopedId } from "../../core/engine-identity";

export function enqueueIntent(
  session: SessionSnapshot,
  text: string,
  now: number,
  origin?: IntentOrigin,
  controls?: {
    workspaceMode?: WorkspaceMode;
    reviewPolicy?: ReviewPolicy;
    commitRequested?: boolean;
    memoryEnabled?: boolean;
    planning?: boolean;
    userText?: string;
  },
): QueuedIntent[] {
  const engineId = sessionAgentEngine(session.engineId);
  return [...session.queue, {
    id: engineScopedId(engineId, "queue", newId("queue")), engineId, sessionId: session.id, text, createdAt: now, origin,
    ...(controls?.workspaceMode ? { workspaceMode: controls.workspaceMode } : {}),
    ...(controls?.reviewPolicy ? { reviewPolicy: controls.reviewPolicy } : {}),
    ...(controls?.commitRequested !== undefined ? { commitRequested: controls.commitRequested } : {}),
    ...(controls?.memoryEnabled !== undefined ? { memoryEnabled: controls.memoryEnabled } : {}),
    ...(controls?.planning !== undefined ? { planning: controls.planning } : {}),
    ...(controls?.userText !== undefined ? { userText: controls.userText } : {}),
  }];
}

export function takeNextIntent(session: SessionSnapshot): { next?: QueuedIntent; remaining: QueuedIntent[] } {
  const [next, ...remaining] = session.queue;
  return { next, remaining };
}
