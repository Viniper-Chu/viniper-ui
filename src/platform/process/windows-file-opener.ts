import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { FileOpener, FileOpenResult } from "../../features/files/contracts";

export class WindowsFileOpener implements FileOpener {
  async open(inputPath: string): Promise<FileOpenResult> {
    const candidate = inputPath.trim();
    if (!candidate || !isAbsolute(candidate)) {
      return failure(candidate, "PATH_INVALID", "file.open 需要一个绝对文件路径。");
    }
    const path = resolve(candidate);
    let metadata;
    try {
      metadata = await stat(path);
    } catch {
      return failure(path, "PATH_NOT_FOUND", "没有找到要打开的文件。");
    }
    if (!metadata.isFile()) return failure(path, "PATH_NOT_FILE", "file.open 只打开文件，不打开目录。");
    if (process.platform !== "win32") {
      return failure(path, "OPEN_FAILED", "当前 Preview 只在 Windows 真机实现了系统文件打开；macOS 尚未验证。");
    }
    try {
      const child = spawn("explorer.exe", [path], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      child.unref();
      return { ok: true, path };
    } catch (error) {
      return failure(path, "OPEN_FAILED", `系统默认应用未能启动：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function failure(path: string, code: NonNullable<FileOpenResult["error"]>["code"], message: string): FileOpenResult {
  return { ok: false, path, error: { code, message } };
}
