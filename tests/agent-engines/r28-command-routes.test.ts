import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { join } from "node:path";

test("Claude command HTTP handlers route native UI, CLI, and terminal without fake chat messages", () => {
  const root = process.cwd();
  const script = String.raw`
import asyncio, json, os, sys, tempfile
from pathlib import Path
from types import SimpleNamespace
root = Path(sys.argv[1])
task = root / 'codex' / '工作输出' / 'viniper-agent-usability-r28-20260905'
task.mkdir(parents=True, exist_ok=True)
os.environ['VINIPER_UI_DATA_DIR'] = tempfile.mkdtemp(prefix='command-test-', dir=task)
sys.path.insert(0, str(root / 'resources' / 'viniper-ui'))
import server
from fastapi import HTTPException
class Request:
    def __init__(self, body): self.body = body
    async def json(self): return self.body
probe = {'status':'ready', 'ready':True, 'version':'2.1.260', 'capabilities':{'agent_registry':True}}
async def snapshot(**kwargs): return probe
server.runtime_probe_snapshot = snapshot
server.sessions['test-cli'] = {'id':'test-cli', 'mode':'claude', 'name':'R28', 'workdir':str(task), 'permission_mode':'fullAccess', 'messages':[], 'claude_session_id':'56669f4b-a61c-47cf-a8d2-ea58fcfaeea1', 'claude_initialized':False}
server.sessions['test-viniper'] = {'id':'test-viniper', 'mode':'viniper', 'messages':[]}
class Runtime:
    distro = 'ViniperRuntime'
    user = 'viniper'
    def map_path(self, value): return '/tmp/r28'
    def capabilities(self): return SimpleNamespace(permission_modes=('manual','acceptEdits','plan','bypassPermissions'))
    def _bridge_environment(self, spec): return {'R28_ONLY':'true'}
server.WslAgentRuntime = Runtime
server.agent_runtime = Runtime
server.provider_config = lambda **kwargs: {'model':'Kimi-K3'}
server.build_claude_env = lambda *args, **kwargs: {}
server.runtime_bridge_keys = lambda *args: ()
server.coordinated_run_snapshot = lambda sid: None
calls = []
class Process:
    def poll(self): return None
def launch(argv, **kwargs):
    calls.append((argv,kwargs)); return Process()
server.subprocess.Popen = launch
server.subprocess.run = lambda argv, **kwargs: SimpleNamespace(returncode=0,stdout='Usage: claude',stderr='')
async def main():
    manifest = await server.claude_native_command_manifest(mode='claude')
    assert manifest['cli_version'] == '2.1.260' and manifest['descriptors']
    result = await server.execute_claude_native_command('test-cli', Request({'command':'/model'}))
    assert result['status'] == 'open_ui' and result['ui_action'] == 'model'
    result = await server.execute_claude_native_command('test-cli', Request({'command':'/help'}))
    assert result['status'] == 'completed' and result['summary'] == 'Usage: claude'
    result = await server.execute_claude_native_command('test-cli', Request({'command':'/compact','arguments':'keep task'}))
    assert result['status'] == 'native_terminal_opened' and len(calls) == 1
    assert 'keep task' not in calls[0][0] and '--session-id' not in calls[0][0]
    assert '--resume' not in calls[0][0]  # a fresh native window does not consume the stream UUID
    assert server.sessions['test-cli']['messages'] == []
    for invoke in (
        lambda:server.execute_claude_native_command('test-cli',Request({'command':'/compact'})),
        lambda:server.execute_claude_native_command('test-viniper',Request({'command':'/model'})),
        lambda:server.submit_run('test-cli',Request({'message':'hello','mode':'claude'})),
    ):
        try: await invoke()
        except HTTPException as exc: assert exc.status_code == 409
        else: raise AssertionError('expected owner/exclusive terminal rejection')
    assert len(calls) == 1
    (task/'r28-file.txt').write_text('preview ok', encoding='utf-8')
    listing = await server.project_index(session_id='test-cli', mode='claude')
    assert listing['engine'] == 'desktop-file-browser'
    assert any(row['path'] == 'r28-file.txt' for row in listing['entries'])
    preview = await server.project_file_preview('test-cli','r28-file.txt',mode='claude')
    assert preview['content'] == 'preview ok' and preview['status'] == 'available'
    for path,mode in (('../outside.txt','claude'),('r28-file.txt','viniper')):
        try: await server.project_file_preview('test-cli',path,mode=mode)
        except HTTPException as exc: assert exc.status_code in (400,409)
        else: raise AssertionError('project owner/root guard required')
    server.sessions['test-viniper']['plan']={'steps':[{'title':'read','status':'completed'},{'title':'write','status':'blocked'},{'title':'verify','status':'pending'}]}
    server.finalize_plan_for_terminal('test-viniper','completed')
    assert [item['status'] for item in server.sessions['test-viniper']['plan']['steps']] == ['completed','blocked','pending']
    print('native command routes PASS')
asyncio.run(main())
`;
  const result = spawnSync(process.platform === "win32" ? "py" : "python3", process.platform === "win32" ? ["-3", "-E", "-c", script, root] : ["-c", script, root], { cwd: root, encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /native command routes PASS/);
});
