import net from "node:net";
import { resolve } from "node:path";
import { acquireDataRootLease, DataRootBusyError, DataRootLease } from "../persistence/data-root-lease";
import { AppSnapshot, AgentIntent, PermissionMode, RunSnapshot, SessionSnapshot } from "../../core/contracts";
import { ArtifactReadInput, ArtifactReadResult } from "../../core/artifact-contracts";
import { PermissionAccessSelection, ToolApprovalDecision } from "../../core/permission-contracts";
import { CoordinationEnvelopeType } from "../../core/coordination-contracts";
import { TerminalOutputInput, TerminalOutputResult } from "../../features/terminal/contracts";
import { ScheduleDraft } from "../../core/scheduler-contracts";
import { ProviderEnabledCapabilities } from "../../core/provider-contracts";
import { LocalModelRegistration } from "../../core/local-model-contracts";
import { CliApplicationPort, CliInjectableApplicationService } from "../cli/application-port";
import { SessionQuery, SessionQueryResult } from "../../core/session-query-contracts";
import { MemoryCreateInput } from "../../core/memory-contracts";
import { SmartRoutingStrategy } from "../../core/routing-contracts";
import { StagedExtensionPackage } from "../../core/extension-contracts";
import { ExtensionStageInput } from "../../features/extensions/extension-package-manager";
import { LspRequest, LspResult, LspSnapshot } from "../../core/lsp-contracts";
import { SubagentReceipt, SubagentRequest, SubagentSnapshot, WorkflowDefinition, WorkflowRunInput, WorkflowRunSnapshot, WorkflowSnapshot } from "../../core/workflow-contracts";
import { CompositionCenterSnapshot, CompositionPreset } from "../../core/composition-contracts";
import { AgentEngineId } from "../../core/agent-engine-contracts";
import {
  BoundedOutboundQueue,
  RUNTIME_PROTOCOL_CAPABILITIES,
  RUNTIME_PROTOCOL_VERSION,
  RuntimeOverloadedError,
  RuntimeProtocolCapability,
  negotiateRuntimeProtocol,
} from "./runtime-protocol";

const PIPE_PREFIX = "\\\\.\\pipe\\viniper-harness-";
const SOCKET_FILE = "runtime-owner.sock";

export interface RuntimeOwnerService extends CliInjectableApplicationService {
  snapshot(): AppSnapshot;
  subscribe(listener: (snapshot: AppSnapshot) => void): () => void;
  createProjectSession(path: string, engineId?: AgentEngineId): Promise<SessionSnapshot>;
  togglePinned(sessionId: string): Promise<boolean>;
  deleteSession(sessionId: string): Promise<boolean>;
  setModel(sessionId: string, model: string): Promise<boolean>;
  setSkillEnabled(sessionId: string, skillId: string, enabled: boolean): Promise<boolean>;
  saveProviderSecret(profileId: string, fieldId: string, value: string): Promise<unknown>;
  deleteProviderSecret(profileId: string, fieldId: string): Promise<unknown>;
  setProviderEndpoint(profileId: string, endpoint: string): Promise<boolean>;
  setProviderManualModel(profileId: string, model: string): Promise<boolean>;
  setCustomProviderOptions(input: { authMode: "bearer" | "x-api-key" | "api-key"; capabilities: Partial<ProviderEnabledCapabilities> }): Promise<boolean>;
  setProviderCapabilities(profileId: string, capabilities: Partial<ProviderEnabledCapabilities>): Promise<boolean>;
  testProviderConnection(profileId: string): Promise<unknown>;
  registerLocalModel(input: LocalModelRegistration): Promise<boolean>;
  confirmLocalModel(id: string, versionId: string): Promise<boolean>;
  requestLocalModelUpdate(id: string, versionId: string): Promise<boolean>;
  confirmLocalModelUpdate(id: string): Promise<boolean>;
  markRead(sessionId: string, envelopeId: string): Promise<boolean>;
  createSchedule(draft: ScheduleDraft): Promise<unknown>;
  setScheduleEnabled(id: string, enabled: boolean): Promise<boolean>;
  runScheduleNow(id: string): Promise<boolean>;
  deleteSchedule(id: string): Promise<boolean>;
  restoreSchedule(id: string): Promise<boolean>;
  markNotificationRead(id: string): Promise<boolean>;
  readArtifact(input: ArtifactReadInput): Promise<ArtifactReadResult>;
  resolveToolApproval(sessionId: string, runId: string, callId: string, decision: ToolApprovalDecision): Promise<boolean>;
  getLspSnapshot?(): LspSnapshot | Promise<LspSnapshot>;
  navigateLsp?(input: Omit<LspRequest, "projectRoot"> & { projectRoot?: string }): Promise<LspResult>;
  listWorkflows?(): WorkflowSnapshot | Promise<WorkflowSnapshot>;
  registerWorkflow?(definition: WorkflowDefinition): Promise<WorkflowDefinition>;
  runWorkflow?(input: WorkflowRunInput): Promise<WorkflowRunSnapshot>;
  cancelWorkflow?(id: string): Promise<boolean>;
  recoverWorkflow?(id: string, decision?: "reconfirm"): Promise<WorkflowRunSnapshot>;
  getSubagentSnapshot?(): SubagentSnapshot | Promise<SubagentSnapshot>;
  spawnSubagent?(input: SubagentRequest): Promise<SubagentReceipt>;
  cancelSubagent?(id: string): Promise<boolean>;
  getCompositionCenter?(): CompositionCenterSnapshot | Promise<CompositionCenterSnapshot>;
  setCompositionPreset?(preset: CompositionPreset): CompositionCenterSnapshot | Promise<CompositionCenterSnapshot>;
  selectCustomComposition?(name: string): CompositionCenterSnapshot | Promise<CompositionCenterSnapshot>;
  copyCompositionPreset?(source: CompositionPreset, name: string): Promise<CompositionCenterSnapshot>;
  setCompositionCapability?(name: string, id: string, enabled: boolean): Promise<CompositionCenterSnapshot>;
  reorderComposition?(name: string, order: string[]): Promise<CompositionCenterSnapshot>;
  restoreDefaultComposition?(): CompositionCenterSnapshot | Promise<CompositionCenterSnapshot>;
}

