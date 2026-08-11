"use strict";

// Offline Electron evidence for inline Agent title rename, paused state
// projection, Chat/Agent surface separation, and two supported viewports.
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();
const evidenceRoot = process.env.VINIPER_V502_SESSION_CHROME_EVIDENCE_ROOT;
if (!evidenceRoot) throw new Error("VINIPER_V502_SESSION_CHROME_EVIDENCE_ROOT is required");
fs.mkdirSync(evidenceRoot, { recursive: true });
const resultPath = path.join(evidenceRoot, "session-chrome-result.json");
let resultWritten = false;
function writeResultOnce(payload) {
  if (resultWritten) return;
  resultWritten = true;
  try { fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), "utf8"); } catch {}
}
function delay(ms = 80) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function prepareWindow(width, height) {
  const root = path.resolve(__dirname, "..");
  const iconUrl = pathToFileURL(path.join(root, "static", "assets", "viniper-icon.png")).href;
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
    ;globalThis.__V502_SESSION_INTERNAL__ = { bindEvents };
    ;void 0;
    //# sourceURL=viniper-v502-session-chrome-app.js`);
  await win.webContents.executeJavaScript(`(() => {
    const api = globalThis.__VINIPER_TEST_API__;
    window.__v502Calls = [];
    window.__v502FailRename = false;
    window.fetch = async (url, options = {}) => {
      let body = {};
      try { body = JSON.parse(options.body || "{}"); } catch {}
      window.__v502Calls.push({ url: String(url), method: options.method || "GET", body });
      if (window.__v502FailRename && String(options.method || "").toUpperCase() === "PUT") {
        return { ok: false, status: 409, json: async () => ({ detail: "名称已被占用" }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, sessions: [], item: {} }) };
    };
    globalThis.__V502_SESSION_INTERNAL__.bindEvents();
    // file:// fixtures cannot resolve the production /static absolute URL;
    // point only the already-declared local icon asset at its exact source.
    document.querySelectorAll('img[src^="/static/assets/"]').forEach((image) => { image.src = ${JSON.stringify(iconUrl)}; });
    api.state.status = { version: "5.0.2", runtime: { ready: true }, models: [{ id: "deepseek-v4-pro[1m]", name: "DeepSeek" }] };
    api.state.sessionMode = "agent";
    api.state.viewMode = "agent";
    api.state.sessionId = "A";
    api.state.sessionName = "A 标题 / 제목";
    api.state.workdir = "C:\\workspace\\A";
    api.state.sessionRuntimeState = "idle";
    api.setViewMode("agent");
    api.renderSessionHeader();
  })()`);
  win.showInactive();
  await delay(160);
  return win;
}

