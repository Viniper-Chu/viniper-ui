const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();

function writeResult(result) {
  const target = process.env.VINIPER_V17_RENDERER_RESULT;
  if (!target) throw new Error("VINIPER_V17_RENDERER_RESULT is required");
  fs.writeFileSync(target, JSON.stringify(result), "utf8");
}

app.whenReady().then(async () => {
  const root = path.resolve(__dirname, "..");
  const win = new BrowserWindow({ show: false, width: 960, height: 720 });
  await win.loadFile(path.join(root, "static", "index.html"));
  const source = fs.readFileSync(path.join(root, "static", "app.js"), "utf8");
  await win.webContents.executeJavaScript(`${source}\n;globalThis.__V17_INTERNAL__={applySession,restorePendingInteractionCard};\n;void 0;\n//# sourceURL=viniper-v17-app.js`);

  const result = await win.webContents.executeJavaScript(`(async () => {
    const api = globalThis.__VINIPER_TEST_API__;
    const internal = globalThis.__V17_INTERNAL__;
    const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
    const session = (id, extra = {}) => ({
      session_id: id,
      id,
      mode: "agent",
      name: id,
      workdir: "D:/" + id,
      permission_mode: id === "A" ? "plan" : "default",
      messages: [],
      message_count: 0,
      runtime_state: "idle",
      context_usage: { source: "unavailable", used_tokens: 0, context_limit: 0, ratio: 0 },
      revision: id + "-1",
      ...extra,
    });
    const pending = {
      type: "interaction_request",
      kind: "permission",
      session_id: "A",
      run_id: "run-A",
      request_id: "permission-A",
      tool_use_id: "permission-A",
      tool_name: "Bash",
      display: { command: "printf safe" },
      allowed_actions: ["deny", "allow_once"],
    };
    const calls = [];
    window.fetch = async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ url: String(url), method: options.method || "GET", body });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, request_id: body?.request_id || "", status: "awaiting_cli_ack" }),
      };
    };
    api.state.status = {
      permission_modes: [
        { id: "default", label: "询问权限" },
        { id: "acceptEdits", label: "自动接受编辑" },
        { id: "plan", label: "计划模式" },
      ],
      runtime: { capabilities: { auto_permission: true } },
    };
    api.state.settings = { runtime: { enable_auto_mode: true, allow_bypass_permissions: true } };

    internal.applySession("A", session("A", {
      runtime_state: "waiting_input",
      pending_interaction: pending,
      context_usage: { source: "real", used_tokens: 30, context_limit: 100, ratio: 0.3 },
      active_run: { run_id: "run-A", active: true, status: "waiting_input", sequence: 1, pending_interaction: pending },
    }));
    await tick();
    const initialA = {
      permissionMode: api.state.permissionMode,
      cardCount: document.querySelectorAll("#interaction-dock .inline-interaction-card").length,
    };

    document.querySelector('[data-interaction-action="allow_once"]')?.click();
    await tick(35);
    const committedA = {
      cardCount: document.querySelectorAll("#interaction-dock .inline-interaction-card").length,
      pending: Boolean(api.SessionRunRegistry.get("A")?.pendingInteraction),
      awaiting: api.SessionRunRegistry.get("A")?.awaitingInteractionAck?.request_id || "",
      status: api.SessionRunRegistry.get("A")?.status || "",
    };

    internal.applySession("B", session("B"));
    await tick();
    api.projectCoordinatedRunEvent("A", {
      type: "interaction_request",
      session_id: "A",
      run_id: "run-A",
      sequence: 2,
      request_id: "late-A",
      kind: "permission",
      tool_name: "Write",
      display: { file_path: "D:/A/late.txt" },
      allowed_actions: ["deny", "allow_once"],
    });
    await tick();
    const idleB = {
      permissionMode: api.state.permissionMode,
      source: api.state.contextUsage?.source || "",
      isStreaming: Boolean(api.state.isStreaming),
      cardCount: document.querySelectorAll("#interaction-dock .inline-interaction-card").length,
      inputDisabled: Boolean(document.querySelector("#user-input")?.disabled),
      sendDisabled: Boolean(document.querySelector("#send-btn")?.disabled),
    };

    internal.applySession("A", session("A", {
      runtime_state: "awaiting_cli_ack",
      pending_interaction: { ...pending, interaction_state: "awaiting_cli_ack", allowed_actions: [] },
      active_run: {
        run_id: "run-A",
        active: true,
        status: "awaiting_cli_ack",
        sequence: 3,
        pending_interaction: null,
        awaiting_interaction_ack: { request_id: "permission-A" },
      },
    }));
    await tick();
    const restoredA = {
      permissionMode: api.state.permissionMode,
      cardCount: document.querySelectorAll("#interaction-dock .inline-interaction-card").length,
      awaiting: api.SessionRunRegistry.get("A")?.awaitingInteractionAck?.request_id || "",
    };

    api.projectCoordinatedRunEvent("A", {
      type: "interaction_ack",
      session_id: "A",
      run_id: "run-A",
      sequence: 4,
      request_id: "permission-A",
      status: "accepted",
    });
    api.projectCoordinatedRunEvent("A", {
      type: "interaction_ack",
      session_id: "A",
      run_id: "run-A",
      sequence: 5,
      request_id: "permission-A",
      status: "accepted",
    });
    await tick();
    const acceptedA = {
      cardCount: document.querySelectorAll("#interaction-dock .inline-interaction-card").length,
      pending: Boolean(api.SessionRunRegistry.get("A")?.pendingInteraction),
      awaiting: Boolean(api.SessionRunRegistry.get("A")?.awaitingInteractionAck),
      compactResults: api.SessionRunRegistry.get("A")?.segments?.filter((item) => item.type === "interaction_result").length || 0,
    };

    api.projectCoordinatedRunEvent("A", {
      ...pending,
      request_id: "permission-failed",
      tool_use_id: "permission-failed",
      session_id: "A",
      run_id: "run-A",
      sequence: 6,
    });
    api.projectCoordinatedRunEvent("A", {
      type: "interaction_response_committed",
      session_id: "A",
      run_id: "run-A",
      sequence: 7,
      request_id: "permission-failed",
    });
    api.projectCoordinatedRunEvent("A", {
      type: "interaction_ack",
      session_id: "A",
      run_id: "run-A",
      sequence: 8,
      request_id: "permission-failed",
      status: "failed",
      reason: "owner exited",
    });
    api.projectCoordinatedRunEvent("A", {
      type: "interaction_ack",
      session_id: "A",
      run_id: "run-A",
      sequence: 9,
      request_id: "permission-failed",
      status: "failed",
    });
    await tick();
    const failedA = {
      cardCount: document.querySelectorAll("#interaction-dock .inline-interaction-card").length,
      actionableControls: document.querySelectorAll("#interaction-dock button:not([disabled]), #interaction-dock input:not([disabled]), #interaction-dock textarea:not([disabled])").length,
      message: document.querySelector("#interaction-dock .inline-interaction-status")?.textContent || "",
      pendingState: api.SessionRunRegistry.get("A")?.pendingInteraction?.interaction_state || "",
    };

    api.SessionRunRegistry.applyEvent("A", {
      type: "compact_boundary",
      session_id: "A",
      run_id: "run-A",
      trigger: "auto",
      usage: { source: "unavailable", compacting: true, used_tokens: 0, context_limit: 100, ratio: 0 },
    });
    const compacting = {
      a: Boolean(api.SessionRunRegistry.get("A")?.contextCompacting),
      notice: document.querySelector(".context-notice")?.textContent || "",
    };
    api.SessionRunRegistry.applyEvent("A", {
      type: "usage",
      session_id: "A",
      usage: { source: "real", compacting: false, used_tokens: 15, context_limit: 100, ratio: 0.15 },
    });
    const compacted = {
      a: Boolean(api.SessionRunRegistry.get("A")?.contextCompacting),
      used: api.SessionRunRegistry.get("A")?.usage?.used_tokens || 0,
    };

    const onePixel = "iVBORw0KGgo=";
    const imageHtml = api.renderMessageSegments([{ type: "image", mime_type: "image/png", data: onePixel, alt: "结果图" }]);
    const toolImageHtml = api.renderMessageSegments([
      { type: "tool_start", tool_id: "img-tool", name: "截图", status: "running" },
      { type: "tool_result", tool_id: "img-tool", status: "完成", images: [{ type: "image", mime_type: "image/png", data: onePixel, alt: "工具图" }] },
    ]);
    const localImageHtml = api.renderMessageSegments([{ type: "artifact", path: "D:/A/result.png", name: "result.png", image: { type: "image", mime_type: "image/png", data: onePixel, alt: "result.png" } }]);
    const plainPathHtml = api.renderMessageSegments([{ type: "text", content: "输出位于 D:/A/not-an-image.png" }]);
    api.SessionRunRegistry.applyEvent("A", { type: "thinking_start", session_id: "A", run_id: "run-A" });
    api.SessionRunRegistry.applyEvent("A", { type: "image", scope: "thinking", session_id: "A", run_id: "run-A", mime_type: "image/png", data: onePixel, alt: "思考图" });
    const thinkingRecord = api.SessionRunRegistry.get("A");
    const thinkingImageLive = {
      nested: thinkingRecord?.segments?.some((segment) => segment.type === "thinking" && segment.images?.length === 1) || false,
      rendered: (api.renderMessageSegments(thinkingRecord?.segments || [], { activeThinking: true }).match(/<img\\b/g) || []).length,
    };
    api.SessionRunRegistry.applyEvent("A", { type: "text", session_id: "A", run_id: "run-A", content: "最终正文" });
    const thinkingImageFinal = {
      thinkingSegments: api.SessionRunRegistry.get("A")?.segments?.filter((segment) => segment.type === "thinking").length || 0,
      rendered: (api.renderMessageSegments(api.SessionRunRegistry.get("A")?.segments || []).match(/<img\\b/g) || []).length,
    };

    return JSON.parse(JSON.stringify({
      calls,
      initialA,
      committedA,
      idleB,
      restoredA,
      acceptedA,
      failedA,
      compacting,
      compacted,
      thinkingImageLive,
      thinkingImageFinal,
      images: {
        assistant: (imageHtml.match(/<img\\b/g) || []).length,
        tool: (toolImageHtml.match(/<img\\b/g) || []).length,
        artifact: (localImageHtml.match(/<img\\b/g) || []).length,
        plainPath: (plainPathHtml.match(/<img\\b/g) || []).length,
      },
    }));
  })().catch((error) => ({ __harnessError: error?.stack || String(error) }))`);

  writeResult(result);
  await win.close();
  app.quit();
}).catch((error) => {
  try { writeResult({ __harnessError: error?.stack || String(error) }); } catch {}
  app.exit(1);
});
