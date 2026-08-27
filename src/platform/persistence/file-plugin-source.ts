import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PluginManifestV1, PluginRecord } from "../../core/extension-contracts";
import { PluginSource } from "../../core/ports";

export class FilePluginSource implements PluginSource {
  constructor(private readonly roots: Array<{ path: string; builtIn: boolean }>) {}

  async discover(): Promise<PluginRecord[]> {
    const records: PluginRecord[] = [];
    for (const root of this.roots) {
      const entries = await readdir(root.path, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const path = join(root.path, entry.name, "plugin.json");
        try {
          const value = JSON.parse(await readFile(path, "utf8")) as unknown;
          const manifest = validateManifest(value);
          records.push({
            ...manifest,
            classification: root.builtIn ? "built-in" : "external-declarative",
            executable: root.builtIn,
          });
        } catch (error) {
          records.push({
            id: entry.name,
            name: entry.name,
            version: "unknown",
            classification: "invalid",
            capabilities: [],
            skills: [],
            tools: [],
            providers: [],
            executable: false,
            error: error instanceof Error ? error.message : "清单无效。",
          });
        }
      }
    }
    return records;
  }
}

function validateManifest(value: unknown): PluginManifestV1 {
  if (!value || typeof value !== "object") throw new Error("plugin.json 必须是对象。 ");
  const record = value as Record<string, unknown>;
  if (record.manifestVersion !== 1) throw new Error("只支持 plugin manifest v1。");
  for (const key of ["id", "name", "version"] as const) {
    if (typeof record[key] !== "string" || !record[key]) throw new Error(`缺少 ${key}。`);
  }
  for (const key of ["capabilities", "skills", "tools", "providers"] as const) {
    if (!Array.isArray(record[key]) || !(record[key] as unknown[]).every((item) => typeof item === "string")) {
      throw new Error(`${key} 必须是字符串数组。`);
    }
  }
  return record as unknown as PluginManifestV1;
}
