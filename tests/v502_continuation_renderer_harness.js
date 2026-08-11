"use strict";

// Offline Chromium proof for the continuation fixes.  The window uses only
// synthetic messages and a mocked fetch; it never opens the formal/Preview
// data roots or a provider.
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();
const evidenceRoot = process.env.VINIPER_V502_CONTINUATION_EVIDENCE_ROOT;
if (!evidenceRoot) throw new Error("VINIPER_V502_CONTINUATION_EVIDENCE_ROOT is required");
fs.mkdirSync(evidenceRoot, { recursive: true });
const resultPath = path.join(evidenceRoot, "continuation-renderer-result.json");
let resultWritten = false;

function writeResultOnce(payload) {
  if (resultWritten) return;
  resultWritten = true;
  try { fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), "utf8"); } catch {}
}
function delay(ms = 80) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function fixtureMessages(label) {
  return Array.from({ length: 64 }, (_, index) => {
    const role = index % 2 === 0 ? "user" : "assistant";
    const content = `${label} 第 ${index + 1} 轮消息\n用于轨迹固定与定位验证`;
    return role === "assistant"
      ? { role, content, segments: [{ type: "text", content }] }
      : { role, content };
  });
}

async function dispatchWheel(win, rect, deltaY) {
  if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach("1.3");
  const x = Math.round((rect.left + rect.right) / 2);
  const y = Math.round((rect.top + rect.bottom) / 2);
  await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
  await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY });
  await delay(100);
}

async function prepareWindow(width, height) {
  const root = path.resolve(__dirname, "..");
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    titleBarOverlay: process.platform === "win32" ? { color: "#f5f3ee", symbolColor: "#302f2b", height: 32 } : undefined,
    webPreferences: { backgroundThrottling: false },
  });
  await win.loadFile(path.join(root, "static", "index.html"));
  await win.webContents.insertCSS(fs.readFileSync(path.join(root, "static", "style.css"), "utf8"));
  const source = fs.readFileSync(path.join(root, "static", "app.js"), "utf8");
  await win.webContents.executeJavaScript(`${source}
    ;globalThis.__V502_CONTINUATION__ = { bindEvents, messageTemplate };
    ;void 0;
    //# sourceURL=viniper-v502-continuation-app.js`);
  await win.webContents.executeJavaScript(`(() => {
    const api = globalThis.__VINIPER_TEST_API__;
    window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, sessions: [], items: [], peer: { available: false, targets: [] } }) });
    globalThis.__V502_CONTINUATION__.bindEvents();
    api.state.sessionId = "continuation-${width}x${height}";
    api.state.sessionMode = "agent";
    api.state.viewMode = "agent";
    api.state.status = { version: "5.0.2", runtime: { ready: true }, models: [] };
    api.state.messages = ${JSON.stringify(fixtureMessages(`${width}x${height}`))};
    api.setViewMode("agent");
    api.renderAllMessages();
  })()`);
  // loadFile() cannot resolve the product's /static asset URLs. Point only
  // this offline harness at the checked-in original icon so visual evidence
  // does not contain a broken-image placeholder; production URLs are untouched.
  const iconUrl = pathToFileURL(path.join(root, "static", "assets", "viniper-icon.png")).href;
  await win.webContents.executeJavaScript(`(() => {
    const icon = ${JSON.stringify(iconUrl)};
    document.querySelectorAll('img[src^="/static/assets/viniper-icon.png"]').forEach((node) => node.src = icon);
  })()`);
  win.showInactive();
  await delay(140);
  return win;
}

