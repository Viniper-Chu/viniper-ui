import { realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SessionSnapshot } from "../../core/contracts";
import { SecretVault } from "../../core/ports";
import { ApprovalHostMode } from "../../core/permission-contracts";
import { createCoordinationTools } from "../../features/coordination/coordination-tools";
import { CoordinationService } from "../../features/coordination/coordination-service";
import { PluginCatalog } from "../../features/plugins/plugin-catalog";
import { ProviderSettingsService } from "../../features/providers/provider-settings-service";
import { PermissionPolicy } from "../../features/permissions/permission-policy";
import { ProjectInstructionService } from "../../features/instructions/project-instruction-service";
import { ProviderRegistry } from "../../features/providers/provider-registry";
import { AgentRuntime, ProviderRequestLimits } from "../../features/runs/agent-runtime";
import { SchedulerService } from "../../features/scheduler/scheduler-service";
import { SecretService } from "../../features/secrets/secret-service";
import { SkillCatalog } from "../../features/skills/skill-catalog";
import { ExtensionSkillSource } from "../../features/skills/extension-skill-source";
import { TokenLedger } from "../../features/telemetry/token-ledger";
import { ToolRegistry } from "../../features/tools/tool-registry";
import { createProgrammingTools } from "../../features/programming/project-tools";
import { TerminalService } from "../../features/terminal/terminal-service";
import { createTerminalTools } from "../../features/terminal/terminal-tools";
import { createGitTools } from "../../features/git/git-tools";
import { WorkspaceService } from "../../features/workspaces/workspace-service";
import { ReviewService } from "../../features/review/review-service";
import { createWorkspaceTools } from "../../features/workspaces/workspace-tools";
import { createReviewTools } from "../../features/review/review-tools";
import { LocalGitService } from "../git/local-git-service";
import { DesktopApplication } from "../desktop/desktop-application";
import { NodeProjectFilesystem } from "../filesystem/node-project-filesystem";
import { WindowsFileOpener } from "../process/windows-file-opener";
import { createFileTools } from "../../features/files/file-tools";
import { WindowsProcessHost } from "../process/windows-process-host";
import { FilePluginSource } from "../persistence/file-plugin-source";
import { FileProjectInstructionSource } from "../persistence/file-project-instruction-source";
import { FileSkillSource } from "../persistence/file-skill-source";
import { SQLiteStore } from "../persistence/sqlite-store";
import { MemoryService } from "../../features/memory/memory-service";
import { ContextCompactionService } from "../../features/runs/context-compaction-service";
import { SmartRoutingService } from "../../features/providers/model-routing-service";
import { ProjectIndexService } from "../../features/project-indexing/project-index-service";
import { ManagedArtifactService } from "../../features/tool-output/managed-artifact-service";
import { ArtifactRetentionService } from "../../features/artifact-retention/artifact-retention-service";
import { NotificationService, SystemNotificationAdapter } from "../../features/notifications/notification-service";
import { ExtensionManager } from "../../features/extensions/extension-manager";
import { ExtensionPackageManager } from "../../features/extensions/extension-package-manager";
import { ManagedPluginProcessHost } from "../process/managed-plugin-process";
import { LocalModelService } from "../../features/local-models/local-model-service";
import { createLocalModelProvider } from "../../features/local-models/local-model-provider";
import { DataTransferService } from "../../features/data-transfer/data-transfer-service";
import { CredentialBundleService } from "../../features/credential-transfer/credential-bundle-service";
import { DiagnosticsService } from "../../features/diagnostics/diagnostics-service";
import { UpdateService } from "../../features/updates/update-service";
import { ProductSettingsService } from "../../features/settings/product-settings-service";
import { ArchiveScope, ArchiveDataset } from "../../core/cp7-contracts";
import { WebFetchService, createWebFetchTools } from "../../features/web/web-fetch-service";
import { GitHubRepositoryService, createGitHubRepositoryTools } from "../../features/web/github-repository-service";
import { CompositionService } from "../../features/composition/composition-service";
import { LspService } from "../../features/lsp/lsp-service";
import { SubagentService } from "../../features/workflows/subagent-service";
import { WorkflowService } from "../../features/workflows/workflow-service";
import { AgentEngineCatalog } from "../../features/agent-engines/agent-engine-catalog";
import { connectLoopbackMcp } from "../../features/extensions/loopback-mcp-connector";
import { ClaudeCodeProbeResult } from "../../core/agent-engine-contracts";
import { ClaudeCodeAuthMode, ClaudeCodeModelAliases, ClaudeCodeProvider } from "../../features/providers/claude-code-provider";
import { ClaudeCodeEngineAdapter, ViniperEngineAdapter } from "../../features/agent-engines/engine-adapters";
import { providerSecretId } from "../../features/providers/provider-profile-catalog";
import { NodeClaudeCodeProcessHost, probeClaudeCode, readClaudeCodeNonSecretSettings } from "../process/claude-code-process-host";

