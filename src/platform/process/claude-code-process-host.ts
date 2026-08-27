import { ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { ClaudeCodeCommandSpec, ClaudeCodeProbeResult } from "../../core/agent-engine-contracts";
import { ClaudeCodeProcessHost } from "../../features/providers/claude-code-provider";

interface Invocation {
  executable: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  transport?: ClaudeCodeCommandSpec["transport"];
}

export class NodeClaudeCodeProcessHost implements ClaudeCodeProcessHost {
  async *lines(invocation: Invocation, signal: AbortSignal): AsyncIterable<string> {
    const wslEnv = invocation.transport === "wsl-cli" && invocation.env
      ? mergeWslEnv(process.env.WSLENV, invocation.env)
      : undefined;
    const childEnvironment = {
      ...process.env,
      ...(invocation.env ?? {}),
      ...(wslEnv ? { WSLENV: wslEnv } : {}),
    };
    const child = spawn(invocation.executable, invocation.args, {
      cwd: invocation.cwd,
      env: childEnvironment,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let termination: Promise<void> | undefined;
    const abort = (): void => {
      termination ??= terminateOwnedProcessTree(child);
    };
    signal.addEventListener("abort", abort, { once: true });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-8_000); });
    if (!child.stdout) throw new Error("CLAUDE_CODE_STDOUT_UNAVAILABLE");
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    try {
      for await (const line of lines) yield line;
      const exitCode = await processExit(child);
      if (signal.aborted) {
        await termination;
        throw new Error("CLAUDE_CODE_CANCELLED: Claude Code 运行已取消。");
      }
      if (exitCode !== 0) throw new Error(`CLAUDE_CODE_EXIT_${exitCode}: ${cleanProcessMessage(stderr)}`);
    } finally {
      signal.removeEventListener("abort", abort);
      lines.close();
      if (child.exitCode === null) {
        termination ??= terminateOwnedProcessTree(child);
        await termination;
      }
    }
  }
}

/**
 * Keeps the host's WSLENV entries byte-for-byte and appends only names that
 * are actually present in this invocation. Values (including secrets) never
 * enter WSLENV.
 */
export function mergeWslEnv(existing: string | undefined, injected: Record<string, string>): string | undefined {
  const entries = (existing ?? "").split(":").map((entry) => entry.trim()).filter(Boolean);
  const names = new Set(entries.map((entry) => entry.split("/", 1)[0].toUpperCase()));
  for (const key of Object.keys(injected)) {
    if (key.toUpperCase() === "WSLENV" || names.has(key.toUpperCase())) continue;
    entries.push(key);
    names.add(key.toUpperCase());
  }
  return entries.length ? entries.join(":") : undefined;
}

/**
 * Reads only non-secret Claude Code environment names from the selected WSL
 * runtime. Credential variables are deliberately absent from the script.
 */
export interface ClaudeCodeNonSecretSettings {
  baseUrl?: string;
  model?: string;
  defaultSonnetModel?: string;
  defaultOpusModel?: string;
  defaultHaikuModel?: string;
  smallFastModel?: string;
  subagentModel?: string;
}

