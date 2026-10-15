import { newId } from "../../core/ids";
import {
  TerminalExecutionContext,
  TerminalOutputInput,
  TerminalOutputHistory,
  TerminalOutputResult,
  TerminalProcessHost,
  TerminalRunInput,
  TerminalRunResult,
} from "./contracts";

const DEFAULT_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 1_800_000;
const MAX_COMMAND_CHARS = 32_000;
const PURPOSES = new Set(["command", "dependency", "build", "test", "lint", "typecheck"]);

export class TerminalService {
  constructor(
    private readonly host: TerminalProcessHost,
    private readonly allowUnscoped = false,
  ) {}

  async run(input: TerminalRunInput, context: TerminalExecutionContext): Promise<TerminalRunResult> {
    const executionId = newId("terminal-execution");
    const command = input.command?.trim() ?? "";
    const purpose = input.purpose ?? "command";
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!context.projectRoot && !this.allowUnscoped) {
      return failedResult(executionId, purpose, timeoutMs, "PROJECT_NOT_ENABLED", "本次运行没有显式打开项目；terminal.run 未执行。");
    }
    if (!command) {
      return failedResult(executionId, purpose, timeoutMs, "COMMAND_REQUIRED", "terminal.run 需要非空命令。");
    }
    if (!PURPOSES.has(purpose)) {
      return failedResult(executionId, "command", timeoutMs, "PURPOSE_INVALID", "purpose 必须是 command/dependency/build/test/lint/typecheck 之一。");
    }
    if (command.length > MAX_COMMAND_CHARS) {
      return failedResult(executionId, purpose, timeoutMs, "COMMAND_TOO_LONG", `命令超过 ${MAX_COMMAND_CHARS} 字符上限。`);
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
      return failedResult(
        executionId,
        purpose,
        timeoutMs,
        "TIMEOUT_INVALID",
        `超时必须是 ${MIN_TIMEOUT_MS}–${MAX_TIMEOUT_MS} 毫秒之间的整数。`,
      );
    }
    return this.host.run({
      executionId,
      input: { ...input, command, purpose, timeoutMs },
    }, context);
  }

  output(input: TerminalOutputInput, context: TerminalExecutionContext): Promise<TerminalOutputResult> {
    const invalid = invalidOutputStream(input);
    if (invalid) return Promise.resolve(invalid);
    return this.host.output(input, context);
  }

  outputForSession(input: TerminalOutputInput, sessionId: string, history?: TerminalOutputHistory): Promise<TerminalOutputResult> {
    const invalid = invalidOutputStream(input);
    if (invalid) return Promise.resolve(invalid);
    return this.host.outputForSession(input, sessionId, history);
  }

  dispose(): Promise<void> {
    return this.host.dispose();
  }
}

function failedResult(
  executionId: string,
  purpose: TerminalRunResult["purpose"],
  timeoutMs: number,
  code: NonNullable<TerminalRunResult["error"]>["code"],
  message: string,
): TerminalRunResult {
  return {
    ok: false,
    executionId,
    status: "failed",
    purpose,
    cwd: ".",
    timeoutMs,
    exitCode: null,
    durationMs: 0,
    stdout: emptyPreview(executionId, "stdout"),
    stderr: emptyPreview(executionId, "stderr"),
    error: { code, message },
  };
}

function emptyPreview(executionId: string, stream: "stdout" | "stderr") {
  return {
    preview: "",
    totalBytes: 0,
    truncated: false,
    ref: `terminal-output://${executionId}/${stream}`,
  };
}

function invalidOutputStream(input: TerminalOutputInput): TerminalOutputResult | undefined {
  if (input.stream === "stdout" || input.stream === "stderr") return undefined;
  return {
    ok: false,
    executionId: input.executionId,
    stream: "stdout",
    status: "failed",
    offset: input.offset ?? 0,
    bytes: 0,
    totalBytes: 0,
    text: "",
    nextOffset: null,
    truncated: false,
    complete: true,
    error: { code: "OUTPUT_STREAM_INVALID", message: "stream 必须是 stdout 或 stderr。" },
  };
}
