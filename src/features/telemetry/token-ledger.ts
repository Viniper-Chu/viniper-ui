import { TelemetryPersistence } from "../../core/ports";
import {
  RunUsageSnapshot,
  SessionUsageSummary,
  TelemetrySnapshot,
  TokenUsage,
} from "../../core/telemetry-contracts";
import { AgentEngineId, sessionAgentEngine } from "../../core/agent-engine-contracts";
import { engineIdentityKey, engineScopeOf } from "../../core/engine-identity";

export type TelemetryListener = (snapshot: TelemetrySnapshot) => void;

const EMPTY_USAGE: TokenUsage = {
  input: 0,
  cacheHitInput: 0,
  cacheMissInput: 0,
  cacheWriteInput: 0,
  output: 0,
  reasoning: 0,
  toolUse: 0,
  total: 0,
  source: "estimated",
};

export class TokenLedger {
  private readonly runs = new Map<string, RunUsageSnapshot>();
  private readonly listeners = new Set<TelemetryListener>();

  constructor(
    private readonly persistence: TelemetryPersistence,
    private readonly now: () => number = Date.now,
  ) {}

  async initialize(): Promise<void> {
    for (const raw of await this.persistence.loadUsage()) {
      const record = normalizeRecord(raw);
      this.runs.set(engineIdentityKey(record.engineId!, record.runId), record);
    }
    this.publish();
  }

