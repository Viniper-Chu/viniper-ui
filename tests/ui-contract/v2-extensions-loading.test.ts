import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

test('local skills render while plugins are pending; a plugin failure stays local', async () => {
  const nodes: Record<string, any> = Object.fromEntries(['#extension-search', '#plugin-list', '#skill-list'].map(id => [id, { value: '', innerHTML: '' }]));
  const pending: Array<{path: string; resolve(value: unknown): void; reject(error: Error): void}> = [];
  const state: any = { session: null, skills: [], plugins: [] };
  const context = vm.createContext({ state, AbortSignal, document: { querySelector: (id: string) => nodes[id] },
    query: () => 'mode=viniper', escape: (v: unknown) => String(v), icon: () => '',
    api: (path: string) => new Promise((resolve, reject) => pending.push({path, resolve, reject})),
  });
  const source = readFileSync('resources/viniper-ui/static/v2/pages.js', 'utf8').replace(/^import .*;\s*$/gm, '').replace(/\bexport /g, '');
  vm.runInContext(source, context);
  const loading = context.loadExtensions();
  pending.find(p => p.path.includes('/skills?'))!.resolve({ skills: [{id: 'local', name: '已读取的本机技能'}] });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(nodes['#skill-list'].innerHTML, /已读取的本机技能/);
  assert.match(nodes['#plugin-list'].innerHTML, /正在读取工具插件/);
  pending.find(p => p.path.includes('/plugins?'))!.reject(new Error('busy Runtime'));
  await loading;
  assert.match(nodes['#plugin-list'].innerHTML, /重新加载/);
  assert.match(nodes['#skill-list'].innerHTML, /已读取的本机技能/);

  pending.length = 0;
  const earlier = context.loadExtensions();
  const newer = context.loadExtensions();
  pending[2].resolve({skills:[{id:'new',name:'当前刷新'}]});
  pending[3].resolve({plugins:[]});
  await newer;
  pending[0].resolve({skills:[{id:'stale',name:'过期刷新'}]});
  pending[1].resolve({plugins:[]});
  await earlier;
  assert.match(nodes['#skill-list'].innerHTML, /当前刷新/);
  assert.doesNotMatch(nodes['#skill-list'].innerHTML, /过期刷新/);
});

test('extension filters and search reflect the loaded catalog without discarding either source', () => {
  const nodes: Record<string, any> = Object.fromEntries([
    '#extension-search', '#plugin-list', '#skill-list', '#plugins-section', '#skills-section', '#plugin-count', '#skill-count',
  ].map(id => [id, { value: '', innerHTML: '', hidden: false, textContent: '' }]));
  const buttons = ['all', 'plugins', 'skills'].map(value => ({
    dataset: { extensionFilter: value }, checked: '',
    setAttribute(_name: string, value: string) { this.checked = value; },
  }));
  const state: any = { extensionFilter: 'skills', extensionStatus: { skills: 'ready', plugins: 'ready' },
    plugins: [{ id: 'code', name: '代码工具' }],
    skills: [{ id: 'math', name: '数学材料' }, { id: 'docs', name: '文档整理' }],
  };
  const context = vm.createContext({ state, document: {
    querySelector: (id: string) => nodes[id], querySelectorAll: () => buttons,
  }, escape: (v: unknown) => String(v), icon: () => '' });
  const source = readFileSync('resources/viniper-ui/static/v2/pages.js', 'utf8').replace(/^import .*;\s*$/gm, '').replace(/\bexport /g, '');
  vm.runInContext(source, context);
  context.renderExtensions();
  assert.equal(nodes['#plugins-section'].hidden, true);
  assert.equal(nodes['#skills-section'].hidden, false);
  assert.equal(nodes['#skill-count'].textContent, '2 项');
  assert.equal(buttons[2].checked, 'true');
  nodes['#extension-search'].value = '数学';
  context.renderExtensions();
  assert.match(nodes['#skill-list'].innerHTML, /数学材料/);
  assert.doesNotMatch(nodes['#skill-list'].innerHTML, /文档整理/);
  assert.equal(nodes['#skill-count'].textContent, '1 项');
  nodes['#extension-search'].value = '没有匹配';
  context.renderExtensions();
  assert.match(nodes['#skill-list'].innerHTML, /试试其他关键词/);
  assert.equal(nodes['#skill-count'].textContent, '0 项');
  state.extensionFilter = 'all'; nodes['#extension-search'].value = '';
  context.renderExtensions();
  assert.equal(nodes['#plugins-section'].hidden, false);
  assert.match(nodes['#plugin-list'].innerHTML, /代码工具/);
  assert.match(nodes['#skill-list'].innerHTML, /文档整理/);
});
