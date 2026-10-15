import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const root = process.cwd();
const requireRuntime = createRequire(join(root, "resources", "viniper-ui", "desktop", "package.json"));
const { desktopEnvironment, inspectPython, resolvePython } = requireRuntime("./platform-runtime.js");
const load = () => Function("url", "return import(url)")(pathToFileURL(join(root, "scripts", "lib", "macos-python-runtime.mjs")).href);

test("Mac Python reuse rejects version drift, changed base interpreter and changed dependency contract", async () => {
  const { canReusePython } = await load();
  const current = { version: "3.14.7", releaseLevel: "final", architecture: process.arch, venv: true,
    venvBindingMatches: true, baseExecutable: "/python/3.14.7/bin/python3.14" };
  const receipt = { pythonVersion: current.version, pythonBaseExecutable: current.baseExecutable, requirements: "fastapi\n" };
  assert.equal(canReusePython(current, current, receipt, "fastapi\n"), true);
  assert.equal(canReusePython(current, { ...current, version: "3.14.8" }, receipt, "fastapi\n"), false);
  assert.equal(canReusePython(current, { ...current, baseExecutable: "/other-python/3.14.7/bin/python3.14" }, receipt, "fastapi\n"), false);
  assert.equal(canReusePython({ ...current, venvBindingMatches: false }, current, receipt, "fastapi\n"), false);
  assert.equal(canReusePython(current, current, { ...receipt, pythonBaseExecutable: "/different/base/python" }, "fastapi\n"), false);
  assert.equal(canReusePython(current, current, receipt, "fastapi\nhttpx\n"), false);
});

test("real Mac Python venv upgrade stages offline, preserves script paths, reuses a valid environment and rolls back", {
  skip: process.platform !== "darwin", timeout: 60000,
}, async () => {
  const { prepareMacPythonEnvironment, activateMacPythonEnvironment } = await load();
  const residue = join(root, "codex", "运行残留");
  await mkdir(residue, { recursive: true });
  const fixture = await mkdtemp(join(residue, "python-runtime-upgrade-"));
  try {
    const runtimeRoot = join(fixture, "runtime");
    const currentPath = join(runtimeRoot, "python");
    const environment = { ...desktopEnvironment(), HOME: fixture, PIP_NO_INDEX: "1", PIP_DISABLE_PIP_VERSION_CHECK: "1" };
    const selected = resolvePython({ environment, preferNewest: true });
    assert.ok(selected);
    environment.VINIPER_PYTHON_PATH = selected.command;
    const created = spawnSync(selected.command, ["-I", "-m", "venv", "--without-pip", currentPath], { env: environment, encoding: "utf8" });
    assert.equal(created.status, 0, created.stderr);
    const marker = join(currentPath, "owned-previous-environment.txt");
    await writeFile(marker, "must survive a failed upgrade and rollback");
    const cfgPath = join(currentPath, "pyvenv.cfg");
    const originalConfig = await readFile(cfgPath, "utf8");
    await writeFile(cfgPath, originalConfig.replace(/^version\s*=.*$/mu, "version = 3.13.0"));
    assert.equal(inspectPython({ command: join(currentPath, "bin", "python3") }, { environment }).venvBindingMatches, false,
      "detect a venv whose base interpreter has changed since creation");
    const requirements = join(fixture, "requirements.txt");
    await writeFile(requirements, "");
    const receipt = { pythonVersion: "3.13.0", requirements: "" };
    const prepared = await prepareMacPythonEnvironment({ runtimeRoot, requirements, receipt, environment, verifyImports: ["json", "venv"] });
    assert.equal(prepared.reused, false);
    assert.equal(prepared.python.version, selected.version);
    assert.equal(await readFile(marker, "utf8"), "must survive a failed upgrade and rollback");
    const beforeActivation = inspectPython({ command: join(currentPath, "bin", "python3") }, { environment });
    assert.equal(beforeActivation.venvBindingMatches, false, "preparation cannot replace the old environment");
    const activated = await activateMacPythonEnvironment(prepared, { runtimeRoot, backupRoot: join(fixture, "backup") });
    assert.equal(inspectPython({ command: join(currentPath, "bin", "python3") }, { environment }).venvBindingMatches, true);
    const pipScript = await readFile(join(prepared.environmentPath, "bin", "pip"), "utf8");
    assert.ok(pipScript.includes(prepared.environmentPath), "the venv stays at its original permanent path after activation");
    const pip = spawnSync(join(currentPath, "bin", "pip"), ["--version"], { env: environment, encoding: "utf8" });
    assert.equal(pip.status, 0, pip.stderr);
    const preparedDirectories = await readdir(join(runtimeRoot, "python-environments"));
    const reused = await prepareMacPythonEnvironment({ runtimeRoot, requirements,
      receipt: { pythonVersion: prepared.python.version, pythonBaseExecutable: prepared.python.baseExecutable, requirements: "" },
      environment, verifyImports: ["json", "venv"] });
    assert.equal(reused.reused, true);
    assert.deepEqual(await readdir(join(runtimeRoot, "python-environments")), preparedDirectories);
    await activated.rollback();
    assert.equal(await readFile(marker, "utf8"), "must survive a failed upgrade and rollback");
    assert.equal(inspectPython({ command: join(currentPath, "bin", "python3") }, { environment }).venvBindingMatches, false);

    await writeFile(requirements, "viniper-definitely-nonexistent-offline-fixture-package==0\n");
    await assert.rejects(prepareMacPythonEnvironment({ runtimeRoot, requirements, receipt, environment, verifyImports: ["json"] }), /No matching distribution|Could not find/u);
    assert.equal(await readFile(marker, "utf8"), "must survive a failed upgrade and rollback");
    assert.equal(inspectPython({ command: join(currentPath, "bin", "python3") }, { environment }).venvBindingMatches, false);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
