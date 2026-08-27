import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { ProjectInstructionReadResult } from "../../core/instruction-contracts";
import { ProjectInstructionSource } from "../../core/ports";

export class FileProjectInstructionSource implements ProjectInstructionSource {
  async readCanonical(workingDirectory: string): Promise<ProjectInstructionReadResult> {
    const canonicalPath = join(workingDirectory, "AGENTS.md");
    try {
      const content = await readFile(canonicalPath);
      const metadata = await stat(canonicalPath);
      return {
        canonicalPath,
        text: content.toString("utf8"),
        bytes: content.byteLength,
        modifiedAt: metadata.mtimeMs,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { canonicalPath };
      throw error;
    }
  }
}
