#!/usr/bin/env python3
"""Offline Claude CLI emulator that executes Viniper's real MCP prompt owner.

This remains a downstream regression fixture.  v16.3's actual managed CLI plus
localhost provider capture separately proves the upstream tool-exposure gate.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path


def argument(name: str) -> str:
    try:
        return sys.argv[sys.argv.index(name) + 1]
    except (ValueError, IndexError):
        return ""


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def start_prompt_server(config_path: str) -> tuple[subprocess.Popen[str], Path]:
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    entry = config["mcpServers"]["viniper_interaction"]
    command = [str(entry["command"]), *(str(item) for item in entry.get("args", []))]
    process = subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )
    assert process.stdin is not None and process.stdout is not None

    def rpc(payload: dict) -> dict:
        process.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
        process.stdin.flush()
        line = process.stdout.readline()
        if not line:
            stderr = process.stderr.read() if process.stderr else ""
            raise RuntimeError(f"MCP prompt server closed: {stderr}")
        return json.loads(line)

    init = rpc({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {}},
    })
    if init.get("result", {}).get("serverInfo", {}).get("name") != "viniper-interaction":
        raise RuntimeError("unexpected MCP prompt server")
    process.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}}) + "\n")
    process.stdin.flush()
    listed = rpc({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
    if listed.get("result", {}).get("tools", [{}])[0].get("name") != "permission_prompt":
        raise RuntimeError("missing permission prompt MCP tool")
    args = [str(item) for item in entry.get("args", [])]
    channel = Path(args[args.index("--channel") + 1])
    return process, channel


def call_prompt(process: subprocess.Popen[str], request_id: int, tool_name: str, tool_use_id: str, tool_input: dict) -> dict:
    assert process.stdin is not None and process.stdout is not None
    process.stdin.write(json.dumps({
        "jsonrpc": "2.0",
        "id": request_id,
        "method": "tools/call",
        "params": {
            "name": "permission_prompt",
            "arguments": {"tool_name": tool_name, "tool_use_id": tool_use_id, "input": tool_input},
        },
    }, ensure_ascii=False) + "\n")
    process.stdin.flush()
    response = json.loads(process.stdout.readline())
    content = response.get("result", {}).get("content", [])
    if response.get("result", {}).get("isError") or not content:
        raise RuntimeError(f"MCP prompt failed: {response}")
    return json.loads(content[0]["text"])


mcp_config_path = argument("--mcp-config")
permission_prompt_tool = argument("--permission-prompt-tool")
if not mcp_config_path or permission_prompt_tool != "mcp__viniper_interaction__permission_prompt":
    raise SystemExit("missing real MCP permission prompt owner")

session_id = argument("--session-id") or argument("--resume")
initial = json.loads(sys.stdin.readline())
prompt = json.dumps(initial, ensure_ascii=False)
prompt_process, channel = start_prompt_server(mcp_config_path)
try:
    emit({
        "type": "system",
        "subtype": "init",
        "session_id": session_id,
        "claude_code_version": "2.1.226",
    })

    if "DIRECT_STDOUT_ONLY" in prompt:
        emit({
            "type": "control_request",
            "request_id": "toolu_v162_stdout_only",
            "request": {
                "subtype": "can_use_tool",
                "tool_name": "AskUserQuestion",
                "input": {"questions": [{
                    "question": "这个旧 stdout 请求不应成为交互 owner",
                    "header": "兼容通道",
                    "options": [{"label": "继续"}, {"label": "停止"}],
                    "multiSelect": False,
                }]},
            },
        })
        time.sleep(5)
        raise SystemExit("fixture intentionally skipped the configured MCP owner")

    if "B权限" not in prompt:
        question_id = "toolu_v162_ask"
        questions = [{
            "question": "继续离线验证？",
            "header": "验证",
            "options": [{"label": "继续"}, {"label": "停止"}],
            "multiSelect": False,
        }]
        question_input = {"questions": questions}
        if "DIRECT_THEN_HOOK" in prompt:
            emit({
                "type": "control_request",
                "request_id": question_id,
                "request": {
                    "subtype": "can_use_tool", "tool_name": "AskUserQuestion", "input": question_input,
                },
            })
            time.sleep(0.03)
        emit({
            "type": "assistant",
            "message": {"content": [{
                "type": "tool_use", "id": question_id, "name": "AskUserQuestion", "input": question_input,
            }]},
        })
        question_response = call_prompt(prompt_process, 3, "AskUserQuestion", question_id, question_input)
        updated_input = question_response.get("updatedInput", {})
        if updated_input.get("questions") != questions or updated_input.get("answers", {}).get("继续离线验证？") != "继续":
            raise SystemExit("MCP question answer was not accepted by emulator")
        if "NO_TOOL_RESULT" in prompt:
            time.sleep(5)
            raise SystemExit("fixture intentionally withheld cli tool_result")
        if "ACK_DELAY" in prompt:
            time.sleep(2.5)
        emit({
            "type": "user",
            "message": {"content": [{"type": "tool_result", "tool_use_id": question_id, "content": "继续"}]},
        })

    if "B权限" in prompt or "ASK_THEN_PERMISSION" in prompt:
        permission_id = "toolu_v162_write"
        output_path = channel / "emulator-output.txt"
        write_input = {"file_path": str(output_path), "content": "v16.3 offline MCP accepted\n"}
        emit({
            "type": "assistant",
            "message": {"content": [{
                "type": "tool_use", "id": permission_id, "name": "Write", "input": write_input,
            }]},
        })
        permission_response = call_prompt(prompt_process, 4, "Write", permission_id, write_input)
        if permission_response.get("behavior") != "allow" or permission_response.get("updatedInput") != write_input:
            raise SystemExit("MCP permission answer was not accepted by emulator")
        if "ACK_DELAY" in prompt:
            time.sleep(2.5)
        output_path.write_text(write_input["content"], encoding="utf-8")
        emit({
            "type": "user",
            "message": {"content": [{"type": "tool_result", "tool_use_id": permission_id, "content": str(output_path)}]},
        })

    final_text = "B权限后继续" if "B权限" in prompt else ("A问答后继续" if "A问答" in prompt else "真实 MCP prompt 已确认")
    emit({"type": "assistant", "message": {"content": [{"type": "text", "text": final_text}]}})
    emit({"type": "result", "subtype": "success", "is_error": False, "result": final_text})
finally:
    if prompt_process.stdin is not None:
        prompt_process.stdin.close()
    try:
        prompt_process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        prompt_process.kill()
        prompt_process.wait(timeout=5)
