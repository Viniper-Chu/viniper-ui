const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const root = path.resolve(__dirname, "..");
  const win = new BrowserWindow({ show: false, width: 960, height: 720 });
  await win.loadFile(path.join(root, "static", "index.html"));
  const source = fs.readFileSync(path.join(root, "static", "app.js"), "utf8");
  await win.webContents.executeJavaScript(`${source}\n;globalThis.__V16_INTERNAL__={applySession,bindEvents,addMessage};\n;void 0;\n//# sourceURL=viniper-v16-app.js`);

  const result = await win.webContents.executeJavaScript(`(async () => {
    const api = globalThis.__VINIPER_TEST_API__;
    const internal = globalThis.__V16_INTERNAL__;
    const calls = [];
    const queueItems = new Map([["A", []], ["B", []]]);
    const deferred = new Map();
    let queueMode = "defer";
    window.fetch = async (url, options = {}) => {
      const target = String(url);
      const method = options.method || "GET";
      calls.push({ url: target, method, body: options.body || "" });
      const parts = target.split("/").filter(Boolean);
      const queueIndex = parts.lastIndexOf("queue");
      if (parts[0] === "api" && parts[1] === "chat" && queueIndex === 3) {
        const sessionId = decodeURIComponent(parts[2] || "");
        const itemId = parts[4] ? decodeURIComponent(parts[4]) : "";
        if (method === "GET") {
          return { ok: true, status: 200, json: async () => ({ ok: true, items: queueItems.get(sessionId) || [] }) };
        }
        if (method === "POST") {
          const posted = JSON.parse(options.body || "{}");
          const message = posted.message;
          if (queueMode === "defer") {
            return new Promise((resolve) => deferred.set(sessionId, {
              resolve() {
                const item = { id: "item-" + sessionId, session_id: sessionId, text: message, attachments: posted.attachments || [], status: "queued" };
                queueItems.set(sessionId, [...(queueItems.get(sessionId) || []), item]);
                deferred.delete(sessionId);
                resolve({ ok: true, status: 200, json: async () => ({ ok: true, queued: true, item }) });
              }
            }));
          }
          const item = { id: "item-" + sessionId + "-" + calls.length, session_id: sessionId, text: message, attachments: posted.attachments || [], status: "queued" };
          queueItems.set(sessionId, [...(queueItems.get(sessionId) || []), item]);
          return { ok: true, status: 200, json: async () => ({ ok: true, queued: true, item }) };
        }
        if (method === "PATCH") {
          const message = JSON.parse(options.body || "{}").message;
          const item = { ...(queueItems.get(sessionId) || []).find((candidate) => candidate.id === itemId), text: message };
          queueItems.set(sessionId, (queueItems.get(sessionId) || []).map((candidate) => candidate.id === itemId ? item : candidate));
          return { ok: true, status: 200, json: async () => ({ ok: true, item }) };
        }
        if (method === "DELETE") {
          queueItems.set(sessionId, (queueItems.get(sessionId) || []).filter((candidate) => candidate.id !== itemId));
          return { ok: true, status: 200, json: async () => ({ ok: true, cancelled: true, item_id: itemId }) };
        }
      }
      if (target.endsWith("/guidance")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, accepted: true, queued: true }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, peer: { available: false, targets: [] } }) };
    };
    api.state.status = { version: "5.0.0", runtime: { status: "ready", ready: true } };
    internal.bindEvents();
    const session = (id) => ({
      id, mode: "agent", name: id, workdir: "D:/" + id, messages: [],
      runtime_state: "running", context_usage: {}, revision: id + "-1"
    });

    internal.applySession("A", session("A"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const input = document.querySelector("#user-input");
    input.value = "A 排队";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    const aPending = {
      queuePending: api.SessionRunRegistry.get("A").queuePending,
      sendDisabled: document.querySelector("#send-btn").disabled,
    };

    internal.applySession("B", session("B"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const bBefore = {
      queuePending: api.SessionRunRegistry.get("B").queuePending,
      sendDisabled: document.querySelector("#send-btn").disabled,
      dockText: document.querySelector("#agent-queue-dock").textContent.trim(),
    };
    input.value = "B 排队";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    const bothPending = {
      a: api.SessionRunRegistry.get("A").queuePending,
      b: api.SessionRunRegistry.get("B").queuePending,
    };
    deferred.get("B").resolve();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const bResolved = {
      a: api.SessionRunRegistry.get("A").queuePending,
      b: api.SessionRunRegistry.get("B").queuePending,
      dockText: document.querySelector("#agent-queue-dock").textContent.trim(),
    };
    internal.applySession("A", session("A"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const aBeforeResolve = {
      pending: api.SessionRunRegistry.get("A").queuePending,
      sendDisabled: document.querySelector("#send-btn").disabled,
      dockText: document.querySelector("#agent-queue-dock").textContent.trim(),
    };
    deferred.get("A").resolve();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const aResolved = {
      pending: api.SessionRunRegistry.get("A").queuePending,
      sendDisabled: document.querySelector("#send-btn").disabled,
      dockText: document.querySelector("#agent-queue-dock").textContent.trim(),
    };

    api.SessionRunRegistry.update("A", { segments: [], thinkingVisible: true, workingLabel: "正在工作…" });
    internal.addMessage("assistant", "", { runSessionId: "A" });
    const renderer = api.createStreamRenderer("A");
    renderer.startThinking();
    renderer.append("thinking", "真实思考 delta");
    const thinkingBeforeTool = {
      count: document.querySelectorAll(".thinking-panel").length,
      text: document.querySelector(".thinking-panel")?.textContent || "",
    };
    renderer.appendActivity({ type: "tool_start", tool_id: "tool-1", name: "Bash", summary: "printf fixture" });
    const thinkingAfterTool = {
      count: document.querySelectorAll(".thinking-panel").length,
      toolText: document.querySelector(".activity-segment,.tool-segment")?.textContent || document.querySelector("#messages").textContent,
    };
    api.SessionRunRegistry.update("A", { segments: [], thinkingVisible: true, workingLabel: "正在工作…" });
    renderer.setElapsed(12);
    const noDeltaWorking = {
      hidden: document.querySelector("#thinking").classList.contains("hidden"),
      label: document.querySelector("#thinking .working-label").textContent,
      thinkingPanels: document.querySelectorAll(".thinking-panel").length,
    };

    queueMode = "immediate";
    calls.length = 0;
    input.value = "输入法尚未完成";
    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", isComposing: true, bubbles: true, cancelable: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const imeEnter = { calls: calls.length, value: input.value };

    api.SessionRunRegistry.update("A", {
      pendingInteraction: { request_id: "question-A", kind: "question" },
      waitingInput: true,
      status: "waiting_input",
    });
    calls.length = 0;
    input.value = "不能冒充问题答案的引导";
    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", ctrlKey: true, bubbles: true, cancelable: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const interactionPendingCtrlEnter = {
      calls: calls.filter((item) => String(item.url).endsWith("/guidance")).length,
      value: input.value,
    };

    api.SessionRunRegistry.update("A", { pendingInteraction: null, waitingInput: false, status: "running" });
    api.state.contextFiles.splice(0, api.state.contextFiles.length,
      new File(["fixture attachment"], "fixture.txt", { type: "text/plain" }));
    calls.length = 0;
    input.value = "带附件排队";
    await api.enqueueAgentMessage("A", input);
    const attachmentCall = calls.find((item) => item.method === "POST" && item.url.endsWith("/queue"));
    const attachmentBody = JSON.parse(attachmentCall?.body || "{}");
    const queuedAttachment = {
      attachmentCount: Array.isArray(attachmentBody.attachments) ? attachmentBody.attachments.length : 0,
      name: attachmentBody.attachments?.[0]?.name || "",
      remainingContextFiles: api.state.contextFiles.length,
    };

    return JSON.parse(JSON.stringify({ aPending, bBefore, bothPending, bResolved, aBeforeResolve, aResolved,
      thinkingBeforeTool, thinkingAfterTool, noDeltaWorking, imeEnter, interactionPendingCtrlEnter, queuedAttachment,
      calls: calls.map((item) => ({ url: String(item.url), method: String(item.method), body: String(item.body || "") })) }));
  })().catch((error) => ({ __harnessError: error?.stack || String(error) }))`);

  process.stdout.write(JSON.stringify(result));
  await win.close();
  app.quit();
}).catch((error) => {
  console.error(error && error.stack || error);
  app.exit(1);
});
