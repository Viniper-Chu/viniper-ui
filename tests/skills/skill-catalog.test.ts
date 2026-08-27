import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { LoadedSkill, PersistedExtensionMetadata, SkillMetadata } from "../../src/core/extension-contracts";
import { ExtensionPersistence, SkillSource } from "../../src/core/ports";
import { ProviderRegistry } from "../../src/features/providers/provider-registry";
import { AgentRuntime } from "../../src/features/runs/agent-runtime";
import { SkillCatalog } from "../../src/features/skills/skill-catalog";
import { TokenLedger } from "../../src/features/telemetry/token-ledger";
import { ToolRegistry } from "../../src/features/tools/tool-registry";
import { FileStore } from "../../src/platform/persistence/file-store";
import { waitFor } from "../runs/runtime-fixture";

class FakeSkillSource implements SkillSource {
  metadataReads = 0;
  bodyReads = 0;
  readonly metadata: SkillMetadata = { id: "brief", name: "安静任务简报", description: "先结论", source: "built-in", packagePath: "skills/brief/SKILL.md" };
  async listMetadata() { this.metadataReads += 1; return [{ ...this.metadata }]; }
  async load(id: string): Promise<LoadedSkill> {
    assert.equal(id, "brief");
    this.bodyReads += 1;
    return { ...this.metadata, body: "DEMO_SKILL_PROOF: LOADED" };
  }
}

class MemoryExtensionStore implements ExtensionPersistence {
  value: PersistedExtensionMetadata = { enabledSkillsBySession: {} };
  async loadExtensionMetadata() { return structuredClone(this.value); }
  async saveExtensionMetadata(metadata: PersistedExtensionMetadata) { this.value = structuredClone(metadata); }
}

test("Skill metadata loads at discovery and full body loads only for an enabled run", async () => {
  const outputRoot = join(process.cwd(), "codex", "运行残留");
  await mkdir(outputRoot, { recursive: true });
  const root = await mkdtemp(join(outputRoot, "skills-test-"));
  let runtime: AgentRuntime | undefined;
  try {
    const source = new FakeSkillSource();
    const store = new FileStore(root);
    const extensionStore = new MemoryExtensionStore();
    const telemetry = new TokenLedger(store);
    await telemetry.initialize();
    const catalog = new SkillCatalog(source, extensionStore, (sessionId) => runtime?.isRunning(sessionId) ?? false);
    await catalog.initialize();
    const activeRuntime = new AgentRuntime({ persistence: store, defaultWorkingDirectory: "D:\\Agent", registry: new ProviderRegistry(20), toolRegistry: new ToolRegistry(), tokenLedger: telemetry, skillLoader: catalog });
    runtime = activeRuntime;
    await activeRuntime.initialize();
    const session = activeRuntime.snapshot().sessions[0];

    assert.equal(source.metadataReads, 1);
    assert.equal(source.bodyReads, 0);
    await activeRuntime.send({ sessionId: session.id, text: "未启用", attachments: [], selectedModel: session.selectedModel, permissionMode: session.permissionMode });
    await waitFor(() => !activeRuntime.isRunning(session.id));
    assert.equal(source.bodyReads, 0);
    assert.doesNotMatch(activeRuntime.getSession(session.id)?.messages.at(-1)?.text ?? "", /已按需加载 Skill/u);

    assert.equal(await catalog.setEnabled(session.id, "brief", true), true);
    assert.equal(await activeRuntime.bumpContextProfile(session.id), true);
    await activeRuntime.send({ sessionId: session.id, text: "已启用", attachments: [], selectedModel: session.selectedModel, permissionMode: session.permissionMode });
    await waitFor(() => !activeRuntime.isRunning(session.id));
    assert.equal(source.bodyReads, 1);
    assert.match(activeRuntime.getSession(session.id)?.messages.at(-1)?.text ?? "", /已按需加载 Skill：安静任务简报/u);

    await activeRuntime.send({ sessionId: session.id, text: "运行中冻结", attachments: [], selectedModel: session.selectedModel, permissionMode: session.permissionMode });
    await waitFor(() => activeRuntime.isRunning(session.id));
    assert.equal(await catalog.setEnabled(session.id, "brief", false), false);
    await activeRuntime.cancel(session.id);
    await waitFor(() => !activeRuntime.isRunning(session.id));
  } finally {
    await runtime?.flushPersistence();
    await rm(root, { recursive: true, force: true });
  }
});
