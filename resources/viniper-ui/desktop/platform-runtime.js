const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
// Verified against python.org on 2026-09-26. Startup is deliberately offline;
// this is the Mac release baseline, not a live query or a Windows requirement.
const MAC_PYTHON_MINIMUM = "3.14.7";

function desktopEnvironment({ environment = process.env, platform = process.platform, resourcesPath = "", home = os.homedir() } = {}) {
  const env = { ...environment };
  if (platform !== "darwin") return env;
  // Finder launches do not inherit an interactive shell's PATH. Resolve only
  // known executable directories; do not execute a user's shell startup files.
  const candidates = [
    resourcesPath && path.join(resourcesPath, "runtime", "bin"),
    path.join(home, ".local", "bin"),
    "/opt/homebrew/bin", "/usr/local/bin",
    ...(env.PATH || "").split(path.delimiter),
    "/usr/bin", "/bin", "/usr/sbin", "/sbin",
  ];
  env.PATH = [...new Set(candidates.filter(Boolean))].join(path.delimiter);
  env.PYTHONUTF8 = "1";
  env.PYTHONDONTWRITEBYTECODE = "1";
  return env;
}

function pythonCandidates({ platform = process.platform, userData = "", environment = process.env, packaged = false } = {}) {
  const candidates = [];
  if (environment.VINIPER_PYTHON_PATH) candidates.push({ command: environment.VINIPER_PYTHON_PATH, args: [] });
  if (platform === "darwin" && userData) {
    candidates.push({ command: path.join(userData, "runtime", "python", "bin", "python3"), args: [] });
    if (packaged) return candidates;
  }
  if (platform === "win32") candidates.push({ command: "py", args: ["-3"] });
  candidates.push({ command: "python3", args: [] }, { command: "python", args: [] });
  if (platform === "darwin") {
    candidates.push(...["/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/Library/Frameworks/Python.framework/Versions/Current/bin/python3"].map((command) => ({ command, args: [] })));
  }
  return candidates;
}

function comparePythonVersions(left, right) {
  const a = String(left).split(".").map(Number);
  const b = String(right).split(".").map(Number);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return (a[i] || 0) - (b[i] || 0); }
  return 0;
}

function inspectPython(candidate, options = {}) {
  try {
    const probe = spawnSync(candidate.command, [...(candidate.args || []), "-I", "-c", "import json,sys,platform,os; print(json.dumps(dict(executable=sys.executable,version=platform.python_version(),releaseLevel=sys.version_info.releaselevel,baseExecutable=os.path.realpath(getattr(sys,'_base_executable',sys.executable)),prefix=sys.prefix,basePrefix=sys.base_prefix,architecture=platform.machine())))"], {
      env: options.environment || process.env,
      windowsHide: true, encoding: "utf8", timeout: 10000,
    });
    if (probe.status !== 0) return null;
    const info = JSON.parse(String(probe.stdout || "").trim());
    if (!path.isAbsolute(info.executable) || !fs.statSync(info.executable).isFile()
      || !/^\d+\.\d+\.\d+$/u.test(info.version) || !path.isAbsolute(info.baseExecutable)) return null;
    info.venv = info.prefix !== info.basePrefix;
    if (info.venv && (options.platform || process.platform) === "darwin") {
      const config = fs.readFileSync(path.join(info.prefix, "pyvenv.cfg"), "utf8");
      const configuredVersion = config.match(/^version(?:_info)?\s*=\s*(\d+\.\d+\.\d+)/mu)?.[1];
      const configuredExecutable = config.match(/^executable\s*=\s*(.+)$/mu)?.[1]?.trim();
      const configuredHome = config.match(/^home\s*=\s*(.+)$/mu)?.[1]?.trim();
      info.venvBindingMatches = configuredVersion === info.version
        && (configuredExecutable ? fs.realpathSync(configuredExecutable) === info.baseExecutable
          : Boolean(configuredHome && fs.realpathSync(configuredHome) === path.dirname(info.baseExecutable)));
    }
    // Preserve the venv symlink path; realpath would escape its packages.
    return { ...info, command: path.resolve(info.executable), args: [] };
  } catch { return null; }
}

