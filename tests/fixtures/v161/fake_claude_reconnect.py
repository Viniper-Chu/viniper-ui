#!/usr/bin/python3
"""No-provider bidirectional Claude CLI fixture for v16.1 lifecycle gates."""

import json
import os
import sys
import time
from pathlib import Path


def argument(name: str) -> str:
    try:
        return sys.argv[sys.argv.index(name) + 1]
    except (ValueError, IndexError):
        return ""


def emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def read_input() -> dict:
    line = sys.stdin.readline()
    if not line:
        raise SystemExit("stdin closed")
    return json.loads(line)


def text_from(envelope: dict) -> str:
    content = envelope.get("message", {}).get("content", [])
    return "\n".join(str(item.get("text") or "") for item in content if isinstance(item, dict))


def ask_question(request_id: str) -> str:
    question_input = {
        "questions": [{
            "question": "v16.1 离线恢复验证继续吗？",
            "header": "运行恢复",
            "options": [
                {"label": "继续", "description": "继续同一假 CLI 运行"},
                {"label": "停止", "description": "拒绝继续"},
            ],
            "multiSelect": False,
        }],
    }
    emit({
        "type": "control_request",
        "request_id": request_id,
        "request": {
            "subtype": "can_use_tool",
            "tool_name": "AskUserQuestion",
            "input": question_input,
        },
    })
    response = read_input()
    if response.get("request_id") != request_id:
        raise SystemExit("stale question response")
    updated = response.get("response", {}).get("updatedInput", {})
    if updated.get("questions") != question_input["questions"]:
        raise SystemExit("question input was not preserved")
    answer = str(updated.get("answers", {}).get(question_input["questions"][0]["question"]) or "")
    if not answer:
        raise SystemExit("question answer missing")
    emit({
        "type": "assistant",
        "message": {"content": [{
            "type": "tool_use",
            "id": request_id,
            "name": "AskUserQuestion",
            "input": question_input,
        }]},
    })
    emit({
        "type": "user",
        "message": {"content": [{
            "type": "tool_result",
            "tool_use_id": request_id,
            "content": f"用户回答：{answer}",
        }]},
    })
    return answer


def request_write(request_id: str, destination: Path) -> bool:
    tool_input = {
        "file_path": str(destination),
        "content": "VINIPER_V161_FAKE_PRODUCTION_CHAIN_PASS",
    }
    emit({
        "type": "control_request",
        "request_id": request_id,
        "request": {
            "subtype": "can_use_tool",
            "tool_name": "Write",
            "input": tool_input,
            "permission_suggestions": [],
        },
    })
    response = read_input()
    if response.get("request_id") != request_id:
        raise SystemExit("stale permission response")
    allowed = response.get("response", {}).get("behavior") == "allow"
    emit({
        "type": "assistant",
        "message": {"content": [{
            "type": "tool_use",
            "id": request_id,
            "name": "Write",
            "input": tool_input,
        }]},
    })
    if allowed:
        destination.write_text(tool_input["content"], encoding="utf-8")
    emit({
        "type": "user",
        "message": {"content": [{
            "type": "tool_result",
            "tool_use_id": request_id,
            "content": "文件已写入" if allowed else "用户拒绝写入",
            "is_error": not allowed,
        }]},
    })
    return allowed


settings_path = argument("--settings")
if argument("--permission-prompt-tool") != "stdio":
    raise SystemExit("missing official stdio callback")
if settings_path:
    json.load(open(settings_path, encoding="utf-8"))

initial = read_input()
prompt = text_from(initial)
workspace = Path.cwd()
log_path = workspace / "v161-fake-run-log.jsonl"
with log_path.open("a", encoding="utf-8") as handle:
    handle.write(json.dumps({"pid": os.getpid(), "prompt": prompt}, ensure_ascii=False) + "\n")

if "V161_INTEGRATED" in prompt:
    answer = ask_question("v161-question-request")
    allowed = request_write("v161-write-request", workspace / "v161-fake-output.txt")
    final = f"离线整合完成：{answer}；写入{'成功' if allowed else '被拒绝'}"
elif "V161_WAIT_QUESTION" in prompt:
    answer = ask_question("v161-stop-question")
    final = f"不应在停止后继续：{answer}"
elif "V161_LONG" in prompt:
    guidance = text_from(read_input())
    final = f"同一运行收到引导：{guidance}"
elif "V161_QUEUE" in prompt:
    final = "队列下一轮完成"
elif "V161_ERROR" in prompt:
    emit({"type": "result", "is_error": True, "result": "v16.1 fixture error"})
    raise SystemExit(2)
else:
    final = "离线假 CLI 完成"

time.sleep(0.15)
emit({"type": "assistant", "message": {"content": [{"type": "text", "text": final}]}})
emit({"type": "result", "result": final})
