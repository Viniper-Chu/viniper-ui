import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionSnapshot } from "../../src/core/contracts";
import { enqueueIntent, takeNextIntent } from "../../src/features/queue/intent-queue";

test("queued intents preserve the host-owned memory gate for the next run", () => {
  const session = { queue: [] } as unknown as SessionSnapshot;
  const queue = enqueueIntent(session, "下一条", 42, { kind: "user" }, { memoryEnabled: false });
  const { next, remaining } = takeNextIntent({ ...session, queue });

  assert.equal(next?.memoryEnabled, false);
  assert.deepEqual(remaining, []);
});
