const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

app.whenReady().then(async () => {
  const root = path.resolve(__dirname, "..");
  const win = new BrowserWindow({ show: false, width: 960, height: 720 });
  await win.loadFile(path.join(root, "static", "index.html"));
  const source = fs.readFileSync(path.join(root, "static", "app.js"), "utf8");
  await win.webContents.executeJavaScript(`${source}\n;globalThis.__V161_INTERNAL__={switchSession,applySession};\n;void 0;\n//# sourceURL=viniper-v161-app.js`);

  const result = await win.webContents.executeJavaScript(`(async () => {
    const internal = globalThis.__V161_INTERNAL__;
    const api = globalThis.__VINIPER_TEST_API__;
    const slowA = (${deferred.toString()})();
    const calls = [];
    const session = (id, extra = {}) => ({
      session_id: id,
      id,
      mode: "agent",
      name: id,
      workdir: "D:/" + id,
      messages: [],
      message_count: 0,
      runtime_state: "idle",
      context_usage: {},
      revision: id + "-1",
      ...extra,
    });
    window.fetch = async (url) => {
      const target = String(url);
      calls.push(target);
      if (target === "/api/sessions/A") return slowA.promise;
      if (target === "/api/sessions/B") {
        return { ok: true, status: 200, json: async () => session("B") };
      }
      if (target === "/api/sessions") {
        return { ok: true, status: 200, json: async () => ({ sessions: [session("A"), session("B")] }) };
      }
      if (target.includes("/queue")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, items: [] }) };
      }
      if (target.includes("/peers")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, peer: { available: false, targets: [] } }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    const switchA = internal.switchSession("A", { quiet: true, history: false });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const switchB = internal.switchSession("B", { quiet: true, history: false });
    await switchB;
    const afterB = { sessionId: api.state.sessionId, mode: api.state.sessionMode };
    slowA.resolve({ ok: true, status: 200, json: async () => session("A", {
      runtime_state: "waiting_input",
      active_run: {
        run_id: "run-A",
        active: true,
        status: "waiting_input",
        sequence: 7,
        pending_interaction: {
          type: "interaction_request",
          kind: "question",
          session_id: "A",
          request_id: "question-A",
          questions: [{ question: "继续吗？", options: [{ label: "继续" }, { label: "停止" }] }],
          allowed_actions: ["answer"],
        },
      },
    }) });
    await switchA;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const afterSlowA = {
      sessionId: api.state.sessionId,
      mode: api.state.sessionMode,
      cardSession: document.querySelector("#interaction-dock .inline-interaction-card")?.dataset.interactionSessionId || "",
    };

    internal.applySession("R", session("R", {
      runtime_state: "waiting_input",
      active_run: {
        run_id: "run-R",
        active: true,
        status: "waiting_input",
        sequence: 3,
        pending_interaction: {
          type: "interaction_request",
          kind: "permission",
          session_id: "R",
          request_id: "permission-R",
          tool_name: "Write",
          summary: "写入测试文件",
          display: { file_path: "D:/fixture.txt" },
          allowed_actions: ["deny", "allow_once"],
        },
      },
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const restored = {
      runId: api.SessionRunRegistry.get("R")?.runId || "",
      serverSequence: api.SessionRunRegistry.get("R")?.serverSequence ?? -1,
      status: api.SessionRunRegistry.get("R")?.status || "",
      thinkingHidden: document.querySelector("#thinking")?.classList.contains("hidden") ?? false,
      cardRequest: document.querySelector("#interaction-dock .inline-interaction-card")?.dataset.interactionRequestId || "",
      cardSession: document.querySelector("#interaction-dock .inline-interaction-card")?.dataset.interactionSessionId || "",
    };

    return JSON.parse(JSON.stringify({ calls, afterB, afterSlowA, restored }));
  })().catch((error) => ({ __harnessError: error?.stack || String(error) }))`);

  process.stdout.write(JSON.stringify(result));
  await win.close();
  app.quit();
}).catch((error) => {
  console.error(error && error.stack || error);
  app.exit(1);
});
