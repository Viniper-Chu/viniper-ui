import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { TerminalService } from "../../src/features/terminal/terminal-service";
import { WindowsProcessHost } from "../../src/platform/process/windows-process-host";

const shellCommand = (windows: string, posix: string): string => process.platform === "win32" ? windows : posix;

test("P3-01 distinguishes success, nonzero and command-not-found while separating stdout/stderr", async () => {
  const scene = await terminalFixture();
  try {
    const completed = await scene.service.run({
      command: shellCommand("[Console]::Out.Write('OUT_MARKER'); [Console]::Error.Write('ERR_MARKER')", "printf OUT_MARKER; printf ERR_MARKER >&2"),
      purpose: "test",
    }, scene.context("session-success", "run-success"));
    assert.equal(completed.status, "completed");
    assert.equal(completed.exitCode, 0);
    assert.match(completed.stdout.preview, /OUT_MARKER/u);
    assert.doesNotMatch(completed.stdout.preview, /ERR_MARKER/u);
    assert.match(completed.stderr.preview, /ERR_MARKER/u);
    assert.doesNotMatch(completed.stderr.preview, /OUT_MARKER/u);

    const nonzero = await scene.service.run({
      command: shellCommand("[Console]::Error.Write('EXPECTED_NONZERO'); exit 7", "printf EXPECTED_NONZERO >&2; exit 7"),
      purpose: "test",
    }, scene.context("session-nonzero", "run-nonzero"));
    assert.equal(nonzero.status, "nonzero");
    assert.equal(nonzero.exitCode, 7);
    assert.match(nonzero.stderr.preview, /EXPECTED_NONZERO/u);

    const missing = await scene.service.run({
      command: "phase7_command_that_does_not_exist",
      purpose: "test",
    }, scene.context("session-missing", "run-missing"));
    assert.equal(missing.status, "not-found");
    assert.equal(missing.exitCode, 127);
    assert.doesNotMatch(missing.stderr.preview, /VINIPER_INTERNAL/u);
  } finally {
    await scene.dispose();
  }
});

test(`terminal.run persists ${process.platform === "win32" ? "PowerShell identity metadata" : "native shell identity output"} from the same spawned shell`, async () => {
  const scene = await terminalFixture();
  try {
    const result = await scene.service.run({
      command: shellCommand("[Console]::Out.Write('PS7_IDENTITY_CHECK')",
        "printf 'NATIVE_SHELL_IDENTITY_CHECK:%s:%s:%s\\n' \"$0\" \"$$\" \"${ZSH_VERSION:-${BASH_VERSION:-sh}}\"; /bin/ps -p $$ -o comm=; :"),
      purpose: "test",
    }, scene.context("session-identity", "run-identity"));
    assert.equal(result.status, "completed");
    if (process.platform === "win32") {
      assert.match(result.stdout.preview, /PS7_IDENTITY_CHECK/u);
      assert.equal(result.processIdentity?.edition, "Core");
      assert.equal((result.processIdentity?.major ?? 0) >= 7, true);
      assert.match(result.processIdentity?.executable ?? "", /pwsh(?:\.exe)?$/iu);
    } else {
      assert.match(result.stdout.preview, /NATIVE_SHELL_IDENTITY_CHECK:\/bin\/(?:zsh|bash|sh):\d+:/u);
      if (process.platform === "darwin") {
        assert.match(result.stdout.preview, /NATIVE_SHELL_IDENTITY_CHECK:\/bin\/zsh:\d+:\d+\.\d+/u);
        assert.match(result.stdout.preview.split("\n")[1], /(?:^|\/)zsh(?:\s|$)/u);
      }
      assert.equal(result.processIdentity, undefined, "POSIX identity must not be mislabeled as PowerShell metadata");
    }
    const stored = await readFile(join(scene.managedRoot, "run-identity", result.executionId, "stdout.log"), "utf8");
    assert.equal(stored, result.stdout.preview, "the exact identity observed in the owning shell is persisted");
  } finally {
    await scene.dispose();
  }
});

