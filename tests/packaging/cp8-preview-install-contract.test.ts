import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

test("CP8 Windows Preview packaging exposes portable and current-user installer outputs", async () => {
  const root = process.cwd();
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.equal(typeof packageJson.scripts["package:windows-preview"], "string");

  const scriptPath = join(root, "scripts", "package-windows-preview.mjs");
  const source = await readFile(scriptPath, "utf8");
  assert.match(source, /viniper-workstation-implementation-20260817/u);
  assert.match(source, /packages["',\s]+["']windows-preview/u);
  assert.match(source, /运行残留/u);
  assert.match(source, /electron-builder/u);
  assert.match(source, /--prepackaged/u);
  assert.doesNotMatch(source, /iexpress\.exe/u);
  assert.match(source, /Viniper workstation Preview/u);
  assert.match(source, /Viniper workstation\.lnk/u);
  assert.match(source, /resources["',\s]+["']app/u);
  assert.match(source, /1\.6\.0/u);
  assert.match(source, /nativeSetup/u);
  assert.match(source, /installerKind:\s*"electron-builder-nsis"/u);
  assert.match(source, /safeReset\(stageRoot, residueRoot\)/u);

  const desktopMain = await readFile(join(root, "src", "platform", "desktop", "main.ts"), "utf8");
  assert.match(desktopMain, /join\(app\.getPath\("appData"\), "Viniper workstation Preview"\)/u);

  await access(join(root, "scripts", "install-preview.ps1"));
  await access(join(root, "scripts", "uninstall-preview.ps1"));
  const installScript = await readFile(join(root, "scripts", "install-preview.ps1"), "utf8");
  assert.match(installScript, /Copy-Item\s+-Path\s+\(Join-Path\s+\$portableRoot/u);
  assert.doesNotMatch(installScript, /Copy-Item\s+-LiteralPath\s+\(Join-Path\s+\$portableRoot\s+'\*'/u);
  assert.match(installScript, /New-Item\s+-ItemType\s+Directory\s+-Path\s+\$DesktopRoot/u);
});

test("CP8 uninstall contract preserves the independent user data root", async () => {
  const root = process.cwd();
  const source = await readFile(join(root, "scripts", "uninstall-preview.ps1"), "utf8");
  assert.match(source, /Viniper workstation Preview/u);
  assert.match(source, /不删除|preserve|preserv/u);
  assert.doesNotMatch(source, /Remove-Item[^\n]*(Viniper workstation|Preview-0\.1\.0)/iu);
  assert.doesNotMatch(source, /reg(?:\.exe|istry)|schtasks|Task Scheduler|New-Service|sc\.exe/iu);
});
