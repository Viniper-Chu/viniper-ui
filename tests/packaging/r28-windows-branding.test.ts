import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const root = process.cwd();
const desktopRoot = join(root, "resources", "viniper-ui", "desktop");
const lanes = ["stable", "preview"];
const peFixtureRoot = join(root, "codex", "运行残留", "windows-resource-fixture");
const peExecutable = process.env.VINIPER_WINDOWS_EXE_FIXTURE || (process.platform === "win32"
  ? join(root, "node_modules", "electron", "dist", "electron.exe") : join(peFixtureRoot, "electron.exe"));

async function brandingFunction(lane: string, reader = readFile, requireFactory = createRequire) {
  const source = await readFile(join(root, "scripts", `package-windows-${lane}.mjs`), "utf8");
  const start = source.lastIndexOf("async function brandWindowsExecutable(");
  assert.ok(start > 0, "packaging must explicitly brand a prepackaged executable");
  return runInNewContext(`${source.slice(start)}; brandWindowsExecutable`, {
    createRequire: requireFactory, readFile: reader, writeFile, Buffer, join, repositoryRoot: root, desktopRoot,
  }) as (executable: string, version: string) => Promise<void>;
}

test("R28 both Windows lanes brand the shared stage before portable and NSIS", async () => {
  for (const lane of lanes) {
    const source = await readFile(join(root, "scripts", `package-windows-${lane}.mjs`), "utf8");
    const branding = source.indexOf('brandWindowsExecutable(join(stagePortable, "Viniper workstation.exe"), sourcePackage.version)');
    assert.ok(branding > source.indexOf('await rename(join(stagePortable, "electron.exe")'));
    assert.ok(branding < source.indexOf("await cp(stagePortable, finalPortable"));
    assert.ok(branding < source.indexOf('"--prepackaged", stagePortable'));
    assert.match(source, /signAndEditExecutable: true/u);
  }
});

test("R28 resource-editor errors abort packaging instead of delivering Electron branding", async () => {
  for (const lane of lanes) {
    // This test covers failure propagation, independent of a Windows-only
    // packager being installed on the machine running the test suite.
    const stubRequire = (() => () => ({ NtExecutable: {}, NtExecutableResource: {}, Resource: {}, Data: {} })) as unknown as typeof createRequire;
    const brand = await brandingFunction(lane, (async () => { throw new Error("editor read failed"); }) as typeof readFile, stubRequire);
    await assert.rejects(() => brand("candidate.exe", "1.8.0"), /editor read failed/u);
  }
});

test("R28 real Windows PE file metadata and icon bytes match the existing brand (resource inspection, no EXE execution)", {
  skip: !existsSync(peExecutable) && "Prepare the official Windows PE fixture with node scripts/prepare-windows-resource-test.mjs",
}, async (t) => {
  const require = createRequire(join(process.platform === "win32" ? desktopRoot : peFixtureRoot, "package.json"));
  const { NtExecutable, NtExecutableResource, Resource, Data } = require("resedit");
  const residue = join(root, "codex", "运行残留");
  await mkdir(residue, { recursive: true });
  const version = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
  const icon = Data.IconFile.from(await readFile(join(root, "assets", "branding", "viniper-harness-circuit-node.ico")));
  const imageBytes = (data: { bin?: ArrayBuffer; generate?: () => ArrayBuffer }) => Buffer.from(data.bin ?? data.generate!());
  const iconBytes = icon.icons.map((item: { data: Parameters<typeof imageBytes>[0] }) => imageBytes(item.data));
  const candidate = await mkdtemp(join(residue, "r28-branding-"));
  const executable = join(candidate, "Viniper workstation.exe");
  const evidence: unknown[] = [];
  try {
    for (const lane of lanes) {
      await copyFile(peExecutable, executable);
      const brand = await brandingFunction(lane, readFile, (() => require) as typeof createRequire);
      await brand(executable, version);
      const entries = NtExecutableResource.from(NtExecutable.from(await readFile(executable))).entries;
      const versions = Resource.VersionInfo.fromEntries(entries);
      assert.equal(versions.length, 1);
      const strings = versions[0].getStringValues(versions[0].getAvailableLanguages()[0]);
      assert.equal(strings.ProductName, "Viniper workstation");
      assert.equal(strings.FileDescription, "Viniper workstation");
      assert.equal(strings.CompanyName, "Viniper");
      assert.equal(strings.OriginalFilename, "Viniper workstation.exe");
      assert.ok(strings.FileVersion.startsWith(version));
      assert.ok(strings.ProductVersion.startsWith(version));
      const groups = Resource.IconGroupEntry.fromEntries(entries);
      const firstIcon = groups[0].getIconItemsFromEntries(entries);
      assert.equal(firstIcon.length, iconBytes.length);
      for (let i = 0; i < iconBytes.length; i += 1) {
        assert.ok(imageBytes(firstIcon[i]).equals(iconBytes[i]), `native icon frame ${i} must be the unchanged source ICO`);
      }
      evidence.push({ lane, product: strings.ProductName, version: strings.ProductVersion, iconFrames: firstIcon.length, sourceIconBytesEqual: true });
    }
    const evidenceRoot = join(root, "codex", "工作输出", "cross-platform-skipped-validation");
    await mkdir(evidenceRoot, { recursive: true });
    await writeFile(join(evidenceRoot, "windows-pe-resource-branding.json"), `${JSON.stringify({ passed: true, hostPlatform: process.platform, executableExecuted: false, fixture: peExecutable, evidence }, null, 2)}\n`);
    t.diagnostic(`Real Windows PE resources validated on ${process.platform}; Windows startup/Explorer/NSIS were not exercised`);
  } finally {
    assert.equal(resolve(dirname(candidate)), resolve(residue));
    await rm(candidate, { recursive: true, force: true });
  }
});
