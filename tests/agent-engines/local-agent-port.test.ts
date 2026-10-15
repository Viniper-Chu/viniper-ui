import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

test("local deployment works through the real Application Port with scoped tools, manual thinking and JSON", { timeout: 45000 }, async () => {
  const maintenance = join(process.cwd(), "codex", "运行残留"); await mkdir(maintenance, { recursive: true });
  const root = await mkdtemp(join(maintenance, "local-port-"));
  try {
    const result = spawnSync(process.platform === "win32" ? "py" : "python3", [
      ...(process.platform === "win32" ? ["-3"] : []), "-I", "-B", "tests/fixtures/local-agent-port-check.py", root,
    ], { encoding: "utf8", timeout: 40000, maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /"status": "PASS"/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
