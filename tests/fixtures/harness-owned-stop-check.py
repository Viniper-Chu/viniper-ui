"""Real child-process exit acknowledgement through the production Python port."""
import asyncio
import json
import os
from pathlib import Path
import socket
import sys
from unittest.mock import patch

root = Path(sys.argv[1]).resolve()
assert root.is_relative_to(Path.cwd() / "codex" / "运行残留")
for name in list(os.environ):
    if name.startswith(("VINIPER_", "ANTHROPIC_", "OPENAI_", "CLAUDE_")):
        os.environ.pop(name, None)
os.environ.update({"VINIPER_UI_DATA_DIR": str(root / "data"),
                   "VINIPER_UI_DEFAULT_WORKSPACE_ROOT": str(root),
                   "CLAUDE_CONFIG_DIR": str(root / "claude")})
def no_network(*_args, **_kwargs):
    raise AssertionError("Owned stop fixture cannot use a provider or network")
socket.socket.connect = no_network
sys.path.insert(0, str(Path.cwd() / "resources" / "viniper-ui"))
import harness_application_port as port_module
import server

(root / "worker.cjs").write_text(r'''
const fs = require('node:fs');
const [target, delay] = process.argv.slice(2);
process.on('message', message => {
  if (message === 'stop') setTimeout(() => {
    fs.writeFileSync(target, 'committed while stopping\n');
    process.exit(0);
  }, Number(delay));
});
process.send({ready: true});
''')
bridge = root / "bridge.cjs"
bridge.write_text(r'''
const {fork} = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');
const emit = data => process.stdout.write(JSON.stringify(data) + '\n');
const runs = new Map();
const event = (sid, type, payload) => emit({type:'runtime.event', native_session_id:sid,
  event:{type, sessionId:sid, runId:'run-'+sid, payload}});
emit({type:'bridge.ready'});
readline.createInterface({input:process.stdin, crlfDelay:Infinity}).on('line', line => {
  const command=JSON.parse(line), sid=command.native_session_id;
  if (command.op==='run') {
    const child=fork(path.join(__dirname,'worker.cjs'), [path.join(command.workdir,'cleanup.txt'), sid==='late'?'500':'150'], {stdio:['ignore','ignore','ignore','ipc']});
    runs.set(sid,child);
    child.once('message', () => {
      emit({type:'runtime.started', native_session_id:sid});
      event(sid,'tool.requested',{toolName:'terminal.run', callId:'call-'+sid, title:'Owned local worker', status:'running'});
      if (sid==='failed' || sid==='late') event(sid,'runtime.error',{error:{message:'fixture failure before tool cleanup'}});
    });
    child.once('exit', () => {
      runs.delete(sid);
      event(sid,'tool.cancelled',{toolName:'terminal.run',callId:'call-'+sid,result:'Stopped'});
      event(sid,'run.cancelled',{runId:'run-'+sid});
      emit({type:'runtime.completed',native_session_id:sid,status:'run.cancelled'});
    });
    return;
  }
  if (command.op==='cancel') { const child=runs.get(sid); if(child?.connected) child.send('stop'); return; }
  emit({type:'control.response', request_id:command.request_id, ok:true,
    data:{runs:[...runs].map(([sid,child])=>({sid,pid:child.pid}))}});
}).on('close',()=>{ for(const child of runs.values()) child.kill(); });
''')

async def main():
    port = port_module.HarnessApplicationPort(runtime_script=bridge, runtime_data_root=root / "bridge-data")
    server.provider_config = lambda *_args: {"api_key": "local-fixture-only", "provider": "fixture", "model": "fixture", "base_url": ""}
    transport = server.HarnessRuntimeTransport(port)
    healthy_dir = root / "healthy"
    healthy_dir.mkdir()
    healthy = port.stream(session_id="healthy", prompt="wait", model="demo-default", workdir=str(healthy_dir))
    await anext(healthy)
    try:
        for sid in ("failed", "cancelled", "late"):
            workdir = root / sid
            workdir.mkdir()
            server.sessions[sid] = {"id": sid, "mode": "viniper", "workdir": str(workdir), "messages": []}
            events = []
            ready = asyncio.Event()
            async def consume():
                async for event in transport.stream(sid, "Only the offline owned worker"):
                    events.append(event)
                    if event.get("type") == "tool_start":
                        ready.set()
            with patch.object(port_module, "_RUN_STOP_TIMEOUT_SECONDS", .05 if sid == "late" else 2):
                task = asyncio.create_task(consume())
                await asyncio.wait_for(ready.wait(), timeout=2)
                snapshot = await port.control("capabilities.snapshot")
                pid = next(row["pid"] for row in snapshot["runs"] if row["sid"] == sid)
                if sid == "cancelled":
                    task.cancel()
                    try:
                        await asyncio.wait_for(task, timeout=3)
                    except asyncio.CancelledError:
                        pass
                    else:
                        raise AssertionError("Task cancellation must still propagate after cleanup")
                else:
                    await asyncio.wait_for(task, timeout=3)
            message = server.safe_session(sid)["messages"][-1]
            if sid == "late":
                assert port.active_run(sid), "Stop timeout must retain the run owner"
                assert "停止尚未确认" in message["content"]
                assert any("停止尚未确认" in str(event.get("content")) for event in events), "Timeout must reach the live UI"
                duplicate = port.stream(session_id=sid, prompt="retry", model="demo-default", workdir=str(workdir))
                try:
                    await anext(duplicate)
                except RuntimeError:
                    pass
                else:
                    raise AssertionError("A still-stopping run accepted an overlapping retry")
                deadline = asyncio.get_running_loop().time() + 2
                while port.active_run(sid) and asyncio.get_running_loop().time() < deadline:
                    await asyncio.sleep(.01)
            else:
                artifacts = [item for item in message["segments"] if item.get("type") == "artifact"]
                assert len(artifacts) == 1 and artifacts[0]["name"] == "cleanup.txt"
                assert "+committed while stopping" in artifacts[0]["file_change"]["diff"]
                assert not message.get("pending")
            assert not port.active_run(sid)
            assert (workdir / "cleanup.txt").read_text() == "committed while stopping\n"
            if os.name != "nt":
                try:
                    os.kill(pid, 0)
                except ProcessLookupError:
                    pass
                else:
                    raise AssertionError("Owned child still alive after terminal acknowledgement")
            assert port.active_run("healthy"), "Stopping this run must not stop another session"
            rows = (await port.control("capabilities.snapshot"))["runs"]
            assert [row["sid"] for row in rows] == ["healthy"]
        print("PASS: actual child exit precedes final diff; cancellation propagates; bounded stop retains ownership and warns the UI; unrelated session survives")
    finally:
        await healthy.aclose()
        await port.shutdown()

asyncio.run(main())
