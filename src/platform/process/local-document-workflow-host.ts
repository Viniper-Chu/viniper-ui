import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { terminatePosixProcessGroup } from "./process-shell";
import type { DocumentWorkflowHost } from "../../features/files/document-workflow-tools";

/** Reuse installed document workflows; structured input never enters a shell. */
export class LocalDocumentWorkflowHost implements DocumentWorkflowHost {
  constructor(private readonly scripts: { handout?: string; pdf?: string },
    private readonly python = process.env.VINIPER_HARNESS_PYTHON ?? "python3") {}

  available(operation: "handout" | "pdf"): boolean { return Boolean(this.scripts[operation]); }

  execute(operation: "handout" | "pdf", input: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, any>> {
    const script = this.scripts[operation];
    if (!script) return Promise.reject(new Error("本机没有配置该文档工具。"));
    return new Promise((resolve, reject) => {
      const child = spawn(this.python, ["-I", "-B", script, "request"], {
        detached: true, stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      });
      let stdout = "", stderr = "", stopped = "";
      const stop = (reason: string) => {
        if (stopped) return;
        stopped = reason;
        if (child.pid) void terminatePosixProcessGroup(child.pid).catch(() => child.kill("SIGKILL"));
      };
      const abort = () => stop("文档操作已取消。");
      const timer = setTimeout(() => stop("文档工具超过 60 秒，请缩小单次讲义或查看编译诊断。"), 60_000);
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        if (stdout.length > 4 * 1024 * 1024) stop("文档回执过大，请按页读取。");
      });
      child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-8000); });
      child.once("error", error => { cleanup(); reject(error); });
      child.once("close", () => {
        cleanup();
        if (stopped) return reject(new Error(stopped));
        try { resolve(JSON.parse(stdout)); }
        catch { reject(new Error(stderr.trim() || "本机文档工具没有返回有效回执。")); }
      });
      signal.addEventListener("abort", abort, { once: true });
      child.stdin.on("error", () => {});
      if (signal.aborted) abort();
      else child.stdin.end(JSON.stringify(input));
    });
  }
}

export function discoverDocumentWorkflowHost(): LocalDocumentWorkflowHost | undefined {
  if (process.platform === "win32") return undefined;
  const profile = process.env.VINIPER_LOCAL_AGENT_PROFILE ?? join(homedir(), "本地模型", "开发维护", "server-profile.json");
  const root = dirname(profile), scripts: { handout?: string; pdf?: string } = {};
  const handout = process.env.VINIPER_MATH_HANDOUT_HELPER ?? join(root, "scripts", "math_handout.py");
  const pdf = process.env.VINIPER_PDF_INSPECT_HELPER ?? join(root, "scripts", "pdf_local_inspect.py");
  if (existsSync(pdf)) scripts.pdf = pdf;
  if (existsSync(handout) && scripts.pdf && existsSync(join(dirname(handout), "..", "skills", "local-latex-compile", "scripts", "compile.py"))) scripts.handout = handout;
  return scripts.handout || scripts.pdf ? new LocalDocumentWorkflowHost(scripts) : undefined;
}
