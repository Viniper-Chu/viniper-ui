import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const load = () => Function("url", "return import(url)")(pathToFileURL(join(process.cwd(), "scripts/lib/macos-signing.mjs")).href);

test("Mac signing retains timeout cause even when codesign printed signature replacement progress", async () => {
  const source = await readFile("scripts/lib/macos-signing.mjs", "utf8");
  const start = source.indexOf("function codesign(args)");
  const end = source.indexOf("\nexport function designatedRequirement", start);
  const invoke = runInNewContext(`${source.slice(start, end)}; codesign`, {
    spawnSync: () => ({ status: null, signal: "SIGTERM", error: { code: "ETIMEDOUT" },
      stdout: "", stderr: "candidate.app: replacing existing signature" }),
  });
  assert.throws(() => invoke([]), /ETIMEDOUT.*replacing existing signature/u);
});

test("Mac signing recognizes the installed implicit ad-hoc requirement without treating it as stable", async () => {
  const { parseDesignatedRequirement, isStableRequirement } = await load();
  const old = parseDesignatedRequirement('Executable=/Applications/Viniper workstation.app\n# designated => cdhash H"0123456789abcdef"\n');
  assert.equal(isStableRequirement(old), false);
  const stable = 'identifier "com.viniper.workstation" and certificate leaf = H"0123456789abcdef"';
  assert.equal(parseDesignatedRequirement(`# designated => ${stable}\n`), stable);
  assert.equal(parseDesignatedRequirement(`designated => ${stable}\n`), stable);
  assert.equal(isStableRequirement(stable), true);
});

test("normal Mac packaging requires a persistent signing identity and cannot silently fall back to ad-hoc", async () => {
  const { loadMacSigningConfiguration } = await load();
  const maintenance = join(process.cwd(), "codex/运行残留");
  await mkdir(maintenance, { recursive: true });
  const root = await mkdtemp(join(maintenance, "signing-config-"));
  const config = join(root, "identity.json");
  try {
    await assert.rejects(loadMacSigningConfiguration({}, config), /固定签名/u);
    await writeFile(config, JSON.stringify({ identity: "-" }));
    await assert.rejects(loadMacSigningConfiguration({}, config), /固定签名/u);
    await writeFile(config, JSON.stringify({ identity: "Persistent local identity", keychain: "/fixture/login.keychain-db" }));
    assert.deepEqual(await loadMacSigningConfiguration({}, config), {
      identity: "Persistent local identity", keychain: "/fixture/login.keychain-db",
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Mac signing orders nested executables before their bundles and skips aliases and ordinary resources", async () => {
  const { macSigningTargets } = await load();
  const root = await mkdtemp(join(process.cwd(), "codex/运行残留/signing-order-"));
  const app = join(root, "Example.app");
  const framework = join(app, "Contents/Frameworks/Example.framework");
  const binary = join(framework, "Versions/A/Example");
  try {
    await mkdir(join(framework, "Versions/A"), { recursive: true });
    await writeFile(binary, Buffer.from([0xcf, 0xfa, 0xed, 0xfe]));
    await writeFile(join(framework, "license.txt"), "ordinary resource");
    await symlink("A", join(framework, "Versions/Current"));
    assert.deepEqual(macSigningTargets(app), [binary, framework, app]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
