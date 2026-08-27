export const RUNTIME_PROTOCOL_VERSION = 2 as const;
export const RUNTIME_PROTOCOL_CAPABILITIES = [
  "typed-dispatch",
  "revisioned-snapshot",
  "bounded-outbound-queue",
  "engine-partitioned-state",
] as const;

export type RuntimeProtocolCapability = typeof RUNTIME_PROTOCOL_CAPABILITIES[number];

export interface RuntimeProtocolOffer {
  protocolVersion: number;
  capabilities: RuntimeProtocolCapability[];
}

export interface RuntimeProtocolNegotiation {
  protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
  capabilities: RuntimeProtocolCapability[];
}

export class RuntimeProtocolMismatchError extends Error {
  constructor(readonly received: number) {
    super(`RUNTIME_PROTOCOL_MISMATCH: expected ${RUNTIME_PROTOCOL_VERSION}, received ${received}`);
    this.name = "RuntimeProtocolMismatchError";
  }
}

export class RuntimeOverloadedError extends Error {
  readonly retryAfterMs = 120;

  constructor(readonly capacity: number) {
    super(`RUNTIME_OVERLOADED: outbound queue capacity ${capacity} reached`);
    this.name = "RuntimeOverloadedError";
  }
}

export function negotiateRuntimeProtocol(offer: RuntimeProtocolOffer): RuntimeProtocolNegotiation {
  if (offer.protocolVersion !== RUNTIME_PROTOCOL_VERSION) throw new RuntimeProtocolMismatchError(offer.protocolVersion);
  const supported = new Set<RuntimeProtocolCapability>(RUNTIME_PROTOCOL_CAPABILITIES);
  const capabilities = [...new Set(offer.capabilities)].filter((item): item is RuntimeProtocolCapability => supported.has(item));
  if (!capabilities.includes("typed-dispatch")) throw new Error("RUNTIME_CAPABILITY_MISSING: typed-dispatch");
  return { protocolVersion: RUNTIME_PROTOCOL_VERSION, capabilities };
}

export class BoundedOutboundQueue<T> {
  private readonly values: T[] = [];

  constructor(readonly capacity = 64) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("RUNTIME_QUEUE_CAPACITY_INVALID");
  }

  enqueue(value: T): void {
    if (this.values.length >= this.capacity) throw new RuntimeOverloadedError(this.capacity);
    this.values.push(value);
  }

  drain(): T[] {
    return this.values.splice(0, this.values.length);
  }

  get size(): number { return this.values.length; }
}
