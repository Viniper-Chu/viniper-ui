import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("Harness desktop preserves tool effects and durable results across success, failure, cancellation and missing credentials", { timeout: 20000 }, () => {
  const residue = join(process.cwd(), "codex", "运行残留");
  mkdirSync(residue, { recursive: true });
  const root = mkdtempSync(join(residue, "harness-projection-"));
  try {
    const python = process.platform === "win32" ? "py" : "python3";
    const result = spawnSync(python, [...(process.platform === "win32" ? ["-3"] : []), "-B",
      "tests/fixtures/harness-transport-check.py", root], { cwd: process.cwd(), encoding: "utf8", timeout: 15000, windowsHide: true });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PASS: actual Harness projection/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
