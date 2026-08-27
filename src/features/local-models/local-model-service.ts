import { LocalModelPersistence } from "../../core/ports";
import {
  LocalModelRecord,
  LocalModelRegistration,
  LocalModelSnapshot,
  LocalModelVersion,
} from "../../core/local-model-contracts";

export type LocalModelChangeListener = (record: LocalModelRecord) => void;

export class LocalModelService {
  private readonly records = new Map<string, LocalModelRecord>();
  private readonly waiters: Array<() => void> = [];
  private activeRuns = 0;
  private initialized = false;

  constructor(
    private readonly persistence?: LocalModelPersistence,
    private readonly now: () => number = Date.now,
    private readonly maxConcurrency = 1,
    private readonly onChange?: LocalModelChangeListener,
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const saved = await this.persistence?.loadLocalModels();
    for (const record of saved ?? []) {
      const restored = clone(record);
      this.records.set(restored.id, restored);
      if (restored.status === "installed" && restored.activeVersionId) this.onChange?.(restored);
    }
    this.initialized = true;
  }

  snapshot(): LocalModelSnapshot {
    return clone({
      cloudDefault: true as const,
      records: [...this.records.values()].sort((left, right) => left.label.localeCompare(right.label)),
      maxConcurrency: Math.min(8, Math.max(1, Math.trunc(this.maxConcurrency))),
      activeRuns: this.activeRuns,
    });
  }

  async registerLoopback(input: LocalModelRegistration): Promise<boolean> {
    if (input.endpoint && !isLoopbackEndpoint(input.endpoint)) return false;
    if (this.records.has(input.id)) return false;
    const version: LocalModelVersion = { id: input.version, status: "pending", registeredAt: this.now() };
    this.records.set(input.id, {
      id: input.id,
      label: input.label,
      source: input.source,
      ...(input.endpoint ? { endpoint: input.endpoint } : {}),
      ...(input.runner ? { runner: input.runner } : {}),
      license: input.license,
      ...(input.sizeBytes === undefined ? {} : { sizeBytes: input.sizeBytes }),
      format: input.format,
      compatibility: input.compatibility,
      toolCapability: input.toolCapability,
      status: "pending-confirmation",
      versions: [version],
      pendingVersionId: version.id,
    });
    await this.persist();
    return true;
  }

  async confirmAdoption(id: string, versionId: string): Promise<boolean> {
    const record = this.records.get(id);
    if (!record || record.pendingVersionId !== versionId) return false;
    record.versions = record.versions.map((version) => ({
      ...version,
      status: version.id === versionId ? "active" : "retained",
    }));
    record.activeVersionId = versionId;
    delete record.pendingVersionId;
    record.status = "installed";
    await this.persist();
    this.onChange?.(clone(record));
    return true;
  }

  async requestUpdate(id: string, versionId: string): Promise<boolean> {
    const record = this.records.get(id);
    if (!record || record.activeVersionId === versionId || record.pendingVersionId) return false;
    record.versions.push({ id: versionId, status: "pending", registeredAt: this.now() });
    record.pendingVersionId = versionId;
    record.status = "update-available";
    await this.persist();
    this.onChange?.(clone(record));
    return true;
  }

  async confirmUpdate(id: string): Promise<boolean> {
    const record = this.records.get(id);
    const pending = record?.pendingVersionId;
    if (!record || !pending) return false;
    record.versions = record.versions.map((version) => ({
      ...version,
      status: version.id === pending ? "active" : "retained",
    }));
    record.activeVersionId = pending;
    delete record.pendingVersionId;
    record.status = "installed";
    await this.persist();
    this.onChange?.(clone(record));
    return true;
  }

  async withInferenceSlot<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await work();
    } finally {
      this.activeRuns -= 1;
      this.waiters.shift()?.();
    }
  }

  isModelAvailable(providerId: string, modelId: string): boolean {
    if (!providerId.startsWith("local-model:")) return false;
    const id = providerId.slice("local-model:".length);
    const record = this.records.get(id);
    return Boolean(record?.status === "installed" && record.activeVersionId && modelId === id);
  }

  private async acquire(): Promise<void> {
    if (this.activeRuns < this.maxConcurrency) {
      this.activeRuns += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.activeRuns += 1;
  }

  private async persist(): Promise<void> {
    if (!this.persistence) return;
    await this.persistence.saveLocalModels([...this.records.values()].map(clone));
  }
}

function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
    return (url.protocol === "http:" || url.protocol === "https:")
      && (host === "localhost" || host === "127.0.0.1" || host === "::1");
  } catch {
    return false;
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
