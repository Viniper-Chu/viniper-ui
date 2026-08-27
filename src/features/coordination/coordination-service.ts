import {
  CoordinationEnvelope,
  CoordinationEnvelopeType,
  CoordinationSnapshot,
  CoordinationWait,
} from "../../core/coordination-contracts";
import { AgentEngineId, sessionAgentEngine } from "../../core/agent-engine-contracts";
import { AgentIntent, RunCompletion, SessionSnapshot } from "../../core/contracts";
import { engineScopedId } from "../../core/engine-identity";
import { newId } from "../../core/ids";
import { CoordinationPersistence } from "../../core/ports";

export interface CoordinationRuntimePort {
  getSession(sessionId: string): SessionSnapshot | undefined;
  listSessions(): SessionSnapshot[];
  send(intent: AgentIntent): Promise<{ accepted: boolean; queued: boolean; reason?: string }>;
  setCoordinationWait(sessionId: string, wait?: CoordinationWait): Promise<boolean>;
  onRunCompleted(listener: (completion: RunCompletion) => void | Promise<void>): () => void;
}

export type CoordinationListener = (snapshot: CoordinationSnapshot) => void;

export class CoordinationService {
  private readonly envelopes = new Map<string, CoordinationEnvelope>();
  private readonly listeners = new Set<CoordinationListener>();
  private unsubscribeRuntime?: () => void;
  private readonly waitTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly persistence: CoordinationPersistence,
    private readonly runtime: CoordinationRuntimePort,
    private readonly now: () => number = Date.now,
  ) {}

  async initialize(): Promise<void> {
    for (const envelope of await this.persistence.loadCoordination()) {
      const normalized = this.normalizeLegacyEnvelope(envelope);
      if (!normalized) continue;
      const current = this.envelopes.get(normalized.id);
      if (!current || normalized.revision >= current.revision) this.envelopes.set(normalized.id, normalized);
    }
    this.unsubscribeRuntime = this.runtime.onRunCompleted((completion) => this.handleRunCompletion(completion));
    for (const session of this.runtime.listSessions()) {
      if (session.waitingFor) await this.restoreWait(session.waitingFor);
    }
    this.publish();
  }

  dispose(): void {
    this.unsubscribeRuntime?.();
    for (const timer of this.waitTimers.values()) clearTimeout(timer);
    this.waitTimers.clear();
  }

  subscribe(listener: CoordinationListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  async sendMessage(sourceSessionId: string, targetSessionId: string, body: string): Promise<CoordinationEnvelope> {
    const engineId = this.assertRoute(sourceSessionId, targetSessionId, body);
    const envelope = await this.createEnvelope({ engineId, sourceSessionId, targetSessionId, body, type: "message" });
    await this.resolveWait(targetSessionId, envelope);
    return clone(envelope);
  }

  async delegateTask(
    sourceSessionId: string,
    targetSessionId: string,
    body: string,
    onEnvelope?: (envelope: CoordinationEnvelope) => void | Promise<void>,
  ): Promise<CoordinationEnvelope> {
    const engineId = this.assertRoute(sourceSessionId, targetSessionId, body);
    const envelope = await this.createEnvelope({ engineId, sourceSessionId, targetSessionId, body, type: "delegation" });
    await onEnvelope?.(clone(envelope));
    const target = this.runtime.getSession(targetSessionId)!;
    const result = await this.runtime.send({
      engineId,
      sessionId: targetSessionId,
      text: body.trim(),
      attachments: [],
      selectedModel: target.selectedModel,
      permissionMode: target.permissionMode,
      origin: { kind: "delegation", envelopeId: envelope.id, sourceSessionId },
    });
    if (!result.accepted) {
      await this.completeDelegation(envelope.id, targetSessionId, sourceSessionId, `委派未进入目标会话：${result.reason ?? "未知原因"}`);
    }
    return clone(this.envelopes.get(envelope.id)!);
  }

  async waitForMessage(
    sessionId: string,
    filter: { fromSessionId?: string; envelopeType?: CoordinationEnvelopeType; correlationId?: string; timeoutMs?: number } = {},
  ): Promise<{ waiting: boolean; wait?: CoordinationWait; matchedEnvelopeId?: string }> {
    const session = this.runtime.getSession(sessionId);
    if (!session) return { waiting: false };
    const engineId = sessionAgentEngine(session.engineId);
    if (filter.fromSessionId) {
      const source = this.runtime.getSession(filter.fromSessionId);
      if (!source || sessionAgentEngine(source.engineId) !== engineId) {
        throw new Error("ENGINE_COORDINATION_MISMATCH: 等待来源必须属于同一 Agent。 ");
      }
    }
    const existing = this.latestEnvelopes()
      .filter((envelope) => envelope.engineId === engineId && envelope.targetSessionId === sessionId && envelope.status === "delivered")
      .find((envelope) => matchesFilter(envelope, filter));
    if (existing) {
      await this.markRead(sessionId, existing.id);
      return { waiting: false, matchedEnvelopeId: existing.id };
    }
    const timeoutMs = filter.timeoutMs === undefined ? undefined : Math.max(1, Math.floor(filter.timeoutMs));
    const wait: CoordinationWait = {
      id: engineScopedId(engineId, "wait", newId("wait")), engineId, sessionId,
      ...(filter.fromSessionId ? { fromSessionId: filter.fromSessionId } : {}),
      ...(filter.envelopeType ? { envelopeType: filter.envelopeType } : {}),
      ...(filter.correlationId ? { correlationId: filter.correlationId } : {}),
      createdAt: this.now(),
      ...(timeoutMs ? { timeoutAt: this.now() + timeoutMs } : {}),
    };
    const accepted = await this.runtime.setCoordinationWait(sessionId, wait);
    if (accepted) this.scheduleWait(wait);
    return accepted ? { waiting: true, wait: clone(wait) } : { waiting: false };
  }

  async cancelWait(sessionId: string, waitId?: string): Promise<boolean> {
    const current = this.runtime.getSession(sessionId)?.waitingFor;
    if (!current || (waitId && current.id !== waitId)) return false;
    this.clearWaitTimer(sessionId);
    return this.runtime.setCoordinationWait(sessionId, undefined);
  }

  async markRead(sessionId: string, envelopeId: string): Promise<boolean> {
    const envelope = this.envelopes.get(envelopeId);
    if (!envelope || envelope.targetSessionId !== sessionId || envelope.status === "completed") return false;
    if (envelope.status === "read") return true;
    await this.updateStatus(envelopeId, "read");
    return true;
  }

  async readEnvelope(sessionId: string, envelopeId: string): Promise<CoordinationEnvelope | undefined> {
    const envelope = this.envelopes.get(envelopeId);
    if (!envelope || envelope.targetSessionId !== sessionId) return undefined;
    await this.markRead(sessionId, envelopeId);
    return clone(this.envelopes.get(envelopeId)!);
  }

  snapshot(): CoordinationSnapshot {
    const envelopes = this.latestEnvelopes();
    const sessionIds = new Set(envelopes.map((envelope) => envelope.targetSessionId));
    return clone({
      envelopes,
      waits: this.runtime.listSessions()
        .map((session) => session.waitingFor)
        .filter((wait): wait is CoordinationWait => Boolean(wait)),
      unreadBySession: [...sessionIds].map((sessionId) => ({
        sessionId,
        count: envelopes.filter((envelope) => envelope.targetSessionId === sessionId && envelope.status === "delivered").length,
      })),
      recentLinks: envelopes.slice(-12).map((envelope) => ({
        engineId: envelope.engineId,
        sourceSessionId: envelope.sourceSessionId,
        targetSessionId: envelope.targetSessionId,
        type: envelope.type,
        timestamp: envelope.updatedAt,
      })),
    });
  }

  private async createEnvelope(input: {
    engineId: AgentEngineId;
    sourceSessionId: string;
    targetSessionId: string;
    body: string;
    type: CoordinationEnvelopeType;
    correlationId?: string;
    delegationId?: string;
  }): Promise<CoordinationEnvelope> {
    const timestamp = this.now();
    const sent: CoordinationEnvelope = {
      id: engineScopedId(input.engineId, "envelope", newId("envelope")),
      engineId: input.engineId,
      revision: 1,
      sourceSessionId: input.sourceSessionId,
      targetSessionId: input.targetSessionId,
      type: input.type,
      status: "sent",
      body: input.body.trim(),
      createdAt: timestamp,
      updatedAt: timestamp,
      correlationId: input.correlationId,
      delegationId: input.delegationId,
    };
    await this.append(sent);
    return this.updateStatus(sent.id, "delivered");
  }

  private async handleRunCompletion(completion: RunCompletion): Promise<void> {
    if (completion.origin.kind !== "delegation" || !completion.origin.envelopeId || !completion.origin.sourceSessionId) return;
    const envelope = this.envelopes.get(completion.origin.envelopeId);
    const completionEngine = completion.engineId ?? this.runtime.getSession(completion.sessionId)?.engineId;
    if (!envelope || envelope.engineId !== sessionAgentEngine(completionEngine)) return;
    const detail = completion.status === "completed"
      ? completion.assistantText
      : `委派${completion.status === "cancelled" ? "已取消" : "执行失败"}。`;
    await this.completeDelegation(
      completion.origin.envelopeId,
      completion.sessionId,
      completion.origin.sourceSessionId,
      detail,
    );
  }

  private async completeDelegation(
    delegationId: string,
    sourceSessionId: string,
    targetSessionId: string,
    body: string,
  ): Promise<void> {
    if (this.envelopes.has(delegationId)) await this.updateStatus(delegationId, "completed");
    const result = await this.createEnvelope({
      engineId: this.engineForRoute(sourceSessionId, targetSessionId),
      sourceSessionId,
      targetSessionId,
      body,
      type: "result",
      correlationId: delegationId,
      delegationId,
    });
    await this.resolveWait(targetSessionId, result);
  }

  private async resolveWait(sessionId: string, envelope: CoordinationEnvelope): Promise<void> {
    const wait = this.runtime.getSession(sessionId)?.waitingFor;
    if (!wait || !matchesFilter(envelope, wait)) return;
    this.clearWaitTimer(sessionId);
    await this.runtime.setCoordinationWait(sessionId, undefined);
  }

  private async restoreWait(wait: CoordinationWait): Promise<void> {
    if (wait.timeoutAt && wait.timeoutAt <= this.now()) {
      await this.runtime.setCoordinationWait(wait.sessionId, undefined);
      return;
    }
    this.scheduleWait(wait);
  }

  private scheduleWait(wait: CoordinationWait): void {
    this.clearWaitTimer(wait.sessionId);
    if (!wait.timeoutAt) return;
    const delay = Math.max(0, wait.timeoutAt - this.now());
    const timer = setTimeout(() => {
      this.waitTimers.delete(wait.sessionId);
      const current = this.runtime.getSession(wait.sessionId)?.waitingFor;
      if (current?.id === wait.id) void this.runtime.setCoordinationWait(wait.sessionId, undefined);
    }, delay);
    timer.unref?.();
    this.waitTimers.set(wait.sessionId, timer);
  }

  private clearWaitTimer(sessionId: string): void {
    const timer = this.waitTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.waitTimers.delete(sessionId);
  }

  private async updateStatus(id: string, status: CoordinationEnvelope["status"]): Promise<CoordinationEnvelope> {
    const current = this.envelopes.get(id);
    if (!current) throw new Error(`协作信封 '${id}' 不存在。`);
    const rank: Record<CoordinationEnvelope["status"], number> = { sent: 0, delivered: 1, read: 2, completed: 3 };
    if (rank[status] <= rank[current.status]) return current;
    const next = { ...current, revision: current.revision + 1, status, updatedAt: this.now() };
    await this.append(next);
    return next;
  }

  private async append(envelope: CoordinationEnvelope): Promise<void> {
    this.envelopes.set(envelope.id, envelope);
    await this.persistence.appendCoordination(clone(envelope));
    this.publish();
  }

  private latestEnvelopes(): CoordinationEnvelope[] {
    return [...this.envelopes.values()].sort((left, right) => left.createdAt - right.createdAt);
  }

  private assertRoute(sourceSessionId: string, targetSessionId: string, body: string): AgentEngineId {
    if (sourceSessionId === targetSessionId) throw new Error("协作目标必须是另一个会话。 ");
    const source = this.runtime.getSession(sourceSessionId);
    const target = this.runtime.getSession(targetSessionId);
    if (!source || !target) {
      throw new Error("协作来源或目标会话不存在。 ");
    }
    const sourceEngine = sessionAgentEngine(source.engineId);
    const targetEngine = sessionAgentEngine(target.engineId);
    if (sourceEngine !== targetEngine) {
      throw new Error("ENGINE_COORDINATION_MISMATCH: 跨 Agent 会话不能共享消息、委派或等待状态。 ");
    }
    if (!body.trim()) throw new Error("协作内容不能为空。 ");
    return sourceEngine;
  }

  private engineForRoute(sourceSessionId: string, targetSessionId: string): AgentEngineId {
    const source = this.runtime.getSession(sourceSessionId);
    const target = this.runtime.getSession(targetSessionId);
    if (!source || !target) throw new Error("协作来源或目标会话不存在。 ");
    const sourceEngine = sessionAgentEngine(source.engineId);
    if (sourceEngine !== sessionAgentEngine(target.engineId)) {
      throw new Error("ENGINE_COORDINATION_MISMATCH: 协作结果不能跨 Agent 投递。 ");
    }
    return sourceEngine;
  }

  private normalizeLegacyEnvelope(envelope: CoordinationEnvelope): CoordinationEnvelope | undefined {
    const source = this.runtime.getSession(envelope.sourceSessionId);
    const target = this.runtime.getSession(envelope.targetSessionId);
    if (!source || !target) return undefined;
    const engineId = sessionAgentEngine(source.engineId);
    if (engineId !== sessionAgentEngine(target.engineId)) return undefined;
    return { ...envelope, engineId };
  }

  private publish(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

function matchesFilter(
  envelope: CoordinationEnvelope,
  filter: { fromSessionId?: string; envelopeType?: CoordinationEnvelopeType; correlationId?: string },
): boolean {
  return (!filter.fromSessionId || envelope.sourceSessionId === filter.fromSessionId)
    && (!filter.envelopeType || envelope.type === filter.envelopeType)
    && (!filter.correlationId || envelope.correlationId === filter.correlationId);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
