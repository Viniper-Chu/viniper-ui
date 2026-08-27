import { MemoryCreateInput, MemoryEntry, MemorySnapshot } from "../../core/memory-contracts";
import { Phase8Cp3Persistence } from "../../core/ports";
import { newId } from "../../core/ids";

const STALE_AFTER_MS = 90 * 24 * 60 * 60 * 1_000;
const SOFT_CAPACITY = 200;

export class MemoryService {
  private readonly entries = new Map<string, MemoryEntry>();

  constructor(
    private readonly persistence?: Phase8Cp3Persistence,
    private readonly now: () => number = Date.now,
  ) {}

  async initialize(): Promise<void> {
    for (const entry of (await this.persistence?.loadMemoryEntries()) ?? []) this.entries.set(entry.id, clone(entry));
  }

  snapshot(): MemorySnapshot {
    this.markAgedEntries();
    return {
      entries: [...this.entries.values()].map(clone),
      capacityWarning: [...this.entries.values()].filter((entry) => entry.status !== "deleted").length >= SOFT_CAPACITY,
      capacity: SOFT_CAPACITY,
    };
  }

  async create(input: MemoryCreateInput): Promise<MemoryEntry> {
    const text = input.text.trim();
    if (!text) throw new Error("记忆内容不能为空。");
    const timestamp = this.now();
    const entry: MemoryEntry = {
      id: newId("memory"),
      scope: input.scope,
      source: input.source,
      text,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
      useCount: 0,
      status: "active",
      stale: false,
    };
    this.entries.set(entry.id, entry);
    await this.persist();
    return clone(entry);
  }

  async update(id: string, text: string): Promise<boolean> {
    const entry = this.entries.get(id);
    const next = text.trim();
    if (!entry || entry.status === "deleted" || !next) return false;
    entry.text = next;
    entry.updatedAt = this.now();
    entry.stale = false;
    delete entry.staleReason;
    await this.persist();
    return true;
  }

  async setEnabled(id: string, enabled: boolean): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry || entry.status === "deleted") return false;
    entry.status = enabled ? "active" : "disabled";
    entry.updatedAt = this.now();
    await this.persist();
    return true;
  }

  async markConflict(id: string, conflict = true): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry || entry.status === "deleted") return false;
    entry.stale = conflict;
    if (conflict) entry.staleReason = "conflict";
    else delete entry.staleReason;
    entry.updatedAt = this.now();
    await this.persist();
    return true;
  }

  async delete(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry || entry.status === "deleted") return false;
    entry.status = "deleted";
    entry.updatedAt = this.now();
    await this.persist();
    return true;
  }

  selectForInjection(input: {
    sessionId?: string;
    projectRoot?: string;
    queryText?: string;
    enabled?: boolean;
    maxEntries?: number;
    maxChars?: number;
    /**
     * Automatic assistant captures already exist in canonical conversation
     * history.  Re-injecting them ahead of that history rewrites the system
     * prefix on every run and duplicates model-authored text.
     */
    excludeAutomaticSessionCapture?: boolean;
  }): MemoryEntry[] {
    if (input.enabled === false) return [];
    this.markAgedEntries();
    const usedAt = this.now();
    const selected: MemoryEntry[] = [];
    const queryTerms = relevanceTerms(input.queryText ?? "");
    const maxEntries = Math.min(20, Math.max(1, Math.floor(input.maxEntries ?? 8)));
    const maxChars = Math.min(12_000, Math.max(256, Math.floor(input.maxChars ?? 4_000)));
    let selectedChars = 0;
    for (const entry of this.entries.values()) {
      if (entry.status !== "active" || entry.stale) continue;
      if (input.excludeAutomaticSessionCapture && entry.source === "session-auto") continue;
      if (entry.scope === "session-auto" && entry.sessionId !== input.sessionId) continue;
      if (entry.scope === "project" && !samePath(entry.projectRoot, input.projectRoot)) continue;
      if (queryTerms.length > 0 && !isRelevant(entry.text, queryTerms)) continue;
      if (selected.length >= maxEntries || selectedChars + entry.text.length > maxChars) continue;
      entry.lastUsedAt = usedAt;
      entry.useCount += 1;
      selected.push(clone(entry));
      selectedChars += entry.text.length;
    }
    if (selected.length > 0) void this.persist();
    return selected;
  }

  async captureSession(sessionId: string, projectRoot: string | undefined, text: string): Promise<MemoryEntry> {
    return this.create({
      scope: "session-auto",
      source: "session-auto",
      text,
      sessionId,
      ...(projectRoot ? { projectRoot } : {}),
    });
  }

  private markAgedEntries(): void {
    const cutoff = this.now() - STALE_AFTER_MS;
    let changed = false;
    for (const entry of this.entries.values()) {
      if (entry.status === "active" && entry.createdAt < cutoff && !entry.stale) {
        entry.stale = true;
        entry.staleReason = "age";
        changed = true;
      }
    }
    if (changed) void this.persist();
  }

  private async persist(): Promise<void> {
    await this.persistence?.saveMemoryEntries([...this.entries.values()].map(clone));
  }
}

function relevanceTerms(text: string): string[] {
  const normalized = text.toLocaleLowerCase().normalize("NFKC");
  const latin = normalized.match(/[a-z0-9_./-]{3,}/gu) ?? [];
  const han = normalized.match(/[\p{Script=Han}]{2,}/gu) ?? [];
  const hanWindows = han.flatMap((value) => value.length <= 4
    ? [value]
    : Array.from({ length: value.length - 2 }, (_, index) => value.slice(index, index + 3)));
  return [...new Set([...latin, ...hanWindows])].slice(0, 64);
}

function isRelevant(memoryText: string, queryTerms: string[]): boolean {
  const normalized = memoryText.toLocaleLowerCase().normalize("NFKC");
  return queryTerms.some((term) => normalized.includes(term));
}

function samePath(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  return left.replace(/[\\/]+$/u, "").toLocaleLowerCase() === right.replace(/[\\/]+$/u, "").toLocaleLowerCase();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
