import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("shipped v2 desktop shell owns package main and excludes dead legacy renderer from build output", () => {
  const root = process.cwd();
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(pkg.main, "resources/viniper-ui/desktop/main.js");
  assert.equal(existsSync(join(root, "dist", "src", "renderer")), false, "dead src/renderer must not be copied into dist");
  assert.equal(
    existsSync(join(root, "resources", "viniper-ui", "harness-runtime", "dist", "src", "renderer")),
    false,
    "dead src/renderer must not bloat packaged harness-runtime",
  );
});

test("shipped v2 UI enforces single-agent boundary, four Codex-style settings sections, and keyboard/a11y controls", () => {
  const root = process.cwd();
  const html = readFileSync(join(root, "resources", "viniper-ui", "static", "index.html"), "utf8");
  const appJs = readFileSync(join(root, "resources", "viniper-ui", "static", "v2", "app.js"), "utf8");
  const prefJs = readFileSync(join(root, "resources", "viniper-ui", "static", "v2", "preferences.js"), "utf8");

  // Four contextual preference panels
  for (const panelId of ["connection-settings", "appearance-settings", "workspace-settings", "instruction-settings"]) {
    assert.ok(html.includes(`id="${panelId}"`), `missing settings section ${panelId}`);
  }
  // Polite live announcer & stop shortcut
  assert.match(html, /id="sr-announcer"[^>]*aria-live="polite"/u);
  assert.match(appJs, /event\.key === "\."/u);
  assert.match(appJs, /UI_SESSION_STORAGE_KEY/u);

  // Renderer never writes SQLite directly or exposes an in-app Claude Code switcher
  for (const file of [html, appJs, prefJs]) {
    assert.doesNotMatch(file, /node:sqlite|DatabaseSync/u);
  }
  assert.doesNotMatch(html, /切换至\s*Claude\s*Code/u);
});