async function runViewport(width, height) {
  const win = await prepareWindow(width, height);
  try {
    const baseline = await win.webContents.executeJavaScript(`(() => {
      const rail = document.querySelector("#message-trace-rail");
      const chat = document.querySelector("#chat-container");
      return {
        rail: rail?.getBoundingClientRect()?.toJSON() || null,
        chat: chat?.getBoundingClientRect()?.toJSON() || null,
        ticks: document.querySelectorAll(".message-trace-tick").length,
        active: document.querySelectorAll(".message-trace-tick.active").length,
        overflowY: getComputedStyle(rail || document.body).overflowY,
      };
    })()`);
    const chatRect = baseline.chat;
    await win.webContents.executeJavaScript(`document.querySelector("#chat-container").scrollTop = document.querySelector("#chat-container").scrollHeight`);
    await delay(80);
    const bottom = await win.webContents.executeJavaScript(`(() => { const r = document.querySelector("#message-trace-rail")?.getBoundingClientRect(); const c = document.querySelector("#chat-container"); return { rail: r?.toJSON() || null, scrollTop: c?.scrollTop || 0 }; })()`);
    await dispatchWheel(win, chatRect, -12000);
    const afterScroll = await win.webContents.executeJavaScript(`(() => { const r = document.querySelector("#message-trace-rail")?.getBoundingClientRect(); const c = document.querySelector("#chat-container"); return { rail: r?.toJSON() || null, scrollTop: c?.scrollTop || 0, active: document.querySelectorAll(".message-trace-tick.active").length }; })()`);
    const durationHtml = await win.webContents.executeJavaScript(`globalThis.__V502_CONTINUATION__.messageTemplate(
      "assistant", "", "最终正文", "", [
        { type: "thinking", content: "不应显示的思考正文", elapsed_seconds: 129 },
        { type: "tool_start", tool_id: "tool-1", summary: "检查", status: "running" },
        { type: "tool_result", tool_id: "tool-1", content: "完成", status: "完成" },
        { type: "text", content: "最终正文" }
      ], { pending: false, elapsed_seconds: 1649, thinking_elapsed_seconds: 129, turn_usage: { input_tokens: 1200, output_tokens: 800, cache_read_input_tokens: 500 } }
    )`);
    const activeDuration = await win.webContents.executeJavaScript(`(async () => {
      const api = globalThis.__VINIPER_TEST_API__;
      const id = "active-duration-${width}x${height}";
      api.state.sessionId = id;
      api.state.sessionMode = "agent";
      api.state.viewMode = "agent";
      api.state.messages = ${JSON.stringify(fixtureMessages(`${width}x${height} active`))};
      const last = api.state.messages[api.state.messages.length - 1];
      last.pending = true;
      last.run_session_id = id;
      last.segments = [{ type: "text", content: "流式输出中的正文" }];
      last.turn_usage = { input_tokens: 1200, output_tokens: 800, cache_read_input_tokens: 500 };
      api.SessionRunRegistry.start(id, { mode: "agent", segments: last.segments, turn_usage: last.turn_usage });
      api.renderAllMessages();
      const beforeNode = document.querySelector('.message.assistant[data-pending="true"] [data-live-total="true"]');
      const before = {
        text: beforeNode?.textContent || "",
        hasTokens: /2.5k tokens/.test(beforeNode?.textContent || ""),
        base: beforeNode?.dataset?.elapsedBase || "",
        renderedAt: beforeNode?.dataset?.renderedAt || "",
        present: Boolean(beforeNode),
      };
      const waitStarted = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 1250));
      const afterNode = document.querySelector('.message.assistant[data-pending="true"] [data-live-total="true"]');
      const activeArticle = document.querySelector('.message.assistant[data-pending="true"]');
      const activeContent = activeArticle?.querySelector('.msg-content');
      const composer = document.querySelector('#composer');
      const dock = document.querySelector('#interaction-dock');
      const overlaps = (a, b) => Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
      const activeRect = afterNode?.getBoundingClientRect?.();
      const composerRect = composer?.getBoundingClientRect?.();
      const dockRect = dock?.getBoundingClientRect?.();
      const after = {
        text: afterNode?.textContent || "",
        hasTokens: /2.5k tokens/.test(afterNode?.textContent || ""),
        base: afterNode?.dataset?.elapsedBase || "",
        renderedAt: afterNode?.dataset?.renderedAt || "",
        present: Boolean(afterNode),
        liveCount: activeArticle?.querySelectorAll('[data-live-total="true"]').length || 0,
        atBottom: Boolean(afterNode && activeContent?.lastElementChild === afterNode),
        overlapsComposer: overlaps(activeRect, composerRect),
        overlapsDock: overlaps(activeRect, dockRect),
      };
      return { before, after, waitMs: Date.now() - waitStarted, textChanged: before.text !== after.text };
    })()`);
    const activeScreenshot = await win.webContents.capturePage();
    const activeScreenshotName = `continuation-${width}x${height}-active.png`;
    fs.writeFileSync(path.join(evidenceRoot, activeScreenshotName), activeScreenshot.toPNG());
    const completedDuration = await win.webContents.executeJavaScript(`(() => {
      const api = globalThis.__VINIPER_TEST_API__;
      const id = "active-duration-${width}x${height}";
      const record = api.SessionRunRegistry.get(id);
      if (!record) return { error: "active record missing" };
      record.elapsedOverride = 1649;
      record.active = false;
      record.completed = true;
      record.status = "completed";
      const message = api.state.messages[api.state.messages.length - 1];
      message.pending = false;
      message.elapsed_seconds = 1649;
      message.thinking_elapsed_seconds = 129;
      message.turn_usage = { input_tokens: 1200, output_tokens: 800, cache_read_input_tokens: 500 };
      api.renderAllMessages();
      api.syncCurrentSessionRuntimeUi();
      const article = document.querySelector('.message.assistant[data-run-session-id="' + id + '"]');
      const node = article?.querySelector('.thinking-complete-summary');
      const live = article?.querySelector('[data-live-total="true"]');
      const content = article?.querySelector('.msg-content');
      const nodeRect = node?.getBoundingClientRect?.();
      const composerRect = document.querySelector('#composer')?.getBoundingClientRect?.();
      const dockRect = document.querySelector('#interaction-dock')?.getBoundingClientRect?.();
      const overlaps = (a, b) => Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
      return {
        text: node?.textContent || "",
        hasTurnTotal: /本轮用时\\s*27分\\s*29秒/.test(node?.textContent || ""),
        hasTokens: /2.5k tokens/.test(node?.textContent || ""),
        hasLiveTotal: Boolean(live),
        pending: article?.hasAttribute("data-pending") || false,
        atBottom: Boolean(node && content?.lastElementChild === node),
        overlapsComposer: overlaps(nodeRect, composerRect),
        overlapsDock: overlaps(nodeRect, dockRect),
      };
    })()`);
    await delay(100);
    const completedScreenshot = await win.webContents.capturePage();
    const completedScreenshotName = `continuation-${width}x${height}-completed.png`;
    fs.writeFileSync(path.join(evidenceRoot, completedScreenshotName), completedScreenshot.toPNG());
    const hints = await win.webContents.executeJavaScript(`(() => {
      const api = globalThis.__VINIPER_TEST_API__;
      const id = "hint-${width}x${height}";
      api.state.sessionId = id;
      api.state.sessionMode = "agent";
      api.state.viewMode = "agent";
      api.SessionRunRegistry.start(id, { mode: "agent" });
      const states = ["running", "waiting_input", "awaiting_cli_ack"];
      const result = {};
      for (const status of states) {
        const record = api.SessionRunRegistry.get(id);
        api.SessionRunRegistry.update(id, { active: true, status, waitingInput: status === "waiting_input", pendingInteraction: status === "waiting_input" ? { interaction_state: "pending" } : null });
        api.syncCurrentSessionRuntimeUi();
        result[status] = {
          placeholder: document.querySelector("#user-input")?.placeholder || "",
          shortcut: document.querySelector(".composer-shortcut")?.textContent || "",
          disabled: Boolean(document.querySelector("#user-input")?.disabled),
        };
      }
      return result;
    })()`);
    const screenshot = await win.webContents.capturePage();
    const screenshotName = `continuation-${width}x${height}.png`;
    fs.writeFileSync(path.join(evidenceRoot, screenshotName), screenshot.toPNG());
    return {
      baseline,
      bottom,
      afterScroll,
      railStayedInViewport: Boolean(baseline.rail && afterScroll.rail && Math.abs(baseline.rail.left - afterScroll.rail.left) <= 1 && Math.abs(baseline.rail.top - afterScroll.rail.top) <= 1),
      duration: {
        hasTurnTotal: /本轮用时\s*27分\s*29秒/.test(durationHtml),
        hasTokens: /2.5k tokens/.test(durationHtml),
        hasThinkingOnlyLabel: /已思考\s*2分09秒/.test(durationHtml),
        thinkingBodyHidden: !durationHtml.includes("不应显示的思考正文"),
        active: activeDuration,
        completed: completedDuration,
      },
      hints,
      screenshot: screenshotName,
      activeScreenshot: activeScreenshotName,
      completedScreenshot: completedScreenshotName,
    };
  } finally {
    if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    win.destroy();
  }
}

async function main() {
  const viewports = {};
  for (const [width, height] of [[1280, 800], [900, 700]]) {
    viewports[`${width}x${height}`] = await runViewport(width, height);
  }
  writeResultOnce({ viewports });
}

app.whenReady().then(main).then(() => app.quit()).catch((error) => {
  writeResultOnce({ __harnessError: error?.stack || String(error) });
  app.exit(1);
});

app.on("window-all-closed", () => { if (resultWritten) app.quit(); });