export interface HarnessApplicationFactoryOptions {
  dataRoot: string;
  workingDirectory: string;
  assetsRoot: string;
  secretVault: SecretVault;
  demoDelayMs?: number;
  approvalHostMode?: ApprovalHostMode;
  defaultProjectAccess?: SessionSnapshot["projectAccess"];
  providerFetchImpl?: typeof fetch;
  webFetchImpl?: typeof fetch;
  /** Explicit host authorization for a bounded real-provider acceptance run. */
  allowExternalNetwork?: boolean;
  maxConcurrentRuns?: number;
  /** Host-owned per-run Provider budget override for bounded acceptance processes. */
  providerRequestLimits?: ProviderRequestLimits;
  systemNotificationAdapter?: SystemNotificationAdapter;
  /** Enables Preview-only defaults without changing the canonical runtime defaults used by tests and other hosts. */
  previewFullAccessDefaults?: boolean;
  /** Desktop-only capability probe. Tests and headless hosts remain deterministic by default. */
  claudeCode?: {
    enabled: boolean;
    probe?: ClaudeCodeProbeResult;
    /** Host-only override; never included in renderer snapshots. */
    authMode?: ClaudeCodeAuthMode;
    /** Host-only non-secret gateway/model migration overrides. */
    baseUrl?: string;
    model?: string;
    smallFastModel?: string;
    modelAliases?: Partial<ClaudeCodeModelAliases>;
  };
}

export interface HarnessApplicationBundle {
  application: DesktopApplication;
  runtime: AgentRuntime;
  storage: SQLiteStore;
  /** Host-owned registry reference for local platform composition and bounded tests. */
  toolRegistry: ToolRegistry;
  terminalService: TerminalService;
  gitService: LocalGitService;
  workspaceService: WorkspaceService;
  reviewService: ReviewService;
  memoryService: MemoryService;
  compactionService: ContextCompactionService;
  routingService: SmartRoutingService;
  projectIndexService: ProjectIndexService;
  artifactService: ManagedArtifactService;
  retentionService: ArtifactRetentionService;
  notificationService: NotificationService;
  localModelService: LocalModelService;
  dataTransferService: DataTransferService;
  credentialBundleService: CredentialBundleService;
  diagnosticsService: DiagnosticsService;
  updateService: UpdateService;
  settingsService: ProductSettingsService;
  webFetchService: WebFetchService;
  compositionService: CompositionService;
  lspService: LspService;
  subagentService: SubagentService;
  workflowService: WorkflowService;
}

/**
 * Composes the single Harness application used by every local platform host.
 * Platform entrypoints supply only host-owned paths and secret storage.
 */
