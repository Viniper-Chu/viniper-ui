"use strict";

// Host-owned bridge for the native Viniper Chat page. The renderer only sees
// projected runtime events; the copied Harness application owns persistence,
// provider selection, tools, permissions, usage and cancellation.
const fsp = require("node:fs/promises");
const path = require("node:path");
const readline = require("node:readline");

const { createHarnessApplication } = require("./harness-runtime/dist/src/platform/bootstrap/create-harness-application.js");
const { DOMESTIC_MODEL_PROFILES } = require("./harness-runtime/dist/src/features/providers/profiles/domestic-models.js");
const { loadLocalAgentPolicy } = require("./harness-runtime/dist/src/features/local-models/local-agent-policy.js");
const {
  normalizeRawAnthropicEndpoint,
  normalizeProviderModel,
} = require("./harness_provider_boundary.js");
const { projectLatestRunUsage, usageProjectionSignature } = require("./harness_usage_projection.js");

const runtimeRoot = path.resolve(process.env.VINIPER_HARNESS_DATA_ROOT || path.join(__dirname, "data", "harness-runtime"));
// Built-in plugins/skills live beside this bridge under harness-runtime.  The
// old __dirname root made packaged generic-Agent runs silently miss them.
const bundledAssetsRoot = path.join(__dirname, "harness-runtime");
const assetsRoot = path.resolve(process.env.VINIPER_HARNESS_ASSETS_ROOT || bundledAssetsRoot);
// Formal launches must be able to reach a configured remote Provider, just as
// the Harness desktop bootstrap does.  The isolated Demo fixture is the one
// intentional offline mode; an explicit `0` remains available for local
// diagnostics without making the normal launcher depend on an env setter.
const demoFixtureEnabled = process.env.VINIPER_DEMO_FIXTURE === "pending-tool";
const allowExternalNetwork = !demoFixtureEnabled && process.env.VINIPER_HARNESS_ALLOW_EXTERNAL_NETWORK !== "0";
const reviewProviderLimit = (() => {
  const raw = process.env.VINIPER_HARNESS_REVIEW_PROVIDER_LIMIT;
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 6) {
    throw new Error("VINIPER_HARNESS_REVIEW_PROVIDER_LIMIT must be an integer from 1 to 6");
  }
  return parsed;
})();
const mappingPath = path.join(runtimeRoot, "native-session-map.json");
const writeLine = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

class HostSecretVault {
  constructor() { this.values = new Map(); }
  isEncryptionAvailable() { return true; }
  async setSecret(id, value) {
    const normalized = String(value || "");
    if (!normalized) throw new Error("empty host secret");
    this.values.set(String(id), normalized);
  }
  async readSecret(id) { return this.values.get(String(id)) || null; }
  async deleteSecret(id) { this.values.delete(String(id)); }
  async isConfigured(id) { return this.values.has(String(id)); }
}

const secretVault = new HostSecretVault();
let runtime;
let services;
let application;
const activeRuns = new Map();
let sessionMap = { version: 1, sessions: {} };
let sessionMapWriteBarrier = Promise.resolve();

function nativeIdForHarness(id) {
  return Object.entries(sessionMap.sessions).find(([,v]) => v.harnessSessionId === id)?.[0] || "";
}

function knownSecrets(value) {
  const normalized = String(value || "");
  return normalized ? [normalized] : [];
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isManagedWorkdir(workdir) {
  return isInside(runtimeRoot, workdir) || isInside(assetsRoot, workdir);
}

function sanitize(value, secrets = []) {
  if (Array.isArray(value)) return value.map((item) => sanitize(item, secrets));
  if (typeof value === "string") {
    return secrets.reduce((text, secret) => secret ? text.split(secret).join("[REDACTED]") : text, value);
  }
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|credential|api[-_]?key|authorization|cookie|header/i.test(key)) continue;
    result[key] = sanitize(item, secrets);
  }
  return result;
}

async function loadSessionMap() {
  try {
    const raw = JSON.parse(await fsp.readFile(mappingPath, "utf8"));
    if (raw && typeof raw === "object" && raw.sessions && typeof raw.sessions === "object") {
      sessionMap = { version: 1, sessions: raw.sessions };
    }
  } catch {
    sessionMap = { version: 1, sessions: {} };
  }
}

async function saveSessionMap() {
  const snapshot = JSON.stringify(sessionMap, null, 2);
  const commit = async () => {
    await fsp.mkdir(runtimeRoot, { recursive: true });
    const temporary = `${mappingPath}.tmp`;
    await fsp.writeFile(temporary, snapshot, "utf8");
    await fsp.rename(temporary, mappingPath);
  };
  const pending = sessionMapWriteBarrier.then(commit, commit);
  sessionMapWriteBarrier = pending.catch(() => undefined);
  await pending;
}

function profileFor(providerId) {
  const normalized = String(providerId || "").trim().toLowerCase();
  if (normalized === "deepseek") return DOMESTIC_MODEL_PROFILES.find((profile) => profile.id === "deepseek") || null;
  return null;
}

function requestedModel(request, profileId) {
  const raw = String(request.model || "").trim();
  if (raw) return normalizeProviderModel(raw);
  if (["deepseek", "anthropic"].includes(profileId)) return require("./model-capabilities.json").default_deepseek_model;
  return "demo-default";
}

