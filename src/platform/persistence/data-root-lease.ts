import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";

const LOCK_NAME = ".agent-harness-write-lock.json";

export interface DataRootLease {
  readonly dataRoot: string;
  readonly owner: string;
  release(): Promise<void>;
}

export class DataRootBusyError extends Error {
  constructor(readonly dataRoot: string, readonly activeOwner: string) {
    super(`数据目录正在由 ${activeOwner} 使用：${dataRoot}。为避免损坏 Preview 数据，本次启动已拒绝。`);
  }
}

export async function acquireDataRootLease(dataRoot: string, owner: string): Promise<DataRootLease> {
  const normalizedRoot = resolve(dataRoot);
  await mkdir(normalizedRoot, { recursive: true });
  const lockPath = join(normalizedRoot, LOCK_NAME);
  const record = { pid: process.pid, owner, startedAt: new Date().toISOString() };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(JSON.stringify(record, null, 2), "utf8");
      let released = false;
      return {
        dataRoot: normalizedRoot,
        owner,
        async release(): Promise<void> {
          if (released) return;
          released = true;
          await handle.close();
          await unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          });
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const active = await readLock(lockPath);
      if (active.pid && processIsAlive(active.pid)) {
        throw new DataRootBusyError(normalizedRoot, active.owner || `PID ${active.pid}`);
      }
      await unlink(lockPath).catch((unlinkError: NodeJS.ErrnoException) => {
        if (unlinkError.code !== "ENOENT") throw unlinkError;
      });
    }
  }
  throw new DataRootBusyError(normalizedRoot, "另一个本地进程");
}

async function readLock(lockPath: string): Promise<{ pid?: number; owner?: string }> {
  try {
    const value = JSON.parse(await readFile(lockPath, "utf8")) as Record<string, unknown>;
    return {
      pid: typeof value.pid === "number" ? value.pid : undefined,
      owner: typeof value.owner === "string" ? value.owner : undefined,
    };
  } catch {
    return {};
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
