import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("CP8 desktop exposes transfer, diagnostics, and update representative states through the application port", async () => {
  const root = process.cwd();
  const html = await readFile(join(root, "src/renderer/shell/index.html"), "utf8");
  const app = await readFile(join(root, "src/renderer/shell/app.js"), "utf8");
  for (const id of [
    "runtimeCenterDialog",
    "runtimeArchiveExportButton",
    "runtimeArchivePreviewButton",
    "runtimeDiagnosticsButton",
    "runtimeUpdateCheckButton",
    "runtimeUpdateDownloadButton",
    "runtimeUpdateInstallButton",
  ]) assert.match(html, new RegExp(`id=["']${id}["']`, "u"));
  assert.match(html, /data-titlebar-action=["']runtime-center["']/u);
  for (const method of ["exportArchive", "stageArchiveImport", "previewArchiveImport", "getDiagnosticsPreview", "checkUpdates", "downloadUpdate", "confirmUpdateInstall"]) {
    assert.match(app, new RegExp(`api\\.${method}`, "u"));
  }
  assert.doesNotMatch(app, /node:(?:fs|child_process)|sqlite|safeStorage/u);
});
