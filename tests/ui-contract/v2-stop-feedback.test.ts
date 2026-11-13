import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

test('Stop exposes pending state before acknowledgement and suppresses duplicate clicks', async () => {
  const source = readFileSync('resources/viniper-ui/static/v2/app.js','utf8');
  const stop = source.slice(source.indexOf('async function stop()'),source.indexOf('async function permissionAnswer('));
  const run:any = {active:true,message:{streaming:true,content:''}};
  let calls=0, paints=0, syncs=0, resolve!:()=>void;
  const pending = new Promise<void>(r=>resolve=r);
  const ctx=vm.createContext({state:{session:{session_id:'owned'},runs:new Map([['owned',run]])},
    isStopping:()=>run.stopRequested, paintRun:()=>paints++,syncComposer:()=>syncs++,
    api:()=>{calls++;return pending;},
  });
  vm.runInContext(stop,ctx);
  const request=ctx.stop();
  assert.equal(run.stopRequested,true);assert.equal(run.message.stopping,true);
  assert.equal(run.active,true,'pending acknowledgement is not a terminal state');
  assert.equal(paints,1);assert.equal(syncs,1);
  await ctx.stop();assert.equal(calls,1);
  resolve();await request;
  assert.equal(run.active,true);assert.equal(run.stopRequested,true);
});

test('a failed stop request restores the controls and preserves the answer',async()=>{
  const source = readFileSync('resources/viniper-ui/static/v2/app.js','utf8');
  const stop=source.slice(source.indexOf('async function stop()'),source.indexOf('async function permissionAnswer('));
  const run:any={active:true,message:{content:'已生成的回答'}};
  const ctx=vm.createContext({state:{session:{session_id:'owned'},runs:new Map([['owned',run]])},
    isStopping:()=>run.stopRequested,paintRun:()=>{},syncComposer:()=>{},api:async()=>{throw new Error('offline');},
  });
  vm.runInContext(stop,ctx);
  await assert.rejects(ctx.stop(),/offline/);
  assert.equal(run.stopRequested,false);assert.equal(run.message.stopping,false);
  assert.equal(run.message.content,'已生成的回答');assert.equal(run.active,true);
});

test('a new run starts with its own phase and ignores a previous stop acknowledgement',()=>{
  const source=readFileSync('resources/viniper-ui/static/v2/app.js','utf8');
  const ctx=vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('const phases ='),source.indexOf('function signal(')),ctx);
  const local={active:true,runId:'new'};
  const previous={active:false,run_id:'old',activity_phase:'output',cancel_requested:true};
  assert.equal(ctx.activePhase(local,previous),'starting');
  assert.equal(ctx.activePhase(local,{...previous,active:true}),'starting');
  assert.equal(ctx.activePhase(local,{active:true,run_id:'new',activity_phase:'context'}),'context');
});
