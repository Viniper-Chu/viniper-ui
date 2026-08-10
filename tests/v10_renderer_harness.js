const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();

const harnessResultPath = process.env.VINIPER_RENDERER_HARNESS_RESULT || "";
const forceStdoutEpipe = process.env.VINIPER_RENDERER_HARNESS_FORCE_EPIPE === "1";
let harnessFinished = false;
let stdoutBroken = false;
let pendingStdoutCompletion = null;

process.stdout.on("error", (error) => {
  if (error?.code === "EPIPE") {
    stdoutBroken = true;
    pendingStdoutCompletion?.();
    pendingStdoutCompletion = null;
    return;
  }
  pendingStdoutCompletion?.(error);
  pendingStdoutCompletion = null;
});

async function writeHarnessResultOnce(payload) {
  if (harnessFinished) throw new Error("renderer harness attempted to write more than one result");
  harnessFinished = true;
  if (harnessResultPath) fs.writeFileSync(harnessResultPath, payload, "utf8");
  if (forceStdoutEpipe) {
    const error = Object.assign(new Error("fixture broken pipe"), { code: "EPIPE" });
    process.stdout.emit("error", error);
  }
  if (stdoutBroken) return;
  await new Promise((resolve, reject) => {
    let settled = false;
    const complete = (error) => {
      if (settled) return;
      settled = true;
      pendingStdoutCompletion = null;
      if (error && error.code !== "EPIPE") reject(error);
      else resolve();
    };
    pendingStdoutCompletion = complete;
    try {
      process.stdout.write(payload, complete);
    } catch (error) {
      complete(error);
    }
  });
}

