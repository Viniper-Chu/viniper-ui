import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, open, readFile, realpath, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { finished } from "node:stream/promises";
import {
  TerminalDiagnosticCode,
  TerminalExecutionContext,
  TerminalExecutionStatus,
  TerminalOutputInput,
  TerminalOutputPreview,
  TerminalOutputResult,
  TerminalProcessHost,
  TerminalProcessRequest,
  TerminalRunResult,
  PowerShellProcessIdentity,
  TerminalInteractiveChunk,
  TerminalInteractiveListener,
  TerminalInteractiveStartResult,
} from "../../features/terminal/contracts";
import { ArtifactFileRegistrar } from "../../core/ports";

const DEFAULT_PREVIEW_BYTES = 4_096;
const DEFAULT_OUTPUT_BYTES = 8_192;
const MAX_OUTPUT_BYTES = 65_536;

export interface WindowsProcessHostOptions {
  managedRoot: string;
  artifactService?: ArtifactFileRegistrar;
  now?: () => number;
  shellPath?: string;
  /** Allow the generic Agent to run in an explicit non-project cwd. */
  allowUnscoped?: boolean;
  previewBytes?: number;
}

interface ExecutionRecord {
  executionId: string;
  sessionId: string;
  runId: string;
  stdoutPath: string;
  stderrPath: string;
  stdoutBytes: number;
  stderrBytes: number;
  processIdentityPath: string;
  processIdentity?: PowerShellProcessIdentity;
  status: TerminalExecutionStatus | "running";
}

interface ProcessCloseResult {
  code: number | null;
  error?: Error;
}

interface InteractiveExecution {
  request: TerminalProcessRequest;
  record: ExecutionRecord;
  cwd: string;
  startedAt: number;
  child: ChildProcessWithoutNullStreams;
  stdoutCapture: OutputCapture;
  stderrCapture: OutputCapture;
  listeners: Set<TerminalInteractiveListener>;
  sequence: number;
  completion: Promise<TerminalRunResult>;
}

export class WindowsProcessHost implements TerminalProcessHost {
  private readonly managedRoot: string;
  private readonly now: () => number;
  private readonly shellPath: string;
  private readonly previewBytes: number;
  private readonly artifactService?: ArtifactFileRegistrar;
  private readonly allowUnscoped: boolean;
  private readonly records = new Map<string, ExecutionRecord>();
  private readonly active = new Map<string, ChildProcessWithoutNullStreams>();
  private readonly interactive = new Map<string, InteractiveExecution>();

  constructor(options: WindowsProcessHostOptions) {
    this.managedRoot = resolve(options.managedRoot);
    this.now = options.now ?? Date.now;
    this.shellPath = options.shellPath ?? defaultPowerShellPath();
    this.allowUnscoped = options.allowUnscoped === true;
    this.previewBytes = options.previewBytes ?? DEFAULT_PREVIEW_BYTES;
    this.artifactService = options.artifactService;
  }

