"use strict";

const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();

const evidenceRoot = process.env.VINIPER_V501_CP1_EVIDENCE_ROOT;
if (!evidenceRoot) throw new Error("VINIPER_V501_CP1_EVIDENCE_ROOT is required");
const resultPath = path.join(evidenceRoot, "renderer-result.json");
let resultWritten = false;

function writeResultOnce(payload) {
  if (resultWritten) return;
  resultWritten = true;
  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), "utf8");
}

function delay(ms = 30) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dispatchMouseDrag(webContents, start, end) {
  if (!webContents.debugger.isAttached()) webContents.debugger.attach("1.3");
  await webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
    type: "mouseMoved", x: start.x - 4, y: start.y,
  });
  await delay(80);
  await webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
    type: "mouseMoved", x: start.x, y: start.y,
  });
  await delay(80);
  await webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
    type: "mousePressed", x: start.x, y: start.y, button: "left", buttons: 1, clickCount: 1,
  });
  await webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
    type: "mouseMoved", x: end.x, y: end.y, button: "left", buttons: 1,
  });
  await webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: end.x, y: end.y, button: "left", buttons: 0, clickCount: 1,
  });
}

function longMessages(prefix) {
  return Array.from({ length: 65 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: `${prefix} 第 ${index + 1} 行：用于真实 Electron 滚动溢出和自动跟随验证。`,
    segments: index % 2 ? [{ type: "text", content: `${prefix} 助手正文 ${index + 1}` }] : undefined,
  }));
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
    ;globalThis.__V501_INTERNAL__ = {
      bindEvents, applySession, isNearChatBottom, scrollBottom,
      loadSessionList, messageTemplate
    };
    ;void 0;
    //# sourceURL=viniper-v501-checkpoint1-app.js`);

  await win.webContents.executeJavaScript(`(() => {
    const api = globalThis.__VINIPER_TEST_API__;
    const internal = globalThis.__V501_INTERNAL__;
    window.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target === "/api/agent/queue") return { ok: true, status: 200, json: async () => ({ items: [] }) };
      if (target.includes("/peers")) return { ok: true, status: 200, json: async () => ({ peer: { available: false, targets: [] } }) };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    internal.bindEvents();
    api.setViewMode("agent");
    api.state.sessionId = "A";
    api.state.isStreaming = true;
    api.state.followOutput = true;
    document.querySelector("#main")?.classList.add("agent-view");
    document.querySelector("#chat-container")?.classList.remove("chat-empty-state");
    const messages = document.querySelector("#messages");
    messages.innerHTML = Array.from({ length: 90 }, (_, index) =>
      '<article class="msg assistant"><div class="msg-content"><div class="msg-text-segment">滚动夹具 '
        + (index + 1) + '<br>第二行固定高度</div></div></article>'
    ).join("");
  })()`);
  win.setOpacity(0);
  win.showInactive();
  await delay(80);
  return win;
}

