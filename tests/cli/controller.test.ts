import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentIntent, RunSnapshot } from "../../src/core/contracts";
import { CLI_EXIT_CODE } from "../../src/platform/cli/contracts";
import { CliController } from "../../src/platform/cli/controller";
import { JsonlPresenter } from "../../src/platform/cli/presenters";
import { FakeCliApplicationPort, RecordingPresenter, usage } from "./fixture";

test("controller switches independent sessions and forwards collaboration to the application port", async () => {
  const port = new FakeCliApplicationPort();
  const presenter = new RecordingPresenter();
  const controller = new CliController(port, presenter, () => 500);
  await controller.initialize();

  await controller.executeLine("/new \"执行 会话\"");
  assert.equal(port.state.activeSessionId, "session-2");
  assert.equal(port.session("session-2")?.title, "执行 会话");
  await controller.executeLine("/use 主会话");
  assert.equal(port.state.activeSessionId, "session-1");
  await controller.executeLine("/rename 管理 会话");
  assert.equal(port.session("session-1")?.title, "管理 会话");

  await controller.executeLine("/send \"执行 会话\" 请查看进度");
  await controller.executeLine("/delegate \"执行 会话\" 完成子任务");
  await controller.executeLine("/wait \"执行 会话\"");
  assert.deepEqual(
    port.calls.filter((call) => ["sendMessage", "delegateTask", "waitForMessage"].includes(call.method)).map((call) => call.method),
    ["sendMessage", "delegateTask", "waitForMessage"],
  );
  assert.deepEqual(
    port.calls.find((call) => call.method === "sendMessage")?.args,
    ["session-1", "session-2", "请查看进度"],
  );
  assert.deepEqual(
    port.calls.find((call) => call.method === "waitForMessage")?.args,
    ["session-1", { fromSessionId: "session-2" }],
  );

  await controller.executeLine("/use \"执行 会话\"");
  await controller.executeLine("/inbox");
  const inbox = [...presenter.events].reverse().find((event) => event.type === "inbox");
  assert.equal(Array.isArray(inbox?.data.items), true);
  assert.deepEqual(
    (inbox?.data.items as Array<{ body: string }>).map((item) => item.body),
    ["请查看进度", "完成子任务"],
  );
  controller.dispose();
});

test("controller reports current estimate and provider final usage as separate fields", async () => {
  const port = new FakeCliApplicationPort();
  port.state.telemetry.sessions = [{
    sessionId: "session-1",
    cumulative: usage("estimated", 35),
    currentRun: {
      runId: "run-current",
      sessionId: "session-1",
      usage: usage("estimated", 12),
      status: "estimating",
      startedAt: 100,
      updatedAt: 110,
    },
    latestRun: {
      runId: "run-previous",
      sessionId: "session-1",
      usage: usage("provider", 23),
      status: "reconciled",
      startedAt: 50,
      updatedAt: 80,
    },
  }];
  const presenter = new RecordingPresenter();
  const controller = new CliController(port, presenter, () => 500);
  await controller.executeLine("/tokens");
  const event = [...presenter.events].reverse().find((item) => item.type === "tokens")!;
  assert.equal((event.data.currentEstimate as { total: number }).total, 12);
  assert.equal((event.data.currentEstimate as { source: string }).source, "estimated");
  assert.equal((event.data.providerFinal as { total: number }).total, 23);
  assert.equal((event.data.providerFinal as { source: string }).source, "provider");
  controller.dispose();
});

