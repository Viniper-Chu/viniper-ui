import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source=readFileSync('resources/viniper-ui/static/v2/app.js','utf8');
function fixture() {
  const a={id:'a',name:'当前会话',pinned:false},b={id:'b',name:'另一会话',pinned:false};
  const state:any={sessions:[a,b],session:{...a,session_id:'a'},runs:new Map(),drafts:new Map([['a','未发送草稿']]),view:'chat'};
  const calls:any[]=[],dialogs:any[]=[],notices:any[]=[];
  const title={textContent:a.name};
  const ctx=vm.createContext({state,escape:(s:string)=>s, $:()=>title,
    dialog:(...args:any[])=>dialogs.push(args),toast:(...args:any[])=>notices.push(args),
    api:async(path:string,options:any)=>{
      calls.push({path,...options});const id=path.split('/').at(-1);
      if(options.method==='PUT')Object.assign(state.sessions.find((s:any)=>s.id===id),options.body);
      else state.sessions=state.sessions.filter((s:any)=>s.id!==id);
    },loadSessions:async()=>{},showMenu:()=>{},sessionMenuContent:()=>'',
  });
  vm.runInContext(source.slice(source.indexOf('function sessionTarget('),source.indexOf('async function showPlan(')),ctx);
  return {ctx,state,calls,dialogs,notices,title};
}
test('sidebar rename keeps the clicked target even when another conversation is selected',async()=>{
  const f=fixture();await f.ctx.rename('b');
  assert.match(f.dialogs[0][1],/另一会话/);
  await f.dialogs[0][2].onSubmit(new Map([['name',' 新名称 ']]));
  assert.equal(f.calls[0].path,'/api/sessions/b');assert.equal(f.calls[0].body.name,'新名称');
  assert.equal(f.state.session.session_id,'a');assert.equal(f.title.textContent,'当前会话');
  assert.equal(f.state.drafts.get('a'),'未发送草稿');
});
test('pin and unpin persist the target value without switching the active conversation',async()=>{
  const f=fixture();await f.ctx.pinSession('b');await f.ctx.pinSession('b');
  assert.deepEqual(f.calls.map(x=>[x.path,x.body.pinned]),[['/api/sessions/b',true],['/api/sessions/b',false]]);
  assert.equal(f.state.session.session_id,'a');assert.equal(f.state.drafts.get('a'),'未发送草稿');
});
test('sidebar deletion is confirmed for the clicked target and running sessions remain protected',async()=>{
  const f=fixture();await f.ctx.deleteSession('b');
  assert.equal(f.calls.length,0);assert.match(f.dialogs[0][1],/另一会话/);
  await f.dialogs[0][2].onSubmit();
  assert.equal(f.calls[0].path,'/api/sessions/b');assert.equal(f.calls[0].method,'DELETE');
  assert.equal(f.state.session.session_id,'a');assert.equal(f.state.drafts.get('a'),'未发送草稿');
  f.state.runs.set('a',{active:true});await f.ctx.deleteSession('a');
  assert.equal(f.dialogs.length,1);assert.equal(f.calls.length,1);assert.match(f.notices[0][0],/先停止/);
});
test('session menus carry explicit identities and disable only running deletion',()=>{
  const f=fixture();let menus=readFileSync('resources/viniper-ui/static/v2/menus.js','utf8');
  menus=menus.slice(menus.indexOf('export function option('),menus.indexOf('export function menuContent(')).replaceAll('export ','');
  vm.runInContext(menus,vm.createContext(Object.assign(f.ctx,{icon:()=>'<svg></svg>'})));
  f.state.runs.set('b',{active:true});
  const html=f.ctx.sessionMenuContent({id:'b',name:'其他',pinned:true});
  assert.match(html,/取消置顶/);assert.equal((html.match(/data-value="b"/g)||[]).length,3);
  assert.match(html,/data-menu-action="delete-session"[^>]*disabled/);
  assert.doesNotMatch(html,/data-menu-action="rename"[^>]*disabled/);
});
