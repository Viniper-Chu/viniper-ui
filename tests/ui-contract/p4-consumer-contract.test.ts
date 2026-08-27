import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

test("P4 desktop and CLI consume workspace/review state through the application port", async () => {
  const root = process.cwd();
  const desktopApi = await readFile(join(root, "src", "platform", "desktop", "api-contract.ts"), "utf8");
  const preload = await readFile(join(root, "src", "platform", "desktop", "preload.ts"), "utf8");
  const cliPort = await readFile(join(root, "src", "platform", "cli", "application-port.ts"), "utf8");
  const cliController = await readFile(join(root, "src", "platform", "cli", "controller.ts"), "utf8");
  const rendererFiles = ["app.js", "workspace-panel.js"].map((name) =>
    readFile(name === "app.js"
      ? join(root, "src", "renderer", "shell", name)
      : join(root, "src", "renderer", "workspaces", name), "utf8"));
  const renderer = (await Promise.all(rendererFiles)).join("\n");
  for (const source of [desktopApi, preload, cliPort, cliController]) {
    assert.match(source, /workspace|review/iu);
  }
  assert.match(renderer, /renderWorkspacePanel/u);
  assert.doesNotMatch(renderer, /child_process|execFile|git\s+status|terminal\.run/u);
});
