const assert = require("node:assert/strict");
const { test } = require("node:test");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");
const { desktopEnvironment, pythonCandidates, inspectPython, resolvePython, supportedPython, MAC_PYTHON_MINIMUM, isLocalNavigation, isExternalNavigation, isTrustedRenderer, stopOwnedProcess } = require("./platform-runtime");

test("Finder environment finds bundled Node before host tools without executing a shell", () => {
  const original = { PATH: "/usr/bin:/bin", KEEP: "yes" };
  const result = desktopEnvironment({ platform: "darwin", environment: original, resourcesPath: "/Applications/Viniper workstation.app/Contents/Resources", home: "/Users/person" });
  const directories = result.PATH.split(path.delimiter);
  assert.equal(directories[0], "/Applications/Viniper workstation.app/Contents/Resources/runtime/bin");
  assert.ok(directories.includes("/Users/person/.local/bin"));
  assert.equal(new Set(directories).size, directories.length);
  assert.equal(result.KEEP, "yes");
  assert.equal(original.PATH, "/usr/bin:/bin");
  assert.deepEqual(desktopEnvironment({ platform: "win32", environment: original }), original);
});

test("Python resolves an explicit override, then the dedicated Mac environment", () => {
  const candidates = pythonCandidates({ platform: "darwin", userData: "/Users/person/Library/Application Support/Viniper workstation", environment: { VINIPER_PYTHON_PATH: "/opt/python/bin/python3" } });
  assert.equal(candidates[0].command, "/opt/python/bin/python3");
  assert.equal(candidates[1].command, "/Users/person/Library/Application Support/Viniper workstation/runtime/python/bin/python3");
  assert.equal(pythonCandidates({ platform: "win32", environment: {} })[0].command, "py");
  const packaged = pythonCandidates({ platform: "darwin", userData: "/tmp/workstation", environment: {}, packaged: true });
  assert.deepEqual(packaged.map((item) => item.command), ["/tmp/workstation/runtime/python/bin/python3"]);
});

test("Mac Python chooses the newest compatible final release and retains the Windows 3.10 minimum", () => {
  const module = { exports: {} };
  const fixtures = {
    "/older-final": { version: "3.14.7", releaseLevel: "final" },
    python3: { version: "3.15.0rc2", releaseLevel: "candidate" },
    python: { version: "3.14.8", releaseLevel: "final" },
    "/opt/homebrew/bin/python3": { version: "3.16.0", releaseLevel: "alpha" },
    py: { version: "3.10.0", releaseLevel: "final" },
  };
  const calls = [];
  const actualRequire = require;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "platform-runtime.js"), "utf8"), {
    module, process, URL, setTimeout,
    require: (name) => name === "node:child_process" ? { spawnSync: (command, args) => {
      calls.push({ command, args });
      const info = fixtures[command];
      return info ? { status: 0, stdout: JSON.stringify({ ...info, executable: `/fixture/${command.replaceAll("/", "_")}`, baseExecutable: "/fixture/base", prefix: "/fixture", basePrefix: "/fixture", architecture: process.arch }) } : { status: 1 };
    } } : name === "node:fs" ? { statSync: () => ({ isFile: () => true }) } : actualRequire(name),
  });
  const chosen = module.exports.resolvePython({ platform: "darwin", environment: { VINIPER_PYTHON_PATH: "/older-final" } });
  assert.equal(chosen.version, "3.14.8");
  assert.equal(module.exports.resolvePython({ platform: "win32", environment: {} }).version, "3.10.0");
  assert.ok(calls.every((call) => call.args.includes("-I")), "probes must ignore Python startup/environment injection");
  assert.equal(supportedPython({ version: "3.14.6", releaseLevel: "final", architecture: process.arch }, "darwin"), false);
  assert.equal(supportedPython({ version: "3.14.7", releaseLevel: "final", architecture: process.arch, venvBindingMatches: false }, "darwin"), false);
  assert.equal(supportedPython({ version: "3.14.7", releaseLevel: "final", architecture: process.arch === "arm64" ? "x86_64" : "arm64" }, "darwin"), false);
  assert.equal(MAC_PYTHON_MINIMUM, "3.14.7");
});