async function configureProviderMetadata(request) {
  const fixtureEnabled = process.env.VINIPER_DEMO_FIXTURE === "pending-tool";
  const requestedProvider = String(request.provider_id || "").trim().toLowerCase();
  if (fixtureEnabled || requestedProvider === "demo") {
    return { providerId: "demo", model: "demo-default", endpoint: "" };
  }

  const settings = application.services.providerSettings;
  const baseUrl = String(request.base_url || "").trim();
  const localPolicy = loadLocalAgentPolicy(baseUrl);
  const requestedProfile = profileFor(requestedProvider);
  // The existing DeepSeek gateway is Anthropic-compatible when its configured
  // endpoint is /anthropic; use the matching real profile instead of sending
  // an OpenAI payload to that endpoint.
  const profileId = localPolicy ? "openai-compatible" : requestedProvider === "deepseek" && /\/anthropic(?:\/|$)/iu.test(baseUrl)
    ? "anthropic"
    : (requestedProfile ? requestedProfile.id : "openai-compatible");
  const endpoint = localPolicy ? `${localPolicy.endpoint}/chat/completions` : profileId === "anthropic"
    ? normalizeRawAnthropicEndpoint(baseUrl)
    : baseUrl;
  if (endpoint) await settings.setEndpoint(profileId, endpoint);
  const model = requestedModel(request, profileId);
  await settings.setManualModel(profileId, model);
  if (localPolicy?.model === model) {
    await settings.setEnabledCapabilities(profileId, { stream: true, tools: true, reasoning: true, usage: true, cache: false });
  }
  return { providerId: profileId, model, endpoint };
}

async function configureProvider(request) {
  const provider = await configureProviderMetadata(request);

  // The value arrives only on the host-to-bridge control channel. It is never
  // placed in renderer payloads, process arguments, stdout, or reports.
  const secret = String(request.host_secret_value || "");
  if (secret && provider.providerId !== "demo") {
    await application.services.providerSettings.saveSecret(provider.providerId, "api-key", secret);
  }
  return { ...provider, secret };
}

async function ensureCollaborationSessions(rows) {
  const ensured = [];
  for (const row of rows) {
    const nativeId = String(row?.native_session_id || row?.session_id || "");
    const mapped = sessionMap.sessions[nativeId];
    // A read-side projection must not reconfigure a running/persisted owner.
    // Provider, workspace and permission changes belong to run preparation.
    let session = mapped?.harnessSessionId ? runtime.getSession(mapped.harnessSessionId) : null;
    if (!session) {
      const workdir = String(row?.workdir || "");
      const directory = await fsp.stat(workdir).catch(() => null);
      if (!directory?.isDirectory()) {
        ensured.push({ native_session_id: nativeId, state: "unavailable", reason: "项目目录不存在或不可访问，请重新选择目录；历史会话仍保留。" });
        continue;
      }
      const provider = await configureProvider(row || {});
      session = await ensureSession(row || {}, provider, { setActive: false });
    }
    ensured.push({ native_session_id: nativeId, harness_session_id: session.id });
  }
  return ensured;
}

async function ensureSession(request, provider, { setActive = true } = {}) {
  const nativeId = String(request.native_session_id || request.session_id || "");
  if (!nativeId) throw new Error("native session id is required");
  const existing = sessionMap.sessions[nativeId];
  let session = existing?.harnessSessionId ? runtime.getSession(existing.harnessSessionId) : null;
  const workdir = String(request.workdir || process.cwd()).trim() || process.cwd();
  if (!session) {
    session = isManagedWorkdir(workdir)
      ? await runtime.createSession(workdir, undefined, "viniper")
      : await runtime.createProjectSession(workdir, "cli-explicit", "viniper");
  } else if (!isManagedWorkdir(workdir)) {
    // Native sessions own their visible history and durable Harness session id.
    // Bind the selected workdir onto that same owner instead of remapping to a
    // fresh Harness session and silently losing Provider/tool context.
    session = await runtime.enableProjectAccess(session.id, workdir, "cli-explicit");
  } else if (session.projectAccess?.enabled === true) {
    throw new Error("受管应用目录不能替换当前项目工作区；Harness session owner 未改变");
  }
  const permissionMode = String(request.permission_mode || "auto");
  if (!await runtime.setProviderModel(session.id, provider.providerId, provider.model)) {
    throw new Error(`Harness provider/model unavailable: ${provider.providerId}/${provider.model}`);
  }
  await runtime.setPermissionMode(session.id, permissionMode);
  if (request.reasoning != null && !await runtime.setReasoning(session.id, String(request.reasoning))) {
    throw new Error("Harness reasoning selection unavailable");
  }
  const accessSelection = permissionMode === "review" && session.projectAccess?.enabled === true
    ? "project-run"
    : "standard";
  if (!await runtime.setPermissionAccess(session.id, accessSelection)) {
    throw new Error(`Harness permission access unavailable: ${accessSelection}`);
  }
  if (setActive) await runtime.setActiveSession(session.id);
  sessionMap.sessions[nativeId] = {
    harnessSessionId: session.id,
    providerId: provider.providerId,
    model: provider.model,
    agent: String(request.agent || "viniper"),
    updatedAt: new Date().toISOString(),
  };
  await saveSessionMap();
  return runtime.getSession(session.id) || session;
}

function waitForRunTerminal(sessionId, nativeSessionId, seenEvents, secrets) {
  return new Promise((resolve) => {
    let closed = false;
    let unsubscribe;
    let lastUsageSignature = "";
    let lastUsageEmitAt = 0;
    let pendingUsage = null;
    const emitUsage = (snapshot, force = false) => {
      const projected = projectLatestRunUsage(snapshot, sessionId, "");
      if (!projected) return;
      const signature = usageProjectionSignature(projected);
      if (!signature || signature === lastUsageSignature) return;
      const now = Date.now();
      if (!force && now - lastUsageEmitAt < 250) {
        pendingUsage = projected;
        return;
      }
      lastUsageSignature = signature;
      lastUsageEmitAt = now;
      pendingUsage = null;
      writeLine({ ...projected, native_session_id: nativeSessionId });
    };
    const finish = (event) => {
      if (closed) return;
      const snapshot = application?.snapshot?.();
      emitUsage(snapshot, true);
      if (pendingUsage) {
        const signature = usageProjectionSignature(pendingUsage);
        if (signature && signature !== lastUsageSignature) {
          lastUsageSignature = signature;
          writeLine({ ...pendingUsage, native_session_id: nativeSessionId });
        }
      }
      closed = true;
      unsubscribe?.();
      resolve(event);
    };
    const observe = (snapshot) => {
      const session = snapshot.sessions.find((item) => item.id === sessionId);
      const events = session?.events || [];
      for (const event of events.slice(seenEvents.count)) {
        seenEvents.count += 1;
        writeLine({ type: "runtime.event", native_session_id: nativeSessionId, event: sanitize(event, secrets) });
        if (["run.completed", "run.failed", "run.cancelled"].includes(String(event.type || ""))) finish(event);
      }
      if (!closed) emitUsage(snapshot);
    };
    unsubscribe = runtime.subscribe(observe);
  });
}