  subscribe(listener: TelemetryListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  async start(runId: string, sessionId: string, inputText: string): Promise<void>;
  async start(engineId: AgentEngineId, runId: string, sessionId: string, inputText: string): Promise<void>;
  async start(
    engineOrRunId: AgentEngineId | string,
    runOrSessionId: string,
    sessionOrInput: string,
    maybeInput?: string,
  ): Promise<void> {
    const explicitEngine = maybeInput !== undefined;
    const engineId = explicitEngine ? engineOrRunId as AgentEngineId : inferEngine(engineOrRunId, runOrSessionId);
    const runId = explicitEngine ? runOrSessionId : engineOrRunId;
    const sessionId = explicitEngine ? sessionOrInput : runOrSessionId;
    const inputText = explicitEngine ? maybeInput! : sessionOrInput;
    const input = estimateTokens(inputText);
    const timestamp = this.now();
    const record: RunUsageSnapshot = {
      engineId,
      runId,
      sessionId,
      usage: {
        ...EMPTY_USAGE,
        input,
        cacheMissInput: input,
        total: input,
      },
      status: "estimating",
      startedAt: timestamp,
      updatedAt: timestamp,
    };
    this.runs.set(engineIdentityKey(engineId, runId), record);
    await this.persistence.appendUsage(clone(record));
    this.publish();
  }

  updateEstimate(runId: string, usage: TokenUsage): void;
  updateEstimate(engineId: AgentEngineId, runId: string, usage: TokenUsage): void;
  updateEstimate(engineOrRunId: AgentEngineId | string, runOrUsage: string | TokenUsage, maybeUsage?: TokenUsage): void {
    const explicitEngine = maybeUsage !== undefined;
    const runId = explicitEngine ? runOrUsage as string : engineOrRunId;
    const record = explicitEngine
      ? this.runs.get(engineIdentityKey(engineOrRunId as AgentEngineId, runId))
      : this.findRun(runId);
    const usage = explicitEngine ? maybeUsage : runOrUsage as TokenUsage;
    if (!record || record.status !== "estimating") return;
    record.usage = { ...normalizeUsage(usage), source: "estimated" };
    record.updatedAt = this.now();
    this.publish();
  }

  estimateOutput(runId: string, completeText: string): void;
  estimateOutput(engineId: AgentEngineId, runId: string, completeText: string): void;
  estimateOutput(engineOrRunId: AgentEngineId | string, runOrText: string, maybeText?: string): void {
    const explicitEngine = maybeText !== undefined;
    const runId = explicitEngine ? runOrText : engineOrRunId;
    const record = explicitEngine
      ? this.runs.get(engineIdentityKey(engineOrRunId as AgentEngineId, runId))
      : this.findRun(runId);
    const completeText = explicitEngine ? maybeText : runOrText;
    if (!record || record.status !== "estimating") return;
    const output = estimateTokens(completeText);
    record.usage = {
      ...record.usage,
      output,
      total: record.usage.input + output,
      source: "estimated",
    };
    record.updatedAt = this.now();
    this.publish();
  }

  async reconcile(runId: string, usage: TokenUsage): Promise<void>;
  async reconcile(engineId: AgentEngineId, runId: string, usage: TokenUsage): Promise<void>;
  async reconcile(engineOrRunId: AgentEngineId | string, runOrUsage: string | TokenUsage, maybeUsage?: TokenUsage): Promise<void> {
    const explicitEngine = maybeUsage !== undefined;
    const runId = explicitEngine ? runOrUsage as string : engineOrRunId;
    const record = explicitEngine
      ? this.runs.get(engineIdentityKey(engineOrRunId as AgentEngineId, runId))
      : this.findRun(runId);
    const usage = explicitEngine ? maybeUsage : runOrUsage as TokenUsage;
    if (!record) return;
    record.usage = { ...normalizeUsage(usage), source: "provider" };
    record.status = "reconciled";
    record.updatedAt = this.now();
    await this.persistence.appendUsage(clone(record));
    this.publish();
  }

  async finishUnreconciled(runId: string): Promise<void>;
  async finishUnreconciled(engineId: AgentEngineId, runId: string): Promise<void>;
  async finishUnreconciled(engineOrRunId: AgentEngineId | string, maybeRunId?: string): Promise<void> {
    const explicitEngine = maybeRunId !== undefined;
    const runId = explicitEngine ? maybeRunId : engineOrRunId;
    const record = explicitEngine
      ? this.runs.get(engineIdentityKey(engineOrRunId as AgentEngineId, runId))
      : this.findRun(runId);
    if (!record || record.status !== "estimating") return;
    record.status = "unreconciled";
    record.updatedAt = this.now();
    await this.persistence.appendUsage(clone(record));
    this.publish();
  }

  snapshot(): TelemetrySnapshot {
    const sessionIds = [...new Set([...this.runs.values()].map((run) => run.sessionId))];
    const sessions: SessionUsageSummary[] = sessionIds.map((sessionId) => {
      const runs = [...this.runs.values()]
        .filter((run) => run.sessionId === sessionId)
        .sort((left, right) => left.startedAt - right.startedAt);
      return {
        engineId: runs[0]?.engineId ?? inferEngine(undefined, sessionId),
        sessionId,
        cumulative: sumUsage(runs.map((run) => run.usage)),
        currentRun: clone([...runs].reverse().find((run) => run.status === "estimating")),
        latestRun: clone(runs.at(-1)),
      };
    });
    const engines = (["viniper", "claude-code"] as const).map((engineId) => {
      const engineSessions = sessions.filter((session) => session.engineId === engineId);
      return {
        engineId,
        sessions: engineSessions,
        cumulative: sumUsage(engineSessions.map((session) => session.cumulative)),
      };
    });
    return clone({
      sessions,
      appCumulative: sumUsage([...this.runs.values()].map((run) => run.usage)),
      engines,
    });
  }

  getRun(engineId: AgentEngineId, runId: string): RunUsageSnapshot | undefined {
    return clone(this.runs.get(engineIdentityKey(engineId, runId)));
  }

  private findRun(runId: string): RunUsageSnapshot | undefined {
    const owner = engineScopeOf(runId);
    if (owner) return this.runs.get(engineIdentityKey(owner, runId));
    const matches = [...this.runs.values()].filter((record) => record.runId === runId);
    return matches.length === 1 ? matches[0] : undefined;
  }

  private publish(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

export function estimateTokens(text: string): number {
  const characters = [...text].length;
  return characters === 0 ? 0 : Math.max(1, Math.ceil(characters / 3));
}

export function emptyUsage(source: TokenUsage["source"] = "estimated"): TokenUsage {
  return { ...EMPTY_USAGE, source };
}

function sumUsage(values: TokenUsage[]): TokenUsage {
  return {
    input: values.reduce((sum, usage) => sum + usage.input, 0),
    cacheHitInput: sumKnown(values.map((usage) => usage.cacheHitInput)),
    cacheMissInput: sumKnown(values.map((usage) => usage.cacheMissInput)),
    cacheWriteInput: sumKnown(values.map((usage) => usage.cacheWriteInput)),
    output: values.reduce((sum, usage) => sum + usage.output, 0),
    reasoning: values.reduce((sum, usage) => sum + usage.reasoning, 0),
    toolUse: values.reduce((sum, usage) => sum + usage.toolUse, 0),
    total: values.reduce((sum, usage) => sum + usage.total, 0),
    source: values.every((usage) => usage.source === "provider") ? "provider" : "estimated",
  };
}

function normalizeRecord(record: RunUsageSnapshot): RunUsageSnapshot {
  return { ...record, engineId: sessionAgentEngine(record.engineId ?? engineScopeOf(record.runId) ?? engineScopeOf(record.sessionId)), usage: normalizeUsage(record.usage) };
}

function inferEngine(runId: string | undefined, sessionId: string): AgentEngineId {
  return sessionAgentEngine(engineScopeOf(runId ?? "") ?? engineScopeOf(sessionId));
}

function normalizeUsage(usage: TokenUsage): TokenUsage {
  return {
    input: safeNumber(usage.input),
    cacheHitInput: optionalNumber(usage.cacheHitInput),
    cacheMissInput: optionalNumber(usage.cacheMissInput),
    cacheWriteInput: optionalNumber(usage.cacheWriteInput),
    output: safeNumber(usage.output),
    reasoning: safeNumber(usage.reasoning),
    toolUse: safeNumber(usage.toolUse),
    total: safeNumber(usage.total),
    source: usage.source === "provider" ? "provider" : "estimated",
  };
}

function sumKnown(values: Array<number | null>): number | null {
  return values.every((value): value is number => value !== null)
    ? values.reduce((sum, value) => sum + value, 0)
    : null;
}

function optionalNumber(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : safeNumber(value);
}

function safeNumber(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
