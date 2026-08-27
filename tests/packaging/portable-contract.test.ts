import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

test("Windows x64 portable packaging carries the Viniper workstation branding contract", async () => {
  const root = process.cwd();
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.equal(typeof packageJson.scripts["package:portable"], "string");
  const scriptPath = join(root, "scripts", "package-portable.mjs");
  await access(scriptPath);
  const source = await readFile(scriptPath, "utf8");
  assert.match(source, /viniper-workstation-implementation-20260817/u);
  assert.match(source, /packages["',\s]+["']portable/u);
  assert.match(source, /viniper-workstation-portable-stage/u);
  assert.match(source, /const residueRoot = join\(codexRoot, ["']运行残留["']\)/u);
  assert.match(source, /win32/u);
  assert.match(source, /x64/u);
  assert.match(source, /Viniper workstation\.exe/u);
  assert.match(source, /resources["',\s]+["']app/u);
  assert.match(source, /portable-manifest\.json/u);
  assert.match(source, /brandingManifest\.nativeFallback/u);
  assert.match(source, /brandingManifest\.nativeSmall/u);
  assert.match(source, /brandingManifest\.windowsIco/u);
  assert.match(source, /assets/iu);
  const shell = await readFile(join(root, "src", "renderer", "shell", "index.html"), "utf8");
  assert.match(shell, /src=["']\.\.\/\.\.\/\.\.\/\.\.\/assets\/branding\/viniper-harness-circuit-node\.png/u);
  const brandingManifest = JSON.parse(await readFile(join(root, "assets", "branding", "manifest.json"), "utf8")) as {
    asset: string;
    nativeFallback: string;
    nativeSmall: string;
    windowsIco: string;
    variant: string;
    frame: { radius: number };
  };
  assert.equal(brandingManifest.asset, "viniper-harness-circuit-node.png");
  assert.equal(brandingManifest.asset, brandingManifest.nativeFallback);
  assert.equal(brandingManifest.nativeFallback, "viniper-harness-circuit-node.png");
  assert.equal(brandingManifest.nativeSmall, "viniper-harness-circuit-node-32.png");
  assert.equal(brandingManifest.windowsIco, "viniper-harness-circuit-node.ico");
  assert.equal(brandingManifest.variant, "circuit-node-3d");
  assert.equal(brandingManifest.frame.radius, 24);
  const installScript = await readFile(join(root, "scripts", "install-preview.ps1"), "utf8");
  assert.match(installScript, /brandingManifest\.windowsIco/u);
  assert.doesNotMatch(source, /reg(?:\.exe|istry)|shortcut|Task Scheduler|schtasks|service|startup/iu);
});
