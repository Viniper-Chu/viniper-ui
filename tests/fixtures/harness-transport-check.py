"""Exercise the actual desktop Harness projection with isolated local tool effects."""
import asyncio
import json
import os
from pathlib import Path
import socket
import sys

root = Path(sys.argv[1]).resolve()
assert root.is_relative_to(Path.cwd() / "codex" / "运行残留")
for name in list(os.environ):
    if name.startswith(("VINIPER_", "ANTHROPIC_", "OPENAI_", "CLAUDE_")):
        os.environ.pop(name, None)
os.environ.update({"VINIPER_UI_DATA_DIR": str(root / "data"),
                   "VINIPER_UI_DEFAULT_WORKSPACE_ROOT": str(root),
                   "CLAUDE_CONFIG_DIR": str(root / "claude")})
def no_network(*_args, **_kwargs):
    raise AssertionError("This projection regression must never use a network")
socket.socket.connect = no_network
sys.path.insert(0, str(Path.cwd() / "resources" / "viniper-ui"))
import server

usage = server.provider_usage_snapshot({'source':'provider', 'usage':{
    'input_tokens':200, 'output_tokens':20, 'cache_read_input_tokens':800,
    'cache_creation_input_tokens':0}})
assert usage['cache_hit_ratio'] == .8 and usage['total_tokens'] == 1020
from harness_application_port import _runtime_event_to_provider_event
presentation = {"kind":"terminal-run","executionId":"fixture-output","exitCode":0,"purpose":"test",
                "stdout":{"preview":"2 tests passed","totalBytes":14,"truncated":False}}
projected = _runtime_event_to_provider_event({"type":"tool.completed","payload":{"toolName":"terminal.run",
    "activityId":"terminal-1","result":"命令完成","presentation":presentation}})
assert projected["presentation"] == presentation
assert server.project_tool_result_stream_event(projected)["presentation"] == presentation


class LocalEffectsPort:
    def __init__(self, ending):
        self.ending = ending
        self.calls = []
        self.closed = False

    async def stream(self, **kwargs):
        try:
            async for event in self.events(**kwargs):
                yield event
        finally:
            if self.ending in {"failed", "cancelled"}:
                await asyncio.sleep(.01)
                (Path(kwargs["workdir"]) / "result.txt").write_text("after\ncleanup\n")
            self.closed = True

    async def events(self, **kwargs):
        self.calls.append(kwargs)
        sid = kwargs["session_id"]
        def envelope(event):
            return {"type": "provider.event", "event": event}
        yield envelope({"type": "tool_start", "tool_name": "project.write", "call_id": "write-local",
                        "input": {"path": "result.txt", "content": "after"}})
        persisted = json.loads(server.SESSIONS_FILE.read_text())
        assert "write-local" in json.dumps(persisted), "The visible tool start must already be durable"
        (Path(kwargs["workdir"]) / "result.txt").write_text("after\n")
        yield envelope({"type": "tool_result", "tool_name": "project.write", "call_id": "write-local",
                        "status": "success", "content": "File updated"})
        persisted = json.loads(server.SESSIONS_FILE.read_text())
        assert "File updated" in json.dumps(persisted), "Completed work survives a later transport failure"
        yield envelope({"type": "plan", "run_id": sid + "-run", "steps": [
            {"step": "Write the local file", "status": "in_progress"}], "explanation": "Local fixture plan"})
        yield envelope({"type": "text", "content": "Already completed a local write."})
        if self.ending == "completed":
            yield envelope({"type": "runtime_warning", "content": "自动记忆保存失败：fixture storage unavailable"})
        if self.ending in {"failed", "cancelled"}:
            yield envelope({"type": "tool_start", "tool_name": "terminal.run", "call_id": "unfinished-local",
                            "status": "waiting", "input": {"command": "fixture only"}})
        if self.ending == "failed":
            yield envelope({"type": "runtime_error", "content": "fixture provider failure"})
        elif self.ending == "cancelled":
            yield envelope({"type": "runtime_cancelled"})

