import {
  ActivityRecord,
  AgentMessage,
  CachePlan,
  RuntimeEvent,
  RuntimeItemKind,
  RuntimeItemSnapshot,
  SessionSnapshot,
} from "../../core/contracts";
import { ProviderHistoryEntry } from "../../core/provider-contracts";
import { sessionAgentEngine } from "../../core/agent-engine-contracts";

function findMessage(session: SessionSnapshot, messageId: string): AgentMessage | undefined {
  return session.messages.find((message) => message.id === messageId);
}

function findActivity(session: SessionSnapshot, activityId: string): ActivityRecord | undefined {
  return session.activities.find((activity) => activity.id === activityId);
}

export function applyRuntimeEvent<TPayload>(session: SessionSnapshot, event: RuntimeEvent<TPayload>): void {
  if (session.events.some((existing) => existing.id === event.id)) return;
  if (event.sequence !== undefined && event.sequence <= (session.replayCursor ?? 0)) return;
  session.events.push(event as RuntimeEvent);
  if (event.sequence !== undefined) session.replayCursor = Math.max(session.replayCursor ?? 0, event.sequence);
  session.updatedAt = event.timestamp;

  switch (event.type) {
    case "session.updated": {
      const patch = event.payload as Partial<SessionSnapshot>;
      if (typeof patch.reasoning === "string") session.reasoning = patch.reasoning;
      if (typeof patch.title === "string") session.title = patch.title;
      if (typeof patch.workingDirectory === "string") session.workingDirectory = patch.workingDirectory;
      if (patch.projectAccess?.enabled === true) session.projectAccess = { ...patch.projectAccess };
      if (typeof patch.selectedModel === "string") session.selectedModel = patch.selectedModel;
      if (typeof patch.selectedProviderId === "string") session.selectedProviderId = patch.selectedProviderId;
      if (patch.engineId === "viniper" || patch.engineId === "claude-code") session.engineId = patch.engineId;
      if (patch.permissionMode === "ask" || patch.permissionMode === "review" || patch.permissionMode === "auto" || patch.permissionMode === "full" || patch.permissionMode === "plan") {
        session.permissionMode = patch.permissionMode;
      }
      if (typeof patch.pinned === "boolean") session.pinned = patch.pinned;
      if (typeof patch.unread === "boolean") session.unread = patch.unread;
      if (patch.cachePlan) session.cachePlan = patch.cachePlan as CachePlan;
      if (patch.projectInstructions) session.projectInstructions = { ...patch.projectInstructions };
      if (Object.prototype.hasOwnProperty.call(patch, "waitingFor")) {
        if (patch.waitingFor) session.waitingFor = patch.waitingFor;
        else delete session.waitingFor;
        if (activeRunIds(session).length === 0 && session.queue.length === 0) {
          session.status = session.waitingFor ? "waiting" : "idle";
        }
      }
      break;
    }
    case "message.user": {
      const message = (event.payload as { message: AgentMessage }).message;
      if (!findMessage(session, message.id)) {
        session.messages.push(withMessageOwner(message, session, event));
      }
      break;
    }
    case "message.delta": {
      const payload = event.payload as { messageId: string; text: string; createdAt: number };
      let message = findMessage(session, payload.messageId);
      if (!message) {
        message = {
          id: payload.messageId,
          engineId: sessionAgentEngine(event.engineId ?? session.engineId),
          sessionId: session.id,
          turnId: event.turnId,
          itemId: event.itemId ?? payload.messageId,
          role: "assistant",
          text: "",
          createdAt: payload.createdAt,
          status: "streaming",
        };
        session.messages.push(message);
      }
      message.text += payload.text;
      message.status = "streaming";
      break;
    }
    case "message.completed": {
      const payload = event.payload as { messageId: string; text: string; createdAt: number };
      let message = findMessage(session, payload.messageId);
      if (!message) {
        message = {
          id: payload.messageId,
          engineId: sessionAgentEngine(event.engineId ?? session.engineId),
          sessionId: session.id,
          turnId: event.turnId,
          itemId: event.itemId ?? payload.messageId,
          role: "assistant",
          text: payload.text,
          createdAt: payload.createdAt,
          status: "completed",
        };
        session.messages.push(message);
      } else {
        message.text = payload.text;
        message.status = "completed";
      }
      break;
    }
    case "message.cancelled": {
      const message = findMessage(session, (event.payload as { messageId: string }).messageId);
      if (message) message.status = "cancelled";
      break;
    }
    case "provider.history.appended":
      session.providerHistory.push(...(event.payload as { entries: ProviderHistoryEntry[] }).entries);
      break;
    case "thinking.started":
    case "tool.requested":
    case "interaction.requested":
      session.activities.push(withActivityOwner(event.payload as ActivityRecord, session, event));
      break;
    case "thinking.completed": {
      const activity = findActivity(session, (event.payload as { activityId: string }).activityId);
      if (activity) activity.status = "completed";
      break;
    }
    case "interaction.resolved": {
      const payload = event.payload as { activityId: string; decision: "allow-once" | "reject"; detail: string };
      const activity = findActivity(session, payload.activityId);
      if (activity) {
        activity.status = payload.decision === "allow-once" ? "completed" : "failed";
        activity.detail = payload.detail;
      }
      break;
    }
    case "thinking.delta": {
      const payload = event.payload as { activityId: string; text: string };
      const activity = findActivity(session, payload.activityId);
      if (activity) activity.detail += payload.text;
      break;
    }
    case "tool.completed": {
      const payload = event.payload as { activityId: string; result: string; presentation?: ActivityRecord["presentation"] };
      const activity = findActivity(session, payload.activityId);
      if (activity) {
        activity.status = "completed";
        activity.detail = payload.result;
        if (payload.presentation) activity.presentation = JSON.parse(JSON.stringify(payload.presentation));
      }
      break;
    }
    case "tool.failed": {
      const payload = event.payload as { activityId: string; result: string; presentation?: ActivityRecord["presentation"] };
      const activity = findActivity(session, payload.activityId);
      if (activity) {
        activity.status = "failed";
        activity.detail = payload.result;
        if (payload.presentation) activity.presentation = JSON.parse(JSON.stringify(payload.presentation));
      }
      break;
    }
    case "tool.cancelled": {
      const payload = event.payload as { activityId: string; result: string; presentation?: ActivityRecord["presentation"] };
      const activity = findActivity(session, payload.activityId);
      if (activity) {
        activity.status = "cancelled";
        activity.detail = payload.result;
        if (payload.presentation) activity.presentation = JSON.parse(JSON.stringify(payload.presentation));
      }
      break;
    }
    case "run.started": {
      const runId = (event.payload as { runId: string }).runId;
      addActiveRun(session, runId);
      session.status = "running";
      break;
    }
    case "run.queued":
      if (activeRunIds(session).length === 0) session.status = "queued";
      break;
    case "run.completed": {
      removeActiveRun(session, (event.payload as { runId: string }).runId);
      if (activeRunIds(session).length === 0) {
        session.status = session.queue.length > 0 ? "queued" : session.waitingFor ? "waiting" : "idle";
      }
      break;
    }
    case "run.cancelled": {
      const runId = (event.payload as { runId: string }).runId;
      removeActiveRun(session, runId);
      if (activeRunIds(session).length === 0) {
        session.status = session.queue.length > 0 ? "queued" : session.waitingFor ? "waiting" : "cancelled";
      }
      for (const activity of session.activities) {
        if (activity.status === "running" && (!activity.runId || activity.runId === runId)) activity.status = "cancelled";
      }
      break;
    }
    case "run.failed": {
      const runId = (event.payload as { runId: string }).runId;
      removeActiveRun(session, runId);
      if (activeRunIds(session).length === 0) session.status = "failed";
      for (const activity of session.activities) {
        if (activity.status === "running" && (!activity.runId || activity.runId === runId)) activity.status = "failed";
      }
      session.activities.push(withActivityOwner(
        { ...(event.payload as { activity: ActivityRecord }).activity, runId },
        session,
        event,
      ));
      break;
    }
    case "run.listener-failed":
      session.activities.push(withActivityOwner((event.payload as { activity: ActivityRecord }).activity, session, event));
      break;
    case "queue.updated":
      session.queue = [...(event.payload as { queue: SessionSnapshot["queue"] }).queue];
      if (session.queue.length > 0 && activeRunIds(session).length === 0) session.status = "queued";
      break;
    case "plan.updated":
      session.plan = JSON.parse(JSON.stringify((event.payload as { plan: SessionSnapshot["plan"] }).plan));
      break;
    case "turn.diff.updated":
      session.turnDiff = JSON.parse(JSON.stringify((event.payload as { diff: SessionSnapshot["turnDiff"] }).diff));
      break;
    case "runtime.error": {
      const payload = event.payload as { error?: { message?: string; phase?: string } };
      session.activities.push({
        id: event.itemId ?? event.id,
        itemId: event.itemId ?? event.id,
        engineId: sessionAgentEngine(event.engineId ?? session.engineId),
        sessionId: session.id,
        runId: event.turnId,
        kind: "error",
        title: payload.error?.phase ? `运行错误 · ${payload.error.phase}` : "运行错误",
        detail: payload.error?.message ?? "运行失败。",
        status: "failed",
        createdAt: event.timestamp,
      });
      break;
    }
  }
  projectRuntimeItem(session, event as RuntimeEvent);
}