test("read-only schedules, skills and providers are projected from canonical snapshot", async () => {
  const port = new FakeCliApplicationPort();
  port.state.scheduler.definitions.push({
    id: "schedule-1",
    name: "每日整理",
    prompt: "整理",
    schedule: { kind: "daily", hour: 9, minute: 0 },
    target: { kind: "existing-session", sessionId: "session-1" },
    enabled: true,
    nextRunAt: Date.UTC(2026, 7, 13, 1, 0),
    createdAt: 1,
    updatedAt: 1,
  });
  port.state.extensions.skills.push({
    id: "brief",
    name: "任务简报",
    description: "简短汇报",
    source: "built-in",
    packagePath: "skills/brief/SKILL.md",
    enabledSessionIds: ["session-1"],
    loaded: false,
  });
  port.state.extensions.records = [{
    id: "fixture.echo",
    name: "Fixture Echo",
    kind: "executable-plugin",
    source: "marketplace-fixture",
    trust: "untrusted",
    status: "installed",
    enabled: false,
    executable: true,
    capabilities: ["tools:fixture.echo"],
    current: {
      version: "1.0.0",
      source: "marketplace-fixture",
      capabilities: ["tools:fixture.echo"],
      tools: ["fixture.echo"],
      entry: "index.cjs",
      packagePath: "managed",
      installedAt: 1,
    },
  }];
  const presenter = new RecordingPresenter();
  const controller = new CliController(port, presenter);
  await controller.executeLine("/schedules");
  await controller.executeLine("/skills");
  await controller.executeLine("/extensions");
  await controller.executeLine("/providers");
  assert.deepEqual(
    presenter.events.filter((event) => ["schedules", "skills", "extensions", "providers"].includes(event.type)).map((event) => event.type),
    ["schedules", "skills", "extensions", "providers"],
  );
  assert.equal((presenter.events.find((event) => event.type === "extensions")?.data.items as Array<{ source: string }>)[0].source, "marketplace-fixture");
  assert.equal(port.calls.length, 0, "只读命令不应调用编辑服务");

  await controller.executeLine("/provider demo demo-default");
  assert.deepEqual(port.calls.at(-1), { method: "setProviderModel", args: ["session-1", "demo", "demo-default"] });
  controller.dispose();
});

test("cancel and Ctrl+C only target the current session; a second interrupt exits", async () => {
  const port = new FakeCliApplicationPort();
  const session = port.session("session-1")!;
  session.activeRunId = "run-1";
  session.status = "running";
  const presenter = new RecordingPresenter();
  const controller = new CliController(port, presenter);
  await controller.executeLine("/cancel");
  assert.deepEqual(port.calls.at(-1), { method: "cancel", args: ["session-1"] });

  const first = await controller.handleInterrupt();
  assert.equal(first.exitRequested, false);
  assert.deepEqual(port.calls.at(-1), { method: "cancel", args: ["session-1"] });
  const second = await controller.handleInterrupt();
  assert.deepEqual(second, { exitRequested: true, exitCode: CLI_EXIT_CODE.cancelled });
  controller.dispose();
});

test("quit exits with success only when all sessions are idle", async () => {
  const idleController = new CliController(new FakeCliApplicationPort(), new RecordingPresenter());
  assert.deepEqual(await idleController.executeLine("/quit"), {
    exitRequested: true,
    exitCode: CLI_EXIT_CODE.completed,
  });
  idleController.dispose();

  const busyPort = new FakeCliApplicationPort();
  busyPort.session("session-1")!.activeRunId = "run-busy";
  busyPort.session("session-1")!.status = "running";
  const busyPresenter = new RecordingPresenter();
  const busyController = new CliController(busyPort, busyPresenter);
  assert.deepEqual(await busyController.executeLine("/quit"), { exitRequested: false });
  assert.equal(busyPresenter.events.at(-1)?.type, "error");
  assert.equal(busyPresenter.events.at(-1)?.data.code, "RUNS_ACTIVE");
  busyController.dispose();
});

test("non-interactive exit codes distinguish completion, cancellation, failure and missing configuration", async () => {
  assert.equal(await runWithTerminal("completed"), CLI_EXIT_CODE.completed);
  assert.equal(await runWithTerminal("cancelled"), CLI_EXIT_CODE.cancelled);
  assert.equal(await runWithTerminal("failed"), CLI_EXIT_CODE.runFailed);

  const missingPort = new FakeCliApplicationPort();
  missingPort.state.providers[0].available = false;
  missingPort.state.providers[0].configuration = "not-connected";
  const missingController = new CliController(missingPort, new RecordingPresenter());
  assert.equal(await missingController.runNonInteractive("不会进入 Runtime"), CLI_EXIT_CODE.configurationMissing);
  assert.equal(missingPort.calls.some((call) => call.method === "send"), false);
  missingController.dispose();

  const usageController = new CliController(new FakeCliApplicationPort(), new RecordingPresenter());
  assert.equal(await usageController.runNonInteractive("  "), CLI_EXIT_CODE.usageError);
  usageController.dispose();
});

