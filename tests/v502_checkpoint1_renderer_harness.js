"use strict";

// Real Chromium seam for CP1 R2.  The harness never assigns SessionScrollRegistry
// state and never dispatches a synthetic scroll event: wheel and thumb input are
// delivered through the Electron DevTools Protocol Input domain.
const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();

const evidenceRoot = process.env.VINIPER_V502_CP1_EVIDENCE_ROOT;
if (!evidenceRoot) throw new Error("VINIPER_V502_CP1_EVIDENCE_ROOT is required");
fs.mkdirSync(evidenceRoot, { recursive: true });
const resultPath = path.join(evidenceRoot, "renderer-result.json");
let resultWritten = false;

function writeResultOnce(payload) {
  if (resultWritten) return;
  resultWritten = true;
  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), "utf8");
}

function delay(ms = 40) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dispatchWheel(win, x, y, deltaY) {
  if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach("1.3");
  await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
    type: "mouseMoved", x, y, button: "none", buttons: 0,
  });
  await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
    type: "mouseWheel", x, y, deltaX: 0, deltaY,
  });
  await delay(100);
}

async function dispatchThumbDrag(win, start, end) {
  if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach("1.3");
  await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
    type: "mouseMoved", x: start.x, y: start.y, button: "none", buttons: 0,
  });
  await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
    type: "mousePressed", x: start.x, y: start.y, button: "left", buttons: 1, clickCount: 1,
  });
  await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
    type: "mouseMoved", x: end.x, y: end.y, button: "left", buttons: 1,
  });
  await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: end.x, y: end.y, button: "left", buttons: 0, clickCount: 1,
  });
  await delay(100);
}

function longFixture(label) {
  return Array.from({ length: 96 }, (_, index) => (
    `<article class="message assistant"><div class="msg-content"><div class="msg-text-segment">${label} ${index + 1}<br>第二行</div></div></article>`
  )).join("");
}

async function prepareWindow(width, height) {
  const root = path.resolve(__dirname, "..");
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    titleBarOverlay: process.platform === "win32"
      ? { color: "#f5f3ee", symbolColor: "#302f2b", height: 32 }
      : undefined,
    webPreferences: { backgroundThrottling: false },
  });
  await win.loadFile(path.join(root, "static", "index.html"));
  await win.webContents.insertCSS(fs.readFileSync(path.join(root, "static", "style.css"), "utf8"));
  const source = fs.readFileSync(path.join(root, "static", "app.js"), "utf8");
  await win.webContents.executeJavaScript(`${source}
    ;globalThis.__V502_INTERNAL__ = { bindEvents, applySession, switchSession, renderSessionRun, scrollBottom, renderSettingsPermissionOptions, setAnchoredMenuOpen };
    ;void 0;
    //# sourceURL=viniper-v502-checkpoint1-app.js`);
  const fixture = JSON.stringify(longFixture(`${width}x${height}`));
  await win.webContents.executeJavaScript(`(() => {
    const api = globalThis.__VINIPER_TEST_API__;
    const internal = globalThis.__V502_INTERNAL__;
    window.fetch = async (url) => {
      const target = String(url);
      if (target.includes("/peers")) return { ok: true, status: 200, json: async () => ({ peer: { available: false, targets: [] } }) };
      if (target.includes("/queue")) return { ok: true, status: 200, json: async () => ({ items: [] }) };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    internal.bindEvents();
    api.setViewMode("agent");
    api.state.viewMode = "agent";
    api.state.sessionMode = "agent";
    api.state.sessionId = "A";
    api.state.isStreaming = true;
    api.state.followOutput = true;
    api.state.status = {
      permission_modes: [
        { id: "default", label: "询问权限" },
        { id: "acceptEdits", label: "自动接受编辑" },
        { id: "plan", label: "计划模式" },
        { id: "auto", label: "自动模式", enabled: false, reason: "当前 DeepSeek 不支持 Claude Auto" },
        { id: "bypassPermissions", label: "跳过权限", enabled: false, reason: "需要在设置中启用跳过权限" },
        { id: "dontAsk", label: "CLI 模式 / 不询问", cli_only: true, separator_before: true, enabled: true },
      ],
      runtime: { capabilities: { auto_permission: true } },
    };
    api.state.settings = { runtime: { enable_auto_mode: false, allow_bypass_permissions: false } };
    const chat = document.querySelector("#chat-container");
    const messages = document.querySelector("#messages");
    messages.innerHTML = ${fixture};
    const article = document.createElement("article");
    article.className = "message assistant";
    article.dataset.runSessionId = "A";
    article.innerHTML = '<div class="msg-content"></div>';
    messages.appendChild(article);
    api.state.messages = [{ role: "assistant", run_session_id: "A", pending: true, content: "", segments: [] }];
    api.SessionRunRegistry.start("A", { mode: "agent", workdir: "D:/fixture/A", runId: "run-A" });
    api.renderSessionRun("A");
    api.renderPermissionSelect();
    try {
      internal.renderSettingsPermissionOptions("default");
    } catch (error) {
      window.__v502SettingsError = String(error?.stack || error);
    }
    chat.classList.remove("chat-empty-state");
  })()`);
  win.showInactive();
  await delay(120);
  return win;
}

