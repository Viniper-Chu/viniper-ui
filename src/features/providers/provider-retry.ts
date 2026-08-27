import { ProviderEvent } from "../../core/provider-contracts";
import { ProviderTransportError } from "./protocols/shared/provider-transport";

export interface ProviderRetryOptions {
  maxAttempts?: number;
  stream: () => AsyncIterable<ProviderEvent>;
  onAttempt?: (attempt: number) => void | Promise<void>;
  onRetry?: (input: { attempt: number; nextAttempt: number; error: unknown }) => void | Promise<void>;
  hasSemanticOutput?: (events: ProviderEvent[]) => boolean;
  sleep?: (milliseconds: number) => Promise<void>;
  retryDelayMs?: number | ((retryNumber: number) => number);
}

export type ProviderRetryResult =
  | { ok: true; events: ProviderEvent[]; attempts: number }
  | { ok: false; error: unknown; attempts: number };

/**
 * Collects one logical Provider response before publishing it to the runtime.
 * This keeps a failed pre-output request retryable without duplicating partial
 * events, while any semantic output or tool call freezes the attempt.
 */
export async function runProviderWithRetries(options: ProviderRetryOptions): Promise<ProviderRetryResult> {
  const maxAttempts = Math.min(5, Math.max(1, Math.trunc(options.maxAttempts ?? 5)));
  const hasSemanticOutput = options.hasSemanticOutput ?? defaultHasSemanticOutput;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let attempts = 0;
  while (attempts < maxAttempts) {
    attempts += 1;
    await options.onAttempt?.(attempts);
    const events: ProviderEvent[] = [];
    try {
      for await (const event of options.stream()) events.push(event);
      return { ok: true, events, attempts };
    } catch (error) {
      if (hasSemanticOutput(events)) throw error;
      if (!isRetryable(error) || attempts >= maxAttempts) {
        return { ok: false, error, attempts };
      }
      const retryNumber = attempts;
      await options.onRetry?.({ attempt: attempts, nextAttempt: attempts + 1, error });
      const delay = typeof options.retryDelayMs === "function"
        ? options.retryDelayMs(retryNumber)
        : options.retryDelayMs ?? 0;
      if (delay > 0) await sleep(delay);
    }
  }
  return { ok: false, error: new Error("Provider 重试已停止。"), attempts };
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