export interface RuntimeOwnerOptions {
  dataRoot: string;
  service: RuntimeOwnerService;
  ownerId: string;
  lease?: DataRootLease;
}

export interface RuntimeOwner {
  readonly endpoint: string;
  readonly ownerId: string;
  dispose(): Promise<void>;
}

export class RuntimeOwnerBusyError extends Error {
  constructor(message: string) {
    super(`RUNTIME_OWNER_BUSY: ${message}`);
    this.name = "RuntimeOwnerBusyError";
  }
}

export async function startRuntimeOwner(options: RuntimeOwnerOptions): Promise<RuntimeOwner> {
  let lease = options.lease;
  if (!lease) {
    try {
      lease = await acquireDataRootLease(options.dataRoot, options.ownerId);
    } catch (error) {
      if (error instanceof DataRootBusyError) throw new RuntimeOwnerBusyError(error.message);
      throw error;
    }
  }
  const endpoint = runtimeEndpoint(options.dataRoot);
  const sockets = new Set<net.Socket>();
  const subscribers = new Set<net.Socket>();
  const writers = new Map<net.Socket, SocketOutboundWriter>();
  let revision = Date.now();
  let disposed = false;
  let server: net.Server;
  const sendSnapshot = (socket: net.Socket): void => {
    if (socket.destroyed) return;
    writers.get(socket)?.send({ kind: "update", revision, snapshot: withRevision(options.service.snapshot(), revision) });
  };
  const broadcast = (): void => {
    if (disposed) return;
    revision += 1;
    for (const socket of subscribers) sendSnapshot(socket);
  };

  try {
    server = net.createServer((socket) => {
      sockets.add(socket);
      writers.set(socket, new SocketOutboundWriter(socket));
      let buffer = "";
      const connection = { negotiated: false };
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
          if (!line) continue;
          void handleMessage(line, socket, connection, () => {
            subscribers.add(socket);
            sendSnapshot(socket);
          });
        }
      });
      socket.on("close", () => {
        sockets.delete(socket);
        subscribers.delete(socket);
        writers.delete(socket);
      });
      socket.on("error", () => {
        sockets.delete(socket);
        subscribers.delete(socket);
        writers.delete(socket);
      });
    });
    await listen(server, endpoint);
  } catch (error) {
    await lease.release().catch(() => undefined);
    throw error;
  }

  const unsubscribe = options.service.subscribe(() => broadcast());
  // The subscribe callback is intentionally allowed to establish revision 1.
  return {
    endpoint,
    ownerId: options.ownerId,
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      await lease!.release();
    },
  };

  async function handleMessage(
    line: string,
    socket: net.Socket,
    connection: { negotiated: boolean },
    onSubscribe: () => void,
  ): Promise<void> {
    const send = (message: WireResponse): void => writers.get(socket)?.send(message);
    let message: WireRequest;
    try {
      message = JSON.parse(line) as WireRequest;
    } catch {
      send({ kind: "response", id: "invalid", ok: false, error: "INVALID_REQUEST" });
      return;
    }
    if (message.kind === "hello") {
      try {
        const negotiation = negotiateRuntimeProtocol({ protocolVersion: message.protocolVersion, capabilities: message.capabilities });
        connection.negotiated = true;
        send({ kind: "response", id: message.id, ok: true, revision, negotiation, snapshot: withRevision(options.service.snapshot(), revision) });
      } catch (error) {
        send({ kind: "response", id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (!connection.negotiated) {
      send({ kind: "response", id: message.id, ok: false, error: "RUNTIME_HANDSHAKE_REQUIRED" });
      return;
    }
    if (message.kind === "subscribe") {
      onSubscribe();
      send({ kind: "response", id: message.id, ok: true, revision, snapshot: withRevision(options.service.snapshot(), revision) });
      return;
    }
    if (message.kind !== "call" || !RPC_METHODS.has(message.method)) {
      send({ kind: "response", id: message.id, ok: false, error: "METHOD_NOT_ALLOWED" });
      return;
    }
    try {
      const method = options.service[message.method] as ((...args: unknown[]) => unknown) | undefined;
      if (typeof method !== "function") throw new Error(`应用服务未提供 ${message.method}。`);
      const rawResult = await method.apply(options.service, message.args);
      const snapshot = message.method === "snapshot" ? withRevision(options.service.snapshot(), revision) : undefined;
      const result = snapshot ?? rawResult;
      send({ kind: "response", id: message.id, ok: true, result, revision, ...(snapshot ? { snapshot } : {}) });
      if (message.method !== "snapshot") broadcast();
    } catch (error) {
      send({ kind: "response", id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

export async function createRuntimeClient(dataRoot: string): Promise<RuntimeApplicationClient> {
  const client = new RuntimeApplicationClient(runtimeEndpoint(dataRoot));
  try {
    await client.getSnapshot();
    return client;
  } catch (error) {
    await client.dispose();
    throw new Error(`RUNTIME_OWNER_UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export class RuntimeApplicationClient implements RuntimeOwnerService, CliApplicationPort {
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(error: unknown): void }>();
  private readonly listeners = new Set<(snapshot: AppSnapshot) => void>();
  private nextId = 1;
  private socket?: net.Socket;
  private connecting?: Promise<void>;
  private reconnectTimer?: NodeJS.Timeout;
  private disposed = false;
  private buffer = "";
  private snapshotValue!: AppSnapshot & { revision: number };

  constructor(private readonly endpoint: string) {}

  snapshot(): AppSnapshot { return clone(this.snapshotValue); }
  async getSnapshot(): Promise<AppSnapshot & { revision: number }> {
    const result = await this.call<AppSnapshot & { revision: number }>("snapshot");
    this.snapshotValue = clone(result) as AppSnapshot & { revision: number };
    return clone(this.snapshotValue);
  }
  subscribe(listener: (snapshot: AppSnapshot) => void): () => void {
    this.listeners.add(listener);
    if (this.snapshotValue) listener(this.snapshot());
    void this.ensureConnected()
      .then(() => this.sendRequest({ kind: "subscribe", id: this.id() }))
      .catch(() => this.scheduleReconnect());
    return () => this.listeners.delete(listener);
  }
  dispose(): Promise<void> {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const pending of this.pending.values()) pending.reject(new Error("Runtime client disposed"));
    this.pending.clear();
    this.socket?.destroy();
    this.socket = undefined;
    return Promise.resolve();
  }

  createSession(engineId?: AgentEngineId): Promise<unknown> { return this.call("createSession", engineId); }
  createProjectSession(path: string): Promise<SessionSnapshot> { return this.call("createProjectSession", path); }
  createCliProjectSession(path: string): Promise<SessionSnapshot> { return this.call("createCliProjectSession", path); }
  openProjectSession(path: string): Promise<SessionSnapshot> { return this.call("openProjectSession", path); }
  setActiveSession(sessionId: string): Promise<boolean> { return this.call("setActiveSession", sessionId); }
  renameSession(sessionId: string, title: string): Promise<boolean> { return this.call("renameSession", sessionId, title); }
  querySessions(query?: SessionQuery): Promise<SessionQueryResult> { return this.call("querySessions", query ?? {}); }
  setSmartRoutingEnabled(enabled: boolean): Promise<boolean> { return this.call("setSmartRoutingEnabled", enabled); }
  setSmartRoutingStrategy(strategy: SmartRoutingStrategy): Promise<boolean> { return this.call("setSmartRoutingStrategy", strategy); }
  createMemory(input: MemoryCreateInput): Promise<unknown> { return this.call("createMemory", input); }
  updateMemory(id: string, text: string): Promise<boolean> { return this.call("updateMemory", id, text); }
  setMemoryEnabled(id: string, enabled: boolean): Promise<boolean> { return this.call("setMemoryEnabled", id, enabled); }
  deleteMemory(id: string): Promise<boolean> { return this.call("deleteMemory", id); }
  buildProjectIndex(sessionId: string): Promise<unknown> { return this.call("buildProjectIndex", sessionId); }
  searchProjectIndex(sessionId: string, query: string): Promise<unknown> { return this.call("searchProjectIndex", sessionId, query); }
  setProjectIndexSemantic(enabled: boolean): Promise<unknown> { return this.call("setProjectIndexSemantic", enabled); }
  togglePinned(sessionId: string): Promise<boolean> { return this.call("togglePinned", sessionId); }
  deleteSession(sessionId: string): Promise<boolean> { return this.call("deleteSession", sessionId); }
  setModel(sessionId: string, model: string): Promise<boolean> { return this.call("setModel", sessionId, model); }
  setProviderModel(sessionId: string, providerId: string, model: string): Promise<boolean> { return this.call("setProviderModel", sessionId, providerId, model); }
  setPermissionMode(sessionId: string, mode: PermissionMode): Promise<boolean> { return this.call("setPermissionMode", sessionId, mode); }
  setPermissionAccess(sessionId: string, selection: PermissionAccessSelection): Promise<boolean> { return this.call("setPermissionAccess", sessionId, selection); }
  restoreProjectChange(sessionId: string, receiptId: string): Promise<unknown> { return this.call("restoreProjectChange", sessionId, receiptId); }
  readTerminalOutput(sessionId: string, input: TerminalOutputInput): Promise<TerminalOutputResult> { return this.call("readTerminalOutput", sessionId, input); }
  send(intent: AgentIntent): Promise<{ accepted: boolean; queued: boolean; reason?: string }> { return this.call("send", intent); }
  cancel(sessionId: string): Promise<boolean> { return this.call("cancel", sessionId); }
  listRuns(sessionId?: string): Promise<RunSnapshot[]> { return this.call("listRuns", sessionId); }
  cancelRun(runId: string): Promise<boolean> { return this.call("cancelRun", runId); }
  steer(runId: string, message: string): Promise<unknown> { return this.call("steer", runId, message); }
  inject(runId: string, context: Record<string, unknown>): Promise<unknown> { return this.call("inject", runId, context); }
  clearSteering(runId: string): Promise<unknown> { return this.call("clearSteering", runId); }
  listSteering(runId?: string): Promise<unknown[]> { return this.call("listSteering", runId); }
  selectRun(runId: string): Promise<boolean> { return this.call("selectRun", runId); }
  resolveToolApproval(sessionId: string, runId: string, callId: string, decision: ToolApprovalDecision): Promise<boolean> { return this.call("resolveToolApproval", sessionId, runId, callId, decision); }
  sendMessage(source: string, target: string, text: string): Promise<unknown> { return this.call("sendMessage", source, target, text); }
  delegateTask(source: string, target: string, text: string): Promise<unknown> { return this.call("delegateTask", source, target, text); }
  waitForMessage(sessionId: string, filter: { fromSessionId?: string; envelopeType?: CoordinationEnvelopeType; correlationId?: string; timeoutMs?: number }): Promise<unknown> { return this.call("waitForMessage", sessionId, filter); }
  cancelWait(sessionId: string, waitId?: string): Promise<boolean> { return this.call("cancelWait", sessionId, waitId); }
  markRead(sessionId: string, envelopeId: string): Promise<boolean> { return this.call("markRead", sessionId, envelopeId); }
  createSchedule(draft: ScheduleDraft): Promise<unknown> { return this.call("createSchedule", draft); }
  setScheduleEnabled(id: string, enabled: boolean): Promise<boolean> { return this.call("setScheduleEnabled", id, enabled); }
  runScheduleNow(id: string): Promise<boolean> { return this.call("runScheduleNow", id); }
  deleteSchedule(id: string): Promise<boolean> { return this.call("deleteSchedule", id); }
  restoreSchedule(id: string): Promise<boolean> { return this.call("restoreSchedule", id); }
  markNotificationRead(id: string): Promise<boolean> { return this.call("markNotificationRead", id); }
  readArtifact(input: ArtifactReadInput): Promise<ArtifactReadResult> { return this.call("readArtifact", input); }
  setSkillEnabled(sessionId: string, skillId: string, enabled: boolean): Promise<boolean> { return this.call("setSkillEnabled", sessionId, skillId, enabled); }
  saveProviderSecret(profileId: string, fieldId: string, value: string): Promise<unknown> { return this.call("saveProviderSecret", profileId, fieldId, value); }
  deleteProviderSecret(profileId: string, fieldId: string): Promise<unknown> { return this.call("deleteProviderSecret", profileId, fieldId); }
  setProviderEndpoint(profileId: string, endpoint: string): Promise<boolean> { return this.call("setProviderEndpoint", profileId, endpoint); }
  setProviderManualModel(profileId: string, model: string): Promise<boolean> { return this.call("setProviderManualModel", profileId, model); }
  setCustomProviderOptions(input: { authMode: "bearer" | "x-api-key" | "api-key"; capabilities: Partial<ProviderEnabledCapabilities> }): Promise<boolean> { return this.call("setCustomProviderOptions", input); }
  setProviderCapabilities(profileId: string, capabilities: Partial<ProviderEnabledCapabilities>): Promise<boolean> { return this.call("setProviderCapabilities", profileId, capabilities); }
  testProviderConnection(profileId: string): Promise<unknown> { return this.call("testProviderConnection", profileId); }
  registerLocalModel(input: LocalModelRegistration): Promise<boolean> { return this.call("registerLocalModel", input); }
  confirmLocalModel(id: string, versionId: string): Promise<boolean> { return this.call("confirmLocalModel", id, versionId); }
  requestLocalModelUpdate(id: string, versionId: string): Promise<boolean> { return this.call("requestLocalModelUpdate", id, versionId); }
  confirmLocalModelUpdate(id: string): Promise<boolean> { return this.call("confirmLocalModelUpdate", id); }
  getWorkspaceSnapshot(workspaceId?: string): Promise<unknown> { return this.call("getWorkspaceSnapshot", workspaceId); }
  requestSharedCommit(workspaceId: string): Promise<boolean> { return this.call("requestSharedCommit", workspaceId); }
  commitShared(workspaceId: string, message: string, paths?: string[]): Promise<boolean> { return this.call("commitShared", workspaceId, message, paths); }
  mergeWorkspace(workspaceId: string): Promise<boolean> { return this.call("mergeWorkspace", workspaceId); }
  restoreWorkspace(workspaceId: string): Promise<boolean> { return this.call("restoreWorkspace", workspaceId); }
  runReview(workspaceId: string): Promise<unknown> { return this.call("runReview", workspaceId); }
  stageExtension(input: ExtensionStageInput): Promise<StagedExtensionPackage> { return this.call("stageExtension", input); }
  installExtension(stagingId: string): Promise<unknown> { return this.call("installExtension", stagingId); }
  trustExtension(id: string, version: string): Promise<boolean> { return this.call("trustExtension", id, version); }
  enableExtension(id: string, enabled: boolean): Promise<boolean> { return this.call("enableExtension", id, enabled); }
  requestExtensionUpdate(id: string, stagingId: string): Promise<boolean> { return this.call("requestExtensionUpdate", id, stagingId); }
  confirmExtensionUpdate(id: string): Promise<boolean> { return this.call("confirmExtensionUpdate", id); }
  requestExtensionRollback(id: string): Promise<boolean> { return this.call("requestExtensionRollback", id); }
  confirmExtensionRollback(id: string): Promise<boolean> { return this.call("confirmExtensionRollback", id); }
  configureMcp(input: { id: string; endpoint: string }): Promise<unknown> { return this.call("configureMcp", input); }
  connectMcp(id: string): Promise<unknown> { return this.call("connectMcp", id); }
  exportArchive(input: { targetPath: string; scope: import("../../core/cp7-contracts").ArchiveScope }): Promise<unknown> { return this.call("exportArchive", input); }
  stageArchiveImport(sourcePath: string): Promise<unknown> { return this.call("stageArchiveImport", sourcePath); }
  previewArchiveImport(stagingId: string): Promise<unknown> { return this.call("previewArchiveImport", stagingId); }
  mergeArchiveImport(stagingId: string, confirmed: boolean): Promise<unknown> { return this.call("mergeArchiveImport", stagingId, confirmed); }
  exportCredentialBundle(input: { targetPath: string; entryIds: string[]; password: string }): Promise<void> { return this.call("exportCredentialBundle", input); }
  importCredentialBundle(input: { sourcePath: string; password: string; confirm: boolean; overwrite?: boolean }): Promise<unknown> { return this.call("importCredentialBundle", input); }
  getDiagnosticsPreview(runId?: string): Promise<import("../../core/cp7-contracts").DiagnosticPreview> { return this.call("getDiagnosticsPreview", runId); }
  setDiagnosticsConsent(enabled: boolean): Promise<boolean> { return this.call("setDiagnosticsConsent", enabled); }
  checkUpdates(channel: import("../../core/cp7-contracts").UpdateChannel): Promise<unknown> { return this.call("checkUpdates", channel); }
  downloadUpdate(): Promise<unknown> { return this.call("downloadUpdate"); }
  confirmUpdateInstall(): Promise<unknown> { return this.call("confirmUpdateInstall"); }
  getProductSettings(): Promise<import("../../core/cp7-contracts").ProductSettingsSnapshot> { return this.call("getProductSettings"); }
  setProductSetting(key: string, value: unknown): Promise<import("../../core/cp7-contracts").ProductSettingsSnapshot> { return this.call("setProductSetting", key, value); }
  getLspSnapshot(): Promise<LspSnapshot> { return this.call("getLspSnapshot"); }
  navigateLsp(input: Omit<LspRequest, "projectRoot"> & { projectRoot?: string }): Promise<LspResult> { return this.call("navigateLsp", input); }
  listWorkflows(): Promise<WorkflowSnapshot> { return this.call("listWorkflows"); }
  registerWorkflow(definition: WorkflowDefinition): Promise<WorkflowDefinition> { return this.call("registerWorkflow", definition); }
  runWorkflow(input: WorkflowRunInput): Promise<WorkflowRunSnapshot> { return this.call("runWorkflow", input); }
  cancelWorkflow(id: string): Promise<boolean> { return this.call("cancelWorkflow", id); }
  recoverWorkflow(id: string, decision?: "reconfirm"): Promise<WorkflowRunSnapshot> { return this.call("recoverWorkflow", id, decision); }
  getSubagentSnapshot(): Promise<SubagentSnapshot> { return this.call("getSubagentSnapshot"); }
  spawnSubagent(input: SubagentRequest): Promise<SubagentReceipt> { return this.call("spawnSubagent", input); }
  cancelSubagent(id: string): Promise<boolean> { return this.call("cancelSubagent", id); }
  getCompositionCenter(): Promise<CompositionCenterSnapshot> { return this.call("getCompositionCenter"); }
  setCompositionPreset(preset: CompositionPreset): Promise<CompositionCenterSnapshot> { return this.call("setCompositionPreset", preset); }
  selectCustomComposition(name: string): Promise<CompositionCenterSnapshot> { return this.call("selectCustomComposition", name); }
  copyCompositionPreset(source: CompositionPreset, name: string): Promise<CompositionCenterSnapshot> { return this.call("copyCompositionPreset", source, name); }
  setCompositionCapability(name: string, id: string, enabled: boolean): Promise<CompositionCenterSnapshot> { return this.call("setCompositionCapability", name, id, enabled); }
  reorderComposition(name: string, order: string[]): Promise<CompositionCenterSnapshot> { return this.call("reorderComposition", name, order); }
  restoreDefaultComposition(): Promise<CompositionCenterSnapshot> { return this.call("restoreDefaultComposition"); }

  private async call<T>(method: RuntimeRpcMethod, ...args: unknown[]): Promise<T> {
    await this.ensureConnected();
    return this.sendRequest<T>({ kind: "call", id: this.id(), method, args });
  }

  private id(): string { return `client-${this.nextId++}`; }

  private ensureConnected(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolveConnect, rejectConnect) => {
      const socket = net.createConnection(this.endpoint);
      this.socket = socket;
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => this.receive(chunk));
      socket.once("connect", () => {
        this.sendRequest<{ snapshot: AppSnapshot }>({
          kind: "hello",
          id: this.id(),
          revision: this.snapshotValue?.revision ?? 0,
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          capabilities: [...RUNTIME_PROTOCOL_CAPABILITIES],
        })
          .then(() => resolveConnect())
          .catch(rejectConnect);
      });
      socket.on("error", (error) => {
        if (!this.snapshotValue) rejectConnect(error);
      });
      socket.on("close", () => {
        this.socket = undefined;
        this.connecting = undefined;
        for (const pending of this.pending.values()) pending.reject(new Error("Runtime owner disconnected"));
        this.pending.clear();
        if (!this.disposed && this.listeners.size > 0) this.scheduleReconnect();
      });
    }).finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  private sendRequest<T>(request: WireRequest): Promise<T> {
    if (!this.socket || this.socket.destroyed) return Promise.reject(new Error("Runtime owner is not connected"));
    return new Promise<T>((resolveRequest, rejectRequest) => {
      this.pending.set(request.id, { resolve: resolveRequest, reject: rejectRequest });
      writeMessage(this.socket!, request);
    });
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf("\n");
      if (!line) continue;
      let message: WireResponse;
      try { message = JSON.parse(line) as WireResponse; } catch { continue; }
      if (message.kind === "update") {
        this.acceptSnapshot(message.snapshot, message.revision);
        continue;
      }
      if (message.kind !== "response") continue;
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      if (!message.ok) pending.reject(new Error(message.error));
      else {
        if (message.snapshot) this.acceptSnapshot(message.snapshot, message.revision);
        pending.resolve(message.result ?? message.snapshot);
      }
    }
  }

  private acceptSnapshot(snapshot: AppSnapshot, revision: number): void {
    this.snapshotValue = { ...clone(snapshot), revision } as AppSnapshot & { revision: number };
    for (const listener of this.listeners) listener(this.snapshot());
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.disposed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.ensureConnected()
        .then(() => this.sendRequest({ kind: "subscribe", id: this.id() }))
        .catch(() => this.scheduleReconnect());
    }, 120);
  }
}

type FunctionKey<T> = {
  // `any` is intentional here: only parameter-list variance is ignored while
  // deriving the finite method-name union; every call site still supplies a
  // RuntimeRpcMethod and the host validates it against RPC_METHOD_NAMES.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof T]-?: NonNullable<T[K]> extends (...args: any[]) => unknown ? K : never
}[keyof T];
type RuntimeRpcMethod = Exclude<Extract<FunctionKey<RuntimeOwnerService>, string>, "subscribe">;

const RPC_METHOD_NAMES = [
  "snapshot", "createSession", "createProjectSession", "createCliProjectSession", "openProjectSession", "setActiveSession",
  "renameSession", "togglePinned", "deleteSession", "setModel", "setProviderModel", "setPermissionMode", "setPermissionAccess",
  "querySessions", "setSmartRoutingEnabled", "setSmartRoutingStrategy", "createMemory", "updateMemory", "setMemoryEnabled", "deleteMemory",
  "buildProjectIndex", "searchProjectIndex", "setProjectIndexSemantic",
  "restoreProjectChange", "readTerminalOutput", "send", "cancel", "listRuns", "cancelRun", "steer", "inject", "clearSteering", "listSteering", "selectRun", "resolveToolApproval",
  "sendMessage", "delegateTask", "waitForMessage", "cancelWait", "markRead", "createSchedule", "setScheduleEnabled", "runScheduleNow",
  "deleteSchedule", "setSkillEnabled", "saveProviderSecret", "deleteProviderSecret", "setProviderEndpoint", "setProviderManualModel",
  "restoreSchedule", "markNotificationRead", "readArtifact",
  "setCustomProviderOptions", "setProviderCapabilities", "testProviderConnection", "registerLocalModel", "confirmLocalModel",
  "requestLocalModelUpdate", "confirmLocalModelUpdate", "getWorkspaceSnapshot", "requestSharedCommit",
  "commitShared", "mergeWorkspace", "restoreWorkspace", "runReview",
  "stageExtension", "installExtension", "trustExtension", "enableExtension", "requestExtensionUpdate", "confirmExtensionUpdate",
  "requestExtensionRollback", "confirmExtensionRollback", "configureMcp", "connectMcp",
  "exportArchive", "stageArchiveImport", "previewArchiveImport", "mergeArchiveImport", "exportCredentialBundle", "importCredentialBundle",
  "getDiagnosticsPreview", "setDiagnosticsConsent", "checkUpdates", "downloadUpdate", "confirmUpdateInstall", "getProductSettings", "setProductSetting",
  "getLspSnapshot", "navigateLsp", "listWorkflows", "registerWorkflow", "runWorkflow", "cancelWorkflow", "recoverWorkflow", "getSubagentSnapshot", "spawnSubagent", "cancelSubagent",
  "getCompositionCenter", "setCompositionPreset", "copyCompositionPreset", "setCompositionCapability", "reorderComposition", "restoreDefaultComposition",
  "selectCustomComposition",
] as const satisfies readonly RuntimeRpcMethod[];
const RPC_METHODS: ReadonlySet<string> = new Set(RPC_METHOD_NAMES);

type WireRequest =
  | { kind: "hello"; id: string; revision: number; protocolVersion: number; capabilities: RuntimeProtocolCapability[] }
  | { kind: "subscribe"; id: string }
  | { kind: "call"; id: string; method: RuntimeRpcMethod; args: unknown[] };
type WireResponse =
  | { kind: "response"; id: string; ok: true; result?: unknown; revision: number; snapshot?: AppSnapshot; negotiation?: { protocolVersion: number; capabilities: RuntimeProtocolCapability[] } }
  | { kind: "response"; id: string; ok: false; error: string }
  | { kind: "update"; revision: number; snapshot: AppSnapshot };

class SocketOutboundWriter {
  private readonly queue = new BoundedOutboundQueue<WireResponse>(64);
  private blocked = false;
  private closed = false;

  constructor(private readonly socket: net.Socket) {
    socket.on("drain", () => this.flush());
    socket.on("close", () => { this.closed = true; });
    socket.on("error", () => { this.closed = true; });
  }

  send(message: WireResponse): void {
    if (this.closed || this.socket.destroyed) return;
    if (this.blocked || this.queue.size > 0) {
      this.enqueue(message);
      return;
    }
    this.blocked = !this.socket.write(`${JSON.stringify(message)}\n`);
  }

  private enqueue(message: WireResponse): void {
    try {
      this.queue.enqueue(message);
    } catch (error) {
      if (error instanceof RuntimeOverloadedError) {
        this.closed = true;
        this.socket.destroy(error);
        return;
      }
      throw error;
    }
  }

  private flush(): void {
    if (this.closed || this.socket.destroyed) return;
    this.blocked = false;
    const pending = this.queue.drain();
    for (let index = 0; index < pending.length; index += 1) {
      if (!this.socket.write(`${JSON.stringify(pending[index])}\n`)) {
        this.blocked = true;
        for (let remainder = index + 1; remainder < pending.length; remainder += 1) {
          this.enqueue(pending[remainder]);
        }
        break;
      }
    }
  }
}

function runtimeEndpoint(dataRoot: string): string {
  const normalized = resolve(dataRoot);
  if (process.platform === "win32") {
    const safe = Buffer.from(normalized, "utf8").toString("base64url").replace(/[^a-zA-Z0-9_-]/gu, "").slice(-80);
    return `${PIPE_PREFIX}${safe}`;
  }
  return `${normalized}/${SOCKET_FILE}`;
}

function listen(server: net.Server, endpoint: string): Promise<void> {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error: Error) => { server.off("listening", onListening); rejectListen(error); };
    const onListening = () => { server.off("error", onError); resolveListen(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(endpoint);
  });
}

function writeMessage(socket: net.Socket, message: object): void {
  if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
}

function withRevision(snapshot: AppSnapshot, revision: number): AppSnapshot {
  return { ...clone(snapshot), revision };
}

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}
