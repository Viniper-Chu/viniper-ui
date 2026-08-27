import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

test("R20 Windows Preview packaging uses a bounded native NSIS/electron-builder installer and official PowerShell 7 installer", async () => {
  const root = process.cwd();
  const script = await readFile(join(root, "scripts", "package-windows-preview.mjs"), "utf8");
  assert.match(script, /VINIPER_WINDOWS_PREVIEW_OUTPUT_ROOT/u);
  assert.match(script, /VINIPER_WINDOWS_PREVIEW_RESIDUE_ROOT/u);
  assert.match(script, /electron-builder/u);
  assert.match(script, /--prepackaged/u);
  assert.match(script, /nsis/u);
  assert.match(script, /oneClick[^\n]*false/u);
  assert.match(script, /builderTimeoutMs/u);
  assert.match(script, /timeout:\s*builderTimeoutMs/u);
  assert.doesNotMatch(script, /iexpress\.exe/u);
  assert.doesNotMatch(script, /powershell\.exe -NoProfile -ExecutionPolicy Bypass -File/u);
});
