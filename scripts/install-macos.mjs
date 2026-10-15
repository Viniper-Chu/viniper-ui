import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, readlink, rename, symlink, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { prepareMacPythonEnvironment, activateMacPythonEnvironment } from "./lib/macos-python-runtime.mjs";
import { designatedRequirement, isStableRequirement, verifyMacSignature } from "./lib/macos-signing.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { desktopEnvironment } = require("../resources/viniper-ui/desktop/platform-runtime.js");
if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("安装脚本目前只支持 Apple Silicon Mac。");
const product = "Viniper";
const packageMetadataPath = join(repositoryRoot, "codex", "工作输出", "macos-package", "latest-macos-package.json");
const metadata = JSON.parse(await readFile(packageMetadataPath, "utf8"));
const source = resolve(metadata.appPath);
const destination = join("/Applications", `${product}.app`);
const legacyApplication = "/Applications/Viniper workstation.app";
const previousApplication = existsSync(destination) ? destination : legacyApplication;
if (metadata.appId !== "com.viniper.workstation" || !source.startsWith(join(repositoryRoot, "codex", "工作输出", "macos-package") + "/")) {
  throw new Error("安装元数据与本项目打包目录不匹配。");
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const stagedDestination = join("/Applications", `.Viniper-install-${stamp}.app`);
const backupRoot = join(repositoryRoot, "codex", "工作输出", "macos-install-backups", stamp);
const userData = join(homedir(), "Library", "Application Support", "Viniper workstation");
const venv = join(userData, "runtime", "python");
const pythonPath = join(venv, "bin", "python3");
const env = desktopEnvironment();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repositoryRoot, env, encoding: "utf8", timeout: 300000, ...options });
  if (result.status !== 0) throw new Error(`${command} 失败：${result.stderr || result.stdout || result.error?.message || result.status}`);
  return result.stdout.trim();
}

await access(join(source, "Contents", "MacOS", product));
run("/usr/bin/codesign", ["--verify", "--deep", "--strict", source]);
const sourceRequirement = designatedRequirement(source);
const localRepair = process.argv.includes("--local-repair-adhoc") && metadata.signing === "local-repair-adhoc";
if ((!localRepair && !isStableRequirement(sourceRequirement)) || sourceRequirement !== metadata.signingRequirement) {
  throw new Error("安装包没有可持续的签名身份，未替换现行应用。");
}
if (existsSync(previousApplication)) {
  const existingId = run("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", join(previousApplication, "Contents", "Info.plist")]);
  if (existingId !== metadata.appId) throw new Error("目标目录存在其他应用，未替换。");
  const previousRequirement = designatedRequirement(previousApplication);
  if (isStableRequirement(previousRequirement)) verifyMacSignature(source, previousRequirement);
  const running = run("/bin/ps", ["-axo", "pid=,comm="]);
  if (running.split("\n").some((line) => line.trim().replace(/^\d+\s+/, "").startsWith(previousApplication + "/"))) {
    throw new Error("Viniper 正在运行。请先使用 Command-Q 退出，再重新运行安装命令。");
  }
}

// Dependencies belong to this application, never to system Python or a user's
// existing virtualenv. Application files are replaced only after verification.
await mkdir(join(userData, "runtime"), { recursive: true });
const requirements = join(source, "Contents", "Resources", "viniper-ui", "requirements.txt");
const receiptPath = join(userData, "runtime", "macos-install-receipt.json");
const lockedRequirements = join(userData, "runtime", "python-requirements.lock.txt");
let receipt = {};
try { receipt = JSON.parse(await readFile(receiptPath, "utf8")); } catch {}
const preparedPython = await prepareMacPythonEnvironment({ runtimeRoot: join(userData, "runtime"), requirements, receipt, environment: env, lockedRequirements });

run("/usr/bin/ditto", [source, stagedDestination]);
run("/usr/bin/codesign", ["--verify", "--deep", "--strict", stagedDestination]);
let backupPath = null;
const activatedPython = await activateMacPythonEnvironment(preparedPython, { runtimeRoot: join(userData, "runtime"), backupRoot });
try {
  if (existsSync(previousApplication)) {
    await mkdir(backupRoot, { recursive: true });
    const candidateBackup = join(backupRoot, `${previousApplication === legacyApplication ? "Viniper workstation" : product}.app`);
    await rename(previousApplication, candidateBackup);
    backupPath = candidateBackup;
  }
  await rename(stagedDestination, destination);
}
catch (error) {
  try { if (backupPath) await rename(backupPath, previousApplication); }
  finally { await activatedPython.rollback(); }
  throw error;
}
await writeFile(lockedRequirements, `${preparedPython.freeze}\n`);
const result = {
  status: "MACOS_INSTALLED", installedAt: new Date().toISOString(), version: metadata.version,
  application: destination, dataDirectory: userData, python: pythonPath,
  pythonPolicy: "host-python-dedicated-venv", bundledNode: metadata.node,
  pythonVersion: preparedPython.python.version, pythonBaseExecutable: preparedPython.python.baseExecutable,
  pythonEnvironmentReused: preparedPython.reused, previousPythonEnvironment: activatedPython.previousEnvironment,
  requirements: preparedPython.requirementText, dependencyLock: lockedRequirements,
  previousApplication: backupPath, signing: metadata.signing, signingIdentity: metadata.signingIdentity,
  credentialStorage: metadata.credentialStorage,
  signingRequirement: sourceRequirement, notarized: false,
};
if (process.argv.includes("--desktop-shortcut")) {
  const desktop = join(homedir(), "Desktop");
  const shortcut = join(desktop, `${product}.app`);
  await mkdir(desktop, { recursive: true });
  if (existsSync(shortcut)) {
    let target = "";
    try { target = await readlink(shortcut); } catch {}
    if (target !== destination) throw new Error(`应用已安装；桌面已有同名项目，未覆盖：${shortcut}`);
  } else {
    await symlink(destination, shortcut);
  }
  const legacyShortcut = join(desktop, "Viniper workstation.app");
  try { if (await readlink(legacyShortcut) === legacyApplication) await unlink(legacyShortcut); } catch {}
  result.desktopShortcut = shortcut;
}
await writeFile(receiptPath, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (process.argv.includes("--launch")) run("/usr/bin/open", [destination]);
