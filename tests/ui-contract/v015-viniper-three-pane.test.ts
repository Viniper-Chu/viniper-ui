import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("v0.19 Viniper workstation keeps sessions stable and changes on demand", async () => {
  const html = await readFile("src/renderer/shell/index.html", "utf8");
  const app = await readFile("src/renderer/shell/app.js", "utf8");
  const sessions = await readFile("src/renderer/sessions/session-list.js", "utf8");
  const changes = await readFile("src/renderer/changes/change-drawer.js", "utf8");
  const styles = `${await readFile("src/renderer/styles/v015-viniper-shell.css", "utf8")}\n${await readFile("src/renderer/styles/v016-viniper-shell.css", "utf8")}\n${await readFile("src/renderer/styles/v017-viniper-workbench.css", "utf8")}\n${await readFile("src/renderer/styles/v018-planar-agent-workbench.css", "utf8")}\n${await readFile("src/renderer/styles/v019-viniper-workstation.css", "utf8")}`;

  assert.match(html, /data-ui-version="v0\.19"/u);
  assert.match(html, /data-seed="viniper-structure-harness-signal-v019"/u);
  assert.match(html, /class="empty-stage"[\s\S]*把任务交给 Agent[\s\S]*文件 · 代码 · Skills/u);
  assert.match(styles, /Viniper information architecture \+ Harness circuit-signal brand language/u);
  assert.match(styles, /\.app-shell\s*\{[^}]*grid-template-rows:\s*var\(--titlebar-height\)/su);
  assert.match(styles, /\.usage-trigger-copy\s*\{\s*display:\s*none/u);
  assert.doesNotMatch(html, /brand-convergence|Agent 执行空间|本地运行|>工作台<|>历史会话<|本地 Preview 数据|密钥与普通会话分离保存/u);
  assert.match(html, /id="sessionTitleButton"[\s\S]*id="sessionPath"/u);
  assert.match(html, /id="sessionTitleInlineInput"/u);
  assert.match(app, /beginInlineRename|commitInlineRename/u);
  for (const id of ["plainSessionButton", "newSessionButton", "schedulerButton", "skillsButton", "extensionsButton"]) {
    assert.match(html, new RegExp(`id="${id}"`, "u"));
  }
  assert.match(html, /id="changeDrawerButton"[^>]*aria-expanded="false"/u);
  assert.match(html, /id="changesPane"/u);
  assert.match(changes, /presentation\?\.kind\?\.startsWith\("project-"\)/u);
  assert.match(changes, /presentation\.patch/u);
  assert.match(styles, /\.workspace-grid[\s\S]*grid-template-columns:\s*var\(--rail-width\) minmax\(0, 1fr\) 0/u);
  assert.match(styles, /\.workspace-grid\.inspector-open[\s\S]*var\(--context-width\)/u);
  assert.match(styles, /@media \(max-width:\s*1179px\)[\s\S]*\.workspace-grid[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/u);
  assert.match(sessions, /session-actions-trigger/u);
  assert.match(styles, /\.session-action\s*\{[^}]*width:\s*28px[^}]*height:\s*28px/su);
  assert.match(styles, /\.token-usage-popover \.usage-token-row strong\s*\{[^}]*overflow:\s*visible[^}]*text-overflow:\s*clip[^}]*white-space:\s*normal/su);
  assert.match(styles, /@media \(max-height:\s*760px\)[\s\S]*max-height:\s*calc\(100vh - 144px\)/u);
  assert.match(sessions, /默认会话/u);
  assert.match(sessions, /projectAccess\?\.enabled/u);
  assert.doesNotMatch(sessions, /正在进行/u);
});

test("v0.15 composer reveals keyboard help only while the user is composing", async () => {
  const html = await readFile("src/renderer/shell/index.html", "utf8");
  const composer = await readFile("src/renderer/composer/composer.js", "utf8");
  assert.match(html, /id="composerShortcutHint"[^>]*class="composer-shortcut-hint hidden"/u);
  assert.match(composer, /updateShortcutHint/u);
  assert.match(composer, /elements\.input\.addEventListener\("input"/u);
  assert.doesNotMatch(html, /id="emptyTokenStatus"|class="usage-trigger"/u);
  assert.match(html, /id="tokenUsageButton"[^>]*class="context-block-meter hidden"|class="context-block-meter hidden" id="tokenUsageButton"/u);
});

test("v0.15 tasks expose real fixed-model and smart-routing choices", async () => {
  const html = await readFile("src/renderer/shell/index.html", "utf8");
  const scheduleContracts = await readFile("src/core/scheduler-contracts.ts", "utf8");
  const scheduler = await readFile("src/features/scheduler/scheduler-service.ts", "utf8");
  assert.match(html, /id="scheduleModelMode"/u);
  assert.match(html, /id="scheduleModel"/u);
  assert.match(html, /id="scheduleRoutingStrategy"/u);
  assert.match(scheduleContracts, /modelSelection\?/u);
  assert.match(scheduler, /definition\.modelSelection/u);
  assert.match(scheduler, /routing:/u);
});

test("v0.15 capability chooser shows the mode and primary abilities before details", async () => {
  const center = await readFile("src/renderer/composition/composition-center.js", "utf8");
  assert.match(center, /composition-primary-abilities/u);
  assert.match(center, /能力详情/u);
  assert.doesNotMatch(center, /建议模型：/u);
});
