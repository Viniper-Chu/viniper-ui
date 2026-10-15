import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { newId } from "../../core/ids";
import {
  ExtensionRecord,
  ExtensionSnapshot,
  ExtensionVersionState,
  LoadedSkill,
  McpConnectionState,
  PersistedExtensionMetadata,
  SkillMetadata,
  StagedExtensionPackage,
} from "../../core/extension-contracts";
import { ExtensionPersistence, ExtensionProcessHost, ExtensionProcessResult } from "../../core/ports";
import { ExtensionPackageManager, ExtensionStageInput } from "./extension-package-manager";
import { JsonSchema } from "../../core/provider-contracts";
import { ToolExecutionContext, ToolExecutor, ToolRegistry, ToolResult } from "../tools/tool-registry";
import { ToolRequest } from "../../core/contracts";
import { LoopbackMcpSnapshot, LoopbackMcpTool } from "./loopback-mcp-connector";

export interface ExtensionRunSnapshotEntry {
  id: string;
  version: string;
  trusted: boolean;
  enabled: boolean;
  tools: string[];
}

export type ExtensionRunSnapshot = Readonly<Record<string, ExtensionRunSnapshotEntry>>;

export type ExtensionExecutionResult =
  | { ok: true; value: unknown; executionCount: number }
  | { ok: false; error: string; executionCount: number };

export interface ExtensionManagerOptions {
  dataRoot: string;
  persistence: ExtensionPersistence;
  packages: ExtensionPackageManager;
  processHost: ExtensionProcessHost;
  mcpConnector?: (endpoint: string) => Promise<unknown>;
  /** Optional host-owned registry used to project connected MCP tools into a run. */
  toolRegistry?: ToolRegistry;
  now?: () => number;
}

/** Canonical CP5 lifecycle for installed extensions and explicit MCP links. */
export class ExtensionManager {
  private readonly records = new Map<string, ExtensionRecord>();
  private readonly staged = new Map<string, StagedExtensionPackage>();
  private readonly mcpConnections = new Map<string, McpConnectionState>();
  private readonly mcpTools = new Map<string, Map<string, ConnectedMcpTool>>();
  private readonly mcpSnapshots = new Map<string, LoopbackMcpSnapshot>();
  private readonly mcpOperations = new Map<string, Promise<unknown>>();
  private readonly executionCounts = new Map<string, number>();
  private enabledSkillsBySession: Record<string, string[]> = {};
  private initialized = false;

  constructor(private readonly options: ExtensionManagerOptions) {}

  async initialize(): Promise<void> {
    const saved = await this.options.persistence.loadExtensionMetadata();
    this.enabledSkillsBySession = structuredClone(saved.enabledSkillsBySession ?? {});
    this.records.clear();
    for (const record of saved.records ?? []) this.records.set(record.id, normalizeRecord(record));
    this.staged.clear();
    for (const packageItem of saved.staged ?? []) this.staged.set(packageItem.stagingId, structuredClone(packageItem));
    for (const id of this.mcpTools.keys()) this.unregisterMcpTools(id);
    this.mcpConnections.clear();
    for (const connection of saved.mcpConnections ?? []) this.mcpConnections.set(connection.id, { ...structuredClone(connection), connected: false });
    this.initialized = true;
  }

  snapshot(): ExtensionSnapshot {
    return {
      skills: [],
      plugins: [],
      unknownCodePolicy: "not-executed",
      records: [...this.records.values()].map((record) => structuredClone(record)),
      staged: [...this.staged.values()].map((item) => structuredClone(item)),
      mcpConnections: [...this.mcpConnections.values()].map((item) => structuredClone(item)),
    };
  }

  async stage(input: ExtensionStageInput): Promise<StagedExtensionPackage> {
    this.requireInitialized();
    const staged = await this.options.packages.stage(input);
    this.staged.set(staged.stagingId, structuredClone(staged));
    await this.persist();
    return structuredClone(staged);
  }

