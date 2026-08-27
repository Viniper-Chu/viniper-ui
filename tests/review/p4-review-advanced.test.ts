import assert from "node:assert/strict";
import { test } from "node:test";
import { ReviewService } from "../../src/features/review/review-service";

test("P4 review uses a frozen provider snapshot, read-only whitelist and no write-side execution", async () => {
  const service = new ReviewService(() => 123);
  const frozen = { providerId: "fake", profileId: "fake", modelId: "fake-model", permissionMode: "auto" as const, reasoning: "same" };
  let calls = 0;
  let seen: readonly string[] = [];
  const result = await service.run({
    policy: "on",
    changed: true,
    round: 1,
    frozenProvider: frozen,
    evidence: [{ kind: "diff", summary: "bounded", relativePaths: ["src/a.ts"] }],
    execute: async (input) => {
      calls += 1;
      seen = input.allowedToolNames;
      assert.deepEqual(input.frozenProvider, frozen);
      return { text: "PASS\nsuggestion: keep the change focused", usage: { input: 8, output: 2, total: 10 }, cache: { hit: null, miss: null } };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.outcome, "PASS");
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.executionCounts.write, 0);
  assert.equal(result.executionCounts.terminal, 0);
  assert.equal(result.executionCounts.commit, 0);
  assert.equal(result.executionCounts.merge, 0);
  assert.equal(seen.includes("project.read"), true);
  assert.equal(seen.includes("git.diff"), true);
  assert.equal(seen.includes("terminal.run"), false);
  assert.equal(seen.includes("git.commit"), false);
  assert.equal((await service.run({ policy: "on", changed: true, round: 3, frozenProvider: frozen, evidence: [] })).outcome, "REVIEW_STOPPED");
});
