import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

test("Harness child environment honors explicit proxies and bounded WinINET fallback without leaking credentials", () => {
  const root = process.cwd();
  const python = process.platform === "win32" ? "py" : "python3";
  const args = process.platform === "win32" ? ["-3", "-c"] : ["-c"];
  const sourcePath = join(root, "resources", "viniper-ui").replaceAll("\\", "/");
  const script = [
    "import json, sys",
    `sys.path.insert(0, ${JSON.stringify(sourcePath)})`,
    "from harness_application_port import HarnessApplicationPort",
    "def assert_true(value, message):",
    "    if not value: raise AssertionError(message)",
    "explicit = HarnessApplicationPort._child_environment(",
    "    environ={'PATH': 'p', 'HTTP_PROXY': 'http://explicit:8888', 'NO_PROXY': 'localhost'},",
    "    system_proxy={'HTTP_PROXY': 'http://system:7897', 'HTTPS_PROXY': 'http://system:7897', 'NO_PROXY': '127.*'},",
    "    platform='nt',",
    ")",
    "assert_true(explicit.get('HTTP_PROXY') == 'http://explicit:8888', 'explicit proxy did not win')",
    "assert_true('system:7897' not in explicit.get('HTTPS_PROXY', ''), 'system proxy overrode explicit environment')",
    "assert_true(explicit.get('NODE_USE_ENV_PROXY') == '1', 'explicit proxy did not enable Node env proxy')",
    "explicit_without_no_proxy = HarnessApplicationPort._child_environment(",
    "    environ={'PATH': 'p', 'HTTP_PROXY': 'http://explicit:8888'},",
    "    system_proxy={'HTTP_PROXY': 'http://system:7897', 'NO_PROXY': 'system.internal'},",
    "    platform='nt',",
    ")",
    "assert_true(explicit_without_no_proxy.get('HTTP_PROXY') == 'http://explicit:8888', 'explicit proxy without NO_PROXY did not win')",
    "assert_true(all(value in explicit_without_no_proxy.get('NO_PROXY', '') for value in ('localhost', '127.0.0.1', '::1')), 'explicit proxy missing loopback NO_PROXY')",
    "explicit_with_custom_no_proxy = HarnessApplicationPort._child_environment(",
    "    environ={'PATH': 'p', 'HTTP_PROXY': 'http://explicit:8888', 'NO_PROXY': 'corp.internal,localhost'},",
    "    system_proxy={'HTTP_PROXY': 'http://system:7897', 'NO_PROXY': 'system.internal'},",
    "    platform='nt',",
    ")",
    "assert_true('corp.internal' in explicit_with_custom_no_proxy.get('NO_PROXY', ''), 'caller NO_PROXY entry was dropped')",
    "assert_true(all(value in explicit_with_custom_no_proxy.get('NO_PROXY', '') for value in ('localhost', '127.0.0.1', '::1')), 'custom NO_PROXY lost loopback entries')",
    "fallback = HarnessApplicationPort._child_environment(",
    "    environ={'PATH': 'p'},",
    "    system_proxy={'HTTP_PROXY': 'http://127.0.0.1:7897', 'HTTPS_PROXY': 'http://127.0.0.1:7897', 'NO_PROXY': 'localhost;127.*'},",
    "    platform='nt',",
    ")",
    "assert_true(fallback.get('HTTP_PROXY') == 'http://127.0.0.1:7897', 'WinINET HTTP proxy missing')",
    "assert_true(fallback.get('HTTPS_PROXY') == 'http://127.0.0.1:7897', 'WinINET HTTPS proxy missing')",
    "assert_true(fallback.get('ALL_PROXY') == 'http://127.0.0.1:7897', 'WinINET ALL proxy missing')",
    "assert_true(fallback.get('NODE_USE_ENV_PROXY') == '1', 'WinINET fallback did not enable Node env proxy')",
    "assert_true('localhost' in fallback.get('NO_PROXY', '') and '127.' in fallback.get('NO_PROXY', ''), 'loopback NO_PROXY was not retained')",
    "fallback_with_custom_no_proxy = HarnessApplicationPort._child_environment(",
    "    environ={'PATH': 'p', 'NO_PROXY': 'caller.internal'},",
    "    system_proxy={'HTTP_PROXY': 'http://127.0.0.1:7897', 'NO_PROXY': 'system.internal'},",
    "    platform='nt',",
    ")",
    "assert_true('caller.internal' in fallback_with_custom_no_proxy.get('NO_PROXY', '') and 'system.internal' in fallback_with_custom_no_proxy.get('NO_PROXY', ''), 'caller/system NO_PROXY entries were not merged')",
    "disabled = HarnessApplicationPort._child_environment(environ={'PATH': 'p'}, system_proxy={}, platform='nt')",
    "assert_true('HTTP_PROXY' not in disabled and 'NODE_USE_ENV_PROXY' not in disabled, 'disabled proxy unexpectedly enabled')",
    "malformed = HarnessApplicationPort._child_environment(environ={'PATH': 'p'}, system_proxy={'HTTP_PROXY': 'not a url'}, platform='nt')",
    "assert_true('HTTP_PROXY' not in malformed and 'NODE_USE_ENV_PROXY' not in malformed, 'malformed proxy unexpectedly enabled')",
    "non_windows = HarnessApplicationPort._child_environment(environ={'PATH': 'p'}, system_proxy={'HTTP_PROXY': 'http://system:7897'}, platform='posix')",
    "assert_true('HTTP_PROXY' not in non_windows and 'NODE_USE_ENV_PROXY' not in non_windows, 'non-Windows unexpectedly used system proxy')",
    "secret_probe = HarnessApplicationPort._child_environment(environ={'PATH': 'p'}, system_proxy={'HTTP_PROXY': 'http://user:proxy-password@127.0.0.1:7897'}, platform='nt')",
    "assert_true(secret_probe.get('HTTP_PROXY', '').startswith('http://'), 'credential-bearing system proxy was not bounded')",
    "print(json.dumps({'explicit': True, 'fallback': True, 'disabled': True, 'malformed': True, 'non_windows': True, 'stdout_secret_free': True}))",
  ].join("\n");
  const result = spawnSync(python, [...args, script], {
    cwd: root,
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.includes("proxy-password"), false, "proxy credential appeared in test output");
  assert.match(result.stdout, /"stdout_secret_free": true/);
});

test("Node 24 bare fetch does not consume WinINET-only metadata (offline red boundary)", async () => {
  let targetHits = 0;
  let proxyHits = 0;
  const target = createServer((_request, response) => {
    targetHits += 1;
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("target");
  });
  const proxy = createServer((_request, response) => {
    proxyHits += 1;
    response.writeHead(502);
    response.end("proxy");
  });
  await Promise.all([
    new Promise<void>((resolve) => target.listen(0, "127.0.0.1", () => resolve())),
    new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", () => resolve())),
  ]);
  try {
    const targetPort = (target.address() as { port: number }).port;
    const proxyPort = (proxy.address() as { port: number }).port;
    const env = { ...process.env };
    for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "NODE_USE_ENV_PROXY"]) delete env[key];
    env.VINIPER_WININET_PROXY = `http://127.0.0.1:${proxyPort}`;
    const script = "const response = await fetch(process.env.TARGET_URL); if (!response.ok) process.exit(2); await response.text();";
    const result = await runNodeAsync(["--input-type=module", "-e", script], {
      ...env,
      TARGET_URL: `http://127.0.0.1:${targetPort}/probe`,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(targetHits, 1);
    assert.equal(proxyHits, 0);
  } finally {
    await Promise.all([
      new Promise<void>((resolve) => target.close(() => resolve())),
      new Promise<void>((resolve) => proxy.close(() => resolve())),
    ]);
  }
});

function runNodeAsync(args: string[], env: NodeJS.ProcessEnv): Promise<{ status: number | null; stdout: string; stderr: string; error?: Error }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => {
      child.kill();
      resolve({ status: null, stdout, stderr, error: new Error("Node proxy boundary fixture timed out") });
    }, 5_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ status: null, stdout, stderr, error });
    });
    child.once("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}
