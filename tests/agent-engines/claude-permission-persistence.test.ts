import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

test("Claude full access is selectable and persisted without sharing Viniper mode", () => {
  const python = process.platform === "win32" ? "py" : "python3";
  const resources = join(process.cwd(), "resources", "viniper-ui");
  const script = String.raw`
import json
import os
import tempfile
from types import SimpleNamespace
import sys

os.environ["VINIPER_UI_DATA_DIR"] = tempfile.mkdtemp(prefix="viniper-permission-persistence-")
sys.path.insert(0, r"${resources.replace(/\\/g, "\\\\")}")
import server

class FakeRuntime:
    def cached_probe(self):
        return SimpleNamespace(capabilities=SimpleNamespace(
            permission_modes=("default", "acceptEdits", "bypassPermissions", "plan"),
        ))

server.agent_runtime = lambda: FakeRuntime()
claude_modes = server.permission_mode_descriptors("claude")
assert next(item for item in claude_modes if item["id"] == "fullAccess")["enabled"] is True
assert server.migrate_permission_mode("fullAccess", "claude") == "fullAccess"
assert server.migrate_permission_mode("review", "viniper") == "review"

claude_session = {"mode": "claude", "permission_mode": "fullAccess"}
viniper_session = {"mode": "viniper", "permission_mode": "review"}
assert server.session_permission_mode(claude_session) == "fullAccess"
assert server.session_permission_mode(viniper_session) == "review"
assert claude_session["permission_mode"] == "fullAccess"
assert viniper_session["permission_mode"] == "review"
assert server.claude_permission_mode(claude_session["permission_mode"]) == "bypassPermissions"
assert server.harness_permission_mode(viniper_session["permission_mode"]) == "review"

print(json.dumps({
    "claudeFullAccessEnabled": True,
    "claudePersisted": claude_session["permission_mode"] == "fullAccess",
    "claudeNativeMode": "bypassPermissions",
    "viniperPersisted": viniper_session["permission_mode"] == "review",
    "enginesIndependent": claude_session["permission_mode"] != viniper_session["permission_mode"],
    "providerCalls": 0,
    "secretsOrBodies": False,
}))
`;
  const result = spawnSync(python, ["-3", "-E", "-c", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, PYTHONPATH: resources },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /"claudeFullAccessEnabled": true/u);
  assert.match(result.stdout, /"enginesIndependent": true/u);
});
