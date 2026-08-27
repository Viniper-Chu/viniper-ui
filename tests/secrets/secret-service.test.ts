import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { SecretReferencePersistence, SecretVault } from "../../src/core/ports";
import { SecretReference } from "../../src/core/security-contracts";
import { SecretService } from "../../src/features/secrets/secret-service";

class FakeVault implements SecretVault {
  values = new Map<string, string>();
  constructor(public available: boolean) {}
  isEncryptionAvailable() { return this.available; }
  async setSecret(id: string, value: string) { this.values.set(id, value); }
  async readSecret(id: string) { return this.values.get(id) ?? null; }
  async deleteSecret(id: string) { this.values.delete(id); }
  async isConfigured(id: string) { return this.values.has(id); }
}

class MemoryReferences implements SecretReferencePersistence {
  references: SecretReference[] = [];
  async loadSecretReferences() { return structuredClone(this.references); }
  async saveSecretReferences(references: SecretReference[]) { this.references = structuredClone(references); }
}

test("secret snapshots and persisted references never expose plaintext", async () => {
  const vault = new FakeVault(true);
  const persistence = new MemoryReferences();
  const service = new SecretService(vault, persistence, () => 123);
  await service.initialize();
  const secret = "local-secret-fixture";
  const result = await service.setSecret("provider.deepseek", secret);
  assert.equal(result.configured, true);
  assert.equal(await service.readForProvider("provider.deepseek"), secret);
  assert.equal(JSON.stringify(service.snapshot()).includes(secret), false);
  assert.equal(JSON.stringify(persistence.references).includes(secret), false);
  assert.deepEqual(service.snapshot().references, [{ id: "provider.deepseek", configured: true, updatedAt: 123 }]);
  await service.deleteSecret("provider.deepseek");
  assert.equal(vault.values.size, 0);
});

test("unavailable safe storage fails closed without accepting a secret", async () => {
  const vault = new FakeVault(false);
  const persistence = new MemoryReferences();
  persistence.references = [{ id: "provider.deepseek", configured: true, updatedAt: 100 }];
  const service = new SecretService(vault, persistence);
  await service.initialize();
  assert.equal(service.isConfigured("provider.deepseek"), false);
  assert.equal(service.snapshot().references[0]?.configured, false);
  const result = await service.setSecret("provider.deepseek", "unavailable-fixture");
  assert.equal(result.configured, false);
  assert.match(result.message, /不可用/u);
  assert.equal(vault.values.size, 0);
});

test("desktop secret boundary exposes async safeStorage but no plaintext read IPC", async () => {
  const vaultSource = await readFile(join(process.cwd(), "src", "platform", "security", "safe-storage-secret-vault.ts"), "utf8");
  const apiSource = await readFile(join(process.cwd(), "src", "platform", "desktop", "api-contract.ts"), "utf8");
  const preloadSource = await readFile(join(process.cwd(), "src", "platform", "desktop", "preload.ts"), "utf8");
  const mainSource = await readFile(join(process.cwd(), "src", "platform", "desktop", "main.ts"), "utf8");
  assert.match(vaultSource, /encryptStringAsync/u);
  assert.match(vaultSource, /decryptStringAsync/u);
  assert.match(mainSource, /app\.setPath\("userData", workstationCompatibilityDataRoot\)/u);
  assert.match(mainSource, /join\(dataRoot, "secrets\.enc\.json"\)/u);
  assert.doesNotMatch(apiSource, /readSecret|getSecret|secretValue/u);
  assert.doesNotMatch(preloadSource, /readSecret|getSecret|secretValue/u);
});
