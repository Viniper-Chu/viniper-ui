import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

test("R21 Stable release has an explicit identity and preserves Preview rollback", async () => {
  const root = process.cwd();
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
    version: string;
    scripts: Record<string, string>;
    description: string;
  };
  const profiles = JSON.parse(await readFile(join(root, "resources", "viniper-ui", "profiles.json"), "utf8")) as Record<string, any>;
  const stable = profiles.stable;
  assert.equal(packageJson.version, "2.0.2");
  assert.match(packageJson.description, /Viniper/u);
  assert.match(packageJson.scripts["package:windows-stable"], /package-windows-stable\.mjs/u);
  assert.equal(stable.app_id, "com.viniper.workstation");
  assert.equal(stable.product_name, "Viniper");
  assert.equal(stable.port, 17947);
  assert.equal(stable.data_dir_name, "Viniper workstation Preview");
  assert.match(stable.compatibility_read_boundary, /no copy, migration, clear, or overwrite/u);
  assert.equal(profiles.preview.app_id, "com.viniper.workstation.preview");
  assert.equal(typeof packageJson.scripts["package:windows-preview"], "string");
});

test("R21 Stable packaging is a fresh native NSIS lane with a stable app marker", async () => {
  const root = process.cwd();
  const script = await readFile(join(root, "scripts", "package-windows-stable.mjs"), "utf8");
  const stage = await readFile(join(root, "scripts", "stage-legacy-ui.mjs"), "utf8");
  const desktop = await readFile(join(root, "resources", "viniper-ui", "desktop", "main.js"), "utf8");
  assert.match(script, /VINIPER_WINDOWS_STABLE_OUTPUT_ROOT/u);
  assert.match(script, /WINDOWS_STABLE_PACKAGE_READY/u);
  assert.match(script, /com\.viniper\.workstation/u);
  assert.match(script, /releaseStage: "Stable"/u);
  assert.match(script, /artifactName: "Viniper-workstation-Setup\.\$\{ext\}"/u);
  assert.match(script, /oneClick: false/u);
  assert.match(script, /perMachine: false/u);
  assert.match(script, /electron-builder/u);
  assert.match(script, /--prepackaged/u);
  assert.doesNotMatch(script, /iexpress\.exe/u);
  assert.match(stage, /desktopProfile = "preview"/u);
  assert.match(stage, /viniperProfile: desktopProfile/u);
  assert.match(desktop, /IS_STABLE/u);
  assert.match(desktop, /VINIPER_UI_RELEASE_STAGE/u);
  assert.match(desktop, /workstationDataDir/u);
  assert.match(desktop, /activeProfile: ACTIVE_PROFILE_NAME/u);
});

test("2.0 public documents describe the single-agent upgrade without user data", async () => {
  const root = process.cwd();
  const readme = await readFile(join(root, "README.md"), "utf8");
  const changelog = await readFile(join(root, "CHANGELOG.md"), "utf8");
  for (const document of [readme, changelog]) {
    assert.match(document, /Harness Runtime|Harness/u);
    assert.match(document, /Claude Code/u);

    assert.doesNotMatch(document, /(?:sk-|gh[pousr]_|Bearer\s+[A-Za-z0-9._-]{12,})/iu);
    assert.doesNotMatch(document, /sessions\.json|harness\.sqlite|secrets\.enc/u);
  }
});
