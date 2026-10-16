import assert from "node:assert/strict";
import test from "node:test";
import { LifecycleInterceptorService } from "../../src/features/composition/lifecycle-interceptors";
import { ManagedHookBridge } from "../../src/features/composition/managed-hooks";
import { RunSteeringService } from "../../src/features/composition/run-steering";

test("CP2：生命周期拦截按 order 执行，短路可解释且故障隔离", async () => {
  const service = new LifecycleInterceptorService();
  const calls: string[] = [];
  service.register({
    id: "late",
    source: "test",
    phase: "provider/pre-request",
    order: 20,
    scope: "run",
    handle: async () => { calls.push("late"); },
  });
  service.register({
    id: "faulty",
    source: "test",
    phase: "provider/pre-request",
    order: 5,
    scope: "run",
    handle: async () => { throw new Error("hook boom"); },
  });
  const stop = service.register({
    id: "stop",
    source: "test",
    phase: "provider/pre-request",
    order: 10,
    scope: "run",
    handle: async () => { calls.push("stop"); return { decision: "reject", reason: "测试阻断" }; },
  });
  const result = await service.dispatch("provider/pre-request", { runId: "run-1", sessionId: "session-1", payload: {} });
  assert.deepEqual(calls, ["stop"]);
  assert.equal(result.decision, "reject");
  assert.equal(result.failures.length, 1);
  stop();
  const afterDispose = await service.dispatch("provider/pre-request", { runId: "run-1", sessionId: "session-1", payload: {} });
  assert.equal(afterDispose.decision, "continue");
  assert.deepEqual(calls, ["stop", "late"]);
});

test("CP2：steer 可唤醒下一步，inject 只在活动运行的 pre-step 消费", () => {
  const service = new RunSteeringService(() => 100);
  service.markRun("run-1", "running");
  const steer = service.steer("run-1", "下一步先检查测试");
  const inject = service.inject("run-1", { source: "fixture", note: "只读上下文" });
  assert.equal(steer.status, "queued");
  assert.equal(steer.wakeRequested, true);
  assert.equal(inject.status, "queued");
  assert.equal(inject.wakeRequested, false);
  const claimed = service.claimForPreStep("run-1");
  assert.deepEqual(claimed.map((item) => item.status), ["delivered", "delivered"]);
  assert.deepEqual(service.claimForPreStep("run-1"), []);
  let interrupted = 0;
  const unbind = service.bindInterrupt("run-1", () => { interrupted++; });
  service.interrupt("run-1");
  assert.equal(interrupted, 0, "a delayed wake must not abort the request already handling delivered guidance");
  service.inject("run-1", { note: "context only" });
  service.interrupt("run-1");
  assert.equal(interrupted, 0, "inject must not interrupt");
  service.steer("run-1", "新的纠正方向");
  service.interrupt("run-1");
  assert.equal(interrupted, 1);
  service.claimForPreStep("run-1");
  unbind();
  service.markRun("run-2", "idle");
  const rejected = service.inject("run-2", { note: "不能唤醒" });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.wakeRequested, false);
  assert.equal(service.clear("run-1").length, 0);
});

test("CP2：兼容 Hook 只能进入白名单生命周期且不拥有 Runtime/工具对象", async () => {
  const lifecycle = new LifecycleInterceptorService();
  const bridge = new ManagedHookBridge(lifecycle);
  let observed: unknown;
  const dispose = bridge.register({
    id: "structured-hook",
    source: "fixture-plugin",
    phase: "run/pre-step",
    invoke: ({ payload }) => { observed = payload; },
  });
  const result = await lifecycle.dispatch("run/pre-step", { runId: "r1", sessionId: "s1", payload: { text: "只读" } });
  assert.equal(result.failures.length, 0);
  assert.deepEqual(observed, { text: "只读" });
  dispose();
  await lifecycle.dispatch("run/pre-step", { runId: "r1", sessionId: "s1", payload: { text: "不应再调用" } });
  assert.deepEqual(observed, { text: "只读" });
});
