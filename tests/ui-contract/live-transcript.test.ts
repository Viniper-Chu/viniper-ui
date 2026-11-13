import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

test('session snapshots retain stream boundaries and expose matching local protection without changing it', async () => {
  const maintenance = join(process.cwd(), 'codex', '运行残留');
  await mkdir(maintenance, {recursive:true});
  const root = await mkdtemp(join(maintenance, 'live-transcript-'));
  try {
    const result = spawnSync(process.platform === 'win32' ? 'py' : 'python3', [
      ...(process.platform === 'win32' ? ['-3'] : []), '-I', '-B', 'tests/fixtures/live-transcript-check.py', root,
    ], {encoding:'utf8', timeout:10000});
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /PASS: stream snapshots/);
    assert.match(result.stdout, /PASS: matching local protection/);
  } finally { await rm(root, {recursive:true,force:true}); }
});
