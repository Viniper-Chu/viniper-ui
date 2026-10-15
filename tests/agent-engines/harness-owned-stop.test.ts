import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("Harness desktop waits for its tool process before capturing a stopped run's files", { timeout: 15000 }, () => {
  const residue = join(process.cwd(), "codex", "运行残留");
  mkdirSync(residue, { recursive: true });
  const root = mkdtempSync(join(residue, "harness-owned-stop-"));
  try {
    const python = process.platform === "win32" ? "py" : "python3";
    const result = spawnSync(python, [...(process.platform === "win32" ? ["-3"] : []), "-B",
      "tests/fixtures/harness-owned-stop-check.py", root], {
      cwd: process.cwd(), encoding: "utf8", timeout: 10000, windowsHide: true,
      env: { PATH: process.env.PATH, HOME: root, USERPROFILE: root, SystemRoot: process.env.SystemRoot, TMPDIR: root },
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PASS: actual child exit precedes final diff/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
