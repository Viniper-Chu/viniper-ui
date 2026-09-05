import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";

function pythonContract(script: string): void {
  const executable = process.platform === "win32" ? "py" : "python3";
  const result = spawnSync(executable, [
    ...(process.platform === "win32" ? ["-3"] : []), "-E", "-c",
    `import sys\nsys.path.insert(0, ${JSON.stringify(join(process.cwd(), "resources", "viniper-ui"))})\n${script}`,
  ], { encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

const fixtures = String.raw`
import copy, io, json, struct, tempfile, urllib.error
from pathlib import Path
from unittest.mock import patch
from update_manager import *
def manifest():
    return {"version":"1.8.1", "channel":"stable", "requires_installer":True,
        "assets":{"installer":{"name":"Viniper-workstation-Setup.exe", "size":128,
        "url":"https://github.com/Viniper-Chu/viniper-ui/releases/download/v1.8.1/Viniper-workstation-Setup.exe"}}}
def exe_bytes():
    value=bytearray(128); value[:2]=b'MZ'; struct.pack_into('<I',value,0x3c,96); value[96:100]=b'PE\0\0'
    return bytes(value)
class Response(io.BytesIO):
    status=200
    def __init__(self, data, status=200, headers=None):
        super().__init__(data); self.status=status; self.headers=headers or {'Content-Length':str(len(data))}
    def geturl(self): return 'https://release-assets.githubusercontent.com/github-production-release-asset/test'
`;

test("official updater accepts full stable installer only and rejects untrusted executable sources", () => {
  pythonContract(fixtures + String.raw`
assert official_manifest_url() == OFFICIAL_MANIFEST_URL
assert validate_installer_manifest(manifest())["key"] == "installer"
invalid = []
for key, value in (("version","1.8.1-beta.1"),("channel","preview"),("draft",True),("prerelease",True)):
    item=manifest(); item[key]=value; invalid.append(item)
for key,value in (("url","file:///C:/evil.exe"),("url","https://github.com/other/repo/releases/download/v1.8.1/Viniper-workstation-Setup.exe"),
                  ("url","https://github.com/Viniper-Chu/viniper-ui/releases/download/v9.0.0/Viniper-workstation-Setup.exe"),
                  ("name","../Viniper-workstation-Setup.exe"),("size",0),("size",MAX_INSTALLER_BYTES+1)):
    item=manifest(); item["assets"]["installer"][key]=value; invalid.append(item)
for item in invalid:
    try: validate_installer_manifest(item)
    except ValueError: pass
    else: raise AssertionError(item)
for url in ('http://github.com/Viniper-Chu/viniper-ui/releases/latest/download/latest.json',
            'https://evil.example/latest.json','file:///C:/latest.json'):
    try: official_manifest_url(url)
    except ValueError: pass
    else: raise AssertionError('untrusted manifest accepted')
for url in ('http://release-assets.githubusercontent.com/a','https://github.com.evil.example/a','https://user@github.com/a'):
    try: validate_release_response_url(url)
    except ValueError: pass
    else: raise AssertionError('untrusted redirect accepted')
item=manifest(); item['assets']={'portable':{'name':'Viniper-workstation.zip','url':'https://github.com/file.zip','size':42}}
try: validate_installer_manifest(item)
except ValueError: pass
else: raise AssertionError('portable package accepted')
`);
});

test("installer download validates manifest length, emits actual progress and reuses verified download", () => {
  pythonContract(fixtures + String.raw`
with tempfile.TemporaryDirectory() as directory:
    target=Path(directory)/'Setup.exe'; asset=validate_installer_manifest(manifest()); seen=[]
    with patch('update_manager.urllib.request.urlopen',return_value=Response(exe_bytes())) as request:
        download_installer(asset,target,version='1.8.0',progress=lambda n,t:seen.append((n,t)),chunk_size=32)
        assert request.call_count == 1
    assert target.read_bytes()==exe_bytes() and seen[-1]==(128,128)
    assert any(0<n<128 for n,_ in seen)
    with patch('update_manager.urllib.request.urlopen',side_effect=AssertionError('must use completed local asset')):
        download_installer(asset,target,version='1.8.0')
    target.write_bytes(b'corrupt')
    with patch('update_manager.urllib.request.urlopen',return_value=Response(exe_bytes())):
        download_installer(asset,target,version='1.8.0')
    assert target.read_bytes()==exe_bytes()
`);
});

test("interrupted download resumes exact byte range and rejects incorrect or oversized HTTP responses", () => {
  pythonContract(fixtures + String.raw`
with tempfile.TemporaryDirectory() as directory:
    target=Path(directory)/'Setup.exe'; partial=target.with_suffix('.exe.part'); asset=validate_installer_manifest(manifest())
    partial.write_bytes(exe_bytes()[:64])
    response=Response(exe_bytes()[64:],206,{'Content-Length':'64','Content-Range':'bytes 64-127/128'})
    with patch('update_manager.urllib.request.urlopen',return_value=response) as request:
        download_installer(asset,target,version='1.8.0',retries=1)
        assert request.call_args.args[0].get_header('Range')=='bytes=64-'
    assert target.read_bytes()==exe_bytes()
    target.unlink(); partial.write_bytes(exe_bytes()[:64])
    with patch('update_manager.urllib.request.urlopen',return_value=Response(exe_bytes())):
        download_installer(asset,target,version='1.8.0',retries=1)
    assert target.read_bytes()==exe_bytes(), 'server ignoring Range must restart, not append'
    target.unlink()
    for response in (Response(exe_bytes()+b'bad'), Response(exe_bytes()[:-1]),
                     Response(b'not an executable'.ljust(128,b'x'))):
        with patch('update_manager.urllib.request.urlopen',return_value=response):
            try: download_installer(asset,target,version='1.8.0',retries=1)
            except ValueError: pass
            else: raise AssertionError('corrupt payload accepted')
        assert not target.exists()
        if partial.exists(): partial.unlink()
`);
});

test("download retry is bounded and later retry can recover without altering installed files", () => {
  pythonContract(fixtures + String.raw`
with tempfile.TemporaryDirectory() as directory:
    target=Path(directory)/'Setup.exe'; untouched=Path(directory)/'settings.json'; untouched.write_text('user data')
    asset=validate_installer_manifest(manifest())
    with patch('update_manager.urllib.request.urlopen',side_effect=TimeoutError('network')) as request, patch('update_manager.time.sleep'):
        try: download_installer(asset,target,version='1.8.0',retries=2)
        except TimeoutError: pass
        else: raise AssertionError('network failure claimed success')
        assert request.call_count==2
    assert not target.exists() and untouched.read_text()=='user data'
    with patch('update_manager.urllib.request.urlopen',return_value=Response(exe_bytes())):
        download_installer(asset,target,version='1.8.0',retries=1)
    assert target.read_bytes()==exe_bytes() and untouched.read_text()=='user data'
`);
});

test("update state reports download versus installer handoff honestly and is thread safe", () => {
  pythonContract(fixtures + String.raw`
state=UpdateState('1.8.0'); assert state.snapshot()['status']=='idle'
state.set(status='downloading'); state.progress(32,128)
assert state.snapshot()['progress_percent']==25 and not state.snapshot()['ready_to_install']
state.set(status='ready'); assert state.snapshot()['ready_to_install']
state.set(status='installer_opened'); result=state.snapshot()
assert result['installer_opened'] and not result['ready_to_install'] and result['current_version']=='1.8.0'
assert 'installed' not in result and 'installer_path' not in result
result['status']='changed outside'; assert state.snapshot()['status']=='installer_opened'
`);
});

test("apply update rejects active engines and preserves ready download; launch failure is retryable", () => {
  pythonContract(fixtures + String.raw`
import ast, asyncio, types
from fastapi import HTTPException
source=Path(sys.path[0])/'server.py'; tree=ast.parse(source.read_text(encoding='utf-8'))
names={'apply_update','update_request_body','active_update_blockers','get_update_status','ensure_update_not_installing','refresh_update_install_state'}
functions=[node for node in tree.body if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)) and node.name in names]
for node in functions: node.decorator_list=[]
code=compile(ast.Module(body=functions,type_ignores=[]),str(source),'exec')
class Request:
    headers={'content-type':'application/json'}
    async def json(self): return {}
async def no_background_tasks(): return None
with tempfile.TemporaryDirectory() as directory:
    root=Path(directory); target=root/'updates'/'1.8.1'/'Viniper-workstation-Setup.exe'; target.parent.mkdir(parents=True); target.write_bytes(exe_bytes())
    exe=root/'Application with spaces'/'Viniper workstation.exe'; exe.parent.mkdir(); exe.write_bytes(b'placeholder')
    app_dir=exe.parent/'resources'/'viniper-ui'; app_dir.mkdir(parents=True)
    state=UpdateState('1.8.0'); state.set(status='ready')
    child=types.SimpleNamespace(poll=lambda:None)
    launches=[]
    def launch(*args,**kwargs): launches.append((args,kwargs)); return child
    ns=dict(globals(),Any=object,Request=Request,HTTPException=HTTPException,_update_state=state,
        _update_ready={'manifest':manifest(),'asset':validate_installer_manifest(manifest()),'path':target},
        _update_installer_process=None,_update_other_mutations=0,_active_runs={'viniper':{}},
        _viniper_tasks={},_goal_tasks={},sessions={'viniper':{},'claude':{}},_native_terminal_processes={},
        coordinated_run_snapshot=lambda sid:None,native_terminal_active=lambda sid:False,
        choose_update_asset=validate_installer_manifest,DATA_DIR=root,APP_DIR=app_dir,
        configured_update_desktop=lambda:exe,subprocess=types.SimpleNamespace(Popen=launch),
        update_error_message=lambda exc,**kw:'could not launch installer',ensure_harness_update_idle=no_background_tasks)
    exec(code,ns)
    for active in ({'viniper':{}},{'claude':{}}):
        ns['_active_runs']=active
        try: asyncio.run(ns['apply_update'](Request()))
        except HTTPException as exc: assert exc.status_code==409
        else: raise AssertionError('active engine was interrupted')
        assert not launches and state.snapshot()['status']=='ready'
    ns['_active_runs']={}; ns['_update_other_mutations']=1
    try: asyncio.run(ns['apply_update'](Request()))
    except HTTPException as exc: assert exc.status_code==409
    else: raise AssertionError('in-flight settings save was interrupted')
    ns['_update_other_mutations']=0
    result=asyncio.run(ns['apply_update'](Request()))
    assert result['status']=='installer_opened' and result['updated'] is False
    assert launches[0][1]['shell'] is False and launches[0][1]['executable']==str(target.resolve())
    assert launches[0][0][0].endswith('/D="'+str(exe.parent)+'"')
    try: ns['ensure_update_not_installing']()
    except HTTPException as exc: assert exc.status_code==409
    else: raise AssertionError('new task accepted during install handoff')
    child.poll=lambda:0
    result=asyncio.run(ns['get_update_status']()); assert result['status']=='ready'
    ns['ensure_update_not_installing']()
    ns['subprocess'].Popen=lambda *a,**kw: (_ for _ in ()).throw(OSError('launch denied'))
    try: asyncio.run(ns['apply_update'](Request()))
    except HTTPException as exc: assert exc.status_code==500
    else: raise AssertionError('launch failure claimed success')
    assert state.snapshot()['status']=='ready' and state.snapshot()['retryable']
`);
});

test("update installation checks existing Harness child and workflow truth without starting an idle bridge", () => {
  pythonContract(fixtures + String.raw`
import ast, asyncio, types
source=Path(sys.path[0])/'server.py'; tree=ast.parse(source.read_text(encoding='utf-8'))
node=next(node for node in tree.body if isinstance(node,ast.AsyncFunctionDef) and node.name=='ensure_harness_update_idle')
ns=dict(globals(),VINIPER_TRANSPORT=types.SimpleNamespace(application_port=None))
exec(compile(ast.Module(body=[node],type_ignores=[]),str(source),'exec'),ns)
asyncio.run(ns['ensure_harness_update_idle']())
calls=[]; snapshot={'subagents':{'active':[]},'workflows':{'runs':[]}}; collaboration={'sessions':[]}
async def control(operation):
    calls.append(operation)
    return snapshot if operation=='harness.snapshot' else collaboration
port=types.SimpleNamespace(_bridge_process=None,control=control); ns['VINIPER_TRANSPORT'].application_port=port
asyncio.run(ns['ensure_harness_update_idle']()); assert not calls
port._bridge_process=types.SimpleNamespace(returncode=None)
snapshot['subagents']['active']=[{'id':'independent-child','status':'running'}]
try: asyncio.run(ns['ensure_harness_update_idle']())
except ValueError as exc: assert '子 Agent' in str(exc)
else: raise AssertionError('background child missed')
snapshot['subagents']['active']=[]; snapshot['workflows']['runs']=[{'status':'running'}]
try: asyncio.run(ns['ensure_harness_update_idle']())
except ValueError: pass
else: raise AssertionError('running workflow missed')
snapshot['workflows']['runs']=[]; collaboration['sessions']=[{'state':'queued'}]
try: asyncio.run(ns['ensure_harness_update_idle']())
except ValueError: pass
else: raise AssertionError('queued delegated session missed')
collaboration['sessions']=[]; asyncio.run(ns['ensure_harness_update_idle']())
async def unavailable(operation): raise RuntimeError('bridge busy')
port.control=unavailable
try: asyncio.run(ns['ensure_harness_update_idle']())
except ValueError as exc: assert '未启动安装器' in str(exc)
else: raise AssertionError('uncertain idle claim accepted')
`);
});

test("update middleware accepts only the actual local origin and tracks in-flight mutations", () => {
  pythonContract(fixtures + String.raw`
import ast, asyncio
from fastapi import HTTPException
from fastapi.responses import JSONResponse
from starlette.requests import Request
source=Path(sys.path[0])/'server.py'; tree=ast.parse(source.read_text(encoding='utf-8'))
names={'guard_update_mutations','ensure_update_not_installing','refresh_update_install_state'}
nodes=[node for node in tree.body if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)) and node.name in names]
for node in nodes: node.decorator_list=[]
ns=dict(globals(),_update_state=UpdateState('1.8.0'),_update_other_mutations=0,_update_installer_process=None,_update_ready=None,
    env_value=lambda key,default:'17963')
exec(compile(ast.Module(body=nodes,type_ignores=[]),str(source),'exec'),ns)
def request(path,origin='http://127.0.0.1:17963'):
    return Request({'type':'http','method':'POST','path':path,'headers':[(b'origin',origin.encode())]})
calls=[]
async def next_call(req):
    calls.append(req.url.path)
    if req.url.path=='/api/settings': assert ns['_update_other_mutations']==1
    return JSONResponse({'ok':True})
for origin in ('http://127.0.0.1:17963','http://localhost:17963'):
    assert asyncio.run(ns['guard_update_mutations'](request('/api/update/check',origin),next_call)).status_code==200
for origin in ('https://evil.example','http://127.0.0.1:17947'):
    assert asyncio.run(ns['guard_update_mutations'](request('/api/update/apply',origin),next_call)).status_code==403
assert calls==['/api/update/check','/api/update/check']
assert asyncio.run(ns['guard_update_mutations'](request('/api/settings'),next_call)).status_code==200
assert ns['_update_other_mutations']==0
ns['_update_state'].set(status='installing')
assert asyncio.run(ns['guard_update_mutations'](request('/api/runs/id'),next_call)).status_code==409
assert '/api/runs/id' not in calls
ns['env_value']=lambda key,default:'17947'; ns['_update_state'].set(status='idle')
assert asyncio.run(ns['guard_update_mutations'](request('/api/update/check','http://127.0.0.1:17947'),next_call)).status_code==200
`);
});
