const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const runFile = promisify(execFile);
const PREFIX = 'vpk1:';

function createMacKeychainVault({ helperPath, applicationPath }) {
  let verification;
  async function verify() {
    if (!verification) verification = (async () => {
      const { stdout, stderr } = await runFile('/usr/bin/codesign', ['-d', '-r-', applicationPath]);
      const requirement = `${stdout}\n${stderr}`.match(/^(?:#\s*)?designated => (.+)$/m)?.[1];
      if (!requirement?.includes('identifier "com.viniper.workstation"') || !/\b(anchor|certificate)\s/.test(requirement) || /\bcdhash\b/.test(requirement)) throw new Error('Fixed application signature required');
      const expected = requirement.replace('identifier "com.viniper.workstation"', 'identifier "com.viniper.workstation.credentials"');
      await runFile('/usr/bin/codesign', ['--verify', '--strict', `-R=${expected}`, helperPath]);
    })().catch(error => { verification = null; throw error; });
    return verification;
  }
  async function request(action, value, interaction = true) {
    await verify();
    return new Promise((resolve, reject) => {
      const child = spawn(helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
      let output = ''; let settled = false;
      const timer = setTimeout(() => { child.kill('SIGTERM'); finish(new Error('Keychain authorization timed out')); }, 180000);
      function finish(error, value) { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); }
      child.on('error', error => finish(error));
      child.stdin.on('error', error => finish(error));
      child.stdout.on('data', chunk => { output += chunk; if (output.length > 262144) { child.kill(); finish(new Error('Invalid Keychain response')); } });
      child.stderr.resume();
      child.on('close', code => {
        try { const response = JSON.parse(output); if (code !== 0 || !response.ok) throw new Error(response.error || 'Keychain request failed'); finish(null, response); }
        catch { finish(new Error('Keychain access unavailable')); }
      });
      child.stdin.end(JSON.stringify({ action, value, interaction }));
    });
  }
  return {
    prefix: PREFIX,
    available: async () => (await request('available')).ok,
    encrypt: async value => PREFIX + (await request('encrypt', String(value))).value,
    decrypt: async (encoded, interaction = true) => {
      if (!encoded.startsWith(PREFIX)) throw new Error('Unsupported credential format');
      return (await request('decrypt', encoded.slice(PREFIX.length), interaction)).value;
    },
  };
}
module.exports = { createMacKeychainVault, PREFIX };
