import assert from "node:assert/strict";
import { test } from "node:test";
import { CliEvent } from "../../src/platform/cli/contracts";
import { CLI_HELP_COMMANDS } from "../../src/platform/cli/parser";
import { ChineseTtyPresenter, JsonlPresenter } from "../../src/platform/cli/presenters";

class MemoryOutput {
  text = "";
  constructor(readonly isTTY: boolean) {}
  write(chunk: string): void { this.text += chunk; }
}

test("JSONL presenter emits exactly one undecorated stable object per line", () => {
  const output = new MemoryOutput(true);
  const presenter = new JsonlPresenter(output);
  const event: CliEvent = {
    schemaVersion: 1,
    type: "message.delta",
    timestamp: 123,
    sessionId: "session-1",
    data: { text: "第一行\n第二行", runId: "run-1" },
  };
  presenter.present(event);
  assert.equal(output.text.split("\n").length, 2);
  assert.equal(output.text.includes("\u001b["), false);
  assert.deepEqual(JSON.parse(output.text.trim()), event);
});

test("Chinese TTY presenter disables ANSI for non-TTY and separates estimated from provider usage", () => {
  const output = new MemoryOutput(false);
  const presenter = new ChineseTtyPresenter(output);
  presenter.present({
    schemaVersion: 1,
    type: "tokens",
    timestamp: 123,
    sessionId: "session-1",
    data: {
      sessionTitle: "主会话",
      currentEstimate: { input: 8, output: 4, total: 12 },
      providerFinal: { input: 10, output: 5, total: 15, cacheHitInput: 6 },
      sessionCumulative: { total: 27 },
    },
  });
  assert.match(output.text, /实时估算：约 12/u);
  assert.match(output.text, /Provider 实际：15/u);
  assert.equal(output.text.includes("\u001b["), false);
});

test("Chinese TTY presenter uses limited ANSI only when attached to a TTY", () => {
  const output = new MemoryOutput(true);
  new ChineseTtyPresenter(output).present({
    schemaVersion: 1,
    type: "run.completed",
    timestamp: 123,
    sessionId: "session-1",
    data: { sessionTitle: "主会话", runId: "run-1" },
  });
  assert.match(output.text, /\u001B\[32m/u);
});

test("Chinese presenter closes a streamed reply line before the next lifecycle event", () => {
  const output = new MemoryOutput(false);
  const presenter = new ChineseTtyPresenter(output);
  presenter.present({
    schemaVersion: 1,
    type: "message.delta",
    timestamp: 1,
    sessionId: "session-1",
    data: { sessionTitle: "项目会话", text: "实时结果" },
  });
  presenter.present({
    schemaVersion: 1,
    type: "thinking.completed",
    timestamp: 2,
    sessionId: "session-1",
    data: { sessionTitle: "项目会话" },
  });
  assert.match(output.text, /回复：实时结果\n\[项目会话\] 执行阶段完成/u);
});

test("CLI help and provider listing disclose the Preview credential boundary", () => {
  const output = new MemoryOutput(false);
  const presenter = new ChineseTtyPresenter(output);
  presenter.present({
    schemaVersion: 1,
    type: "help",
    timestamp: 1,
    data: { commands: CLI_HELP_COMMANDS },
  });
  presenter.present({
    schemaVersion: 1,
    type: "providers",
    timestamp: 2,
    data: {
      items: [{ id: "demo", name: "Demo Provider", configuration: "demo", models: ["demo-default"] }],
    },
  });
  assert.match(output.text, /npm run --silent cli/u);
  assert.match(output.text, /不复用桌面 safeStorage 密钥/u);
  assert.match(output.text, /仅 Demo\/local fake 可运行/u);
  assert.match(output.text, /CLI 不提供交互批准/u);
  assert.match(output.text, /fail-closed/u);
});

test("Viniper workstation is the default TTY brand and its primary ANSI accent is cyan", () => {
  const output = new MemoryOutput(true);
  const presenter = new ChineseTtyPresenter(output);
  presenter.present({ schemaVersion: 1, type: "ready", timestamp: 1, data: {} });
  presenter.present({ schemaVersion: 1, type: "help", timestamp: 2, data: { commands: CLI_HELP_COMMANDS } });

  assert.match(output.text, /Viniper CLI/u);
  assert.doesNotMatch(output.text, /平静指挥台/u);
  assert.match(output.text, /\u001B\[36mViniper CLI/u);
});

test("P2 TTY/plain and JSONL consume the same bounded project presentation", () => {
  const event: CliEvent = {
    schemaVersion: 1,
    type: "tool.completed",
    timestamp: 123,
    sessionId: "session-1",
    data: {
      title: "原子编辑项目文件",
      result: "已原子编辑 fixture.txt。",
      presentation: {
        kind: "project-change",
        action: "edit",
        paths: ["fixture.txt"],
        patch: "--- a/fixture.txt\n+++ b/fixture.txt\n-old\n+new",
        patchTruncated: false,
        recoveryReceiptId: "receipt-opaque",
        recoveryStatus: "available",
      },
    },
  };
  const plainOutput = new MemoryOutput(false);
  new ChineseTtyPresenter(plainOutput).present(event);
  assert.match(plainOutput.text, /文件：fixture\.txt/u);
  assert.match(plainOutput.text, /--- a\/fixture\.txt/u);
  assert.match(plainOutput.text, /恢复回执：receipt-opaque/u);
  assert.equal(plainOutput.text.includes("\u001b["), false);

  const jsonOutput = new MemoryOutput(false);
  new JsonlPresenter(jsonOutput).present(event);
  assert.deepEqual(JSON.parse(jsonOutput.text).data.presentation, event.data.presentation);
});

test("P3 TTY/plain and JSONL expose terminal exit status and bounded channel metadata", () => {
  const event: CliEvent = {
    schemaVersion: 1,
    type: "tool.failed",
    timestamp: 124,
    sessionId: "session-1",
    data: {
      title: "运行项目测试",
      result: "终端命令以非零退出码 7 结束。",
      presentation: {
        kind: "terminal-run",
        executionId: "terminal-execution-1",
        status: "nonzero",
        summary: "测试未通过",
        exitCode: 7,
        durationMs: 321,
        cwd: ".",
        stdout: { preview: "PASS-ONE", totalBytes: 8, truncated: false, ref: "terminal-output://terminal-execution-1/stdout" },
        stderr: { preview: "FAIL-SEVEN", totalBytes: 10, truncated: false, ref: "terminal-output://terminal-execution-1/stderr" },
      },
    },
  };
  const plain = new MemoryOutput(false);
  new ChineseTtyPresenter(plain).present(event);
  assert.match(plain.text, /nonzero · exit 7 · 321 ms/u);
  assert.match(plain.text, /stdout：8 字节/u);
  assert.match(plain.text, /stderr：10 字节/u);
  assert.equal(plain.text.includes("\u001b["), false);

  const jsonl = new MemoryOutput(false);
  new JsonlPresenter(jsonl).present(event);
  const parsed = JSON.parse(jsonl.text) as CliEvent;
  assert.equal((parsed.data.presentation as { exitCode: number }).exitCode, 7);
  assert.equal(jsonl.text.includes("\u001b["), false);
});
