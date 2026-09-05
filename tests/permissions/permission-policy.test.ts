import assert from "node:assert/strict";
import { test } from "node:test";
import { PermissionPolicy, decideToolPermission } from "../../src/features/permissions/permission-policy";

test("PermissionPolicy is the sole auto/ask decision source", async () => {
  const policy = new PermissionPolicy("interactive", () => 100);
  const signal = new AbortController().signal;
  const readOnly = tool("read-call", true);
  const stateChanging = tool("write-call", false);

  assert.deepEqual(await policy.begin({ sessionId: "s", runId: "r", permissionMode: "auto", tool: readOnly, signal }).resolution, {
    allowed: true,
    reason: "auto-read-only",
  });

  const autoWrite = policy.begin({ sessionId: "s", runId: "r", permissionMode: "auto", tool: stateChanging, signal });
  assert.equal(autoWrite.state, "allowed");
  assert.equal(policy.snapshot().pending.length, 0);
  assert.deepEqual(await autoWrite.resolution, { allowed: true, reason: "auto-approved" });

  const askRead = policy.begin({ sessionId: "s", runId: "r2", permissionMode: "ask", tool: readOnly, signal });
  assert.equal(askRead.state, "pending");
  assert.equal(policy.resolve("s", "r2", "read-call", "reject"), true);
  assert.deepEqual(await askRead.resolution, {
    allowed: false,
    reason: "rejected",
    message: "用户已拒绝本次工具调用；工具未执行。",
  });
});

test("a CLI-style PermissionPolicy fails closed without creating a fake pending approval", async () => {
  const policy = new PermissionPolicy("fail-closed", () => 100);
  const authorization = policy.begin({
    sessionId: "s",
    runId: "r",
    permissionMode: "ask",
    tool: tool("call", true),
    signal: new AbortController().signal,
  });
  assert.equal(authorization.state, "rejected");
  assert.equal(policy.snapshot().pending.length, 0);
  assert.deepEqual(await authorization.resolution, {
    allowed: false,
    reason: "host-fail-closed",
    message: "当前入口不支持交互批准，工具已安全拒绝；请在桌面端使用批准界面。",
  });
});

test("accept-edits auto mode still approves project edits but asks for desktop files and commands", () => {
  assert.deepEqual(decideToolPermission("auto", {
    id: "project-write",
    name: "project.write",
    summary: "edit project",
    readOnly: false,
    scope: "project",
    input: {},
  }), { allowed: true, reason: "auto-approved" });
  assert.deepEqual(decideToolPermission("auto", {
    id: "file-write",
    name: "file.write",
    summary: "write desktop",
    readOnly: false,
    scope: "computer",
    input: {},
  }), { allowed: false, reason: "approval-required" });
  assert.deepEqual(decideToolPermission("auto", {
    id: "terminal-run",
    name: "terminal.run",
    summary: "run pwsh",
    readOnly: false,
    scope: "project",
    input: {},
  }), { allowed: false, reason: "approval-required" });
});

test("plan mode rejects side effects without creating a pending approval", async () => {
  const policy = new PermissionPolicy("interactive", () => 100);
  const authorization = policy.begin({
    sessionId: "plan-session",
    runId: "plan-run",
    permissionMode: "plan",
    tool: {
      id: "plan-write",
      name: "file.write",
      summary: "write fixture",
      readOnly: false,
      scope: "computer",
      input: {},
    },
    signal: new AbortController().signal,
  });
  assert.equal(authorization.state, "rejected");
  assert.equal(policy.snapshot().pending.length, 0);
  assert.deepEqual(await authorization.resolution, {
    allowed: false,
    reason: "plan-read-only",
    message: "计划模式只允许只读工具；本次副作用工具未执行。",
  });
});

test("all permission modes reject already cancelled work before granting or prompting", async () => {
  for (const permissionMode of ["ask", "auto", "review", "full", "plan"] as const) {
    const policy = new PermissionPolicy("interactive", () => 100);
    const controller = new AbortController();
    controller.abort();
    const authorization = policy.begin({
      sessionId: "cancelled-session", runId: "cancelled-run", permissionMode,
      tool: tool("cancelled-tool", true), signal: controller.signal,
    });
    assert.equal(authorization.state, "rejected", permissionMode);
    assert.equal((await authorization.resolution).reason, "cancelled", permissionMode);
    assert.equal(policy.snapshot().pending.length, 0, permissionMode);
  }
});

function tool(id: string, readOnly: boolean) {
  return {
    id,
    name: readOnly ? "demo.read" : "coordination.send-message",
    summary: "fixture",
    readOnly,
    scope: readOnly ? "computer" as const : "external" as const,
    input: {},
  };
}
