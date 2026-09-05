import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "resources/viniper-ui/static/app.js"), "utf8");
test("R28 model capacity is visibly read-only because verified backend metadata is authoritative", () => {
  const ctx = setup();
  ctx.node("#settings-models").value = "deepseek-v4-pro[1m] | DeepSeek V4 Pro | 1048576";
  ctx.sandbox.renderSettingsModelRows();
  assert.match(ctx.node("#settings-model-table").innerHTML, /data-model-field="context"[^>]*readonly/);
  assert.match(ctx.node("#settings-model-table").innerHTML, /自动识别/);
});
function functionSource(name: string): string {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}
function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((done) => { resolve = done; });
  return { promise, resolve };
}
function setup() {
  const nodes = new Map<string, any>();
  const node = (selector: string) => {
    if (!nodes.has(selector)) {
      const classes = new Set<string>();
      nodes.set(selector, { value: "", textContent: "", innerHTML: "", checked: false, disabled: false,
        classList: { add: (...keys: string[]) => keys.forEach((key) => classes.add(key)), remove: (...keys: string[]) => keys.forEach((key) => classes.delete(key)), contains: (key: string) => classes.has(key), toggle: () => {} },
        dataset: {}, setAttribute() {}, removeAttribute() {}, focus() {}, querySelector: () => null,
      });
    }
    return nodes.get(selector);
  };
  const state: any = { viewMode: "viniper", settingsView: { mode: "viniper", generation: 1 }, settings: { account: { signed_in: false }, runtime: {} }, status: {}, agentInstructions: { content: "original" }, selectedModel: "model-a", permissionMode: "ask", navigation: {} };
  const owners: any = { viniper: { settings: state.settings, agentInstructions: state.agentInstructions, selectedModel: "model-a", status: {} }, claude: { settings: { provider: { model: "kimi" } }, agentInstructions: { content: "claude instructions" }, selectedModel: "kimi", status: {} } };
  const requests: any[] = [];
  const responses: any[] = [];
  const sandbox: any = { state, document: {}, window: {}, console, Map, Set, Object, encodeURIComponent,
    $: node, $$: () => [], modeOwnedState: (mode: string) => owners[mode],
    fetch: async (url: string, options?: any) => { requests.push({ url, body: options?.body ? JSON.parse(options.body) : undefined }); const next = responses.shift(); return next instanceof Promise ? next : (next || response({})); },
    FONT_SIZE_OPTIONS: [], escapeAttr: String, escapeHtml: String,
  };
  for (const name of ["closeAccountMenu", "closeSkillsView", "renderSettingsPermissionOptions", "renderRuntimeSettings", "filterSettingsCenter", "activateSettingsSection", "updateModeChrome", "setNavigationLocation", "loadHarnessSnapshot", "loadHarnessCapabilities", "loadHarnessConfigurationMatrix", "renderHarnessSettings", "applySettingsFromServer", "rememberModel", "renderModelSelect", "renderPermissionSelect", "updateModelLabels", "updateContextMeter", "restorePreviousDurableLocation"]) sandbox[name] = () => {};
  sandbox.normalizeSettingsSection = (section: string) => section;
  vm.createContext(sandbox);
  vm.runInContext(`const settingsSaves = new Map();\n${["settingsViewToken", "settingsViewIsCurrent", "settingsResponse", "modelsToText", "parseModelsText", "renderSettingsOptions", "renderSettingsModelSelect", "renderSettingsModelRows", "openSettingsModal", "closeSettingsModal", "saveAgentInstructions", "saveSettings", "testProviderConnection", "markSettingsDirty", "clearSettingsDirty"].map(functionSource).join("\n")}`, sandbox);
  return { sandbox, state, owners, requests, responses, node };
}
function response(data: any, ok = true) { return { ok, json: async () => data }; }
function fields(ctx: ReturnType<typeof setup>) {
  ctx.node("#settings-models").value = "model-a | Model A | 200000";
  ctx.node("#agent-md-editor").value = "Viniper edited instructions";
  ctx.node("#settings-provider-model").value = "model-a";
  ctx.node("#save-settings-btn").textContent = "保存";
}

