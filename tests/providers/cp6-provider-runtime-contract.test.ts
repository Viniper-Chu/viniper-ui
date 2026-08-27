import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { SecretVault } from "../../src/core/ports";
import { ProviderProfileCatalog } from "../../src/features/providers/provider-profile-catalog";
import { ProviderRegistry } from "../../src/features/providers/provider-registry";
import { ProviderSettingsService } from "../../src/features/providers/provider-settings-service";
import { SecretService } from "../../src/features/secrets/secret-service";
import { FileStore } from "../../src/platform/persistence/file-store";

test("CP6 model catalog refresh preserves the last good list on failure and records removals", async () => {
  let request = 0;
  await withProviderFixture(async ({ service, registry }) => {
    await service.setEndpoint("deepseek", "http://127.0.0.1:47831/v1/chat/completions");
    await service.saveSecret("deepseek", "api-key", "fixture-secret");

    const first = await service.refreshModelCatalog("deepseek");
    assert.equal(first.status, "current");
    assert.deepEqual(first.models, ["fixture-v4-flash", "fixture-v4-pro"]);
    assert.equal(registry.list().some((provider) => provider.id === "deepseek"), true);

    const failed = await service.refreshModelCatalog("deepseek");
    assert.equal(failed.status, "failed");
    assert.deepEqual(service.snapshot().profiles.deepseek.models, ["fixture-v4-flash", "fixture-v4-pro"]);
    assert.equal(registry.list().some((provider) => provider.id === "deepseek"), true);

    const third = await service.refreshModelCatalog("deepseek");
    assert.equal(third.status, "changed");
    assert.deepEqual(third.models, ["fixture-v4-pro"]);
    assert.deepEqual(third.removedModelIds, ["fixture-v4-flash"]);
  }, (async () => {
    request += 1;
    if (request === 2) throw new Error("fixture catalog unavailable");
    const models = request === 1 ? ["fixture-v4-flash", "fixture-v4-pro"] : ["fixture-v4-pro"];
    return new Response(JSON.stringify({ data: models.map((id) => ({ id })) }), { status: 200 });
  }) as typeof fetch);
});

test("CP6 provider network and Gemini server-state settings are secret-free and fail closed", async () => {
  await withProviderFixture(async ({ service }) => {
    const initial = service.catalogSnapshot().profiles.find((item) => item.profile.id === "gemini")!;
    assert.equal(initial.configuration.geminiServerState?.enabled, false);
    assert.equal(initial.configuration.geminiServerState?.localHistoryAuthoritative, true);

    assert.equal(await service.setNetworkSettings("deepseek", {
      mode: "profile",
      proxyUrl: "http://127.0.0.1:47832",
      proxyCredentialRef: "vault.proxy.deepseek",
      customCaRef: "vault.ca.deepseek",
      tlsVerification: "required",
    }), true);
    assert.equal(await service.setNetworkSettings("deepseek", {
      mode: "profile",
      tlsVerification: "disabled",
    } as never), false);
    const settingsText = JSON.stringify({ settings: service.snapshot(), catalog: service.catalogSnapshot() });
    assert.equal(settingsText.includes("proxy-plaintext"), false);
    assert.equal(settingsText.includes("certificate-plaintext"), false);
    assert.match(settingsText, /"tlsVerification":"required"/u);

    assert.equal(await service.setGeminiServerState("gemini", { enabled: true }), false);
    assert.equal(await service.setGeminiServerState("gemini", {
      enabled: true,
      boundary: {
        save: "当前本地 fake 端点声明保存交互状态。",
        retention: "fixture 仅在本地内存保留。",
        delete: "本地 fake 端点提供显式删除确认。",
      },
    }), true);
    assert.equal(service.snapshot().profiles.gemini.geminiServerState?.enabled, true);
    assert.equal(await service.setGeminiServerState("gemini", { enabled: false }), true);
    assert.equal(service.snapshot().profiles.gemini.geminiServerState?.remoteDeleteOnDisable, false);
  });
});

async function withProviderFixture(
  run: (fixture: { service: ProviderSettingsService; registry: ProviderRegistry }) => Promise<void>,
  fetchImpl?: typeof fetch,
): Promise<void> {
  const outputRoot = join(process.cwd(), "codex", "运行残留");
  await mkdir(outputRoot, { recursive: true });
  const root = await mkdtemp(join(outputRoot, "cp6-provider-contract-"));
  try {
    const store = new FileStore(root);
    const vault = new MemoryVault();
    const secrets = new SecretService(vault, store, () => 100);
    await secrets.initialize();
    const registry = new ProviderRegistry(1);
    const service = new ProviderSettingsService(store, secrets, registry, new ProviderProfileCatalog(), () => 100, fetchImpl);
    await service.initialize();
    await run({ service, registry });
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
