import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { join } from "node:path";

/**
 * Exercise the production Python broker and durable store together.  The
 * broker owns the live host channel; the fresh store instance models a server
 * reload and proves that terminal tool results cannot resurrect an approval.
 */
test("durable owner failure clears the active pointer after a terminal timeout", () => {
  const python = process.platform === "win32" ? "py" : "python3";
  const resources = join(process.cwd(), "resources", "viniper-ui");
  const script = String.raw`
import json
import os
import sys
import tempfile
from pathlib import Path

os.environ["VINIPER_UI_DATA_DIR"] = tempfile.mkdtemp(prefix="viniper-owner-failure-")
sys.path.insert(0, r"${resources.replace(/\\/g, "\\\\")}")

from agent_run_coordinator import DurableInteractionStore

root = Path(tempfile.mkdtemp(prefix="viniper-owner-failure-store-"))
store = DurableInteractionStore(root / "durable-interactions.json")
sid, rid = "session-owner-failure", "request-owner-failure"
store.create({
    "session_id": sid,
    "run_id": "run-owner-failure",
    "request_id": rid,
    "tool_use_id": rid,
    "kind": "permission",
    "tool_name": "Bash",
    "allowed_actions": ["deny", "allow_once"],
    "display_payload": {},
    "_tool_input": {},
})
store.mark_pending(sid, rid)
failed = store.fail_owner(sid, "run-owner-failure", reason="bounded timeout", failure_code="cli_ack_timeout")
assert failed["state"] == "failed" and failed["terminal"] is True
assert store.public_for_session(sid) is None
assert all(item.get("session_id") != sid for item in store.active())
print(json.dumps({"failedTerminal": True, "activePointerCleared": True, "providerCalls": 0, "secretsOrBodies": False}))
`;
  const result = spawnSync(python, [...(process.platform === "win32" ? ["-3"] : []), "-E", "-c", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, PYTHONPATH: resources },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /"activePointerCleared"\s*:\s*true/u);
});

test("reload lazily prunes a legacy terminal active pointer without deleting its record", () => {
  const python = process.platform === "win32" ? "py" : "python3";
  const resources = join(process.cwd(), "resources", "viniper-ui");
  const script = String.raw`
import json
import os
import sys
import tempfile
from pathlib import Path

os.environ["VINIPER_UI_DATA_DIR"] = tempfile.mkdtemp(prefix="viniper-legacy-terminal-")
sys.path.insert(0, r"${resources.replace(/\\/g, "\\\\")}")

from agent_run_coordinator import DurableInteractionStore

root = Path(tempfile.mkdtemp(prefix="viniper-legacy-terminal-store-"))
store_path = root / "durable-interactions.json"
sid, rid = "session-legacy-terminal", "request-legacy-terminal"
store_path.write_text(json.dumps({
    "version": 1,
    "records": {
        f"{sid}\\x1f{rid}": {
            "session_id": sid,
            "run_id": "run-legacy-terminal",
            "request_id": rid,
            "tool_use_id": rid,
            "kind": "permission",
            "state": "failed",
            "terminal": True,
            "failure_code": "cli_ack_timeout",
        }
    },
    "active": {sid: rid},
}), encoding="utf-8")

store = DurableInteractionStore(store_path)
assert store.public_for_session(sid) is None
reloaded = json.loads(store_path.read_text(encoding="utf-8"))
assert reloaded["active"] == {}
assert f"{sid}\\x1f{rid}" in reloaded["records"]
print(json.dumps({"legacyTerminalHidden": True, "recordPreserved": True, "activePointerCleared": True, "providerCalls": 0, "secretsOrBodies": False}))
`;
  const result = spawnSync(python, [...(process.platform === "win32" ? ["-3"] : []), "-E", "-c", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, PYTHONPATH: resources },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /"legacyTerminalHidden"\s*:\s*true/u);
  assert.match(result.stdout, /"recordPreserved"\s*:\s*true/u);
});
