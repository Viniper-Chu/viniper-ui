import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { test } from "node:test";

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  }));
  return nested.flat();
}

test("production source contains one Agent product and no legacy product-mode switch", async () => {
  const files = await sourceFiles(join(process.cwd(), "src"));
  const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(source, /\bSessionMode\b|\bUserIntent\b|["']chat["']|Chat\/Agent|Chat 模式/u);
  assert.doesNotMatch(source, /(?:^|[,{]\s*)(?:sessionMode|productMode)\s*:/mu);
  assert.doesNotMatch(source, /window\.(?:alert|confirm|prompt)\s*\(/u);
  const nonProcessSources = files.filter((file) => !file.includes(`${join("platform", "process")}`));
  const nonProcessSource = (await Promise.all(nonProcessSources.map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(nonProcessSource, /child_process/u);
  assert.doesNotMatch(source, /node:https|node:http|XMLHttpRequest/u);
  const networkSources = files.filter((file) =>
    basename(file) !== "deepseek-provider.ts"
      && basename(file) !== "web-fetch-service.ts"
      && !file.includes(`${join("features", "providers", "protocols")}`),
  );
  const networkSource = (await Promise.all(networkSources.map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(networkSource, /\bfetch\s*\(/u);
  const webFetcher = await readFile(join(process.cwd(), "src", "features", "web", "web-fetch-service.ts"), "utf8");
  assert.match(webFetcher, /const finalUrl = response\.url/u);
  assert.match(webFetcher, /parsePublicUrl\(finalUrl\)/u);
  assert.match(webFetcher, /contentTrustedAsInstructions:\s*false/u);
});

test("Feature Folder Contract and user entry points are present", async () => {
  const required = [
    "src/core",
    "src/features/sessions",
    "src/features/runs",
    "src/features/queue",
    "src/features/permissions",
    "src/features/tools",
    "src/features/providers",
    "src/features/cache",
    "src/features/settings",
    "src/features/coordination",
    "src/features/telemetry",
    "src/features/scheduler",
    "src/features/skills",
    "src/features/plugins",
    "src/features/secrets",
    "src/features/instructions",
    "src/features/files",
    "src/features/terminal",
    "src/platform/desktop",
    "src/platform/persistence",
    "src/platform/security",
    "src/platform/process",
    "src/renderer/shell",
    "src/renderer/sessions",
    "src/renderer/conversation",
    "src/renderer/composer",
    "src/renderer/activity",
    "src/renderer/changes",
    "src/renderer/providers",
    "src/renderer/coordination",
    "src/renderer/telemetry",
    "src/renderer/scheduler",
    "src/renderer/extensions",
    "src/renderer/styles",
  ];
  for (const path of required) assert.equal((await readdir(join(process.cwd(), path))).length > 0, true, path);

  const html = await readFile(join(process.cwd(), "src", "renderer", "shell", "index.html"), "utf8");
  for (const id of ["sessionList", "composerInput", "modelSelect", "permissionSelect", "currentDirectory", "currentInstructions", "changeDrawerButton", "titlebarSettingsButton", "sessionConstellation", "tokenUsageButton", "tokenUsageDialog", "schedulerButton", "skillsButton", "extensionsButton", "providerSearch", "providerCategories", "providerProfileList", "providerProfileDetail", "providerActionMessage"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`, "u"));
  }
  assert.doesNotMatch(html, /id=["']accessSelect["']/u);
  assert.match(html, /<option value="ask">手动审核<\/option>[\s\S]*<option value="auto">自动审核<\/option>[\s\S]*<option value="full">完全访问<\/option>/u);
  const tokenPulse = await readFile(join(process.cwd(), "src", "renderer", "telemetry", "token-pulse.js"), "utf8");
  assert.match(tokenPulse, /Provider 未返回/u);
  assert.match(tokenPulse, /上限未知/u);
  assert.doesNotMatch(tokenPulse, /emptyUsage|cacheWriteInput:\s*0/u);

  const conversation = await readFile(join(process.cwd(), "src", "renderer", "conversation", "conversation.js"), "utf8");
  const styles = `${await readFile(join(process.cwd(), "src", "renderer", "styles", "app.css"), "utf8")}\n${await readFile(join(process.cwd(), "src", "renderer", "styles", "v015-viniper-shell.css"), "utf8")}\n${await readFile(join(process.cwd(), "src", "renderer", "styles", "v016-viniper-shell.css"), "utf8")}\n${await readFile(join(process.cwd(), "src", "renderer", "styles", "v017-viniper-workbench.css"), "utf8")}\n${await readFile(join(process.cwd(), "src", "renderer", "styles", "v018-planar-agent-workbench.css"), "utf8")}\n${await readFile(join(process.cwd(), "src", "renderer", "styles", "v019-viniper-workstation.css"), "utf8")}`;
  for (const label of ["最近会话", "Token 用量", "改动", "协作"]) {
    assert.match(`${html}\n${conversation}`, new RegExp(label, "u"));
  }
  for (const selector of ["\.workspace-grid", "\.timeline-entry", "\.execution-sequence", "\.composer", "\.inspector"]) {
    assert.match(styles, new RegExp(selector, "u"));
  }
  assert.match(styles, /@media \(max-width: 1179px\)[\s\S]*translateX\(-(?:100|102)%\)[\s\S]*translateX\(102%\)/u);

  for (const asset of [
    ["skills", "calm-task-brief", "SKILL.md"],
    ["plugins", "built-in", "coordination", "plugin.json"],
    ["plugins", "external", "example-declarative", "plugin.json"],
  ]) {
    assert.equal((await readFile(join(process.cwd(), "dist", "src", "platform", "desktop", ...asset), "utf8")).length > 0, true);
  }
});

test("Phase 5 desktop exposes AGENTS.md status and one-time tool approval without renderer file access", async () => {
  const html = await readFile(join(process.cwd(), "src", "renderer", "shell", "index.html"), "utf8");
  const app = await readFile(join(process.cwd(), "src", "renderer", "shell", "app.js"), "utf8");
  const inspector = await readFile(join(process.cwd(), "src", "renderer", "activity", "activity-inspector.js"), "utf8");
  const preload = await readFile(join(process.cwd(), "src", "platform", "desktop", "preload.ts"), "utf8");
  const main = await readFile(join(process.cwd(), "src", "platform", "desktop", "main.ts"), "utf8");
  const renderer = `${app}\n${inspector}`;

  assert.match(html, /id=["']currentInstructions["']/u);
  assert.match(renderer, /仅本次允许/u);
  assert.match(renderer, /拒绝/u);
  assert.match(renderer, /resolveToolApproval/u);
  assert.match(preload, /agent:resolve-tool-approval/u);
  assert.match(main, /agent:resolve-tool-approval/u);
  assert.doesNotMatch(renderer, /node:fs|readFile|AGENTS\.md["']\s*\)/u);
});

test("desktop registers ready-to-show before loading the renderer", async () => {
  const main = await readFile(join(process.cwd(), "src", "platform", "desktop", "main.ts"), "utf8");
  const readyToShow = main.indexOf('mainWindow.once("ready-to-show"');
  const loadRenderer = main.indexOf("await mainWindow.loadFile");
  assert.notEqual(readyToShow, -1);
  assert.notEqual(loadRenderer, -1);
  assert.equal(readyToShow < loadRenderer, true, "ready-to-show can fire before a late listener is registered");
});

test("P1-01/P1-10 desktop uses a native project picker and keeps renderer on the application port", async () => {
  const html = await readFile(join(process.cwd(), "src", "renderer", "shell", "index.html"), "utf8");
  const app = await readFile(join(process.cwd(), "src", "renderer", "shell", "app.js"), "utf8");
  const preload = await readFile(join(process.cwd(), "src", "platform", "desktop", "preload.ts"), "utf8");
  const main = await readFile(join(process.cwd(), "src", "platform", "desktop", "main.ts"), "utf8");
  const api = await readFile(join(process.cwd(), "src", "platform", "desktop", "api-contract.ts"), "utf8");

  assert.match(html, /id="plainSessionButton"/u);
  assert.match(html, /id="newSessionButton"/u);
  assert.match(html, /id="sessionPath"/u);
  assert.match(html, /id="changesPane"/u);
  assert.match(app, /chooseProjectSession/u);
  assert.match(preload, /chooseProjectSession[\s\S]*agent:choose-project-session/u);
  assert.match(api, /chooseProjectSession/u);
  assert.match(main, /dialog\.showOpenDialog/u);
  assert.match(main, /properties:\s*\[["']openDirectory["']\]/u);
  assert.doesNotMatch(app, /node:fs|showOpenDialog/u);
});

test("P2 desktop keeps three-mode permission, file mutation, folded diff and recovery on the application port", async () => {
  const html = await readFile(join(process.cwd(), "src", "renderer", "shell", "index.html"), "utf8");
  const app = await readFile(join(process.cwd(), "src", "renderer", "shell", "app.js"), "utf8");
  const inspector = await readFile(join(process.cwd(), "src", "renderer", "activity", "activity-inspector.js"), "utf8");
  const preload = await readFile(join(process.cwd(), "src", "platform", "desktop", "preload.ts"), "utf8");
  const main = await readFile(join(process.cwd(), "src", "platform", "desktop", "main.ts"), "utf8");
  const styles = await readFile(join(process.cwd(), "src", "renderer", "styles", "app.css"), "utf8");

  assert.match(html, /手动审核/u);
  assert.match(html, /自动审核/u);
  assert.match(html, /完全访问/u);
  assert.match(app, /setPermissionMode/u);
  assert.doesNotMatch(app, /setPermissionAccess/u);
  assert.match(inspector, /presentation\.patch/u);
  assert.match(inspector, /恢复删除/u);
  assert.match(styles, /\.project-diff/u);
  assert.match(preload, /agent:restore-project-change/u);
  assert.match(main, /agent:restore-project-change/u);
  assert.doesNotMatch(`${app}\n${inspector}`, /node:fs|readFile|writeFile|rename\(/u);
});

test("P3 desktop projects terminal status and reads bounded output only through narrow IPC", async () => {
  const app = await readFile(join(process.cwd(), "src", "renderer", "shell", "app.js"), "utf8");
  const inspector = await readFile(join(process.cwd(), "src", "renderer", "activity", "activity-inspector.js"), "utf8");
  const preload = await readFile(join(process.cwd(), "src", "platform", "desktop", "preload.ts"), "utf8");
  const main = await readFile(join(process.cwd(), "src", "platform", "desktop", "main.ts"), "utf8");
  const api = await readFile(join(process.cwd(), "src", "platform", "desktop", "api-contract.ts"), "utf8");

  assert.match(inspector, /presentation\?\.kind === "terminal-run"/u);
  assert.match(inspector, /stdout["][,\]]|\["stdout", "stderr"\]/u);
  assert.match(inspector, /exit \$\{presentation\.exitCode/u);
  assert.match(inspector, /从头续读完整输出/u);
  assert.match(app, /readTerminalOutput/u);
  assert.match(api, /readTerminalOutput/u);
  assert.match(preload, /agent:terminal-output/u);
  assert.match(main, /agent:terminal-output/u);
  assert.match(main, /event\.preventDefault\(\)/u);
  assert.match(main, /await desktopApplication\?\.dispose\(\)/u);
  assert.match(main, /await dataRootLease\?\.release\(\)/u);
  assert.doesNotMatch(`${app}\n${inspector}`, /node:fs|node:child_process|readFile\(|spawn\(/u);
});

test("real Provider network authorization is explicit at the desktop owner boundary", async () => {
  const factory = await readFile(join(process.cwd(), "src", "platform", "bootstrap", "create-harness-application.ts"), "utf8");
  const providerSettings = await readFile(join(process.cwd(), "src", "features", "providers", "provider-settings-service.ts"), "utf8");
  const desktop = await readFile(join(process.cwd(), "src", "platform", "desktop", "main.ts"), "utf8");
  const cli = await readFile(join(process.cwd(), "src", "platform", "cli", "main.ts"), "utf8");
  assert.match(factory, /allowExternalNetwork\?: boolean/u);
  assert.match(factory, /options\.allowExternalNetwork === true/u);
  assert.match(providerSettings, /allowExternalNetwork = false/u);
  assert.match(desktop, /allowExternalNetwork:\s*true/u);
  assert.doesNotMatch(cli, /allowExternalNetwork:\s*true/u);
});

test("version and Stable stage are consistent in package, title and settings/about", async () => {
  const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as { version: string };
  const core = await readFile(join(process.cwd(), "src", "core", "contracts.ts"), "utf8");
  const html = await readFile(join(process.cwd(), "src", "renderer", "shell", "index.html"), "utf8");
  assert.equal(packageJson.version, "2.0.1");
  assert.match(core, /Stable（稳定版）/u);
  assert.equal(html.includes(`v${packageJson.version} · Stable（稳定版）`), true);
  assert.doesNotMatch(html, /Beta|公测|\bRC\b|正式版|首次公测更新/u);
});

test("conversation labels assistant output with the selected provider", async () => {
  const app = await readFile(join(process.cwd(), "src", "renderer", "shell", "app.js"), "utf8");
  const conversation = await readFile(join(process.cwd(), "src", "renderer", "conversation", "conversation.js"), "utf8");
  assert.match(app, /session\.selectedProviderId/u);
  assert.match(app, /renderConversation\([^;]+providerLabel,[\s\S]*?telemetry:/u);
  assert.doesNotMatch(conversation, /Demo Provider/u);
  assert.match(conversation, /providerLabel/u);
});

test("Phase 7 Composer never renders a blank selection for an unavailable persisted Provider", async () => {
  const composer = await readFile(join(process.cwd(), "src", "renderer", "composer", "composer.js"), "utf8");
  assert.match(composer, /当前不可用/u);
  assert.match(composer, /unavailable\.disabled = true/u);
  assert.match(composer, /elements\.model\.title/u);
  assert.match(composer, /selectedOptions\[0\]\?\.disabled/u);
});

test("visible branding uses the same three-dimensional Viniper source as native Windows surfaces", async () => {
  const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as { description: string };
  const html = await readFile(join(process.cwd(), "src", "renderer", "shell", "index.html"), "utf8");
  const desktop = await readFile(join(process.cwd(), "src", "platform", "desktop", "main.ts"), "utf8");
  const cli = await readFile(join(process.cwd(), "src", "platform", "cli", "presenters.ts"), "utf8");
  const manifest = JSON.parse(await readFile(join(process.cwd(), "assets", "branding", "manifest.json"), "utf8")) as {
    brand: string;
    status: string;
    asset: string;
    nativeFallback: string;
    nativeSmall: string;
    windowsIco: string;
    variant: string;
    frame: { kind: string; radius: number; preserves: string };
  };
  const visibleBranding = `${packageJson.description}\n${html}\n${desktop}\n${cli}`;

  assert.match(visibleBranding, /Viniper workstation/u);
  assert.doesNotMatch(visibleBranding, /平静指挥台/u);
  assert.equal(manifest.brand, "Viniper");
  assert.equal(manifest.status, "UNIFIED_3D_NATIVE_SOURCE");
  assert.equal(manifest.nativeFallback, "viniper-harness-circuit-node.png");
  assert.equal(manifest.nativeSmall, "viniper-harness-circuit-node-32.png");
  assert.equal(manifest.windowsIco, "viniper-harness-circuit-node.ico");
  assert.equal(manifest.asset, "viniper-harness-circuit-node.png");
  assert.equal(manifest.asset, manifest.nativeFallback);
  assert.equal(manifest.variant, "circuit-node-3d");
  assert.deepEqual(manifest.frame, {
    kind: "rounded-square",
    radius: 24,
    preserves: "existing V circuit-node mark",
  });
  const approvedIcon = await readFile(join(process.cwd(), "assets", "branding", manifest.asset));
  assert.equal(approvedIcon.byteLength > 0, true);
  for (const nativeAsset of [manifest.nativeFallback, manifest.nativeSmall, manifest.windowsIco]) {
    const nativeIcon = await readFile(join(process.cwd(), "assets", "branding", nativeAsset));
    assert.equal(nativeIcon.byteLength > 0, true, nativeAsset);
  }
  assert.match(html, /class=["']brand-mark["'][^>]*data-asset-status=["']UNIFIED_3D_NATIVE_SOURCE["'][^>]*viniper-harness-circuit-node\.png/u);
  assert.equal((html.match(/viniper-harness-circuit-node\.png/gu) ?? []).length >= 3, true);
  assert.doesNotMatch(html, /PENDING_IMAGE2_ASSET/u);
});

test("Phase 7 custom titlebar keeps window controls behind narrow desktop IPC", async () => {
  const html = await readFile(join(process.cwd(), "src", "renderer", "shell", "index.html"), "utf8");
  const titlebar = await readFile(join(process.cwd(), "src", "renderer", "shell", "titlebar.js"), "utf8");
  const api = await readFile(join(process.cwd(), "src", "platform", "desktop", "api-contract.ts"), "utf8");
  const preload = await readFile(join(process.cwd(), "src", "platform", "desktop", "preload.ts"), "utf8");
  const main = await readFile(join(process.cwd(), "src", "platform", "desktop", "main.ts"), "utf8");
  const styles = await readFile(join(process.cwd(), "src", "renderer", "styles", "app.css"), "utf8");

  assert.match(html, /id=["']appTitlebar["']/u);
  assert.match(html, /文件[\s\S]*编辑[\s\S]*视图[\s\S]*任务[\s\S]*帮助/u);
  assert.match(main, /frame:\s*false/u);
  assert.match(main, /getBrandingAssetPath\(desktopAssetsRoot,\s*["']nativeFallback["']\)/u);
  assert.match(main, /getBrandingAssetPath\(desktopAssetsRoot,\s*["']nativeSmall["']\)/u);
  assert.match(main, /buttons:\s*\["隐藏",\s*"退出",\s*"取消"\]/u);
  assert.match(main, /result\.response === 0[\s\S]*owner\.hide\(\)[\s\S]*result\.response !== 1/u);
  assert.equal((await readFile(join(process.cwd(), "assets", "branding", "viniper-harness-circuit-node.png"))).byteLength > 0, true);
  for (const channel of ["window:state", "window:minimize", "window:toggle-maximize", "window:close"]) {
    assert.match(preload, new RegExp(channel, "u"));
    assert.match(main, new RegExp(channel, "u"));
  }
  assert.match(api, /getWindowState/u);
  assert.match(api, /toggleMaximizeWindow/u);
  assert.match(titlebar, /api\.closeWindow\(\)/u);
  assert.match(styles, /-webkit-app-region:\s*drag/u);
  assert.match(styles, /-webkit-app-region:\s*no-drag/u);
  assert.doesNotMatch(titlebar, /node:child_process|node:fs|spawn\(|exec\(/u);
});

test("Phase 4 desktop typography, teal palette and button contrast follow the readability contract", async () => {
  const styles = await readFile(join(process.cwd(), "src", "renderer", "styles", "app.css"), "utf8");
  const tokens = await readFile(join(process.cwd(), "src", "renderer", "styles", "design-tokens.css"), "utf8");
  const combinedStyles = `${styles}\n${tokens}`;
  const normalized = combinedStyles.toLocaleLowerCase("en-US");

  for (const color of ["#f4faf9", "#ffffff", "#e6f5f7", "#ddf5ef", "#168a91", "#22b8b5", "#116b73", "#15343b", "#5e7478", "#d7e7e5"]) {
    assert.match(normalized, new RegExp(color, "u"), color);
  }
  const undersized = [...combinedStyles.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/gu)]
    .map((match) => Number(match[1]))
    .filter((size) => size < 12);
  assert.deepEqual(undersized, []);
  assert.match(combinedStyles, /body\s*\{[^}]*font-size:\s*16px/su);
  assert.match(combinedStyles, /small[\s\S]*font-size:\s*12px/su);
  assert.match(styles, /\.session-title\s*\{[^}]*font-size:\s*14px/su);
  assert.match(styles, /\.session-meta\s*\{[^}]*font-size:\s*12px/su);
  assert.match(styles, /\.send-button[^}]*background:\s*var\(--accent-deep\)/su);
  assert.match(combinedStyles, /--accent-deep:\s*#116B73/iu);
  assert.doesNotMatch(styles, /(?:send-button|primary-button|new-agent-button)[^}]*background:\s*(?:#168A91|var\(--accent-main\))/isu);
});

test("Phase 4 history uses equal dash markers and context usage is a central accessible block meter", async () => {
  const html = await readFile(join(process.cwd(), "src", "renderer", "shell", "index.html"), "utf8");
  const sessions = await readFile(join(process.cwd(), "src", "renderer", "sessions", "session-list.js"), "utf8");
  const styles = `${await readFile(join(process.cwd(), "src", "renderer", "styles", "app.css"), "utf8")}\n${await readFile(join(process.cwd(), "src", "renderer", "styles", "v015-viniper-shell.css"), "utf8")}\n${await readFile(join(process.cwd(), "src", "renderer", "styles", "v016-viniper-shell.css"), "utf8")}\n${await readFile(join(process.cwd(), "src", "renderer", "styles", "v017-viniper-workbench.css"), "utf8")}\n${await readFile(join(process.cwd(), "src", "renderer", "styles", "v018-planar-agent-workbench.css"), "utf8")}\n${await readFile(join(process.cwd(), "src", "renderer", "styles", "v019-viniper-workstation.css"), "utf8")}`;

  assert.match(sessions, /session-status-mark/u);
  assert.doesNotMatch(sessions, /session-icon/u);
  assert.match(styles, /\.session-status-mark\s*\{[^}]*width:\s*18px[^}]*height:\s*3px/su);
  assert.match(sessions, /session-actions-trigger/u);
  assert.match(sessions, /默认会话/u);
  assert.match(sessions, /stableSessions/u);
  assert.doesNotMatch(sessions, /正在进行/u);
  assert.doesNotMatch(html, /id=["']tokenPulse["']/u);
  assert.match(html, /id=["']tokenUsageButton["'][^>]*aria-haspopup=["']dialog["']/u);
  assert.equal((html.match(/<i><\/i>/gu) ?? []).length >= 16, true);
  assert.match(styles, /\.context-block-meter\s*\{[\s\S]*left:\s*50%/u);
  assert.doesNotMatch(html, /id=["']emptyTokenStatus["']|class=["']usage-trigger["']/u);
  assert.match(html, /id=["']tokenUsageDialog["']/u);
  assert.match(html, /<h3>Context<\/h3>/u);
  assert.match(html, /<h3>Provider<\/h3>/u);
  assert.match(html, /<h3>Cache<\/h3>/u);
  assert.match(html, /usage-section usage-cache/u);
  assert.match(styles, /\.usage-cache \.usage-token-row\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(3/su);
  assert.match(html, /Provider 未提供账户周期用量/u);
});

test("v0.13 concise controls keep keyboard labels, risky action text, and rounded hit areas", async () => {
  const html = await readFile(join(process.cwd(), "src", "renderer", "shell", "index.html"), "utf8");
  const composer = await readFile(join(process.cwd(), "src", "renderer", "composer", "composer.js"), "utf8");
  const sessions = await readFile(join(process.cwd(), "src", "renderer", "sessions", "session-list.js"), "utf8");
  const activity = await readFile(join(process.cwd(), "src", "renderer", "activity", "activity-inspector.js"), "utf8");
  const coordination = await readFile(join(process.cwd(), "src", "renderer", "coordination", "coordination-view.js"), "utf8");
  const styles = `${await readFile(join(process.cwd(), "src", "renderer", "styles", "app.css"), "utf8")}\n${await readFile(join(process.cwd(), "src", "renderer", "styles", "v015-viniper-shell.css"), "utf8")}\n${await readFile(join(process.cwd(), "src", "renderer", "styles", "v016-viniper-shell.css"), "utf8")}\n${await readFile(join(process.cwd(), "src", "renderer", "styles", "v017-viniper-workbench.css"), "utf8")}\n${await readFile(join(process.cwd(), "src", "renderer", "styles", "v018-planar-agent-workbench.css"), "utf8")}`;

  assert.equal((html.match(/class=["']menu-trigger["'][^>]*data-tooltip=/gu) ?? []).length, 5);
  assert.match(html, /class=["']menu-trigger["'][^>]*aria-label=["']文件菜单["'][\s\S]*class=["']sr-only["']>文件</u);
  assert.match(html, /id=["']sendButton["'][^>]*aria-label=["']发送任务["'][\s\S]*id=["']sendLabel["'][^>]*class=["']sr-only["']/u);
  assert.match(composer, /elements\.send\.dataset\.tooltip/u);
  assert.match(sessions, /aria-label="删除会话"/u);
  assert.match(sessions, /remove\.dataset\.tooltip/u);
  assert.match(activity, /more\.textContent = "续读"/u);
  assert.match(activity, /从头续读完整输出/u);
  assert.match(coordination, /button\.textContent = "已读"/u);
  assert.match(styles, /button:focus-visible/u);
  assert.match(styles, /\[data-tooltip\]:hover::after[\s\S]*\[data-tooltip\]:focus-visible::after/u);
  assert.match(styles, /\.session-actions\s*\{[^}]*position:\s*static[^}]*opacity:\s*1/su);
  assert.match(styles, /\.menu-trigger, \.titlebar-action\s*\{[^}]*width:\s*34px/su);
  assert.match(styles, /\.send-button\s*\{[^}]*width:\s*38px/su);
  assert.match(html, /id=["']newSessionButton["'][\s\S]*打开项目/u);
  assert.match(html, /id=["']schedulerButton["'][\s\S]*<span>自动任务<\/span>/u);
  assert.match(html, /id=["']extensionsButton["'][\s\S]*<span>插件<\/span>/u);
  assert.doesNotMatch(html, /doneTokenUsageButton|doneSettingsButton/u);
  assert.match(html, /id=["']closeTokenUsageButton["'][^>]*data-tooltip=["']关闭["']/u);
  assert.match(composer, /elements\.send\.title/u);
  assert.match(await readFile(join(process.cwd(), "src", "renderer", "shell", "app.js"), "utf8"), /button\.dataset\.tooltip \|\|=/u);
});

test("Token usage view distinguishes unknown, estimate and Provider actual values", async () => {
  const source = await readFile(join(process.cwd(), "src", "renderer", "telemetry", "token-pulse.js"), "utf8");
  const importModule = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<{ buildTokenUsageView: (telemetry: unknown, sessionId: string) => Record<string, any> }>;
  const module = await importModule(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

  const unknown = module.buildTokenUsageView({ sessions: [], appCumulative: {} }, "missing");
  assert.equal(unknown.hero, "未提供");
  assert.equal(unknown.contextCapacity, "上限未知");
  assert.equal(unknown.cache.read, "Provider 未返回");
  assert.doesNotMatch(JSON.stringify(unknown), /约 0|实际 0/u);

  const estimatedUsage = {
    input: 8, output: 4, reasoning: 0, toolUse: 0, total: 12,
    cacheHitInput: 0, cacheMissInput: 8, cacheWriteInput: 0, source: "estimated",
  };
  const estimated = module.buildTokenUsageView({
    sessions: [{
      sessionId: "session-1",
      cumulative: estimatedUsage,
      currentRun: { status: "estimating", usage: estimatedUsage },
    }],
  }, "session-1");
  assert.equal(estimated.visible, true);
  assert.equal(estimated.source, "estimated");
  assert.equal(estimated.triggerValue, "8");
  assert.equal(estimated.blockFill, 1);
  assert.equal(estimated.meterSummary, "估算 8");
  assert.equal(estimated.estimate.total, "12");
  assert.equal(estimated.provider.total, "未提供");
  assert.equal(estimated.cache.read, "Provider 未返回");

  const providerUsage = {
    input: 10, output: 5, reasoning: 2, toolUse: 1, total: 18,
    cacheHitInput: null, cacheMissInput: 4, cacheWriteInput: 0, source: "provider",
  };
  const actual = module.buildTokenUsageView({
    sessions: [{
      sessionId: "session-1",
      cumulative: providerUsage,
      latestRun: { status: "reconciled", usage: providerUsage },
    }],
  }, "session-1");
  assert.equal(actual.visible, true);
  assert.equal(actual.source, "provider");
  assert.equal(actual.triggerValue, "10");
  assert.equal(actual.blockFill, 1);
  assert.equal(actual.meterSummary, "实际 10");
  assert.equal(actual.estimate.state, "已由 Provider 实际值替代");
  assert.equal(actual.provider.total, "18");
  assert.equal(actual.cache.read, "Provider 未返回");
  assert.equal(actual.cache.write, "0");
  assert.equal(actual.cache.miss, "4");
});