  async run(request: TerminalProcessRequest, context: TerminalExecutionContext): Promise<TerminalRunResult> {
    const startedAt = this.now();
    const input = request.input;
    const fallbackCwd = input.cwd?.trim() || ".";
    if (process.platform !== "win32") {
      return failure(request, fallbackCwd, startedAt, "PROCESS_START_FAILED", "P3 当前仅在 Windows 原生进程主平台实现；macOS 仍为 UNPROVEN。");
    }
    if (!context.projectRoot && !this.allowUnscoped) {
      return failure(request, fallbackCwd, startedAt, "PROJECT_NOT_ENABLED", "本次运行没有显式打开项目；terminal.run 未执行。");
    }
    assertInternalId(context.runId, "runId");
    assertInternalId(request.executionId, "executionId");

    const workingDirectory = context.projectRoot
      ? await resolveProjectWorkingDirectory(context.projectRoot, input.cwd)
      : await resolveUnscopedWorkingDirectory(input.cwd);
    if (!workingDirectory.ok) {
      return failure(request, fallbackCwd, startedAt, workingDirectory.code, workingDirectory.message);
    }

    const outputDirectory = join(this.managedRoot, context.runId, request.executionId);
    await mkdir(outputDirectory, { recursive: true });
    const stdoutPath = join(outputDirectory, "stdout.log");
    const stderrPath = join(outputDirectory, "stderr.log");
    const statusPath = join(outputDirectory, "status.txt");
    const processIdentityPath = join(outputDirectory, "process-identity.json");
    const stdoutFile = createWriteStream(stdoutPath, { flags: "wx" });
    const stderrFile = createWriteStream(stderrPath, { flags: "wx" });
    const stdoutCapture = new OutputCapture(this.previewBytes);
    const stderrCapture = new OutputCapture(this.previewBytes);
    const record: ExecutionRecord = {
      executionId: request.executionId,
      sessionId: context.sessionId,
      runId: context.runId,
      stdoutPath,
      stderrPath,
      stdoutBytes: 0,
      stderrBytes: 0,
      processIdentityPath,
      status: "running",
    };
    this.records.set(request.executionId, record);

    if (context.signal.aborted) {
      stdoutFile.end();
      stderrFile.end();
      await Promise.all([finished(stdoutFile), finished(stderrFile)]);
      record.status = "cancelled";
      await this.registerArtifacts(record);
      return resultFromRecord(request, workingDirectory.relativePath, startedAt, record, stdoutCapture, stderrCapture, null);
    }

    const child = spawn(this.shellPath, [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      powerShellScript(input.command, statusPath, processIdentityPath),
    ], {
      cwd: workingDirectory.absolutePath,
      env: safeProcessEnvironment(),
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.end();
    if (child.pid) this.active.set(request.executionId, child);
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutCapture.push(chunk);
      record.stdoutBytes += chunk.length;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrCapture.push(chunk);
      record.stderrBytes += chunk.length;
    });
    child.stdout.pipe(stdoutFile);
    child.stderr.pipe(stderrFile);

    let forcedStatus: "timed-out" | "cancelled" | undefined;
    let terminationPromise: Promise<void> | undefined;
    const requestTermination = (status: "timed-out" | "cancelled") => {
      if (forcedStatus) return;
      forcedStatus = status;
      terminationPromise = child.pid
        ? this.terminateOwnedProcessTree(child.pid)
        : Promise.resolve();
    };
    const abort = () => requestTermination("cancelled");
    context.signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => requestTermination("timed-out"), input.timeoutMs);

    const close = await waitForClose(child);
    clearTimeout(timeout);
    context.signal.removeEventListener("abort", abort);
    let terminationError: Error | undefined;
    try {
      await terminationPromise;
    } catch (error) {
      terminationError = error instanceof Error ? error : new Error(String(error));
    }
    await Promise.all([finished(stdoutFile), finished(stderrFile)]);
    this.active.delete(request.executionId);
    record.processIdentity = await readProcessIdentity(processIdentityPath);
    await this.registerArtifacts(record);

    if (terminationError) {
      record.status = "failed";
      return failureFromRecord(
        request,
        workingDirectory.relativePath,
        startedAt,
        record,
        stdoutCapture,
        stderrCapture,
        "PROCESS_TERMINATION_FAILED",
        `未能确认本 run 进程树已终止：${terminationError.message}`,
      );
    }
    if (forcedStatus) {
      record.status = forcedStatus;
      return resultFromRecord(request, workingDirectory.relativePath, startedAt, record, stdoutCapture, stderrCapture, null);
    }
    if (close.error) {
      record.status = "failed";
      return failureFromRecord(
        request,
        workingDirectory.relativePath,
        startedAt,
        record,
        stdoutCapture,
        stderrCapture,
        "PROCESS_START_FAILED",
        `终端进程未能启动：${close.error.message}`,
      );
    }