test("R28 delayed settings open cannot project into another Agent or reopen a closed view", async () => {
  for (const close of [false, true]) {
    const ctx = setup();
    const pending = deferred();
    ctx.responses.push(pending.promise, response({ content: "Viniper instructions" }), response({ runtime: {} }));
    const opening = ctx.sandbox.openSettingsModal();
    if (close) ctx.sandbox.closeSettingsModal({ restoreNavigation: false });
    else { ctx.state.viewMode = "claude"; ctx.state.settings = ctx.owners.claude.settings; }
    pending.resolve(response({ settings: { provider: { model: "viniper-model" } } }));
    await opening;
    assert.notEqual(ctx.state.settings?.provider?.model, "viniper-model");
    assert.notEqual(ctx.node("#agent-md-editor").value, "Viniper instructions");
    if (close) assert.equal(ctx.node("#settings-modal").classList.contains("hidden"), true);
  }
});

test("R28 save captures Agent, secret target and instructions before any awaited request", async () => {
  const ctx = setup(); fields(ctx);
  const pending = deferred();
  const secretTargets: string[] = [];
  ctx.node("#settings-api-key").value = "synthetic-test-value";
  ctx.sandbox.window.viniperDesktop = { saveProviderSecret: async (mode: string) => { secretTargets.push(mode); return pending.promise; } };
  ctx.responses.push(response({ settings: { provider: { model: "model-a" } }, models: [] }), response({ content: "Viniper edited instructions", path: "viniper/AGENT.md" }));
  const saving = ctx.sandbox.saveSettings();
  ctx.sandbox.closeSettingsModal({ restoreNavigation: false });
  ctx.state.viewMode = "claude"; ctx.state.settings = ctx.owners.claude.settings; ctx.state.agentInstructions = ctx.owners.claude.agentInstructions;
  ctx.node("#agent-md-editor").value = "Claude must remain unchanged";
  pending.resolve({ ok: true });
  await saving;
  assert.deepEqual(secretTargets, ["viniper"]);
  assert.equal(ctx.requests.find((item) => item.url === "/api/settings")?.body.mode, "viniper");
  const instructions = ctx.requests.find((item) => item.url === "/api/agent-instructions")?.body;
  assert.equal(instructions?.mode, "viniper");
  assert.equal(instructions?.content, "Viniper edited instructions");
  assert.equal(ctx.state.settings.provider.model, "kimi");
  assert.equal(ctx.state.agentInstructions.content, "claude instructions");
});

test("R28 empty model list is a visible validation error, never an invented DeepSeek default", async () => {
  const ctx = setup(); fields(ctx); ctx.node("#settings-models").value = "";
  await assert.doesNotReject(ctx.sandbox.saveSettings());
  assert.equal(ctx.requests.length, 0);
  assert.match(ctx.node("#settings-save-status").textContent, /至少|添加.*模型/);
});

test("R28 delayed connection test cannot rewrite another Agent connection status", async () => {
  const ctx = setup(); const pending = deferred(); ctx.responses.push(pending.promise);
  const testing = ctx.sandbox.testProviderConnection();
  ctx.state.viewMode = "claude"; ctx.state.settingsView = { mode: "claude", generation: 2 };
  ctx.node("#settings-provider-test-status").textContent = "Claude 未测试";
  pending.resolve(response({ configured: true, status: "connected" }));
  await testing;
  assert.equal(ctx.requests[0].url, "/api/provider/test?mode=viniper");
  assert.equal(ctx.node("#settings-provider-test-status").textContent, "Claude 未测试");
});