async function run(request) {
  const nativeSessionId = String(request.native_session_id || "");
  if (activeRuns.has(nativeSessionId)) throw new Error("Harness Application Port already owns this session run");
  const provider = await configureProvider(request);
  const secrets = knownSecrets(provider.secret);
  const session = await ensureSession(request, provider);
  const seenEvents = { count: session.events?.length || 0 };
  const terminal = waitForRunTerminal(session.id, nativeSessionId, seenEvents, secrets);
  activeRuns.set(nativeSessionId, { nativeSessionId, harnessSessionId: session.id });
  writeLine({
    type: "runtime.started",
    engine: "harness-runtime",
    contract: "harness-application-port.v2",
    session_id: session.id,
    native_session_id: String(request.native_session_id || ""),
    provider_id: provider.providerId,
    model: provider.model,
  });
  try {
    const result = await runtime.send({
      sessionId: session.id,
      text: String(request.prompt || ""),
      userText: request.user_text == null ? undefined : String(request.user_text),
      selectedModel: session.selectedModel,
      permissionMode: session.permissionMode,
      origin: { kind: "user" },
      memoryEnabled: request.memory_enabled !== false,
      planning: request.planning === true,
    });
    if (!result.accepted) throw new Error(`Harness run rejected: ${result.reason || "unknown"}`);
    const terminalEvent = await terminal;
    await runtime.flushRunPersistence(String(terminalEvent?.runId || terminalEvent?.payload?.runId || ""));
    writeLine({
      type: "runtime.completed",
      engine: "harness-runtime",
      contract: "harness-application-port.v2",
      session_id: session.id,
      native_session_id: String(request.native_session_id || ""),
      status: String(terminalEvent?.type || "run.completed"),
      accepted: true,
      queued: Boolean(result.queued),
      event_count: runtime.getSession(session.id)?.events?.length || 0,
    });
  } finally {
    activeRuns.delete(nativeSessionId);
  }
}

function mappedHarnessSession(nativeId) {
  const mapped = sessionMap.sessions[String(nativeId || "")];
  return mapped?.harnessSessionId ? runtime.getSession(mapped.harnessSessionId) : null;
}

function visibleNativeSessionSet(command) {
  return Array.isArray(command?.visible_native_session_ids)
    ? new Set(command.visible_native_session_ids.map((item) => String(item || "")).filter(Boolean))
    : null;
}

function requireVisibleNativeSessions(command, ...nativeSessionIds) {
  const visible = visibleNativeSessionSet(command);
  if (!visible) return;
  for (const nativeSessionId of nativeSessionIds.filter(Boolean)) {
    if (!visible.has(String(nativeSessionId))) throw new Error("collaboration target is not a current Viniper Shell session");
  }
}

function publicCollaborationSnapshot(visibleNativeSessionIds) {
  const visible = Array.isArray(visibleNativeSessionIds)
    ? new Set(visibleNativeSessionIds.map((item) => String(item || "")).filter(Boolean))
    : null;
  const mapped = Object.entries(sessionMap.sessions).flatMap(([nativeSessionId, value]) => {
    if (visible && !visible.has(nativeSessionId)) return [];
    const session = value?.harnessSessionId ? runtime.getSession(value.harnessSessionId) : null;
    return session ? [{
      native_session_id: nativeSessionId,
      harness_session_id: session.id,
      name: String(session.name || session.title || nativeSessionId),
      state: String(session.runtimeState || session.status || "idle"),
    }] : [];
  });
  const nativeByHarness = new Map(mapped.map((item) => [item.harness_session_id, item.native_session_id]));
  const subagentSnapshot = services?.subagentService?.snapshot?.() || {};
  const subagents = [...(subagentSnapshot.active || []), ...(subagentSnapshot.recent || [])]
    .flatMap((item) => {
      const parent = nativeByHarness.get(String(item.parentSessionId || ""));
      const target = nativeByHarness.get(String(item.targetSessionId || ""));
      if (!parent || !target) return [];
      return [{
        id: String(item.id || ""), status: String(item.status || ""),
        parent_session_id: parent, target_session_id: target,
        run_id: String(item.runId || ""), output: String(item.output || ""), error: String(item.error || ""),
        created_at: Number(item.createdAt || 0), updated_at: Number(item.updatedAt || 0),
      }];
    });
  const coordination = application?.services?.coordination?.snapshot?.() || {};
  const envelopes = (coordination.envelopes || []).flatMap((item) => {
    const source = nativeByHarness.get(String(item.sourceSessionId || ""));
    const target = nativeByHarness.get(String(item.targetSessionId || ""));
    if (!source || !target) return [];
    return [{
      id: String(item.id || ""), revision: Number(item.revision || 0),
      source_session_id: source, target_session_id: target,
      type: String(item.type || "message"), status: String(item.status || "delivered"),
      body: String(item.body || ""), correlation_id: String(item.correlationId || ""),
      delegation_id: String(item.delegationId || ""), created_at: Number(item.createdAt || 0), updated_at: Number(item.updatedAt || 0),
    }];
  });
  const waits = (coordination.waits || []).flatMap((item) => {
    const sessionId = nativeByHarness.get(String(item.sessionId || ""));
    if (!sessionId) return [];
    return [{ id: String(item.id || ""), session_id: sessionId, from_session_id: nativeByHarness.get(String(item.fromSessionId || "")) || "", envelope_type: String(item.envelopeType || ""), correlation_id: String(item.correlationId || ""), created_at: Number(item.createdAt || 0), timeout_at: Number(item.timeoutAt || 0) }];
  });
  return { sessions: mapped, envelopes, waits, subagents };
}

