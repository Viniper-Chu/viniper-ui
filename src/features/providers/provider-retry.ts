import { ProviderEvent } from "../../core/provider-contracts";
import { ProviderTransportError } from "./protocols/shared/provider-transport";

export interface ProviderRetryOptions {
  maxAttempts?: number;
  stream: () => AsyncIterable<ProviderEvent>;
  onAttempt?: (attempt: number) => void | Promise<void>;
  onRetry?: (input: { attempt: number; nextAttempt: number; error: unknown }) => void | Promise<void>;
  onEvent?: (event: ProviderEvent) => void | Promise<void>;
  signal?: AbortSignal;
  hasSemanticOutput?: (events: ProviderEvent[]) => boolean;
  sleep?: (milliseconds: number) => Promise<void>;
  retryDelayMs?: number | ((retryNumber: number) => number);
}

export type ProviderRetryResult =
  | { ok: true; events: ProviderEvent[]; attempts: number }
  | { ok: false; error: unknown; attempts: number };

/**
 * Streams semantic output as it arrives. Pre-output metadata is held until the
 * attempt commits, so retrying a failed connection cannot duplicate that data.
 * Callers without onEvent retain the collected-response interface.
 */
export async function runProviderWithRetries(options: ProviderRetryOptions): Promise<ProviderRetryResult> {
  const maxAttempts = Math.min(5, Math.max(1, Math.trunc(options.maxAttempts ?? 5)));
  const hasSemanticOutput = options.hasSemanticOutput ?? defaultHasSemanticOutput;
  let attempts = 0;
  while (attempts < maxAttempts) {
    throwIfCancelled(options.signal);
    attempts += 1;
    await options.onAttempt?.(attempts);
    const events: ProviderEvent[] = [];
    let published = 0;
    let publicationStarted = false;
    const publish = async () => {
      if (!options.onEvent) return;
      while (published < events.length) {
        throwIfCancelled(options.signal);
        publicationStarted = true;
        await options.onEvent(events[published++]);
      }
    };
    try {
      throwIfCancelled(options.signal);
      for await (const event of options.stream()) {
        throwIfCancelled(options.signal);
        events.push(event);
        if (hasSemanticOutput(events)) await publish();
      }
      throwIfCancelled(options.signal);
      await publish();
      return { ok: true, events, attempts };
    } catch (error) {
      throwIfCancelled(options.signal);
      if (publicationStarted || hasSemanticOutput(events)) throw error;
      if (!isRetryable(error) || attempts >= maxAttempts) {
        return { ok: false, error, attempts };
      }
      const retryNumber = attempts;
      await options.onRetry?.({ attempt: attempts, nextAttempt: attempts + 1, error });
      const delay = typeof options.retryDelayMs === "function"
        ? options.retryDelayMs(retryNumber)
        : options.retryDelayMs ?? 0;
      if (delay > 0) await waitForRetry(delay, options.signal, options.sleep);
    }
  }
  return { ok: false, error: new Error("Provider 重试已停止。"), attempts };
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ProviderTransportError("cancelled");
}

async function waitForRetry(milliseconds: number, signal?: AbortSignal, sleep?: ProviderRetryOptions["sleep"]): Promise<void> {
  throwIfCancelled(signal);
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const finish = () => { cleanup(); resolve(); };
    const fail = (error: unknown) => { cleanup(); reject(error); };
    const abort = () => fail(new ProviderTransportError("cancelled"));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    if (sleep) Promise.resolve().then(() => sleep(milliseconds)).then(finish, fail);
    else timer = setTimeout(finish, milliseconds);
  });
}

export function isRetryableProviderError(error: unknown): boolean {
  return isRetryable(error);
}

function isRetryable(error: unknown): boolean {
  return error instanceof ProviderTransportError
    && (error.kind === "rate-limit" || error.kind === "server" || error.kind === "network");
}

function defaultHasSemanticOutput(events: ProviderEvent[]): boolean {
  return events.some((event) => event.kind === "text.delta"
    || event.kind === "reasoning.delta"
    || event.kind === "reasoning.completed"
    || event.kind === "tool-call.completed"
    || event.kind === "model-step.completed");
}