    const statusMarker = await readOptionalText(statusPath);
    record.status = statusMarker === "command-not-found"
      ? "not-found"
      : close.code === 0
        ? "completed"
        : "nonzero";
    return resultFromRecord(request, workingDirectory.relativePath, startedAt, record, stdoutCapture, stderrCapture, close.code);
  }

  async output(input: TerminalOutputInput, context: TerminalExecutionContext): Promise<TerminalOutputResult> {
    return this.readOutput(input, (record) => record.sessionId === context.sessionId && record.runId === context.runId);
  }

  async outputForSession(input: TerminalOutputInput, sessionId: string): Promise<TerminalOutputResult> {
    return this.readOutput(input, (record) => record.sessionId === sessionId);
  }

  async startInteractive(request: TerminalProcessRequest, context: TerminalExecutionContext): Promise<TerminalInteractiveStartResult> {
    const startedAt = this.now();
    if (process.platform !== "win32") throw new Error("PROCESS_START_FAILED: interactive PowerShell is Windows-only");
    if (this.interactive.has(request.executionId) || this.active.has(request.executionId)) throw new Error("PROCESS_ALREADY_RUNNING");
    if (!context.projectRoot && !this.allowUnscoped) throw new Error("PROJECT_NOT_ENABLED");
    assertInternalId(context.runId, "runId");
    assertInternalId(request.executionId, "executionId");
    const workingDirectory = context.projectRoot
      ? await resolveProjectWorkingDirectory(context.projectRoot, request.input.cwd)
      : await resolveUnscopedWorkingDirectory(request.input.cwd);
    if (!workingDirectory.ok) throw new Error(`${workingDirectory.code}: ${workingDirectory.message}`);

    const outputDirectory = join(this.managedRoot, context.runId, request.executionId);
    await mkdir(outputDirectory, { recursive: true });
    const stdoutPath = join(outputDirectory, "stdout.log");
    const stderrPath = join(outputDirectory, "stderr.log");
    const processIdentityPath = join(outputDirectory, "process-identity.json");
    const stdoutFile = createWriteStream(stdoutPath, { flags: "wx" });
    const stderrFile = createWriteStream(stderrPath, { flags: "wx" });
    const stdoutCapture = new OutputCapture(this.previewBytes);
    const stderrCapture = new OutputCapture(this.previewBytes);
    const record: ExecutionRecord = {
      executionId: request.executionId,
      sessionId: context.sessionId,
      runId: context.runId,
      stdoutPath,
      stderrPath,
      stdoutBytes: 0,
      stderrBytes: 0,
      processIdentityPath,
      status: "running",
    };
    this.records.set(request.executionId, record);
    const child = spawn(this.shellPath, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "-"], {
      cwd: workingDirectory.absolutePath,
      env: {
        ...safeProcessEnvironment(),
        VINIPER_PROCESS_IDENTITY_PATH: processIdentityPath,
      },
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.active.set(request.executionId, child);
    const state: InteractiveExecution = {
      request,
      record,
      cwd: workingDirectory.relativePath,
      startedAt,
      child,
      stdoutCapture,
      stderrCapture,
      listeners: new Set<TerminalInteractiveListener>(),
      sequence: 0,
      completion: Promise.resolve(undefined as never),
    };
    const projectChunk = (stream: "stdout" | "stderr", chunk: Buffer): void => {
      const capture = stream === "stdout" ? stdoutCapture : stderrCapture;
      capture.push(chunk);
      if (stream === "stdout") record.stdoutBytes += chunk.length;
      else record.stderrBytes += chunk.length;
      const projected: TerminalInteractiveChunk = {
        executionId: request.executionId,
        sequence: ++state.sequence,
        stream,
        text: stripAnsi(chunk.toString("utf8")).slice(-MAX_OUTPUT_BYTES),
        timestamp: this.now(),
      };
      for (const listener of state.listeners) listener(projected);
    };
    child.stdout.on("data", (chunk: Buffer) => projectChunk("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => projectChunk("stderr", chunk));
    child.stdout.pipe(stdoutFile);
    child.stderr.pipe(stderrFile);

    let forcedStatus: "timed-out" | "cancelled" | undefined;
    const terminate = (status: "timed-out" | "cancelled"): void => {
      if (forcedStatus) return;
      forcedStatus = status;
      if (child.pid) void this.terminateOwnedProcessTree(child.pid).catch(() => undefined);
    };
    const abort = () => terminate("cancelled");
    context.signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => terminate("timed-out"), request.input.timeoutMs);
    state.completion = (async () => {
      const close = await waitForClose(child);
      clearTimeout(timeout);
      context.signal.removeEventListener("abort", abort);
      await Promise.all([finished(stdoutFile), finished(stderrFile)]);
      this.active.delete(request.executionId);
      record.processIdentity = await readProcessIdentity(processIdentityPath);
      record.status = forcedStatus ?? (close.error ? "failed" : close.code === 0 ? "completed" : "nonzero");
      await this.registerArtifacts(record);
      return resultFromRecord(request, workingDirectory.relativePath, startedAt, record, stdoutCapture, stderrCapture, close.code);
    })();
    this.interactive.set(request.executionId, state);
    child.stdin.write(interactiveIdentityPrelude());
    return { executionId: request.executionId, status: "running", transport: "pipes" };
  }

  async writeInteractive(executionId: string, text: string): Promise<boolean> {
    const state = this.interactive.get(executionId);
    if (!state || state.record.status !== "running" || state.child.stdin.destroyed) return false;
    return new Promise<boolean>((resolveWrite, rejectWrite) => {
      state.child.stdin.write(text, (error) => error ? rejectWrite(error) : resolveWrite(true));
    });
  }

  subscribeInteractive(executionId: string, listener: TerminalInteractiveListener): () => void {
    const state = this.interactive.get(executionId);
    if (!state) throw new Error("OUTPUT_NOT_FOUND");
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  }

  async waitInteractive(executionId: string): Promise<TerminalRunResult> {
    const state = this.interactive.get(executionId);
    if (!state) throw new Error("OUTPUT_NOT_FOUND");
    const result = await state.completion;
    this.interactive.delete(executionId);
    return result;
  }

  async stopInteractive(executionId: string): Promise<boolean> {
    const state = this.interactive.get(executionId);
    if (!state || state.record.status !== "running") return false;
    if (state.child.pid) await this.terminateOwnedProcessTree(state.child.pid);
    return true;
  }

  private async readOutput(
    input: TerminalOutputInput,
    owns: (record: ExecutionRecord) => boolean,
  ): Promise<TerminalOutputResult> {
    const record = this.records.get(input.executionId);
    if (!record) return outputFailure(input, "OUTPUT_NOT_FOUND", "未找到该终端输出引用。");
    if (!owns(record)) {
      return outputFailure(input, "OUTPUT_NOT_OWNED", "该输出不属于本次 run；未读取任何文件。");
    }
    const offset = input.offset ?? 0;
    const maxBytes = input.maxBytes ?? DEFAULT_OUTPUT_BYTES;
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_OUTPUT_BYTES) {
      return outputFailure(input, "OUTPUT_RANGE_INVALID", `offset 必须为非负整数，maxBytes 必须为 1–${MAX_OUTPUT_BYTES}。`);
    }
    const path = input.stream === "stdout" ? record.stdoutPath : record.stderrPath;
    const totalBytes = input.stream === "stdout" ? record.stdoutBytes : record.stderrBytes;
    if (offset > totalBytes) {
      return outputFailure(input, "OUTPUT_RANGE_INVALID", `offset ${offset} 超过当前输出总字节 ${totalBytes}。`, record.status);
    }
    const bytesToRead = Math.min(maxBytes, totalBytes - offset);
    const buffer = Buffer.alloc(bytesToRead);
    let bytes = 0;
    if (bytesToRead > 0) {
      const file = await open(path, "r");
      try {
        ({ bytesRead: bytes } = await file.read(buffer, 0, bytesToRead, offset));
      } finally {
        await file.close();
      }
    }
    const nextOffset = offset + bytes < totalBytes ? offset + bytes : null;
    return {
      ok: true,
      executionId: input.executionId,
      stream: input.stream,
      status: record.status,
      offset,
      bytes,
      totalBytes,
      text: stripAnsi(buffer.subarray(0, bytes).toString("utf8")),
      nextOffset,
      truncated: nextOffset !== null,
      complete: record.status !== "running" && nextOffset === null,
    };
  }

  async dispose(): Promise<void> {
    const entries = [...this.active.entries()];
    await Promise.all(entries.map(async ([executionId, child]) => {
      if (child.pid) await this.terminateOwnedProcessTree(child.pid);
      this.active.delete(executionId);
    }));
  }

  private async terminateOwnedProcessTree(rootProcessId: number): Promise<void> {
    // Use the native bounded tree terminator first. Starting a fresh
    // PowerShell host for every timeout can take several seconds while the
    // Windows Apps shim initialises, turning a short run timeout into a
    // multi-second hang. Keep the CIM walk below as a diagnostic fallback.
    const taskKillPath = join(process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows", "System32", "taskkill.exe");
    const nativeKill = spawn(taskKillPath, ["/PID", String(rootProcessId), "/T", "/F"], {
      env: safeProcessEnvironment(),
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "ignore", "ignore"],
    });
    const nativeClosed = await new Promise<{ code: number | null; error?: Error }>((resolveClose) => {
      let settled = false;
      nativeKill.once("error", (error) => {
        if (settled) return;
        settled = true;
        resolveClose({ code: null, error });
      });
      nativeKill.once("close", (code) => {
        if (settled) return;
        settled = true;
        resolveClose({ code });
      });
    });
    if (!nativeClosed.error && nativeClosed.code === 0 && !isProcessRunning(rootProcessId)) return;

    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$rootProcessId = ${rootProcessId}`,
      "$all = @(Get-CimInstance Win32_Process)",
      "$children = @{}",
      "foreach ($item in $all) {",
      "  $parent = [int]$item.ParentProcessId",
      "  if (-not $children.ContainsKey($parent)) { $children[$parent] = [System.Collections.Generic.List[int]]::new() }",
      "  $children[$parent].Add([int]$item.ProcessId)",
      "}",
      "$ordered = [System.Collections.Generic.List[int]]::new()",
      "function Add-OwnedProcess([int]$processId) {",
      "  if ($children.ContainsKey($processId)) { foreach ($childId in $children[$processId]) { Add-OwnedProcess $childId } }",
      "  $ordered.Add($processId)",
      "}",
      "Add-OwnedProcess $rootProcessId",
      "foreach ($processId in $ordered) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }",
    ].join("\n");
    const killer = spawn(this.shellPath, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      env: safeProcessEnvironment(),
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
    });
    // Windows PowerShell can fail while initialising its hidden ConsoleHost when every
    // standard handle is ignored under concurrent cancellation. Keep a dedicated host
    // pipe alive and drain it; command output remains in the run-owned stdout/stderr.
    killer.stderr.resume();
    const closed = await new Promise<{ code: number | null; error?: Error }>((resolveClose) => {
      let settled = false;
      killer.once("error", (error) => {
        if (settled) return;
        settled = true;
        resolveClose({ code: null, error });
      });
      killer.once("close", (code) => {
        if (settled) return;
        settled = true;
        resolveClose({ code });
      });
    });
    if (!closed.error && closed.code === 0) return;

    // A root that exited between the native attempt and the CIM walk is
    // already successfully terminated. Otherwise fail closed with both
    // diagnostics rather than pretending the tree is gone.
    if (!isProcessRunning(rootProcessId)) return;
    const primaryReason = closed.error?.message ?? `退出码 ${closed.code ?? "unknown"}`;
    const nativeReason = nativeClosed.error?.message ?? `退出码 ${nativeClosed.code ?? "unknown"}`;
    throw new Error(`进程树终止器失败（taskkill ${nativeReason}；PowerShell ${primaryReason}）。`);
  }

  private async registerArtifacts(record: ExecutionRecord): Promise<void> {
    if (!this.artifactService) return;
    await Promise.all([
      this.artifactService.registerExistingFile({ sessionId: record.sessionId, runId: record.runId, kind: "terminal-output", absolutePath: record.stdoutPath }),
      this.artifactService.registerExistingFile({ sessionId: record.sessionId, runId: record.runId, kind: "terminal-output", absolutePath: record.stderrPath }),
    ]).catch(() => undefined);
  }
}

class OutputCapture {
  private readonly headParts: Buffer[] = [];
  private headBytes = 0;
  private small: Buffer | undefined = Buffer.alloc(0);
  private tail = Buffer.alloc(0);
  totalBytes = 0;

  constructor(private readonly limit: number) {}

  push(chunk: Buffer): void {
    const value = Buffer.from(chunk);
    this.totalBytes += value.length;
    if (this.headBytes < this.limit) {
      const portion = value.subarray(0, this.limit - this.headBytes);
      this.headParts.push(portion);
      this.headBytes += portion.length;
    }
    if (this.small) {
      const combined = Buffer.concat([this.small, value]);
      this.small = combined.length <= this.limit * 2 ? combined : undefined;
    }
    const tailCandidate = Buffer.concat([this.tail, value]);
    this.tail = tailCandidate.subarray(Math.max(0, tailCandidate.length - this.limit));
  }

  preview(executionId: string, stream: "stdout" | "stderr"): TerminalOutputPreview {
    const truncated = this.totalBytes > this.limit * 2;
    const raw = this.small ?? Buffer.concat([
      Buffer.concat(this.headParts),
      Buffer.from(`\n… ${this.totalBytes - this.limit * 2} bytes omitted …\n`, "utf8"),
      this.tail,
    ]);
    return {
      preview: stripAnsi(raw.toString("utf8")),
      totalBytes: this.totalBytes,
      truncated,
      ref: `terminal-output://${executionId}/${stream}`,
    };
  }
}