  async install(stagingId: string): Promise<ExtensionRecord> {
    this.requireInitialized();
    const staged = this.staged.get(stagingId);
    if (!staged) throw new Error("EXTENSION_STAGE_NOT_FOUND");
    if (this.records.has(staged.manifest.id)) throw new Error("EXTENSION_ALREADY_INSTALLED");
    const current = toVersionState(staged, this.now());
    const record: ExtensionRecord = {
      id: staged.manifest.id,
      name: staged.manifest.name,
      kind: staged.manifest.kind,
      source: staged.source,
      trust: "untrusted",
      status: "installed",
      enabled: false,
      executable: staged.manifest.kind === "executable-plugin",
      capabilities: [...staged.manifest.capabilities],
      current,
    };
    this.records.set(record.id, record);
    this.staged.delete(stagingId);
    await this.persist();
    return structuredClone(record);
  }

  async trust(id: string, version: string): Promise<boolean> {
    const record = this.requiredRecord(id);
    if (!record.current || record.current.version !== version) return false;
    record.trust = "trusted";
    record.failure = undefined;
    if (record.status === "failed") record.status = record.enabled ? "enabled" : "installed";
    await this.persist();
    return true;
  }

  async setEnabled(id: string, enabled: boolean): Promise<boolean> {
    const record = this.requiredRecord(id);
    if (enabled && record.trust !== "trusted") return false;
    record.enabled = enabled;
    record.status = enabled ? "enabled" : "disabled";
    await this.persist();
    return true;
  }

  beginRunSnapshot(): ExtensionRunSnapshot {
    return Object.fromEntries([...this.records.values()]
      .filter((record) => record.current)
      .map((record) => [record.id, {
        id: record.id,
        version: record.current!.version,
        trusted: record.trust === "trusted",
        enabled: record.enabled,
        tools: [...record.current!.tools],
      }]));
  }

  /** Project trusted executable-plugin manifest tools into the shared registry. */
  syncToolRegistry(registry: ToolRegistry): void {
    for (const record of this.records.values()) {
      if (!record.current || record.kind !== "executable-plugin" || record.trust !== "trusted" || !record.enabled) continue;
      for (const toolName of record.current.tools) {
        if (registry.has(toolName)) continue;
        registry.registerManaged(new ManagedExtensionTool(this, record.id, record.name, toolName), record.id);
      }
    }
  }

  /**
   * Returns only the currently trusted and enabled managed Skills.  The
   * SkillCatalog consumes this projection; extension records remain the
   * lifecycle source of truth and are never duplicated into another store.
   */
  listSkillMetadata(): SkillMetadata[] {
    return [...this.records.values()]
      .filter((record) => record.kind === "skill"
        && record.trust === "trusted"
        && record.enabled
        && Boolean(record.current))
      .map((record) => ({
        id: record.id,
        name: record.name,
        description: `受管 Skill · ${record.name} · v${record.current!.version}`,
        source: "external-declarative" as const,
        packagePath: join(record.current!.packagePath, "SKILL.md"),
      }))
      .sort((left, right) => left.id.localeCompare(right.id, "en"));
  }

  async loadSkill(id: string): Promise<LoadedSkill> {
    const metadata = this.listSkillMetadata().find((skill) => skill.id === id);
    if (!metadata) throw new Error("SKILL_NOT_TRUSTED_OR_ENABLED");
    return { ...metadata, body: await readFile(metadata.packagePath, "utf8") };
  }

