const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

async function main() {
  const window = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await window.loadFile(path.join(root, "static", "index.html"));
  const source = fs.readFileSync(path.join(root, "static", "app.js"), "utf8");
  await window.webContents.executeJavaScript(`${source}\n;void 0;\n//# sourceURL=viniper-interaction-durability-app.js`);
  const fixture = JSON.parse(fs.readFileSync(path.join(root, "tests", "fixtures", "v16", "askuserquestion-protocol-matrix.json"), "utf8"));
  const result = await window.webContents.executeJavaScript(`(async () => {
    const base = {
      type: "interaction_request",
      kind: "question",
      request_id: ${JSON.stringify("call_matrix_ask_01")},
      tool_use_id: ${JSON.stringify("call_matrix_ask_01")},
      session_id: "matrix-session-A",
      run_id: "matrix-run-A",
      tool_name: "AskUserQuestion",
      agent_id: ${JSON.stringify(fixture.agent_id)},
      response: ${JSON.stringify(fixture.response)},
      questions: ${JSON.stringify(fixture.input.questions)},
      allowed_actions: ["answer", "skip"]
    };
    const snapshot = (value) => {
      const normalized = window.__VINIPER_TEST_API__.normalizeInteractionRequest(value);
      const host = document.createElement("div");
      host.innerHTML = window.__VINIPER_TEST_API__.renderInteractionCard(normalized, 0);
      document.body.appendChild(host);
      const card = host.querySelector(".inline-interaction-card");
      window.__VINIPER_TEST_API__.bindInteractionCards(host);
      if (value.interaction_state === "pending") {
        const firstOption = card.querySelector("[data-question-option]");
        if (firstOption) {
          firstOption.checked = true;
          firstOption.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
      const submit = card.querySelector('[data-question-action="answer"]');
      const status = card.querySelector(".inline-interaction-status");
      const output = {
        preview: normalized.questions[0].preview,
        futureField: normalized.questions[0].futureQuestionField,
        optionPreview: normalized.questions[0].options[0].preview,
        cardVisible: Boolean(card && !card.hidden),
        actionCount: card?.querySelectorAll("[data-interaction-action],[data-question-action]").length || 0,
        submitEnabled: Boolean(submit && !submit.disabled),
        status: status?.textContent || ""
      };
      host.remove();
      return output;
    };
    const api = window.__VINIPER_TEST_API__;
    api.state.sessionId = "matrix-session-A";
    api.state.sessionMode = "agent";
    api.SessionRunRegistry.start("matrix-session-A", { runId: "matrix-run-A" });
    api.SessionRunRegistry.update("matrix-session-A", {
      pendingInteraction: null,
      awaitingInteractionAck: { ...base, interaction_state: "awaiting_cli_ack", allowed_actions: [] },
      waitingInput: false,
      status: "awaiting_cli_ack"
    });
    api.projectCoordinatedRunEvent("matrix-session-A", {
      type: "interaction_resolved",
      request_id: base.request_id,
      run_id: "matrix-run-A",
      sequence: 1,
      success: false,
      reason: "任务中断；请求未执行"
    });
    const failedCard = document.querySelector("#interaction-dock .inline-interaction-card");
    const failedRecord = api.SessionRunRegistry.get("matrix-session-A");
    const failedEvent = {
      cardVisible: Boolean(failedCard),
      actionCount: failedCard?.querySelectorAll("[data-interaction-action],[data-question-action]").length || 0,
      interactionState: String(failedRecord?.pendingInteraction?.interaction_state || ""),
      submitEnabled: Boolean(failedCard?.querySelector('[data-question-action="answer"]:not(:disabled)')),
      status: failedCard?.querySelector(".inline-interaction-status")?.textContent || ""
    };
    api.SessionRunRegistry.start("disconnect-session", { runId: "disconnect-run" });
    api.SessionRunRegistry.update("disconnect-session", {
      pendingInteraction: { ...base, session_id: "disconnect-session", interaction_state: "pending" },
      waitingInput: true,
      status: "waiting_input"
    });
    api.SessionRunRegistry.finish("disconnect-session", "failed");
    const disconnectRecord = api.SessionRunRegistry.get("disconnect-session");
    const disconnectFailure = {
      pending: Boolean(disconnectRecord?.pendingInteraction),
      requestId: String(disconnectRecord?.pendingInteraction?.request_id || ""),
      status: String(disconnectRecord?.status || "")
    };
    return {
      pending: snapshot({ ...base, interaction_state: "pending" }),
      awaitingAck: snapshot({ ...base, interaction_state: "awaiting_cli_ack" }),
      failed: snapshot({ ...base, interaction_state: "failed", terminal: true, failure_message: "任务中断；请求未执行" }),
      failedEvent,
      disconnectFailure
    };
  })()`);
  process.stdout.write(JSON.stringify(result));
  await window.close();
}

app.whenReady().then(main).catch((error) => {
  process.stdout.write(JSON.stringify({ __harnessError: String(error?.stack || error) }));
  app.exit(1);
});