test("real configured Python probe reports a stable interpreter and preserves its venv path", () => {
  const python = resolvePython({ environment: desktopEnvironment() });
  assert.ok(python, "a supported local Python interpreter is required");
  const inspected = inspectPython({ command: python.command });
  assert.equal(inspected.command, python.command);
  assert.equal(inspected.version, python.version);
  assert.equal(inspected.releaseLevel, "final");
  if (process.platform === "darwin" && inspected.venv) assert.equal(inspected.venvBindingMatches, true);
});

test("navigation uses an exact origin and rejects executable external schemes", () => {
  const origin = "http://127.0.0.1:17947";
  assert.equal(isLocalNavigation(`${origin}/settings`, origin), true);
  assert.equal(isLocalNavigation("http://127.0.0.1:179470/settings", origin), false);
  assert.equal(isLocalNavigation("http://127.0.0.1:17947@evil.example/", origin), false);
  assert.equal(isExternalNavigation("file:///etc/passwd"), false);
  assert.equal(isExternalNavigation("javascript:alert(1)"), false);
  assert.equal(isExternalNavigation("https://github.com/viniper"), true);
});

test("quit cleans an owned server and descendant without touching other processes", { skip: process.platform === "win32", timeout: 10000 }, async () => {
  const fixture = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});process.stdout.write(String(child.pid)+'\\n');setInterval(()=>{},1000);`;
  const server = spawn(process.execPath, ["-e", fixture], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  try {
    const [output] = await once(server.stdout, "data");
    const descendantPid = Number(output.toString().trim());
    assert.ok(descendantPid > 0);
    await stopOwnedProcess(server, { graceMs: 300, forceMs: 300 });
    assert.throws(() => process.kill(descendantPid, 0), { code: "ESRCH" });
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  } finally {
    unrelated.kill();
    try { process.kill(-server.pid, "SIGKILL"); } catch {}
  }
});

test("privileged IPC is limited to the live main frame on the owned origin", () => {
  const frame = { url: "http://127.0.0.1:17947/" };
  const contents = { mainFrame: frame };
  const window = { webContents: contents, isDestroyed: () => false };
  const event = { sender: contents, senderFrame: frame };
  const origin = frame.url;
  assert.equal(isTrustedRenderer(event, window, origin), true);
  assert.equal(isTrustedRenderer({ ...event, senderFrame: { url: frame.url } }, window, origin), false);
  assert.equal(isTrustedRenderer({ ...event, sender: {} }, window, origin), false);
  assert.equal(isTrustedRenderer(event, { ...window, isDestroyed: () => true }, origin), false);
  frame.url = "https://untrusted.example";
  assert.equal(isTrustedRenderer(event, window, origin), false);
});

test("server exit gives the bridge time to dispose its separately grouped terminal", { skip: process.platform === "win32", timeout: 10000 }, async () => {
  const terminalCode = "setInterval(()=>{},1000)";
  const bridgeCode = `const {spawn}=require('node:child_process');const terminal=spawn(process.execPath,['-e',${JSON.stringify(terminalCode)}],{detached:true,stdio:'ignore'});process.stdout.write(String(terminal.pid)+'\\n');process.stdin.resume();process.stdin.once('end',()=>setTimeout(()=>{process.kill(-terminal.pid,'SIGTERM');},150));`;
  const serverCode = `const {spawn}=require('node:child_process');const bridge=spawn(process.execPath,['-e',${JSON.stringify(bridgeCode)}],{stdio:['pipe','pipe','ignore']});bridge.stdout.pipe(process.stdout);setInterval(()=>{},1000);`;
  const server = spawn(process.execPath, ["-e", serverCode], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  let terminalPid;
  try {
    const [output] = await once(server.stdout, "data");
    terminalPid = Number(output.toString().trim());
    await stopOwnedProcess(server, { graceMs: 1200, forceMs: 300 });
    assert.throws(() => process.kill(terminalPid, 0), { code: "ESRCH" });
  } finally {
    try { process.kill(-server.pid, "SIGKILL"); } catch {}
    if (terminalPid) { try { process.kill(-terminalPid, "SIGKILL"); } catch {} }
  }
});

function ownedGroupProbeFixture(probe, signal, onYield = () => {}) {
  let elapsed = 0;
  let yields = 0;
  const signals = [];
  const childSignals = [];
  const child = { pid: 12345, exitCode: null, kill: (value) => { childSignals.push(value); return true; } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "platform-runtime.js"), "utf8"), {
    module, require, URL,
    process: { platform: "darwin", arch: "arm64", env: {}, kill: (pid, value) => {
      assert.equal(pid, -child.pid, "only the exact owned group may be probed or signalled");
      if (value === 0) return probe();
      signals.push(value);
      return signal(value);
    } },
    Date: { now: () => elapsed },
    setTimeout: (callback, milliseconds) => {
      elapsed += milliseconds;
      yields++;
      onYield(child);
      queueMicrotask(callback);
    },
  });
  return { child, signals, childSignals, stop: module.exports.stopOwnedProcess,
    elapsed: () => elapsed, yields: () => yields };
}

test("Darwin owned-group zombie EPERM probe yields until reaped instead of failing or declaring it exited", async () => {
  let probes = 0;
  let reaped = false;
  const fixture = ownedGroupProbeFixture(() => {
    probes++;
    if (reaped) throw Object.assign(new Error("gone"), { code: "ESRCH" });
    if (probes > 1) throw Object.assign(new Error("zombie probe"), { code: "EPERM" });
    return true;
  }, () => { throw new Error("A reaped group must not receive a termination signal"); }, (child) => {
    reaped = true;
    child.exitCode = 0;
  });
  await fixture.stop(fixture.child, { platform: "darwin", graceMs: 100, forceMs: 50 });
  assert.equal(fixture.yields(), 1, "Node must get an event-loop turn to reap the child");
  assert.ok(probes >= 3, "an EPERM probe is not treated as proof of exit");
  assert.deepEqual(fixture.childSignals, ["SIGTERM"]);
  assert.deepEqual(fixture.signals, []);
});

test("Darwin owned-group permission failures on SIGTERM or SIGKILL remain bounded errors", async () => {
  for (const failingSignal of ["SIGTERM", "SIGKILL"]) {
    const denied = Object.assign(new Error(`permission denied: ${failingSignal}`), { code: "EPERM" });
    const fixture = ownedGroupProbeFixture(() => {
      if (failingSignal === "SIGTERM") throw Object.assign(new Error("live group probe denied"), { code: "EPERM" });
      return true;
    }, (signal) => { if (signal === failingSignal) throw denied; return true; });
    await assert.rejects(fixture.stop(fixture.child, { platform: "darwin", graceMs: 100, forceMs: 50 }), (error) => error === denied);
    assert.ok(fixture.elapsed() <= 200);
    assert.equal(fixture.signals.at(-1), failingSignal);
  }
});

test("Darwin owned-group EPERM handling does not suppress other probe errors or change non-Darwin policy", async () => {
  for (const [platform, code] of [["linux", "EPERM"], ["darwin", "EINVAL"]]) {
    const denied = Object.assign(new Error(code), { code });
    const fixture = ownedGroupProbeFixture(() => { throw denied; }, () => true);
    await assert.rejects(fixture.stop(fixture.child, { platform, graceMs: 100, forceMs: 50 }), (error) => error === denied);
    assert.equal(fixture.yields(), 0);
    assert.deepEqual(fixture.childSignals, []);
    assert.deepEqual(fixture.signals, []);
  }
});
