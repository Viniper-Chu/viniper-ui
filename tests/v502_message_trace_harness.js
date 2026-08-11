"use strict";

// Offline Chromium proof for the Agent-only message trace rail.  It uses the
// production renderer source, synthetic messages, and real CDP pointer input;
// it never contacts a provider or the formal/Preview data roots.
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();

const evidenceRoot = process.env.VINIPER_V502_TRACE_EVIDENCE_ROOT;
if (!evidenceRoot) throw new Error("VINIPER_V502_TRACE_EVIDENCE_ROOT is required");
fs.mkdirSync(evidenceRoot, { recursive: true });
let resultWritten = false;
const resultPath = path.join(evidenceRoot, "message-trace-result.json");

function writeResultOnce(payload) {
  if (resultWritten) return;
  resultWritten = true;
  try { fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), "utf8"); } catch {}
}

function delay(ms = 80) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function pointerClick(win, x, y) {
  // BrowserWindow/WebContents input coordinates are logical DIP/CSS pixels;
  // do not multiply or divide by devicePixelRatio here.  The target rect is
  // reported in the same coordinate space by getBoundingClientRect().
  const inputX = Math.round(Number(x));
  const inputY = Math.round(Number(y));
  win.webContents.sendInputEvent({ type: "mouseMove", x: inputX, y: inputY, movementX: 0, movementY: 0 });
  win.webContents.sendInputEvent({ type: "mouseDown", x: inputX, y: inputY, button: "left", clickCount: 1 });
  win.webContents.sendInputEvent({ type: "mouseUp", x: inputX, y: inputY, button: "left", clickCount: 1 });
  await delay(100);
  return { x: inputX, y: inputY };
}

async function pointerMove(win, x, y) {
  const inputX = Math.round(Number(x));
  const inputY = Math.round(Number(y));
  win.webContents.sendInputEvent({ type: "mouseMove", x: inputX, y: inputY, movementX: 0, movementY: 0 });
  await delay(60);
  return { x: inputX, y: inputY };
}

function fixtureMessages(label, count = 42) {
  return Array.from({ length: count }, (_, index) => {
    const role = index % 2 === 0 ? "user" : "assistant";
    const content = `${label} 第 ${index + 1} 轮消息\n用于离线追溯验证`;
    return { role, content, segments: role === "assistant" ? [{ type: "text", content }] : [] };
  });
}

async function prepareWindow(width, height) {
  const root = path.resolve(__dirname, "..");
  const iconUrl = pathToFileURL(path.join(root, "static", "assets", "viniper-icon.png")).href;
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
    ;globalThis.__V502_TRACE_INTERNAL__ = { bindEvents };
    ;void 0;
    //# sourceURL=viniper-v502-message-trace-app.js`);
  await win.webContents.executeJavaScript(`(() => {
    const api = globalThis.__VINIPER_TEST_API__;
    window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, sessions: [], items: [], peer: { available: false, targets: [] } }) });
    document.querySelectorAll('img[src^="/static/assets/"]').forEach((image) => { image.src = ${JSON.stringify(iconUrl)}; });
    globalThis.__V502_TRACE_INTERNAL__.bindEvents();
    api.state.sessionId = "trace-${width}x${height}";
    api.state.sessionMode = "agent";
    api.state.viewMode = "agent";
    api.state.status = { version: "5.0.2", runtime: { ready: true }, models: [] };
    api.state.messages = ${JSON.stringify(fixtureMessages(`${width}x${height}`))};
    api.setViewMode("agent");
    api.renderAllMessages();
  })()`);
  win.showInactive();
  await delay(150);
  return win;
}