function nativeSetup() {
  const ctx = setup();
  ctx.state.viewMode = "claude"; ctx.state.sessionId = "claude-fixture";
  const uiActions: string[] = [];
  Object.assign(ctx.sandbox, {
    slashCommandsForMode: () => [{command:"/model",execution:"native-ui",ui_action:"model"},{command:"/custom:workflow",execution:"native-terminal"}],
    modeProjectionToken: (mode: string, sessionId: string) => ({mode,sessionId}),
    modeProjectionIsCurrent: (token: any) => token.mode === ctx.state.viewMode && token.sessionId === ctx.state.sessionId,
    openClaudeCommandUi: (action: string) => uiActions.push(action),
    showNativeCommandStatus: () => uiActions.push("native-window"),
    showInlineStatus: () => uiActions.push("inline-status"),
    SessionRunRegistry: {get: () => null}, autoResize() {}, hideSlashSuggestions() {},
    addMessage: () => { throw new Error("Command routes must not fabricate messages"); },
  });
  vm.runInContext(["executeClaudeNativeSlashCommand", "executeWorkspaceSlashCommand", "sendMessageForSession"].map(functionSource).join("\n"), ctx.sandbox);
  return {...ctx, uiActions};
}

test("R28 manifest command opens actual UI without fabricated assistant completion", async () => {
  const ctx = nativeSetup();
  ctx.responses.push(response({execution:"native-ui",ui_action:"model"}));
  assert.equal(await ctx.sandbox.executeClaudeNativeSlashCommand("/model"), true);
  assert.deepEqual(ctx.uiActions,["model"]);
  assert.equal(ctx.requests[0].body.command,"/model");
  ctx.responses.push(response({execution:"native-terminal",status:"native_terminal_opened",command_to_type:"/custom:workflow"}));
  assert.equal(await ctx.sandbox.executeClaudeNativeSlashCommand("/custom:workflow"),true);
  assert.deepEqual(ctx.uiActions,["model","native-window"]);
});

test("R28 delayed slash result cannot open UI or clear the other Agent draft", async () => {
  const ctx = nativeSetup(); const pending = deferred(); ctx.responses.push(pending.promise);
  ctx.node("#user-input").value = "/model";
  const sending = ctx.sandbox.sendMessageForSession();
  ctx.state.viewMode = "viniper"; ctx.state.sessionId = "viniper-fixture";
  ctx.node("#user-input").value = "Viniper draft survives";
  pending.resolve(response({execution:"native-ui",ui_action:"model"}));
  await sending;
  assert.deepEqual(ctx.uiActions,[]);
  assert.equal(ctx.node("#user-input").value,"Viniper draft survives");
  assert.equal(ctx.requests[0].url,"/api/claude-native-commands/claude-fixture");
});

test("R28 native command error keeps the draft for retry and displays the failure", async () => {
  const ctx = nativeSetup(); ctx.node("#user-input").value = "/model";
  ctx.responses.push(response({ok:false,detail:"Native connection failed"},false));
  await ctx.sandbox.sendMessageForSession();
  assert.equal(ctx.node("#user-input").value,"/model");
  assert.deepEqual(ctx.uiActions,["inline-status"]);
});

test("R28 project response arriving after Agent switch cannot replace another owner files", async () => {
  const ctx = nativeSetup();
  ctx.state.workspaceRequestGeneration = 0;
  ctx.state.projectIndexEntries = ["Claude original"];
  vm.runInContext(functionSource("openWorkspaceTab"),ctx.sandbox);
  const pending = deferred(); ctx.responses.push(pending.promise);
  const opening = ctx.sandbox.openWorkspaceTab("project");
  ctx.state.viewMode = "viniper"; ctx.state.sessionId = "viniper-fixture";
  ctx.state.projectIndexEntries = ["Viniper files"];
  pending.resolve(response({ok:true,root:"claude-root",entries:[{path:"claude-only.txt"}]}));
  await opening;
  assert.deepEqual(ctx.state.projectIndexEntries,["Viniper files"]);
  assert.doesNotMatch(ctx.node("#workspace-browser-area").innerHTML,/claude-only/);
});
