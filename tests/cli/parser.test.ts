import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCliInvocation, parseCliLine } from "../../src/platform/cli/parser";

test("non-interactive parser accepts help and stable JSON run syntax", () => {
  assert.deepEqual(parseCliInvocation([]), { ok: true, value: { kind: "interactive", output: "tty" } });
  assert.deepEqual(parseCliInvocation(["--help"]), { ok: true, value: { kind: "help", output: "tty" } });
  assert.deepEqual(
    parseCliInvocation(["run", "--prompt", "整理当前任务", "--json"]),
    { ok: true, value: { kind: "run", output: "jsonl", prompt: "整理当前任务" } },
  );
  assert.deepEqual(parseCliInvocation(["run", "--json"]), {
    ok: false,
    code: "CLI_USAGE",
    message: "非交互 run 必须提供非空 --prompt。 ",
    output: "jsonl",
  });
  assert.equal(parseCliInvocation(["run", "--prompt", "任务", "--unknown"]).ok, false);
});

test("Phase 4 output aliases preserve old JSON while adding explicit plain and JSONL modes", () => {
  assert.deepEqual(parseCliInvocation(["--plain"]), { ok: true, value: { kind: "interactive", output: "plain" } });
  assert.deepEqual(parseCliInvocation(["--jsonl"]), { ok: true, value: { kind: "interactive", output: "jsonl" } });
  assert.deepEqual(parseCliInvocation(["--help", "--plain"]), { ok: true, value: { kind: "help", output: "plain" } });
  assert.deepEqual(
    parseCliInvocation(["run", "--prompt", "任务", "--plain"]),
    { ok: true, value: { kind: "run", output: "plain", prompt: "任务" } },
  );
  assert.deepEqual(
    parseCliInvocation(["run", "--prompt", "任务", "--jsonl"]),
    { ok: true, value: { kind: "run", output: "jsonl", prompt: "任务" } },
  );
  assert.deepEqual(
    parseCliInvocation(["run", "--prompt", "任务", "--json"]),
    { ok: true, value: { kind: "run", output: "jsonl", prompt: "任务" } },
  );
  assert.equal(parseCliInvocation(["run", "--prompt", "任务", "--plain", "--jsonl"]).ok, false);
});

test("interactive parser covers every v0.6 command and ordinary Agent input", () => {
  const cases = [
    ["/help", { kind: "help" }],
    ["/new 新 会话", { kind: "new", name: "新 会话" }],
    ["/sessions", { kind: "sessions" }],
    ["/sessions 冷青", { kind: "sessions", query: "冷青" }],
    ["/routing", { kind: "routing" }],
    ["/use \"研发 会话\"", { kind: "use", session: "研发 会话" }],
    ["/rename 新名称", { kind: "rename", name: "新名称" }],
    ["普通任务", { kind: "run", prompt: "普通任务" }],
    ["/run 显式任务", { kind: "run", prompt: "显式任务" }],
    ["/cancel", { kind: "cancel" }],
    ["/tokens", { kind: "tokens" }],
    ["/inbox", { kind: "inbox" }],
    ["/send \"目标 会话\" 请检查 文件", { kind: "send", target: "目标 会话", message: "请检查 文件" }],
    ["/delegate target-1 完成 子任务", { kind: "delegate", target: "target-1", task: "完成 子任务" }],
    ["/wait", { kind: "wait", source: undefined }],
    ["/wait source-1", { kind: "wait", source: "source-1" }],
    ["/schedules", { kind: "schedules" }],
    ["/skills", { kind: "skills" }],
    ["/providers", { kind: "providers" }],
    ["/provider demo demo-default", { kind: "provider", profile: "demo", model: "demo-default" }],
    ["/permission full", { kind: "permission", selection: "full" }],
    ["/restore receipt-1", { kind: "restore", receiptId: "receipt-1" }],
    ["/terminal-output execution-1 stdout 4096 8192", { kind: "terminal-output", executionId: "execution-1", stream: "stdout", offset: 4096, maxBytes: 8192 }],
    ["/artifact-read artifact-1 run-1 8192 4096", { kind: "artifact-read", input: { artifactId: "artifact-1", runId: "run-1", offset: 8192, maxBytes: 4096 } }],
    ["/quit", { kind: "quit" }],
  ] as const;
  for (const [input, expected] of cases) {
    assert.deepEqual(parseCliLine(input), { ok: true, value: expected }, input);
  }
});

test("interactive parser rejects incomplete commands and unclosed quotes", () => {
  for (const input of ["/use", "/send one", "/delegate one", "/provider demo", "/permission root", "/restore", "/terminal-output only-id", "/terminal-output id other", "/terminal-output id stdout -1", "/artifact-read only-id", "/artifact-read id run -1", "/tokens extra", "/send \"broken target message"]) {
    assert.equal(parseCliLine(input).ok, false, input);
  }
});