export async function createHarnessApplication(
  options: HarnessApplicationFactoryOptions,
): Promise<HarnessApplicationBundle> {
  const projectFilesystem = new NodeProjectFilesystem({
    protectedRoots: [options.dataRoot, options.assetsRoot],
    managedRoot: join(options.dataRoot, "programming"),
  });
  const workingDirectory = options.defaultProjectAccess?.enabled
    ? await projectFilesystem.canonicalizeProjectRoot(options.workingDirectory)
    : await canonicalHostWorkingDirectory(options.workingDirectory);
  const store = new SQLiteStore(options.dataRoot);
  await store.initialize();
  const artifactService = new ManagedArtifactService({ dataRoot: options.dataRoot, persistence: store });
  await artifactService.initialize();
  const retentionService = new ArtifactRetentionService(artifactService);
  const notificationService = new NotificationService(options.systemNotificationAdapter ?? { deliver: async () => undefined });
  const registry = new ProviderRegistry(options.demoDelayMs);
  const secrets = new SecretService(options.secretVault, store);
  const providerSettings = new ProviderSettingsService(
    store,
    secrets,
    registry,
    undefined,
    undefined,
    options.providerFetchImpl,
    options.allowExternalNetwork === true,
  );
  const claudeCodeProbe = options.claudeCode?.probe
    ?? (options.claudeCode?.enabled ? await probeClaudeCode() : {
      available: false,
      transport: "not-detected" as const,
      message: "Claude Code capability probe is disabled for this host.",
    });
  const claudeCodeLegacySettings = claudeCodeProbe.command
    ? await readClaudeCodeNonSecretSettings(claudeCodeProbe.command)
    : {};
  let claudeCodeEngineAdapter: ClaudeCodeEngineAdapter | undefined;
  if (claudeCodeProbe.available && claudeCodeProbe.command) {
    const claudeCodeProvider = new ClaudeCodeProvider({
      command: claudeCodeProbe.command,
      processHost: new NodeClaudeCodeProcessHost(),
      resolveSecret: () => secrets.readForProvider(providerSecretId("anthropic", "api-key")),
      resolveAuthMode: () => resolveClaudeCodeRuntimeSettings(options, providerSettings, claudeCodeLegacySettings).authMode,
      resolveBaseUrl: () => resolveClaudeCodeRuntimeSettings(options, providerSettings, claudeCodeLegacySettings).baseUrl,
      resolveModelAliases: () => resolveClaudeCodeRuntimeSettings(options, providerSettings, claudeCodeLegacySettings).modelAliases,
    });
    registry.registerDescriptor(claudeCodeProvider.descriptor);
    claudeCodeEngineAdapter = new ClaudeCodeEngineAdapter(claudeCodeProvider);
  } else {
    registry.registerDescriptor({
      id: "claude-code",
      name: "Claude code",
      label: "Claude code · CLI 未探测",
      configuration: "not-connected",
      available: false,
      realCallsEnabled: false,
      capabilities: [],
      models: [{ id: "claude-code-default", label: "Claude Code 默认模型" }],
    });
  }
  const agentEngines = new AgentEngineCatalog(registry, claudeCodeProbe);
  const compositionService = new CompositionService(undefined, {
    load: () => store.loadSetting("cp5.composition"),
    save: (value) => store.saveSetting("cp5.composition", value),
  });
  const toolRegistry = new ToolRegistry();
  for (const tool of createFileTools(new WindowsFileOpener(), { recoveryRoot: join(options.dataRoot, "file-recovery") })) toolRegistry.register(tool);
  for (const tool of createProgrammingTools(projectFilesystem)) toolRegistry.register(tool);
  const terminalService = new TerminalService(new WindowsProcessHost({
    managedRoot: join(options.dataRoot, "terminal-output"),
    artifactService,
    allowUnscoped: true,
  }), true);
  for (const tool of createTerminalTools(terminalService)) toolRegistry.register(tool);
  const webFetchService = new WebFetchService({ fetchImpl: options.webFetchImpl });
  for (const tool of createWebFetchTools(webFetchService)) toolRegistry.register(tool);
  for (const tool of createGitHubRepositoryTools(new GitHubRepositoryService())) toolRegistry.register(tool);
  const gitService = new LocalGitService({ managedRoot: join(options.dataRoot, "git-output") });
  const workspaceService = new WorkspaceService({
    dataRoot: options.dataRoot,
    git: gitService,
    persistence: store,
    onWorkspaceRoot: (root) => projectFilesystem.allowWorkspaceRoot(root),
  });
  const reviewService = new ReviewService();
  for (const tool of createGitTools(gitService, workspaceService)) toolRegistry.register(tool);
  for (const tool of createWorkspaceTools(workspaceService)) toolRegistry.register(tool);
  for (const tool of createReviewTools(reviewService, () => ({
    providerId: "demo",
    profileId: "demo",
    modelId: "demo-default",
  }))) toolRegistry.register(tool);
  const telemetry = new TokenLedger(store);
  const memoryService = new MemoryService(store);
  const compactionService = new ContextCompactionService(store);
  const routingService = new SmartRoutingService(registry, Date.now, store);
  const projectIndexService = new ProjectIndexService(store);
  const lspService = new LspService({ filesystem: projectFilesystem, index: projectIndexService, localProvider: "typescript-javascript" });
  const localModelService = new LocalModelService(store, Date.now, 1, (record) => {
    const provider = createLocalModelProvider(record, options.providerFetchImpl);
    if (provider) registry.register(provider);
  });
  const diagnosticsService = new DiagnosticsService({
    persistence: {
      load: async () => (await store.loadSetting<import("../../core/cp7-contracts").DiagnosticEntry[]>("cp7.diagnostics")) ?? [],
      save: (entries) => store.saveSetting("cp7.diagnostics", entries),
    },
  });
  const settingsService = new ProductSettingsService({
    load: (key) => store.loadSetting(key),
    save: (key, value) => store.saveSetting(key, value),
  }, options.maxConcurrentRuns === undefined ? undefined : { maxConcurrentRuns: options.maxConcurrentRuns });
  const updateService = new UpdateService();
  let application!: DesktopApplication;
  const dataTransferService = new DataTransferService({
    dataRoot: options.dataRoot,
    repository: {
      exportData: async (scope: ArchiveScope): Promise<ArchiveDataset> => {
        const snapshot = application.snapshot();
        const sessions = scope.kind === "session"
          ? snapshot.sessions.filter((session) => session.id === scope.sessionId)
          : scope.kind === "project"
            ? snapshot.sessions.filter((session) => session.projectAccess?.enabled === true && session.workingDirectory === scope.projectRoot)
            : snapshot.sessions;
        return {
          sessions,
          providerSettings: snapshot.providerSettings,
          extensionMetadata: snapshot.extensions,
          memories: snapshot.memories ? [snapshot.memories] : [],
          fileReferences: snapshot.artifacts?.records ?? [],
          artifacts: (snapshot.artifacts?.records ?? []).map((record) => ({ ref: record.relativePath, sizeBytes: record.sizeBytes })),
        };
      },
      previewMerge: async (data) => {
        const existing = new Set(application.snapshot().sessions.map((session) => session.id));
        const incoming = Array.isArray(data.sessions) ? data.sessions : [];
        const conflicts = incoming
          .filter((session): session is { id: string } => Boolean(session && typeof session === "object" && typeof (session as { id?: unknown }).id === "string"))
          .filter((session) => existing.has(session.id))
          .map((session) => ({ kind: "session", id: session.id, action: "keep-local" as const }));
        return { additions: Math.max(0, incoming.length - conflicts.length), conflicts };
      },
      merge: async (data) => {
        const sessions = (Array.isArray(data.sessions) ? data.sessions : []).filter((session): session is import("../../core/contracts").SessionSnapshot => Boolean(session && typeof session === "object" && typeof (session as { id?: unknown }).id === "string"));
        await runtime.importSessions(sessions);
      },
    },
  });
  const credentialBundleService = new CredentialBundleService({
    vault: {
      listPortable: async () => secrets.snapshot().references.map((reference) => ({ id: reference.id, label: reference.id, configured: reference.configured })),
      read: async (id) => (await secrets.readForProvider(id)) ?? undefined,
      write: async (id, value) => { await secrets.setSecret(id, value); },
    },
  });
  const extensionManager = new ExtensionManager({
    dataRoot: options.dataRoot,
    persistence: store,
    packages: new ExtensionPackageManager({ dataRoot: options.dataRoot }),
    processHost: new ManagedPluginProcessHost({ dataRoot: options.dataRoot }),
    mcpConnector: connectLoopbackMcp,
    toolRegistry,
  });
  let runtime!: AgentRuntime;
  const permissionPolicy = new PermissionPolicy(options.approvalHostMode ?? "interactive", Date.now, store);
  const skills = new SkillCatalog(
    new ExtensionSkillSource(
      new FileSkillSource([
        { path: join(options.assetsRoot, "skills"), source: "built-in" },
      ]),
      extensionManager,
    ),
    store,
    (sessionId) => runtime?.isRunning(sessionId) ?? false,
  );
  runtime = new AgentRuntime({
    persistence: store,
    defaultWorkingDirectory: workingDirectory,
    defaultProjectAccess: options.defaultProjectAccess,
    registry,
    toolRegistry,
    projectFilesystem,
    tokenLedger: telemetry,
    skillLoader: skills,
    instructionLoader: new ProjectInstructionService(new FileProjectInstructionSource()),
    permissionPolicy,
    workspaceService,
    gitService,
    reviewService,
    memoryService,
    compactionService,
    routingService,
    artifactService,
    extensionSnapshotProvider: () => extensionManager.beginRunSnapshot(),
    maxConcurrentRuns: options.maxConcurrentRuns,
    providerRequestLimits: options.providerRequestLimits,
    modelAvailability: (providerId, modelId) => providerSettings.isModelAvailable(providerId, modelId)
      || localModelService.isModelAvailable(providerId, modelId)
      || Boolean(registry.list().find((provider) => provider.id === providerId)?.models.some((model) => model.id === modelId)),
    composition: compositionService,
    viniperEngineAdapter: new ViniperEngineAdapter(),
    claudeCodeEngineAdapter,
  });
  const coordination = new CoordinationService(store, runtime);
  const subagentService = new SubagentService({
    coordination,
    runtime,
    permission: permissionPolicy,
    maxConcurrent: options.maxConcurrentRuns,
    persistence: {
      load: () => store.loadSetting("coordination.subagents.v1"),
      save: (snapshot) => store.saveSetting("coordination.subagents.v1", snapshot),
    },
  });
  const workflowService = new WorkflowService({
    runtime,
    subagents: subagentService,
    permission: permissionPolicy,
    maxConcurrent: options.maxConcurrentRuns,
    persistence: {
      load: () => store.loadSetting("cp4.workflows"),
      save: (snapshot) => store.saveSetting("cp4.workflows", snapshot),
    },
    tokenLedger: telemetry,
    captureArtifact: async (input) => {
      const result = await artifactService.captureToolResult({ sessionId: input.sessionId, runId: input.runId, toolName: "workflow.step", text: input.text, isError: input.isError });
      return result.ok ? result.record.id : undefined;
    },
  });
  const plugins = new PluginCatalog(
    new FilePluginSource([
      { path: join(options.assetsRoot, "plugins", "built-in"), builtIn: true },
      { path: join(options.assetsRoot, "plugins", "external"), builtIn: false },
    ]),
    toolRegistry,
    { "built-in.coordination": () => createCoordinationTools(coordination) },
  );
  const scheduler = new SchedulerService(store, runtime, workingDirectory);
  application = new DesktopApplication({
    runtime,
    coordination,
    telemetry,
    scheduler,
    skills,
    plugins,
    secrets,
    providerSettings,
    terminal: terminalService,
    workspaceService,
    gitService,
    reviewService,
    memory: memoryService,
    compaction: compactionService,
    routing: routingService,
    projectIndex: projectIndexService,
    artifacts: artifactService,
    retention: retentionService,
    notifications: notificationService,
    localModels: localModelService,
    extensionManager,
    dataTransfer: dataTransferService,
    credentialTransfer: credentialBundleService,
    diagnostics: diagnosticsService,
    updates: updateService,
    settings: settingsService,
    storage: store,
    toolRegistry,
    lspService,
    subagentService,
    workflowService,
    compositionService,
    agentEngines,
    previewFullAccessDefaults: options.previewFullAccessDefaults === true,
  });
  await workspaceService.initialize();
  await application.initialize();
  if (options.previewFullAccessDefaults === true) {
    const permissionMigration = await store.loadSetting<boolean>("preview.v016.full-access-and-skills");
    if (!permissionMigration) {
      for (const session of application.snapshot().sessions) {
        await runtime.setPermissionMode(session.id, "full");
        for (const skill of skills.list().filter((item) => item.source === "built-in")) {
          await skills.setEnabled(session.id, skill.id, true);
        }
      }
      await store.saveSetting("preview.v016.full-access-and-skills", true);
    }
  }
  return {
    application,
    runtime,
    storage: store,
    toolRegistry,
    terminalService,
    gitService,
    workspaceService,
    reviewService,
    memoryService,
    compactionService,
    routingService,
    projectIndexService,
    artifactService,
    retentionService,
    notificationService,
    localModelService,
    dataTransferService,
    credentialBundleService,
    diagnosticsService,
    updateService,
    settingsService,
    webFetchService,
    compositionService,
    lspService,
    subagentService,
    workflowService,
  };
}

