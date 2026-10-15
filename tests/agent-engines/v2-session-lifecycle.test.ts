import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('deleted desktop conversations stay deleted across queue and skill polling; only explicit actions create sessions',()=>{
  const residue=join(process.cwd(),'codex','运行残留');mkdirSync(residue,{recursive:true});
  const root=mkdtempSync(join(residue,'v2-session-lifecycle-'));
  try {
    const result=spawnSync(process.platform==='win32'?'py':'python3',[...(process.platform==='win32'?['-3']:[]),'-I','-B','tests/fixtures/v2-session-lifecycle-check.py',root],{encoding:'utf8',timeout:15000});
    assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/V2_SESSION_LIFECYCLE_PASS/);
  } finally {rmSync(root,{recursive:true,force:true});}
});
