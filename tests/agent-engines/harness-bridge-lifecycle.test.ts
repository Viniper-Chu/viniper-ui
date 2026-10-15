import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("Application Port keeps controls concurrent and reports bridge exit without stranding or cross-cancelling sessions", { timeout: 20000 }, () => {
  const residue = join(process.cwd(), "codex", "运行残留");
  mkdirSync(residue, { recursive: true });
  const root = mkdtempSync(join(residue, "harness-bridge-lifecycle-"));
  const script = String.raw`
import asyncio,json,os,sys
from pathlib import Path
root=Path(sys.argv[1])
sys.path.insert(0,str(Path.cwd()/'resources'/'viniper-ui'))
from harness_application_port import HarnessApplicationPort
bridge=root/'bridge.js'
bridge.write_text(r'''
const readline=require('node:readline');
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
let waiting;
const runs=new Set();
emit({type:'bridge.ready'});
readline.createInterface({input:process.stdin,crlfDelay:Infinity}).on('line',line=>{
  const command=JSON.parse(line), reply=data=>emit({type:'control.response',request_id:command.request_id,ok:true,data});
  if(command.op==='collaboration.wait'){ waiting=reply; return; }
  if(command.op==='permission.resolve'){
    reply({resolved:true}); if(waiting){waiting({released:true});waiting=undefined;} return;
  }
  if(command.op==='permissions.snapshot' && command.exit){ process.exit(23); }
  if(command.op==='run'){
    if(command.prompt==='exit'){process.exit(24);}
    runs.add(command.native_session_id);
    emit({type:'runtime.started',native_session_id:command.native_session_id});return;
  }
  if(command.op==='cancel'){
    runs.delete(command.native_session_id);
    emit({type:'runtime.completed',native_session_id:command.native_session_id});return;
  }
  reply({runs:[...runs]});
}).on('close',()=>process.exit(0));
''')

async def fast_failure(awaitable,label):
    try: await asyncio.wait_for(awaitable,timeout=1)
    except asyncio.TimeoutError: raise AssertionError(label+' waited for timeout instead of bridge EOF')
    except RuntimeError as error:
        assert 'bridge' in str(error).lower(),type(error).__name__
    else: raise AssertionError(label+' did not fail')

async def main():
    port=HarnessApplicationPort(runtime_script=bridge,runtime_data_root=root/'data')
    try:
        # Both submissions reach the asynchronous cold-start barrier together.
        cold=[port.stream(session_id='cold',prompt='wait',model='demo-basic',workdir=str(root)) for _ in range(2)]
        results=await asyncio.wait_for(asyncio.gather(*(anext(stream) for stream in cold),return_exceptions=True),timeout=1)
        assert sum(isinstance(item,RuntimeError) for item in results)==1,results
        for stream in cold: await stream.aclose()
        waiting=asyncio.create_task(port.control('collaboration.wait'))
        await asyncio.sleep(.1)
        approval=await asyncio.wait_for(port.resolve_permission('one','run','call','allow-once'),timeout=1)
        assert approval['resolved'] and (await waiting)['released']
        await fast_failure(port.control('permissions.snapshot',exit=True),'control')
        assert (await port.control('capabilities.snapshot'))['runs']==[],'bridge restart did not become ready'
        async def exit_run():
            async for _ in port.stream(session_id='crash',prompt='exit',model='demo-basic',workdir=str(root)): pass
        await fast_failure(exit_run(),'run')
        assert not port.active_run('crash')
        assert (await port.control('capabilities.snapshot'))['runs']==[]

        # A suspended reader from the dead generation cannot cancel or remove
        # a replacement run with the same native session id.
        previous=port.stream(session_id='reused',prompt='wait',model='demo-basic',workdir=str(root))
        await anext(previous)
        await fast_failure(port.control('permissions.snapshot',exit=True),'generation')
        replacement=port.stream(session_id='reused',prompt='wait',model='demo-basic',workdir=str(root))
        await anext(replacement)
        assert (await anext(previous))['type']=='bridge.failed'
        try: await anext(previous)
        except RuntimeError: pass
        assert port.active_run('reused') and (await port.control('capabilities.snapshot'))['runs']==['reused']
        await replacement.aclose()

        first=port.stream(session_id='same',prompt='wait',model='demo-basic',workdir=str(root))
        await anext(first)
        async def duplicate():
            async for _ in port.stream(session_id='same',prompt='duplicate',model='demo-basic',workdir=str(root)): pass
        try: await duplicate()
        except RuntimeError: pass
        else: raise AssertionError('duplicate session accepted')
        other=port.stream(session_id='other',prompt='wait',model='demo-basic',workdir=str(root))
        await anext(other)
        await first.aclose()
        await asyncio.sleep(.05)
        snapshot=await port.control('capabilities.snapshot')
        assert snapshot['runs']==['other'],snapshot
        assert port.active_run('other') and not port.active_run('same')
        await other.aclose()
        assert (await port.control('capabilities.snapshot'))['runs']==[]
    finally:
        await port.shutdown()
        assert not port._control_waiters and not port._active_runs
    print('concurrent controls, immediate EOF failures, bridge restart, consumer close, session isolation passed')

asyncio.run(main())
`;
  try {
    const result = spawnSync(process.platform === "win32" ? "py" : "python3", [
      ...(process.platform === "win32" ? ["-3"] : []), "-I", "-c", script, root,
    ], { cwd: process.cwd(), encoding: "utf8", timeout: 15000, env: { PATH: process.env.PATH, HOME: root, USERPROFILE: root, SystemRoot: process.env.SystemRoot, TMPDIR: root } });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /session isolation passed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
