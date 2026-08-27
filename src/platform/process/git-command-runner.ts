import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

export async function runGitCommand(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execute("git", args, { cwd, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
}
