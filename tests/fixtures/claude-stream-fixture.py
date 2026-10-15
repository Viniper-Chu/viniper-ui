"""Offline Claude stream-json fixture; also usable by an isolated UI preview.

Only files under the explicitly isolated workdir are written. There is no
provider implementation. The real application MCP bridge remains the sole
permission/question owner and must acknowledge both decisions before progress.
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time


def no_network(*_args, **_kwargs):
    raise AssertionError("Offline Claude fixture cannot use the network")


socket.socket.connect = no_network
args = sys.argv[1:]
required_flags = """-p --input-format --output-format --include-partial-messages
--include-hook-events --model --session-id --resume --permission-mode
--allow-dangerously-skip-permissions --name --append-system-prompt
--append-system-prompt-file --add-dir --settings --mcp-config
--permission-prompt-tool --verbose --agents --autocompact"""
if "--version" in args:
    print("2.1.274 (offline integration fixture)")
    raise SystemExit(0)
if "--help" in args:
    print(required_flags.replace('--permission-mode', '') + "\n--permission-mode <mode> choices: default, acceptEdits, plan, bypassPermissions\n  agents [options] Show native agents\n")
    raise SystemExit(0)
if args[:2] == ["auth", "status"]:
    print(json.dumps({"loggedIn": True, "authMethod": "oauth"}))
    raise SystemExit(0)
if args[:2] == ["plugin", "list"]:
    print("[]")
    raise SystemExit(0)
if args[:1] == ["agents"]:
    print("[]")
    raise SystemExit(0)
if "-p" not in args:
    raise SystemExit("This fixture implements stream-json only; use the PTY fixture for TUI tests.")

root = Path(os.environ.get("VINIPER_WORKDIR") or Path.home()).resolve()
assert root.is_relative_to(Path(__file__).resolve().parents[2] / "codex"), "Fixture writes must stay in the repository maintenance area"
assert Path.cwd().resolve() == root, "Set the session workdir to the isolated fixture directory"
events_file = root / "data" / "fixture-stream-events.jsonl"
events_file.parent.mkdir(exist_ok=True)


def record(stage, **details):
    with events_file.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps({"stage": stage, "pid": os.getpid(), **details}) + "\n")


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def read():
    line = sys.stdin.readline()
    assert line, "Application closed the protocol stream unexpectedly"
    return json.loads(line)


record("started")
initialize = read()
assert initialize["type"] == "control_request" and initialize["request"]["subtype"] == "initialize"
assert initialize["request"]["forwardSubagentText"] is True
emit({"type": "control_response", "response": {"subtype": "success", "request_id": initialize["request_id"],
      "response": {"commands": [{"name": "fixture:review", "description": "Offline fixture command"}],
                   "models": [{"value": "sonnet", "displayName": "Fixture Sonnet"}], "agents": []}}})
user = read()
assert user["type"] == "user" and user["message"]["role"] == "user"
record("user_received")
emit({"type": "system", "subtype": "init", "session_id": user["session_id"], "model": "sonnet",
      "permissionMode": "default", "tools": ["Write", "AskUserQuestion", "Agent"],
      "mcp_servers": [{"name": "viniper_interaction", "status": "connected"}]})
# Exercise unsupported requests separately from the happy UI acceptance path.
if "fixture:unsupported" in str(user["message"]["content"]):
    emit({"type": "control_request", "request_id": "fixture-unsupported", "request": {"subtype": "fixture_unknown"}})
    response = read()
    assert response["response"]["request_id"] == "fixture-unsupported" and response["response"]["subtype"] == "error"
    record("unsupported_control_rejected")

config = json.loads(Path(args[args.index("--mcp-config") + 1]).read_text())
bridge = config["mcpServers"]["viniper_interaction"]
mcp = subprocess.Popen([bridge["command"], *bridge["args"]], stdin=subprocess.PIPE,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8")
record("mcp_started", child_pid=mcp.pid)


def rpc(identity, method, params):
    mcp.stdin.write(json.dumps({"jsonrpc": "2.0", "id": identity, "method": method, "params": params}) + "\n")
    mcp.stdin.flush()
    line = mcp.stdout.readline()
    assert line, "MCP helper stopped without a response"
    result = json.loads(line)
    assert result["id"] == identity and "error" not in result, result
    return result["result"]


def interaction(identity, tool, tool_input):
    emit({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": identity, "name": tool, "input": tool_input}]}})
    result = rpc(identity, "tools/call", {"name": "permission_prompt", "arguments": {
        "tool_name": tool, "tool_use_id": identity, "input": tool_input}})
    decision = json.loads(result["content"][0]["text"])
    assert decision["behavior"] == "allow", decision
    record(identity + "_allowed", decision=decision)
    # Give the host a chance to observe the real flushed MCP ACK before the
    # native tool result arrives. Neither an HTTP 200 nor a saved answer alone
    # is treated as completion by the fixture.
    time.sleep(.25)
    emit({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": identity, "content": "fixture completed"}]}})
    return decision


try:
    assert rpc(1, "initialize", {"protocolVersion": "2025-06-18"})["serverInfo"]["name"] == "viniper-interaction"
    assert rpc(2, "tools/list", {})["tools"][0]["name"] == "permission_prompt"
    prompt = str(user["message"]["content"])
    scenario = "failed" if "fixture:fail-after-write" in prompt else ("cancelled" if "fixture:cancel-after-write" in prompt else "output")
    target = root / ("owned-fixture-" + scenario + ".txt")
    interaction("fixture-write", "Write", {"file_path": str(target), "content": "permission acknowledged"})
    target.write_text("permission acknowledged", encoding="utf-8")
    if scenario == "failed":
        emit({"type": "result", "subtype": "error_during_execution", "is_error": True,
              "result": "fixture failed after writing the approved file", "session_id": user["session_id"]})
        record("failed_after_write")
        raise SystemExit(1)
    if scenario == "cancelled":
        emit({"type": "assistant", "message": {"content": [{"type": "text", "text": "fixture waiting for cancellation"}]}})
        record("waiting_for_cancel")
        time.sleep(90)
        raise AssertionError("Fixture should have been cancelled")
    question = "Continue the offline acceptance test?"
    answer = interaction("fixture-question", "AskUserQuestion", {"questions": [{"question": question,
        "header": "Fixture", "multiSelect": False,
        "options": [{"label": "Continue", "description": "Finish the local fixture"},
                    {"label": "Stop", "description": "Do not continue"}]}]})
    assert answer["updatedInput"]["answers"][question] == "Continue", answer
    emit({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "task-create", "name": "TaskCreate", "input": {"subject": "验证本机交互", "activeForm": "验证中"}}]}})
    emit({"type": "user", "tool_use_result": {"task": {"id": "1", "subject": "验证本机交互", "status": "pending"}}, "message": {"content": [{"type": "tool_result", "tool_use_id": "task-create", "content": "Task #1 created"}]}})
    emit({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "task-update", "name": "TaskUpdate", "input": {"taskId": "1", "status": "completed"}}]}})
    emit({"type": "user", "tool_use_result": {"success": True}, "message": {"content": [{"type": "tool_result", "tool_use_id": "task-update", "content": "Task #1 completed"}]}})
    emit({"type": "system", "subtype": "task_started", "task_id": "review", "tool_use_id": "agent1", "description": "检查项目"})
    emit({"type": "assistant", "parent_tool_use_id": "agent1", "message": {"content": [{"type": "text", "text": "子Agent独立回答"}]}})
    emit({"type": "tool_progress", "tool_use_id": "read1", "tool_name": "Read", "elapsed_time_seconds": 2, "parent_tool_use_id": "agent1"})
    emit({"type": "system", "subtype": "hook_started", "hook_id": "h1", "hook_name": "检查", "hook_event": "PreToolUse"})
    emit({"type": "system", "subtype": "hook_response", "hook_id": "h1", "outcome": "success", "stdout": "完成", "exit_code": 0})
    emit({"type": "rate_limit_event", "rate_limit_info": {"status": "allowed_warning", "utilization": .8, "rateLimitType": "five_hour"}})
    emit({"type": "system", "subtype": "task_notification", "task_id": "review", "status": "completed", "summary": "已完成"})
    emit({"type": "assistant", "message": {"model": "sonnet", "content": [{"type": "text", "text": "主Agent验收完成"}],
          "usage": {"input_tokens": 40, "output_tokens": 12}}})
    emit({"type": "result", "subtype": "success", "is_error": False, "result": "主Agent验收完成", "session_id": user["session_id"],
          "usage": {"input_tokens": 40, "output_tokens": 12}, "duration_ms": 500, "num_turns": 1})
    record("completed")
finally:
    mcp.stdin.close()
    try:
        mcp.wait(timeout=3)
    except subprocess.TimeoutExpired:
        mcp.kill()
        mcp.wait()
