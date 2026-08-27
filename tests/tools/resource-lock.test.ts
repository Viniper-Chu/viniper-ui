import assert from "node:assert/strict";
import { test } from "node:test";

interface ResourceLease { release(): void }
interface ResourceCoordinator {
  acquire(
    claims: Array<{ key: string; access: "read" | "write" }>,
    signal: AbortSignal,
  ): Promise<ResourceLease>;
}

function coordinator(): ResourceCoordinator {
  const loaded = require("../../src/features/tools/resource-lock") as {
    ToolResourceCoordinator: new () => ResourceCoordinator;
  };
  return new loaded.ToolResourceCoordinator();
}

test("P2-03 two sessions serialize the same path while unrelated paths can proceed", async () => {
  const locks = coordinator();
  const signal = new AbortController().signal;
  const first = await locks.acquire([{ key: "D:\\project\\same.txt", access: "write" }], signal);
  let sameEntered = false;
  let otherEntered = false;
  const same = locks.acquire([{ key: "D:\\project\\same.txt", access: "write" }], signal)
    .then((lease) => { sameEntered = true; return lease; });
  const other = locks.acquire([{ key: "D:\\project\\other.txt", access: "write" }], signal)
    .then((lease) => { otherEntered = true; return lease; });

  await Promise.resolve();
  assert.equal(sameEntered, false);
  assert.equal(otherEntered, true);
  (await other).release();
  first.release();
  (await same).release();
  assert.equal(sameEntered, true);
});

test("P2-03 directory/file overlap conflicts and cancellation releases queued ownership", async () => {
  const locks = coordinator();
  const first = await locks.acquire(
    [{ key: "D:\\project\\src", access: "write" }],
    new AbortController().signal,
  );
  const controller = new AbortController();
  const queued = locks.acquire(
    [{ key: "D:\\project\\src\\index.ts", access: "read" }],
    controller.signal,
  );
  controller.abort();
  await assert.rejects(queued, /取消|cancel/i);
  first.release();

  const after = await locks.acquire(
    [{ key: "D:\\project\\src\\index.ts", access: "write" }],
    new AbortController().signal,
  );
  after.release();
});
