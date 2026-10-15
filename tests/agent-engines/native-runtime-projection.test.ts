import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("Claude runtime projects real task, child, hook and quota envelopes without mixing answer lanes", () => {
  const script = String.raw`
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path.cwd() / 'resources' / 'viniper-ui'))
from native_stream_protocol import NativeRuntimeProjection, native_control_error
p = NativeRuntimeProjection()
init = p.observe({'type':'system','subtype':'init','model':'fixture','permissionMode':'plan',
    'tools':['Read','Agent'], 'mcp_servers':[{'name':'project','status':'connected','token':'private'}],
    'plugins':[{'name':'fixture','version':'1','account':'private'}], 'apiKey':'private'})
assert init[0]['kind'] == 'capabilities' and p.snapshot()['status']['permission_mode'] == 'plan'
assert 'private' not in json.dumps(p.snapshot())
p.observe({'type':'system','subtype':'task_started','task_id':'a1','tool_use_id':'parent-tool','description':'Review'})
p.observe({'type':'system','subtype':'task_progress','task_id':'a1','usage':{'total_tokens':23,'tool_uses':2,'duration_ms':500,'private':99}})
p.observe({'type':'system','subtype':'task_notification','task_id':'a1','summary':'Reviewed'})
assert p.snapshot()['tasks'][0]['status'] == 'completed'
assert p.snapshot()['tasks'][0]['usage'] == {'total_tokens':23,'tool_uses':2,'duration_ms':500}
p.observe({'type':'assistant','parent_tool_use_id':'parent-tool','message':{'content':[
    {'type':'text','text':'Child answer'}, {'type':'tool_use','id':'read1','name':'Read','input':{'private':'not forwarded'}}]}})
p.observe({'type':'user','parent_tool_use_id':'parent-tool','message':{'content':[
    {'type':'tool_result','tool_use_id':'read1','content':'Done'}]}})
child = p.snapshot()['subagents'][0]
assert child['parent_tool_use_id'] == 'parent-tool' and child['text'] == 'Child answer'
assert child['tools'][0]['status'] == 'completed' and 'input' not in child['tools'][0]
assert p.observe({'type':'assistant','message':{'content':[{'type':'text','text':'Parent answer'}]}}) == []
p.observe({'type':'tool_progress','tool_use_id':'read1','tool_name':'Read','elapsed_time_seconds':2,'parent_tool_use_id':'parent-tool'})
p.observe({'type':'system','subtype':'hook_started','hook_id':'h1','hook_name':'fixture','hook_event':'PreToolUse'})
p.observe({'type':'system','subtype':'hook_progress','hook_id':'h1','stdout':'checking '})
p.observe({'type':'system','subtype':'hook_response','hook_id':'h1','stdout':'done','exit_code':0,'outcome':'success'})
assert p.snapshot()['hooks'][0]['stdout'] == 'checking done'
p.observe({'type':'rate_limit_event','rate_limit_info':{'status':'allowed_warning','rateLimitType':'five_hour','resetsAt':1770000000,'utilization':.87,'account':'private'}})
assert p.snapshot()['rate_limit']['utilization'] == .87
assert 'account' not in json.dumps(p.snapshot())

def call(identity, name, value):
    p.observe({'type':'assistant','message':{'content':[{'type':'tool_use','id':identity,'name':name,'input':value}]}})
def result(identity, structured=None, failed=False):
    return p.observe({'type':'user','tool_use_result':structured or {},'message':{'content':[{'type':'tool_result','tool_use_id':identity,'is_error':failed}]}})
call('create1','TaskCreate',{'subject':'Implement integration','activeForm':'Implementing'})
plan = result('create1', {'task':{'id':'7','subject':'Implement integration','status':'pending'}})
assert plan[0]['kind'] == 'plan' and plan[0]['event']['steps'][0]['id'] == '7'
call('update1','TaskUpdate',{'taskId':'7','status':'in_progress'})
result('update1')
assert p.snapshot()['todos'][0]['status'] == 'in_progress'
call('bad','TaskUpdate',{'taskId':'7','status':'completed'})
assert result('bad', failed=True) == [] and p.snapshot()['todos'][0]['status'] == 'in_progress'
call('delete1','TaskUpdate',{'taskId':'7','status':'deleted'})
assert result('delete1')[0]['event']['steps'] == []
call('list1','TaskList',{})
result('list1', {'tasks':[{'id':'8','subject':'Check','status':'completed'}]})
assert p.snapshot()['todos'][0]['id'] == '8'
p.observe({'type':'system','subtype':'status','status':'compacting','permissionMode':'default'})
restored = NativeRuntimeProjection(json.loads(json.dumps(p.snapshot())))
assert restored.snapshot() == p.snapshot()
restored.observe({'type':'system','subtype':'task_started','task_id':'unfinished'})
restored.finish('cancelled')
assert restored.snapshot()['tasks'][-1]['status'] == 'interrupted'
assert restored.snapshot()['status']['status'] == 'cancelled'
assert native_control_error('unsupported', 'use console')['response'] == {'subtype':'error','request_id':'unsupported','error':'use console'}
print('native lifecycle projection passed')
`;
  const result = spawnSync(process.platform === "win32" ? "py" : "python3", [
    ...(process.platform === "win32" ? ["-3"] : []), "-E", "-c", script,
  ], { encoding: "utf8", timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
