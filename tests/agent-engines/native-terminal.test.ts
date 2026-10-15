import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

test("native PTY provides a controlling terminal, Unicode input, resize, replay and owned-group cleanup", { skip: process.platform === "win32", timeout: 30000 }, () => {
  const residue = join(process.cwd(), "codex", "运行残留");
  mkdirSync(residue, { recursive: true });
  const fixtureRoot = mkdtempSync(join(residue, "native-terminal-"));
  const script = String.raw`
import asyncio, json, os, signal, sys, time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0, str(Path.cwd() / 'resources' / 'viniper-ui'))
from native_terminal import NativeTerminalManager, NativeTerminalConflict

fixture = r'''
import json, os, signal, subprocess, sys, time
fd=os.open('/dev/tty', os.O_RDWR)
print('READY='+json.dumps({'isatty':all(os.isatty(i) for i in (0,1,2)), 'controlling':os.tcgetpgrp(fd)==os.getpgrp(), 'sessionLeader':os.getsid(0)==os.getpid()}), flush=True)
os.close(fd)
text='\x1b[32m中文✓\x1b[0m\n'.encode()
split=text.index('中'.encode())+1
os.write(1,text[:split]);time.sleep(.01);os.write(1,text[split:])
while True:
    try: line=input()
    except KeyboardInterrupt:
        print('INTERRUPTED',flush=True);continue
    except EOFError: break
    if line=='quit': break
    if line=='size':
        size=os.get_terminal_size(0)
        print('SIZE='+str(size.columns)+'x'+str(size.lines),flush=True)
    elif line=='stubborn':
        code="import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);print('CHILD_READY',flush=True);time.sleep(90)"
        child=subprocess.Popen([sys.executable,'-u','-c',code],stdout=subprocess.PIPE,text=True)
        assert child.stdout.readline().strip()=='CHILD_READY'
        signal.signal(signal.SIGTERM,signal.SIG_IGN)
        print('CHILD='+str(child.pid),flush=True)
    else: print('ECHO='+line,flush=True)
'''

env={'PATH':os.environ.get('PATH','/usr/bin:/bin'),'HOME':sys.argv[1],'LANG':'en_US.UTF-8'}
argv=[sys.executable,'-u','-c',fixture]
cwd=sys.argv[1]

async def text_until(manager,sid,marker,after=0):
    output=''
    async with asyncio.timeout(4):
        async for event in manager.subscribe(sid,after):
            if event['type']=='output': output+=event['data']
            if marker in output: return output
    raise AssertionError('terminal ended before '+marker)

async def gone(pid):
    for _ in range(100):
        try: os.kill(pid,0)
        except ProcessLookupError: return
        await asyncio.sleep(.02)
    raise AssertionError('owned descendant survived termination')

def fd_count():
    folder=Path('/dev/fd') if sys.platform=='darwin' else Path('/proc/self/fd')
    return len(list(folder.iterdir()))

async def main():
    # A zombie-only Darwin group is gone; a live permission failure must still
    # be reported rather than presented as successful process cleanup.
    terminal=SimpleNamespace(process=SimpleNamespace(pid=12345))
    with patch('native_terminal.os.killpg',side_effect=PermissionError(1,'fixture')):
        with patch('native_terminal.os.getpgid',return_value=12345):
            try: NativeTerminalManager._group_alive(terminal)
            except PermissionError: pass
            else: raise AssertionError('live process-group permission failure was swallowed')
        if sys.platform=='darwin':
            with patch('native_terminal.os.getpgid',side_effect=ProcessLookupError(3,'fixture')):
                assert NativeTerminalManager._group_alive(terminal) is False
    manager=NativeTerminalManager(max_buffer_bytes=16384,grace_seconds=.15)
    try:
        opened=await manager.open('first',argv,cwd,env,80,24)
        assert opened['status']=='running' and manager.active('first')
        initial=await text_until(manager,'first','中文✓')
        assert '\x1b[32m' in initial and '\ufffd' not in initial
        ready=json.loads(next(line.removeprefix('READY=') for line in initial.splitlines() if line.startswith('READY=')))
        assert all(ready.values()),ready
        await manager.write('first','你好\r')
        await text_until(manager,'first','ECHO=你好')
        await manager.resize('first',120,42)
        await manager.write('first','size\r')
        await text_until(manager,'first','SIZE=120x42')
        await manager.write('first','\x03')
        await text_until(manager,'first','INTERRUPTED')
        cursor=manager.snapshot('first')['sequence']
        await manager.write('first','reconnect\r')
        replay=await text_until(manager,'first','ECHO=reconnect',cursor)
        assert 'READY=' not in replay
        await manager.write('first','quit\r')
        async for _ in manager.subscribe('first',cursor): pass
        done=manager.snapshot('first')
        assert done['status']=='exited' and done['exit_code']==0 and not manager.active('first')
        try: await manager.write('first','must-not-write')
        except RuntimeError: pass
        else: raise AssertionError('write to exited terminal accepted')

        results=await asyncio.gather(manager.open('race',argv,cwd,env),manager.open('race',argv,cwd,env),return_exceptions=True)
        assert sum(isinstance(row,NativeTerminalConflict) for row in results)==1,results
        await manager.open('second',argv,cwd,env)
        assert manager.active('race') and manager.active('second')
        await text_until(manager,'second','READY=')
        await manager.write('second','stubborn\r')
        output=await text_until(manager,'second','CHILD=')
        child_pid=int(next(line.removeprefix('CHILD=') for line in output.splitlines() if line.startswith('CHILD=')))
        parent_pid=manager.snapshot('second')['pid']
        cancelled=await manager.close('second')
        assert cancelled['status']=='exited'
        await gone(parent_pid);await gone(child_pid)
        assert manager.active('race'),'cleanup touched another session'
        await manager.close('race')

        # Darwin may return EPERM to killpg(pid, 0) while its last member is
        # a zombie not yet reaped by asyncio. Real fast TERM cycles exercise
        # that race; shutdown must remain repeatable after every close.
        for index in range(20):
            key='term-race-'+str(index)
            await manager.open(key,[sys.executable,'-I','-c','import time;time.sleep(30)'],cwd,env)
            await asyncio.sleep(.03)
            closed=await manager.close(key)
            assert closed['status']=='exited'
            await gone(closed['pid'])

        # An unconsumed terminal cannot allocate an unbounded per-client queue.
        small=NativeTerminalManager(max_buffer_bytes=4096,grace_seconds=.1)
        try:
            noisy=[sys.executable,'-u','-c',"import sys;sys.stdout.write('x'*150000+'TAIL_DONE');sys.stdout.flush()"]
            await small.open('noisy',noisy,cwd,env)
            async for _ in small.subscribe('noisy'): pass
            snap=small.snapshot('noisy')
            assert snap['output_truncated'] and len(snap['output'].encode())<=4096,snap
            assert 'TAIL_DONE' in snap['output'],'final PTY output was discarded on process exit'
            events=[event async for event in small.subscribe('noisy',0)]
            assert events[0]['type']=='gap' and events[-1]['status']=='exited'
        finally: await small.shutdown()

        baseline=fd_count()
        for index in range(8):
            key='quick-'+str(index)
            await manager.open(key,[sys.executable,'-c','pass'],cwd,env)
            async for _ in manager.subscribe(key): pass
        assert fd_count()<=baseline+1,(baseline,fd_count())
        await manager.open('invalid',['/missing/fixture-cli'],cwd,env)
        async for _ in manager.subscribe('invalid'): pass
        assert manager.snapshot('invalid')['exit_code']==127
    finally:
        await manager.shutdown()
    assert all(not manager.active(key) for key in manager.session_ids())
    print('real PTY: controlling TTY, Unicode/ANSI, keyboard, resize, replay, bounded output, concurrent ownership, descendant cleanup, EOF and fd lifecycle passed; provider requests=0')

asyncio.run(main())
`;
  try {
    const result = spawnSync("python3", ["-I", "-c", script, fixtureRoot], {
      cwd: process.cwd(), encoding: "utf8", timeout: 25000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /provider requests=0/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
