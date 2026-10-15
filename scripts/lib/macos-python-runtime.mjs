import { spawnSync } from "node:child_process";
import { lstat, mkdir, readFile, rename, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";

const require = createRequire(import.meta.url);
const { MAC_PYTHON_MINIMUM, inspectPython, resolvePython, supportedPython } = require("../../resources/viniper-ui/desktop/platform-runtime.js");

function commandRunner(environment) {
  return (command, args) => {
    const result = spawnSync(command, args, { env: environment, encoding: "utf8", timeout: 300000 });
    if (result.status !== 0) throw new Error(`${command} 失败：${result.stderr || result.stdout || result.error?.message || result.status}`);
    return result.stdout.trim();
  };
}

export function canReusePython(current, selected, receipt, requirements) {
  return Boolean(supportedPython(current, "darwin") && current.venv && selected && current.version === selected.version
    && current.baseExecutable === selected.baseExecutable
    && (!receipt.pythonBaseExecutable || receipt.pythonBaseExecutable === current.baseExecutable)
    && (!receipt.pythonVersion || receipt.pythonVersion === current.version)
    && receipt.requirements === requirements);
}

export async function prepareMacPythonEnvironment({
  runtimeRoot, requirements, receipt = {}, environment = process.env,
  lockedRequirements = join(runtimeRoot, "python-requirements.lock.txt"),
  verifyImports = ["fastapi", "uvicorn", "httpx"],
}) {
  const run = commandRunner(environment);
  const currentPath = join(runtimeRoot, "python", "bin", "python3");
  const current = inspectPython({ command: currentPath }, { environment });
  const selected = resolvePython({ platform: "darwin", userData: dirname(runtimeRoot), environment, preferNewest: true });
  if (!selected) throw new Error(`需要 Python ${MAC_PYTHON_MINIMUM} 或更新的稳定版；未更改现有运行环境。`);
  const requirementText = await readFile(requirements, "utf8");
  const verify = (python) => {
    run(python, ["-I", "-c", `import ${verifyImports.join(",")}; print('Python dependencies ready')`]);
    run(python, ["-I", "-m", "pip", "check"]);
  };
  if (canReusePython(current, selected, receipt, requirementText)) {
    try {
      verify(current.command);
      return { reused: true, environmentPath: join(runtimeRoot, "python"), python: current,
        requirementText, freeze: run(current.command, ["-I", "-m", "pip", "freeze"]) };
    } catch { /* Prepare a new environment; never repair a live one in place. */ }
  }

  // The environment remains at its permanent path after activation. Moving a
  // freshly-created venv would break absolute pip/uvicorn script shebangs.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const environmentPath = join(runtimeRoot, "python-environments", `python-${selected.version}-${stamp}`);
  await mkdir(dirname(environmentPath), { recursive: true });
  run(selected.command, ["-I", "-m", "venv", environmentPath]);
  const python = inspectPython({ command: join(environmentPath, "bin", "python3") }, { environment });
  if (!supportedPython(python, "darwin") || python.version !== selected.version) {
    throw new Error("新 Python 环境版本与所选稳定版不符；未更改现有环境。");
  }
  const sameMinor = current?.version.split(".").slice(0, 2).join(".") === python.version.split(".").slice(0, 2).join(".");
  const dependencyFile = sameMinor && receipt.requirements === requirementText && existsSync(lockedRequirements)
    ? lockedRequirements : requirements;
  run(python.command, ["-I", "-m", "pip", "install", "--disable-pip-version-check", "-r", dependencyFile]);
  verify(python.command);
  return { reused: false, environmentPath, python, requirementText,
    freeze: run(python.command, ["-I", "-m", "pip", "freeze"]) };
}

async function existsEvenIfBroken(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

export async function activateMacPythonEnvironment(prepared, { runtimeRoot, backupRoot }) {
  if (prepared.reused) return { previousEnvironment: null, rollback: async () => {} };
  const root = resolve(runtimeRoot);
  if (!resolve(prepared.environmentPath).startsWith(join(root, "python-environments") + sep)) {
    throw new Error("拒绝激活非应用管理的 Python 环境。");
  }
  const target = join(root, "python");
  const stagedLink = join(root, `.python-link-${Date.now()}`);
  const previousEnvironment = await existsEvenIfBroken(target) ? join(backupRoot, "python") : null;
  await mkdir(backupRoot, { recursive: true });
  await symlink(prepared.environmentPath, stagedLink);
  if (previousEnvironment) await rename(target, previousEnvironment);
  try { await rename(stagedLink, target); }
  catch (error) {
    if (previousEnvironment) await rename(previousEnvironment, target);
    throw error;
  }
  return { previousEnvironment, rollback: async () => {
    await rename(target, join(backupRoot, "rejected-python-link"));
    if (previousEnvironment) await rename(previousEnvironment, target);
  } };
}