function supportedPython(info, platform = process.platform) {
  return Boolean(info && info.releaseLevel === "final" && (platform !== "darwin" || info.venvBindingMatches !== false)
    && (platform !== "darwin" || [process.arch, process.arch === "arm64" ? "aarch64" : "x86_64"].includes(info.architecture))
    && comparePythonVersions(info.version, platform === "darwin" ? MAC_PYTHON_MINIMUM : "3.10.0") >= 0);
}

function resolvePython(options = {}) {
  const platform = options.platform || process.platform;
  const preferNewest = options.preferNewest ?? platform === "darwin";
  let selected = null;
  for (const candidate of pythonCandidates(options)) {
    const info = inspectPython(candidate, options);
    if (!supportedPython(info, platform)) continue;
    if (!preferNewest) return info;
    if (!selected || comparePythonVersions(info.version, selected.version) > 0) selected = info;
  }
  return selected;
}

function isLocalNavigation(url, baseUrl) {
  try {
    const target = new URL(url);
    return !target.username && !target.password && target.origin === new URL(baseUrl).origin;
  } catch { return false; }
}

function isExternalNavigation(url) {
  try { return ["https:", "http:", "mailto:"].includes(new URL(url).protocol); }
  catch { return false; }
}

function isTrustedRenderer(event, window, baseUrl) {
  if (!window || window.isDestroyed() || event?.sender !== window.webContents) return false;
  if (!event.senderFrame || event.senderFrame !== window.webContents.mainFrame) return false;
  return isLocalNavigation(event.senderFrame.url, baseUrl);
}

async function stopOwnedProcess(child, { platform = process.platform, graceMs = platform === "win32" ? 4000 : 8000, forceMs = 1500 } = {}) {
  if (!child?.pid) return;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  if (platform === "win32") {
    if (child.exitCode !== null) return;
    child.kill();
    const deadline = Date.now() + graceMs;
    while (child.exitCode === null && Date.now() < deadline) await sleep(50);
    if (child.exitCode === null) throw new Error("本地服务尚未退出，请稍后重试。");
    return;
  }
  // Unix servers are started as an owned process group. Never use process
  // names or a port-wide kill: unrelated applications must remain untouched.
  const group = -child.pid;
  const exists = () => {
    try { process.kill(group, 0); return true; }
    catch (error) {
      if (error.code === "ESRCH") return false;
      // Darwin may report EPERM while an owned child is a zombie awaiting
      // Node's SIGCHLD callback. Keep polling so the event loop can reap it;
      // throwing here opens a synchronous error dialog that prevents reaping.
      // This is not proof of exit: the deadline and actual signal errors below
      // remain authoritative, including permission failures for a live group.
      if (platform === "darwin" && error.code === "EPERM") return true;
      throw error;
    }
  };
  const signal = (value) => {
    try { process.kill(group, value); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  if (!exists()) return;
  // Give the Python lifespan hook time to persist and release the Harness.
  if (child.exitCode === null) child.kill("SIGTERM");
  const deadline = Date.now() + graceMs;
  // Python may exit before the Node bridge finishes handling stdin EOF. Give
  // that bridge the same grace period to dispose its detached terminal groups.
  while (exists() && Date.now() < deadline) await sleep(50);
  if (!exists()) return;
  signal("SIGTERM");
  const forceDeadline = Date.now() + forceMs;
  while (exists() && Date.now() < forceDeadline) await sleep(50);
  if (exists()) signal("SIGKILL");
  const finalDeadline = Date.now() + 1000;
  while (exists() && Date.now() < finalDeadline) await sleep(50);
  if (exists()) throw new Error("工作台子进程尚未退出，请稍后重试。");
}

module.exports = { MAC_PYTHON_MINIMUM, desktopEnvironment, pythonCandidates, inspectPython, supportedPython, comparePythonVersions, resolvePython, isLocalNavigation, isExternalNavigation, isTrustedRenderer, stopOwnedProcess };
