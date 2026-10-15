import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { localSigningConfiguration, designatedRequirement, verifyMacSignature } from './macos-signing.mjs';

export async function prepareMacCredentialHelper(repositoryRoot, configuration) {
  const cache = join(dirname(localSigningConfiguration), 'credential-helper-v1');
  const binary = join(cache, 'viniper-keychain');
  const recordedSource = join(cache, 'source.swift');
  const source = join(repositoryRoot, 'scripts/macos-keychain-helper.swift');
  const content = await readFile(source);
  function run(command, args) {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 300000 });
    if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Credential helper preparation failed');
  }
  let exists = false;
  try { await access(binary); exists = true; } catch {}
  if (exists) {
    if (!(await readFile(recordedSource)).equals(content)) {
      throw new Error('稳定凭据组件源码发生变化。需显式设计凭据迁移后升级组件；普通 UI 更新不能重编译它。');
    }
    verifyMacSignature(binary);
  } else {
    await mkdir(cache, { recursive: true, mode: 0o700 });
    const temporary = join(cache, 'building');
    try {
      run('/usr/bin/xcrun', ['swiftc', '-O', '-suppress-warnings', source, '-o', temporary]);
      run('/usr/bin/codesign', ['--force', '--sign', configuration.identity,
        '--keychain', configuration.keychain, '--identifier', 'com.viniper.workstation.credentials', '--timestamp=none', temporary]);
      verifyMacSignature(temporary);
      await writeFile(recordedSource, content);
      await rename(temporary, binary);
    } finally { await rm(temporary, { force: true }); }
  }
  const requirement = designatedRequirement(binary);
  return { binary, requirement, protocol: 1 };
}
