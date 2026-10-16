import { newId } from "../../core/ids";

export type SteeringKind = "steer" | "inject";
export type SteeringRunStatus = "idle" | "queued" | "running" | "waiting" | "waiting_resource" | "recovering" | "replaying" | "completed" | "cancelled" | "failed";
export type SteeringReceiptStatus = "queued" | "claimed" | "delivered" | "rejected" | "cleared";

export interface SteeringReceipt {
  id: string;
  runId: string;
  kind: SteeringKind;
  status: SteeringReceiptStatus;
  wakeRequested: boolean;
  payload: string | Record<string, unknown>;
  reason?: string;
  createdAt: number;
  updatedAt: number;
}

export class RunSteeringService {
  private readonly statuses = new Map<string, SteeringRunStatus>();
  private readonly receipts = new Map<string, SteeringReceipt>();
  private readonly pendingByRun = new Map<string, string[]>();
  private readonly interrupts = new Map<string, () => void>();

  constructor(private readonly now: () => number = Date.now) {}

  markRun(runId: string, status: SteeringRunStatus): void {
    this.statuses.set(runId, status);
  }

  steer(runId: string, message: string): SteeringReceipt {
    return this.enqueue(runId, "steer", message, true);
  }

  inject(runId: string, context: Record<string, unknown>): SteeringReceipt {
    return this.enqueue(runId, "inject", context, false);
  }

  /** Interrupt only the current step, keeping the run and its history alive. */
  interrupt(runId: string): void {
    if ((this.pendingByRun.get(runId) ?? []).some(id => this.receipts.get(id)?.kind === "steer")) {
      this.interrupts.get(runId)?.();
    }
  }

  bindInterrupt(runId: string, interrupt: () => void): () => void {
    this.interrupts.set(runId, interrupt);
    this.interrupt(runId);
    return () => { if (this.interrupts.get(runId) === interrupt) this.interrupts.delete(runId); };
  }

  claimForPreStep(runId: string): SteeringReceipt[] {
    const ids = this.pendingByRun.get(runId) ?? [];
    this.pendingByRun.delete(runId);
    return ids.map((id) => {
      const current = this.receipts.get(id)!;
      const claimed = { ...current, status: "delivered" as const, updatedAt: this.now() };
      this.receipts.set(id, claimed);
      return clone(claimed);
    });
  }

  hasPending(runId: string): boolean {
    return Boolean(this.pendingByRun.get(runId)?.length);
  }

  clear(runId: string): SteeringReceipt[] {
    const ids = this.pendingByRun.get(runId) ?? [];
    this.pendingByRun.delete(runId);
    return ids.map((id) => {
      const current = this.receipts.get(id)!;
      const cleared = { ...current, status: "cleared" as const, updatedAt: this.now(), reason: "运行取消时清空。" };
      this.receipts.set(id, cleared);
      return clone(cleared);
    });
  }

  snapshot(runId?: string): SteeringReceipt[] {
    return [...this.receipts.values()]
      .filter((receipt) => !runId || receipt.runId === runId)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map(clone);
  }

  private enqueue(runId: string, kind: SteeringKind, payload: SteeringReceipt["payload"], wakeRequested: boolean): SteeringReceipt {
    const timestamp = this.now();
    const status = this.statuses.get(runId);
    const accepted = status === "running" || status === "queued" || status === "waiting" || status === "waiting_resource" || status === "recovering" || status === "replaying";
    const receipt: SteeringReceipt = {
      id: newId(`run-${kind}`),
      runId,
      kind,
      status: accepted ? "queued" : "rejected",
      wakeRequested: accepted && wakeRequested,
      payload: clone(payload),
      ...(accepted ? {} : { reason: "运行不存在或已结束；空闲运行不会被 inject 唤醒。" }),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.receipts.set(receipt.id, receipt);
    if (accepted) this.pendingByRun.set(runId, [...(this.pendingByRun.get(runId) ?? []), receipt.id]);
    return clone(receipt);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
