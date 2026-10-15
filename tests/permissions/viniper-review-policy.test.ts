import test from "node:test";
import assert from "node:assert/strict";
import { PermissionPolicy, decideToolPermission } from "../../src/features/permissions/permission-policy";

const readOnly = { id: "read", name: "file.read", summary: "read", scope: "project", readOnly: true, inputSchema: {} } as const;
const projectWrite = { id: "write", name: "file.write", summary: "write", scope: "project", readOnly: false, inputSchema: {} } as const;
const externalWrite = { id: "shell", name: "terminal.run", summary: "run", scope: "computer", readOnly: false, inputSchema: {} } as const;
const safeProjectTerminal = {
  id: "safe-shell",
  name: "terminal.run",
  summary: "project diagnostic",
  scope: "project",
  readOnly: false,
  input: { command: "Write-Output 'REVIEW_SAFE_OK'", purpose: "test" },
} as const;
const riskyProjectTerminal = {
  id: "risky-shell",
  name: "terminal.run",
  summary: "write outside project",
  scope: "project",
  readOnly: false,
  input: { command: "Set-Content -LiteralPath 'D:\\outside-marker.txt' -Value 'MUST_NOT_RUN'", purpose: "command" },
} as const;
const outOfProjectReadTerminal = {
  id: "outside-read-shell",
  name: "terminal.run",
  summary: "read outside project",
  scope: "project",
  readOnly: false,
  input: { command: "Get-Content 'D:\\outside.txt'", purpose: "command" },
} as const;
const inProjectMutationTerminal = {
  id: "mutation-shell",
  name: "terminal.run",
  summary: "mutating shell command",
  scope: "project",
  readOnly: false,
  input: { command: "Set-Content -LiteralPath 'C:\\project\\marker.txt' -Value 'MUST_NOT_RUN'", purpose: "command" },
} as const;
const unknownProjectTerminal = {
  id: "unknown-shell",
  name: "terminal.run",
  summary: "unknown command",
  scope: "project",
  readOnly: false,
  input: { command: "Invoke-Expression 'Write-Output unknown'", purpose: "command" },
} as const;

test("review terminal containment follows POSIX case and absolute path semantics", () => {
  const root = "/Users/fixture/Project";
  const allow = (command: string, cwd = "") => decideToolPermission("review", {
    ...safeProjectTerminal, input: { command, cwd, purpose: "test" },
  }, { level: "project-full", projectRoot: root }, root).allowed;
  assert.equal(allow("git status", "src"), true);
  assert.equal(allow("git diff /Users/fixture/Project/src"), true);
  assert.equal(allow("git diff /Users/fixture/private.txt"), false);
  assert.equal(allow("git status", "/Users/fixture/project"), false);
  assert.equal(allow("git status", "../Other"), false);
  assert.equal(allow("git diff $(touch unexpected)"), false);
  assert.equal(allow("git diff `touch unexpected`"), false);
});

test("Viniper review mode auto-runs read-only and approved project actions, rejects risk without a prompt", async () => {
  assert.deepEqual(decideToolPermission("review", readOnly), { allowed: true, reason: "review-read-only" });
  assert.deepEqual(decideToolPermission("review", projectWrite, { level: "project-full", projectRoot: "C:/project" }, "C:/project"), {
    allowed: true,
    reason: "review-project-approved",
  });
  assert.deepEqual(decideToolPermission("review", safeProjectTerminal, { level: "project-full", projectRoot: "C:/project" }, "C:/project"), {
    allowed: true,
    reason: "review-project-approved",
  });
  assert.deepEqual(decideToolPermission("review", riskyProjectTerminal, { level: "project-full", projectRoot: "C:/project" }, "C:/project"), {
    allowed: false,
    reason: "review-risk-rejected",
    message: "规划自动审核拒绝了越界或高风险动作；未请求人工批准。",
  });
  assert.equal(decideToolPermission("review", outOfProjectReadTerminal, { level: "project-full", projectRoot: "C:/project" }, "C:/project")?.allowed, false);
  assert.equal(decideToolPermission("review", inProjectMutationTerminal, { level: "project-full", projectRoot: "C:/project" }, "C:/project")?.allowed, false);
  assert.equal(decideToolPermission("review", unknownProjectTerminal, { level: "project-full", projectRoot: "C:/project" }, "C:/project")?.allowed, false);
  assert.equal(decideToolPermission("review", externalWrite)?.allowed, false);
  const policy = new PermissionPolicy("interactive", () => 100);
  const rejected = policy.begin({ sessionId: "s", runId: "r", permissionMode: "review", tool: externalWrite, signal: new AbortController().signal });
  assert.equal(rejected.state, "rejected");
  assert.deepEqual(await rejected.resolution, {
    allowed: false,
    reason: "review-risk-rejected",
    message: "规划自动审核拒绝了越界或高风险动作；未请求人工批准。",
  });
  assert.equal(policy.snapshot().pending.length, 0);
});