export async function readClaudeCodeNonSecretSettings(
  command: ClaudeCodeCommandSpec,
): Promise<ClaudeCodeNonSecretSettings> {
  if (command.transport !== "wsl-cli") return {};
  const separator = command.prefixArgs.indexOf("--");
  const launcher = separator >= 0 ? command.prefixArgs.slice(0, separator) : command.prefixArgs;
  const script = [
    "printf 'ANTHROPIC_BASE_URL=%s\\n' \"$ANTHROPIC_BASE_URL\"",
    "printf 'ANTHROPIC_MODEL=%s\\n' \"$ANTHROPIC_MODEL\"",
    "printf 'ANTHROPIC_DEFAULT_SONNET_MODEL=%s\\n' \"$ANTHROPIC_DEFAULT_SONNET_MODEL\"",
    "printf 'ANTHROPIC_DEFAULT_OPUS_MODEL=%s\\n' \"$ANTHROPIC_DEFAULT_OPUS_MODEL\"",
    "printf 'ANTHROPIC_DEFAULT_HAIKU_MODEL=%s\\n' \"$ANTHROPIC_DEFAULT_HAIKU_MODEL\"",
    "printf 'ANTHROPIC_SMALL_FAST_MODEL=%s\\n' \"$ANTHROPIC_SMALL_FAST_MODEL\"",
    "printf 'CLAUDE_CODE_SUBAGENT_MODEL=%s\\n' \"$CLAUDE_CODE_SUBAGENT_MODEL\"",
  ].join("; ");
  const output = await readBoundedProcessOutput(command.executable, [...launcher, "--", "sh", "-lc", script]);
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/u)) {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1).trim().slice(0, 240);
    if (value) values.set(key, value);
  }
  const baseUrl = values.get("ANTHROPIC_BASE_URL");
  const model = values.get("ANTHROPIC_MODEL");
  const defaultSonnetModel = values.get("ANTHROPIC_DEFAULT_SONNET_MODEL");
  const defaultOpusModel = values.get("ANTHROPIC_DEFAULT_OPUS_MODEL");
  const defaultHaikuModel = values.get("ANTHROPIC_DEFAULT_HAIKU_MODEL");
  const smallFastModel = values.get("ANTHROPIC_SMALL_FAST_MODEL");
  const subagentModel = values.get("CLAUDE_CODE_SUBAGENT_MODEL");
  return {
    ...(baseUrl && /^https?:\/\//u.test(baseUrl) ? { baseUrl } : {}),
    ...(model ? { model } : {}),
    ...(defaultSonnetModel ? { defaultSonnetModel } : {}),
    ...(defaultOpusModel ? { defaultOpusModel } : {}),
    ...(defaultHaikuModel ? { defaultHaikuModel } : {}),
    ...(smallFastModel ? { smallFastModel } : {}),
    ...(subagentModel ? { subagentModel } : {}),
  };
}

function readBoundedProcessOutput(executable: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve(output);
    }, 3_000);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { output = `${output}${chunk}`.slice(0, 4_000); });
    child.once("error", () => { clearTimeout(timer); resolve(output); });
    child.once("close", () => { clearTimeout(timer); resolve(output); });
  });
}

export async function terminateOwnedProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.once("error", () => resolve());
      killer.once("close", () => resolve());
    });
    return;
  }
  try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
}

export async function probeClaudeCode(): Promise<ClaudeCodeProbeResult> {
  for (const candidate of commandCandidates()) {
    const version = await probeVersion(candidate);
    if (version) {
      return {
        available: true,
        transport: candidate.transport,
        version,
        message: `已探测 Claude Code ${version}。`,
        command: { ...candidate, version },
      };
    }
  }
  return {
    available: false,
    transport: "not-detected",
    message: "未探测到可执行的 Claude Code CLI；Viniper 会话仍可使用，Claude code 保持不可用。",
  };
}

function commandCandidates(): Array<Omit<ClaudeCodeCommandSpec, "version">> {
  const configured = process.env.VINIPER_CLAUDE_CODE_COMMAND?.trim();
  const candidates: Array<Omit<ClaudeCodeCommandSpec, "version">> = [];
  if (configured) candidates.push({ executable: configured, prefixArgs: [], transport: "native-cli", useSpawnCwd: true });
  candidates.push({ executable: "claude", prefixArgs: [], transport: "native-cli", useSpawnCwd: true });
  if (process.platform === "win32") {
    candidates.push({
      executable: "wsl.exe",
      prefixArgs: ["-d", "ViniperRuntime", "--", "/home/viniper/.local/bin/claude"],
      transport: "wsl-cli",
      useSpawnCwd: false,
    });
  }
  return candidates;
}

function probeVersion(candidate: Omit<ClaudeCodeCommandSpec, "version">): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(candidate.executable, [...candidate.prefixArgs, "--version"], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    const timer = setTimeout(() => { child.kill(); resolve(null); }, 5_000);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { output += chunk; });
    child.once("error", () => { clearTimeout(timer); resolve(null); });
    child.once("close", (code) => {
      clearTimeout(timer);
      const version = output.trim().split(/\r?\n/u)[0]?.slice(0, 120);
      resolve(code === 0 && version ? version : null);
    });
  });
}

function processExit(child: ChildProcess): Promise<number> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

function cleanProcessMessage(value: string): string {
  return value.replace(/[\r\n\t]+/gu, " ").trim().slice(0, 500) || "Claude Code CLI 未提供错误详情。";
}
