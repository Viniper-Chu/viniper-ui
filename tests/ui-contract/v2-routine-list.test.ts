import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync("resources/viniper-ui/static/v2/tasks.js", "utf8").replace(/^import .*;$/gm, "").replace(/\bexport /g, "");

test("routine labels preserve unsupported calendar semantics and distinguish weekday from month day", () => {
  const ctx = vm.createContext({});
  vm.runInContext(source, ctx);
  for (const [cron, label] of [
    ["5 8 * * 0", "每周日 08:05"], ["5 8 * * 7", "每周日 08:05"],
    ["15 8 1 * *", "每月 1 日 08:15"], ["15 8 1 1 *", "每年 1 月 1 日 08:15"],
    ["7 17 * * 1-5", "工作日 17:07"], ["0 9 1 * 1", "0 9 1 * 1"], ["*/10 * * * *", "*/10 * * * *"],
  ]) assert.equal(ctx.cadence({ cron }), label);
});

test("a pending schedule change is sent only once and a failed change can be retried", async () => {
  const calls: string[] = [];
  let resolve!: () => void, reject!: (e: Error) => void;
  const ctx = vm.createContext({
    state: { view: "chat" }, CSS: { escape: (s: string) => s }, document: { querySelector: () => null },
    ui: { toast: () => {} },
    api: (_path: string, opts: {body: {action: string}}) => {
      calls.push(opts.body.action);
      return new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
    },
  });
  vm.runInContext(source, ctx);
  const action = () => ctx.taskAction("pause", undefined, "only-this-job");
  const first = action();
  await action();
  assert.deepEqual(calls, ["pause"]);
  reject(new Error("offline"));
  await assert.rejects(first, /offline/);
  const retry = action(); resolve(); await retry;
  assert.deepEqual(calls, ["pause", "pause"]);
});
