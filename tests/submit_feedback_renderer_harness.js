const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

app.whenReady().then(async () => {
  const root = path.resolve(__dirname, "..");
  const win = new BrowserWindow({ show: false, width: 960, height: 720 });
  await win.loadFile(path.join(root, "static", "index.html"));
  const source = fs.readFileSync(path.join(root, "static", "app.js"), "utf8");
  await win.webContents.executeJavaScript(`${source}\n;globalThis.__SUBMIT_INTERNAL__={applySession,renderAllMessages};\n;void 0;\n//# sourceURL=viniper-submit-feedback-app.js`);

  const result = await win.webContents.executeJavaScript(`(async () => {
    const api = globalThis.__VINIPER_TEST_API__;
    const internal = globalThis.__SUBMIT_INTERNAL__;
    const post = (${deferred.toString()})();
    let postObserved = false;
    const session = (messages = []) => ({
      id: "A",
      session_id: "A",
      mode: "agent",
      name: "Agent A",
      workdir: "D:/fixture",
      messages,
      message_count: messages.length,
      runtime_state: "idle",
      context_usage: {},
      revision: "A-1",
    });

    window.fetch = async (url, options = {}) => {
      const target = String(url);
      const method = String(options.method || "GET").toUpperCase();
      if (target === "/api/chat/A" && method === "POST") {
        postObserved = true;
        return post.promise;
      }
      if (target === "/api/sessions/A") {
        return { ok: true, status: 200, json: async () => session([]) };
      }
      if (target === "/api/sessions") {
        return { ok: true, status: 200, json: async () => ({ sessions: [session([])] }) };
      }
      if (target.includes("/queue")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, items: [] }) };
      }
      if (target.includes("/peers")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, peer: { available: false, targets: [] } }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    api.state.status = {
      version: "5.0.0",
      models: [{ id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" }],
      runtime: { status: "ready", ready: true },
    };
    api.state.selectedModel = "deepseek-v4-flash";
    api.state.permissionMode = "default";
    internal.applySession("A", session([]));
    await new Promise((resolve) => setTimeout(resolve, 20));

    const input = document.querySelector("#user-input");
    input.value = "你好";
    const sending = api.sendMessage();
    for (let index = 0; index < 50 && !postObserved; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    if (!postObserved) throw new Error("chat POST was not observed");

    const lastMessageText = (selector) => {
      const nodes = Array.from(document.querySelectorAll(selector));
      return nodes[nodes.length - 1]?.querySelector(".msg-content")?.textContent.trim() || "";
    };
    const snapshot = () => ({
      userText: lastMessageText("#messages .message.user"),
      stateRoles: api.state.messages.map((item) => item.role),
      thinkingHidden: document.querySelector("#thinking")?.classList.contains("hidden") ?? true,
      workingLabel: document.querySelector("#thinking .working-label")?.textContent.trim() || "",
    });
    const immediate = snapshot();

    internal.renderAllMessages();
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const afterReproject = snapshot();

    post.reject(new Error("fixture network down"));
    await sending;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const failed = {
      userText: lastMessageText("#messages .message.user"),
      assistantText: lastMessageText("#messages .message.assistant"),
      retryStatus: Array.from(document.querySelectorAll("#messages .message.assistant .message-run-status")).at(-1)?.textContent.trim() || "",
      stateRoles: api.state.messages.map((item) => item.role),
      hasInteractionCard: Boolean(document.querySelector("#interaction-dock .inline-interaction-card")),
    };

    return JSON.parse(JSON.stringify({ immediate, afterReproject, failed }));
  })().catch((error) => ({ __harnessError: error?.stack || String(error) }))`);

  process.stdout.write(JSON.stringify(result));
  await win.close();
  app.quit();
}).catch((error) => {
  console.error(error && error.stack || error);
  app.exit(1);
});