function publicHarnessSnapshot() {
  // Build the management projection from the individual host services rather
  // than cloning the complete application snapshot.  The complete runtime
  // snapshot includes every persisted session/event and can be very large on
  // a long-lived install; capability panels must remain responsive and must
  // never stream that session history into the renderer.
  const host = application?.services || services || {};
  // Keep the renderer on a host-owned, redacted projection.  In particular,
  // provider settings expose state/endpoint/model metadata only; credential
  // values and secret storage internals never cross this bridge.
  const managedExtensions = host.extensionManager?.snapshot?.() || {};
  return sanitize({
    provider_catalog: host.providerSettings?.catalogSnapshot?.() || {},
    provider_settings: host.providerSettings?.snapshot?.() || {},
    local_models: host.localModels?.snapshot?.() || {},
    extensions: {
      ...managedExtensions,
      skills: host.skills?.list?.() || [],
      plugins: host.plugins?.list?.() || [],
    },
    project_indexes: host.projectIndex ? [publicProjectIndexSnapshot(host.projectIndex.snapshot())] : [],
    lsp: host.lspService?.snapshot?.() || {},
    workflows: host.workflowService?.snapshot?.() || {},
    subagents: host.subagentService?.snapshot?.() || {},
    coordination: host.coordination?.snapshot?.() || {},
    composition: host.compositionService?.centerSnapshot?.("desktop") || {},
    diagnostics: host.diagnostics?.snapshot?.() || {},
    artifacts: host.artifacts?.snapshot?.() || {},
    reviews: host.reviewService?.list?.() || [],
    permissions: application?.services?.runtime?.pendingToolApprovals
      ? { pending: application.services.runtime.pendingToolApprovals() }
      : { pending: [] },
  });
}

function publicSessionMessage(message) {
  if (!message || typeof message !== "object") return null;
  const text = typeof message.text === "string"
    ? message.text
    : (typeof message.content === "string" ? message.content : "");
  const role = String(message.role || "").toLowerCase();
  if (!text && !["user", "assistant", "system"].includes(role)) return null;
  const result = {
    id: String(message.id || ""),
    role: ["user", "assistant", "system"].includes(role) ? role : "assistant",
    content: text,
    createdAt: Number(message.createdAt || 0) || 0,
    status: String(message.status || "completed"),
  };
  if (Array.isArray(message.attachments)) {
    result.attachments = message.attachments.map((item) => {
      if (!item || typeof item !== "object") return null;
      return {
        id: String(item.id || ""),
        name: String(item.name || item.fileName || ""),
        path: String(item.path || item.relativePath || ""),
        mime: String(item.mime || item.mimeType || ""),
        size: Number(item.size || 0) || 0,
      };
    }).filter((item) => item && (item.id || item.name || item.path));
  }
  if (Array.isArray(message.artifacts) || Array.isArray(message.fileReferences)) {
    const references = [...(message.artifacts || []), ...(message.fileReferences || [])]
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        return {
          id: String(item.id || ""),
          name: String(item.name || item.fileName || ""),
          path: String(item.path || item.relativePath || ""),
          type: String(item.type || ""),
          size: Number(item.size || 0) || 0,
        };
      }).filter((item) => item && (item.id || item.name || item.path));
    if (references.length) result.fileReferences = references;
  }
  return result;
}

function publicSessionProjection(session) {
  if (!session || typeof session !== "object") return null;
  const messages = Array.isArray(session.messages)
    ? session.messages.map(publicSessionMessage).filter(Boolean)
    : [];
  return {
    id: String(session.id || ""),
    title: String(session.title || ""),
    workingDirectory: String(session.workingDirectory || ""),
    engineId: String(session.engineId || ""),
    selectedModel: String(session.selectedModel || ""),
    selectedProviderId: String(session.selectedProviderId || ""),
    permissionMode: String(session.permissionMode || ""),
    status: String(session.status || "idle"),
    unread: Boolean(session.unread),
    pinned: Boolean(session.pinned),
    createdAt: Number(session.createdAt || 0) || 0,
    updatedAt: Number(session.updatedAt || 0) || 0,
    messages,
  };
}

function publicSessionSnapshot() {
  const source = typeof runtime?.listSessions === "function" ? runtime.listSessions() : [];
  const mappedHarnessSessionIds = new Set(
    Object.values(sessionMap.sessions || {})
      .map((item) => String(item?.harnessSessionId || ""))
      .filter(Boolean),
  );
  return {
    // Native shell sessions are already owned by sessions.json.  Their
    // Harness counterparts exist only to provide runtime/coordination state;
    // projecting them back into the shell on restart would create duplicate
    // legacy-harness-* sessions.
    sessions: source
      .filter((session) => !mappedHarnessSessionIds.has(String(session?.id || "")))
      .map(publicSessionProjection)
      .filter((session) => session && session.id),
  };
}

function publicProjectIndexSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return { explicit: false, status: "unavailable", records: [] };
  return {
    ...snapshot,
    records: (snapshot.records || []).map((record) => ({
      path: String(record?.path || ""),
      modifiedAt: Number(record?.modifiedAt || 0),
      sizeBytes: Buffer.byteLength(String(record?.text || ""), "utf8"),
      symbols: Array.isArray(record?.symbols) ? record.symbols.map(String) : [],
      stale: Boolean(record?.stale),
    })),
  };
}

