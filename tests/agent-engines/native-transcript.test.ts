import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

test("native terminal handoff imports only new records from the owned Claude transcript and preserves tools", () => {
  const result = spawnSync(process.platform === "win32" ? "py" : "python3", [
    ...(process.platform === "win32" ? ["-3"] : []), "-E", "-c", `
import sys,json,tempfile
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(join(process.cwd(), "resources/viniper-ui"))})
from native_transcript import transcript_path,checkpoint,project_since
sid='8d805f37-31b6-40a0-9808-adc6990c67a6'
residue=Path.cwd()/'codex'/'运行残留';residue.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(dir=residue) as temp:
    config=Path(temp)/'config'; project=Path(temp)/'含 空格';project.mkdir()
    path=transcript_path(str(project),sid,str(config));path.parent.mkdir(parents=True)
    def row(role,content,identity,**extra):
        return {'type':role,'sessionId':sid,'uuid':identity,'message':{'role':role,'content':content,'model':'native-fixture'},**extra}
    path.write_text(json.dumps(row('user','old user text','old'))+'\\n')
    mark=checkpoint(str(project),sid,str(config))
    rows=[row('user','new native input','u1'),row('assistant',[{'type':'text','text':'Native reply'},{'type':'tool_use','id':'tool-1','name':'Read','input':{'file_path':'demo.txt'}}],'a1'),
          row('user',[{'type':'tool_result','tool_use_id':'tool-1','content':'real tool output'}],'r1'),
          row('assistant','private child text','child',isSidechain=True),
          row('assistant','different session text','foreign',sessionId='00000000-0000-4000-8000-000000000000')]
    with path.open('a') as stream:
        for item in rows: stream.write(json.dumps(item)+'\\n')
        stream.write('not-json\\n')
    projected=project_since(mark)
    assert len(projected['messages'])==2,projected
    assert projected['messages'][0]['content']=='new native input'
    assert projected['messages'][1]['content']=='Native reply'
    assert projected['messages'][1]['segments'][-1]['type']=='tool_result'
    assert projected['messages'][1]['segments'][-1]['tool_id']=='tool-1'
    assert 'old user text' not in str(projected) and 'private child text' not in str(projected)
    assert 'different session text' not in str(projected)
    assert project_since(checkpoint(str(project),sid,str(config)))['messages']==[]
    mark=checkpoint(str(project),sid,str(config))
    duplicate=row('assistant','one visible message','same-id')
    with path.open('a') as stream:
        stream.write((json.dumps(duplicate)+'\\n')*2)
    assert [item['native_uuid'] for item in project_since(mark)['messages']]==['same-id']
    mark=checkpoint(str(project),sid,str(config))
    # Native /rewind may rewrite the same inode and produce a longer file.
    # Keep prior desktop history intact, importing only new owned UUIDs.
    replacement=row('assistant','new after rewind '+('long '*700),'after-rewrite')
    path.write_text(json.dumps(duplicate)+'\\n'+json.dumps(replacement)+'\\n')
    rewritten=project_since(mark)
    assert rewritten['rewritten'] and not rewritten['truncated'],rewritten
    assert [item['native_uuid'] for item in rewritten['messages']]==['after-rewrite']
    mark=checkpoint(str(project),sid,str(config))
    replaced=path.with_suffix('.replacement')
    replaced.write_text(json.dumps(row('assistant','replaced file','new-inode'))+'\\n')
    replaced.replace(path)
    rewritten=project_since(mark)
    assert rewritten['rewritten'] and [item['native_uuid'] for item in rewritten['messages']]==['new-inode']
    for invalid in ('../escape','--resume other','not-uuid'):
        try: transcript_path(str(project),invalid,str(config))
        except ValueError: pass
        else: raise AssertionError('accepted invalid session id')
print('owned transcript import passed')
`,
  ], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
