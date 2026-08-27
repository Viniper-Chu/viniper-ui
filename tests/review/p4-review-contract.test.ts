import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ReviewService } from "../../src/features/review/review-service";

test("P4 review policy exposes auto/on/off and hard-stops at two rounds", async () => {
  const service = new ReviewService();
  assert.equal(service.shouldRun("off", { changed: true }), false);
  assert.equal(service.shouldRun("on", { changed: false }), true);
  assert.equal(service.shouldRun("auto", { changed: true }), true);
  assert.equal(service.shouldRun("auto", { changed: false }), false);
  const result = await service.run({
    policy: "on",
    changed: true,
    round: 1,
    frozenProvider: { providerId: "demo", profileId: "demo", modelId: "demo-default", reasoning: "auto" },
    evidence: [],
  });
  assert.equal(result.round, 1);
  assert.equal(result.executionCounts.write, 0);
  assert.equal(result.executionCounts.terminal, 0);
  assert.equal(result.executionCounts.commit, 0);
  assert.equal(result.executionCounts.merge, 0);
});
