import assert from "node:assert/strict";
import { test } from "node:test";
import { ProviderRegistry } from "../../src/features/providers/provider-registry";
import { AgentRuntime, resolveProviderRequestLimit } from "../../src/features/runs/agent-runtime";
import { FileStore } from "../../src/platform/persistence/file-store";
import { createRuntimeFixture, waitFor } from "./runtime-fixture";
import { TokenLedger } from "../../src/features/telemetry/token-ledger";
import { ToolRegistry } from "../../src/features/tools/tool-registry";

test("Provider request limits keep production defaults and allow an isolated review override", () => {
  assert.equal(resolveProviderRequestLimit("review"), 6);
  assert.equal(resolveProviderRequestLimit("review", { review: 4 }), 4);
  assert.equal(resolveProviderRequestLimit("auto", { review: 4 }), 10);
  assert.equal(resolveProviderRequestLimit("auto", { fullAccess: 8 }), 8);
});

function activeSession(runtime: AgentRuntime) {
  const snapshot = runtime.snapshot();
  return snapshot.sessions.find((session) => session.id === snapshot.activeSessionId)!;
}

test("two Agent sessions isolate messages, events and queue state", async () => {
  const fixture = await createRuntimeFixture();
  try {
    const first = activeSession(fixture.runtime);
    const second = await fixture.runtime.createSession();
    await Promise.all([
      fixture.runtime.send({ sessionId: first.id, text: "第一会话", attachments: [], selectedModel: first.selectedModel, permissionMode: first.permissionMode }),
      fixture.runtime.send({ sessionId: second.id, text: "第二会话", attachments: [], selectedModel: second.selectedModel, permissionMode: second.permissionMode }),
    ]);
    await waitFor(() => fixture.runtime.snapshot().sessions.every((session) => session.status === "idle"));
    const snapshot = fixture.runtime.snapshot();
    const firstAfter = snapshot.sessions.find((session) => session.id === first.id)!;
    const secondAfter = snapshot.sessions.find((session) => session.id === second.id)!;
    assert.deepEqual(firstAfter.messages.filter((message) => message.role === "user").map((message) => message.text), ["第一会话"]);
    assert.deepEqual(secondAfter.messages.filter((message) => message.role === "user").map((message) => message.text), ["第二会话"]);
    assert.equal(firstAfter.events.every((event) => event.sessionId === first.id), true);
    assert.equal(secondAfter.events.every((event) => event.sessionId === second.id), true);
    assert.equal(firstAfter.queue.length, 0);
    assert.equal(secondAfter.queue.length, 0);
  } finally {
    await fixture.dispose();
  }
});

test("auto permission completes the read-only Demo tool", async () => {
  const fixture = await createRuntimeFixture();
  try {
    let latestStatus = activeSession(fixture.runtime).status;
    const unsubscribe = fixture.runtime.subscribe((snapshot) => {
      latestStatus = snapshot.sessions.find((session) => session.id === snapshot.activeSessionId)!.status;
    });
    const session = activeSession(fixture.runtime);
    await fixture.runtime.send({ sessionId: session.id, text: "演示只读工具", attachments: [], selectedModel: session.selectedModel, permissionMode: session.permissionMode });
    await waitFor(() => activeSession(fixture.runtime).status === "idle");
    const after = activeSession(fixture.runtime);
    assert.equal(after.events.some((event) => event.type === "tool.requested"), true);
    assert.equal(after.events.some((event) => event.type === "tool.completed"), true);
    assert.match(after.messages.at(-1)?.text ?? "", /^\[Demo Provider\] Agent 回复：/u);
    assert.equal(latestStatus, "idle");
    unsubscribe();
  } finally {
    await fixture.dispose();
  }
});

test("ask permission pauses for one visible decision and resumes the same run exactly once", async () => {
  const fixture = await createRuntimeFixture();
  const session = activeSession(fixture.runtime);
  try {
    await fixture.runtime.setPermissionMode(session.id, "ask");
    const current = activeSession(fixture.runtime);
    await fixture.runtime.send({ sessionId: current.id, text: "需要工具确认", attachments: [], selectedModel: current.selectedModel, permissionMode: current.permissionMode });
    await waitFor(() => activeSession(fixture.runtime).events.some((event) => event.type === "interaction.requested"));
    assert.equal(fixture.runtime.isRunning(session.id), true);
    assert.equal(activeSession(fixture.runtime).events.some((event) => event.type === "tool.completed"), false);

    const approvalRuntime = fixture.runtime as AgentRuntime & {
      pendingToolApprovals(): Array<{ sessionId: string; callId: string; status: string }>;
      resolveToolApproval(sessionId: string, runId: string, callId: string, decision: "allow-once" | "reject"): Promise<boolean>;
    };
    const pending = approvalRuntime.pendingToolApprovals().find((item) => item.sessionId === session.id)!;
    assert.equal(pending.status, "pending");
    assert.equal(await approvalRuntime.resolveToolApproval(session.id, "stale-run", pending.callId, "allow-once"), false);
    assert.equal(await approvalRuntime.resolveToolApproval(session.id, pending.runId, pending.callId, "allow-once"), true);
    assert.equal(await approvalRuntime.resolveToolApproval(session.id, pending.runId, pending.callId, "allow-once"), false);
    await waitFor(() => activeSession(fixture.runtime).status === "idle");
    const after = activeSession(fixture.runtime);
    assert.equal(after.events.filter((event) => event.type === "tool.completed").length, 1);
  } finally {
    if (fixture.runtime.isRunning(session.id)) {
      await fixture.runtime.cancel(session.id);
      await waitFor(() => !fixture.runtime.isRunning(session.id));
    }
    await fixture.dispose();
  }
});

