import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

test("Harness long streams, pending permissions and shared-bridge cancellation keep their owners", () => {
  const python = process.platform === "win32" ? "py" : "python3";
  const result = spawnSync(python, [
    ...(process.platform === "win32" ? ["-3"] : []), "-B",
    join(process.cwd(), "tests", "agent-engines", "harness-idle-timeout.py"),
  ], { cwd: process.cwd(), encoding: "utf8", timeout: 10_000, windowsHide: true });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
