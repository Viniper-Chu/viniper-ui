import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { ExtensionPersistence } from "../../src/core/ports";
import { ExtensionPackageManager, assertLoopbackOnly } from "../../src/features/extensions/extension-package-manager";
import { ExtensionManager } from "../../src/features/extensions/extension-manager";
import { ManagedPluginProcessHost } from "../../src/platform/process/managed-plugin-process";
import { PersistedExtensionMetadata } from "../../src/core/extension-contracts";
import { ToolRegistry } from "../../src/features/tools/tool-registry";

class MemoryExtensionPersistence implements ExtensionPersistence {
  value: PersistedExtensionMetadata = { enabledSkillsBySession: {} };

  async loadExtensionMetadata(): Promise<PersistedExtensionMetadata> {
    return structuredClone(this.value);
  }

  async saveExtensionMetadata(metadata: PersistedExtensionMetadata): Promise<void> {
    this.value = structuredClone(metadata);
  }
}

async function makeFixture(): Promise<{ root: string; packageRoot: string; cleanup(): Promise<void> }> {
  const root = await mkdtemp(join(process.cwd(), "codex", "运行残留", "cp5-extension-"));
  const packageRoot = join(root, "fixture-package");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "extension.json"), JSON.stringify({
    manifestVersion: 1,
    id: "fixture.echo",
    name: "Fixture Echo",
    version: "1.0.0",
    kind: "executable-plugin",
    source: "local",
    capabilities: ["tools:fixture.echo"],
    tools: ["fixture.echo"],
    entry: "index.cjs",
  }), "utf8");
  await writeFile(join(packageRoot, "index.cjs"), [
    "let input = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', chunk => input += chunk);",
    "process.stdin.on('end', () => { const request = JSON.parse(input); const payload = request.payload ?? request; process.stdout.write(JSON.stringify({ ok: true, echo: payload.text }) + '\\n'); });",
  ].join("\n"), "utf8");
  return { root, packageRoot, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("CP5 红测：受管暂存拒绝公网来源并校验本地清单", async () => {
  const fixture = await makeFixture();
  try {
    const packages = new ExtensionPackageManager({ dataRoot: fixture.root });
    assert.throws(() => assertLoopbackOnly("https://example.com/market.json"), /OUTBOUND_NETWORK_BLOCKED/u);
    await assert.rejects(
      packages.stage({ source: "community", location: "https://example.com/fixture.zip" }),
      /OUTBOUND_NETWORK_BLOCKED/u,
    );
    const staged = await packages.stage({ source: "local", location: fixture.packageRoot });
    assert.equal(staged.manifest.id, "fixture.echo");
    assert.equal(staged.source, "local");
    assert.notEqual(staged.packagePath, fixture.packageRoot);
    const marketplace = join(fixture.root, "marketplace");
    await mkdir(marketplace, { recursive: true });
    await cp(fixture.packageRoot, join(marketplace, "fixture-echo"), { recursive: true });
    const checked = await packages.inspectMarketplaceDirectory({ source: "marketplace-fixture", directory: marketplace });
    assert.deepEqual(checked.map((item) => item.manifest.id), ["fixture.echo"]);
    const marketStage = await packages.stageMarketplacePackage({ source: "marketplace-fixture", directory: marketplace, packageId: "fixture.echo" });
    assert.equal(marketStage.manifest.source, "marketplace-fixture");
  } finally {
    await fixture.cleanup();
  }
});

test("CP5 红测：未信任插件不执行，更新需确认且保留 current/previous，运行快照冻结", async () => {
  const fixture = await makeFixture();
  try {
    const packages = new ExtensionPackageManager({ dataRoot: fixture.root });
    const persistence = new MemoryExtensionPersistence();
    const manager = new ExtensionManager({
      dataRoot: fixture.root,
      persistence,
      packages,
      processHost: new ManagedPluginProcessHost({ dataRoot: fixture.root }),
    });
    await manager.initialize();
    const staged = await manager.stage({ source: "local", location: fixture.packageRoot });
    await manager.install(staged.stagingId);
    assert.equal((await manager.executeTool("fixture.echo", "fixture.unknown", { text: "blocked" })).executionCount, 0);
    assert.equal((await manager.execute("fixture.echo", { text: "blocked" })).ok, false);
    assert.equal((await manager.execute("fixture.echo", { text: "blocked" })).executionCount, 0);
    await manager.trust("fixture.echo", "1.0.0");
    await manager.setEnabled("fixture.echo", true);
    const beforeUpdate = manager.beginRunSnapshot();
    const result = await manager.execute("fixture.echo", { text: "allowed" }, beforeUpdate);
    assert.deepEqual(result, { ok: true, value: { ok: true, echo: "allowed" }, executionCount: 1 });
    const updatedPackageRoot = join(fixture.root, "fixture-package-v2");
    await cp(fixture.packageRoot, updatedPackageRoot, { recursive: true });
    await writeFile(join(updatedPackageRoot, "extension.json"), JSON.stringify({
      manifestVersion: 1,
      id: "fixture.echo",
      name: "Fixture Echo",
      version: "2.0.0",
      kind: "executable-plugin",
      source: "local",
      capabilities: ["tools:fixture.new"],
      tools: ["fixture.new"],
      entry: "index.cjs",
    }), "utf8");
    const updated = await manager.stage({ source: "local", location: updatedPackageRoot });
    await manager.requestUpdate("fixture.echo", updated.stagingId);
    assert.equal((manager.snapshot().records ?? []).find((item) => item.id === "fixture.echo")?.current?.version, "1.0.0");
    await manager.confirmUpdate("fixture.echo");
    const afterUpdate = (manager.snapshot().records ?? []).find((item) => item.id === "fixture.echo");
    assert.equal(afterUpdate?.current?.version, "2.0.0");
    assert.equal(afterUpdate?.previous?.version, "1.0.0");
    assert.equal((await manager.execute("fixture.echo", { text: "frozen" }, beforeUpdate)).ok, true);
    assert.equal((await manager.executeTool("fixture.echo", "fixture.echo", { text: "old tool during update" }, beforeUpdate)).ok, true);
    assert.equal((manager.snapshot().records ?? []).find((item) => item.id === "fixture.echo")?.trust, "untrusted");
    await manager.trust("fixture.echo", "2.0.0");
    await manager.setEnabled("fixture.echo", true);
    const beforeRollback = manager.beginRunSnapshot();
    await manager.requestRollback("fixture.echo");
    assert.equal((manager.snapshot().records ?? []).find((item) => item.id === "fixture.echo")?.current?.version, "2.0.0");
    await manager.confirmRollback("fixture.echo");
    assert.equal((manager.snapshot().records ?? []).find((item) => item.id === "fixture.echo")?.current?.version, "1.0.0");
    assert.equal((await manager.executeTool("fixture.echo", "fixture.new", { text: "new tool during rollback" }, beforeRollback)).ok, true);
    const restarted = new ExtensionManager({
      dataRoot: fixture.root,
      persistence,
      packages: new ExtensionPackageManager({ dataRoot: fixture.root }),
      processHost: new ManagedPluginProcessHost({ dataRoot: fixture.root }),
    });
    await restarted.initialize();
    const restored = (restarted.snapshot().records ?? []).find((item) => item.id === "fixture.echo");
    assert.equal(restored?.current?.version, "1.0.0");
    assert.equal(restored?.previous?.version, "2.0.0");
  } finally {
    await fixture.cleanup();
  }
});

test("CP5 红测：MCP 只有显式配置且仅接受 loopback，插件崩溃不抛出到应用层", async () => {
  const fixture = await makeFixture();
  try {
    const manager = new ExtensionManager({
      dataRoot: fixture.root,
      persistence: new MemoryExtensionPersistence(),
      packages: new ExtensionPackageManager({ dataRoot: fixture.root }),
      processHost: new ManagedPluginProcessHost({ dataRoot: fixture.root }),
      mcpConnector: async (endpoint) => ({ endpoint, connected: true }),
    });
    await manager.initialize();
    await assert.rejects(() => manager.connectMcp("missing"), /MCP_NOT_CONFIGURED/u);
    await assert.rejects(
      () => manager.configureMcp({ id: "remote", endpoint: "https://example.com/mcp" }),
      /OUTBOUND_NETWORK_BLOCKED/u,
    );
    await manager.configureMcp({ id: "local", endpoint: "http://127.0.0.1:43111/mcp" });
    assert.deepEqual(await manager.connectMcp("local"), { endpoint: "http://127.0.0.1:43111/mcp", connected: true });
    const staged = await manager.stage({ source: "local", location: fixture.packageRoot });
    await manager.install(staged.stagingId);
    await manager.trust("fixture.echo", "1.0.0");
    await manager.setEnabled("fixture.echo", true);
    const record = (manager.snapshot().records ?? []).find((item) => item.id === "fixture.echo")!;
    const crash = await manager.execute("fixture.echo", { crash: true }, manager.beginRunSnapshot(), {
      entryOverride: join(fixture.root, "does-not-exist.cjs"),
    });
    assert.equal(crash.ok, false);
    assert.equal((manager.snapshot().records ?? []).find((item) => item.id === record.id)?.status, "failed");
  } finally {
    await fixture.cleanup();
  }
});

test("loopback MCP tools are projected into the host ToolRegistry and revoked on disconnect", async () => {
  const fixture = await makeFixture();
  try {
    const registry = new ToolRegistry();
    const manager = new ExtensionManager({
      dataRoot: fixture.root,
      persistence: new MemoryExtensionPersistence(),
      packages: new ExtensionPackageManager({ dataRoot: fixture.root }),
      processHost: new ManagedPluginProcessHost({ dataRoot: fixture.root }),
      toolRegistry: registry,
      mcpConnector: async () => ({
        protocolVersion: "2024-11-05",
        tools: [{ name: "fixture.lookup", description: "本地 MCP fixture", inputSchema: { type: "object", additionalProperties: true } }],
        callTool: async (name: string, args: unknown) => ({ name, args, ok: true }),
      }),
    });
    await manager.initialize();
    await manager.configureMcp({ id: "fixture", endpoint: "http://127.0.0.1:43111/mcp" });
    await manager.connectMcp("fixture");
    const name = "mcp.fixture.fixture.lookup";
    assert.equal(registry.has(name), true);
    const result = await registry.get(name).execute({
      id: "mcp-call",
      name,
      summary: "fixture",
      readOnly: false,
      scope: "computer",
      input: { query: "ok" },
    }, { sessionId: "s", runId: "r", signal: new AbortController().signal });
    assert.equal(result.isError, false);
    assert.match(result.text, /fixture\.lookup/u);
    assert.equal(await manager.disconnectMcp("fixture"), true);
    assert.equal(registry.has(name), false);
    await manager.refreshMcp("fixture");
    assert.equal(registry.has(name), true);
  } finally {
    await fixture.cleanup();
  }
});

test("v13 受管插件工具投影进入 Provider schema，并按 run 版本冻结执行", async () => {
  const fixture = await makeFixture();
  try {
    const manager = new ExtensionManager({
      dataRoot: fixture.root,
      persistence: new MemoryExtensionPersistence(),
      packages: new ExtensionPackageManager({ dataRoot: fixture.root }),
      processHost: new ManagedPluginProcessHost({ dataRoot: fixture.root }),
    });
    await manager.initialize();
    const staged = await manager.stage({ source: "local", location: fixture.packageRoot });
    await manager.install(staged.stagingId);
    const registry = new ToolRegistry();
    manager.syncToolRegistry(registry);
    assert.equal(registry.descriptors().some((tool) => tool.name === "fixture.echo"), false);
    await manager.trust("fixture.echo", "1.0.0");
    await manager.setEnabled("fixture.echo", true);
    manager.syncToolRegistry(registry);
    const descriptor = registry.descriptors().find((tool) => tool.name === "fixture.echo");
    assert.ok(descriptor);
    assert.equal(descriptor.readOnly, false);
    assert.equal(descriptor.permission, "approval-required");
    const frozen = manager.beginRunSnapshot();
    const allowed = await registry.get("fixture.echo").execute({
      id: "plugin-call-1",
      name: "fixture.echo",
      summary: "受管插件测试",
      readOnly: false,
      scope: "computer",
      input: { text: "投影成功" },
    }, {
      sessionId: "session-a",
      runId: "run-a",
      extensionSnapshot: frozen,
      signal: new AbortController().signal,
    });
    assert.equal(allowed.isError, false);
    assert.match(allowed.text, /投影成功/u);

    await manager.setEnabled("fixture.echo", false);
    manager.syncToolRegistry(registry);
    assert.equal(registry.has("fixture.echo"), true, "在途 run 仍需要稳定 wrapper");
    assert.equal(registry.descriptorsForRun(frozen).some((tool) => tool.name === "fixture.echo"), true);
    const nextSnapshot = manager.beginRunSnapshot();
    assert.equal(registry.descriptorsForRun(nextSnapshot).some((tool) => tool.name === "fixture.echo"), false);
    const oldRun = await registry.get("fixture.echo").execute({
      id: "plugin-call-2",
      name: "fixture.echo",
      summary: "旧 run",
      readOnly: false,
      scope: "computer",
      input: { text: "旧版本仍按冻结快照" },
    }, {
      sessionId: "session-a",
      runId: "run-a",
      extensionSnapshot: frozen,
      signal: new AbortController().signal,
    });
    assert.equal(oldRun.isError, false);
    const nextRun = await registry.get("fixture.echo").execute({
      id: "plugin-call-3",
      name: "fixture.echo",
      summary: "新 run",
      readOnly: false,
      scope: "computer",
      input: { text: "不应执行" },
    }, {
      sessionId: "session-a",
      runId: "run-b",
      extensionSnapshot: nextSnapshot,
      signal: new AbortController().signal,
    });
    assert.equal(nextRun.isError, true);
    assert.match(nextRun.text, /未执行/u);
  } finally {
    await fixture.cleanup();
  }
});