async function runScrollBehavior(win) {
  return win.webContents.executeJavaScript(`(async () => {
    const api = globalThis.__VINIPER_TEST_API__;
    const internal = globalThis.__V501_INTERNAL__;
    const chat = document.querySelector("#chat-container");
    const messages = document.querySelector("#messages");
    const tick = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const append = (label) => {
      const article = document.createElement("article");
      article.className = "msg assistant";
      article.innerHTML = '<div class="msg-content"><div class="msg-text-segment">'
        + label + '<br>新增流式内容</div></div>';
      messages.appendChild(article);
    };

    api.state.isStreaming = true;
    api.state.followOutput = true;
    chat.scrollTop = chat.scrollHeight;
    chat.dispatchEvent(new Event("scroll"));
    await tick();
    const nearBeforeAppend = internal.isNearChatBottom();
    const followBeforeAppend = api.state.followOutput;
    append("near-bottom");
    internal.scrollBottom();
    await tick();
    const nearBottomGap = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
    const nearBottomFollowed = nearBottomGap <= 2;

    chat.scrollTop = Math.max(120, chat.scrollHeight / 3);
    chat.dispatchEvent(new Event("scroll"));
    const heldTop = chat.scrollTop;
    append("manual-hold");
    internal.scrollBottom();
    await tick();
    const manualUpScrollHeld = Math.abs(chat.scrollTop - heldTop) <= 1 && api.state.followOutput === false;

    chat.scrollTop = chat.scrollHeight;
    chat.dispatchEvent(new Event("scroll"));
    append("return-bottom");
    internal.scrollBottom();
    await tick();
    const returnedToBottomFollowed = chat.scrollHeight - chat.scrollTop - chat.clientHeight <= 1 && api.state.followOutput === true;

    const session = (id, sessionMessages) => ({
      session_id: id,
      id,
      mode: "agent",
      name: id,
      workdir: "D:/" + id,
      permission_mode: "default",
      messages: sessionMessages,
      message_count: sessionMessages.length,
      runtime_state: "running",
      context_usage: { source: "unavailable", used_tokens: 0, context_limit: 0, ratio: 0 },
      active_run: { active: true, run_id: "run-" + id, status: "running", sequence: 1 },
    });
    const aMessages = ${JSON.stringify(longMessages("A"))};
    const bMessages = ${JSON.stringify(longMessages("B"))};
    internal.applySession("A", session("A", aMessages));
    await tick();
    chat.scrollTop = Math.max(120, chat.scrollHeight / 3);
    chat.dispatchEvent(new Event("scroll"));
    const aHeldBeforeSwitch = api.state.followOutput;

    internal.applySession("B", session("B", bMessages));
    await tick();
    const bStartedFollowing = api.state.followOutput;
    chat.scrollTop = chat.scrollHeight;
    chat.dispatchEvent(new Event("scroll"));

    internal.applySession("A", session("A", aMessages));
    await tick();
    const aRestoredFollowing = api.state.followOutput;

    return {
      nearBottomFollowed,
      nearBeforeAppend,
      followBeforeAppend,
      nearBottomGap,
      manualUpScrollHeld,
      returnedToBottomFollowed,
      followIsolation: { aHeldBeforeSwitch, bStartedFollowing, aRestoredFollowing },
    };
  })()`);
}