async def main():
    for ending in ("completed", "failed", "cancelled"):
        workdir = root / ending
        workdir.mkdir()
        (workdir / "result.txt").write_text("before\n")
        sid = "harness-" + ending
        server.sessions[sid] = {"id": sid, "mode": "viniper", "workdir": str(workdir),
                                "messages": [], "permission_mode": "default"}
        server.provider_config = lambda *_args: {"api_key": "dummy-fixture-value", "model": "fixture-model",
                                                 "provider": "fixture", "base_url": "http://fixture.invalid"}
        port = LocalEffectsPort(ending)
        transport = server.HarnessRuntimeTransport(port)
        events = []
        try:
            async for event in transport.stream(sid, "Use only the local fixture"):
                events.append(event)
        except asyncio.CancelledError:
            assert ending == "cancelled"
        session = server.safe_session(sid)
        assert session["last_run_status"] == ending
        messages = session["messages"]
        assert [item["role"] for item in messages] == ["user", "assistant"]
        message = messages[-1]
        assert not message.get("pending")
        artifacts = [item for item in message["segments"] if item["type"] == "artifact"]
        assert len(artifacts) == 1
        change = artifacts[0]["file_change"]
        assert change["operation"] == "modified" and change["available"]
        assert "-before" in change["diff"] and "+after" in change["diff"]
        assert port.closed, "Owned event stream cleanup must finish before the desktop finalizes"
        expected = "after\ncleanup\n" if ending in {"failed", "cancelled"} else "after\n"
        assert (workdir / "result.txt").read_text() == expected
        if ending in {"failed", "cancelled"}:
            assert "+cleanup" in change["diff"], "The final diff must include writes committed during owned cleanup"
        assert artifacts[0]["name"] == "result.txt"
        if ending == "failed":
            assert "fixture provider failure" in message["content"]
            assert any(item["type"] == "error" for item in events)
        elif ending == "cancelled":
            assert message["cancelled"] and "本轮已停止" in message["content"]
        else:
            assert message["content"].startswith("Already completed a local write.")
            assert "提示：自动记忆保存失败" in message["content"] and not message.get("error")
        if ending in {"failed", "cancelled"}:
            unfinished = [item for item in message["segments"] if item.get("call_id") == "unfinished-local"]
            assert len(unfinished) == 1 and unfinished[0]["type"] == "tool_start" and unfinished[0]["status"] == ending
            assert next(item for item in message["segments"] if item.get("call_id") == "write-local")["status"] == "running"
        # A fresh disk read independently verifies the final projection.
        restored = json.loads(server.SESSIONS_FILE.read_text())
        assert "result.txt" in json.dumps(restored)
        assert port.calls[0]["provider_id"] == "fixture"

    class SteeringPort:
        async def control(self, _operation, **payload):
            return {"receipt": {"id": payload["message"], "kind": "steer", "status": "queued", "payload": payload["message"]}}

        async def stream(self, **kwargs):
            def envelope(event):
                return {"type": "provider.event", "event": event}
            yield envelope({"type": "text", "content": "原回答，保留在引导之前。"})
            for text in ["改为简短回答", "保留关键结论"]:
                class Request:
                    async def json(self): return {"message": text}
                result = await server.guide_active_agent(kwargs["session_id"], Request())
                assert not any(m.get("content") == text for m in server.sessions[kwargs["session_id"]]["messages"]), "HTTP must not race ahead of the ordered event stream"
                yield envelope({"type": "steering", "receipt": result["receipt"]})
            for index, text in enumerate(["改为简短回答", "保留关键结论"]):
                yield envelope({"type": "steering", "start_new_message": index == 0,
                                "receipt": {"id": text, "kind": "steer", "status": "delivered", "payload": text}})
            yield envelope({"type": "text", "content": "新回答，只保留结论。"})

    steering_workdir = root / "steering"
    steering_workdir.mkdir()
    server.sessions["steering"] = {"id": "steering", "mode": "viniper", "workdir": str(steering_workdir), "messages": []}
    steering_port = SteeringPort()
    transport = server.HarnessRuntimeTransport(steering_port)
    previous_transport, previous_coordinator = server.VINIPER_TRANSPORT, server.agent_run_coordinator
    server.VINIPER_TRANSPORT = transport
    server.agent_run_coordinator = lambda: type("Active", (), {"has_active": lambda self, sid: True})()
    try:
        events = [event async for event in transport.stream("steering", "原始请求")]
        messages = server.sessions["steering"]["messages"]
        assert [m["role"] for m in messages] == ["user", "assistant", "user", "user", "assistant"]
        assert [m["content"] for m in messages] == ["原始请求", "原回答，保留在引导之前。", "改为简短回答", "保留关键结论", "新回答，只保留结论。"]
        assert messages[1]["steered"] and not messages[1].get("pending")
        assert all(m["guidance"] and m["guidance_id"] for m in messages[2:4])
        assert not messages[-1].get("pending") and not messages[-1].get("steered")
        assert sum("previous_message" in event for event in events) == 1
        restored = json.loads(server.SESSIONS_FILE.read_text())
        assert restored["steering"]["messages"] == messages
    finally:
        server.VINIPER_TRANSPORT, server.agent_run_coordinator = previous_transport, previous_coordinator

    server.provider_config = lambda *_args: {"api_key": "", "model": "fixture-model", "provider": "fixture", "base_url": ""}
    sid = "harness-unconfigured"
    workdir = root / "unconfigured"
    workdir.mkdir()
    server.sessions[sid] = {"id": sid, "mode": "viniper", "workdir": str(workdir), "messages": []}
    port = LocalEffectsPort("completed")
    transport = server.HarnessRuntimeTransport(port)
    events = [event async for event in transport.stream(sid, "Unconfigured request")]
    assert not port.calls, "Production must not silently invoke Demo for a missing key"
    assert any(event["type"] == "error" and "API key" in event["content"] for event in events)
    assert server.safe_session(sid)["last_run_status"] == "failed"
    assert server.safe_session(sid)["messages"][-1]["model"] == "fixture-model"

    os.environ["VINIPER_UI_DEMO_ONLY"] = "1"
    events = [event async for event in transport.stream(sid, "Explicit demo fixture")]
    assert port.calls[0]["provider_id"] == "demo" and port.calls[0]["host_secret_value"] == ""
    assert server.safe_session(sid)["last_run_status"] == "completed"
    assert server.safe_session(sid)["messages"][-1]["model"] == "demo-default"
    print("PASS: actual Harness projection retains completed/failed/cancelled file changes, durable tools, and explicit Demo boundary")

asyncio.run(main())
