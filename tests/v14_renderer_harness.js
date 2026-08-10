const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const root = path.resolve(__dirname, "..");
  const win = new BrowserWindow({ show: false, width: 900, height: 700 });
  await win.loadFile(path.join(root, "static", "index.html"));
  const source = fs.readFileSync(path.join(root, "static", "app.js"), "utf8");
  await win.webContents.executeJavaScript(`${source}\n;globalThis.__V14_INTERNAL__ = { applySession, bindEvents };\n;void 0;\n//# sourceURL=viniper-v14-app.js`);

  const result = await win.webContents.executeJavaScript(`(async () => {
    const api = globalThis.__VINIPER_TEST_API__;
    const internal = globalThis.__V14_INTERNAL__;
    const calls = [];
    window.__v14Calls = calls;
    window.__v14GuidanceMode = "ok";
    window.__v14QueueMode = "ok";
    window.__v14DeferredGuidance = new Map();
    window.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || "GET", body: options.body || "" });
      const guidance = String(url).endsWith("/guidance");
      const queue = String(url).endsWith("/queue");
      const guidanceSession = guidance
        ? decodeURIComponent(String(url).match(/\\/api\\/chat\\/([^/]+)\\/guidance$/)?.[1] || "")
        : "";
      if (guidance && window.__v14GuidanceMode === "defer") {
        return new Promise((resolve) => {
          window.__v14DeferredGuidance.set(guidanceSession, {
            resolve(payload = { ok: true, accepted: true, queued: true }) {
              window.__v14DeferredGuidance.delete(guidanceSession);
              resolve({ ok: true, status: 200, json: async () => payload });
            }
          });
        });
      }
      const rejected = (guidance && window.__v14GuidanceMode === "reject")
        || (queue && window.__v14QueueMode === "reject");
      const payload = guidance
        ? (rejected ? { detail: "任务已经结束" } : { ok: true, accepted: true, queued: true })
        : (queue
          ? (rejected ? { detail: "队列暂不可用" } : { ok: true, queued: true, item: { id: "queue-" + calls.length, text: JSON.parse(options.body || "{}").message, status: "queued" } })
          : { ok: true, peer: { available: false, verified: false, targets: [] } });
      return { ok: !rejected, status: rejected ? 409 : 200, json: async () => payload };
    };
    api.state.status = { version: "5.0.0", runtime: { status: "ready", ready: true } };
    internal.bindEvents();

    internal.applySession("A", {
      id: "A", mode: "agent", name: "A", workdir: "D:/work-a", messages: [],
      runtime_state: "running", context_usage: {}, revision: "a"
    });

    internal.applySession("B", {
      id: "B", mode: "agent", name: "B", workdir: "D:/work-b", messages: [],
      runtime_state: "idle", context_usage: {}, revision: "b"
    });
    const projection = {
      thinkingHidden: document.querySelector("#thinking").classList.contains("hidden"),
      stopHidden: document.querySelector("#stop-btn").classList.contains("hidden"),
      inputDisabled: document.querySelector("#user-input").disabled,
      sendDisabled: document.querySelector("#send-btn").disabled,
      hint: document.querySelector(".composer-shortcut").textContent.trim(),
      placeholder: document.querySelector("#user-input").placeholder,
    };

    internal.applySession("B", {
      id: "B", mode: "agent", name: "B", workdir: "D:/work-b", messages: [],
      runtime_state: "running", context_usage: {}, revision: "b-running"
    });
    const bRunning = {
      thinkingHidden: document.querySelector("#thinking").classList.contains("hidden"),
      stopHidden: document.querySelector("#stop-btn").classList.contains("hidden"),
      inputDisabled: document.querySelector("#user-input").disabled,
      hint: document.querySelector(".composer-shortcut").textContent.trim(),
      placeholder: document.querySelector("#user-input").placeholder,
    };
    const beforeBackgroundA = JSON.stringify(bRunning);
    api.SessionRunRegistry.applyEvent("A", { type: "thinking_start" });
    api.SessionRunRegistry.applyEvent("A", { type: "heartbeat", elapsed: 5 });
    const afterBackgroundA = JSON.stringify({
      thinkingHidden: document.querySelector("#thinking").classList.contains("hidden"),
      stopHidden: document.querySelector("#stop-btn").classList.contains("hidden"),
      inputDisabled: document.querySelector("#user-input").disabled,
      hint: document.querySelector(".composer-shortcut").textContent.trim(),
      placeholder: document.querySelector("#user-input").placeholder,
    });
    api.SessionRunRegistry.finish("B", "cancelled");
    const stopB = {
      aActive: Boolean(api.SessionRunRegistry.get("A")?.active),
      bActive: Boolean(api.SessionRunRegistry.get("B")?.active),
      stopHidden: document.querySelector("#stop-btn").classList.contains("hidden"),
      inputDisabled: document.querySelector("#user-input").disabled,
    };

    internal.applySession("A", {
      id: "A", mode: "agent", name: "A", workdir: "D:/work-a", messages: [],
      runtime_state: "running", context_usage: {}, revision: "a2"
    });
    calls.length = 0;
    const input = document.querySelector("#user-input");
    input.disabled = false;
    input.value = "请改用更简洁的方案";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    const activeEnter = {
      calls: calls
        .filter((item) => String(item.url).endsWith("/guidance"))
        .map((item) => ({ ...item, body: item.body ? JSON.parse(item.body) : null })),
      allCalls: calls.map((item) => ({ ...item, body: item.body ? JSON.parse(item.body) : null })),
      inputValue: input.value,
      runActive: Boolean(api.SessionRunRegistry.get("A")?.active),
    };
    calls.length = 0;
    input.value = "请立即修正当前步骤";
    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", ctrlKey: true, bubbles: true, cancelable: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    const activeCtrlEnter = {
      calls: calls.map((item) => ({ ...item, body: item.body ? JSON.parse(item.body) : null })),
      inputValue: input.value,
      runActive: Boolean(api.SessionRunRegistry.get("A")?.active),
      markerText: document.querySelector(".message.guidance")?.textContent.trim() || "",
      renderedAsUserBubble: document.querySelector(".message.guidance")?.classList.contains("user") || false,
    };
    window.__v14QueueMode = "reject";
    calls.length = 0;
    input.value = "失败后必须保留";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    const rejectedEnter = {
      calls: calls.map((item) => ({ ...item, body: item.body ? JSON.parse(item.body) : null })),
      inputValue: input.value,
      inputDisabled: input.disabled,
    };

    api.SessionRunRegistry.records.clear();
    internal.applySession("A", {
      id: "A", mode: "agent", name: "A", workdir: "D:/work-a", messages: [],
      runtime_state: "running", context_usage: {}, revision: "a-overlap"
    });
    internal.applySession("B", {
      id: "B", mode: "agent", name: "B", workdir: "D:/work-b", messages: [],
      runtime_state: "running", context_usage: {}, revision: "b-overlap"
    });
    internal.applySession("A", {
      id: "A", mode: "agent", name: "A", workdir: "D:/work-a", messages: [],
      runtime_state: "running", context_usage: {}, revision: "a-overlap-visible"
    });
    window.__v14QueueMode = "ok";
    window.__v14GuidanceMode = "defer";
    calls.length = 0;
    input.value = "A 的运行中修正";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    const aStarted = {
      pending: Boolean(api.SessionRunRegistry.get("A")?.guidancePending),
      sendDisabled: document.querySelector("#send-btn").disabled,
      calls: calls.length,
    };

    internal.applySession("B", {
      id: "B", mode: "agent", name: "B", workdir: "D:/work-b", messages: [],
      runtime_state: "running", context_usage: {}, revision: "b-overlap-visible"
    });
    const bBeforeSubmit = {
      pending: Boolean(api.SessionRunRegistry.get("B")?.guidancePending),
      sendDisabled: document.querySelector("#send-btn").disabled,
      guidanceDataset: document.querySelector("#send-btn").dataset.guidancePending || null,
    };
    input.value = "B 的独立运行中修正";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    const bothPending = {
      aPending: Boolean(api.SessionRunRegistry.get("A")?.guidancePending),
      bPending: Boolean(api.SessionRunRegistry.get("B")?.guidancePending),
      sendDisabled: document.querySelector("#send-btn").disabled,
      calls: calls
        .filter((item) => String(item.url).endsWith("/guidance"))
        .map((item) => ({ ...item, body: item.body ? JSON.parse(item.body) : null })),
    };

    internal.applySession("A", {
      id: "A", mode: "agent", name: "A", workdir: "D:/work-a", messages: [],
      runtime_state: "running", context_usage: {}, revision: "a-pending-visible"
    });
    input.value = "A pending 时的新草稿";
    const aWhileBothPending = {
      pending: Boolean(api.SessionRunRegistry.get("A")?.guidancePending),
      sendDisabled: document.querySelector("#send-btn").disabled,
      inputValue: input.value,
    };
    window.__v14DeferredGuidance.get("B")?.resolve();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const afterBResolvesOnA = {
      aPending: Boolean(api.SessionRunRegistry.get("A")?.guidancePending),
      bPending: Boolean(api.SessionRunRegistry.get("B")?.guidancePending),
      sendDisabled: document.querySelector("#send-btn").disabled,
      inputValue: input.value,
    };

    internal.applySession("B", {
      id: "B", mode: "agent", name: "B", workdir: "D:/work-b", messages: [],
      runtime_state: "running", context_usage: {}, revision: "b-complete-visible"
    });
    input.value = "B 完成后的新草稿";
    window.__v14DeferredGuidance.get("A")?.resolve();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const afterAResolvesOnB = {
      aPending: Boolean(api.SessionRunRegistry.get("A")?.guidancePending),
      bPending: Boolean(api.SessionRunRegistry.get("B")?.guidancePending),
      sendDisabled: document.querySelector("#send-btn").disabled,
      inputValue: input.value,
    };
    internal.applySession("A", {
      id: "A", mode: "agent", name: "A", workdir: "D:/work-a", messages: [],
      runtime_state: "running", context_usage: {}, revision: "a-complete-visible"
    });
    const finalA = {
      pending: Boolean(api.SessionRunRegistry.get("A")?.guidancePending),
      sendDisabled: document.querySelector("#send-btn").disabled,
    };

    input.value = "旧 A run 的待决修正";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    const staleRun = api.SessionRunRegistry.get("A");
    api.SessionRunRegistry.finish("A", "completed");
    const replacementRun = api.SessionRunRegistry.start("A", { mode: "agent", workdir: "D:/work-a" });
    replacementRun.guidancePending = true;
    api.syncCurrentSessionRuntimeUi();
    const beforeStaleFinally = {
      distinctRun: staleRun !== replacementRun,
      replacementPending: Boolean(replacementRun.guidancePending),
      sendDisabled: document.querySelector("#send-btn").disabled,
    };
    window.__v14DeferredGuidance.get("A")?.resolve();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const afterStaleFinally = {
      replacementIsCurrent: api.SessionRunRegistry.get("A") === replacementRun,
      replacementPending: Boolean(replacementRun.guidancePending),
      sendDisabled: document.querySelector("#send-btn").disabled,
    };
    replacementRun.guidancePending = false;
    api.syncCurrentSessionRuntimeUi();
    window.__v14GuidanceMode = "ok";
    const overlapGuidance = {
      aStarted,
      bBeforeSubmit,
      bothPending,
      aWhileBothPending,
      afterBResolvesOnA,
      afterAResolvesOnB,
      finalA,
      beforeStaleFinally,
      afterStaleFinally,
    };
    return { projection, bRunning, backgroundUnchanged: beforeBackgroundA === afterBackgroundA, stopB, activeEnter, activeCtrlEnter, rejectedEnter, overlapGuidance };
  })().catch((error) => ({ __harnessError: error?.stack || String(error) }))`);

  await win.webContents.executeJavaScript(`(() => {
    window.__v14Calls.length = 0;
    const input = document.querySelector("#user-input");
    input.value = "第一行";
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  })()`);
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter", modifiers: ["shift"] });
  win.webContents.sendInputEvent({ type: "char", keyCode: "\r", modifiers: ["shift"] });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter", modifiers: ["shift"] });
  await new Promise((resolve) => setTimeout(resolve, 60));
  result.shiftEnter = await win.webContents.executeJavaScript(`(() => ({
    value: document.querySelector("#user-input").value,
    calls: window.__v14Calls.length,
  }))()`);

  process.stdout.write(JSON.stringify(result));
  await win.close();
  app.quit();
}).catch((error) => {
  console.error(error && error.stack || error);
  app.exit(1);
});