test("controller JSONL stream contains actual port events without decoration", async () => {
  const port = new FakeCliApplicationPort();
  installTerminalBehavior(port, "completed");
  const output = { text: "", isTTY: true, write(chunk: string) { this.text += chunk; } };
  const controller = new CliController(port, new JsonlPresenter(output), () => 500);
  assert.equal(await controller.runNonInteractive("JSONL 任务"), CLI_EXIT_CODE.completed);
  const lines = output.text.trim().split("\n").map((line) => JSON.parse(line) as { schemaVersion: number; type: string; data: unknown });
  assert.equal(lines.every((line) => line.schemaVersion === 1), true);
  assert.equal(lines.some((line) => line.type === "tool.requested"), true);
  assert.equal(lines.some((line) => line.type === "message.delta"), true);
  assert.equal(lines.at(-1)?.type, "run.completed");
  assert.equal(output.text.includes("\u001b["), false);
  controller.dispose();
});

test("P2 desktop/CLI contract projects one canonical structured file event and exposes three-mode permission/restore controls", async () => {
  const port = new FakeCliApplicationPort();
  const session = port.state.sessions[0];
  session.projectAccess = { enabled: true, selectedBy: "cli-explicit" };
  session.workingDirectory = "D:\\fixture-project";
  const presenter = new RecordingPresenter();
  const controller = new CliController(port, presenter, () => 500);
  await controller.initialize();
  await controller.executeLine("/permission full");
  assert.equal(port.calls.some((call) => call.method === "setPermissionMode"
    && call.args[1] === "full"), true);

  port.pushEvent(session.id, "tool.requested", {
    id: "p2-tool",
    kind: "tool",
    title: "原子编辑项目文件",
    detail: "fixture.txt",
    status: "running",
    readOnly: false,
    callId: "p2-call",
    toolName: "project.edit",
    createdAt: 500,
  });
  const presentation = {
    kind: "project-change",
    action: "edit",
    paths: ["fixture.txt"],
    summary: "已原子编辑 fixture.txt。",
    beforeBytes: 4,
    afterBytes: 5,
    patch: "--- a/fixture.txt\n+++ b/fixture.txt\n-old\n+new",
    patchTruncated: false,
    artifactId: "artifact-opaque",
  };
  port.pushEvent(session.id, "tool.completed", {
    activityId: "p2-tool",
    result: "已原子编辑 fixture.txt。",
    presentation,
  });
  const projected = presenter.events.find((event) => event.type === "tool.completed"
    && event.data.activityId === "p2-tool")!;
  assert.deepEqual(projected.data.presentation, presentation);

  await controller.executeLine("/restore receipt-1");
  assert.equal(port.calls.some((call) => call.method === "restoreProjectChange"
    && call.args[1] === "receipt-1"), true);
  controller.dispose();
});

test("P3 CLI reads managed terminal output through the application port and keeps command/run terminals distinct", async () => {
  const port = new FakeCliApplicationPort();
  port.terminalOutputResult = {
    ok: true,
    executionId: "terminal-execution-1",
    stream: "stdout",
    status: "nonzero",
    offset: 8,
    bytes: 4,
    totalBytes: 20,
    text: "NEXT",
    nextOffset: 12,
    truncated: true,
    complete: false,
  };
  const presenter = new RecordingPresenter();
  const controller = new CliController(port, presenter, () => 500);
  await controller.executeLine("/terminal-output terminal-execution-1 stdout 8 4");
  assert.deepEqual(port.calls.at(-1), {
    method: "readTerminalOutput",
    args: ["session-1", { executionId: "terminal-execution-1", stream: "stdout", offset: 8, maxBytes: 4 }],
  });
  const output = presenter.events.at(-1)!;
  assert.equal(output.type, "terminal.output");
  assert.equal(output.data.status, "nonzero");
  assert.equal(output.data.nextOffset, 12);

  port.pushEvent("session-1", "tool.requested", {
    id: "terminal-tool-1", kind: "tool", title: "运行项目测试", detail: "node test", status: "running",
    callId: "terminal-call-1", toolName: "terminal.run", createdAt: 500,
  });
  port.pushEvent("session-1", "tool.failed", {
    activityId: "terminal-tool-1",
    result: "终端命令以非零退出码 7 结束。",
    presentation: {
      kind: "terminal-run", executionId: "terminal-execution-1", status: "nonzero", summary: "测试未通过",
      exitCode: 7, durationMs: 321, cwd: ".",
      stdout: { preview: "", totalBytes: 0, truncated: false, ref: "terminal-output://terminal-execution-1/stdout" },
      stderr: { preview: "FAILED", totalBytes: 6, truncated: false, ref: "terminal-output://terminal-execution-1/stderr" },
    },
  });
  port.pushEvent("session-1", "run.completed", { runId: "run-after-nonzero" });
  const toolTerminal = presenter.events.find((event) => event.type === "tool.failed"
    && event.data.activityId === "terminal-tool-1")!;
  const harnessTerminal = presenter.events.find((event) => event.type === "run.completed"
    && event.data.runId === "run-after-nonzero")!;
  assert.equal((toolTerminal.data.presentation as { exitCode: number }).exitCode, 7);
  assert.equal(harnessTerminal.type, "run.completed");
  controller.dispose();
});

