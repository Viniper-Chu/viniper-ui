const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const root = path.resolve(__dirname, "..");
  const win = new BrowserWindow({ show: false, width: 960, height: 720 });
  await win.loadFile(path.join(root, "static", "index.html"));
  const source = fs.readFileSync(path.join(root, "static", "app.js"), "utf8");
  await win.webContents.executeJavaScript(`${source}\n;globalThis.__V162_INTERNAL__={applySession};\n;void 0;\n//# sourceURL=viniper-v162-app.js`);

  const result = await win.webContents.executeJavaScript(`(async () => {
    const api = globalThis.__VINIPER_TEST_API__;
    const internal = globalThis.__V162_INTERNAL__;
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
    const pending = {
      type: "interaction_request",
      kind: "permission",
      session_id: "A",
      request_id: "toolu-v162",
      tool_name: "Write",
      display: { file_path: "D:/fixture.txt" },
      allowed_actions: ["deny", "allow_once"],
    };
    const calls = [];
    window.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, request_id: "toolu-v162", status: "awaiting_cli_ack" }),
      };
    };

    internal.applySession("A", session("A", {
      runtime_state: "waiting_input",
      pending_interaction: pending,
      active_run: {
        run_id: "run-A",
        active: true,
        status: "waiting_input",
        sequence: 3,
        pending_interaction: pending,
      },
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector('[data-interaction-action="allow_once"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const committed = {
      status: api.SessionRunRegistry.get("A")?.status || "",
      pending: Boolean(api.SessionRunRegistry.get("A")?.pendingInteraction),
      inputDisabled: Boolean(document.querySelector("#user-input")?.disabled),
      sendDisabled: Boolean(document.querySelector("#send-btn")?.disabled),
      composerState: document.querySelector("#composer")?.dataset.runtimeState || "",
      cardCount: document.querySelectorAll("#interaction-dock .inline-interaction-card").length,
      interactionState: document.querySelector("#interaction-dock .inline-interaction-card")?.dataset.interactionState || "",
    };

    internal.applySession("B", session("B"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const idleB = {
      inputDisabled: Boolean(document.querySelector("#user-input")?.disabled),
      sendDisabled: Boolean(document.querySelector("#send-btn")?.disabled),
      cardCount: document.querySelectorAll("#interaction-dock .inline-interaction-card").length,
    };

    internal.applySession("A", session("A", {
      runtime_state: "awaiting_cli_ack",
      pending_interaction: {
        ...pending,
        interaction_state: "awaiting_cli_ack",
        allowed_actions: [],
      },
      active_run: {
        run_id: "run-A",
        active: true,
        status: "awaiting_cli_ack",
        sequence: 4,
        pending_interaction: null,
        awaiting_interaction_ack: { request_id: "toolu-v162" },
      },
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const restored = {
      status: api.SessionRunRegistry.get("A")?.status || "",
      inputDisabled: Boolean(document.querySelector("#user-input")?.disabled),
      cardCount: document.querySelectorAll("#interaction-dock .inline-interaction-card").length,
      interactionState: document.querySelector("#interaction-dock .inline-interaction-card")?.dataset.interactionState || "",
    };

    api.projectCoordinatedRunEvent("A", {
      type: "interaction_resolved",
      request_id: "toolu-v162",
      success: true,
      run_id: "run-A",
      sequence: 5,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const accepted = {
      status: api.SessionRunRegistry.get("A")?.status || "",
      inputDisabled: Boolean(document.querySelector("#user-input")?.disabled),
      sendDisabled: Boolean(document.querySelector("#send-btn")?.disabled),
    };

    const interactionCalls = calls.filter((call) => call.url.includes("/interaction"));
    return JSON.parse(JSON.stringify({ calls: interactionCalls, committed, idleB, restored, accepted }));
  })().catch((error) => ({ __harnessError: error?.stack || String(error) }))`);

  process.stdout.write(JSON.stringify(result));
  await win.close();
  app.quit();
}).catch((error) => {
  console.error(error && error.stack || error);
  app.exit(1);
});
