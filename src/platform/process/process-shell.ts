import { existsSync } from "node:fs";

/** Platform shell policy, shared by bounded commands and interactive pipes. */
export function nativeShellPath(): string {
  if (process.platform === "darwin") return "/bin/zsh";
  return existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh";
}

export function nativeShellArguments(command?: string): string[] {
  // Do not load user rc files: they may print, prompt, or alter an agent command.
  const clean = process.platform === "darwin" ? ["-f"] : [];
  return command === undefined ? [...clean, "-s"] : [...clean, "-c", command];
}

export async function terminatePosixProcessGroup(pid: number): Promise<void> {
  // Every owned shell is a session leader. Kill its group, including children
  // that still hold output pipes after the original shell has exited.
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}