function withMessageOwner(message: AgentMessage, session: SessionSnapshot, event: RuntimeEvent): AgentMessage {
  return {
    ...message,
    engineId: sessionAgentEngine(event.engineId ?? message.engineId ?? session.engineId),
    sessionId: session.id,
    ...(event.turnId ? { turnId: event.turnId } : {}),
    itemId: event.itemId ?? message.itemId ?? message.id,
  };
}

function withActivityOwner(activity: ActivityRecord, session: SessionSnapshot, event: RuntimeEvent): ActivityRecord {
  return {
    ...activity,
    engineId: sessionAgentEngine(event.engineId ?? activity.engineId ?? session.engineId),
    sessionId: session.id,
    ...(event.turnId ? { runId: event.turnId } : {}),
    itemId: event.itemId ?? activity.itemId ?? activity.id,
  };
}

function projectRuntimeItem(session: SessionSnapshot, event: RuntimeEvent): void {
  const descriptor = itemDescriptor(event);
  if (!descriptor) return;
  session.items ??= [];
  const existing = session.items.find((item) => item.id === descriptor.id);
  if (!existing) {
    session.items.push({
      id: descriptor.id,
      engineId: sessionAgentEngine(event.engineId ?? session.engineId),
      sessionId: session.id,
      ...(event.turnId ? { turnId: event.turnId } : {}),
      kind: descriptor.kind,
      status: descriptor.status,
      startedAt: event.timestamp,
      ...(descriptor.status === "started" ? {} : { completedAt: event.timestamp }),
    });
    return;
  }
  existing.status = descriptor.status;
  if (descriptor.status !== "started") existing.completedAt = event.timestamp;
}

