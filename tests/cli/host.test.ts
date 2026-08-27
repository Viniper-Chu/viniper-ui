import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { defaultCliDataRoot, parseCliHostArguments } from "../../src/platform/cli/main";
import { acquireDataRootLease, DataRootBusyError } from "../../src/platform/persistence/data-root-lease";

test("CLI host extracts an explicit data root without changing the run contract", () => {
  const parsed = parseCliHostArguments([
    "--data-root", "D:\\Agent\\codex\\运行残留\\cli-test",
    "run", "--prompt", "本地任务", "--json",
  ]);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.dataRoot, resolve("D:\\Agent\\codex\\运行残留\\cli-test"));
  assert.deepEqual(parsed.value.invocationArguments, ["run", "--prompt", "本地任务", "--json"]);
  assert.equal(parsed.value.output, "jsonl");
});

test("P1-01 CLI host extracts an explicit project before the Provider run contract", () => {
  const parsed = parseCliHostArguments([
    "--project", "D:\\Agent",
    "run", "--prompt", "读取项目", "--jsonl",
  ]);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const value = parsed.value as typeof parsed.value & { projectRoot: string };
  assert.equal(value.projectRoot, resolve("D:\\Agent"));
  assert.deepEqual(parsed.value.invocationArguments, ["run", "--prompt", "读取项目", "--jsonl"]);
});

test("P1-01 CLI defaults to cwd and accepts equals-form project without forwarding it to the command parser", () => {
  const defaulted = parseCliHostArguments(["--help"]);
  assert.equal(defaulted.ok && defaulted.value.projectRoot, process.cwd());

  const explicit = parseCliHostArguments(["--project=D:\\Agent", "run", "--prompt", "读取项目"]);
  assert.equal(explicit.ok, true);
  if (!explicit.ok) return;
  assert.equal(explicit.value.projectRoot, resolve("D:\\Agent"));
  assert.deepEqual(explicit.value.invocationArguments, ["run", "--prompt", "读取项目"]);

  const duplicate = parseCliHostArguments(["--project=D:\\Agent", "--project", "D:\\Other"]);
  assert.equal(duplicate.ok, false);
});

test("CLI host recognizes explicit plain and JSONL aliases before application startup", () => {
  const plain = parseCliHostArguments(["run", "--prompt", "本地任务", "--plain"]);
  assert.equal(plain.ok && plain.value.output, "plain");
  const jsonl = parseCliHostArguments(["run", "--prompt", "本地任务", "--jsonl"]);
  assert.equal(jsonl.ok && jsonl.value.output, "jsonl");
});

test("CLI host restores output flags that npm exposes through npm_config variables", () => {
  const plain = parseCliHostArguments([], { npm_config_plain: "true" });
  assert.equal(plain.ok && plain.value.output, "plain");
  assert.deepEqual(plain.ok && plain.value.invocationArguments, ["--plain"]);
  const jsonl = parseCliHostArguments(["run", "--prompt", "任务"], { npm_config_jsonl: "true" });
  assert.equal(jsonl.ok && jsonl.value.output, "jsonl");
  assert.deepEqual(jsonl.ok && jsonl.value.invocationArguments, ["run", "--prompt", "任务", "--jsonl"]);
});

test("CLI honors the npm_config_data_root channel used by an equals-form npm argument", () => {
  assert.equal(
    defaultCliDataRoot({ npm_config_data_root: "D:\\Agent\\codex\\运行残留\\npm-root" }, "win32"),
    resolve("D:\\Agent\\codex\\运行残留\\npm-root"),
  );
});

test("data-root lease rejects a second active writer and permits reuse after release", async () => {
  const outputRoot = resolve(process.cwd(), "codex", "工作输出", "cli-preview");
  await mkdir(outputRoot, { recursive: true });
  const dataRoot = await mkdtemp(join(outputRoot, "lease-"));
  const first = await acquireDataRootLease(dataRoot, "桌面端测试");
  try {
    await assert.rejects(
      () => acquireDataRootLease(dataRoot, "CLI 测试"),
      (error: unknown) => error instanceof DataRootBusyError && /拒绝/u.test(error.message),
    );
  } finally {
    await first.release();
  }
  const second = await acquireDataRootLease(dataRoot, "CLI 测试");
  await second.release();
  await rm(dataRoot, { recursive: true, force: true });
});