const OFFICIAL_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1/messages";

function resolveClaudeCodeRuntimeSettings(
  options: HarnessApplicationFactoryOptions,
  providerSettings: ProviderSettingsService,
  legacySettings: {
    baseUrl?: string;
    model?: string;
    defaultSonnetModel?: string;
    defaultOpusModel?: string;
    defaultHaikuModel?: string;
    smallFastModel?: string;
    subagentModel?: string;
  },
): {
  authMode: ClaudeCodeAuthMode;
  baseUrl?: string;
  modelAliases: ClaudeCodeModelAliases;
} {
  const configured = providerSettings.snapshot().profiles.anthropic;
  const configuredEndpoint = configured?.endpoint?.trim();
  const explicitBaseUrl = options.claudeCode?.baseUrl?.trim()
    || process.env.ANTHROPIC_BASE_URL?.trim()
    || legacySettings.baseUrl?.trim();
  const configuredGateway = configuredEndpoint && !sameEndpoint(configuredEndpoint, OFFICIAL_ANTHROPIC_BASE_URL)
    ? configuredEndpoint
    : undefined;
  const baseUrl = explicitBaseUrl || configuredGateway;
  const configuredSmallFastModel = configured?.models[1]?.trim();
  const overrides = options.claudeCode?.modelAliases ?? {};
  const modelAliases: ClaudeCodeModelAliases = {
    model: options.claudeCode?.model?.trim()
      || overrides.model?.trim()
      || process.env.ANTHROPIC_MODEL?.trim()
      || legacySettings.model?.trim()
      || configured?.selectedModel?.trim()
      || undefined,
    defaultSonnetModel: overrides.defaultSonnetModel?.trim()
      || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL?.trim()
      || legacySettings.defaultSonnetModel?.trim()
      || undefined,
    defaultOpusModel: overrides.defaultOpusModel?.trim()
      || process.env.ANTHROPIC_DEFAULT_OPUS_MODEL?.trim()
      || legacySettings.defaultOpusModel?.trim()
      || undefined,
    defaultHaikuModel: overrides.defaultHaikuModel?.trim()
      || process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL?.trim()
      || legacySettings.defaultHaikuModel?.trim()
      || undefined,
    smallFastModel: options.claudeCode?.smallFastModel?.trim()
      || overrides.smallFastModel?.trim()
      || process.env.ANTHROPIC_SMALL_FAST_MODEL?.trim()
      || legacySettings.smallFastModel?.trim()
      || configuredSmallFastModel
      || undefined,
    subagentModel: overrides.subagentModel?.trim()
      || process.env.CLAUDE_CODE_SUBAGENT_MODEL?.trim()
      || legacySettings.subagentModel?.trim()
      || undefined,
  };
  return {
    authMode: options.claudeCode?.authMode ?? (baseUrl && !sameEndpoint(baseUrl, OFFICIAL_ANTHROPIC_BASE_URL) ? "auth-token" : "api-key"),
    ...(baseUrl ? { baseUrl } : {}),
    modelAliases,
  };
}

function sameEndpoint(left: string, right: string): boolean {
  const normalize = (value: string): string => value.replace(/\/v1\/messages\/?$/u, "").replace(/\/+$/u, "").toLowerCase();
  return normalize(left) === normalize(right);
}

async function canonicalHostWorkingDirectory(path: string): Promise<string> {
  const candidate = resolve(path);
  const metadata = await stat(candidate);
  if (!metadata.isDirectory()) throw new Error("默认工作目录不是目录。 ");
  return realpath(candidate);
}
