import assert from "node:assert/strict";
import { test } from "node:test";
import { RuntimeEvent } from "../../src/core/contracts";
import { createSessionSnapshot } from "../../src/features/sessions/session-factory";
import { applyRuntimeEvent } from "../../src/features/sessions/session-reducer";

test("session factory creates one Agent workspace without a product mode field", () => {
  const session = createSessionSnapshot("D:\\Agent", 100);
  assert.equal(session.workingDirectory, "D:\\Agent");
  assert.equal(Object.prototype.hasOwnProperty.call(session, "mode"), false);
  assert.equal(session.permissionMode, "auto");
});

test("session reducer folds canonical message events into the snapshot", () => {
  const session = createSessionSnapshot("D:\\Agent", 100);
  const events: RuntimeEvent[] = [
    { id: "e1", sessionId: session.id, type: "run.started", timestamp: 101, payload: { runId: "r1" } },
    { id: "e2", sessionId: session.id, type: "message.delta", timestamp: 102, payload: { messageId: "m1", text: "Demo", createdAt: 102 } },
    { id: "e3", sessionId: session.id, type: "message.delta", timestamp: 103, payload: { messageId: "m1", text: " reply", createdAt: 102 } },
    { id: "e4", sessionId: session.id, type: "message.completed", timestamp: 104, payload: { messageId: "m1", text: "Demo reply", createdAt: 102 } },
    { id: "e5", sessionId: session.id, type: "run.completed", timestamp: 105, payload: { runId: "r1" } },
  ];
  for (const event of events) applyRuntimeEvent(session, event);
  assert.equal(session.messages[0].text, "Demo reply");
  assert.equal(session.messages[0].status, "completed");
  assert.equal(session.status, "idle");
  assert.equal(session.events.length, 5);
});

test("session reducer persists plan permission mode for runtime send validation", () => {
  const session = createSessionSnapshot("D:\\Agent", 100);
  applyRuntimeEvent(session, {
    id: "permission-plan",
    sessionId: session.id,
    type: "session.updated",
    timestamp: 101,
    payload: { permissionMode: "plan" },
  });
  assert.equal(session.permissionMode, "plan");
});

test("session failure closes an in-flight reasoning activity", () => {
  const session = createSessionSnapshot("D:\\Agent", 100);
  applyRuntimeEvent(session, { id: "e1", sessionId: session.id, type: "run.started", timestamp: 101, payload: { runId: "r1" } });
  applyRuntimeEvent(session, {
    id: "e2",
    sessionId: session.id,
    type: "thinking.started",
    timestamp: 102,
    payload: { id: "thinking-1", kind: "thinking", title: "Provider 推理", detail: "处理中", status: "running", createdAt: 102 },
  });
  applyRuntimeEvent(session, {
    id: "e3",
    sessionId: session.id,
    type: "run.failed",
    timestamp: 103,
    payload: { runId: "r1", activity: { id: "error-1", kind: "error", title: "失败", detail: "网络错误", status: "failed", createdAt: 103 } },
  });
  assert.equal(session.activities.find((activity) => activity.id === "thinking-1")?.status, "failed");
  assert.equal(session.status, "failed");
});

test("activity projection never mutates append-only requested event payloads", () => {
  const session = createSessionSnapshot("D:\\Agent", 100);
  applyRuntimeEvent(session, {
    id: "tool-request",
    sessionId: session.id,
    type: "tool.requested",
    timestamp: 101,
    payload: {
      id: "tool-1",
      kind: "tool",
      title: "只读工具",
      detail: "{\"path\":\"README.md\"}",
      status: "running",
      readOnly: true,
      createdAt: 101,
    },
  });
  applyRuntimeEvent(session, {
    id: "tool-complete",
    sessionId: session.id,
    type: "tool.completed",
    timestamp: 102,
    payload: { activityId: "tool-1", result: "读取完成" },
  });

  const requested = session.events.find((event) => event.id === "tool-request")!;
  assert.deepEqual(requested.payload, {
    id: "tool-1",
    kind: "tool",
    title: "只读工具",
    detail: "{\"path\":\"README.md\"}",
    status: "running",
    readOnly: true,
    createdAt: 101,
  });
  assert.equal(session.activities[0].status, "completed");
  assert.equal(session.activities[0].detail, "读取完成");
});