async function resolveProjectWorkingDirectory(
  projectRoot: string,
  requestedCwd: string | undefined,
): Promise<
  | { ok: true; absolutePath: string; relativePath: string }
  | { ok: false; code: "CWD_NOT_FOUND" | "CWD_NOT_DIRECTORY" | "CWD_OUTSIDE_PROJECT"; message: string }
> {
  let root: string;
  let candidate: string;
  try {
    root = await realpath(projectRoot);
    candidate = await realpath(resolve(root, requestedCwd?.trim() || "."));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, code: "CWD_NOT_FOUND", message: "请求的项目工作目录不存在。" };
    }
    return { ok: false, code: "CWD_NOT_FOUND", message: `请求的项目工作目录不可用：${errorMessage(error)}` };
  }
  if (!inside(root, candidate)) {
    return { ok: false, code: "CWD_OUTSIDE_PROJECT", message: "终端 cwd 必须位于当前显式项目内。" };
  }
  if (!(await stat(candidate)).isDirectory()) {
    return { ok: false, code: "CWD_NOT_DIRECTORY", message: "请求的终端 cwd 不是目录。" };
  }
  const relativePath = relative(root, candidate).split(sep).join("/") || ".";
  return { ok: true, absolutePath: candidate, relativePath };
}

async function resolveUnscopedWorkingDirectory(
  requestedCwd: string | undefined,
): Promise<
  | { ok: true; absolutePath: string; relativePath: string }
  | { ok: false; code: "CWD_NOT_FOUND" | "CWD_NOT_DIRECTORY"; message: string }
