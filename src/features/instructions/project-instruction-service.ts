import { ProjectInstructionSnapshot } from "../../core/instruction-contracts";
import { ProjectInstructionSource } from "../../core/ports";

export const PROJECT_INSTRUCTION_MAX_BYTES = 128 * 1024;

export interface ProjectInstructionLoader {
  loadForRun(workingDirectory: string): Promise<ProjectInstructionSnapshot>;
}

export class ProjectInstructionService implements ProjectInstructionLoader {
  constructor(
    private readonly source: ProjectInstructionSource,
    private readonly now: () => number = Date.now,
  ) {}

  async loadForRun(workingDirectory: string): Promise<ProjectInstructionSnapshot> {
    let read;
    try {
      read = await this.source.readCanonical(workingDirectory);
    } catch (error) {
      const message = `AGENTS.md 读取失败：${error instanceof Error ? error.message : String(error)}`;
      return {
        status: {
          status: "error",
          canonicalPath: "AGENTS.md",
          revision: "error",
          bytes: 0,
          message,
          loadedAt: this.now(),
        },
      };
    }

    if (read.text === undefined) {
      return {
        status: {
          status: "missing",
          canonicalPath: read.canonicalPath,
          revision: "missing",
          bytes: 0,
          message: "AGENTS.md 未设置。",
          loadedAt: this.now(),
        },
      };
    }

    const bytes = read.bytes ?? Buffer.byteLength(read.text, "utf8");
    if (bytes > PROJECT_INSTRUCTION_MAX_BYTES) {
      return {
        status: {
          status: "error",
          canonicalPath: read.canonicalPath,
          revision: `oversize:${bytes}`,
          bytes,
          message: `AGENTS.md 超过 128 KiB 上限；未向 Provider 发送残缺内容。`,
          loadedAt: this.now(),
        },
      };
    }

    return {
      status: {
        status: "loaded",
        canonicalPath: read.canonicalPath,
        revision: `${read.modifiedAt ?? 0}:${bytes}`,
        bytes,
        message: `已加载 AGENTS.md（${bytes} bytes）。`,
        loadedAt: this.now(),
      },
      text: read.text,
    };
  }
}
