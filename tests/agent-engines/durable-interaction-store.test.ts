import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { join } from "node:path";

/**
 * Exercise the production Python broker and durable store together.  The
 * broker owns the live host channel; the fresh store instance models a server
 * reload and proves that terminal tool results cannot resurrect an approval.
 */
test("durable CLI tool results distinguish business errors from protocol failures across reload", () => {
  const python = process.platform === "win32" ? "py" : "python3";
  const resources = join(process.cwd(), "resources", "viniper-ui");
  const script = String.raw`
import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path

os.environ["VINIPER_UI_DATA_DIR"] = tempfile.mkdtemp(prefix="viniper-durable-ack-")
sys.path.insert(0, r"${resources.replace(/\\/g, "\\\\")}")

from agent_host_bridge import HostInteractionChannel, _record_ack_stage
from agent_run_coordinator import DurableInteractionStore
from server import AgentInteractionBroker

root = Path(tempfile.mkdtemp(prefix="viniper-durable-store-"))
store_path = root / "durable-interactions.json"

def normalized(request_id, bridge_id, run_id):
    return {
        "type": "interaction_request",
        "kind": "permission",
        "request_id": request_id,
        "tool_use_id": request_id,
        "bridge_request_id": bridge_id,
        "run_id": run_id,
        "tool_name": "file.write",
        "allowed_actions": ["deny", "allow_once"],
        "display_payload": {"path": "fixture.md"},
        "_transport": "host_hook",
        "_original_questions": [],
        "_permission_suggestions": [],
        "_tool_input": {"file_path": "fixture.md"},
    }

def ack_channel(channel, bridge_id):
    for stage in ("response_read", "stdout_written_and_flushed", "hook_exit"):
        _record_ack_stage(channel.root, bridge_id, stage, exit_code=0)

def ack_mcp_channel(channel, bridge_id):
    for stage in ("response_read", "mcp_response_written_and_flushed"):
        _record_ack_stage(channel.root, bridge_id, stage, exit_code=0)

def create_case(store, suffix):
    sid, rid, bid, run = (f"s-{suffix}", f"r-{suffix}", f"b-{suffix}", f"run-{suffix}")
    channel = HostInteractionChannel(root / f"channel-{suffix}", session_id=sid, run_id=run)
    broker = AgentInteractionBroker(store_factory=store, managed_channels_only=False)
    pending = broker.create_host_request(
        sid,
        "fixture-process",
        normalized(rid, bid, run),
        channel,
        run={"run_id": run},
    )
    assert pending and pending["interaction_state"] == "pending"
    return broker, channel, sid, rid, bid

store = DurableInteractionStore(store_path)
broker, channel, sid, rid, bid = create_case(store, "allowed-error")
reloaded_pending = DurableInteractionStore(store_path)
assert reloaded_pending.public_for_session(sid)["interaction_state"] == "pending"
asyncio.run(broker.resolve(sid, rid, "permission", "allow_once", process_identity="fixture-process"))
ack_channel(channel, bid)
result = broker.confirm_cli_tool_result(sid, rid, success=False)
assert result and result["accepted"] is True and result["terminal_state"] == "accepted"
record = DurableInteractionStore(store_path).record_for(sid, rid)
assert record["state"] == "accepted"
assert record["cli_tool_result_success"] is False
assert DurableInteractionStore(store_path).public_for_session(sid) is None
assert all(item.get("session_id") != sid for item in DurableInteractionStore(store_path).active())

broker2, channel2, sid2, rid2, bid2 = create_case(store, "deny-conflict")
asyncio.run(broker2.resolve(sid2, rid2, "permission", "deny", process_identity="fixture-process"))
ack_channel(channel2, bid2)
conflict = broker2.confirm_cli_tool_result(sid2, rid2, success=True)
assert conflict and conflict["accepted"] is False and conflict["reason"] == "cli_tool_result_mismatch"
failed = DurableInteractionStore(store_path).record_for(sid2, rid2)
assert failed["state"] == "failed"
assert failed["cli_tool_result_success"] is True
assert DurableInteractionStore(store_path).public_for_session(sid2) is None
assert all(item.get("session_id") != sid2 for item in DurableInteractionStore(store_path).active())

# Native full-access only bypasses permission prompts; AskUserQuestion remains
# an interactive host-owned question and must resume the same run after answer.
sid3, rid3, bid3, run3 = "s-full-question", "r-full-question", "b-full-question", "run-full-question"
channel3 = HostInteractionChannel(root / "channel-full-question", session_id=sid3, run_id=run3)
broker3 = AgentInteractionBroker(store_factory=store, managed_channels_only=False)
question_payload = {
    "type": "interaction_request",
    "kind": "question",
    "request_id": rid3,
    "tool_use_id": rid3,
    "bridge_request_id": bid3,
    "run_id": run3,
    "tool_name": "AskUserQuestion",
    "allowed_actions": ["answer", "skip"],
    "questions": [{"question": "选择方向", "header": "方向", "options": [{"label": "继续"}, {"label": "停止"}]}],
    "display_payload": {},
    "_transport": "permission_prompt_mcp",
    "_original_questions": [{"question": "选择方向", "header": "方向", "options": [{"label": "继续"}, {"label": "停止"}]}],
    "_permission_suggestions": [],
    "_tool_input": {"questions": [{"question": "选择方向"}]},
}
question = broker3.create_host_request(
    sid3,
    "fixture-process",
    question_payload,
    channel3,
    run={"run_id": run3, "permission_mode": "bypassPermissions"},
)
assert question and question["kind"] == "question" and question["interaction_state"] == "pending"
assert DurableInteractionStore(store_path).public_for_session(sid3)["kind"] == "question"
asyncio.run(broker3.resolve(
    sid3,
    rid3,
    "question",
    "answer",
    process_identity="fixture-process",
    answers={"选择方向": "继续"},
))
ack_mcp_channel(channel3, bid3)
question_result = broker3.confirm_cli_tool_result(sid3, rid3, success=True)
assert question_result and question_result["accepted"] is True
question_record = DurableInteractionStore(store_path).record_for(sid3, rid3)
assert question_record["state"] == "accepted"
assert DurableInteractionStore(store_path).public_for_session(sid3) is None
assert all(item.get("session_id") != sid3 for item in DurableInteractionStore(store_path).active())

print(json.dumps({
    "allowedBusinessError": {"accepted": True, "state": record["state"], "success": record["cli_tool_result_success"]},
    "deniedSuccessConflict": {"accepted": False, "state": failed["state"], "activeAfterReload": False},
    "pendingVisibleAfterReload": True,
    "fullAccessAskQuestionResumed": True,
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
  assert.match(result.stdout, /"allowedBusinessError"/u);
  assert.match(result.stdout, /"pendingVisibleAfterReload": true/u);
  assert.match(result.stdout, /"fullAccessAskQuestionResumed": true/u);
});

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
  const result = spawnSync(python, ["-3", "-E", "-c", script], {
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
  const result = spawnSync(python, ["-3", "-E", "-c", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, PYTHONPATH: resources },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /"legacyTerminalHidden"\s*:\s*true/u);
  assert.match(result.stdout, /"recordPreserved"\s*:\s*true/u);
});
