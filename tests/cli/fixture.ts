import { AppSnapshot, AgentIntent, PermissionMode, RunSnapshot, RuntimeEventType, SessionSnapshot } from "../../src/core/contracts";
import { CoordinationEnvelopeType } from "../../src/core/coordination-contracts";
import { PermissionAccessSelection } from "../../src/core/permission-contracts";
import { CliApplicationPort, CliSendResult } from "../../src/platform/cli/application-port";
import { CliEvent, CliPresenter } from "../../src/platform/cli/contracts";
import { createSessionSnapshot } from "../../src/features/sessions/session-factory";
import { applyRuntimeEvent } from "../../src/features/sessions/session-reducer";
import { TerminalOutputInput, TerminalOutputResult } from "../../src/features/terminal/contracts";

export class RecordingPresenter implements CliPresenter {
  readonly events: CliEvent[] = [];
  present(event: CliEvent): void { this.events.push(structuredClone(event)); }
}

export class FakeCliApplicationPort implements CliApplicationPort {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  private readonly listeners = new Set<(snapshot: AppSnapshot) => void>();
  private nextSession = 1;
  private nextEvent = 1;
  private nextEnvelope = 1;
  sendBehavior?: (intent: AgentIntent, port: FakeCliApplicationPort) => Promise<CliSendResult> | CliSendResult;
  cancelResult = true;
  cancelWaitResult = true;
  terminalOutputResult?: TerminalOutputResult;

  constructor(readonly state: AppSnapshot = createAppSnapshot()) {}

  async getSnapshot(): Promise<AppSnapshot> { return structuredClone(this.state); }

