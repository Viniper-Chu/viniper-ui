import assert from "node:assert/strict";
import test from "node:test";
import { PermissionPolicy } from "../../src/features/permissions/permission-policy";
import { ToolRequest } from "../../src/core/contracts";

const file: ToolRequest = { id: "write", name: "file.write", summary: "write", readOnly: false, scope: "computer" };
const request = (tool: ToolRequest, permissionMode: "ask" | "full" | "plan" = "ask") => ({ sessionId: "s", runId: "r", permissionMode, tool, signal: new AbortController().signal });

test("existing capabilities execute; a new capability asks once and survives restart without trusting a wider scope", async () => {
  let saved: string[] | undefined;
  const store = { load: async () => saved?.slice(), save: async (value: string[]) => { saved = value.slice(); } };
  const policy = new PermissionPolicy("interactive", () => 1, undefined, store);
  await policy.initialize(); await policy.authorizeInitialTools([file]);
  assert.equal(policy.begin(request(file)).state, "allowed");
  const plugin: ToolRequest = { ...file, id: "plugin", name: "plugin.export", authorizationIdentity: "extension@1" };
  const pending = policy.begin(request(plugin, "full"));
  assert.equal(pending.state, "pending");
  assert.equal(await policy.resolveRemembered("other-session", "r", "plugin", "allow-always"), false);
  assert.equal(await policy.resolveRemembered("s", "r", "plugin", "allow-always"), true);
  assert.equal((await pending.resolution).reason, "remembered-access");
  const reloaded = new PermissionPolicy("interactive", () => 2, undefined, store);
  await reloaded.initialize();
  await reloaded.authorizeInitialTools([{ ...file, name: "newly-installed" }]);
  assert.equal(reloaded.begin(request(plugin)).state, "allowed");
  assert.equal(reloaded.begin(request({ ...plugin, id: "changed", authorizationIdentity: "extension@2" })).state, "pending");
  assert.equal(reloaded.begin(request({ ...plugin, id: "scope", scope: "external" })).state, "pending");
  assert.equal(reloaded.begin(request({ ...file, id: "new", name: "newly-installed" })).state, "pending");
  assert.equal(reloaded.begin(request(file, "plan")).state, "rejected");
  reloaded.cancelRun("r");
});

test("failed durable grant writes keep the tool pending and do not execute or remember it", async () => {
  let fail = true;
  const policy = new PermissionPolicy("interactive", () => 1, undefined, { load: async () => [], save: async () => { if (fail) throw new Error("disk unavailable"); } });
  await policy.initialize();
  const pending = policy.begin(request(file));
  await assert.rejects(policy.resolveRemembered("s", "r", "write", "allow-always"), /disk unavailable/);
  assert.equal(policy.snapshot().pending.length, 1);
  fail = false;
  assert.equal(await policy.resolveRemembered("s", "r", "write", "allow-always"), true);
  assert.equal((await pending.resolution).allowed, true);
});