async function handleHarnessOperation(command) {
  const target = String(command.target || "").trim();
  if (target === "snapshot") return publicHarnessSnapshot();
  const args = command.args && typeof command.args === "object" ? command.args : {};
  const index = services?.projectIndexService;
  const lsp = services?.lspService;
  const localModels = services?.localModelService;
  const extensions = services?.extensionManager || application?.services?.extensionManager;
  const composition = services?.compositionService;
  const review = services?.reviewService;
  const workflows = services?.workflowService;
  const subagents = services?.subagentService;
  const providerSettings = services?.providerSettings || application?.services?.providerSettings;
  if (target === "terminal.output") {
    const session = mappedHarnessSession(String(args.native_session_id || ""));
    if (!session) throw new Error("输出需要所属的 Viniper 会话");
    const executionId = String(args.execution_id || "");
    const owner = session.activities.find(item => item.presentation?.kind === "terminal-run" && item.presentation.executionId === executionId);
    if (!owner?.runId) throw new Error("此输出不属于当前会话");
    const result = await services.terminalService.outputForSession({
      executionId, stream: String(args.stream || "stdout"), offset: Number(args.offset || 0), maxBytes: 65536,
    }, session.id, { runId: owner.runId, status: owner.presentation.status });
    return sanitize(result, [String(args.host_secret_value || "")]);
  }
  if (target === "tools.snapshot") {
    const registry = application?.services?.toolRegistry || services?.toolRegistry;
    return { names: (registry?.descriptors?.() || []).map((item) => String(item.name || "")).filter(Boolean) };
  }
  if (target === "session.cleanup-artifacts") {
    const nativeSessionId = String(args.native_session_id || "");
    const runIds = Array.isArray(args.run_ids) ? args.run_ids.map((value) => String(value || "")).filter(Boolean) : [];
    const harnessSessionId = String(args.harness_session_id || args.session_id || "");
    const mapped = nativeSessionId ? mappedHarnessSession(nativeSessionId) : null;
    if (mapped && typeof application?.cleanupSessionArtifacts === "function") {
      return await application.cleanupSessionArtifacts(mapped.id, runIds);
    }
    if ((runIds.length === 0 && !harnessSessionId) || typeof application?.cleanupRunArtifacts !== "function") {
      throw new Error("Harness session cleanup is unavailable");
    }
    return await application.cleanupRunArtifacts(runIds, harnessSessionId);
  }
  if (target === "host.configure") {
    const provider = await configureProvider({
      provider_id: String(args.provider_id || ""),
      base_url: String(args.base_url || ""),
      model: String(args.model || ""),
      host_secret_value: String(args.host_secret_value || ""),
    });
    const mcpEndpoint = String(args.mcp_endpoint || "");
    if (mcpEndpoint) {
      const id = "workstation-loopback";
      const existing = (extensions?.snapshot?.().mcpConnections || []).find((item) => item?.id === id);
      if (!existing || String(existing.endpoint || "") !== mcpEndpoint) {
        await extensions.configureMcp({ id, endpoint: mcpEndpoint });
      }
      await extensions.connectMcp(id);
    }
    const mcpState = (extensions?.snapshot?.().mcpConnections || []).find((item) => item?.id === "workstation-loopback" && item?.endpoint === mcpEndpoint);
    const plugins = application?.services?.plugins?.list?.() || [];
    return {
      provider: { profileId: provider.providerId, model: provider.model, endpoint: provider.endpoint, configured: Boolean(provider.secret) },
      mcp: { configured: Boolean(mcpEndpoint), connected: Boolean(mcpState?.connected) },
      builtInCoordination: plugins.some((item) => item?.id === "built-in.coordination" && item?.executable === true),
    };
  }
  if (target === "project-index.snapshot") return publicProjectIndexSnapshot(index?.snapshot?.());
  if (target === "project-index.build") return publicProjectIndexSnapshot(await index?.build(String(args.project_root || process.cwd()), true));
  if (target === "project-index.search") return index?.search(String(args.project_root || process.cwd()), String(args.query || ""));
  if (target === "lsp.snapshot") return lsp?.snapshot?.() || { status: "unavailable" };
  if (target === "lsp.navigate") {
    if (!lsp?.navigate) throw new Error("LSP 服务不可用");
    return lsp.navigate({
      operation: String(args.operation || "definition"),
      projectRoot: String(args.project_root || process.cwd()),
      path: String(args.path || ""),
      symbol: String(args.symbol || ""),
      line: Number(args.line || 1),
      character: Number(args.character || 0),
    });
  }
  if (target === "local-models.snapshot") return localModels?.snapshot?.() || { records: [], status: "unavailable" };
  if (target === "local-models.register") {
    if (!localModels?.registerLoopback) throw new Error("本地模型服务不可用");
    return { changed: await localModels.registerLoopback(args) };
  }
  if (target === "local-models.confirm") {
    if (!localModels?.confirmAdoption) throw new Error("本地模型采用操作不可用");
    return { changed: await localModels.confirmAdoption(String(args.id || ""), String(args.version_id || "")) };
  }
  if (target === "local-models.update") {
    if (!localModels?.requestUpdate) throw new Error("本地模型更新操作不可用");
    return { changed: await localModels.requestUpdate(String(args.id || ""), String(args.version_id || "")) };
  }
  if (target === "local-models.apply-update") {
    if (!localModels?.confirmUpdate) throw new Error("本地模型更新确认不可用");
    return { changed: await localModels.confirmUpdate(String(args.id || "")) };
  }
  if (target === "extensions.snapshot") return extensions?.snapshot?.() || { records: [], staged: [], mcpConnections: [] };
  if (!extensions) throw new Error("扩展服务不可用");
  if (target === "extensions.stage") return { staged: await extensions.stage({ source: String(args.source || "user"), location: String(args.location || ""), ...(args.version_override ? { versionOverride: String(args.version_override) } : {}) }) };
  if (target === "extensions.install") return { installed: await extensions.install(String(args.staging_id || "")) };
  if (target === "extensions.enable") return { changed: await extensions.setEnabled(String(args.id || ""), Boolean(args.enabled)) };
  if (target === "extensions.trust") return { changed: await extensions.trust(String(args.id || ""), String(args.version || "")) };
  if (target === "extensions.update") return { changed: await extensions.requestUpdate(String(args.id || ""), String(args.staging_id || "")) };
  if (target === "extensions.apply-update") return { changed: await extensions.confirmUpdate(String(args.id || "")) };
  if (target === "extensions.rollback") return { changed: await extensions.requestRollback(String(args.id || "")) };
  if (target === "extensions.confirm-rollback") return { changed: await extensions.confirmRollback(String(args.id || "")) };
  if (target === "extensions.mcp.configure") return extensions.configureMcp({ id: String(args.id || ""), endpoint: String(args.endpoint || "") });
  if (target === "extensions.mcp.connect") return extensions.connectMcp(String(args.id || ""));
  if (target === "extensions.mcp.disconnect") return { changed: await extensions.disconnectMcp(String(args.id || "")) };
  if (target === "extensions.mcp.status") return { connections: extensions.snapshot?.().mcpConnections || [] };
  if (target === "extensions.mcp.refresh") {
    if (typeof extensions.refreshMcp !== "function") throw new Error("当前 ExtensionManager 未提供 MCP refresh 操作");
    return extensions.refreshMcp(String(args.id || ""));
  }
  if (target === "provider.snapshot") return publicHarnessSnapshot().provider_settings || {};
  if (target === "provider.capabilities.snapshot") return publicHarnessSnapshot().provider_catalog || {};
  if (target === "provider.network.snapshot") return publicHarnessSnapshot().provider_catalog || {};
  if (target === "provider.capabilities") {
    const profileId = String(args.profile_id || "");
    if (!profileId || !args.capabilities || typeof args.capabilities !== "object") return publicHarnessSnapshot().provider_catalog || {};
    return { changed: await providerSettings.setEnabledCapabilities(profileId, args.capabilities) };
  }
  if (target === "provider.network") {
    const profileId = String(args.profile_id || "");
    if (!profileId || !args.network || typeof args.network !== "object") return publicHarnessSnapshot().provider_catalog || {};
    return { changed: await providerSettings.setNetworkSettings(profileId, args.network) };
  }
  if (target === "provider.test") {
    const profileId = String(args.profile_id || "");
    if (!profileId) throw new Error("Provider profile is required");
    return providerSettings.testConnection(profileId);
  }
  if (target === "review.snapshot") return { reviews: review?.list?.() || [] };
  if (target === "review.run" || target === "review.start") {
    if (!review?.run) throw new Error("Review 服务不可用");
    const settings = providerSettings?.snapshot?.() || {};
    const profiles = settings.profiles || {};
    const profileId = String(args.profile_id || (profiles.deepseek ? "deepseek" : Object.keys(profiles)[0] || "deepseek"));
    const configuration = profiles[profileId] || {};
    const evidence = Array.isArray(args.evidence)
      ? args.evidence.map((item) => ({ ...item, summary: String(item?.summary || "只读证据") }))
      : (String(args.evidence_summary || "").trim() ? [{ kind: "user", summary: String(args.evidence_summary).trim() }] : []);
    const frozenProvider = {
      providerId: profileId,
      profileId,
      modelId: String(configuration.selectedModel || configuration.models?.[0] || ""),
      permissionMode: "default",
      tools: [],
      cachePlan: configuration.cachePlan || {},
      contextProfile: configuration.contextProfile || {},
    };
    return { review: await review.run({ policy: "on", changed: true, workspaceId: String(args.workspace_id || ""), round: Number(args.round || 1), evidence, frozenProvider, execute: undefined }) };
  }
  if (target === "composition.snapshot") return composition?.centerSnapshot?.("desktop") || {};
  if (target === "composition.set-preset") return { composition: composition.setPreset(String(args.preset || "standard")), };
  if (target === "composition.select-custom") return { composition: composition.selectCustom(String(args.name || "")), };
  if (target === "composition.restore-default") return { composition: composition.restoreDefault(), };
  if (target === "composition.save-custom") {
    if (!composition?.copyPreset) throw new Error("当前能力组合服务不支持保存自定义组合");
    return { composition: await composition.copyPreset(String(args.source || "standard"), String(args.name || "")) };
  }
  if (target === "workflows.snapshot") return workflows?.snapshot?.() || { definitions: [], runs: [] };
  if (target === "subagents.snapshot") return subagents?.snapshot?.() || { active: [], recent: [] };
  if (target === "subagents.cancel") return { changed: await subagents.cancel(String(args.id || "")) };
  throw new Error(`unsupported Harness operation: ${target}`);
}