async function runViewport(width, height) {
  const win = await prepareWindow(width, height);
  try {
    const base = await win.webContents.executeJavaScript(`(() => {
      const chat = document.querySelector("#chat-container");
      const rect = chat.getBoundingClientRect();
      const listener = { wheel: 0, scroll: 0 };
      chat.addEventListener("wheel", () => { listener.wheel += 1; }, { passive: true });
      chat.addEventListener("scroll", () => { listener.scroll += 1; }, { passive: true });
      chat.scrollTop = chat.scrollHeight;
      globalThis.__v502ScrollListener = listener;
      return { rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, scrollHeight: chat.scrollHeight, clientHeight: chat.clientHeight };
    })()`);
    const center = {
      x: (base.rect.left + base.rect.right) / 2,
      y: (base.rect.top + base.rect.bottom) / 2,
    };
    // Chromium's wheel convention is negative = toward the top, positive = toward the bottom.
    await dispatchWheel(win, center.x, center.y, -460);
    const afterUp = await win.webContents.executeJavaScript(`({ follow: Boolean(globalThis.__VINIPER_TEST_API__.state.followOutput), top: document.querySelector("#chat-container").scrollTop, listener: globalThis.__v502ScrollListener })`);
    await dispatchWheel(win, center.x, center.y, 1200);
    const afterDown = await win.webContents.executeJavaScript(`({ follow: Boolean(globalThis.__VINIPER_TEST_API__.state.followOutput), top: document.querySelector("#chat-container").scrollTop, max: document.querySelector("#chat-container").scrollHeight - document.querySelector("#chat-container").clientHeight, listener: globalThis.__v502ScrollListener })`);
    await win.webContents.executeJavaScript(`(() => {
      const api = globalThis.__VINIPER_TEST_API__;
      api.state.followOutput = true;
      api.SessionRunRegistry.applyEvent("A", { type: "text", content: "流式追加事件" });
      api.renderSessionRun("A");
    })()`);
    await delay(120);
    const afterProjection = await win.webContents.executeJavaScript(`({ follow: Boolean(globalThis.__VINIPER_TEST_API__.state.followOutput), guard: String(globalThis.__VINIPER_TEST_API__.renderSessionRun).includes("beginProjection") || String(globalThis.__VINIPER_TEST_API__.renderSessionRun).includes("startProjection"), listener: globalThis.__v502ScrollListener })`);
    const permissionDom = await win.webContents.executeJavaScript(`(() => {
      globalThis.__V502_INTERNAL__.setAnchoredMenuOpen("permission", true);
      const select = document.querySelector("#permission-select");
      const options = [...(select?.options || [])];
      const generic = [...document.querySelectorAll("[data-permission-mode]")];
      const optionIds = options.length
        ? options.map((item) => item.value)
        : generic.map((item) => item.dataset.permissionMode);
      const byId = (id) => options.find((item) => item.value === id) || generic.find((item) => item.dataset.permissionMode === id);
      const reason = (id) => String(byId(id)?.title || byId(id)?.dataset?.reason || "");
      const settingsSelect = document.querySelector("#settings-permission-default");
      const settingsOptions = [...(settingsSelect?.options || [])];
      const settingsById = (id, options = settingsOptions) => options.find((item) => item.value === id);
      const settingsInitial = {
        option_ids: settingsOptions.map((item) => item.value),
        disabled: {
          auto: Boolean(settingsById("auto")?.disabled),
          bypassPermissions: Boolean(settingsById("bypassPermissions")?.disabled),
          dontAsk: Boolean(settingsById("dontAsk")?.disabled),
        },
        auto_reason: String(settingsById("auto")?.title || ""),
        bypass_reason: String(settingsById("bypassPermissions")?.title || ""),
      };
      document.querySelector("#settings-enable-auto-mode").checked = true;
      document.querySelector("#settings-allow-bypass-permissions").checked = true;
      try {
        globalThis.__V502_INTERNAL__.renderSettingsPermissionOptions("default");
      } catch (error) {
        window.__v502SettingsError = String(error?.stack || error);
      }
      const toggledOptions = [...(settingsSelect?.options || [])];
      const menu = document.querySelector("#permission-menu");
      const menuRect = menu?.getBoundingClientRect();
      const menuStyle = menu ? getComputedStyle(menu) : null;
      const menuViewport = {
        innerWidth,
        innerHeight,
        rect: menuRect ? { left: menuRect.left, top: menuRect.top, right: menuRect.right, bottom: menuRect.bottom, width: menuRect.width, height: menuRect.height } : null,
        within_viewport: Boolean(menuRect && menuRect.left >= -1 && menuRect.top >= -1 && menuRect.right <= innerWidth + 1 && menuRect.bottom <= innerHeight + 1),
        overflow_y: menuStyle?.overflowY || "",
        max_height: menuStyle?.maxHeight || "",
        scroll_height: Number(menu?.scrollHeight || 0),
        client_height: Number(menu?.clientHeight || 0),
      };
      const compactCopy = {};
      for (const id of ["auto", "bypassPermissions"]) {
        const item = menu?.querySelector('[data-permission-mode="' + id + '"]');
        compactCopy[id] = {
          small_count: item ? item.querySelectorAll(".anchored-menu-copy small").length : 0,
          small_text: item ? [...item.querySelectorAll(".anchored-menu-copy small")].map((node) => node.textContent.trim()) : [],
        };
      }
      menuViewport.compact_copy = compactCopy;
      if (menu) menu.scrollTop = menu.scrollHeight;
      const dontAskButton = menu?.querySelector('[data-permission-mode="dontAsk"]');
      const dontAskRect = dontAskButton?.getBoundingClientRect();
      menuViewport.dontask_after_scroll = dontAskRect ? {
        top: dontAskRect.top,
        bottom: dontAskRect.bottom,
        visible_in_menu: Boolean(menuRect && dontAskRect.top >= menuRect.top - 1 && dontAskRect.bottom <= menuRect.bottom + 1),
      } : null;
      globalThis.__V502_INTERNAL__.setAnchoredMenuOpen("permission", false);
      return {
        option_ids: optionIds,
        cli_divider: Boolean(document.querySelector('[data-permission-divider="cli"]')),
        disabled: {
          auto: Boolean(byId("auto")?.disabled),
          bypassPermissions: Boolean(byId("bypassPermissions")?.disabled),
        },
        auto_reason: reason("auto"),
        bypass_reason: reason("bypassPermissions"),
        settings_option_ids: settingsInitial.option_ids,
        settings_disabled: settingsInitial.disabled,
        settings_auto_reason: settingsInitial.auto_reason,
        settings_bypass_reason: settingsInitial.bypass_reason,
        settings_after_toggle_disabled: {
          auto: Boolean(settingsById("auto", toggledOptions)?.disabled),
          bypassPermissions: Boolean(settingsById("bypassPermissions", toggledOptions)?.disabled),
          dontAsk: Boolean(settingsById("dontAsk", toggledOptions)?.disabled),
        },
        settings_error: String(window.__v502SettingsError || ""),
        menu_viewport: menuViewport,
      };
    })()`);

    const dragAttempts = [];
    for (const offset of [2, 3, 4, 5]) {
      await win.webContents.executeJavaScript(`document.querySelector("#chat-container").scrollTop = 0`);
      const start = { x: base.rect.right - offset, y: base.rect.top + 22 };
      const end = { x: start.x, y: Math.min(base.rect.bottom - 18, start.y + 180) };
      await dispatchThumbDrag(win, start, end);
      const dragResult = await win.webContents.executeJavaScript(`(() => { const c = document.querySelector("#chat-container"); const node = document.elementFromPoint(${start.x}, ${start.y}); return { scrollTop: c.scrollTop, hit: node ? (node.id || node.className || node.tagName) : "" }; })()`);
      dragAttempts.push({ offset, start, end, ...dragResult });
      if (dragResult.scrollTop > 0) break;
    }
    const screenshot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(evidenceRoot, `r2-${width}x${height}.png`), screenshot.toPNG());
    return {
      viewport: { width, height, dpr: await win.webContents.executeJavaScript("devicePixelRatio") },
      rect: base.rect,
      layout_ready: base.scrollHeight > base.clientHeight,
      natural_wheel_events: afterDown.listener.wheel,
      natural_scroll_events: afterDown.listener.scroll,
      follow_after_wheel_up: afterUp.follow,
      follow_after_wheel_down: afterDown.follow,
      follow_after_projection: afterProjection.follow,
      projection_guard_present: afterProjection.guard,
      permission_dom: permissionDom,
      native_thumb_drag_changed: dragAttempts.some((item) => item.scrollTop > 0),
      right_edge_2px_dragged: Boolean(dragAttempts.find((item) => item.offset === 2 && item.scrollTop > 0)),
      drag_attempts: dragAttempts,
    };
  } finally {
    if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    win.destroy();
  }
}

