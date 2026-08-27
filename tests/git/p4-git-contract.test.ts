import { strict as assert } from "node:assert";
import { test } from "node:test";
import { LocalGitService } from "../../src/platform/git/local-git-service";

test("P4 Git service exposes structured status/diff/log and explicit branch operations", async () => {
  const git = new LocalGitService();
  assert.ok(git.status);
  assert.ok(git.diff);
  assert.ok(git.log);
  assert.ok(git.createBranch);
  assert.ok(git.commitOwnedPaths);
  assert.ok(git.merge);
});

test("P4 Git service rejects remote and destructive commands before execution", async () => {
  const git = new LocalGitService();
  await assert.rejects(() => git.runRawForTest("reset --hard"), /不允许|禁止/);
  await assert.rejects(() => git.runRawForTest("clean -fd"), /不允许|禁止/);
  await assert.rejects(() => git.runRawForTest("push"), /不允许|禁止/);
});
