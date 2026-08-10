#!/usr/bin/python3
"""No-provider Claude CLI fixture for the official stdio permission callback."""

import json
import sys
import time


def argument(name: str) -> str:
    try:
        return sys.argv[sys.argv.index(name) + 1]
    except (ValueError, IndexError):
        return ""


settings_path = argument("--settings")
session_id = argument("--session-id") or argument("--resume")
initial = json.loads(sys.stdin.readline())
prompt = json.dumps(initial, ensure_ascii=False)
json.load(open(settings_path, encoding="utf-8"))
if argument("--permission-prompt-tool") != "stdio":
    raise SystemExit("missing official stdio permission callback")

if "B权限" in prompt:
    request_id = "stdio-v16-runtime-permission"
    control_request = {
        "type": "control_request",
        "request_id": request_id,
        "request": {
            "subtype": "can_use_tool",
            "tool_name": "Bash",
            "input": {"command": "printf fixture-ok", "description": "无害权限夹具"},
            "permission_suggestions": [],
        },
    }
    question_input = None
else:
    request_id = "toolu-v16-runtime-ask"
    question_input = {
        "questions": [{
            "question": "继续执行？",
            "header": "确认",
            "options": [{"label": "继续", "description": "继续同一运行"}],
            "multiSelect": False,
        }],
    }
    control_request = {
        "type": "control_request",
        "request_id": request_id,
        "request": {
            "subtype": "can_use_tool",
            "tool_name": "AskUserQuestion",
            "input": question_input,
        },
    }

print(json.dumps(control_request, ensure_ascii=False), flush=True)
control_response = json.loads(sys.stdin.readline())
response = control_response.get("response", {})
if control_response.get("request_id") != request_id:
    raise SystemExit("stale control response")

if question_input is None:
    continued = (
        response.get("behavior") == "allow"
        and response.get("updatedInput", {}).get("command") == "printf fixture-ok"
    )
    text = "B权限后继续" if continued else "B权限被拒绝"
else:
    updated = response.get("updatedInput", {})
    continued = (
        response.get("behavior") == "allow"
        and updated.get("questions") == question_input["questions"]
        and updated.get("answers", {}).get("继续执行？") == "继续"
    )
    text = "A问答后继续" if continued else "A问答未完成"
    print(json.dumps({
        "type": "assistant",
        "message": {"content": [{
            "type": "tool_use",
            "id": request_id,
            "name": "AskUserQuestion",
            "input": question_input,
        }]},
    }, ensure_ascii=False), flush=True)
    print(json.dumps({
        "type": "user",
        "message": {"content": [{
            "type": "tool_result",
            "tool_use_id": request_id,
            "content": "用户已回答",
        }]},
    }, ensure_ascii=False), flush=True)
    time.sleep(0.5)

print(json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}}, ensure_ascii=False), flush=True)
print(json.dumps({"type": "result", "result": text}, ensure_ascii=False), flush=True)