async function runSessionScrollIsolation() {
  const win = await prepareWindow(900, 700);
  try {
    const switchWithTimeout = (id) => Promise.race([
      win.webContents.executeJavaScript(`globalThis.__V502_INTERNAL__.switchSession(${JSON.stringify(id)}, { quiet: true, history: false })`),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`switchSession ${id} timed out`)), 5000)),
    ]);
    await win.webContents.executeJavaScript(`(() => {
      const api = globalThis.__VINIPER_TEST_API__;
      const makeMessages = (label) => Array.from({ length: 96 }, (_, index) => ({
        role: "assistant",
        content: label + " 会话消息 " + (index + 1) + "\\n第二行\\n第三行",
        segments: [{ type: "text", content: label + " 会话消息 " + (index + 1) + "\\n第二行\\n第三行" }],
      }));
      const sessions = {
        A: { session_id: "A", id: "A", mode: "agent", name: "A", workdir: "D:/fixture/A", messages: makeMessages("A"), runtime_state: "idle", permission_mode: "default" },
        B: { session_id: "B", id: "B", mode: "agent", name: "B", workdir: "D:/fixture/B", messages: makeMessages("B"), runtime_state: "idle", permission_mode: "default" },
      };
      window.__v502Sessions = sessions;
      window.fetch = async (url) => {
        const target = String(url);
        if (target === "/api/sessions") {
          return { ok: true, status: 200, json: async () => ({ sessions: Object.values(sessions).map((item) => ({ ...item, messages: undefined })) }) };
        }
        if (target.includes("/api/sessions/") && !target.endsWith("/peers") && !target.endsWith("/queue")) {
          const id = decodeURIComponent(target.split("/").pop());
          return { ok: Boolean(sessions[id]), status: sessions[id] ? 200 : 404, json: async () => sessions[id] || {} };
        }
        if (target.endsWith("/peers")) return { ok: true, status: 200, json: async () => ({ peer: { available: false, targets: [] } }) };
        if (target.endsWith("/queue")) return { ok: true, status: 200, json: async () => ({ items: [] }) };
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      };
      api.state.isStreaming = false;
      api.state.sessionRuntimeState = "idle";
      api.state.sessionMode = "agent";
      api.state.viewMode = "agent";
      api.setViewMode("agent");
    })()`);
    await switchWithTimeout("A");
    await delay(140);
    const base = await win.webContents.executeJavaScript(`(() => { const c = document.querySelector("#chat-container"); const r = c.getBoundingClientRect(); return { rect: r.toJSON(), scrollHeight: c.scrollHeight, clientHeight: c.clientHeight, max: c.scrollHeight - c.clientHeight }; })()`);
    const center = { x: (base.rect.left + base.rect.right) / 2, y: (base.rect.top + base.rect.bottom) / 2 };
    await dispatchWheel(win, center.x, center.y, -12000);
    const aAfterUp = await win.webContents.executeJavaScript(`(() => { const c = document.querySelector("#chat-container"); return { scrollTop: c.scrollTop, follow: Boolean(globalThis.__VINIPER_TEST_API__.state.followOutput), max: c.scrollHeight - c.clientHeight }; })()`);
    await switchWithTimeout("B");
    await delay(140);
    const bBase = await win.webContents.executeJavaScript(`(() => { const c = document.querySelector("#chat-container"); return { rect: c.getBoundingClientRect().toJSON(), max: c.scrollHeight - c.clientHeight }; })()`);
    const bCenter = { x: (bBase.rect.left + bBase.rect.right) / 2, y: (bBase.rect.top + bBase.rect.bottom) / 2 };
    await dispatchWheel(win, bCenter.x, bCenter.y, -12000);
    await dispatchWheel(win, bCenter.x, bCenter.y, 12000);
    const bAfterDown = await win.webContents.executeJavaScript(`(() => { const c = document.querySelector("#chat-container"); return { scrollTop: c.scrollTop, follow: Boolean(globalThis.__VINIPER_TEST_API__.state.followOutput), max: c.scrollHeight - c.clientHeight }; })()`);
    await switchWithTimeout("A");
    await delay(160);
    const aAfterSwitch = await win.webContents.executeJavaScript(`(() => { const c = document.querySelector("#chat-container"); return { scrollTop: c.scrollTop, follow: Boolean(globalThis.__VINIPER_TEST_API__.state.followOutput), max: c.scrollHeight - c.clientHeight, session: globalThis.__VINIPER_TEST_API__.state.sessionId }; })()`);
    return { a_after_up: aAfterUp, b_after_down: bAfterDown, a_after_switch: aAfterSwitch };
  } finally {
    if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    win.destroy();
  }
}

async function main() {
  const viewports = {};
  viewports["1280x800"] = await runViewport(1280, 800);
  viewports["900x700"] = await runViewport(900, 700);
  const sessionScroll = await runSessionScrollIsolation();
  writeResultOnce({
    viewports,
    session_scroll: sessionScroll,
    natural_wheel_events: Object.values(viewports).reduce((sum, item) => sum + Number(item.natural_wheel_events || 0), 0),
    native_thumb_drag_changed: Object.values(viewports).every((item) => item.native_thumb_drag_changed),
    // Aggregate keeps the product-facing predicate: true means at least one
    // viewport incorrectly kept following after a real upward wheel.
    follow_after_wheel_up: Object.values(viewports).some((item) => item.follow_after_wheel_up === true),
    follow_after_wheel_down: Object.values(viewports).every((item) => item.follow_after_wheel_down === true),
    projection_guard_present: Object.values(viewports).every((item) => item.projection_guard_present === true),
    permission_dom: viewports["1280x800"].permission_dom,
  });
}

app.whenReady().then(main).then(() => app.quit()).catch((error) => {
  writeResultOnce({ __harnessError: error?.stack || String(error) });
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (resultWritten) app.quit();
});
