import { Worker } from "node:worker_threads";
import { CodeCallRecord, CodeRunRequest, CodeRunResult, CodeSubcallResult } from "../../core/code-mode-contracts";

interface CodeRuntimeOptions {
  maxParallel?: number;
  maxCalls?: number;
  maxOutputBytes?: number;
  workerTimeoutMs?: number;
}

interface WorkerCallMessage {
  kind: "call";
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  parentCallId?: string;
}

export class CodeRuntimeService {
  constructor(private readonly defaults: CodeRuntimeOptions = {}) {}

  async run(request: CodeRunRequest): Promise<CodeRunResult> {
    const forbidden = forbiddenCapability(request.program);
    if (forbidden) return failure(`Code Mode 程序使用了禁止的 Node 能力：${forbidden}。`);
    const maxParallel = clamp(request.maxParallel ?? this.defaults.maxParallel ?? 4, 1, 10);
    const maxCalls = Math.max(1, Math.floor(request.maxCalls ?? this.defaults.maxCalls ?? 64));
    const maxOutputBytes = Math.max(256, Math.floor(request.maxOutputBytes ?? this.defaults.maxOutputBytes ?? 16 * 1024));
    const calls: CodeCallRecord[] = [];
    const logs: string[] = [];
    let outputBytes = 0;
    let outputTruncated = false;
    let active = 0;
    const waiters: Array<() => void> = [];
    const worker = new Worker(workerSource(), { eval: true });
    let settled = false;
    let abortHandler: (() => void) | undefined;

    const result = new Promise<CodeRunResult>((resolve) => {
      const finish = (value: CodeRunResult) => {
        if (settled) return;
        settled = true;
        if (abortHandler && request.signal) request.signal.removeEventListener("abort", abortHandler);
        void worker.terminate();
        resolve(value);
      };
      const acquire = async (): Promise<void> => {
        if (active < maxParallel) {
          active += 1;
          return;
        }
        await new Promise<void>((resolveWait) => waiters.push(resolveWait));
        active += 1;
      };
      const release = () => {
        active -= 1;
        waiters.shift()?.();
      };
      const onMessage = async (message: Record<string, unknown>) => {
        if (message.kind === "log") {
          const text = String(message.text ?? "");
          const remaining = maxOutputBytes - outputBytes;
          if (remaining <= 0) {
            outputTruncated = true;
            return;
          }
          const clipped = text.slice(0, remaining);
          logs.push(clipped);
          outputBytes += Buffer.byteLength(clipped, "utf8");
          if (clipped.length < text.length) outputTruncated = true;
          return;
        }
        if (message.kind === "call") {
          const call = message as unknown as WorkerCallMessage;
          if (calls.length >= maxCalls) {
            worker.postMessage({ kind: "call-result", requestId: call.requestId, ok: false, error: "Code Mode 子调用已达到上限。" });
            return;
          }
          const callId = `code-call-${calls.length + 1}`;
          const parentCallId = call.parentCallId ?? request.parentCallId;
          calls.push({ callId, parentCallId, toolName: call.toolName, status: "completed", textPreview: "" });
          await acquire();
          try {
            const subcall = await request.invoke({
              callId,
              parentCallId,
              runId: request.runId,
              sessionId: request.sessionId,
              toolName: call.toolName,
              input: call.input,
              signal: request.signal ?? new AbortController().signal,
            });
            const record = calls.find((item) => item.callId === callId)!;
            record.status = subcall.cancelled ? "cancelled" : subcall.isError ? "failed" : "completed";
            record.textPreview = subcall.text.slice(0, 512);
            worker.postMessage({ kind: "call-result", requestId: call.requestId, ok: subcall.isError !== true, result: { ...subcall, callId } });
          } catch (error) {
            const record = calls.find((item) => item.callId === callId)!;
            record.status = "failed";
            record.textPreview = error instanceof Error ? error.message : String(error);
            worker.postMessage({ kind: "call-result", requestId: call.requestId, ok: false, error: record.textPreview });
          } finally {
            release();
          }
          return;
        }
        if (message.kind === "complete") {
          finish({ ok: true, value: message.value, logs, calls, outputTruncated });
          return;
        }
        if (message.kind === "error") {
          finish({ ok: false, error: String(message.error ?? "Code Mode worker 失败。"), logs, calls, outputTruncated });
        }
      };
      worker.on("message", (message: Record<string, unknown>) => { void onMessage(message); });
      worker.once("error", (error) => finish({ ok: false, error: error.message, logs, calls, outputTruncated }));
      worker.once("exit", (code) => {
        if (!settled && code !== 0) finish({ ok: false, error: `Code Mode worker 已退出（${code}）。`, logs, calls, outputTruncated });
      });
      abortHandler = () => finish({ ok: false, cancelled: true, error: "Code Mode 已取消。", logs, calls, outputTruncated });
      request.signal?.addEventListener("abort", abortHandler, { once: true });
      worker.postMessage({ kind: "start", program: request.program, bindings: request.bindings ?? {} });
      if (this.defaults.workerTimeoutMs) {
        setTimeout(() => {
          if (!settled) finish({ ok: false, error: "Code Mode worker 超时。", logs, calls, outputTruncated });
        }, this.defaults.workerTimeoutMs);
      }
    });
    return result;
  }
}

function workerSource(): string {
  return `
    const { parentPort } = require("node:worker_threads");
    const vm = require("node:vm");
    const pending = new Map();
    let sequence = 0;
    const sdk = {
      call(name, input, parentCallId) {
        const requestId = "sdk-" + (++sequence);
        return new Promise((resolve, reject) => {
          pending.set(requestId, { resolve, reject });
          parentPort.postMessage({ kind: "call", requestId, toolName: name, input: input || {}, parentCallId });
        });
      },
      parallel(calls) { return Promise.all(calls); },
    };
    parentPort.on("message", async (message) => {
      if (message.kind === "call-result") {
        const item = pending.get(message.requestId);
        if (!item) return;
        pending.delete(message.requestId);
        if (message.ok) item.resolve(message.result);
        else item.reject(new Error(message.error || "Code Mode 子调用失败。"));
        return;
      }
      if (message.kind !== "start") return;
      try {
        const sandbox = { sdk, bindings: Object.freeze(message.bindings || {}), console: { log: (...args) => parentPort.postMessage({ kind: "log", text: args.map(String).join(" ") }) } };
        const context = vm.createContext(sandbox);
        const value = await vm.runInContext("(async () => {\\n" + message.program + "\\n})()", context);
        parentPort.postMessage({ kind: "complete", value });
      } catch (error) {
        parentPort.postMessage({ kind: "error", error: error && error.message ? error.message : String(error) });
      }
    });
  `;
}

function forbiddenCapability(program: string): string | undefined {
  const checks: Array<[RegExp, string]> = [
    [/\brequire\s*\(/u, "require"],
    [/\bprocess\s*\./u, "process"],
    [/\b(?:fs|child[_]process|module|net|http|https)\s*\./u, "模块或网络入口"],
    [/^\s*import\s/mu, "import"],
  ];
  return checks.find(([pattern]) => pattern.test(program))?.[1];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function failure(error: string): CodeRunResult {
  return { ok: false, error, logs: [], calls: [], outputTruncated: false };
}