test("P3-02 streams full output to managed storage and only continues output owned by the same run", async () => {
  const scene = await terminalFixture();
  try {
    const result = await scene.service.run({
      command: shellCommand("$text = 'x' * 70000; [Console]::Out.Write($text)", "node -e 'process.stdout.write(\"x\".repeat(70000))'"),
      purpose: "build",
    }, scene.context("session-large", "run-large"));
    assert.equal(result.status, "completed");
    assert.equal(result.stdout.totalBytes, 70000);
    assert.equal(result.stdout.truncated, true);
    assert.match(result.stdout.ref, /^terminal-output:\/\//u);
    assert.equal(result.stdout.preview.length < 20_000, true);

    const first = await scene.service.output({
      executionId: result.executionId,
      stream: "stdout",
      offset: 0,
      maxBytes: 4096,
    }, scene.context("session-large", "run-large"));
    assert.equal(first.ok, true);
    assert.equal(first.offset, 0);
    assert.equal(first.bytes, 4096);
    assert.equal(first.nextOffset, 4096);
    assert.equal(first.text, "x".repeat(4096));

    const denied = await scene.service.output({
      executionId: result.executionId,
      stream: "stdout",
      offset: 0,
      maxBytes: 4096,
    }, scene.context("session-other", "run-other"));
    assert.equal(denied.ok, false);
    assert.equal(denied.error?.code, "OUTPUT_NOT_OWNED");
    assert.doesNotMatch(JSON.stringify(result), new RegExp(escapeRegExp(scene.managedRoot), "iu"));
  } finally {
    await scene.dispose();
  }
});

test("P3-01 validates project cwd and does not inherit arbitrary secret-like environment variables", async () => {
  const scene = await terminalFixture();
  const previous = process.env.PHASE7_FAKE_PROVIDER_SECRET;
  process.env.PHASE7_FAKE_PROVIDER_SECRET = "MUST_NOT_ENTER_TERMINAL";
  try {
    await mkdir(join(scene.projectRoot, "nested"));
    const result = await scene.service.run({
      command: shellCommand("[Console]::Out.Write([string]$env:PHASE7_FAKE_PROVIDER_SECRET)", "printf '%s' \"$PHASE7_FAKE_PROVIDER_SECRET\""),
      cwd: "nested",
      purpose: "command",
    }, scene.context("session-cwd", "run-cwd"));
    assert.equal(result.status, "completed");
    assert.equal(result.cwd, "nested");
    assert.equal(result.stdout.preview, "");

    const outside = await scene.service.run({
      command: shellCommand("[Console]::Out.Write('MUST_NOT_RUN')", "printf MUST_NOT_RUN"),
      cwd: "..",
      purpose: "command",
    }, scene.context("session-outside", "run-outside"));
    assert.equal(outside.status, "failed");
    assert.equal(outside.error?.code, "CWD_OUTSIDE_PROJECT");
    assert.equal(outside.stdout.totalBytes, 0);
  } finally {
    if (previous === undefined) delete process.env.PHASE7_FAKE_PROVIDER_SECRET;
    else process.env.PHASE7_FAKE_PROVIDER_SECRET = previous;
    await scene.dispose();
  }
});

test("P3-01 timeout is distinct and terminates the owned process", async () => {
  const scene = await terminalFixture();
  try {
    const result = await scene.service.run({
      command: shellCommand("Start-Sleep -Seconds 5; [Console]::Out.Write('TOO_LATE')", "sleep 5; printf TOO_LATE"),
      timeoutMs: 180,
      purpose: "test",
    }, scene.context("session-timeout", "run-timeout"));
    assert.equal(result.status, "timed-out");
    assert.equal(result.exitCode, null);
    assert.doesNotMatch(result.stdout.preview, /TOO_LATE/u);
    assert.equal(result.durationMs < 4_000, true);
  } finally {
    await scene.dispose();
  }
});

test("P3-03 cancelling one run terminates its child tree without stopping another session", async () => {
  const scene = await terminalFixture();
  const secondProject = await mkdtemp(join(scene.residueRoot, "phase7-terminal-project-b-"));
  try {
    const childFixture = [
      "const { spawn } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      "const heartbeat = process.argv[2];",
      "const pidFile = process.argv[3];",
      "const child = spawn(process.execPath, ['-e', \"const fs=require('node:fs');const p=process.argv[1];setInterval(()=>fs.appendFileSync(p,'x'),25)\", heartbeat], { stdio: 'ignore' });",
      "writeFileSync(pidFile, String(child.pid));",
      "setInterval(() => {}, 1000);",
    ].join("\n");
    await writeFile(join(scene.projectRoot, "spawn-child.cjs"), childFixture, "utf8");
    const firstController = new AbortController();
    const firstRun = scene.service.run({
      command: "node spawn-child.cjs heartbeat.txt child.pid",
      timeoutMs: 10_000,
      purpose: "test",
    }, scene.context("session-cancelled", "run-cancelled", firstController.signal));
    await waitForFile(join(scene.projectRoot, "child.pid"));
    await waitForFile(join(scene.projectRoot, "heartbeat.txt"));

    const secondRun = scene.service.run({
      command: shellCommand("Start-Sleep -Milliseconds 450; [Console]::Out.Write('SECOND_SESSION_OK')", "sleep 0.45; printf SECOND_SESSION_OK"),
      timeoutMs: 3_000,
      purpose: "test",
    }, {
      sessionId: "session-survives",
      runId: "run-survives",
      projectRoot: secondProject,
      signal: new AbortController().signal,
    });

    firstController.abort();
    const cancelled = await firstRun;
    const survived = await secondRun;
    assert.equal(cancelled.status, "cancelled");
    assert.equal(survived.status, "completed");
    assert.match(survived.stdout.preview, /SECOND_SESSION_OK/u);

    await new Promise((resolveWait) => setTimeout(resolveWait, 120));
    const firstSize = (await stat(join(scene.projectRoot, "heartbeat.txt"))).size;
    await new Promise((resolveWait) => setTimeout(resolveWait, 260));
    const secondSize = (await stat(join(scene.projectRoot, "heartbeat.txt"))).size;
    assert.equal(secondSize, firstSize, "the child heartbeat stops after cancelling its owning run");
    assert.match(await readFile(join(scene.projectRoot, "child.pid"), "utf8"), /^\d+$/u);
  } finally {
    await rm(secondProject, { recursive: true, force: true });
    await scene.dispose();
  }
});

async function terminalFixture() {
  const residueRoot = resolve(process.cwd(), "codex", "运行残留");
  await mkdir(residueRoot, { recursive: true });
  const dataRoot = await mkdtemp(join(residueRoot, "phase7-terminal-data-"));
  const projectRoot = await mkdtemp(join(residueRoot, "phase7-terminal-project-"));
  const managedRoot = join(dataRoot, "terminal-output");
  const host = new WindowsProcessHost({ managedRoot });
  const service = new TerminalService(host);
  return {
    residueRoot,
    dataRoot,
    projectRoot,
    managedRoot,
    service,
    context: (sessionId: string, runId: string, signal = new AbortController().signal) => ({
      sessionId,
      runId,
      projectRoot,
      signal,
    }),
    dispose: async () => {
      await host.dispose();
      await rm(dataRoot, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    },
  };
}

async function waitForFile(path: string, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  while (true) {
    try {
      await stat(path);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${path}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