  subscribe(listener: (snapshot: AppSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(structuredClone(this.state));
    return () => this.listeners.delete(listener);
  }

  async createSession(): Promise<unknown> {
    this.calls.push({ method: "createSession", args: [] });
    const session = namedSession(`session-${++this.nextSession}`, "新建 Agent 会话", 100 + this.nextSession);
    this.state.sessions.push(session);
    this.state.activeSessionId = session.id;
    this.publish();
    return structuredClone(session);
  }

  async openProjectSession(path: string): Promise<unknown> {
    this.calls.push({ method: "openProjectSession", args: [path] });
    const existing = this.state.sessions.find((session) =>
      session.projectAccess?.enabled === true && session.workingDirectory === path);
    if (existing) {
      this.state.activeSessionId = existing.id;
      this.publish();
      return structuredClone(existing);
    }
    const session = namedSession(`session-${++this.nextSession}`, "新建 Agent 会话", 100 + this.nextSession);
    session.workingDirectory = path;
    session.projectAccess = { enabled: true, selectedBy: "cli-explicit" };
    this.state.sessions.push(session);
    this.state.activeSessionId = session.id;
    this.publish();
    return structuredClone(session);
  }

  async createProjectSession(path: string): Promise<unknown> {
    this.calls.push({ method: "createProjectSession", args: [path] });
    const session = namedSession(`session-${++this.nextSession}`, "新建 Agent 会话", 100 + this.nextSession);
    session.workingDirectory = path;
    session.projectAccess = { enabled: true, selectedBy: "cli-explicit" };
    this.state.sessions.push(session);
    this.state.activeSessionId = session.id;
    this.publish();
    return structuredClone(session);
  }

  async setActiveSession(sessionId: string): Promise<boolean> {
    this.calls.push({ method: "setActiveSession", args: [sessionId] });
    if (!this.state.sessions.some((session) => session.id === sessionId)) return false;
    this.state.activeSessionId = sessionId;
    this.publish();
    return true;
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    this.calls.push({ method: "deleteSession", args: [sessionId] });
    const index = this.state.sessions.findIndex((session) => session.id === sessionId);
    if (index < 0) return false;
    this.state.sessions.splice(index, 1);
    if (this.state.activeSessionId === sessionId) {
      this.state.activeSessionId = this.state.sessions[0]?.id ?? null;
    }
    this.publish();
    return true;
  }

  async listRuns(sessionId?: string): Promise<RunSnapshot[]> {
    this.calls.push({ method: "listRuns", args: [sessionId] });
    return structuredClone(this.state.runs?.filter((run) => !sessionId || run.sessionId === sessionId) ?? []);
  }

  async selectRun(runId: string): Promise<boolean> {
    this.calls.push({ method: "selectRun", args: [runId] });
    return Boolean(this.state.runs?.some((run) => run.runId === runId));
  }

  async cancelRun(runId: string): Promise<boolean> {
    this.calls.push({ method: "cancelRun", args: [runId] });
    return this.cancelResult;
  }

  async renameSession(sessionId: string, title: string): Promise<boolean> {
    this.calls.push({ method: "renameSession", args: [sessionId, title] });
    const session = this.session(sessionId);
    if (!session || session.status === "running" || !title.trim()) return false;
    session.title = title.trim();
    this.publish();
    return true;
  }

  async setProviderModel(sessionId: string, providerId: string, model: string): Promise<boolean> {
    this.calls.push({ method: "setProviderModel", args: [sessionId, providerId, model] });
    const session = this.session(sessionId);
    const provider = this.state.providers.find((item) => item.id === providerId);
    if (!session || session.status === "running" || !provider?.available || !provider.models.some((item) => item.id === model)) return false;
    session.selectedProviderId = providerId;
    session.selectedModel = model;
    this.publish();
    return true;
  }

  async setPermissionMode(sessionId: string, permissionMode: PermissionMode): Promise<boolean> {
    this.calls.push({ method: "setPermissionMode", args: [sessionId, permissionMode] });
    const session = this.session(sessionId);
    if (!session || session.status === "running") return false;
    session.permissionMode = permissionMode;
    this.publish();
    return true;
  }

  async setPermissionAccess(sessionId: string, selection: PermissionAccessSelection): Promise<boolean> {
    this.calls.push({ method: "setPermissionAccess", args: [sessionId, selection] });
    const session = this.session(sessionId);
    if (!session || session.status === "running") return false;
    const access = this.state.permissions.access;
    access.pendingRuns = access.pendingRuns.filter((grant) => grant.sessionId !== sessionId);
    access.runtimeSessions = access.runtimeSessions.filter((grant) => grant.sessionId !== sessionId);
    access.trustedProjects = access.trustedProjects.filter((root) => root !== session.workingDirectory);
    if (selection === "project-run" || selection === "computer-run") {
      access.pendingRuns.push({
        sessionId,
        level: selection === "project-run" ? "project-full" : "computer-full",
        duration: "run",
        ...(selection === "project-run" ? { projectRoot: session.workingDirectory } : {}),
      });
    } else if (selection === "project-trusted") {
      if (!session.projectAccess?.enabled) return false;
      access.trustedProjects.push(session.workingDirectory);
    } else if (selection === "computer-runtime") {
      access.runtimeSessions.push({ sessionId, level: "computer-full", duration: "runtime" });
    }
    this.publish();
    return true;
  }

  async restoreProjectChange(sessionId: string, receiptId: string): Promise<unknown> {
    this.calls.push({ method: "restoreProjectChange", args: [sessionId, receiptId] });
    return { ok: true, action: "restore", paths: ["fixture.txt"] };
  }

  async readTerminalOutput(sessionId: string, input: TerminalOutputInput): Promise<TerminalOutputResult> {
    this.calls.push({ method: "readTerminalOutput", args: [sessionId, structuredClone(input)] });
    return structuredClone(this.terminalOutputResult ?? {
      ok: true,
      executionId: input.executionId,
      stream: input.stream,
      status: "completed",
      offset: input.offset ?? 0,
      bytes: 4,
      totalBytes: 4,
      text: "PASS",
      nextOffset: null,
      truncated: false,
      complete: true,
    });
  }

  async send(intent: AgentIntent): Promise<CliSendResult> {
    this.calls.push({ method: "send", args: [structuredClone(intent)] });
    return this.sendBehavior?.(intent, this) ?? { accepted: true, queued: false };
  }

  async cancel(sessionId: string): Promise<boolean> {
    this.calls.push({ method: "cancel", args: [sessionId] });
    return this.cancelResult;
  }

  async sendMessage(sourceSessionId: string, targetSessionId: string, text: string): Promise<unknown> {
    this.calls.push({ method: "sendMessage", args: [sourceSessionId, targetSessionId, text] });
    return this.addEnvelope(sourceSessionId, targetSessionId, "message", text);
  }

  async delegateTask(sourceSessionId: string, targetSessionId: string, text: string): Promise<unknown> {
    this.calls.push({ method: "delegateTask", args: [sourceSessionId, targetSessionId, text] });
    return this.addEnvelope(sourceSessionId, targetSessionId, "delegation", text);
  }

  async waitForMessage(
    sessionId: string,
    filter: { fromSessionId?: string; envelopeType?: CoordinationEnvelopeType; correlationId?: string },
  ): Promise<unknown> {
    this.calls.push({ method: "waitForMessage", args: [sessionId, structuredClone(filter)] });
    const existing = this.state.coordination.envelopes.find((envelope) =>
      envelope.targetSessionId === sessionId
      && envelope.status === "delivered"
      && (!filter.fromSessionId || envelope.sourceSessionId === filter.fromSessionId));
    return existing ? { waiting: false, matchedEnvelopeId: existing.id } : { waiting: true, wait: { sessionId } };
  }

  async cancelWait(sessionId: string): Promise<boolean> {
    this.calls.push({ method: "cancelWait", args: [sessionId] });
    return this.cancelWaitResult;
  }

  pushEvent(sessionId: string, type: RuntimeEventType, payload: unknown, timestamp = 1_000 + this.nextEvent): void {
    const session = this.session(sessionId);
    if (!session) throw new Error(`missing fake session ${sessionId}`);
    applyRuntimeEvent(session, {
      id: `event-${this.nextEvent++}`,
      sessionId,
      type,
      timestamp,
      payload,
    });
    this.publish();
  }

  publish(): void {
    const snapshot = structuredClone(this.state);
    for (const listener of this.listeners) listener(snapshot);
  }

  session(id: string): SessionSnapshot | undefined {
    return this.state.sessions.find((session) => session.id === id);
  }

  private addEnvelope(sourceSessionId: string, targetSessionId: string, type: "message" | "delegation", body: string) {
    const envelope = {
      id: `envelope-${this.nextEnvelope++}`,
      revision: 2,
      sourceSessionId,
      targetSessionId,
      type,
      status: "delivered" as const,
      body,
      createdAt: 1_000,
      updatedAt: 1_000,
    };
    this.state.coordination.envelopes.push(envelope);
    this.publish();
    return structuredClone(envelope);
  }
}

export function createAppSnapshot(): AppSnapshot {
  const session = namedSession("session-1", "主会话", 100);
  return {
    productVersion: "1.8.1",
    releaseStage: "Stable",
    productBadge: "v1.8.1 · Stable（稳定版）",
    activeSessionId: session.id,
    sessions: [session],
    providers: [{
      id: "demo",
      name: "Demo Provider",
      label: "Demo Provider · 仅本地演示",
      configuration: "demo",
      available: true,
      realCallsEnabled: false,
      capabilities: ["streaming", "agent"],
      models: [{ id: "demo-default", label: "Demo · 默认模型" }],
    }],
    permissions: {
      approvalHostMode: "fail-closed",
      pending: [],
      access: { pendingRuns: [], activeRuns: [], runtimeSessions: [], trustedProjects: [] },
    },
    coordination: { envelopes: [], waits: [], unreadBySession: [], recentLinks: [] },
    telemetry: { sessions: [], engines: [], appCumulative: usage("estimated", 0) },
    scheduler: { runtimeScope: "application-runtime", definitions: [], history: [] },
    extensions: { skills: [], plugins: [], unknownCodePolicy: "not-executed" },
    secrets: { encryptionAvailable: true, references: [], message: "测试安全存储" },
    providerSettings: { schemaVersion: 2, profiles: {} },
    providerCatalog: { profiles: [], categories: [], realApiStatus: "REAL_API_UNPROVEN" },
  };
}

export function namedSession(id: string, title: string, now: number): SessionSnapshot {
  return { ...createSessionSnapshot("D:\\Agent", now), id, title };
}

export function usage(source: "estimated" | "provider", total: number) {
  return {
    input: Math.floor(total * 0.6),
    cacheHitInput: source === "provider" ? 2 : 0,
    cacheMissInput: source === "provider" ? Math.max(0, Math.floor(total * 0.6) - 2) : Math.floor(total * 0.6),
    cacheWriteInput: source === "provider" ? 1 : 0,
    output: total - Math.floor(total * 0.6),
    reasoning: source === "provider" ? 1 : 0,
    toolUse: 0,
    total,
    source,
  } as const;
}
