import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("math discussion routes mentions, shares the first answer, and stops after failure or cancellation", () => {
  const windows = process.platform === "win32";
  const result = spawnSync(windows ? "py" : "python3", [
    ...(windows ? ["-3"] : []), "-I", "-B", "tests/fixtures/discussion-check.py"
  ], { encoding: "utf8", timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
});