async function runViewport(width, height) {
  const win = await prepareWindow(width, height);
  try {
    const capture = async (stage) => {
      await win.webContents.executeJavaScript("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      await delay(100);
      const screenshot = await win.webContents.capturePage();
      const name = `session-chrome-${width}x${height}-${stage}.png`;
      fs.writeFileSync(path.join(evidenceRoot, name), screenshot.toPNG());
      return name;
    };
    const edit = await win.webContents.executeJavaScript(`(() => {
      const button = document.querySelector("#session-title-button");
      const rect = button?.getBoundingClientRect();
      const pointerTarget = rect ? (document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest?.("#session-title-button")?.id || "") : "";
      button?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: rect?.left || 0, clientY: rect?.top || 0 }));
      button?.click();
      const input = document.querySelector("#session-title-inline-input");
      const style = input ? getComputedStyle(input) : null;
      return {
        inputRole: input?.getAttribute("role") || input?.tagName?.toLowerCase() || "",
        selected: Boolean(input && input.selectionStart === 0 && input.selectionEnd === input.value.length),
        activeElement: document.activeElement?.id || document.activeElement?.className || "",
        focusBorderColor: style?.borderColor || "",
        focusBoxShadow: style?.boxShadow || "",
        blueFocus: String(style?.borderColor || "").replaceAll(" ", "") === "rgb(47,112,217)",
        pointerTarget,
      };
    })()`);
    const renameEdit = await capture("rename-edit");
    const saved = await win.webContents.executeJavaScript(`(async () => {
      const input = document.querySelector("#session-title-inline-input");
      if (input) {
        input.value = "长标题 / 제목 / 会話";
        input.dispatchEvent(new InputEvent("input", { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
      const button = document.querySelector("#session-title-button");
      const buttonStyle = button ? getComputedStyle(button) : null;
      return {
        title: document.querySelector("#session-title")?.textContent || "",
        request: (window.__v502Calls || []).find((item) => item.method === "PUT") || { body: {} },
        inputPresent: Boolean(document.querySelector("#session-title-inline-input")),
        titleButtonShadow: buttonStyle?.boxShadow || "",
      };
    })()`);
    const renameSaved = await capture("rename-saved");
    const pausedSetup = await win.webContents.executeJavaScript(`(async () => {
      const api = globalThis.__VINIPER_TEST_API__;
      const internal = (selector) => document.querySelector(selector);
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      api.state.sessionId = "B";
      api.state.sessionName = "B 会话 / 会議";
      api.state.sessionMode = "agent";
      api.state.viewMode = "agent";
      api.renderSessionHeader();
      internal("#session-title-button")?.click();
      internal("#session-title-inline-input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await wait(20);
      const afterCancelTitle = internal("#session-title")?.textContent || "";
      internal("#session-title-button")?.click();
      const failedInput = internal("#session-title-inline-input");
      if (failedInput) {
        failedInput.value = "失败名称";
        window.__v502FailRename = true;
        failedInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      }
      await wait(80);
      const failureRestoredTitle = internal("#session-title")?.textContent || "";
      const failureInlineError = internal(".session-title-inline-error")?.textContent || "";
      internal(".session-title-inline-error")?.remove();
      window.__v502FailRename = false;
      api.SessionRunRegistry.start("A", { mode: "agent" });
      api.state.sessionId = "A";
      api.state.sessionMode = "agent";
      api.state.viewMode = "agent";
      api.SessionRunRegistry.update("A", { active: false, status: "paused" });
      api.syncCurrentSessionRuntimeUi();
      const statusNode = internal("#session-inline-status");
      const snapshotStatus = () => {
        const style = statusNode ? getComputedStyle(statusNode) : null;
        const statusRect = statusNode?.getBoundingClientRect();
        const messagesRect = internal("#messages")?.getBoundingClientRect();
        const usageRect = internal("#agent-daily-usage")?.getBoundingClientRect();
        const overlaps = (a, b) => !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        return {
          display: statusNode ? style.display : "none",
          text: statusNode?.textContent || "",
          inputDisabled: Boolean(internal("#user-input")?.disabled),
          rect: statusNode?.getBoundingClientRect()?.toJSON() || null,
          messagesRect: internal("#messages")?.getBoundingClientRect()?.toJSON() || null,
          usageRect: usageRect?.toJSON() || null,
          statusUsageOverlap: overlaps(statusRect, usageRect),
          statusMessagesOverlap: overlaps(statusRect, messagesRect),
          firstMessageRect: internal("#messages")?.firstElementChild?.getBoundingClientRect()?.toJSON() || null,
          firstMessageText: internal("#messages")?.firstElementChild?.textContent?.slice(0, 80) || "",
          position: style?.position || "",
          marginBottom: style?.marginBottom || "",
        };
      };
      const pausedA = snapshotStatus();
      return { afterCancelTitle, failureRestoredTitle, failureInlineError, pausedA };
    })()`);
    const paused = await capture("paused");
    const pausedTransition = await win.webContents.executeJavaScript(`(async () => {
      const api = globalThis.__VINIPER_TEST_API__;
      const internal = (selector) => document.querySelector(selector);
      const statusSnapshot = () => {
        const node = internal("#session-inline-status");
        const style = node ? getComputedStyle(node) : null;
        const statusRect = node?.getBoundingClientRect();
        const messagesRect = internal("#messages")?.getBoundingClientRect();
        const usageRect = internal("#agent-daily-usage")?.getBoundingClientRect();
        const overlaps = (a, b) => !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        return {
          display: node ? style.display : "none",
          text: node?.textContent || "",
          inputDisabled: Boolean(internal("#user-input")?.disabled),
          rect: node?.getBoundingClientRect()?.toJSON() || null,
          messagesRect: internal("#messages")?.getBoundingClientRect()?.toJSON() || null,
          usageRect: usageRect?.toJSON() || null,
          statusUsageOverlap: overlaps(statusRect, usageRect),
          statusMessagesOverlap: overlaps(statusRect, messagesRect),
          firstMessageRect: internal("#messages")?.firstElementChild?.getBoundingClientRect()?.toJSON() || null,
          firstMessageText: internal("#messages")?.firstElementChild?.textContent?.slice(0, 80) || "",
          position: style?.position || "",
          marginBottom: style?.marginBottom || "",
        };
      };
      api.SessionRunRegistry.start("B", { mode: "agent" });
      api.state.sessionId = "B";
      api.state.sessionMode = "agent";
      api.state.viewMode = "agent";
      api.syncCurrentSessionRuntimeUi();
      const pausedB = statusSnapshot();
      api.state.sessionId = "A";
      api.state.sessionMode = "agent";
      api.state.viewMode = "agent";
      api.syncCurrentSessionRuntimeUi();
      const aRestored = statusSnapshot();
      api.SessionRunRegistry.update("A", { active: false, status: "completed" });
      api.syncCurrentSessionRuntimeUi();
      const aCompleted = statusSnapshot();
      return { pausedB, aRestored, aCompleted };
    })()`);
    const layout = await win.webContents.executeJavaScript(`(() => {
      const api = globalThis.__VINIPER_TEST_API__;
      const internal = (selector) => document.querySelector(selector);
      const chatMessages = [
        { role: "user", content: "Chat 用户消息" },
        { role: "assistant", content: "Chat 助手回复", segments: [{ type: "text", content: "Chat 助手回复" }] },
      ];
      const agentMessages = [
        { role: "user", content: "Agent 任务消息" },
        { role: "assistant", content: "Agent 工具完成", segments: [{ type: "text", content: "Agent 工具完成" }] },
      ];
      const layoutOf = (surface) => {
        const container = internal("#chat-container")?.getBoundingClientRect();
        const messageRect = internal("#messages")?.getBoundingClientRect();
        const composerRect = internal("#composer")?.getBoundingClientRect();
        return {
          surface: internal("#composer")?.dataset.surface || "",
          messagesCentered: !!container && !!messageRect && Math.abs((messageRect.left + messageRect.width / 2) - (container.left + container.width / 2)) <= 2,
          modelVisible: getComputedStyle(internal("#model-picker-button")).display !== "none",
          agentOnlyVisible: Array.from(document.querySelectorAll(".agent-only")).filter((node) => getComputedStyle(node).display !== "none").length,
          toolsWidth: internal("#input-actions")?.getBoundingClientRect()?.width || 0,
          composerRect: composerRect?.toJSON() || null,
        };
      };
      api.state.messages = chatMessages;
      api.state.sessionId = "chat-a";
      api.state.sessionMode = "chat";
      api.state.viewMode = "chat";
      api.setViewMode("chat");
      api.renderAllMessages();
      const chat = layoutOf("chat");
      api.state.messages = agentMessages;
      api.state.sessionId = "agent-a";
      api.state.sessionMode = "agent";
      api.state.viewMode = "agent";
      api.setViewMode("agent");
      api.renderAllMessages();
      const agent = layoutOf("agent");
      document.querySelectorAll(".session-title-inline-error").forEach((node) => node.remove());
      return { chat, agent, final: { titleErrorCount: document.querySelectorAll(".session-title-inline-error").length, statusText: internal("#session-inline-status")?.textContent || "" } };
    })()`);
    const chat = await capture("chat");
    const agent = await capture("agent");
    return {
      viewport: { width, height, dpr: await win.webContents.executeJavaScript("devicePixelRatio") },
      rename: { ...edit, requestBody: saved.request?.body || {}, afterSaveTitle: saved.title, savedInputPresent: saved.inputPresent, savedButtonShadow: saved.titleButtonShadow, afterCancelTitle: pausedSetup.afterCancelTitle, pointerTarget: edit.pointerTarget, failureRestoredTitle: pausedSetup.failureRestoredTitle, failureInlineError: pausedSetup.failureInlineError },
      paused: { a: pausedSetup.pausedA, b: pausedTransition.pausedB, aRestored: pausedTransition.aRestored, aCompleted: pausedTransition.aCompleted },
      layout: { chat: layout.chat, agent: layout.agent },
      screenshots: { renameEdit, renameSaved, paused, chat, agent },
      final: layout.final,
    };
  } finally {
    win.destroy();
  }
}

async function main() {
  const viewports = {};
  viewports["1280x800"] = await runViewport(1280, 800);
  viewports["900x700"] = await runViewport(900, 700);
  writeResultOnce({ viewports, fixture: "synthetic UI fixture; no provider/network/formal data root" });
}

app.whenReady().then(main).then(() => app.quit()).catch((error) => {
  writeResultOnce({ __harnessError: error?.stack || String(error), fixture: "synthetic UI fixture" });
  app.exit(1);
});
app.on("window-all-closed", () => { if (resultWritten) app.quit(); });
