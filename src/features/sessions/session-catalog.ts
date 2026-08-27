import { SessionSnapshot } from "../../core/contracts";
import { createSessionSnapshot } from "./session-factory";
import { AgentEngineId, DEFAULT_AGENT_ENGINE } from "../../core/agent-engine-contracts";

export class SessionCatalog {
  private readonly sessions = new Map<string, SessionSnapshot>();
  private activeSessionId = "";

  restore(sessions: SessionSnapshot[], activeSessionId: string): void {
    this.sessions.clear();
    for (const session of sessions) this.sessions.set(session.id, { ...session, engineId: session.engineId ?? DEFAULT_AGENT_ENGINE });
    this.activeSessionId = this.sessions.has(activeSessionId) ? activeSessionId : sessions[0]?.id ?? "";
  }

  create(
    workingDirectory: string,
    now: number,
    projectAccess?: SessionSnapshot["projectAccess"],
    engineId: AgentEngineId = DEFAULT_AGENT_ENGINE,
  ): SessionSnapshot {
    const session = createSessionSnapshot(workingDirectory, now, "demo-default", "auto", projectAccess, engineId);
    this.sessions.set(session.id, session);
    this.activeSessionId = session.id;
    return session;
  }

  get(sessionId: string): SessionSnapshot | undefined {
    return this.sessions.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  setActive(sessionId: string): boolean {
    if (!this.sessions.has(sessionId)) return false;
    this.activeSessionId = sessionId;
    return true;
  }

  remove(sessionId: string): boolean {
    const removed = this.sessions.delete(sessionId);
    if (!removed) return false;
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = this.sorted()[0]?.id ?? "";
    }
    return true;
  }

  getActiveSessionId(): string {
    return this.activeSessionId;
  }

  sorted(): SessionSnapshot[] {
    return [...this.sessions.values()].sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return right.updatedAt - left.updatedAt;
    });
  }

  values(): SessionSnapshot[] {
    return [...this.sessions.values()];
  }

  get size(): number {
    return this.sessions.size;
  }
}