  async execute(
    id: string,
    payload: unknown,
    runSnapshot?: ExtensionRunSnapshot,
    options?: { entryOverride?: string; signal?: AbortSignal },
  ): Promise<ExtensionExecutionResult> {
    const record = this.records.get(id);
    const count = this.executionCounts.get(id) ?? 0;
    if (!record) return { ok: false, error: "EXTENSION_UNKNOWN", executionCount: count };
    const frozen = runSnapshot?.[id];
    const version = frozen ? findVersion(record, frozen.version) : record.current;
    if (!version || record.kind !== "executable-plugin" || !(frozen ? frozen.trusted && frozen.enabled : record.trust === "trusted" && record.enabled)) {
      return { ok: false, error: "EXTENSION_NOT_TRUSTED_OR_ENABLED", executionCount: count };
    }
    let result: ExtensionProcessResult;
    try {
      result = await this.options.processHost.invoke({
        extensionId: id,
        version,
        payload,
        ...(options?.entryOverride ? { entryOverride: options.entryOverride } : {}),
        ...(options?.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      record.status = "failed";
      record.failure = error instanceof Error ? error.message : String(error);
      await this.persist();
      return { ok: false, error: record.failure, executionCount: count };
    }
    if (!result.ok) {
      record.status = "failed";
      record.failure = result.error;
      await this.persist();
      return { ok: false, error: result.error, executionCount: count };
    }
    const nextCount = count + 1;
    this.executionCounts.set(id, nextCount);
    return { ok: true, value: result.value, executionCount: nextCount };
  }

  async executeTool(
    id: string,
    toolName: string,
    payload: unknown,
    runSnapshot?: ExtensionRunSnapshot,
    options?: { entryOverride?: string; signal?: AbortSignal },
  ): Promise<ExtensionExecutionResult> {
    const record = this.records.get(id);
    const frozenTools = runSnapshot?.[id]?.tools;
    const declaredTools = frozenTools ?? record?.current?.tools;
    if (!record || !declaredTools?.includes(toolName)) {
      return { ok: false, error: "EXTENSION_TOOL_NOT_DECLARED", executionCount: this.executionCounts.get(id) ?? 0 };
    }
    return this.execute(id, { toolName, payload }, runSnapshot, options);
  }

  async requestUpdate(id: string, stagingId: string): Promise<boolean> {
    const record = this.requiredRecord(id);
    const staged = this.staged.get(stagingId);
    if (!staged || staged.manifest.id !== id) return false;
    record.pendingUpdate = {
      stagingId,
      version: staged.manifest.version,
      capabilities: [...staged.manifest.capabilities],
    };
    await this.persist();
    return true;
  }

  async confirmUpdate(id: string): Promise<boolean> {
    const record = this.requiredRecord(id);
    const pending = record.pendingUpdate;
    const staged = pending ? this.staged.get(pending.stagingId) : undefined;
    if (!pending || !staged || !record.current) return false;
    record.previous = record.current;
    record.current = toVersionState(staged, this.now());
    record.capabilities = [...staged.manifest.capabilities];
    record.source = staged.source;
    record.trust = "untrusted";
    record.enabled = false;
    record.status = "installed";
    record.pendingUpdate = undefined;
    record.failure = undefined;
    this.staged.delete(staged.stagingId);
    await this.persist();
    return true;
  }

  async requestRollback(id: string): Promise<boolean> {
    const record = this.requiredRecord(id);
    if (!record.previous) return false;
    record.pendingRollback = true;
    await this.persist();
    return true;
  }

  async confirmRollback(id: string): Promise<boolean> {
    const record = this.requiredRecord(id);
    if (!record.pendingRollback || !record.previous || !record.current) return false;
    const current = record.current;
    record.current = record.previous;
    record.previous = current;
    record.capabilities = [...record.current.capabilities];
    record.trust = "untrusted";
    record.enabled = false;
    record.status = "installed";
    record.pendingRollback = undefined;
    record.failure = undefined;
    await this.persist();
    return true;
  }

  async configureMcp(input: { id: string; endpoint: string }): Promise<McpConnectionState> {
    assertLoopbackEndpoint(input.endpoint);
    return this.queueMcpOperation(input.id, async () => {
      const existing = this.mcpConnections.get(input.id);
      if (existing?.configured && existing.endpoint === input.endpoint) return structuredClone(existing);
      this.unregisterMcpTools(input.id);
      const state: McpConnectionState = {
        id: input.id, endpoint: input.endpoint, configured: true, connected: false,
      };
      this.mcpConnections.set(input.id, state);
      await this.persist();
      return structuredClone(state);
    });
  }

  async connectMcp(id: string): Promise<unknown> {
    return this.queueMcpOperation(id, () => this.connectMcpNow(id));
  }

  private async connectMcpNow(id: string): Promise<unknown> {
    const state = this.mcpConnections.get(id);
    if (!state?.configured) throw new Error("MCP_NOT_CONFIGURED");
    if (!this.options.mcpConnector) throw new Error("MCP_CONNECTOR_UNAVAILABLE");
    const connected = this.mcpSnapshots.get(id);
    if (state.connected && connected) return connected;
    try {
      this.unregisterMcpTools(id);
      const result = await this.options.mcpConnector(state.endpoint) as LoopbackMcpSnapshot;
      this.registerMcpTools(id, result);
      this.mcpSnapshots.set(id, result);
      state.connected = true;
      state.lastError = undefined;
      await this.persist();
      return result;
    } catch (error) {
      this.unregisterMcpTools(id);
      state.connected = false;
      state.lastError = error instanceof Error ? error.message : String(error);
      await this.persist();
      throw error;
    }
  }

  async disconnectMcp(id: string): Promise<boolean> {
    return this.queueMcpOperation(id, async () => {
      const state = this.mcpConnections.get(id);
      if (!state) return false;
      this.unregisterMcpTools(id);
      state.connected = false;
      await this.persist();
      return true;
    });
  }

  async refreshMcp(id: string): Promise<unknown> {
    return this.queueMcpOperation(id, async () => {
      const state = this.mcpConnections.get(id);
      if (!state?.configured) throw new Error("MCP_NOT_CONFIGURED");
      this.unregisterMcpTools(id);
      state.connected = false;
      return this.connectMcpNow(id);
    });
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([...this.mcpOperations.values()]);
    for (const id of this.mcpTools.keys()) this.unregisterMcpTools(id);
    this.mcpSnapshots.clear();
    await this.options.processHost.dispose();
  }

  private queueMcpOperation<T>(id: string, operation: () => Promise<T>): Promise<T> {
    // Discovery crosses an async HTTP boundary. Serialize each connection's
    // configure/connect/refresh/disconnect so a later request cannot unregister
    // tools belonging to an earlier successful connection.
    const previous = this.mcpOperations.get(id) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    this.mcpOperations.set(id, result);
    void result.finally(() => {
      if (this.mcpOperations.get(id) === result) this.mcpOperations.delete(id);
    }).catch(() => undefined);
    return result;
  }

  private requiredRecord(id: string): ExtensionRecord {
    const record = this.records.get(id);
    if (!record) throw new Error("EXTENSION_NOT_FOUND");
    return record;
  }

  private requireInitialized(): void {
    if (!this.initialized) throw new Error("EXTENSION_MANAGER_NOT_INITIALIZED");
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private async persist(): Promise<void> {
    const current = await this.options.persistence.loadExtensionMetadata();
    const metadata: PersistedExtensionMetadata = {
      ...current,
      enabledSkillsBySession: current.enabledSkillsBySession ?? this.enabledSkillsBySession,
      records: [...this.records.values()].map((record) => structuredClone(record)),
      staged: [...this.staged.values()].map((item) => structuredClone(item)),
      mcpConnections: [...this.mcpConnections.values()].map((item) => structuredClone(item)),
    };
    await this.options.persistence.saveExtensionMetadata(metadata);
  }

  private registerMcpTools(connectionId: string, snapshot: LoopbackMcpSnapshot): void {
    const registry = this.options.toolRegistry;
    const tools = Array.isArray(snapshot?.tools) ? snapshot.tools : [];
    if (!registry || tools.length === 0) return;
    const bindings = new Map<string, ConnectedMcpTool>();
    for (const tool of tools) {
      const rawName = String(tool?.name || "").trim();
      if (!rawName) continue;
      const name = mcpToolName(connectionId, rawName);
      if (registry.has(name) || bindings.has(name)) throw new Error(`MCP_TOOL_NAME_COLLISION: ${name}`);
      bindings.set(name, new ConnectedMcpTool(name, rawName, tool, snapshot));
    }
    // Validate the entire discovered set before publishing any of it. A
    // duplicate later in tools/list must never leave an untracked partial set.
    const registered: ConnectedMcpTool[] = [];
    try {
      for (const tool of bindings.values()) { registry.register(tool); registered.push(tool); }
    } catch (error) {
      for (const tool of registered) if (registry.has(tool.name) && registry.get(tool.name) === tool) registry.unregister(tool.name);
      throw error;
    }
    this.mcpTools.set(connectionId, bindings);
  }

  private unregisterMcpTools(connectionId: string): void {
    const registry = this.options.toolRegistry;
    const bindings = this.mcpTools.get(connectionId);
    if (registry && bindings) {
      for (const [name, tool] of bindings) {
        if (registry.has(name) && registry.get(name) === tool) registry.unregister(name);
      }
    }
    this.mcpTools.delete(connectionId);
    this.mcpSnapshots.delete(connectionId);
  }
}

class ConnectedMcpTool implements ToolExecutor {
  readonly description: string;
  readonly readOnly = false;
  readonly authorizationScope = "computer" as const;
  readonly inputSchema: JsonSchema;

  constructor(
    readonly name: string,
    private readonly remoteName: string,
    private readonly tool: LoopbackMcpTool,
    private readonly connection: LoopbackMcpSnapshot,
  ) {
    this.description = String(tool.description || `调用 MCP 工具 ${remoteName}。`);
    this.inputSchema = (tool.inputSchema && typeof tool.inputSchema === "object"
      ? tool.inputSchema
      : { type: "object", additionalProperties: true }) as JsonSchema;
  }

  async execute(request: ToolRequest, _context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const value = await this.connection.callTool(this.remoteName, request.input ?? {});
      const isError = Boolean(value && typeof value === "object" && (value as { isError?: unknown }).isError === true);
      return {
        toolId: request.id,
        text: JSON.stringify(value),
        data: value,
        displayText: isError ? `MCP 工具 ${this.remoteName} 返回错误。` : `MCP 工具 ${this.remoteName} 已完成。`,
        isError,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { toolId: request.id, text: message, displayText: message, isError: true };
    }
  }
}

function mcpToolName(connectionId: string, remoteName: string): string {
  return `mcp.${connectionId}.${remoteName}`;
}

function toVersionState(staged: StagedExtensionPackage, installedAt: number): ExtensionVersionState {
  return {
    version: staged.manifest.version,
    source: staged.source,
    capabilities: [...staged.manifest.capabilities],
    tools: [...(staged.manifest.tools ?? [])],
    ...(staged.manifest.entry ? { entry: staged.manifest.entry } : {}),
    packagePath: staged.packagePath,
    installedAt,
  };
}

function findVersion(record: ExtensionRecord, version: string): ExtensionVersionState | undefined {
  if (record.current?.version === version) return record.current;
  if (record.previous?.version === version) return record.previous;
  return undefined;
}

function normalizeRecord(record: ExtensionRecord): ExtensionRecord {
  return {
    ...structuredClone(record),
    capabilities: [...record.capabilities],
    ...(record.current ? { current: { ...record.current, capabilities: [...record.current.capabilities], tools: [...record.current.tools] } } : {}),
    ...(record.previous ? { previous: { ...record.previous, capabilities: [...record.previous.capabilities], tools: [...record.previous.tools] } } : {}),
  };
}

function assertLoopbackEndpoint(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("MCP_ENDPOINT_INVALID");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase())) {
    throw new Error("OUTBOUND_NETWORK_BLOCKED");
  }
}

class ManagedExtensionTool implements ToolExecutor {
  readonly readOnly = false;
  readonly authorizationScope = "computer" as const;
  readonly inputSchema: JsonSchema = {
    type: "object",
    additionalProperties: true,
  };

  constructor(
    private readonly manager: ExtensionManager,
    private readonly extensionId: string,
    private readonly extensionName: string,
    readonly name: string,
  ) {}

  get description(): string {
    return `受管插件「${this.extensionName}」工具 ${this.name}；仅在当前版本已信任并启用时执行。`;
  }

  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    const result = await this.manager.executeTool(
      this.extensionId,
      this.name,
      request.input ?? {},
      context.extensionSnapshot,
      { signal: context.signal },
    );
    const text = result.ok
      ? formatExtensionValue(result.value)
      : `受管插件工具未执行：${result.error}`;
    return {
      toolId: request.id,
      text,
      displayText: text,
      ...(result.ok ? { data: result.value } : {}),
      isError: !result.ok,
    };
  }
}

function formatExtensionValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? "受管插件返回了空结果。" : serialized;
  } catch {
    return "受管插件返回了不可序列化结果。";
  }
}
