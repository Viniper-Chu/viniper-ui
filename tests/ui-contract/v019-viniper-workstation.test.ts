import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("v0.19 exposes two fixed first-level Agents with shared controls and one desktop port", async () => {
  const html = await readFile("src/renderer/shell/index.html", "utf8");
  const app = await readFile("src/renderer/shell/app.js", "utf8");
  const conversation = await readFile("src/renderer/conversation/conversation.js", "utf8");
  const tokenPulse = await readFile("src/renderer/telemetry/token-pulse.js", "utf8");
  const styles = await readFile("src/renderer/styles/v019-viniper-workstation.css", "utf8");
  const api = await readFile("src/platform/desktop/api-contract.ts", "utf8");
  const preload = await readFile("src/platform/desktop/preload.ts", "utf8");
  const main = await readFile("src/platform/desktop/main.ts", "utf8");
  const sessionSelection = await readFile("src/renderer/sessions/agent-session-selection.js", "utf8");

  assert.equal((html.match(/data-agent-engine=/gu) ?? []).length, 2);
  assert.match(html, /data-agent-engine="viniper"[\s\S]*<strong>Viniper<\/strong>/u);
  assert.match(html, /data-agent-engine="claude-code"[\s\S]*<strong>Claude code<\/strong>/u);
  for (const id of ["plainSessionButton", "newSessionButton", "titlebarSettingsButton", "sessionEngineBadge"]) {
    assert.match(html, new RegExp(`id="${id}"`, "u"));
  }
  for (const id of ["agentSettingsContext", "agentSettingsName", "agentSettingsStatus", "agentSettingsFacts"]) {
    assert.match(html, new RegExp(`id="${id}"`, "u"));
  }
  assert.match(app, /api\.createSession\(selectedEngineId\)/u);
  assert.match(app, /api\.chooseProjectSession\(selectedEngineId\)/u);
  assert.match(app, /sessions\.filter\(\(session\) => engineIdFor\(session\) === selectedEngineId\)/u);
  assert.match(app, /preferredStartupSession\(initialSnapshot\.sessions, initialSnapshot\.activeSessionId\)/u);
  assert.match(app, /preferredEmptySession\(state\.sessions, engineId\)/u);
  assert.match(sessionSelection, /messages\.length === 0/u);
  const selectionModule = await new Function("specifier", "return import(specifier)")(
    `data:text/javascript;base64,${Buffer.from(sessionSelection).toString("base64")}`,
  ) as {
    preferredStartupSession: (sessions: Array<Record<string, unknown>>, activeId: string) => Record<string, unknown> | null;
    preferredEmptySession: (sessions: Array<Record<string, unknown>>, engineId: string) => Record<string, unknown> | null;
  };
  const viniperHistory = { id: "viniper-history", engineId: "viniper", messages: [{ text: "old" }] };
  const viniperEmpty = { id: "viniper-empty", engineId: "viniper", messages: [] };
  const claudeEmpty = { id: "claude-empty", engineId: "claude-code", messages: [] };
  assert.equal(selectionModule.preferredStartupSession([viniperHistory, viniperEmpty, claudeEmpty], viniperHistory.id)?.id, "viniper-empty");
  assert.equal(selectionModule.preferredEmptySession([viniperHistory, viniperEmpty, claudeEmpty], "claude-code")?.id, "claude-empty");
  assert.match(app, /renderAgentSettingsContext\(engine\)/u);
  assert.match(app, /认证模式.*API key.*安全存储/u);
  assert.match(app, /浏览器登录.*不使用/u);
  assert.match(app, /API-key 状态/u);
  assert.match(app, /通用 Provider 控件与位置保持一致/u);
  assert.match(app, /context\.dataset\.agent = selectedEngineId/u);
  assert.match(api, /createSession\(engineId\?: AgentEngineId\)/u);
  assert.match(preload, /createSession:\s*\(engineId\).*agent:create-session/u);
  assert.match(main, /agent:create-session[\s\S]*desktopApplication\.createSession\(engineId\)/u);
  assert.doesNotMatch(html, /quick-grid|quick-card|常用能力矩阵/u);
  assert.match(html, /id="composerTokenButton"/u);
  assert.match(html, /id="composerTokenRing"/u);
  assert.match(html, /id="emptyTokenBlocks"/u);
  const emptyState = html.match(/<div class="empty-state"[\s\S]*?<\/div>\s*<div class="message-list"/u)?.[0] ?? "";
  assert.doesNotMatch(emptyState, /未提供/u);
  assert.equal((emptyState.match(/<i><\/i>/gu) ?? []).length, 16);
  assert.equal((app.match(/renderConversation\(\$\("#messageList"/gu) ?? []).length, 1);
  assert.match(conversation, /reasoning-block/u);
  assert.match(app, /renderConversation\(\$\("#messageList"[\s\S]*?providerLabel,[\s\S]*?telemetry:/u);
  assert.match(conversation, /projectConversationSegments/u);
  assert.match(conversation, /thinking-panel/u);
  assert.match(conversation, /thinking-complete-summary/u);
  assert.match(conversation, /tool-summary/u);
  assert.match(conversation, /artifact-summary/u);
  assert.match(conversation, /message-trace-rail/u);
  assert.doesNotMatch(conversation, /engineId|selectedEngine/u);
  assert.match(tokenPulse, /emptyBlocks/u);
  assert.match(tokenPulse, /composerRing/u);
  assert.match(tokenPulse, /circleValue/u);
  assert.match(tokenPulse, /blockFill:\s*visible\s*\?\s*Math\.min\(16[\s\S]*:\s*0/u);
  assert.match(tokenPulse, /circleValue:\s*visible[\s\S]*:\s*"0"/u);
  assert.match(app, /renderTokenPulse\([\s\S]*state\.telemetry, session\.id\)/u);
  assert.match(styles, /\.context-blocks i\.is-filled:nth-child\(n\+13\)/u);
});

test("R5 shared conversation projection keeps pending/completed shell and restart redraw stable for both Agents", async () => {
  const source = await readFile("src/renderer/conversation/conversation.js", "utf8");
  const specifier = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const module = await new Function("specifier", "return import(specifier)")(specifier) as {
    projectConversationSegments: (session: Record<string, unknown>, options?: Record<string, unknown>) => Record<string, any>;
  };
  const activityThinking = {
    id: "thinking-r5",
    kind: "thinking",
    title: "Agent 推理",
    detail: "先检查隔离 fixture。",
    status: "running",
    runId: "run-r5",
    createdAt: 1000,
  };
  const activityTool = {
    id: "tool-r5",
    kind: "tool",
    title: "Agent · demo.read-only-preview",
    detail: "正在读取隔离 fixture。",
    status: "running",
    toolName: "demo.read-only-preview",
    callId: "call-r5",
    runId: "run-r5",
    createdAt: 1400,
  };
  const base = {
    id: "session-r5",
    messages: [
      { id: "user-r5", role: "user", text: "R5 fixture", createdAt: 1000 },
      { id: "assistant-r5", role: "assistant", text: "第一段第二段", createdAt: 1600, status: "streaming" },
    ],
    activities: [activityThinking, activityTool],
    events: [
      { id: "e1", sessionId: "session-r5", type: "run.started", timestamp: 1000, payload: { runId: "run-r5" } },
      { id: "e2", sessionId: "session-r5", type: "message.delta", timestamp: 1600, payload: { messageId: "assistant-r5", text: "第一段", createdAt: 1600 } },
      { id: "e3", sessionId: "session-r5", type: "message.delta", timestamp: 1700, payload: { messageId: "assistant-r5", text: "第二段", createdAt: 1700 } },
    ],
    status: "running",
    activeRunId: "run-r5",
  };
  const telemetry = { sessions: [{ sessionId: "session-r5", cumulative: { total: 42, source: "estimated" } }] };
  const runs = [{ runId: "run-r5", sessionId: "session-r5", status: "running", createdAt: 1000, updatedAt: 3000 }];
  const pendingViniper = module.projectConversationSegments({ ...base, engineId: "viniper" }, { telemetry, runs, now: 2000 });
  const pendingClaude = module.projectConversationSegments({ ...base, engineId: "claude-code" }, { telemetry, runs, now: 2000 });
  assert.equal(pendingViniper.traceStatus, "pending");
  assert.equal(pendingViniper.activities.find((item: any) => item.kind === "tool")?.traceStatus, "pending");
  assert.deepEqual(pendingViniper.messages[1].segments, ["第一段", "第二段"]);
  assert.deepEqual(pendingViniper.messages.map((item: any) => item.segments), pendingClaude.messages.map((item: any) => item.segments));

  const completed = JSON.parse(JSON.stringify(base));
  completed.status = "idle";
  delete completed.activeRunId;
  completed.activities[0].status = "completed";
  completed.activities[1].status = "completed";
  completed.activities[1].detail = "已读取隔离 fixture。";
  completed.activities[1].presentation = {
    kind: "project-diff",
    action: "diff",
    paths: ["fixture/r5.txt"],
    summary: "隔离 fixture 读取结果",
    beforeBytes: 0,
    afterBytes: 24,
  };
  completed.messages[1].status = "completed";
  completed.events.push(
    { id: "e4", sessionId: "session-r5", type: "thinking.completed", timestamp: 2200, payload: { activityId: "thinking-r5" } },
    { id: "e5", sessionId: "session-r5", type: "tool.completed", timestamp: 2400, payload: { activityId: "tool-r5", result: "已读取隔离 fixture。" } },
    { id: "e6", sessionId: "session-r5", type: "run.completed", timestamp: 3000, payload: { runId: "run-r5" } },
  );
  const completedView = module.projectConversationSegments(completed, { telemetry, runs: [{ ...runs[0], status: "completed", updatedAt: 3000 }] });
  assert.equal(completedView.traceStatus, "completed");
  assert.equal(completedView.activities.find((item: any) => item.kind === "tool")?.traceStatus, "success");
  assert.equal(completedView.artifacts.length, 1);
  assert.equal(completedView.durationMs, 2000);
  assert.match(completedView.traceSummary, /42 tokens/u);
  assert.deepEqual(module.projectConversationSegments(completed, { telemetry, runs: [{ ...runs[0], status: "completed", updatedAt: 3000 }] }), completedView);
});

test("v0.19 uses the Viniper sparse structure and Harness circuit-signal visual language", async () => {
  const html = await readFile("src/renderer/shell/index.html", "utf8");
  const styles = await readFile("src/renderer/styles/v019-viniper-workstation.css", "utf8");
  const sessions = await readFile("src/renderer/sessions/session-list.js", "utf8");
  const branding = JSON.parse(await readFile("assets/branding/manifest.json", "utf8")) as {
    status: string;
    variant: string;
    asset: string;
    nativeFallback: string;
    nativeSmall: string;
    windowsIco: string;
  };

  assert.match(html, /data-direction="viniper-workstation"/u);
  assert.match(html, /data-seed="viniper-structure-harness-signal-v019"/u);
  assert.match(styles, /--titlebar-height:\s*48px/u);
  assert.match(styles, /--vw-teal:\s*#0f8b83/iu);
  assert.match(styles, /--vw-mint:\s*#ddf3ef/iu);
  assert.match(styles, /font-family:\s*"Segoe UI Variable Text"/u);
  assert.match(styles, /font-family:\s*Bahnschrift/u);
  assert.match(styles, /font-family:\s*"Cascadia Mono"/u);
  assert.match(styles, /\.engine-signal::before/u);
  assert.match(styles, /\.timeline-entry::after/u);
  assert.match(styles, /\.empty-stage\s*\{[\s\S]*border:\s*0[\s\S]*background:\s*transparent[\s\S]*box-shadow:\s*none/u);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/u);
  assert.doesNotMatch(styles, /transition\s*:\s*all/u);

  assert.doesNotMatch(html, /id="sessionSearch"|placeholder="搜索会话/u);
  assert.doesNotMatch(html, /id="emptyTokenStatus"/u);
  assert.match(html, /class="usage-trigger context-usage-trigger"/u);
  assert.match(html, /class="context-block-meter hidden" id="tokenUsageButton"/u);
  assert.equal((html.match(/<i><\/i>/gu) ?? []).length >= 16, true);
  assert.match(styles, /--rail-width:\s*292px/u);
  assert.match(styles, /\.session-item\s*\{[\s\S]*min-height:\s*42px/u);
  assert.match(styles, /\.sidebar-settings-button\s*\{[^}]*width:\s*30px[^}]*height:\s*30px/u);
  assert.match(styles, /\.context-block-meter\s*\{[\s\S]*position:\s*absolute[\s\S]*left:\s*50%/u);
  assert.match(styles, /\.context-blocks\s*\{[^}]*grid-template-columns:\s*repeat\(16,\s*7px\)/u);
  assert.match(sessions, /<summary class="session-actions-trigger"/u);
  assert.match(styles, /\.sidebar-secondary-action\s*\{\s*display:\s*none/u);

  assert.equal(branding.status, "UNIFIED_3D_NATIVE_SOURCE");
  assert.equal(branding.variant, "circuit-node-3d");
  assert.equal(branding.asset, branding.nativeFallback);
  assert.equal(branding.asset, "viniper-harness-circuit-node.png");
  for (const image of html.matchAll(/<img[^>]*src="([^"]+)"/gu)) {
    assert.match(image[1], /viniper-harness-circuit-node\.png/u);
  }
  assert.equal(branding.nativeSmall, "viniper-harness-circuit-node-32.png");
  assert.equal(branding.windowsIco, "viniper-harness-circuit-node.ico");
});