async function runViewport(width, height) {
  const win = await prepareWindow(width, height);
  try {
    const before = await win.webContents.executeJavaScript(`(() => {
      const rail = document.querySelector("#message-trace-rail");
      const track = document.querySelector("#message-trace-track");
      const chat = document.querySelector("#chat-container");
      const ticks = [...document.querySelectorAll(".message-trace-tick")];
      const railRect = rail?.getBoundingClientRect();
      const chatRect = chat?.getBoundingClientRect();
      const style = rail ? getComputedStyle(rail) : null;
      const styleOf = (node) => {
        const computed = node ? getComputedStyle(node) : null;
        return { width: computed ? parseFloat(computed.width) : 0, backgroundColor: computed?.backgroundColor || "" };
      };
      const activeTick = ticks.find((node) => node.classList.contains("active"));
      const defaultTick = ticks.find((node) => !node.classList.contains("active")) || ticks[0];
      return {
        mode: document.body.dataset.viewMode || "",
        rail: { display: style?.display || "", ariaHidden: rail?.getAttribute("aria-hidden"), rect: railRect?.toJSON() || null },
        chatRect: chatRect?.toJSON() || null,
        tickCount: ticks.length,
        messageCount: document.querySelectorAll("#messages > .message").length,
        overflowY: style?.overflowY || "",
        traceStyles: { default: styleOf(defaultTick), active: styleOf(activeTick) },
        tickSample: ticks[12] ? { rect: ticks[12].getBoundingClientRect().toJSON(), pointerEvents: getComputedStyle(ticks[12]).pointerEvents, hit: document.elementFromPoint(ticks[12].getBoundingClientRect().left + ticks[12].getBoundingClientRect().width / 2, ticks[12].getBoundingClientRect().top + ticks[12].getBoundingClientRect().height / 2)?.className || "" } : null,
      };
    })()`);
    const target = await win.webContents.executeJavaScript(`(() => {
      const chat = document.querySelector("#chat-container");
      const ticks = [...document.querySelectorAll(".message-trace-tick")];
      const tick = ticks[Math.min(12, ticks.length - 1)];
      const article = [...document.querySelectorAll("#messages > .message")][Math.min(12, ticks.length - 1)];
      const rect = tick?.getBoundingClientRect();
      chat.scrollTop = 0;
      window.__v502TraceScrollEvents = [];
      chat.addEventListener("scroll", () => {
        const targetNode = document.querySelector('[data-trace-index="12"]');
        const targetRect = targetNode?.getBoundingClientRect();
        const chatRect = chat.getBoundingClientRect();
        window.__v502TraceScrollEvents.push({
          scrollTop: chat.scrollTop,
          targetTop: targetRect?.top ?? null,
          targetBottom: targetRect?.bottom ?? null,
          chatTop: chatRect.top,
          chatBottom: chatRect.bottom,
        });
      }, { passive: true });
      document.addEventListener("pointerdown", (event) => {
        window.__v502TracePointer = { x: event.clientX, y: event.clientY, target: event.target?.dataset?.traceIndex || event.target?.className || "" };
      }, { capture: true, once: false });
      return { index: Number(tick?.dataset.traceIndex || -1), center: rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null, hit: rect ? (document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.dataset?.traceIndex || document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.className || "") : "", beforeScrollTop: chat.scrollTop, articleRect: article?.getBoundingClientRect()?.toJSON() || null, messagesRect: document.querySelector("#messages")?.getBoundingClientRect()?.toJSON() || null };
    })()`);
    const pointerInput = await pointerClick(win, target.center.x, target.center.y);
    const afterClick = await win.webContents.executeJavaScript(`(() => {
      const chat = document.querySelector("#chat-container");
      const target = [...document.querySelectorAll("#messages > .message")][${target.index}];
      const chatRect = chat.getBoundingClientRect();
      const targetRect = target?.getBoundingClientRect();
      const ancestorScrolls = [];
      for (let node = chat; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth || style.overflowY !== "visible") {
          ancestorScrolls.push({ id: node.id || "", className: node.className || "", scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, overflowY: style.overflowY });
        }
      }
      return {
        beforeScrollTop: ${target.beforeScrollTop},
        scrollTop: chat.scrollTop,
        targetIndex: ${target.index},
        targetCenter: targetRect ? targetRect.top + targetRect.height / 2 : null,
        targetRect: targetRect?.toJSON() || null,
        messagesRect: document.querySelector("#messages")?.getBoundingClientRect()?.toJSON() || null,
        ancestorScrolls,
        viewportCenter: chatRect.top + chatRect.height / 2,
        chatHeight: chatRect.height,
        activeIndex: Number(document.querySelector(".message-trace-tick.active")?.dataset.traceIndex || -1),
        pointer: window.__v502TracePointer || null,
        scrollEvents: window.__v502TraceScrollEvents || [],
      };
    })()`);
    const focusedPreview = await win.webContents.executeJavaScript(`(() => {
      const ticks = [...document.querySelectorAll(".message-trace-tick")];
      const target = ticks[Math.min(12, ticks.length - 1)];
      const preview = document.querySelector("#message-trace-preview");
      const overlaps = (a, b) => !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const snapshot = () => {
        const inputRect = document.querySelector("#input-area")?.getBoundingClientRect();
        const dockRect = document.querySelector("#interaction-dock")?.getBoundingClientRect();
        const rect = preview?.getBoundingClientRect();
        const withinViewport = !!rect && rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight;
        return {
          display: preview ? getComputedStyle(preview).display : "none",
          ariaHidden: preview?.getAttribute("aria-hidden"),
          title: document.querySelector("#message-trace-preview-title")?.textContent || "",
          summary: document.querySelector("#message-trace-preview-summary")?.textContent || "",
          rect: rect?.toJSON() || null,
          inputRect: inputRect?.toJSON() || null,
          dockRect: dockRect?.toJSON() || null,
          withinViewport,
          overlapsComposer: overlaps(rect, inputRect),
          overlapsInteractionDock: overlaps(rect, dockRect),
          aboveComposer: !!rect && (!inputRect || rect.bottom <= inputRect.top),
          traceStyles: (() => {
            const styleOf = (node) => {
              const computed = node ? getComputedStyle(node) : null;
              return { width: computed ? parseFloat(computed.width) : 0, backgroundColor: computed?.backgroundColor || "" };
            };
            const defaultTick = ticks.find((node) => !node.classList.contains("active") && node !== target) || ticks[0];
            const activeTick = ticks.find((node) => node.classList.contains("active")) || target;
            const probe = document.createElement("span");
            probe.style.color = getComputedStyle(document.documentElement).getPropertyValue("--accent");
            document.body.appendChild(probe);
            const accentColor = getComputedStyle(probe).color;
            probe.remove();
            const active = styleOf(activeTick);
            const focused = styleOf(target);
            const fallback = styleOf(defaultTick);
            return {
              defaultWidth: fallback.width,
              activeWidth: active.width,
              targetWidth: focused.width,
              defaultColor: fallback.backgroundColor,
              activeColor: active.backgroundColor,
              targetColor: focused.backgroundColor,
              accentColor,
              activeIsAccent: active.backgroundColor === accentColor,
              targetIsAccent: focused.backgroundColor === accentColor,
            };
          })(),
          focusStyles: (() => {
            const composer = document.querySelector("#composer");
            const input = document.querySelector("#user-input");
            const composerStyle = composer ? getComputedStyle(composer) : null;
            const inputStyle = input ? getComputedStyle(input) : null;
            const ring = String(composerStyle?.boxShadow || "").match(/0px 0px 0px\s+([0-9.]+)px/);
            return {
              activeElement: document.activeElement?.id || document.activeElement?.className || "",
              userInputOutlineWidth: inputStyle?.outlineWidth || "",
              userInputOutlineStyle: inputStyle?.outlineStyle || "",
              composerOutlineWidth: composerStyle?.outlineWidth || "",
              composerRingWidth: ring ? Number(ring[1]) : 0,
              composerBoxShadow: composerStyle?.boxShadow || "",
            };
          })(),
        };
      };
      const focusTarget = (node) => { node?.blur(); node?.focus(); node?.dispatchEvent(new FocusEvent("focus", { bubbles: false })); };
      focusTarget(target);
      const focused = snapshot();
      target?.dispatchEvent(new Event("pointerleave", { bubbles: false }));
      const afterPointerLeave = snapshot();
      focusTarget(target);
      target?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      const afterEscape = snapshot();
      const edge = ticks[ticks.length - 1];
      focusTarget(edge);
      const edgePreview = snapshot();
      focusTarget(target);
      target?.dispatchEvent(new Event("pointerenter", { bubbles: false }));
      const finalFocused = snapshot();
      return { ...finalFocused, afterPointerLeave, afterEscape, edgePreview };
    })()`);
    const focusPointer = await win.webContents.executeJavaScript(`(() => {
      const node = document.querySelector('[data-trace-index="12"]') || document.querySelector('.message-trace-tick.active');
      const rect = node?.getBoundingClientRect();
      return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
    })()`);
    if (focusPointer) {
      win.focus();
      await pointerMove(win, focusPointer.x, focusPointer.y);
    }
    await win.webContents.executeJavaScript("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await delay(100);
    const focusedScreenshot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(evidenceRoot, `message-trace-${width}x${height}-focus.png`), focusedScreenshot.toPNG());
    const previewClip = await win.webContents.executeJavaScript(`(() => {
      const preview = document.querySelector("#message-trace-preview");
      const rect = preview?.getBoundingClientRect();
      if (!rect) return null;
      return { x: Math.max(0, Math.floor(rect.left - 12)), y: Math.max(0, Math.floor(rect.top - 12)), width: Math.ceil(rect.width + 24), height: Math.ceil(rect.height + 24) };
    })()`);
    if (previewClip) {
      const previewImage = await win.webContents.capturePage(previewClip);
      fs.writeFileSync(path.join(evidenceRoot, `message-trace-${width}x${height}-preview.png`), previewImage.toPNG());
    }
    const domClick = await win.webContents.executeJavaScript(`(() => {
      const ticks = [...document.querySelectorAll(".message-trace-tick")];
      const target = ticks[Math.min(12, ticks.length - 1)];
      target?.click();
      const chat = document.querySelector("#chat-container");
      const preview = document.querySelector("#message-trace-preview");
      const after = { scrollTop: chat?.scrollTop || 0, activeIndex: Number(document.querySelector(".message-trace-tick.active")?.dataset.traceIndex || -1), previewDisplay: preview ? getComputedStyle(preview).display : "none" };
      return after;
    })()`);
    const screenshot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(evidenceRoot, `message-trace-${width}x${height}.png`), screenshot.toPNG());
    const chatProjection = await win.webContents.executeJavaScript(`(() => {
      const api = globalThis.__VINIPER_TEST_API__;
      api.state.sessionMode = "chat";
      api.state.viewMode = "chat";
      api.setViewMode("chat");
      api.renderAllMessages();
      const rail = document.querySelector("#message-trace-rail");
      return { display: getComputedStyle(rail).display, ariaHidden: rail.getAttribute("aria-hidden"), tickCount: document.querySelectorAll(".message-trace-tick").length };
    })()`);
    return { viewport: { width, height, dpr: await win.webContents.executeJavaScript("devicePixelRatio") }, before, targetProbe: target, afterClick: { ...afterClick, pointerInput }, focusAndDomClick: { focused: focusedPreview, focusPointer, after: domClick }, chatProjection };
  } finally {
    if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    win.destroy();
  }
}

async function main() {
  const viewports = {};
  viewports["1280x800"] = await runViewport(1280, 800);
  viewports["900x700"] = await runViewport(900, 700);
  writeResultOnce({ viewports, fixture: "synthetic UI fixture; no provider/network/data root" });
}

app.whenReady().then(main).then(() => app.quit()).catch((error) => {
  writeResultOnce({ __harnessError: error?.stack || String(error), fixture: "synthetic UI fixture" });
  app.exit(1);
});

app.on("window-all-closed", () => { if (resultWritten) app.quit(); });
