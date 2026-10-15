import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

test("an unconfigured desktop starts without querying Keychain, while stored credentials still require it", async () => {
  const main = await readFile(resolve("resources/viniper-ui/desktop/main.js"), "utf8");
  const start = main.indexOf("async function readSecureSecret(ref)");
  const end = main.indexOf("\nfunction secretRefForMode", start);
  assert.ok(start >= 0 && end > start);
  const probeStart = main.indexOf("async function secureStorageAvailable()");
  const probeEnd = main.indexOf("\nasync function decryptSafeValue", probeStart);
  assert.ok(probeStart >= 0 && probeEnd > probeStart);
  let records: Record<string, string> = {};
  let keychainQueries = 0;
  let decryptions = 0;
  let available = true;
  const readSecret = runInNewContext(`${main.slice(probeStart, probeEnd)}\n${main.slice(start, end)}; readSecureSecret`, {
    secureVaultPath: () => "fixture.enc.json",
    readEncryptedRecords: () => records,
    migrateSecureVault: async () => {},
    nativeCredentialVault: null,
    safeStorage: { isAsyncEncryptionAvailable: async () => { keychainQueries++; return available; },
      isEncryptionAvailable: () => { throw new Error("synchronous Keychain access is forbidden"); } },
    decryptSafeValue: async () => { decryptions++; return "fixture-secret"; },
  }) as (ref: string) => Promise<string | null>;
  assert.equal(await readSecret("viniper"), null);
  assert.equal(keychainQueries, 0);
  records = { viniper: "encrypted-fixture" };
  assert.equal(await readSecret("viniper"), "fixture-secret");
  assert.equal(keychainQueries, 1);
  assert.equal(decryptions, 1);
  available = false;
  assert.equal(await readSecret("viniper"), null);
  assert.equal(decryptions, 1);
});
