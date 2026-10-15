import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

const main = readFileSync("resources/viniper-ui/desktop/main.js", "utf8");
const start = main.indexOf("function readEncryptedRecords(");
const end = main.indexOf("\nasync function startSecretBroker(", start);
assert.ok(start >= 0 && end > start);
const refs = { viniper: "provider.deepseek", claude: "provider.anthropic.api-key" };
const target = "/fixture/current/secrets.enc.json";
const legacy = "/fixture/legacy/secrets.enc.json";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture(overrides: Record<string, any> = {}, nativeCredentialVault: any = null) {
  const files = new Map<string, string>();
  const writes: string[] = [];
  let syncCalls = 0;
  const syncForbidden = () => { syncCalls++; throw new Error("sync Keychain must not be retried"); };
  const safeStorage: any = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async () => Buffer.from("opaque-encrypted-fixture"),
    decryptStringAsync: async () => ({ result: "dummy-fixture-value", shouldReEncrypt: false }),
    isEncryptionAvailable: syncForbidden, encryptString: syncForbidden, decryptString: syncForbidden,
    ...overrides,
  };
  const api: any = runInNewContext(`${main.slice(start, end)}; ({ secureStorageAvailable, decryptSafeValue, encryptSafeValue, readSecureSecret, writeSecureSecret, writeSecureSecretRef, migrateSecureVault, secureSecretMetadata })`, {
    Buffer, path, Object, String, Error, SECRET_REFS_BY_MODE: refs, safeStorage, nativeCredentialVault,
    secureVaultPath: () => target, legacySecureVaultPath: () => legacy,
    app: { getPath: () => "/fixture/current" },
    fs: {
      existsSync: (name: string) => files.has(name),
      readFileSync: (name: string) => { if (!files.has(name)) throw new Error("ENOENT"); return files.get(name); },
      writeFileSync: (name: string, content: string) => { writes.push(name); files.set(name, content); },
      mkdirSync() {},
      copyFileSync: (from: string, to: string) => files.set(to, files.get(from)!),
    },
  });
  return { api, files, writes, safeStorage, syncCalls: () => syncCalls };
}

