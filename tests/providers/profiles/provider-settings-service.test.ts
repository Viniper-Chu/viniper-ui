import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { SecretVault } from "../../../src/core/ports";
import { ProviderProfileCatalog, providerSecretId } from "../../../src/features/providers/provider-profile-catalog";
import { ProviderRegistry } from "../../../src/features/providers/provider-registry";
import { ProviderSettingsService } from "../../../src/features/providers/provider-settings-service";
import { SecretService } from "../../../src/features/secrets/secret-service";
import { FileStore } from "../../../src/platform/persistence/file-store";

test("per-profile settings expose configured state but never plaintext, and TeleChat requires all secret fields", async () => {
  await withSettingsFixture(async ({ service, secrets }) => {
    assert.equal(service.catalogSnapshot().profiles.length, 28);
    await service.setEndpoint("ctyun-telechat", "https://local.invalid/telechat/completions115");
    await service.setManualModel("ctyun-telechat", "telechat-fixture");
    await service.saveSecret("ctyun-telechat", "app-id", "fixture-app-value");
    await service.saveSecret("ctyun-telechat", "order-num", "fixture-order-value");
    let state = service.catalogSnapshot().profiles.find((item) => item.profile.id === "ctyun-telechat")!;
    assert.equal(state.credentialsReady, false);
    assert.equal(state.selectable, false);
    await service.saveSecret("ctyun-telechat", "api-key", "fixture-api-value");
    state = service.catalogSnapshot().profiles.find((item) => item.profile.id === "ctyun-telechat")!;
    assert.equal(state.credentialsReady, true);
    assert.equal(state.selectable, true);
    const snapshotText = JSON.stringify({ catalog: service.catalogSnapshot(), settings: service.snapshot(), secrets: secrets.snapshot() });
    assert.equal(snapshotText.includes("fixture-app-value"), false);
    assert.equal(snapshotText.includes("fixture-order-value"), false);
    assert.equal(snapshotText.includes("fixture-api-value"), false);
    await assert.rejects(service.saveSecret("ctyun-telechat", "unknown", "fixture"), /未声明/u);
  });
});

test("model discovery uses one local non-generation request and makes only the configured profile selectable", async () => {
  let requestCount = 0;
  let requestedUrl = "";
  await withSettingsFixture(async ({ service, registry }) => {
    await service.setEndpoint("deepseek", "http://127.0.0.1:47831/v1/chat/completions");
    await service.saveSecret("deepseek", "api-key", "fixture-deepseek-value");
    const result = await service.testConnection("deepseek");
    assert.deepEqual(result, { connected: true, models: ["local-model-a"], message: "已读取 1 个模型；未发起生成。" });
    assert.equal(requestCount, 1);
    assert.match(requestedUrl, /^http:\/\/127\.0\.0\.1:47831\/v1\/models/u);
    assert.equal(registry.list().find((provider) => provider.id === "deepseek")?.available, true);
    assert.equal(registry.list().filter((provider) => provider.id !== "demo" && provider.available).length, 1);
  }, (async (input: string | URL | Request) => {
    requestCount += 1;
    requestedUrl = String(input);
    return new Response(JSON.stringify({ data: [{ id: "local-model-a" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch);
});

test("legacy DeepSeek settings migrate into schema v2 without moving its existing secret id", async () => {
  await withSettingsFixture(async ({ service, store }) => {
    await store.saveProviderSettings({
      schemaVersion: 2,
      profiles: service.snapshot().profiles,
    });
    assert.equal(service.snapshot().schemaVersion, 2);
    assert.equal(service.snapshot().profiles.deepseek.endpoint, "https://api.deepseek.com/chat/completions");
    assert.equal(service.snapshot().profiles.deepseek.selectedModel, "deepseek-chat");
    assert.equal(providerSecretId("deepseek", "api-key"), "provider.deepseek");
  }, undefined, {
    deepseekBaseUrl: "https://api.deepseek.com",
    deepseekModels: ["deepseek-chat"],
    deepseekConnectionState: "connected",
    deepseekMessage: "旧设置",
  });
});

async function withSettingsFixture(
  run: (fixture: { service: ProviderSettingsService; secrets: SecretService; registry: ProviderRegistry; store: FileStore }) => Promise<void>,
  fetchImpl?: typeof fetch,
  legacy?: {
    deepseekBaseUrl: string;
    deepseekModels: string[];
    deepseekConnectionState: "connected";
    deepseekMessage: string;
  },
): Promise<void> {
  const outputRoot = join(process.cwd(), "codex", "运行残留");
  await mkdir(outputRoot, { recursive: true });
  const root = await mkdtemp(join(outputRoot, "provider-settings-test-"));
  try {
    const store = new FileStore(root);
    if (legacy) {
      await writeFile(store.providerSettingsPath, JSON.stringify(legacy), "utf8");
    }
    const vault = new MemoryVault();
    if (legacy) await vault.setSecret("provider.deepseek", "fixture-legacy-value");
    const secrets = new SecretService(vault, store, () => 100);
    await secrets.initialize();
    const registry = new ProviderRegistry(1);
    const service = new ProviderSettingsService(store, secrets, registry, new ProviderProfileCatalog(), () => 100, fetchImpl);
    await service.initialize();
    await run({ service, secrets, registry, store });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

class MemoryVault implements SecretVault {
  private readonly values = new Map<string, string>();
  isEncryptionAvailable(): boolean { return true; }
  async setSecret(id: string, value: string): Promise<void> { this.values.set(id, value); }
  async readSecret(id: string): Promise<string | null> { return this.values.get(id) ?? null; }
  async deleteSecret(id: string): Promise<void> { this.values.delete(id); }
  async isConfigured(id: string): Promise<boolean> { return this.values.has(id); }
}