test("ask permission rejection executes zero tools and returns one explicit denial result", async () => {
  const fixture = await createRuntimeFixture();
  const session = activeSession(fixture.runtime);
  try {
    await fixture.runtime.setPermissionMode(session.id, "ask");
    const current = activeSession(fixture.runtime);
    await fixture.runtime.send({ sessionId: current.id, text: "拒绝这次工具", attachments: [], selectedModel: current.selectedModel, permissionMode: current.permissionMode });
    await waitFor(() => fixture.runtime.pendingToolApprovals().length === 1);
    const pending = fixture.runtime.pendingToolApprovals()[0];
    assert.equal(await fixture.runtime.resolveToolApproval(session.id, pending.runId, pending.callId, "reject"), true);
    assert.equal(await fixture.runtime.resolveToolApproval(session.id, pending.runId, pending.callId, "reject"), false);
    await waitFor(() => activeSession(fixture.runtime).status === "idle");
    const after = activeSession(fixture.runtime);
    assert.equal(after.events.filter((event) => event.type === "tool.completed").length, 0);
    assert.equal(after.events.filter((event) => event.type === "tool.failed").length, 1);
    assert.equal(after.events.filter((event) => event.type === "interaction.resolved").length, 1);
    const denial = after.providerHistory
      .flatMap((entry) => entry.items)
      .find((item) => item.type === "tool-result" && item.callId === pending.callId);
    assert.match(denial?.type === "tool-result" ? denial.content : "", /用户已拒绝/u);
  } finally {
    if (fixture.runtime.isRunning(session.id)) {
      await fixture.runtime.cancel(session.id);
      await waitFor(() => !fixture.runtime.isRunning(session.id));
    }
    await fixture.dispose();
  }
});

test("running input queues, cancellation terminates the current run, then the queue continues", async () => {
  const fixture = await createRuntimeFixture();
  try {
    const session = activeSession(fixture.runtime);
    await fixture.runtime.send({ sessionId: session.id, text: "第一个运行", attachments: [], selectedModel: session.selectedModel, permissionMode: session.permissionMode });
    await waitFor(() => activeSession(fixture.runtime).status === "running");
    const queued = await fixture.runtime.send({ sessionId: session.id, text: "排队任务", attachments: [], selectedModel: session.selectedModel, permissionMode: session.permissionMode });
    assert.deepEqual(queued, { accepted: true, queued: true });
    assert.equal(await fixture.runtime.cancel(session.id), true);
    await waitFor(() => activeSession(fixture.runtime).status === "idle");

    const after = activeSession(fixture.runtime);
    assert.equal(after.events.some((event) => event.type === "run.cancelled"), true);
    assert.equal(after.messages.some((message) => message.role === "user" && message.text === "排队任务"), true);
    assert.equal(after.queue.length, 0);
    assert.equal(after.status, "idle");
  } finally {
    await fixture.dispose();
  }
});

test("a failing completion listener stays visible and cannot block the same-session queue", async () => {
  const fixture = await createRuntimeFixture();
  try {
    const session = activeSession(fixture.runtime);
    fixture.runtime.onRunCompleted(() => {
      throw new Error("completion listener fixture failed");
    });
    await fixture.runtime.send({ sessionId: session.id, text: "监听器前一项", attachments: [], selectedModel: session.selectedModel, permissionMode: session.permissionMode });
    const queued = await fixture.runtime.send({ sessionId: session.id, text: "监听器后一项", attachments: [], selectedModel: session.selectedModel, permissionMode: session.permissionMode });
    assert.deepEqual(queued, { accepted: true, queued: true });
    await waitFor(() => {
      const current = activeSession(fixture.runtime);
      return current.status === "idle"
        && current.queue.length === 0
        && current.events.filter((event) => event.type === "run.listener-failed").length === 2;
    }, 2400);

    const after = activeSession(fixture.runtime);
    assert.deepEqual(
      after.messages.filter((message) => message.role === "user").map((message) => message.text),
      ["监听器前一项", "监听器后一项"],
    );
    assert.equal(after.events.filter((event) => event.type === "run.completed").length, 2);
    assert.equal(after.events.filter((event) => event.type === "run.listener-failed").length, 2);
    assert.match(after.activities.find((activity) => activity.title === "运行后续处理失败")?.detail ?? "", /fixture failed/u);
  } finally {
    await fixture.dispose();
  }
});

test("runtime restores sessions and messages from its own Preview data directory", async () => {
  const fixture = await createRuntimeFixture();
  try {
    const session = activeSession(fixture.runtime);
    await fixture.runtime.renameSession(session.id, "恢复验证");
    await fixture.runtime.send({ sessionId: session.id, text: "请恢复我", attachments: [], selectedModel: session.selectedModel, permissionMode: session.permissionMode });
    await waitFor(() => activeSession(fixture.runtime).status === "idle");

    const recoveredStore = new FileStore(fixture.root);
    const recoveredLedger = new TokenLedger(recoveredStore);
    await recoveredLedger.initialize();
    const recovered = new AgentRuntime({
      persistence: recoveredStore,
      defaultWorkingDirectory: "D:\\Agent",
      registry: new ProviderRegistry(20),
      toolRegistry: new ToolRegistry(),
      tokenLedger: recoveredLedger,
    });
    await recovered.initialize();
    const after = recovered.snapshot().sessions.find((item) => item.id === session.id)!;
    assert.equal(after.title, "恢复验证");
    assert.equal(after.messages.some((message) => message.text === "请恢复我"), true);
    assert.equal(after.events.length > 0, true);
  } finally {
    await fixture.dispose();
  }
});
