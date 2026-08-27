import assert from "node:assert/strict";
import { test } from "node:test";
import { PermissionPolicy, decideToolPermission } from "../../src/features/permissions/permission-policy";

const readTool = {
  id: "read-call",
  name: "project.read",
  summary: "读取 fixture.txt",
  readOnly: true,
  scope: "project" as const,
};

const writeTool = {
  id: "write-call",
  name: "project.write",
  summary: "写入 fixture.txt",
  readOnly: false,
  scope: "project" as const,
};

test("v0.16 permissions have exactly manual review, auto review and full access semantics", () => {
  assert.deepEqual(decideToolPermission("ask", readTool), { allowed: false, reason: "approval-required" });
  assert.deepEqual(decideToolPermission("ask", writeTool), { allowed: false, reason: "approval-required" });
  assert.deepEqual(decideToolPermission("auto", readTool), { allowed: true, reason: "auto-read-only" });
  assert.deepEqual(decideToolPermission("auto", writeTool), { allowed: true, reason: "auto-approved" });
  assert.deepEqual(decideToolPermission("full", readTool), { allowed: true, reason: "full-access" });
  assert.deepEqual(decideToolPermission("full", writeTool), { allowed: true, reason: "full-access" });
});

test("manual review stays interactive and full access never creates a pending approval", async () => {
  const policy = new PermissionPolicy("interactive", () => 100);
  await policy.initialize();
  const manual = policy.begin({
    sessionId: "session-a",
    runId: "run-a",
    permissionMode: "ask",
    projectRoot: "D:\\fixture-a",
    tool: writeTool,
    signal: new AbortController().signal,
  });
  assert.equal(manual.state, "pending");
  assert.equal(policy.resolve("session-a", "run-a", "write-call", "reject"), true);
  assert.equal((await manual.resolution).allowed, false);

  const full = policy.begin({
    sessionId: "session-a",
    runId: "run-b",
    permissionMode: "full",
    tool: { ...writeTool, id: "computer-call", scope: "computer" as const },
    signal: new AbortController().signal,
  });
  assert.equal(full.state, "allowed");
  assert.deepEqual(await full.resolution, { allowed: true, reason: "full-access" });
  assert.equal(policy.snapshot().pending.length, 0);
});

test("fail-closed CLI rejects manual review but permits explicit full access", async () => {
  const policy = new PermissionPolicy("fail-closed", () => 100);
  await policy.initialize();
  const manual = policy.begin({
    sessionId: "session-cli",
    runId: "run-manual",
    permissionMode: "ask",
    tool: writeTool,
    signal: new AbortController().signal,
  });
  assert.equal(manual.state, "rejected");
  assert.equal((await manual.resolution).allowed, false);

  const full = policy.begin({
    sessionId: "session-cli",
    runId: "run-full",
    permissionMode: "full",
    tool: writeTool,
    signal: new AbortController().signal,
  });
  assert.deepEqual(await full.resolution, { allowed: true, reason: "full-access" });
});
