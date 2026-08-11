"use strict";

// Real Electron/Chromium fixture for the 5.0.2 visual follow-up.  It keeps one
// BrowserWindow and resizes the same renderer so both viewport contracts share
// one production DOM and one #chat-container scroll owner.
const fs = require("fs");
const path = require("path");
const http = require("http");
const { app, BrowserWindow } = require("electron");

const evidenceRoot = process.env.VINIPER_V502_VISUAL_FOLLOWUP2_EVIDENCE_ROOT;
if (!evidenceRoot) throw new Error("VINIPER_V502_VISUAL_FOLLOWUP2_EVIDENCE_ROOT is required");
fs.mkdirSync(evidenceRoot, { recursive: true });
const resultPath = path.join(evidenceRoot, "visual-followup2-full-result.json");
let wrote = false;
function writeOnce(value) {
  if (wrote) return;
  wrote = true;
  fs.writeFileSync(resultPath, JSON.stringify(value, null, 2), "utf8");
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function variedMessages(label) {
  return Array.from({ length: 9 }, (_, index) => {
    const role = index % 2 ? "assistant" : "user";
    const content = index === 4
      ? `${label} ${"long content ".repeat(90)}`
      : `${label} ${"medium line ".repeat((index + 1) * 8)}`;
    return { role, content, segments: role === "assistant" ? [{ type: "text", content }] : [] };
  });
}

async function main() {
  const root = path.resolve(__dirname, "..");
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(String(request.url || "/").split("?", 1)[0]);
    const relative = requestPath === "/" ? "/static/index.html" : requestPath;
    if (relative === "/static/app.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end("// injected by the renderer fixture");
      return;
    }
    const filePath = path.resolve(root, `.${relative}`);
    if (!filePath.startsWith(root) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      response.writeHead(404); response.end(); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".ico": "image/x-icon" };
    response.setHeader("Content-Type", types[ext] || "application/octet-stream");
    fs.createReadStream(filePath).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    useContentSize: true,
    webPreferences: { backgroundThrottling: false }
  });
  try {
    await win.loadURL(`http://127.0.0.1:${port}/static/index.html`);
    await win.webContents.insertCSS(fs.readFileSync(path.join(root, "static", "style.css"), "utf8"));
    await win.webContents.executeJavaScript(`${fs.readFileSync(path.join(root, "static", "app.js"), "utf8")}
      ;globalThis.__V502_VISUAL_FOLLOWUP2__ = { bindEvents };
      ;void 0;`);
    await win.webContents.executeJavaScript(`(() => {
      const api = globalThis.__VINIPER_TEST_API__;
      window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, sessions: [], items: [], peer: { available: false, targets: [] } }) });
      globalThis.__V502_VISUAL_FOLLOWUP2__.bindEvents();
      api.state.sessionId = "visual-followup2-full";
      api.state.sessionMode = "agent";
      api.state.viewMode = "agent";
      api.state.sessionName = "短标题";
      api.state.workdir = "C:/workspace/viniper";
      api.state.messages = ${JSON.stringify(variedMessages("initial"))};
      api.state.contextUsage = { source: "real", used_tokens: 64000, context_limit: 128000, effective_context_window: 128000, ratio: 0.5, model: "fixture" };
      api.setViewMode("agent");
      api.renderAllMessages();
      api.renderCurrentSession();
    })()`);
    await delay(180);

    const viewports = {};
    for (const [width, height] of [[1280, 800], [900, 700]]) {
      win.setContentSize(width, height);
      await delay(140);
      const baseMessagesJson = JSON.stringify(variedMessages(`${width}x${height}`));
      const compactMessagesJson = JSON.stringify(variedMessages(`${width}x${height}-compact`).slice(0, 3));
      const payload = await win.webContents.executeJavaScript(`(async () => {
        const api = globalThis.__VINIPER_TEST_API__;
        const measureTicks = async (messages) => {
          api.state.messages = messages;
          api.renderSessionHeader();
          api.renderAllMessages();
          api.renderCurrentSession();
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const nodes = [...document.querySelectorAll(".message-trace-tick")];
          const ys = nodes.map((node) => { const r = node.getBoundingClientRect(); return r.top + r.height / 2; });
          const deltas = ys.slice(1).map((y, i) => y - ys[i]);
          const expected = deltas.length ? (ys[ys.length - 1] - ys[0]) / deltas.length : 0;
          const maxDeltaError = deltas.reduce((max, value) => Math.max(max, Math.abs(value - expected)), 0);
          return { ys, deltas, expected, maxDeltaError, tickCount: nodes.length };
        };
        const baseSpacing = await measureTicks(${baseMessagesJson});
        const compactSpacing = await measureTicks(${compactMessagesJson});
        const denseSpacing = await measureTicks(Array.from({ length: 80 }, (_, index) => ({
          role: index % 2 ? "assistant" : "user",
          content: "dense " + index,
          segments: index % 2 ? [{ type: "text", content: "dense " + index }] : []
        })));
        api.state.sessionName = "短标题";
        const container = document.querySelector("#chat-container");
        await measureTicks(${baseMessagesJson});
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const ticks = [...document.querySelectorAll(".message-trace-tick")];
        const ys = baseSpacing.ys;
        const deltas = baseSpacing.deltas;
        const expected = baseSpacing.expected;
        const maxDeltaError = baseSpacing.maxDeltaError;
        const ring = document.querySelector("#context-meter .context-ring");
        const ringStyle = ring ? getComputedStyle(ring) : null;
        const progress = document.querySelector(".context-ring-progress-circle");
        const trackCircle = document.querySelector(".context-ring-track-circle");
        const ringInfo = ring && ringStyle ? {
          backgroundImage: ringStyle.backgroundImage,
          borderColor: ringStyle.borderColor,
          circleCount: document.querySelectorAll("#context-ring circle").length,
          progressDasharray: progress?.style.strokeDasharray || "",
          progressDashoffset: progress?.style.strokeDashoffset || "",
          progressLinecap: getComputedStyle(progress).strokeLinecap,
          progressTransform: getComputedStyle(progress).transform,
          trackStroke: getComputedStyle(trackCircle).stroke,
          progressStroke: getComputedStyle(progress).stroke,
          title: ring.title,
          ariaLabel: ring.getAttribute("aria-label")
        } : null;
        const inputWidths = {};
        api.startInlineSessionRename();
        const shortInput = document.querySelector("#session-title-inline-input");
        inputWidths.short = shortInput ? shortInput.getBoundingClientRect().width : 0;
        if (shortInput) {
          shortInput.value = "一个很长的会话标题用于检查输入框自适应宽度";
          shortInput.dispatchEvent(new Event("input", { bubbles: true }));
          inputWidths.long = shortInput.getBoundingClientRect().width;
          shortInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        }
        const traceRect = document.querySelector("#message-trace-rail")?.getBoundingClientRect();
        const screenshot = {
          width: innerWidth,
          height: innerHeight,
          traceRect: traceRect ? { left: traceRect.left, top: traceRect.top, width: traceRect.width, height: traceRect.height } : null,
          tickCount: ticks.length,
          ys,
          deltas,
          expected,
          maxDeltaError,
          spacingContracts: { compact: compactSpacing, base: baseSpacing, dense: denseSpacing },
          ringInfo,
          inputWidths,
          scrollOwnerCount: document.querySelectorAll("#chat-container").length,
          sessionId: api.state.sessionId,
          mode: api.state.viewMode
        };
        return screenshot;
      })()`);
      const image = await win.webContents.capturePage();
      image.toPNG();
      fs.writeFileSync(path.join(evidenceRoot, `visual-followup2-${width}x${height}.png`), image.toPNG());
      viewports[`${width}x${height}`] = payload;
    }
    writeOnce({ viewports, fixture: "synthetic unequal-height DOM; one real Electron renderer; no provider/network/data root" });
  } finally {
    if (!wrote) writeOnce({ __harnessError: "window closed before evidence was written" });
    win.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

process.on("uncaughtException", (error) => { writeOnce({ __harnessError: error?.stack || String(error) }); process.exitCode = 1; });
process.on("unhandledRejection", (error) => { writeOnce({ __harnessError: error?.stack || String(error) }); process.exitCode = 1; });
app.whenReady().then(main).then(() => app.quit()).catch((error) => { writeOnce({ __harnessError: error?.stack || String(error) }); app.exit(1); });
