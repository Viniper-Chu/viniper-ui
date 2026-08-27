import { createReadStream } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { LoadedSkill, SkillMetadata, SkillSourceKind } from "../../core/extension-contracts";
import { SkillSource } from "../../core/ports";

export class FileSkillSource implements SkillSource {
  private readonly paths = new Map<string, string>();

  constructor(private readonly roots: Array<{ path: string; source: SkillSourceKind }>) {}

  async listMetadata(): Promise<SkillMetadata[]> {
    this.paths.clear();
    const result: SkillMetadata[] = [];
    for (const root of this.roots) {
      const entries = await readdir(root.path, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillPath = join(root.path, entry.name, "SKILL.md");
        const header = await readSkillHeader(skillPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        if (!header?.name || !header.description) continue;
        const id = header.id || entry.name;
        this.paths.set(id, skillPath);
        result.push({ id, name: header.name, description: header.description, source: root.source, packagePath: skillPath });
      }
    }
    return result;
  }

  async load(id: string): Promise<LoadedSkill> {
    const path = this.paths.get(id);
    if (!path) throw new Error(`Skill '${id}' 不存在或尚未索引。`);
    const metadata = (await this.listMetadata()).find((skill) => skill.id === id);
    if (!metadata) throw new Error(`Skill '${id}' 不存在或缺少元数据。`);
    return { ...metadata, body: await readFile(path, "utf8") };
  }
}

async function readSkillHeader(path: string): Promise<Record<string, string>> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const values: Record<string, string> = {};
  let inHeader = false;
  try {
    for await (const line of lines) {
      if (!inHeader) {
        if (line.trim() !== "---") break;
        inHeader = true;
        continue;
      }
      if (line.trim() === "---") break;
      const separator = line.indexOf(":");
      if (separator > 0) values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  return values;
}
