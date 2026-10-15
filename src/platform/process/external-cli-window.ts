import { spawn } from "node:child_process";

export interface ExternalCliWindowInput {
  executable: string;
  cliEntry: string;
  dataRoot: string;
  projectRoot: string;
}

export interface ExternalCliWindowResult {
  status: "opened" | "failed";
  message: string;
}

export function buildExternalCliCommand(input: ExternalCliWindowInput): string {
  return [
    "title Viniper CLI",
    "color 0B",
    'set "ELECTRON_RUN_AS_NODE=1"',
    `${quote(input.executable)} ${quote(input.cliEntry)} --data-root ${quote(input.dataRoot)} --project ${quote(input.projectRoot)}`,
  ].join(" & ");
}

/** Opens the real CLI in a standalone Windows console, never inside the Electron renderer. */
export function openExternalCliWindow(input: ExternalCliWindowInput): ExternalCliWindowResult {
  if (process.platform !== "win32") {
    return { status: "failed", message: "当前 Preview 的独立 CLI 窗口只在 Windows 实现；macOS 尚未验证。" };
  }
  try {
    const child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/k", buildExternalCliCommand(input)], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.unref();
    return { status: "opened", message: "Viniper CLI 已在独立命令行窗口打开。" };
  } catch (error) {
    return { status: "failed", message: `独立 CLI 未能启动：${error instanceof Error ? error.message : String(error)}` };
  }
}

function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
