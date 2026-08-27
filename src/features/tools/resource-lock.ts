import { sep } from "node:path";

export type ToolResourceAccess = "read" | "write";

export interface ToolResourceClaim {
  key: string;
  access: ToolResourceAccess;
}

export interface ToolResourceLease {
  release(): void;
}

interface ActiveLease {
  claims: ToolResourceClaim[];
}

interface PendingLease {
  claims: ToolResourceClaim[];
  signal: AbortSignal;
  resolve(lease: ToolResourceLease): void;
  reject(error: Error): void;
  removeAbortListener(): void;
}

/**
 * Process-local, cross-session coordination for platform resources. It does
 * not authorize an operation; PermissionPolicy always runs before a lease is
 * requested.
 */
export class ToolResourceCoordinator {
  private readonly active = new Set<ActiveLease>();
  private readonly pending: PendingLease[] = [];

  acquire(claims: ToolResourceClaim[], signal: AbortSignal): Promise<ToolResourceLease> {
    const normalized = normalizeClaims(claims);
    if (signal.aborted) return Promise.reject(new Error("资源等待已取消。"));
    if (normalized.length === 0) return Promise.resolve({ release() {} });
    return new Promise<ToolResourceLease>((resolve, reject) => {
      let entry!: PendingLease;
      const abort = () => {
        const index = this.pending.indexOf(entry);
        if (index >= 0) this.pending.splice(index, 1);
        entry.removeAbortListener();
        reject(new Error("资源等待已取消。"));
        this.drain();
      };
      signal.addEventListener("abort", abort, { once: true });
      entry = {
        claims: normalized,
        signal,
        resolve,
        reject,
        removeAbortListener: () => signal.removeEventListener("abort", abort),
      };
      this.pending.push(entry);
      if (signal.aborted) abort();
      else this.drain();
    });
  }

  canAcquire(claims: ToolResourceClaim[]): boolean {
    const normalized = normalizeClaims(claims);
    return ![...this.active].some((lease) => conflicts(normalized, lease.claims));
  }

  private drain(): void {
    for (let index = 0; index < this.pending.length;) {
      const candidate = this.pending[index];
      if (candidate.signal.aborted) {
        this.pending.splice(index, 1);
        candidate.removeAbortListener();
        candidate.reject(new Error("资源等待已取消。"));
        continue;
      }
      const blockedByActive = [...this.active].some((lease) => conflicts(candidate.claims, lease.claims));
      const blockedByEarlier = this.pending.slice(0, index).some((earlier) => conflicts(candidate.claims, earlier.claims));
      if (blockedByActive || blockedByEarlier) {
        index += 1;
        continue;
      }
      this.pending.splice(index, 1);
      candidate.removeAbortListener();
      const active: ActiveLease = { claims: candidate.claims };
      this.active.add(active);
      let released = false;
      candidate.resolve({
        release: () => {
          if (released) return;
          released = true;
          this.active.delete(active);
          this.drain();
        },
      });
    }
  }
}

function normalizeClaims(claims: ToolResourceClaim[]): ToolResourceClaim[] {
  const merged = new Map<string, ToolResourceAccess>();
  for (const claim of claims) {
    const key = normalizeKey(claim.key);
    if (!key) continue;
    const current = merged.get(key);
    merged.set(key, current === "write" || claim.access === "write" ? "write" : "read");
  }
  return [...merged.entries()]
    .map(([key, access]) => ({ key, access }))
    .sort((left, right) => left.key.localeCompare(right.key, "en"));
}

function normalizeKey(value: string): string {
  let key = value.trim().replace(/[\\/]+/gu, sep);
  while (key.length > 3 && key.endsWith(sep)) key = key.slice(0, -1);
  return process.platform === "win32" ? key.toLocaleLowerCase("en-US") : key;
}

function conflicts(left: ToolResourceClaim[], right: ToolResourceClaim[]): boolean {
  return left.some((a) => right.some((b) =>
    pathsOverlap(a.key, b.key) && (a.access === "write" || b.access === "write")));
}

function pathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}${sep}`) || right.startsWith(`${left}${sep}`);
}