test("CLI exposes canonical same-session run stack with select and target cancel", async () => {
  const port = new FakeCliApplicationPort();
  const runs: RunSnapshot[] = [
    {
      runId: "run-manual",
      sessionId: "session-1",
      origin: { kind: "user" },
      text: "手动任务",
      status: "running",
      createdAt: 1,
      updatedAt: 2,
    },
    {
      runId: "run-auto",
      sessionId: "session-1",
      origin: { kind: "scheduler", scheduleId: "schedule-1" },
      text: "自动任务",
      status: "queued",
      createdAt: 2,
      updatedAt: 2,
      queuedReason: "capacity",
    },
  ];
  port.state.runs = runs;
  port.state.sessions[0].activeRunId = "run-manual";
  port.state.sessions[0].activeRunIds = ["run-manual"];
  port.state.sessions[0].status = "running";
  const presenter = new RecordingPresenter();
  const controller = new CliController(port, presenter);
  await controller.executeLine("/runs");
  await controller.executeLine("/run-select run-auto");
  await controller.executeLine("/run-cancel run-auto");
  assert.equal(presenter.events.find((event) => event.type === "runs")?.data.items instanceof Array, true);
  assert.deepEqual(port.calls.filter((call) => ["listRuns", "selectRun", "cancelRun"].includes(call.method)).map((call) => call.method), [
    "listRuns", "selectRun", "cancelRun",
  ]);
  controller.dispose();
});

async function runWithTerminal(status: "completed" | "cancelled" | "failed") {
  const port = new FakeCliApplicationPort();
  installTerminalBehavior(port, status);
  const presenter = new RecordingPresenter();
  const controller = new CliController(port, presenter, () => 500);
  const result = await controller.runNonInteractive(`任务-${status}`);
  const sent = port.calls.find((call) => call.method === "send")?.args[0] as AgentIntent;
  assert.equal(sent.sessionId, "session-1");
  assert.equal(sent.selectedModel, "demo-default");
  assert.equal(sent.permissionMode, "auto");
  controller.dispose();
  return result;
}

function installTerminalBehavior(port: FakeCliApplicationPort, status: "completed" | "cancelled" | "failed"): void {
  port.sendBehavior = (intent, app) => {
    const runId = `run-${status}`;
    app.pushEvent(intent.sessionId, "run.started", { runId });
    app.pushEvent(intent.sessionId, "message.user", {
      message: { id: "message-user", role: "user", text: intent.text, createdAt: 1, status: "completed" },
      origin: { kind: "user" },
    });
    app.pushEvent(intent.sessionId, "thinking.started", {
      id: "thinking-1", kind: "thinking", title: "本地 Demo 推理", detail: "处理中", status: "running", createdAt: 1,
    });
    app.pushEvent(intent.sessionId, "tool.requested", {
      id: "tool-1", kind: "tool", title: "只读演示工具", detail: "{}", status: "running", readOnly: true, createdAt: 1,
    });
    if (status === "completed") {
      app.pushEvent(intent.sessionId, "tool.completed", { activityId: "tool-1", result: "只读结果" });
      app.pushEvent(intent.sessionId, "message.delta", { messageId: "assistant-1", text: "真实事件文本", createdAt: 1 });
      app.pushEvent(intent.sessionId, "message.completed", { messageId: "assistant-1", text: "真实事件文本", createdAt: 1 });
      app.pushEvent(intent.sessionId, "run.completed", { runId });
    } else if (status === "cancelled") {
      app.pushEvent(intent.sessionId, "run.cancelled", { runId });
    } else {
      app.pushEvent(intent.sessionId, "run.failed", {
        runId,
        activity: { id: "error-1", kind: "error", title: "运行失败", detail: "fixture failure", status: "failed", createdAt: 1 },
      });
    }
    return { accepted: true, queued: false };
  };
}
