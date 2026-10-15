import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { SQLiteStore } from "../../src/platform/persistence/sqlite-store";

test("a real Harness bridge completes and persists one session while another awaits permission", { timeout: 25000 }, async () => {
  const residue = join(process.cwd(), "codex", "运行残留");
  await mkdir(residue, { recursive: true });
  const root = await mkdtemp(join(residue, "harness-concurrent-completion-"));
  try {
    const compiledRoot = resolve(__dirname, "../..");
    await mkdir(join(root, "harness-runtime", "dist"), { recursive: true });
    await cp(join(compiledRoot, "src"), join(root, "harness-runtime", "dist", "src"), { recursive: true });
    for (const filename of ["harness_runtime_bridge.js", "harness_provider_boundary.js", "harness_usage_projection.js", "model-capabilities.json"]) {
      await cp(join(process.cwd(), "resources", "viniper-ui", filename), join(root, filename));
    }
    const bridgePath = join(root, "harness_runtime_bridge.js");
    await writeFile(bridgePath,
      "require('./harness-runtime/dist/src/features/memory/memory-service.js').MemoryService.prototype.captureSession = async () => { throw new Error('fixture memory storage failure'); };\n"
      + await readFile(bridgePath, "utf8"));
    const script = String.raw`
import asyncio,json,sys
from pathlib import Path
root=Path(sys.argv[1])
sys.path.insert(0,str(Path.cwd()/'resources'/'viniper-ui'))
from harness_application_port import HarnessApplicationPort

async def main():
    port=HarnessApplicationPort(runtime_script=root/'harness_runtime_bridge.js',runtime_data_root=root/'data')
    pending=asyncio.Event()
    approvals=[]
    async def waiting_run():
        async for event in port.stream(session_id='permission-session',prompt='等待人工批准只读演示工具',model='demo-default',provider_id='demo',workdir=str(root),permission_mode='ask'):
            if event['type']=='provider.event' and event['event']['type']=='permission_request':
                approvals.append(event['event']);pending.set()
    async def completing_run():
        return [item async for item in port.stream(session_id='completed-session',prompt='你是谁',model='demo-default',provider_id='demo',workdir=str(root),permission_mode='auto')]
    task=asyncio.create_task(waiting_run())
    try:
        pending_wait=asyncio.create_task(pending.wait())
        await asyncio.wait({task,pending_wait},timeout=6,return_when=asyncio.FIRST_COMPLETED)
        if task.done(): await task
        assert pending.is_set(),'real runtime did not reach the permission card'
        events=await asyncio.wait_for(completing_run(),timeout=4)
        assert events[-1]['type']=='runtime.completed' and events[-1]['status']=='run.completed',events[-1]
        warnings=[event['event'] for event in events if event['type']=='provider.event' and event['event']['type']=='runtime_warning']
        assert len(warnings)==1 and warnings[0]['code']=='automatic_memory_failed',warnings
        assert not any(event['type']=='provider.event' and event['event']['type']=='runtime_error' for event in events)
        assert port.active_run('permission-session') and not task.done(),'completion cancelled the unrelated waiting session'
        assert len((await port.permissions_snapshot())['pending'])==1
        # Read through the owner, without requiring the unrelated run to stop.
        snapshot=await port.control('capabilities.snapshot')
        assert snapshot,'owner did not remain responsive'
        state=json.loads((root/'data'/'harness-runtime'/'native-session-map.json').read_text())
        assert {'permission-session','completed-session'}<=set(state['sessions'])
        await port._cancel_owned_process(port._bridge_process,'permission-session')
        await asyncio.wait_for(task,timeout=4)
        assert not port.active_run('permission-session')
        await port.shutdown()
        # A fresh bridge restores the completed session from the same owner.
        restored=await port.control('collaboration.snapshot')
        rows=restored.get('sessions') or []
        assert any(row.get('native_session_id')=='completed-session' and row.get('state')=='idle' for row in rows),restored
        print('real Harness: memory warning was delivered without failing the run; completed session returned before unrelated permission response; shutdown and persisted restore passed; provider calls=0')
    finally:
        if not task.done(): task.cancel()
        await asyncio.gather(task,return_exceptions=True)
        await port.shutdown()

asyncio.run(main())
`;
    const result = spawnSync(process.platform === "win32" ? "py" : "python3", [
      ...(process.platform === "win32" ? ["-3"] : []), "-I", "-c", script, root,
    ], { cwd: process.cwd(), encoding: "utf8", timeout: 20000, env: {
      PATH: process.env.PATH, HOME: root, USERPROFILE: root, SystemRoot: process.env.SystemRoot, TMPDIR: root,
      VINIPER_UI_DEFAULT_WORKSPACE_ROOT: root, VINIPER_HARNESS_ALLOW_EXTERNAL_NETWORK: "0",
    } });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /provider calls=0/);
    // Inspect only this isolated fixture through the production persistence
    // owner, after the bridge has released its lease and exited.
    const dataRoot = join(root, "data", "harness-runtime");
    const mapping = JSON.parse(await readFile(join(dataRoot, "native-session-map.json"), "utf8"));
    const store = new SQLiteStore(dataRoot);
    await store.initialize();
    try {
      const persisted = await store.load();
      const completed = persisted!.application.sessions.find((item) => item.id === mapping.sessions["completed-session"].harnessSessionId)!;
      assert.equal(completed.status, "idle");
      assert.ok(completed.messages.some((message) => message.role === "assistant" && message.status === "completed"));
    } finally {
      await store.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