async function handleControl(command) {
  const requestId = String(command.request_id || "");
  try {
    let data;
    if (command.op === "run.steer") {
      const owned = mappedHarnessSession(command.native_session_id);
      const active = owned && runtime.listRuns(owned.id).find((run) => ["queued", "running", "waiting", "waiting_resource", "recovering", "replaying"].includes(run.status));
      if (!active) throw new Error("当前会话没有可引导的运行");
      data = { receipt: await runtime.steer(active.runId, String(command.message || "")) };
    } else if (command.op.startsWith("scheduler.")) {
      const scheduler = application.services.scheduler;
      if (command.op === "scheduler.snapshot") { data = scheduler.snapshot(); data.definitions = data.definitions.map(d => ({...d, native_session_id: nativeIdForHarness(d.target.sessionId)})); }
      else if (command.op === "scheduler.create") {
        const target = mappedHarnessSession(command.native_session_id);
        if (!target) throw new Error("目标会话尚未注册");
        data = { schedule: await scheduler.create({name:command.title, prompt:command.prompt,
          schedule:{kind:"cron",expression:command.cron,timeZone:command.time_zone||"Asia/Shanghai"},
          target:{kind:"existing-session",sessionId:target.id}}) };
      } else if (command.op === "scheduler.claim") data = { due: (await scheduler.claimDue()).map(d => ({...d, native_session_id: nativeIdForHarness(d.target.sessionId)})) };
      else if (command.op === "scheduler.defer") { await scheduler.deferExternal(command.id); data = {ok:true}; }
      else if (command.op === "scheduler.update") data = {changed:await scheduler.update(command.id, {name:command.title,prompt:command.prompt,schedule:{kind:"cron",expression:command.cron,timeZone:command.time_zone||"Asia/Shanghai"}})};
      else if (command.op === "scheduler.record") { await scheduler.recordExternal(command.id, command.accepted, command.detail); data = {ok:true}; }
      else if (command.op === "scheduler.delete") data = {changed:await scheduler.delete(command.id)};
      else if (command.op === "scheduler.toggle") data = {changed:await scheduler.setEnabled(command.id, Boolean(command.enabled))};
      else throw new Error("Unknown scheduler operation");
    } else if (command.op === "goals.load") {
      data = { goals: await application.services.storage.loadSetting("viniper.goals.v2") || null };
    } else if (command.op === "goals.save") {
      await application.services.storage.saveSetting("viniper.goals.v2", command.goals || {});
      data = { saved: true };
    } else if (command.op === "collaboration.snapshot") {
      data = publicCollaborationSnapshot(command.visible_native_session_ids);
    } else if (command.op === "sessions.ensure") {
      const rows = Array.isArray(command.sessions) ? command.sessions : [];
      data = { ensured: await ensureCollaborationSessions(rows) };
    } else if (command.op === "sessions.snapshot") {
      data = publicSessionSnapshot();
    } else if (command.op === "sessions.delete") {
      const nativeSessionId = String(command.native_session_id || "");
      if (!nativeSessionId) throw new Error("native session id is required");
      if (activeRuns.has(nativeSessionId)) throw new Error("active Harness session cannot be deleted");
      const mapped = sessionMap.sessions[nativeSessionId];
      let deleted = false;
      if (mapped?.harnessSessionId) {
        deleted = await application.deleteSession(String(mapped.harnessSessionId));
      }
      delete sessionMap.sessions[nativeSessionId];
      await saveSessionMap();
      data = { deleted: Boolean(deleted), mapping_removed: true, native_session_id: nativeSessionId };
    } else if (command.op === "harness.snapshot") {
      data = publicHarnessSnapshot();
    } else if (command.op === "harness.operation") {
      data = await handleHarnessOperation(command);
    } else if (command.op === "permissions.snapshot") {
      data = { pending: application?.services?.runtime?.pendingToolApprovals?.() || [] };
    } else if (command.op === "permission.resolve") {
      const sessionId = String(command.session_id || "");
      const runId = String(command.run_id || "");
      const callId = String(command.call_id || "");
      const decision = command.decision === "allow-once" ? "allow-once" : "reject";
      if (!sessionId || !runId || !callId) throw new Error("permission resolve requires session_id, run_id and call_id");
      // The native server owns the stable/native session id, while the
      // Harness runtime owns a durable session id.  Resolve against the
      // mapped Harness session so a pending approval is correlated to the
      // same session/run/call that emitted the interaction event.
      const mapped = mappedHarnessSession(sessionId);
      const ownedRun = activeRuns.get(sessionId);
      const harnessSessionId = mapped?.id || ownedRun?.harnessSessionId || sessionId;
      data = { resolved: await application.services.runtime.resolveToolApproval(harnessSessionId, runId, callId, decision) };
    } else if (command.op === "capabilities.snapshot") {
      const host = application?.services || services || {};
      data = {
        collaboration: typeof application?.delegateTask === "function",
        subagents: typeof application?.spawnSubagent === "function" && Boolean(host.subagentService),
        plugins: Boolean(host.plugins),
        project_index: Boolean(host.projectIndex),
        lsp: Boolean(host.lspService),
        local_models: Boolean(host.localModels),
        extensions: Boolean(host.extensionManager),
        mcp: Boolean(host.extensionManager),
        review: Boolean(host.reviewService),
        composition: Boolean(host.compositionService),
        provider_settings: Boolean(host.providerSettings),
      };
    } else if (command.op === "plugins.snapshot") {
      const host = application?.services || services || {};
      const plugins = typeof host.plugins?.list === "function" ? host.plugins.list() : [];
      data = {
        plugins: plugins.filter(plugin => plugin.classification === "built-in").map((plugin) => ({
          id: String(plugin.id || plugin.name || ""),
          name: String(plugin.name || plugin.id || ""),
          status: plugin.tools.every(name => services.toolRegistry.has(name)) ? "available" : "unavailable",
          tools: plugin.tools,
          icon: ({ "built-in.documents": "files", "built-in.math-documents": "math", "built-in.project": "code", "built-in.research": "search", "built-in.coordination": "chat" })[plugin.id] || "plugin",
          description: ({"built-in.documents":"读取和精确修改 Word 文档，以事务处理 SQLite 数据。", "built-in.math-documents":"复用本机排版工具制作师生讲义，读取 PDF 并生成检查用页面。", "built-in.project":"检索项目、修改代码、查看差异并运行验证。", "built-in.research":"读取公开网页与 GitHub 仓库资料。", "built-in.coordination":"通过已注册的工具安排会话协作与任务委派。"})[plugin.id] || "已注册的本机工具扩展。",
          built_in: plugin.classification === "built-in",
        })).filter((plugin) => plugin.id),
      };
    } else if (command.op === "collaboration.delegate") {
      requireVisibleNativeSessions(command, command.source_native_session_id, command.target_native_session_id);
      const source = mappedHarnessSession(command.source_native_session_id);
      const target = mappedHarnessSession(command.target_native_session_id);
      if (!source || !target) throw new Error("委派需要两个已映射的 Viniper Harness 会话");
      const receipt = await application.delegateTask(source.id, target.id, String(command.task || ""));
      data = { accepted: true, id: String(receipt?.id || receipt?.envelopeId || ""), status: String(receipt?.status || "queued") };
    } else if (command.op === "collaboration.send") {
      requireVisibleNativeSessions(command, command.source_native_session_id, command.target_native_session_id);
      const source = mappedHarnessSession(command.source_native_session_id);
      const target = mappedHarnessSession(command.target_native_session_id);
      if (!source || !target) throw new Error("发送消息需要两个已映射的 Viniper Harness 会话");
      const envelope = await application.sendMessage(source.id, target.id, String(command.message || ""));
      data = { accepted: true, id: String(envelope?.id || ""), status: String(envelope?.status || "delivered") };
    } else if (command.op === "collaboration.wait") {
      requireVisibleNativeSessions(command, command.native_session_id, command.from_native_session_id);
      const session = mappedHarnessSession(command.native_session_id);
      const source = mappedHarnessSession(command.from_native_session_id);
      if (!session || (command.from_native_session_id && !source)) throw new Error("等待需要已映射的 Viniper Harness 会话");
      data = await application.waitForMessage(session.id, {
        ...(source ? { fromSessionId: source.id } : {}),
        ...(command.envelope_type ? { envelopeType: String(command.envelope_type) } : {}),
        ...(command.correlation_id ? { correlationId: String(command.correlation_id) } : {}),
        ...(Number(command.timeout_ms) > 0 ? { timeoutMs: Number(command.timeout_ms) } : {}),
      });
    } else if (command.op === "collaboration.cancel-wait") {
      requireVisibleNativeSessions(command, command.native_session_id);
      const session = mappedHarnessSession(command.native_session_id);
      if (!session) throw new Error("取消等待需要已映射的 Viniper Harness 会话");
      data = { changed: await application.services.coordination.cancelWait(session.id, String(command.wait_id || "") || undefined) };
    } else if (command.op === "collaboration.mark-read") {
      requireVisibleNativeSessions(command, command.native_session_id);
      const session = mappedHarnessSession(command.native_session_id);
      if (!session) throw new Error("读取结果需要已映射的 Viniper Harness 会话");
      const envelope = await application.services.coordination.readEnvelope(session.id, String(command.envelope_id || ""));
      data = { changed: Boolean(envelope), envelope: envelope ? sanitize(envelope) : null };
    } else if (command.op === "subagent.spawn") {
      requireVisibleNativeSessions(command, command.parent_native_session_id, command.target_native_session_id);
      const parent = mappedHarnessSession(command.parent_native_session_id);
      const target = mappedHarnessSession(command.target_native_session_id);
      if (!parent || !target) throw new Error("子 Agent 需要已映射的父会话和目标会话");
      const receipt = await application.spawnSubagent({
        parentSessionId: parent.id,
        targetSessionId: target.id,
        prompt: String(command.prompt || ""),
        permissionMode: String(command.permission_mode || parent.permissionMode || "default"),
      });
      data = { accepted: true, id: String(receipt?.id || ""), status: String(receipt?.status || "running") };
    } else if (command.op === "subagent.cancel") {
      data = { changed: await application.cancelSubagent(String(command.id || "")) };
    } else {
      throw new Error(`unsupported control operation: ${command.op}`);
    }
    writeLine({ type: "control.response", request_id: requestId, ok: true, data });
  } catch (error) {
    writeLine({ type: "control.response", request_id: requestId, ok: false, error: String(error?.message || error) });
  }
}