async function closeHarness(win, exitCode) {
  if (win && !win.isDestroyed()) {
    await new Promise((resolve) => {
      win.once("closed", resolve);
      win.destroy();
      if (win.isDestroyed()) resolve();
    });
  }
  app.exit(exitCode);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

let harnessWindow = null;

app.whenReady().then(async () => {
  const root = path.resolve(__dirname, "..");
  const win = new BrowserWindow({ show: false, width: 900, height: 700 });
  harnessWindow = win;
  await win.loadFile(path.join(root, "static", "index.html"));
  const source = fs.readFileSync(path.join(root, "static", "app.js"), "utf8");
  await win.webContents.executeJavaScript(`${source}\n;void 0;\n//# sourceURL=viniper-v10-app.js`);
  const result = await win.webContents.executeJavaScript(`(async () => {
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const api = globalThis.__VINIPER_TEST_API__;
    api.state.sessionId = "session-a";
    const posts = [];
    let responseMode = "ok";
    window.fetch = async (url, options) => {
      posts.push({ url, body: JSON.parse(options.body) });
      if (responseMode === "network") throw new Error("fixture network down");
      return responseMode === "ok"
        ? { ok: true, json: async () => ({ ok: true }) }
        : { ok: false, json: async () => ({ detail: "fixture rejected" }) };
    };

    const one = {
      type: "interaction_request", request_id: "q-one", session_id: "session-a", kind: "question",
      allowed_actions: ["answer", "skip"],
      questions: [{ question: "请选择方案", header: "方案", multiSelect: false,
        options: [{ label: "方案一", description: "保持简单" }, { label: "方案二", description: "扩展能力" }] }]
    };
    const firstCard = api.mountInteractionCard(one);
    const firstRow = firstCard.querySelectorAll("[data-question-option-label]")[0];
    firstRow.click();
    const firstInput = firstRow.querySelector("[data-question-option]");
    const submit = firstCard.querySelector('[data-question-action="answer"]');
    assert(firstInput.checked, "first full-row click must select the radio");
    assert(!submit.disabled, "first selection must immediately enable submit");
    submit.click();
    submit.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert(posts.length === 1, "pending state must suppress duplicate POST");
    assert(document.querySelectorAll("#interaction-dock .inline-interaction-card").length === 0, "2xx must clear the active card while CLI acknowledgement remains server-authoritative");

    responseMode = "error";
    const failed = { ...one, request_id: "q-failed" };
    const failedCard = api.mountInteractionCard(failed);
    failedCard.querySelectorAll("[data-question-option-label]")[1].click();
    failedCard.querySelector('[data-question-action="answer"]').click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert(failedCard.dataset.submitPending !== "true", "non-2xx must leave pending state");
    assert(!failedCard.querySelector('[data-question-action="answer"]').disabled, "non-2xx must re-enable submit");
    assert(failedCard.querySelector(".inline-interaction-status").textContent.includes("fixture rejected"), "non-2xx must show inline error");

    responseMode = "network";
    const networkCard = api.mountInteractionCard({ ...one, request_id: "q-network" });
    networkCard.querySelectorAll("[data-question-option-label]")[0].click();
    networkCard.querySelector('[data-question-action="answer"]').click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert(!networkCard.querySelector('[data-question-action="answer"]').disabled, "network failure must restore controls");
    assert(networkCard.querySelector(".inline-interaction-status").textContent.includes("fixture network down"), "network failure must be visible inline");

    responseMode = "ok";
    const multi = {
      type: "interaction_request", request_id: "q-multi", session_id: "session-a", kind: "question",
      allowed_actions: ["answer", "skip"],
      questions: [
        { question: "第一题", header: "步骤一", multiSelect: false, options: [{ label: "一" }, { label: "二" }] },
        { question: "第二题", header: "步骤二", multiSelect: true, options: [{ label: "甲" }, { label: "乙" }] }
      ]
    };
    const multiCard = api.mountInteractionCard(multi);
    multiCard.querySelectorAll("[data-question-option-label]")[0].click();
    multiCard.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert(multiCard.__interactionState.index === 1, "Enter must advance after an answer");
    multiCard.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));
    multiCard.dispatchEvent(new KeyboardEvent("keydown", { key: "3", bubbles: true }));
    const otherEditor = multiCard.querySelector(".inline-question-other-editor");
    assert(!otherEditor.hidden, "numeric selection of Other must reveal the editor");
    const otherInput = multiCard.querySelector("[data-question-other]");
    otherInput.value = "补充说明";
    otherInput.dispatchEvent(new Event("input", { bubbles: true }));
    multiCard.querySelector('[data-question-action="previous"]').click();
    assert(multiCard.__interactionState.index === 0, "Previous must return to the first question");
    multiCard.querySelectorAll("[data-question-option-label]")[1].click();
    multiCard.querySelector('[data-question-action="next"]').click();
    const answerBeforeSubmit = JSON.parse(JSON.stringify(multiCard.__interactionState.answers));
    multiCard.querySelector('[data-question-action="answer"]').click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const multiPost = posts.find((post) => post.body.request_id === "q-multi");
    assert(multiPost.body.answers["第一题"] === "二", "returning must allow replacing the first answer");
    assert(Array.isArray(multiPost.body.answers["第二题"]), "multi-select must remain an array in the renderer contract");
    assert(multiPost.body.answers["第二题"].includes("甲") && multiPost.body.answers["第二题"].includes("补充说明"), "multi-select and Other text must both be preserved");

    const escapeCard = api.mountInteractionCard({ ...one, request_id: "q-escape" });
    escapeCard.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    const escapePost = posts.find((post) => post.body.request_id === "q-escape");
    assert(escapePost && escapePost.body.action === "skip", "Escape must use the same skip action path");

    const duplicate = api.mountInteractionCard({ ...one, request_id: "q-dedup" });
    const same = api.mountInteractionCard({ ...one, request_id: "q-dedup" });
    assert(duplicate === same && document.querySelectorAll("#interaction-dock .inline-interaction-card").length === 1, "same request must not duplicate the UI contract");
    api.clearInteractionDock("q-dedup");
    assert(document.querySelector("#interaction-dock").children.length === 0, "stop or session refresh must clear the current dock");

    return JSON.stringify({
      posts: posts.length,
      firstClick: true,
      duplicatePostSuppressed: true,
      awaitingAckHidden: true,
      failureRecovered: true,
      multiAnswers: answerBeforeSubmit,
      escapeAction: escapePost.body.action,
      dockCleared: true
    });
  })()`);
  await writeHarnessResultOnce(result);
  await closeHarness(win, 0);
}).catch((error) => {
  const payload = JSON.stringify({ __harnessError: String(error && error.stack || error) });
  const finish = harnessFinished ? Promise.resolve() : writeHarnessResultOnce(payload);
  finish.finally(() => closeHarness(harnessWindow, 1));
});
