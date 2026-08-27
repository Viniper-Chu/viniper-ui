import { spawn, ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ExtensionProcessHost, ExtensionProcessInvocation, ExtensionProcessResult } from "../../core/ports";
import { resolvePowerShell7Path } from "./windows-process-host";

export type ManagedPluginInvocationInput = ExtensionProcessInvocation;
export type ManagedPluginInvocationResult = ExtensionProcessResult;

export interface ManagedPluginProcessHostOptions {
  dataRoot: string;
  timeoutMs?: number;
}

/**
 * The process is a fault boundary, not an OS sandbox. It receives one JSONL
 * request, returns one JSONL response, gets an independent data directory,
 * and receives only the small host environment needed to start Node.
 */
export class ManagedPluginProcessHost implements ExtensionProcessHost {
  private readonly children = new Set<ChildProcess>();

  constructor(private readonly options: ManagedPluginProcessHostOptions) {}

  async invoke(input: ManagedPluginInvocationInput): Promise<ManagedPluginInvocationResult> {
    const entry = input.entryOverride ?? (input.version.entry ? join(input.version.packagePath, input.version.entry) : undefined);
    if (!entry) return { ok: false, error: "EXTENSION_ENTRY_MISSING" };
    const independentDataRoot = join(this.options.dataRoot, "extensions", "data", input.extensionId, input.version.version);
    await mkdir(independentDataRoot, { recursive: true });
    const timeoutMs = this.options.timeoutMs ?? 10_000;
    return new Promise((resolve) => {
      const powershellScript = entry.toLowerCase().endsWith(".ps1");
      const executable = powershellScript ? resolvePowerShell7Path() : process.execPath;
      const args = powershellScript
        ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", entry]
        : [entry];
      const child = spawn(executable, args, {
        cwd: independentDataRoot,
        env: minimalEnvironment(),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      this.children.add(child);
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timer: NodeJS.Timeout | undefined;

      const finish = (result: ManagedPluginInvocationResult): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this.children.delete(child);
        resolve(result);
      };

      const abort = (): void => {
        child.kill();
        finish({ ok: false, error: "EXTENSION_EXECUTION_CANCELLED" });
      };
      if (input.signal) {
        if (input.signal.aborted) {
          abort();
          return;
        }
        input.signal.addEventListener("abort", abort, { once: true });
      }
      timer = setTimeout(() => {
        child.kill();
        finish({ ok: false, error: "EXTENSION_EXECUTION_TIMEOUT" });
      }, timeoutMs);
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
        if (stdout.length > 128 * 1024) {
          child.kill();
          finish({ ok: false, error: "EXTENSION_OUTPUT_LIMIT" });
        }
      });
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
        if (stderr.length > 16 * 1024) stderr = stderr.slice(-16 * 1024);
      });
      child.once("error", (error) => finish({ ok: false, error: `EXTENSION_PROCESS_ERROR:${error.message}` }));
      child.once("close", (code) => {
        if (settled) return;
        if (code !== 0) {
          finish({ ok: false, error: `EXTENSION_PROCESS_EXIT:${code ?? "unknown"}${stderr ? `:${stderr.trim()}` : ""}` });
          return;
        }
        try {
          const line = stdout.trim().split(/\r?\n/u).filter(Boolean).at(-1);
          if (!line) throw new Error("empty response");
          finish({ ok: true, value: JSON.parse(line) as unknown });
        } catch (error) {
          finish({ ok: false, error: `EXTENSION_RESPONSE_INVALID:${error instanceof Error ? error.message : String(error)}` });
        }
      });
      child.stdin?.end(`${JSON.stringify(input.payload)}\n`);
    });
  }

  async dispose(): Promise<void> {
    for (const child of this.children) child.kill();
    this.children.clear();
  }
}

function minimalEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "ComSpec"];
  return Object.fromEntries(allowed
    .filter((key) => typeof process.env[key] === "string")
    .map((key) => [key, process.env[key]!])) as NodeJS.ProcessEnv;
}