async function bootstrap() {
  await fsp.mkdir(runtimeRoot, { recursive: true });
  await loadSessionMap();
  const bundle = await createHarnessApplication({
    dataRoot: runtimeRoot,
    assetsRoot,
    workingDirectory: process.env.VINIPER_HARNESS_WORKDIR || process.cwd(),
    secretVault,
    approvalHostMode: "automatic",
    previewFullAccessDefaults: true,
    externalScheduleDispatch: true,
    maxConcurrentRuns: 3,
    ...(reviewProviderLimit ? { providerRequestLimits: { review: reviewProviderLimit } } : {}),
    claudeCode: { enabled: false },
    allowExternalNetwork,
  });
  application = bundle.application;
  runtime = bundle.runtime;
  services = bundle;
  writeLine({
    type: "bridge.ready",
    engine: "harness-runtime",
    contract: "harness-application-port.v2",
    allow_external_network: Boolean(application.services?.providerSettings?.allowExternalNetwork),
    provider_mode: demoFixtureEnabled ? "demo-fixture" : "configured-provider",
  });
}

async function main() {
  await bootstrap();
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    let command;
    try { command = JSON.parse(line); } catch { return; }
    if (!command || typeof command !== "object") return;
    if (command.op === "cancel") {
      const owned = activeRuns.get(String(command.native_session_id || ""));
      if (owned?.harnessSessionId) void runtime.cancel(owned.harnessSessionId);
      return;
    }
    if (command.op === "run") {
      void run(command).catch((error) => {
        const nativeSessionId = String(command.native_session_id || "");
        activeRuns.delete(nativeSessionId);
        writeLine({ type: "runtime.failed", engine: "harness-runtime", contract: "harness-application-port.v2", native_session_id: nativeSessionId, message: String(error?.message || error) });
      });
      return;
    }
    if (["capabilities.snapshot", "plugins.snapshot", "subagent.spawn", "sessions.snapshot", "sessions.ensure", "sessions.delete", "harness.snapshot", "harness.operation", "permissions.snapshot", "permission.resolve"].includes(command.op) || /^(collaboration|scheduler|goals)\./.test(String(command.op || "")) || command.op === "run.steer") {
      void handleControl(command);
    }
  });
  await new Promise((resolve) => rl.once("close", resolve));
  await application?.dispose?.();
}

void main().catch((error) => {
  writeLine({ type: "bridge.failed", engine: "harness-runtime", message: String(error?.message || error) });
  process.exitCode = 1;
});
