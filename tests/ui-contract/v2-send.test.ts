import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

test('sending from legacy sessions leaves permission ownership with the backend in chat, plan and goal modes', async () => {
  const source = readFileSync('resources/viniper-ui/static/v2/app.js', 'utf8');
  const send = source.slice(source.indexOf('async function send()'), source.indexOf('function newRun('));
  for (const permission of ['ask', 'review', 'fullAccess']) {
    for (const mode of ['execute', 'plan', 'goal']) {
      const session = {session_id: 'legacy', permission_mode: permission};
      const prompt = {value: '继续这次任务', style: {height: ''}};
      const calls: any[] = [], errors: string[] = [];
      const state = {session, mode, model: 'fixture', reasoning: 'off',
        permission: 'fullAccess', selectedSkills: [], attachments: [],
        drafts: new Map([['legacy', prompt.value]]), runs: new Map(), modelNotice: null};
      const context = vm.createContext({state, busySending: false, switchVersion: 1,
        $: () => prompt, isStopping: () => false, toast: (text: string, error: boolean) => {if (error) errors.push(text);},
        refreshModelNotice: async () => {}, ensureSession: async () => session,
        api: async (path: string, options: any) => {calls.push({path, body: options.body}); return {goal: {id: 'g'}};},
        fetch: async (path: string, options: any) => {
          const body = JSON.parse(options.body); calls.push({path, body});
          return {ok: !body.permission_mode || body.permission_mode === permission,
            headers: {get: () => 'run'}, json: async () => ({detail: '访问权限已变化，请刷新后重试'})};
        },
        newRun: () => ({message: {}}), appendMessage: () => ({}),
        syncComposer: () => {}, bottom: () => {}, consume: async () => {}, refreshGoalBanner: async () => {},
      });
      vm.runInContext(send, context);
      await context.send();
      assert.deepEqual(errors, [], `${permission}/${mode}`);
      assert.equal(prompt.value, '', 'accepted input clears only after acceptance');
      assert.equal(session.permission_mode, permission, 'sending never rewrites legacy controls');
      const request = calls.find(c => c.path === '/api/runs/legacy' || c.path === '/api/goals');
      assert.ok(request);
      assert.equal(Object.hasOwn(request.body, 'permission_mode'), false);
      assert.equal(request.body.reasoning, 'off');
    }
  }
});
