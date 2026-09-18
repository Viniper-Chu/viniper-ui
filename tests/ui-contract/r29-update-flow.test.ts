import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "resources/viniper-ui/static/app.js"), "utf8");
const html = readFileSync(join(process.cwd(), "resources/viniper-ui/static/index.html"), "utf8");
const css = readFileSync(join(process.cwd(), "resources/viniper-ui/static/style.css"), "utf8");
function functionSource(name: string): string {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}
function response(data: any, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => data }; }
function setup() {
  const nodes = new Map<string, any>();
  const timers = new Map<number, () => unknown>();
  let nextTimer = 0;
  const document: any = { activeElement: null };
  const node = (selector: string) => {
    if (!nodes.has(selector)) {
      const classes = new Set<string>(selector === "#update-modal" ? ["hidden"] : []);
      const attrs = new Map<string, string>();
      const value: any = { textContent: "", disabled: false, dataset: {}, attrs, focused: 0,
        classList: { add: (...keys: string[]) => keys.forEach((key) => classes.add(key)), remove: (...keys: string[]) => keys.forEach((key) => classes.delete(key)), contains: (key: string) => classes.has(key), toggle: (key: string, on: boolean) => on ? classes.add(key) : classes.delete(key) },
        setAttribute: (key: string, val: string) => attrs.set(key, val), removeAttribute: (key: string) => attrs.delete(key),
        focus: () => { value.focused += 1; document.activeElement = value; }, querySelectorAll: () => [],
      };
      nodes.set(selector, value);
    }
    return nodes.get(selector);
  };
  const state: any = { viewMode: "viniper", status: { version: "1.8.0" }, messages: [{ text: "preserved" }], updateInfo: null, updateFlow: { checking: false, busy: "", snapshot: null, error: "", pollTimer: null, returnFocus: null } };
  const requests: any[] = [];
  const responses: any[] = [];
  const sandbox: any = { state, document, window: {}, console, AbortController, $: node,
    setTimeout: (fn: () => unknown) => { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout: (id: number) => timers.delete(id),
    fetch: async (url: string, options: any) => {
      requests.push({ url, method: options.method, body: options.body });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      assert.ok(next, `unexpected request ${url}`);
      return next;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(["renderUpdateButton", "requestUpdate", "checkForUpdates", "showUpdateModal", "closeUpdateModal", "handleUpdateModalKeydown", "updateSizeLabel", "renderUpdateModal", "scheduleUpdateStatusPoll", "refreshUpdateStatus", "installUpdate"].map(functionSource).join("\n"), sandbox);
  return { sandbox, state, node, document, requests, responses, timers };
}
const available = { ok: true, configured: true, current_version: "1.8.0", latest_version: "1.8.2", update_available: true, notes: "修复并更新。" };

test("R29 startup check records a real available update without opening a modal", async () => {
  const ctx = setup();
  ctx.responses.push(response(available), response({ status: "idle" }));
  await ctx.sandbox.checkForUpdates({ silent: true });
  assert.equal(ctx.node("#update-modal").classList.contains("hidden"), true);
  assert.match(ctx.node("#update-btn").textContent, /v1\.8\.0 · 查看新版本/);
  assert.equal(ctx.node("#cancel-update-btn").focused, 0);
  assert.equal(ctx.node("#settings-check-update-btn").disabled, false);
});

test("R29 manual HTTP failure is visible, never reported as latest, and can be retried", async () => {
  const ctx = setup();
  ctx.responses.push(response({ detail: "GitHub 暂时不可用" }, 502));
  await ctx.sandbox.checkForUpdates();
  assert.equal(ctx.node("#update-modal").classList.contains("hidden"), false);
  assert.match(ctx.node("#update-feedback").textContent, /检查更新失败.*GitHub 暂时不可用/);
  assert.doesNotMatch(ctx.node("#settings-update-status").textContent, /最新版本/);
  assert.equal(ctx.node("#install-update-btn").disabled, false);
  ctx.responses.push(response({ ...available, update_available: false, latest_version: "1.8.0", message: "当前已经是最新正式版。" }), response({ status: "idle" }));
  await ctx.sandbox.installUpdate();
  assert.match(ctx.node("#update-feedback").textContent, /当前已经是最新正式版/);
});

test("R29 duplicate check clicks share the active request", async () => {
  const ctx = setup();
  let resolve!: (value: any) => void;
  const pending = new Promise((done) => { resolve = done; });
  ctx.responses.push(pending, response({ status: "idle" }));
  const checking = ctx.sandbox.checkForUpdates();
  await ctx.sandbox.checkForUpdates();
  assert.equal(ctx.requests.length, 1);
  resolve(response(available));
  await checking;
  assert.equal(ctx.requests.length, 2);
});

test("R29 HTTP 200 with an application error or malformed JSON still reports failure", async () => {
  for (const result of [response({ ok: false, message: "安装包尚未发布" }), { ok: true, json: async () => { throw new Error("invalid JSON"); } }]) {
    const ctx = setup();
    ctx.responses.push(result);
    await ctx.sandbox.checkForUpdates();
    assert.match(ctx.node("#update-feedback").textContent, /检查更新失败/);
    assert.equal(ctx.state.updateInfo, null);
    assert.equal(ctx.node("#install-update-btn").disabled, false);
  }
});

test("R29 update progress is derived only from backend byte counters", () => {
  const ctx = setup();
  ctx.state.updateInfo = available;
  ctx.state.updateFlow.snapshot = { status: "downloading", downloaded_bytes: 262144, total_bytes: 1048576, progress_percent: 99 };
  ctx.sandbox.renderUpdateModal();
  assert.equal(ctx.node("#update-progress").value, 262144);
  assert.equal(ctx.node("#update-progress").max, 1048576);
  assert.equal(ctx.node("#update-progress-label").textContent, "256 KB / 1.0 MB");
  assert.equal(ctx.node("#install-update-btn").disabled, true);
  assert.equal(ctx.node("#cancel-update-btn").disabled, false);
  ctx.state.updateFlow.snapshot.total_bytes = 0;
  ctx.node("#update-progress").attrs.set("value", "90");
  ctx.sandbox.renderUpdateModal();
  assert.equal(ctx.node("#update-progress").attrs.has("value"), false);
  assert.equal(ctx.node("#update-progress-label").textContent, "已下载 256 KB");
});

test("R29 downloaded package requires a second explicit install click", async () => {
  const ctx = setup();
  ctx.state.updateInfo = available;
  ctx.responses.push(response({ ok: true, started: true, status: "downloading" }), response({ ok: true, status: "ready", downloaded_bytes: 100, total_bytes: 100, latest_version: "1.8.2" }));
  await ctx.sandbox.installUpdate();
  assert.deepEqual(ctx.requests.map((r) => r.url), ["/api/update/install", "/api/update/status"]);
  assert.equal(ctx.node("#install-update-btn").textContent, "安装更新");
  assert.equal(ctx.timers.size, 0);
  ctx.responses.push(response({ ok: true, status: "installer_opened", installer_opened: true, updated: false }));
  await ctx.sandbox.installUpdate();
  assert.equal(ctx.requests[2].url, "/api/update/apply");
  assert.match(ctx.node("#update-feedback").textContent, /请先从托盘退出/);
  assert.doesNotMatch(ctx.node("#update-feedback").textContent, /更新已安装|更新完成/);
  assert.equal(ctx.state.status.version, "1.8.0");
});

test("R29 active-task install refusal retains downloaded package and supports retry", async () => {
  const ctx = setup();
  ctx.state.updateInfo = available;
  ctx.state.updateFlow.snapshot = { status: "ready", latest_version: "1.8.2" };
  ctx.responses.push(response({ detail: "仍有任务正在运行，请先完成任务。" }, 409));
  await ctx.sandbox.installUpdate();
  assert.equal(ctx.state.updateFlow.snapshot.status, "ready");
  assert.match(ctx.node("#update-feedback").textContent, /仍有任务正在运行/);
  assert.equal(ctx.node("#install-update-btn").textContent, "安装更新");
  assert.equal(ctx.node("#install-update-btn").disabled, false);
  assert.equal(ctx.requests.length, 1);
  assert.deepEqual(ctx.state.messages, [{ text: "preserved" }]);
});

test("R29 native installation uses the fixed desktop bridge rather than a duplicate HTTP apply", async () => {
  const ctx = setup();
  ctx.state.updateInfo = available;
  ctx.state.updateFlow.snapshot = { status: "ready" };
  let called = 0;
  ctx.sandbox.window.viniperDesktop = { installAppUpdate: async () => { called += 1; return { ok: true, status: "installer_opened", installer_opened: true, desktop_quit_requested: true, updated: false }; } };
  ctx.sandbox.renderUpdateModal();
  assert.match(ctx.node("#update-install-hint").textContent, /退出工作台/);
  await ctx.sandbox.installUpdate();
  assert.equal(called, 1);
  assert.equal(ctx.requests.length, 0);
  assert.match(ctx.node("#update-feedback").textContent, /工作台即将退出/);
  assert.equal(ctx.node("#install-update-btn").textContent, "安装器已打开");
});

test("R29 native bridge refusal cannot become a false successful installation", async () => {
  const ctx = setup();
  ctx.state.updateInfo = available;
  ctx.state.updateFlow.snapshot = { status: "ready" };
  ctx.sandbox.window.viniperDesktop = { installAppUpdate: async () => ({ ok: false, detail: "仍有 Claude Code 任务正在运行" }) };
  await ctx.sandbox.installUpdate();
  assert.equal(ctx.state.updateFlow.snapshot.status, "ready");
  assert.match(ctx.node("#update-feedback").textContent, /仍有 Claude Code 任务/);
  assert.equal(ctx.node("#install-update-btn").disabled, false);
});

test("R29 repeated install clicks do not launch two native installers", async () => {
  const ctx = setup();
  ctx.state.updateInfo = available;
  ctx.state.updateFlow.snapshot = { status: "ready" };
  let resolve!: (value: any) => void;
  const pending = new Promise((done) => { resolve = done; });
  let calls = 0;
  ctx.sandbox.window.viniperDesktop = { installAppUpdate: () => { calls += 1; return pending; } };
  const installation = ctx.sandbox.installUpdate();
  await ctx.sandbox.installUpdate();
  assert.equal(calls, 1);
  resolve({ ok: true, status: "installer_opened", installer_opened: true, desktop_quit_requested: true, updated: false });
  await installation;
  assert.equal(ctx.timers.size, 0);
});

test("R29 browser installation keeps polling so a cancelled installer becomes usable again", async () => {
  const ctx = setup();
  ctx.state.updateInfo = available;
  ctx.state.updateFlow.snapshot = { status: "installer_opened", installer_opened: true };
  ctx.sandbox.scheduleUpdateStatusPoll();
  assert.equal(ctx.timers.size, 1);
  ctx.responses.push(response({ status: "ready", installer_opened: false, message: "安装器已关闭，可以再次安装。" }));
  await ctx.sandbox.refreshUpdateStatus();
  assert.equal(ctx.timers.size, 0);
  assert.equal(ctx.node("#install-update-btn").disabled, false);
  assert.equal(ctx.node("#install-update-btn").textContent, "安装更新");
  assert.match(ctx.node("#update-feedback").textContent, /安装器已关闭/);
});

test("R29 download-status connection failure allows recovery without another download", async () => {
  const ctx = setup();
  ctx.state.updateInfo = available;
  ctx.state.updateFlow.snapshot = { status: "downloading", downloaded_bytes: 32, total_bytes: 100 };
  ctx.responses.push(new Error("offline"));
  await ctx.sandbox.refreshUpdateStatus();
  assert.equal(ctx.node("#install-update-btn").textContent, "重试连接");
  assert.equal(ctx.node("#install-update-btn").disabled, false);
  ctx.responses.push(response({ status: "ready", downloaded_bytes: 100, total_bytes: 100 }));
  await ctx.sandbox.installUpdate();
  assert.deepEqual(ctx.requests.map((r) => r.url), ["/api/update/status", "/api/update/status"]);
  assert.equal(ctx.node("#install-update-btn").textContent, "安装更新");
  assert.equal(ctx.timers.size, 0);
});

test("R29 failed download exposes a real retry and closing the modal does not cancel background work", async () => {
  const ctx = setup();
  ctx.state.updateInfo = available;
  ctx.state.updateFlow.snapshot = { status: "failed", message: "连接中断", retryable: true };
  ctx.sandbox.renderUpdateModal();
  assert.equal(ctx.node("#install-update-btn").textContent, "重新下载");
  ctx.node("#settings-check-update-btn").focus();
  ctx.sandbox.showUpdateModal();
  ctx.state.updateFlow.snapshot.status = "downloading";
  ctx.sandbox.closeUpdateModal();
  assert.equal(ctx.node("#update-modal").classList.contains("hidden"), true);
  assert.equal(ctx.state.updateFlow.snapshot.status, "downloading");
  assert.equal(ctx.document.activeElement, ctx.node("#settings-check-update-btn"));
  assert.equal(ctx.requests.length, 0);
});

test("R29 update entry remains visible in both Agents and modal overlays settings accessibly", () => {
  const ctx = setup();
  for (const mode of ["viniper", "claude"]) {
    ctx.state.viewMode = mode;
    ctx.sandbox.renderUpdateModal();
    assert.equal(ctx.node("#settings-check-update-btn").textContent, "检查更新");
    assert.match(ctx.node("#update-btn").textContent, /检查更新/);
  }
  assert.match(html, /id="update-progress" aria-label="更新下载进度"/);
  assert.match(html, /id="update-feedback"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(css, /#update-modal\s*\{\s*z-index: 1100/);
  assert.doesNotMatch(functionSource("syncCurrentSessionRuntimeUi"), /"#update-btn"/);
  assert.doesNotMatch(functionSource("installUpdate"), /waitForAppRestart|location\.reload|state\.status\.version\s*=/);
});