> {
  const candidate = requestedCwd?.trim() || process.cwd();
  try {
    const absolutePath = await realpath(candidate);
    if (!(await stat(absolutePath)).isDirectory()) {
      return { ok: false, code: "CWD_NOT_DIRECTORY", message: "请求的终端 cwd 不是目录。" };
    }
    return { ok: true, absolutePath, relativePath: absolutePath };
  } catch (error) {
    return {
      ok: false,
      code: "CWD_NOT_FOUND",
      message: `请求的终端工作目录不可用：${errorMessage(error)}`,
    };
  }
}

function inside(root: string, candidate: string): boolean {
  const normalizedRoot = normalizePath(root);
  const normalizedCandidate = normalizePath(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${sep}`);
}

function normalizePath(value: string): string {
  const normalized = resolve(value).replace(/[\\/]+$/u, "");
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function powerShellScript(command: string, statusPath: string, processIdentityPath: string): string {
  const markerPath = powerShellLiteral(statusPath);
  const identityPath = powerShellLiteral(processIdentityPath);
  return [
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "$OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "$ErrorActionPreference = 'Stop'",
    "$identityExecutable = [Environment]::ProcessPath",
    "if ([string]::IsNullOrWhiteSpace($identityExecutable)) { $identityExecutable = $PSHOME + '\\pwsh.exe' }",
    "$identity = @{ executable = [string]$identityExecutable; edition = [string]$PSVersionTable.PSEdition; major = [int]$PSVersionTable.PSVersion.Major }",
    `[System.IO.File]::WriteAllText('${identityPath}', ($identity | ConvertTo-Json -Compress), [System.Text.UTF8Encoding]::new($false))`,
    "try {",
    "  & {",
    command,
    "  }",
    "  if ($null -ne $LASTEXITCODE) { exit [int]$LASTEXITCODE }",
    "  exit 0",
    "} catch [System.Management.Automation.CommandNotFoundException] {",
    `  [System.IO.File]::WriteAllText('${markerPath}', 'command-not-found')`,
    "  [Console]::Error.WriteLine($_.Exception.Message)",
    "  exit 127",
    "} catch {",
    "  [Console]::Error.WriteLine($_.Exception.Message)",
    "  exit 1",
    "}",
  ].join("\n");
}

function interactiveIdentityPrelude(): string {
  return [
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "$identityPath = [Environment]::GetEnvironmentVariable('VINIPER_PROCESS_IDENTITY_PATH')",
    `$identity = [ordered]@{ executable = (Get-Process -Id $PID).Path; edition = $PSEdition; major = $PSVersionTable.PSVersion.Major }`,
    "$identity | ConvertTo-Json -Compress | Set-Content -LiteralPath $identityPath -Encoding utf8NoBOM",
  ].join("\n") + "\n";
}

function safeProcessEnvironment(): NodeJS.ProcessEnv {
  const allowed = new Set([
    "ALLUSERSPROFILE",
    "APPDATA",
    "COMSPEC",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "NUMBER_OF_PROCESSORS",
    "OS",
    "PATH",
    "PATHEXT",
    "PROCESSOR_ARCHITECTURE",
    "PROCESSOR_IDENTIFIER",
    "PROCESSOR_LEVEL",
    "PROCESSOR_REVISION",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMW6432",
    "PSMODULEPATH",
    "PUBLIC",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "USERDOMAIN",
    "USERNAME",
    "USERPROFILE",
    "WINDIR",
  ]);
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && allowed.has(name.toLocaleUpperCase("en-US"))) environment[name] = value;
  }
  return environment;
}

function isProcessRunning(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function resultFromRecord(
  request: TerminalProcessRequest,
  cwd: string,
  startedAt: number,
  record: ExecutionRecord,
  stdout: OutputCapture,
  stderr: OutputCapture,
  exitCode: number | null,
): TerminalRunResult {
  return {
    ok: record.status === "completed",
    executionId: request.executionId,
    status: record.status === "running" ? "failed" : record.status,
    purpose: request.input.purpose,
    cwd,
    timeoutMs: request.input.timeoutMs,
    exitCode: record.status === "timed-out" || record.status === "cancelled" ? null : exitCode,
    durationMs: Math.max(0, Date.now() - startedAt),
    stdout: stdout.preview(request.executionId, "stdout"),
    stderr: stderr.preview(request.executionId, "stderr"),
    ...(record.processIdentity ? { processIdentity: { ...record.processIdentity } } : {}),
  };
}

function failure(
  request: TerminalProcessRequest,
  cwd: string,
  startedAt: number,
  code: TerminalDiagnosticCode,
  message: string,
): TerminalRunResult {
  return {
    ok: false,
    executionId: request.executionId,
    status: "failed",
    purpose: request.input.purpose,
    cwd,
    timeoutMs: request.input.timeoutMs,
    exitCode: null,
    durationMs: Math.max(0, Date.now() - startedAt),
    stdout: emptyPreview(request.executionId, "stdout"),
    stderr: emptyPreview(request.executionId, "stderr"),
    error: { code, message },
  };
}

function failureFromRecord(
  request: TerminalProcessRequest,
  cwd: string,
  startedAt: number,
  record: ExecutionRecord,
  stdout: OutputCapture,
  stderr: OutputCapture,
  code: TerminalDiagnosticCode,
  message: string,
): TerminalRunResult {
  return {
    ...resultFromRecord(request, cwd, startedAt, record, stdout, stderr, null),
    ok: false,
    status: "failed",
    error: { code, message },
  };
}

function emptyPreview(executionId: string, stream: "stdout" | "stderr"): TerminalOutputPreview {
  return { preview: "", totalBytes: 0, truncated: false, ref: `terminal-output://${executionId}/${stream}` };
}

function outputFailure(
  input: TerminalOutputInput,
  code: "OUTPUT_NOT_OWNED" | "OUTPUT_NOT_FOUND" | "OUTPUT_RANGE_INVALID",
  message: string,
  status: TerminalOutputResult["status"] = "failed",
): TerminalOutputResult {
  return {
    ok: false,
    executionId: input.executionId,
    stream: input.stream,
    status,
    offset: input.offset ?? 0,
    bytes: 0,
    totalBytes: 0,
    text: "",
    nextOffset: null,
    truncated: false,
    complete: status !== "running",
    error: { code, message },
  };
}

function waitForClose(child: ChildProcessWithoutNullStreams): Promise<ProcessCloseResult> {
  return new Promise((resolveClose) => {
    let settled = false;
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      resolveClose({ code: null, error });
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      resolveClose({ code });
    });
  });
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function readProcessIdentity(path: string): Promise<PowerShellProcessIdentity | undefined> {
  const text = await readOptionalText(path);
  if (!text) return undefined;
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    const edition = value.edition === "Core" || value.edition === "Desktop" ? value.edition : "unknown";
    const major = Number.isFinite(Number(value.major)) ? Math.max(0, Math.trunc(Number(value.major))) : 0;
    const executable = typeof value.executable === "string" ? value.executable : "";
    if (!executable || !major) return undefined;
    return { executable, edition, major };
  } catch {
    return undefined;
  }
}

export function resolvePowerShell7Path(): string {
  const userProfile = process.env.USERPROFILE ?? "";
  const candidates = [
    process.env.VINIPER_PWSH_PATH,
    userProfile ? join(userProfile, "AppData", "Local", "Microsoft", "WindowsApps", "pwsh.exe") : undefined,
    process.env.ProgramW6432 ? join(process.env.ProgramW6432, "PowerShell", "7", "pwsh.exe") : undefined,
    process.env.ProgramFiles ? join(process.env.ProgramFiles, "PowerShell", "7", "pwsh.exe") : undefined,
    "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
  ].filter((value): value is string => Boolean(value));
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0] ?? "pwsh.exe";
}

function defaultPowerShellPath(): string {
  return resolvePowerShell7Path();
}

function powerShellLiteral(value: string): string {
  return value.replace(/'/gu, "''");
}

function stripAnsi(value: string): string {
  return value.replace(/[\u001B\u009B](?:\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/gu, "");
}

function assertInternalId(value: string, label: string): void {
  if (!/^[A-Za-z0-9._-]+$/u.test(value)) throw new Error(`${label} 不是受管内部标识。`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