function itemDescriptor(event: RuntimeEvent): { id: string; kind: RuntimeItemKind; status: RuntimeItemSnapshot["status"] } | undefined {
  const payload = event.payload as Record<string, unknown>;
  const id = event.itemId
    ?? stringField(payload, "activityId")
    ?? stringField(payload, "messageId")
    ?? stringField(payload, "id")
    ?? (payload.message && typeof payload.message === "object" ? stringField(payload.message as Record<string, unknown>, "id") : undefined);
  if (!id) return undefined;
  if (event.type.startsWith("message.")) return { id, kind: "message", status: event.type === "message.cancelled" ? "cancelled" : event.type === "message.completed" || event.type === "message.user" ? "completed" : "started" };
  if (event.type.startsWith("thinking.")) return { id, kind: "reasoning", status: event.type === "thinking.completed" ? "completed" : "started" };
  if (event.type.startsWith("tool.")) return { id, kind: "tool", status: event.type === "tool.completed" ? "completed" : event.type === "tool.cancelled" ? "cancelled" : event.type === "tool.failed" ? "failed" : "started" };
  if (event.type.startsWith("interaction.")) return { id, kind: "interaction", status: event.type === "interaction.resolved" ? "completed" : "started" };
  if (event.type === "plan.updated") return { id, kind: "plan", status: "completed" };
  if (event.type === "turn.diff.updated") return { id, kind: "diff", status: "completed" };
  if (event.type === "turn.usage.updated") return { id, kind: "usage", status: "completed" };
  if (event.type === "runtime.error") return { id, kind: "error", status: "failed" };
  return undefined;
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === "string" && value[key] ? value[key] as string : undefined;
}

function activeRunIds(session: SessionSnapshot): string[] {
  const ids = session.activeRunIds?.filter(Boolean) ?? (session.activeRunId ? [session.activeRunId] : []);
  return [...new Set(ids)];
}

function addActiveRun(session: SessionSnapshot, runId: string): void {
  const ids = activeRunIds(session);
  if (!ids.includes(runId)) ids.push(runId);
  session.activeRunIds = ids;
  session.activeRunId = ids[0];
}

function removeActiveRun(session: SessionSnapshot, runId: string): void {
  const ids = activeRunIds(session).filter((id) => id !== runId);
  if (ids.length) {
    session.activeRunIds = ids;
    session.activeRunId = ids[0];
  } else {
    delete session.activeRunIds;
    delete session.activeRunId;
  }
}
