import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function renderer(){
 const requests:any[]=[];
 const ctx=vm.createContext({URLSearchParams,console,atob,fetch:async(path:string,options:any)=>{requests.push({path,...options});return {ok:true,json:async()=>({ok:true})};}});
 for(const file of ['vendor/markdown-it.js','vendor/katex/katex.min.js','conversation-markdown.js'])vm.runInContext(readFileSync(`resources/viniper-ui/static/${file}`,'utf8'),ctx);
 for(const file of ['api','icons','conversation']){
  const source=readFileSync(`resources/viniper-ui/static/v2/${file}.js`,'utf8').replace(/^import .*;\s*$/gm,'').replace(/\bexport /g,'');
  vm.runInContext(source,ctx);
 }
 return {ctx,requests};
}
test('completed output renders math, collapses thinking and tool receipts, and keeps parameters',()=>{
 const {ctx}=renderer();
 const html=ctx.messageHtml({role:'assistant',content:'结果为 $x^2$。',elapsed_seconds:12,segments:[
  {type:'thinking',content:'先检查已有条件。'},
  {type:'tool_start',call_id:'a',tool_name:'file.sqlite.query',input:{queries:[{sql:'SELECT note FROM notes'}]},status:'running'},
  {type:'tool_result',call_id:'a',tool_name:'file.sqlite.query',content:'<literal>',status:'success'},
 ]});
 assert.match(html,/用时 12 秒/);assert.match(html,/class="katex"/);assert.doesNotMatch(html,/<details[^>]+\bopen\b/);
 assert.equal((html.match(/class="tool-event/g)||[]).length,1);assert.match(html,/SELECT note FROM notes/);
 assert.match(html,/&lt;literal&gt;/);assert.doesNotMatch(html,/执行中|<literal>/);
});
test('completed turns keep intermediate replies in activity details and copy the final reply',()=>{
 const {ctx}=renderer();
 const message={role:'assistant',content:'先检查文件。\n\n完成，结果已验证。',segments:[
  {type:'text',content:'先检查文件。'},
  {type:'tool_result',tool_name:'file.read',status:'success',content:'read result'},
  {type:'text',content:'完成，结果已验证。'},
  {type:'artifact',path:'/task/结果.pdf',status:'success'},
 ]};
 const html=ctx.messageHtml(message),answer=html.split('<div class="answer">')[1].split('</div>')[0];
 assert.doesNotMatch(answer,/先检查/);assert.match(answer,/完成，结果已验证/);
 assert.match(html.split('<div class="answer">')[0],/先检查文件/);
 assert.match(html,/1 条进展/);assert.match(html,/data-copy="完成，结果已验证。"/);
 assert.equal(message.content,'先检查文件。\n\n完成，结果已验证。');
 for(const flags of [{streaming:true},{cancelled:true},{error:'interrupted'}]){
  const partial=ctx.messageHtml({...message,...flags}).split('<div class="answer">')[1].split('</div>')[0];
  assert.match(partial,/先检查文件/);
 }
 const noFinal={...message,segments:message.segments.slice(0,2)};
 assert.match(ctx.messageHtml(noFinal).split('<div class="answer">')[1],/先检查文件/);
});
test('cancelled and failed tools cannot look completed or keep spinning after reload',()=>{
 const {ctx}=renderer();
 for(const [status,label]of [['cancelled','已停止'],['failed','失败'],['interrupted','未完成'],['rejected','已拒绝'],['blocked','受阻']]){
  const html=ctx.toolHtml({type:'tool_start',status,tool_name:'terminal.run'},false);
  assert.match(html,new RegExp(label));assert.doesNotMatch(html,/执行中|已完成/);
 }
 assert.match(ctx.messageHtml({role:'assistant',cancelled:true,content:'已停止',elapsed_seconds:3}),/已停止 · 用时 3 秒/);
});
test('event replay avoids duplicates, reflects exact approvals and receives steering receipts',()=>{
 const {ctx}=renderer();
 const run={sequence:0,sessionId:'s',message:{content:'',thinking:'',segments:[],streaming:true},done:false,interaction:null,steering:null};
 ctx.projectEvent(run,{type:'text',content:'第一次',sequence:1});
 ctx.projectEvent(run,{type:'text',content:'重复',sequence:1});
 ctx.projectEvent(run,{type:'permission_request',call_id:'write-1',run_id:'run-1',sequence:2});
 assert.equal(run.message.content,'第一次');assert.equal((run.interaction as any).call_id,'write-1');
 ctx.projectEvent(run,{type:'permission_resolved',sequence:3});assert.equal(run.interaction,null);
 ctx.projectEvent(run,{type:'steering',receipt:{status:'delivered'},sequence:4});assert.equal((run.steering as any).status,'delivered');
 ctx.projectEvent(run,{type:'done',sequence:5});assert.equal(run.done,true);
 ctx.projectEvent(run,{type:'queue_dispatch',item:{text:'下一个请求'},sequence:6});assert.equal(run.done,false);assert.equal(run.message.content,'');
});
test('relative file links resolve against the current project and discard source-line suffix',async()=>{
 const {ctx,requests}=renderer();vm.runInContext("state.session={workdir:'/tmp/中文项目'}",ctx);
 await ctx.openFile('results/report.pdf:12');
 assert.equal(requests[0].path,'/api/files/open');assert.deepEqual(JSON.parse(requests[0].body),{path:'/tmp/中文项目/results/report.pdf'});
});

test('file result cards preserve complete names, escape content, and deduplicate actual artifact events',()=>{
 const {ctx}=renderer();
 const path="/tmp/中文 项目/练习 O'Brien.docx";
 const html=ctx.messageHtml({role:'assistant',content:'已处理。',segments:[
  {type:'artifact',path,status:'success'},{type:'artifact',path,status:'success'},
  {type:'artifact',path:'/tmp/not-created.pdf',status:'failed'},
 ]});
 assert.equal((html.match(/class="result-file"/g)||[]).length,1);
 assert.match(html,/练习 O&#39;Brien.docx/);assert.match(html,/中文 项目/);
 assert.doesNotMatch(html,/data-file="\/tmp\/not-created/);
 assert.doesNotMatch(html,/测试通过|页面已查看|回读一致/);
});
test('database receipts distinguish submitted transactions, rollback and readback without inventing verification',()=>{
 const {ctx}=renderer();
 const html=ctx.toolHtml({type:'tool_result',tool_name:'file.sqlite.apply',status:'success',content:JSON.stringify({
  transactions:[{status:'committed'},{status:'rolled_back'}],readback:[{columns:['a'],rows:[[0]]}]
 })},false);
 assert.match(html,/1 组事务已提交/);assert.match(html,/1 组事务已回滚/);assert.match(html,/1 项查询已回读/);
 assert.doesNotMatch(html,/回读一致|测试通过/);
 const failed=ctx.toolHtml({type:'tool_result',tool_name:'file.sqlite.apply',status:'error',content:JSON.stringify({transactions:[{status:'committed'}],readback_error:'cannot read'})},false);
 assert.match(failed,/回读未完成/);assert.match(failed,/失败/);
});

test('document result cards show delivery files and keep build copies in execution details',()=>{
 const {ctx}=renderer();
 const files=['/task/学生.pdf','/task/教师.pdf','/task/编译维护/源文件/学生.tex','/task/编译维护/源文件/教师.tex'];
 const html=ctx.messageHtml({role:'assistant',content:'编译完成，页面仍待检查。',segments:[
  {type:'tool_result',tool_name:'file.math.handout',status:'success',presentation:{kind:'document-results',files,
   sourceDirectory:'/task/编译维护/源文件',sourceDependencies:['/task/编译维护/源文件/teacher-page-map.tex'],
   intermediateDirectories:['/task/编译维护/学生编译','/task/编译维护/学生页面'],intermediateFiles:[]}},
  ...[...files,'/task/编译维护/学生编译/学生.pdf','/task/编译维护/学生页面/page-1.png','/task/编译维护/源文件/teacher-page-map.tex','/task/其他.py']
   .map(path=>({type:'artifact',path,status:'success'})),
 ]});
 assert.equal((html.match(/class="result-file"/g)||[]).length,5);
 assert.match(html,/data-file="\/task\/其他.py"/);
 assert.doesNotMatch(html.split('<div class="result-files"')[1],/data-file="[^"]*(?:page-1.png|学生编译)/);
 assert.match(html,/data-file="\/task\/编译维护\/源文件"/);
 assert.match(html,/teacher-page-map.tex/);assert.match(html,/完整 TeX 源码/);
 assert.match(html,/制作师生讲义/);assert.match(html,/>TeX</);
});

test('terminal receipts expose actual output and paged continuation without declaring all work verified',()=>{
 const {ctx}=renderer();
 const html=ctx.toolHtml({type:'tool_result',tool_name:'terminal.run',status:'success',content:'命令完成',presentation:{
  kind:'terminal-run',executionId:'exec-owned',purpose:'test',exitCode:0,durationMs:1500,
  stdout:{preview:'2 assertions passed <literal>',totalBytes:80000,truncated:true},stderr:{preview:'',totalBytes:0,truncated:false}
 }},false);
 assert.match(html,/测试命令 · 退出码 0 · 1.5 秒/);assert.match(html,/2 assertions passed &lt;literal&gt;/);
 assert.match(html,/data-terminal="exec-owned"/);assert.match(html,/读取完整输出/);
 assert.doesNotMatch(html,/所有测试通过|页面已查看|<literal>/);
});