async function runViewport(width, height) {
  const label = `${width}x${height}`;
  const win = await prepareWindow(width, height);
  try {
    const metrics = await win.webContents.executeJavaScript(`(() => {
      const chat = document.querySelector("#chat-container");
      const rect = chat.getBoundingClientRect();
      const thumbStyle = getComputedStyle(chat, "::-webkit-scrollbar-thumb");
      const visibleOwners = [...document.querySelectorAll("#main *")]
        .filter((node) => {
          const style = getComputedStyle(node);
          const box = node.getBoundingClientRect();
          return box.width > 0 && box.height > 0
            && ["auto", "scroll"].includes(style.overflowY)
            && node.scrollHeight > node.clientHeight + 1;
        })
        .map((node) => node.id || node.className || node.tagName)
        .filter(Boolean);
      chat.scrollTop = 180;
      const direct = chat.scrollTop > 0;
      chat.scrollTop = 0;
      const thumbHeight = Math.max(24, chat.clientHeight * chat.clientHeight / chat.scrollHeight);
      return {
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        clientHeight: chat.clientHeight,
        scrollHeight: chat.scrollHeight,
        thumbHeight,
        thumbStyle: {
          borderLeftWidth: thumbStyle.borderLeftWidth,
          borderRightWidth: thumbStyle.borderRightWidth,
          backgroundImage: thumbStyle.backgroundImage,
          backgroundClip: thumbStyle.backgroundClip,
        },
        visibleOwners,
        direct,
      };
    })()`);

    const behavior = await runScrollBehavior(win);
    await win.webContents.executeJavaScript(`(() => {
      const chat = document.querySelector("#chat-container");
      const messages = document.querySelector("#messages");
      messages.innerHTML = Array.from({ length: 90 }, (_, index) =>
        '<article class="msg assistant"><div class="msg-content"><div class="msg-text-segment">滚动夹具 '
          + (index + 1) + '<br>第二行固定高度</div></div></article>'
      ).join("");
      chat.scrollTop = 0;
    })()`);
    await delay(50);

    const dragAttempts = [];
    for (const offset of [2, 3, 4, 5, 6, 7]) {
      await win.webContents.executeJavaScript(`document.querySelector("#chat-container").scrollTop = 0`);
      const start = {
        x: metrics.rect.right - offset,
        y: metrics.rect.top + Math.max(10, metrics.thumbHeight / 2),
      };
      const end = {
        x: start.x,
        y: Math.min(metrics.rect.bottom - 18, start.y + Math.min(170, metrics.clientHeight / 3)),
      };
      await dispatchMouseDrag(win.webContents, start, end);
      await delay(45);
      const scrollTop = await win.webContents.executeJavaScript(`document.querySelector("#chat-container").scrollTop`);
      const hit = await win.webContents.executeJavaScript(`(() => {
        const node = document.elementFromPoint(${start.x}, ${start.y});
        return node ? (node.id || node.className || node.tagName) : "";
      })()`);
      dragAttempts.push({ offset, start, end, scrollTop, hit });
      if (scrollTop > 0) break;
    }

    const screenshot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(evidenceRoot, `r2-${label}.png`), screenshot.toPNG());
    return {
      layout_ready: metrics.scrollHeight > metrics.clientHeight,
      direct_scroll_works: metrics.direct,
      visible_scroll_owners: metrics.visibleOwners,
      native_thumb_drag_changed_scroll_top: dragAttempts.some((item) => item.scrollTop > 0),
      right_edge_2px_dragged: Boolean(dragAttempts[0]?.offset === 2 && dragAttempts[0]?.scrollTop > 0),
      drag_attempts: dragAttempts,
      thumb_style: metrics.thumbStyle,
      near_bottom_followed: behavior.nearBottomFollowed,
      near_bottom_probe: {
        near_before_append: behavior.nearBeforeAppend,
        follow_before_append: behavior.followBeforeAppend,
        gap_after_append: behavior.nearBottomGap,
      },
      manual_up_scroll_held: behavior.manualUpScrollHeld,
      returned_to_bottom_followed: behavior.returnedToBottomFollowed,
      follow_isolation: behavior.followIsolation,
      window_bounds: win.getBounds(),
      renderer_viewport: await win.webContents.executeJavaScript(`({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })`),
    };
  } finally {
    if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    win.destroy();
  }
}

