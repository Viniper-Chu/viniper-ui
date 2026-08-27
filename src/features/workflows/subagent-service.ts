import { newId } from "../../core/ids";
import { PermissionPolicy } from "../permissions/permission-policy";
import { CoordinationEnvelope } from "../../core/coordination-contracts";
import { RunCompletion } from "../../core/contracts";
import { SubagentPersistence, SubagentReceipt, SubagentRequest, SubagentSnapshot, WorkflowRuntimePort } from "../../core/workflow-contracts";

export interface SubagentCoordinationPort {
  delegateTask(
    sourceSessionId: string,
    targetSessionId: string,
    body: string,
    onEnvelope?: (envelope: CoordinationEnvelope) => void | Promise<void>,
  ): Promise<CoordinationEnvelope>;
}

export interface SubagentServiceOptions {
  coordination: SubagentCoordinationPort;
  runtime: WorkflowRuntimePort;
  permission: PermissionPolicy;
  maxConcurrent?: number;
  now?: () => number;
  persistence?: SubagentPersistence;
}

interface PendingSubagent {
  receipt: SubagentReceipt;
  envelopeId: string;
  runId?: string;
  controller: AbortController;
  resolve: (receipt: SubagentReceipt) => void;
  earlyCompletion?: RunCompletion;
}

export class SubagentService {
  private readonly now: () => number;
  private readonly maxConcurrent: number;
  private readonly active = new Map<string, PendingSubagent>();
  private readonly recent: SubagentReceipt[] = [];
  private readonly waiters: Array<() => void> = [];
  private unsubscribe?: () => void;

  constructor(private readonly options: SubagentServiceOptions) {
    this.now = options.now ?? Date.now;
    this.maxConcurrent = clamp(options.maxConcurrent ?? 3, 1, 8);
    this.unsubscribe = options.runtime.onRunCompleted((completion) => this.onCompletion(completion));
  }

  async initialize(): Promise<void> {
    const restored = await this.options.persistence?.load();
    if (!restored) return;
    this.recent.push(...restored.recent.map(clone));
    for (const receipt of restored.active) {
      this.recent.push(this.finish(receipt, "failed", "应用重启中断了此子 Agent；可重新发起。"));
    }
    while (this.recent.length > 20) this.recent.shift();
    await this.persist();
  }

  async spawn(input: SubagentRequest): Promise<SubagentReceipt> {
    const receipt: SubagentReceipt = {
      id: newId("subagent"),
      parentSessionId: input.parentSessionId,
      targetSessionId: input.targetSessionId,
      status: "queued",
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    await this.persistWith(receipt);
    if (input.signal?.aborted) return this.finish(receipt, "cancelled", "子 Agent 请求已取消。");
    const authorization = this.options.permission.begin({
      sessionId: input.parentSessionId,
      runId: receipt.id,
      permissionMode: input.permissionMode,
      tool: {
        id: receipt.id,
        name: "subagent.delegate",
        summary: input.prompt,
        readOnly: false,
        scope: "computer",
      },
      signal: input.signal ?? new AbortController().signal,
    });
    const resolution = await authorization.resolution;
    if (!resolution.allowed) return this.finish(receipt, "rejected", resolution.message);
    await this.acquire(input.signal);
    receipt.status = "running";
    receipt.updatedAt = this.now();
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    input.signal?.addEventListener("abort", forwardAbort, { once: true });
    const result = await new Promise<SubagentReceipt>((resolve) => {
      const pending: PendingSubagent = { receipt, envelopeId: "", controller, resolve };
      this.active.set(receipt.id, pending);
      void this.persist();
      void this.dispatch(pending, input).catch((error) => {
        this.resolvePending(pending, this.finish(receipt, "failed", error instanceof Error ? error.message : String(error)));
      });
    });
    input.signal?.removeEventListener("abort", forwardAbort);
    this.release();
    return result;
  }

  async cancel(id: string): Promise<boolean> {
    const pending = this.active.get(id);
    if (!pending) return false;
    pending.controller.abort();
    if (pending.runId) await this.options.runtime.cancelRun(pending.runId);
    this.resolvePending(pending, this.finish(pending.receipt, "cancelled", "子 Agent 已取消。"));
    return true;
  }

  snapshot(): SubagentSnapshot {
    return { maxConcurrent: this.maxConcurrent, active: [...this.active.values()].map((item) => clone(item.receipt)), recent: this.recent.map(clone) };
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    for (const pending of this.active.values()) pending.controller.abort();
  }

  private async dispatch(pending: PendingSubagent, input: SubagentRequest): Promise<void> {
    const envelope = await this.options.coordination.delegateTask(
      input.parentSessionId,
      input.targetSessionId,
      input.prompt,
      (created) => {
        pending.envelopeId = created.id;
        pending.receipt.updatedAt = this.now();
      },
    );
    pending.envelopeId = envelope.id;
    pending.runId = pending.earlyCompletion?.runId
      ?? this.options.runtime.listRuns(input.targetSessionId).find((run) => run.origin.envelopeId === envelope.id)?.runId;
    pending.receipt.runId = pending.runId;
    pending.receipt.updatedAt = this.now();
    if (pending.controller.signal.aborted) {
      await this.cancel(pending.receipt.id);
      return;
    }
    if (pending.earlyCompletion) {
      this.resolveCompletion(pending, pending.earlyCompletion);
      return;
    }
    const terminal = this.options.runtime.listRuns(input.targetSessionId).find((run) => run.runId === pending.runId)?.status;
    if (terminal === "cancelled") this.resolvePending(pending, this.finish(pending.receipt, "cancelled", "子 Agent 已取消。"));
  }

  private onCompletion(completion: RunCompletion): void {
    const pending = [...this.active.values()].find((item) => item.envelopeId === completion.origin.envelopeId || item.runId === completion.runId);
    if (!pending) return;
    if (!pending.runId) {
      pending.earlyCompletion = completion;
      return;
    }
    this.resolveCompletion(pending, completion);
  }

  private resolveCompletion(pending: PendingSubagent, completion: RunCompletion): void {
    const status = completion.status === "completed" ? "completed" : completion.status === "cancelled" ? "cancelled" : "failed";
    this.resolvePending(pending, this.finish(pending.receipt, status, status === "completed" ? undefined : `子 Agent ${status === "cancelled" ? "已取消" : "执行失败"}。`, completion.assistantText));
  }

  private resolvePending(pending: PendingSubagent, receipt: SubagentReceipt): void {
    if (!this.active.delete(pending.receipt.id)) return;
    this.recent.push(clone(receipt));
    while (this.recent.length > 20) this.recent.shift();
    pending.resolve(receipt);
    void this.persist();
  }

  private finish(receipt: SubagentReceipt, status: SubagentReceipt["status"], error?: string, output?: string): SubagentReceipt {
    return { ...receipt, status, ...(error ? { error } : {}), ...(output ? { output } : {}), updatedAt: this.now() };
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (this.active.size < this.maxConcurrent) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const waiter = () => {
        signal?.removeEventListener("abort", abort);
        resolve();
      };
      const abort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error("子 Agent 等待已取消。"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private release(): void {
    this.waiters.shift()?.();
  }

  private async persistWith(receipt: SubagentReceipt): Promise<void> {
    await this.options.persistence?.save({ maxConcurrent: this.maxConcurrent, active: [clone(receipt)], recent: this.recent.map(clone) });
  }

  private async persist(): Promise<void> {
    await this.options.persistence?.save(this.snapshot());
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
