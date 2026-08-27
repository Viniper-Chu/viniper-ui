import assert from "node:assert/strict";
import { test } from "node:test";
import type { CompositionCenterSnapshot, CompositionPreset } from "../../src/core/composition-contracts";
import type { WorkflowDefinition, WorkflowRunInput, WorkflowRunSnapshot, WorkflowSnapshot } from "../../src/core/workflow-contracts";
import { CompositionService } from "../../src/features/composition/composition-service";
import { CliController } from "../../src/platform/cli/controller";
import { JsonlPresenter, ChineseTtyPresenter } from "../../src/platform/cli/presenters";
import { parseCliLine, CLI_HELP_COMMANDS } from "../../src/platform/cli/parser";
import { FakeCliApplicationPort } from "./fixture";

test("CP5 CLI：能力方案、steer、workflow 命令可解析且不会退回普通文本", () => {
  const cases = [
    ["/capabilities", "capabilities"],
    ["/preset deepseek-efficient", "preset"],
    ["/preset custom 我的方案", "preset"],
    ["/preset copy standard 我的方案", "preset-copy"],
    ["/preset-toggle 我的方案 code-mode.worker off", "preset-toggle"],
    ["/preset-order 我的方案 token.ledger,core.agent", "preset-order"],
    ["/preset restore", "preset-restore"],
    ["/steer run-1 先完成测试", "steer"],
    ["/workflow", "workflow"],
    ["/workflow demo-workflow {\"input\":\"fixture\"}", "workflow"],
    ["/workflow-cancel workflow-run-1", "workflow-cancel"],
    ["/workflow-recover workflow-run-1 reconfirm", "workflow-recover"],
  ] as const;
  for (const [line, kind] of cases) {
    const result = parseCliLine(line);
    assert.equal(result.ok, true, `${line}: ${result.ok ? "" : result.message}`);
    if (result.ok) assert.equal(result.value.kind, kind, line);
  }
});

test("CP5 CLI：能力与工作流命令的 machine payload 只由 presenter 决定", () => {
  assert.equal(parseCliLine("/steer run-1").ok, false);
  assert.equal(parseCliLine("/workflow demo-workflow not-json").ok, true);
  assert.equal(parseCliLine("/preset unknown").ok, false);
  assert.equal(CLI_HELP_COMMANDS.some((item) => item.syntax === "/capabilities"), true);
  assert.equal(CLI_HELP_COMMANDS.some((item) => item.syntax.startsWith("/preset")), true);
  assert.equal(CLI_HELP_COMMANDS.some((item) => item.syntax === "/steer <运行ID> <消息>"), true);
  assert.equal(CLI_HELP_COMMANDS.some((item) => item.syntax === "/workflow [工作流ID] [JSON输入]"), true);
});

test("CP5 CLI：能力方案、steer、workflow 经同一 application port 在 plain 与 JSONL 都可达", async () => {
  const center = new CompositionService().centerSnapshot("cli");
  const workflow: WorkflowDefinition = {
    id: "demo-workflow",
    revision: 1,
    name: "本地流程",
    mode: "prompt-chaining",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    steps: [{ id: "step-1", kind: "prompt", prompt: "完成 fixture" }],
  };
  const workflowSnapshot: WorkflowSnapshot = { revision: 1, definitions: [workflow], runs: [] };
  const port = installCp5Services(new FakeCliApplicationPort(), center, workflowSnapshot);
  const plainOutput = { text: "", isTTY: false, write(chunk: string) { this.text += chunk; } };
  const plainController = new CliController(port, new ChineseTtyPresenter(plainOutput, { color: false }));
  await plainController.executeLine("/capabilities");
  await plainController.executeLine("/preset deepseek-efficient");
  await plainController.executeLine("/steer run-1 先完成测试");
  await plainController.executeLine("/workflow");
  await plainController.executeLine("/workflow demo-workflow '{\"input\":\"fixture\"}'");
  assert.match(plainOutput.text, /能力方案/u);
  assert.match(plainOutput.text, /已向运行 run-1 投递下一步指令/u);
  assert.match(plainOutput.text, /本地流程/u);
  plainController.dispose();

  const jsonPort = installCp5Services(new FakeCliApplicationPort(), center, workflowSnapshot);
  const jsonOutput = { text: "", isTTY: false, write(chunk: string) { this.text += chunk; } };
  const jsonController = new CliController(jsonPort, new JsonlPresenter(jsonOutput));
  for (const line of ["/capabilities", "/preset deepseek-efficient", "/steer run-1 继续", "/workflow", "/workflow demo-workflow '{\"input\":\"fixture\"}'"]) {
    await jsonController.executeLine(line);
  }
  const events = jsonOutput.text.trim().split("\n").map((line) => JSON.parse(line) as { type: string });
  assert.deepEqual(events.map((event) => event.type), ["capabilities", "capabilities.changed", "steering.updated", "workflows", "workflow.changed"]);
  assert.equal(jsonOutput.text.includes("\u001b["), false);
  assert.equal(jsonPort.calls.some((call) => call.method === "steer"), true);
  assert.equal(jsonPort.calls.some((call) => call.method === "runWorkflow"), true);
  jsonController.dispose();
});

function installCp5Services(
  port: FakeCliApplicationPort,
  center: CompositionCenterSnapshot,
  workflowSnapshot: WorkflowSnapshot,
) {
  return Object.assign(port, {
    getCompositionCenter: async () => structuredClone(center),
    setCompositionPreset: async (preset: CompositionPreset) => {
      port.calls.push({ method: "setCompositionPreset", args: [preset] });
      return structuredClone(center);
    },
    steer: async (runId: string, message: string) => {
      port.calls.push({ method: "steer", args: [runId, message] });
      return { status: "queued", runId };
    },
    listWorkflows: async () => structuredClone(workflowSnapshot),
    runWorkflow: async (input: WorkflowRunInput): Promise<WorkflowRunSnapshot> => {
      port.calls.push({ method: "runWorkflow", args: [input] });
      return {
        id: "workflow-run-1",
        workflowId: input.definition.id,
        workflowRevision: input.definition.revision,
        sessionId: input.sessionId,
        mode: input.definition.mode,
        status: "completed",
        steps: [],
        output: "fixture done",
        usage: { estimatedTokens: 1, cacheRead: null, cacheMiss: null },
        artifactIds: [],
        createdAt: 1,
        updatedAt: 1,
      };
    },
  });
}
