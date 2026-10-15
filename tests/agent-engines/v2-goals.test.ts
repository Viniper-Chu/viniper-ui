import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
test('goals and scheduled tasks use the real run coordinator and persist lifecycle',()=>{
 const result=spawnSync(process.platform==='win32'?'py':'python3',[...(process.platform==='win32'?['-3']:[]),'-I','-B','tests/fixtures/v2-goal-check.py'],{encoding:'utf8',timeout:15000});
 assert.equal(result.status,0,result.stderr||result.stdout);assert.match(result.stdout,/V2_GOALS_SCHEDULER_PASS/);
});
