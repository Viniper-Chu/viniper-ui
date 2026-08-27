import { PluginRecord } from "../../core/extension-contracts";
import { PluginSource } from "../../core/ports";
import { ToolExecutor, ToolRegistry } from "../tools/tool-registry";

export type BuiltInPluginTools = Record<string, () => ToolExecutor[]>;

export class PluginCatalog {
  private records: PluginRecord[] = [];

  constructor(
    private readonly source: PluginSource,
    private readonly toolRegistry: ToolRegistry,
    private readonly builtInTools: BuiltInPluginTools,
  ) {}

  async initialize(): Promise<void> {
    this.records = await this.source.discover();
    for (const record of this.records) {
      if (record.classification !== "built-in") continue;
      const createTools = this.builtInTools[record.id];
      if (!createTools) continue;
      for (const tool of createTools()) {
        if (!record.tools.includes(tool.name)) {
          throw new Error(`内置插件 '${record.id}' 未声明工具 '${tool.name}'。`);
        }
        if (!this.toolRegistry.has(tool.name)) this.toolRegistry.register(tool);
      }
    }
  }

  list(): PluginRecord[] {
    return this.records.map((record) => ({
      ...record,
      capabilities: [...record.capabilities],
      skills: [...record.skills],
      tools: [...record.tools],
      providers: [...record.providers],
    }));
  }
}
