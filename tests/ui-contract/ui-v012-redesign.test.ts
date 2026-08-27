import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();

async function read(relativePath: string): Promise<string> {
  return readFile(join(root, relativePath), "utf8");
}

test("v0.19 Viniper workstation workbench contract", async () => {
  const html = await read("src/renderer/shell/index.html");
  const styles = `${await read("src/renderer/styles/app.css")}\n${await read("src/renderer/styles/v015-viniper-shell.css")}\n${await read("src/renderer/styles/v016-viniper-shell.css")}\n${await read("src/renderer/styles/v017-viniper-workbench.css")}\n${await read("src/renderer/styles/v018-planar-agent-workbench.css")}\n${await read("src/renderer/styles/v019-viniper-workstation.css")}`;
  const tokens = await read("src/renderer/styles/design-tokens.css");
  const titlebar = await read("src/renderer/shell/titlebar.js");
  const brand = await read("src/renderer/branding/brand.js");
  const conversation = await read("src/renderer/conversation/conversation.js");
  const sessions = await read("src/renderer/sessions/session-list.js");

  assert.match(html, /data-direction=["']viniper-workstation["']/u);
  assert.match(html, /data-ui-version=["']v0\.19["']/u);
  assert.match(html, /href=["']\.\.\/styles\/v019-viniper-workstation\.css["']/u);
  assert.match(html, /id=["']sessionTitleButton["']/u);
  assert.match(html, /id=["']changeDrawerButton["']/u);
  assert.doesNotMatch(html, /id=["']executionRail["']|Cyan Plotter Rail/u);
  assert.match(html, /id=["']tokenUsageButton["'][^>]*aria-haspopup=["']dialog["']/u);
  assert.match(html, /id=["']contextDrawer["']/u);
  assert.match(styles, /\.workspace-grid\.inspector-open\b/u);
  assert.match(styles, /body\s*\{[\s\S]*font-size:\s*16px/su);
  assert.match(styles, /--vw-canvas:\s*#f7faf9/iu);
  assert.match(styles, /--vw-teal-deep:\s*#0a6864/iu);
  assert.doesNotMatch(styles, /transition\s*:\s*all/u);
  assert.doesNotMatch(`${html}\n${styles}\n${titlebar}\n${conversation}\n${sessions}`, /[⚙⌕♢—□×▱＋↔◷⌘◇⌁↗★☆✎]/u);
  assert.match(titlebar, /<svg[\s\S]*window/u);
  assert.match(html, /viniper-harness-circuit-node\.png/u);
  assert.match(brand, /UNIFIED_3D_NATIVE_SOURCE/u);
  assert.match(sessions, /session-status-mark/u);
  assert.match(conversation, /reasoning-block[\s\S]*reasoning-step-mark/u);
  assert.match(styles, /\.usage-cache \.usage-token-row strong[\s\S]*font-size:\s*12px[\s\S]*word-break:\s*keep-all/u);
  assert.match(styles, /font-family:\s*Bahnschrift/u);
  assert.match(styles, /font-family:\s*"Cascadia Mono"/u);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/u);

  const sizes = [...styles.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/gu)]
    .map((match) => Number(match[1]));
  assert.equal(sizes.some((size) => size < 12), false, "production UI text must not be below 12px");
});
