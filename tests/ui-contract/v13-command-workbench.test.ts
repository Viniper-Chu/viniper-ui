import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("v0.16 opens the real CLI in a standalone Windows console over the existing Runtime port", async () => {
  const html = await readFile("src/renderer/shell/index.html", "utf8");
  const app = await readFile("src/renderer/shell/app.js", "utf8");
  const api = await readFile("src/platform/desktop/api-contract.ts", "utf8");
  const preload = await readFile("src/platform/desktop/preload.ts", "utf8");
  const main = await readFile("src/platform/desktop/main.ts", "utf8");
  const externalCli = await readFile("src/platform/process/external-cli-window.ts", "utf8");
  assert.match(html, /id="agentViewButton"[^>]*role="tab"/u);
  assert.match(html, /id="terminalViewButton"[^>]*独立窗口/u);
  assert.match(html, /id="agentView"[^>]*role="tabpanel"/u);
  assert.match(html, /id="composerForm"/u);
  assert.doesNotMatch(html, /id="terminalView"|id="commandWorkbench"|id="terminalStream"/u);
  assert.match(app, /readTerminalOutput/u);
  assert.match(app, /api\.openExternalTerminal\(session\.id\)/u);
  assert.match(api, /openExternalTerminal/u);
  assert.match(preload, /window:open-external-terminal/u);
  assert.match(main, /window:open-external-terminal/u);
  assert.match(externalCli, /spawn\(process\.env\.ComSpec \|\| "cmd\.exe"/u);
  assert.match(externalCli, /ELECTRON_RUN_AS_NODE/u);
  assert.doesNotMatch(app, /child_process|execFile|spawn\(/u);
});

test("v13 low-risk actions are icon-first while risky actions keep visible labels", async () => {
  const html = await readFile("src/renderer/shell/index.html", "utf8");
  const app = await readFile("src/renderer/shell/app.js", "utf8");
  const provider = await readFile("src/renderer/providers/provider-settings.js", "utf8");
  const extensions = await readFile("src/renderer/extensions/extension-center.js", "utf8");
  const scheduler = await readFile("src/renderer/scheduler/schedule-center.js", "utf8");
  const externalCli = await readFile("src/platform/process/external-cli-window.ts", "utf8");
  const styles = await readFile("src/renderer/styles/app.css", "utf8");
  const workspaceStyles = await readFile("src/renderer/styles/phase7-workspace.css", "utf8");
  assert.match(provider, /actionButton\("用于当前会话"[\s\S]*icon: "check"[\s\S]*iconOnly: true/u);
  assert.match(provider, /actionButton\([\s\S]*"test-connection"[\s\S]*icon: "refresh"[\s\S]*iconOnly: true/u);
  assert.match(extensions, /setActionButtonPresentation\(toggle,[\s\S]*icon: "power"[\s\S]*iconOnly: true/u);
  assert.match(scheduler, /actionButton\("立即运行"[\s\S]*icon: "play"[\s\S]*iconOnly: true/u);
  assert.match(externalCli, /title Viniper CLI/u);
  assert.match(app, /runtimeArchivePreviewButton[\s\S]*setActionButtonPresentation[\s\S]*iconOnly: true/u);
  assert.match(app, /data-memory-toggle[\s\S]*setActionButtonPresentation[\s\S]*icon: "power"/u);
  assert.match(styles, /\.icon-action\s*\{[\s\S]*min-height: 36px[\s\S]*border-radius: 9px/u);
  assert.match(workspaceStyles, /\.app-view\s*\{/u);
  assert.match(html, /打开项目/u);
  assert.match(html, /保存设置/u);
  assert.match(html, /确认安装/u);
  assert.match(html, /创建自动任务/u);
  assert.match(html, /发送消息/u);
  assert.match(html, /删除/u);
});

test("standalone CLI control keeps Agent identity and no Chat or embedded-terminal state", async () => {
  const html = await readFile("src/renderer/shell/index.html", "utf8");
  const app = await readFile("src/renderer/shell/app.js", "utf8");
  assert.match(html, /id="sessionTitleButton"/u);
  assert.match(html, /id="terminalViewButton"/u);
  assert.doesNotMatch(html, /id="terminalView"|id="commandWorkbench"/u);
  assert.doesNotMatch(html, /Agent 执行空间/u);
  assert.doesNotMatch(`${html}\n${app}`, /New Chat|新建 Chat|modeToggle|chatMode|agentMode/u);
});
