import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

const REQUIRED_AUG24_MARKERS = [
  "global-nav",
  "workspace-mode-bar",
  "sidebar-quick-nav",
  "message-trace-rail",
  "agent-queue-dock",
];

test("R19 restores the Aug-24 static UI and stages it with the current runtime", async () => {
  const root = process.cwd();
  const staticRoot = join(root, "resources", "viniper-ui", "static");
  const html = await readFile(join(staticRoot, "index.html"), "utf8");
  const css = await readFile(join(staticRoot, "style.css"), "utf8");
  const app = await readFile(join(staticRoot, "app.js"), "utf8");
  for (const marker of REQUIRED_AUG24_MARKERS) {
    assert.match(html + "\n" + css + "\n" + app, new RegExp(marker, "u"));
  }
  await access(join(staticRoot, "assets", "viniper-harness-circuit-node.ico"));
  await access(join(root, "resources", "viniper-ui", "server.py"));
  await access(join(root, "resources", "viniper-ui", "harness-runtime", "vendor", "typescript.js"));
});

test("R19 packaging points the restored shell at one Application Port runtime", async () => {
  const root = process.cwd();
  const staging = await readFile(join(root, "scripts", "stage-legacy-ui.mjs"), "utf8");
  const windows = await readFile(join(root, "scripts", "package-windows-preview.mjs"), "utf8");
  const portable = await readFile(join(root, "scripts", "package-portable.mjs"), "utf8");
  assert.match(staging, /stageLegacyUi/u);
  assert.match(staging, /harness-runtime/u);
  assert.match(staging, /readdir\(compiledRuntime/u);
  assert.doesNotMatch(staging, /join\(runtimeDist,\s*["']src["']\)/u);
  for (const script of [windows, portable]) {
    assert.match(script, /stageLegacyUi/u);
    assert.match(script, /main:\s*"main\.js"/u);
    assert.match(script, /runtimeAssets:\s*"resources\/viniper-ui"/u);
    assert.match(script, /assets",\s*"branding"/u);
  }
});

test("R19 runtime overlay retains the R18 fresh-final and legacy-map guards", async () => {
  const root = process.cwd();
  const loop = await readFile(
    join(root, "resources", "viniper-ui", "harness-runtime", "dist", "src", "features", "runs", "tool-loop", "agent-tool-loop.js"),
    "utf8",
  );
  const store = await readFile(
    join(root, "resources", "viniper-ui", "harness-runtime", "dist", "src", "platform", "persistence", "file-store.js"),
    "utf8",
  );
  assert.match(loop, /roundText/u);
  assert.match(loop, /ProviderFinalAnswerMissingError/u);
  assert.match(store, /isPersistedApplicationShape/u);
});
