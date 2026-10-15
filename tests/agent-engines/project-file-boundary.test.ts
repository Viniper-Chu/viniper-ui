import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

test("project changes and both file indexes exclude exact application data while retaining user files", { timeout: 20000 }, () => {
  const residue = join(process.cwd(), "codex", "运行残留");
  mkdirSync(residue, { recursive: true });
  const root = mkdtempSync(join(residue, "project-file-boundary-"));
  const script = String.raw`
import os, sys
from pathlib import Path
root=Path(sys.argv[1]).resolve()
project=root/'project'
app_data=project/'application-state-renamed'
os.environ['VINIPER_UI_DATA_DIR']=str(app_data)
os.environ['HOME']=str(root)
sys.path.insert(0,str(Path.cwd()/'resources'/'viniper-ui'))
from fastapi import FastAPI
from fastapi.testclient import TestClient
import server
from native_project_browser import browse_project_files,preview_project_file,ProjectBrowserError

def write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(value,encoding='utf-8')

# Use an arbitrary app directory name: exclude the configured absolute tree,
# not every project folder named data, runtime, or sessions.json.
internal=[app_data/'sessions.json',app_data/'settings.json',app_data/'runtime'/'interaction-state.json']
internal += [app_data/'runtime'/'agent-host'/'acks'/('ack-'+str(index)+'.json') for index in range(16)]
for path in internal: write(path,'{"internal":1}')
ordinary=project/'data'/'sessions.json'
source=project/'src'/'main.py'
deleted=project/'removed.txt'
write(ordinary,'user dataset')
write(source,'print("before")\n')
write(deleted,'old file')
roots=server.file_change_watch_roots(project)
before=server.snapshot_watch_files(roots)
before_text=server.snapshot_watch_text(roots)
assert len(before)==3 and len(before_text)==3
assert os.path.normcase(str(ordinary)) in before and os.path.normcase(str(source)) in before_text
assert all(not Path(path).is_relative_to(app_data) for path in before)
assert server.snapshot_watch_files([app_data])=={} and server.snapshot_watch_text([app_data/'runtime'])=={}
assert server.file_change_watch_roots(app_data)==[]
assert server.file_change_watch_roots(app_data/'runtime')==[]

write(source,'print("after")\n')
deleted.unlink()
artifact=project/'owned-fixture-output.txt'
write(artifact,'real project output')
for path in internal: write(path,'{"internal":2,"newer":true}')
records=server.file_change_records(before,before_text,roots)
assert {row['path']:row['operation'] for row in records}=={
    str(source):'modified',str(artifact):'created',str(deleted):'deleted'},records
assert any('print("after")' in row['diff'] for row in records)
assert all('internal' not in row['diff'] for row in records)

# Exclusions also apply before scanning: a large application tree cannot fill
# the browser scan/result budget and crowd out the real project artifact.
listing=browse_project_files(project,excluded_roots=(app_data,),max_scan_entries=10)
assert {row['path'] for row in listing['entries']}=={'data/sessions.json','src/main.py','owned-fixture-output.txt'},listing
assert browse_project_files(app_data,excluded_roots=(app_data,))['entries']==[]
assert browse_project_files(app_data/'runtime',excluded_roots=(app_data,))['entries']==[]
assert preview_project_file(project,'data/sessions.json',excluded_roots=(app_data,))['content']=='user dataset'
try: preview_project_file(project,'application-state-renamed/sessions.json',excluded_roots=(app_data,))
except ProjectBrowserError: pass
else: raise AssertionError('Internal app records were directly previewed')

# Real route registration proves that handlers actually pass the exclusion,
# including the separate Harness index/search projection.
server.sessions['claude']={'id':'claude','mode':'claude','workdir':str(project),'messages':[]}
server.sessions['viniper']={'id':'viniper','mode':'viniper','workdir':str(project),'messages':[]}
server.BASE_DIR=root/'installed-app'/'resources'
class FixturePort:
    async def control(self,*args,target='',**kwargs):
        rows=[{'path':str(internal[0]),'sizeBytes':12},{'path':'application-state-renamed/runtime/interaction-state.json','sizeBytes':12},
              {'path':'data/sessions.json','sizeBytes':12},{'path':str(artifact),'sizeBytes':12}]
        if target=='project-index.search': return {'results':rows,'source':'fixture-port'}
        return {'explicit':True,'projectRoot':str(project),'records':rows,'status':'ready'}
server.VINIPER_TRANSPORT.application_port=FixturePort()
app=FastAPI()
app.router.routes.extend(route for route in server.app.router.routes if getattr(route,'path',None) in {'/api/project-index','/api/project-file'})
with TestClient(app) as client:
    for suffix in ('','&query=fixture'):
        response=client.get('/api/project-index?session_id=viniper&mode=viniper'+suffix)
        assert response.status_code==200,response.text
        assert {row['path'] for row in response.json()['entries']}=={'data/sessions.json',str(artifact)},response.text
    response=client.get('/api/project-index?session_id=claude&mode=claude')
    assert response.status_code==400,response.text

# File existence, not membership of a bounded text sample, determines changes.
cases=root/'changes';cases.mkdir()
write(cases/'becomes-large.txt','small before\n')
write(cases/'becomes-binary.txt','text before\n')
(cases/'deleted-binary.dat').write_bytes(b'\xff\x00old')
(cases/'invalid-encoding.dat').write_bytes(b'\xffold')
write(cases/'prefix-lines.txt','--old\n')
before=server.snapshot_watch_files([cases]);before_text=server.snapshot_watch_text([cases])
write(cases/'becomes-large.txt','large\n'*60000)
(cases/'becomes-binary.txt').write_bytes(b'\x00new')
(cases/'deleted-binary.dat').unlink()
(cases/'invalid-encoding.dat').write_bytes(b'\xfenewer')
write(cases/'prefix-lines.txt','++new\n')
changes={Path(row['path']).name:row for row in server.file_change_records(before,before_text,[cases])}
assert len(changes)==5,changes
for name in ('becomes-large.txt','becomes-binary.txt','invalid-encoding.dat'):
    assert changes[name]['operation']=='modified' and not changes[name]['available'] and changes[name]['reason'],changes[name]
assert changes['deleted-binary.dat']['operation']=='deleted' and not changes['deleted-binary.dat']['available']
assert changes['prefix-lines.txt']['additions']==1 and changes['prefix-lines.txt']['deletions']==1
print('project data boundary: metadata/text/diff/browser/preview/Harness index/search passed')
`;
  try {
    const result = spawnSync(process.platform === "win32" ? "py" : "python3", [
      ...(process.platform === "win32" ? ["-3"] : []), "-I", "-c", script, root,
    ], {
      cwd: process.cwd(), encoding: "utf8", timeout: 15000,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: root, USERPROFILE: root, TMPDIR: root, VINIPER_UI_PROFILE: "stable" },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /project data boundary:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