async function runContractSurface() {
  const win = await prepareWindow(1000, 740);
  try {
    const result = await win.webContents.executeJavaScript(`(async () => {
      const api = globalThis.__VINIPER_TEST_API__;
      const internal = globalThis.__V501_INTERNAL__;
      const tick = (ms = 35) => new Promise((resolve) => setTimeout(resolve, ms));
      api.state.status = {
        permission_modes: [
          { id: "default", label: "询问权限" },
          { id: "acceptEdits", label: "自动接受编辑" },
          { id: "plan", label: "计划模式" },
          { id: "bypassPermissions", label: "跳过权限" },
          { id: "auto", label: "自动模式" },
          { id: "dontAsk", label: "不询问" },
        ],
        runtime: { capabilities: { auto_permission: true } },
      };
      api.state.settings = { runtime: { enable_auto_mode: true, allow_bypass_permissions: true } };
      const permissionOrder = api.permissionModeOptions().map((item) => item.id);

      const completedHtml = internal.messageTemplate(
        "assistant",
        "",
        "最终正文",
        "",
        [
          { type: "thinking", content: "不应保留的思考正文", elapsed_seconds: 5 },
          { type: "text", content: "最终正文" },
        ],
        { pending: false, thinking_elapsed_seconds: 5 }
      );

      const sessions = Array.from({ length: 5 }, (_, index) => ({
        id: "S" + index,
        session_id: "S" + index,
        mode: "agent",
        name: index === 3 ? "关键历史会话" : "历史会话 " + index,
        workdir: index === 4 ? "D:/独特路径/project-four" : "D:/projects/project-" + index,
        permission_mode: index === 2 ? "plan" : "default",
        pinned: index === 1,
        unread: index % 2 === 0,
        runtime_state: "idle",
        messages: [{ role: "user", content: "合成历史 " + index }],
        message_count: 1,
        context_usage: { source: "unavailable", used_tokens: 0, context_limit: 0, ratio: 0 },
        updated: 10 - index,
      }));
      window.fetch = async (url) => {
        const target = String(url);
        if (target === "/api/sessions") return { ok: true, status: 200, json: async () => ({ sessions }) };
        if (target.startsWith("/api/sessions/")) {
          const id = decodeURIComponent(target.split("/").pop());
          const found = sessions.find((item) => item.id === id);
          return { ok: Boolean(found), status: found ? 200 : 404, json: async () => found || {} };
        }
        if (target.includes("/queue")) return { ok: true, status: 200, json: async () => ({ items: [] }) };
        if (target.includes("/peers")) return { ok: true, status: 200, json: async () => ({ peer: { available: false, targets: [] } }) };
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      };
      api.state.viewMode = "agent";
      api.state.sessionMode = "agent";
      await internal.loadSessionList();
      const initialRows = document.querySelectorAll("#session-list [data-session]").length;
      const toggle = document.querySelector("#session-history-toggle");
      toggle?.click();
      await tick();
      const input = document.querySelector("#session-history-search");
      const searchWrap = document.querySelector("#session-history-search-wrap");
      const toggleOpened = Boolean(
        toggle?.getAttribute("aria-expanded") === "true"
        && searchWrap
        && getComputedStyle(searchWrap).display !== "none"
      );
      let titleFilteredIds = [];
      let workdirFilteredIds = [];
      let reopenedSessionId = "";
      let reopenedWorkdir = "";
      let reopenedMessage = "";
      if (input) {
        input.value = "关键历史";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await tick();
        titleFilteredIds = [...document.querySelectorAll("#session-list [data-session]")].map((item) => item.dataset.session);
        input.value = "独特路径";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await tick();
        workdirFilteredIds = [...document.querySelectorAll("#session-list [data-session]")].map((item) => item.dataset.session);
        document.querySelector('#session-list [data-open-session="S4"]')?.click();
        await tick(80);
        reopenedSessionId = String(api.state.sessionId || "");
        reopenedWorkdir = String(api.state.workdir || "");
        reopenedMessage = String(api.state.messages?.[0]?.content || "");
      }

      return {
        permissionOrder,
        thinkingSummary: {
          bodyRemoved: !completedHtml.includes("不应保留的思考正文"),
          summaryVisible: /已思考\\s*5\\s*秒/.test(completedHtml),
        },
        history: {
          initialRows,
          searchPresent: Boolean(input),
          toggleOpened,
          titleFilteredIds,
          workdirFilteredIds,
          reopenedSessionId,
          reopenedWorkdir,
          reopenedMessage,
          sessionIndexCount: api.state.sessionIndex.length,
        },
      };
    })()`);
    return result;
  } finally {
    win.destroy();
  }
}

async function main() {
  const viewports = {};
  viewports["1280x800"] = await runViewport(1280, 800);
  viewports["900x700"] = await runViewport(900, 700);
  const contracts = await runContractSurface();
  writeResultOnce({
    viewports,
    permission_order: contracts.permissionOrder,
    thinking_summary: contracts.thinkingSummary,
    history: contracts.history,
  });
}

app.whenReady().then(main).then(() => app.quit()).catch((error) => {
  writeResultOnce({ __harnessError: error?.stack || String(error) });
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (resultWritten) app.quit();
});
