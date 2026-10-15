import { execFile } from "node:child_process";
import { join } from "node:path";
import { StructuredFileHost } from "../../features/files/structured-file-tools";

/** The platform owns Python and stdin; feature tools never start a shell. */
export class LocalFileHelperHost implements StructuredFileHost {
  constructor(private readonly helpersRoot: string,
    private readonly python = process.env.VINIPER_HARNESS_PYTHON ?? (process.platform === "win32" ? "python" : "python3")) {}

  execute(operation: string, input: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    return new Promise((done, reject) => {
      const child = execFile(this.python, ["-I", "-B", join(this.helpersRoot, "dispatch.py")], {
        encoding: "utf8", signal, timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      }, (error, stdout, stderr) => {
        try {
          if (stdout.trim()) done(JSON.parse(stdout));
          else reject(new Error(stderr.trim() || error?.message || "本机文件工具没有返回结果。"));
        } catch (parseError) { reject(parseError); }
      });
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(JSON.stringify({ ...input, operation }));
    });
  }
}