test("Keychain authorization can remain pending while the main event loop responds", async () => {
  const authorization = deferred<boolean>();
  const ctx = fixture({ isAsyncEncryptionAvailable: () => authorization.promise });
  let settled = false;
  const save = ctx.api.writeSecureSecret("viniper", "dummy-new-value").then((value: any) => { settled = true; return value; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false); assert.equal(ctx.syncCalls(), 0); assert.equal(ctx.writes.length, 0);
  authorization.resolve(true);
  assert.equal((await save).ok, true);
  const stored = ctx.files.get(target)!;
  assert.equal(stored.includes("dummy-new-value"), false);
  assert.equal(JSON.parse(stored)[refs.viniper], Buffer.from("opaque-encrypted-fixture").toString("base64"));
});

test("credential status reads stored metadata without requesting either Agent's Keychain access", async () => {
  let calls = 0;
  const ctx = fixture({ isAsyncEncryptionAvailable: () => { calls++; throw new Error("must stay locked"); } });
  ctx.files.set(target, JSON.stringify({ [refs.viniper]: "encrypted-viniper", [refs.claude]: "encrypted-claude" }));
  for (const ref of Object.values(refs)) {
    const status = ctx.api.secureSecretMetadata(ref);
    assert.equal(status.configured, true); assert.equal(status.access, "not-checked");
    await ctx.api.migrateSecureVault(ref);
  }
  assert.equal(calls, 0); assert.equal(ctx.syncCalls(), 0); assert.equal(ctx.writes.length, 0);
});

test("the broker serves status while encrypted credentials remain locked, without migration or warmup", async () => {
  let listening = false; let handler: any;
  const brokerStart = main.indexOf("async function startSecretBroker()");
  const brokerEnd = main.indexOf("\nasync function closeSecretBroker", brokerStart);
  assert.ok(brokerEnd > brokerStart);
  const startBroker = runInNewContext(`${main.slice(brokerStart, brokerEnd)}; startSecretBroker`, {
    secretBroker: null, secretBrokerToken: "", hostMigrationToken: "", hostMigrationConsumed: false,
    migrateSecureVault: () => { throw new Error("startup cannot migrate credentials"); },
    readSecureSecret: () => { throw new Error("status cannot decrypt credentials"); },
    secureSecretMetadata: () => ({ configured: true, access: "not-checked" }),
    SECRET_REFS_BY_MODE: refs, URL,
    crypto: { randomBytes: () => Buffer.from("fixture-token") }, process: { env: {} },
    http: { createServer: (callback: any) => { handler = callback; return { once() {}, removeListener() {}, listen(_port: number, _host: string, ready: () => void) { listening = true; ready(); } }; } },
  }) as () => Promise<any>;
  await startBroker(); assert.equal(listening, true);
  let response = "";
  await handler({ socket: { remoteAddress: "127.0.0.1" }, method: "GET", url: "/secret/status?mode=viniper",
    headers: { authorization: `Bearer ${Buffer.from("fixture-token").toString("hex")}` } }, {
    setHeader() {}, writeHead(status: number) { assert.equal(status, 200); }, end(text: string) { response = text; },
  });
  assert.equal(JSON.parse(response).configured, true);
  assert.equal(JSON.parse(response).access, "not-checked");
});

test("an async availability denial never falls back to synchronous Keychain or changes the vault", async () => {
  for (const probe of [async () => false, async () => { throw new Error("consent denied"); }]) {
    const ctx = fixture({ isAsyncEncryptionAvailable: probe });
    const original = JSON.stringify({ [refs.viniper]: "existing-encrypted-record", [refs.claude]: "other-encrypted-record" });
    ctx.files.set(target, original);
    const result = await ctx.api.writeSecureSecret("viniper", "dummy-replacement");
    assert.equal(result.ok, false); assert.equal(ctx.files.get(target), original);
    assert.equal(ctx.writes.length, 0); assert.equal(ctx.syncCalls(), 0);
  }
});

test("async encryption failure preserves all encrypted records and never retries synchronously", async () => {
  const ctx = fixture({ encryptStringAsync: async () => { throw new Error("authorization cancelled"); } });
  const original = JSON.stringify({ [refs.viniper]: "previous-ciphertext", [refs.claude]: "other-ciphertext" });
  ctx.files.set(target, original);
  const result = await ctx.api.writeSecureSecretRef(refs.viniper, "dummy-sensitive-value");
  assert.equal(result.ok, false); assert.equal(JSON.stringify(result).includes("dummy-sensitive-value"), false);
  assert.equal(ctx.files.get(target), original); assert.equal(ctx.writes.length, 0); assert.equal(ctx.syncCalls(), 0);
});

test("async decryption uses Electron's result object and rejects errors without a sync retry", async () => {
  const ctx = fixture({ decryptStringAsync: async () => ({ result: "dummy-decrypted", shouldReEncrypt: true }) });
  const original = JSON.stringify({ [refs.viniper]: Buffer.from("old-ciphertext").toString("base64") });
  ctx.files.set(target, original);
  assert.equal(await ctx.api.readSecureSecret(refs.viniper), "dummy-decrypted");
  ctx.safeStorage.decryptStringAsync = async () => { throw new Error("Keychain unavailable"); };
  assert.equal(await ctx.api.readSecureSecret(refs.viniper), null);
  ctx.safeStorage.decryptStringAsync = async () => ({ shouldReEncrypt: false });
  assert.equal(await ctx.api.readSecureSecret(refs.viniper), null);
  assert.equal(ctx.files.get(target), original); assert.equal(ctx.writes.length, 0); assert.equal(ctx.syncCalls(), 0);
});

test("concurrent asynchronous saves retain both Agents' encrypted records", async () => {
  const first = deferred<Buffer>(), second = deferred<Buffer>();
  const ctx = fixture({ encryptStringAsync: (value: string) => value === "dummy-first" ? first.promise : second.promise });
  const one = ctx.api.writeSecureSecretRef(refs.viniper, "dummy-first");
  const two = ctx.api.writeSecureSecretRef(refs.claude, "dummy-second");
  second.resolve(Buffer.from("cipher-second")); await two;
  first.resolve(Buffer.from("cipher-first")); await one;
  assert.deepEqual(JSON.parse(ctx.files.get(target)!), { [refs.claude]: Buffer.from("cipher-second").toString("base64"), [refs.viniper]: Buffer.from("cipher-first").toString("base64") });
  assert.equal(ctx.syncCalls(), 0);
});

test("legacy migration denial leaves source and target intact without synchronous retry", async () => {
  const ctx = fixture({ decryptStringAsync: async () => { throw new Error("legacy key denied"); } });
  const old = JSON.stringify({ [refs.viniper]: "old-encrypted-record" });
  const existing = JSON.stringify({ unrelated: "existing-encrypted-record" });
  ctx.files.set(legacy, old); ctx.files.set(target, existing);
  await ctx.api.migrateSecureVault();
  assert.equal(ctx.files.get(legacy), old); assert.equal(ctx.files.get(target), existing);
  assert.equal(ctx.files.get("/fixture/current/migration-backups/secrets.enc.json.source"), old);
  assert.equal(ctx.writes.length, 0); assert.equal(ctx.syncCalls(), 0);
});

test("synchronous compatibility is used only when the corresponding async APIs do not exist", async () => {
  let calls = 0;
  const ctx = fixture({ isAsyncEncryptionAvailable: undefined, encryptStringAsync: undefined, decryptStringAsync: undefined,
    isEncryptionAvailable: () => { calls++; return true; },
    encryptString: () => { calls++; return Buffer.from("legacy-encrypted-fixture"); },
    decryptString: () => { calls++; return "dummy-legacy-value"; },
  });
  assert.equal((await ctx.api.writeSecureSecret("viniper", "dummy-legacy-value")).ok, true);
  assert.equal(await ctx.api.readSecureSecret(refs.viniper), "dummy-legacy-value");
  assert.equal(calls, 4);
});

test("native credentials round-trip without accessing Electron Keychain", async () => {
  const native = { available: async () => true, encrypt: async () => "vpk1:opaque", decrypt: async () => "native-fixture" };
  const ctx = fixture({ isAsyncEncryptionAvailable: async () => { throw new Error("legacy access forbidden"); } }, native);
  assert.equal((await ctx.api.writeSecureSecret("viniper", "native-fixture")).ok, true);
  assert.equal(JSON.parse(ctx.files.get(target)!)[refs.viniper], "vpk1:opaque");
  assert.equal(await ctx.api.readSecureSecret(refs.viniper), "native-fixture");
});

test("legacy credentials migrate only after successful native encryption", async () => {
  for (const succeeds of [true, false]) {
    const native = { available: async () => true, encrypt: async () => { if (!succeeds) throw new Error("denied"); return "vpk1:migrated"; } };
    const ctx = fixture({}, native);
    ctx.files.set(target, JSON.stringify({ [refs.viniper]: "legacy-opaque", [refs.claude]: "other-opaque" }));
    assert.equal(await ctx.api.readSecureSecret(refs.viniper), "dummy-fixture-value");
    const stored = JSON.parse(ctx.files.get(target)!);
    assert.equal(stored[refs.viniper], succeeds ? "vpk1:migrated" : "legacy-opaque");
    assert.equal(stored[refs.claude], "other-opaque");
  }
});

test("legacy migration preserves a newer save while authorization is pending", async () => {
  const encryption = deferred<string>();
  const ctx = fixture({}, { available: async () => true, encrypt: () => encryption.promise });
  ctx.files.set(target, JSON.stringify({ [refs.viniper]: "legacy-opaque" }));
  const reading = ctx.api.readSecureSecret(refs.viniper);
  await new Promise<void>(resolve => setImmediate(resolve));
  ctx.files.set(target, JSON.stringify({ [refs.viniper]: "vpk1:newer-save" }));
  encryption.resolve("vpk1:older-migration");
  assert.equal(await reading, "dummy-fixture-value");
  assert.equal(JSON.parse(ctx.files.get(target)!)[refs.viniper], "vpk1:newer-save");
});
