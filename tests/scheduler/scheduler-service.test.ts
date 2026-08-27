import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentIntent, SessionSnapshot } from "../../src/core/contracts";
import { SchedulerPersistence } from "../../src/core/ports";
import { ScheduleDefinition, ScheduleHistoryRecord } from "../../src/core/scheduler-contracts";
import { nextOccurrence, SchedulerClock, SchedulerRuntimePort, SchedulerService } from "../../src/features/scheduler/scheduler-service";
import { createSessionSnapshot } from "../../src/features/sessions/session-factory";

class MemorySchedulerStore implements SchedulerPersistence {
  definitions: ScheduleDefinition[] = [];
  history: ScheduleHistoryRecord[] = [];
  async loadSchedules() { return { definitions: structuredClone(this.definitions), history: structuredClone(this.history) }; }
  async saveSchedules(definitions: ScheduleDefinition[]) { this.definitions = structuredClone(definitions); }
  async appendScheduleHistory(record: ScheduleHistoryRecord) { this.history.push(structuredClone(record)); }
}

class FakeRuntime implements SchedulerRuntimePort {
  readonly sessions = new Map<string, SessionSnapshot>();
  readonly intents: AgentIntent[] = [];
  constructor() { const session = createSessionSnapshot("D:\\Agent", 0); this.sessions.set(session.id, session); }
  getSession(sessionId: string) { return structuredClone(this.sessions.get(sessionId)); }
  async createSession(workingDirectory = "D:\\Agent") { const session = createSessionSnapshot(workingDirectory, 0); this.sessions.set(session.id, session); return structuredClone(session); }
  async send(intent: AgentIntent) { this.intents.push(structuredClone(intent)); return { accepted: true, queued: false }; }
}

class FakeClock implements SchedulerClock {
  private nextId = 0;
  private timers = new Map<number, { at: number; callback: () => void }>();
  constructor(private value: number) {}
  now = () => this.value;
  setTimeout(callback: () => void, delayMs: number) { const id = ++this.nextId; this.timers.set(id, { at: this.value + delayMs, callback }); return id; }
  clearTimeout(handle: unknown) { this.timers.delete(handle as number); }
  async advance(milliseconds: number) {
    this.value += milliseconds;
    const due = [...this.timers.entries()].filter(([, timer]) => timer.at <= this.value);
    for (const [id, timer] of due) { this.timers.delete(id); timer.callback(); }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test("scheduler triggers once, respects pause, supports manual run and avoids recovery storms", async () => {
  const store = new MemorySchedulerStore();
  const runtime = new FakeRuntime();
  const clock = new FakeClock(1_000_000);
  const service = new SchedulerService(store, runtime, "D:\\Agent", clock);
  await service.initialize();
  const sessionId = [...runtime.sessions.keys()][0];

  const once = await service.create({
    name: "单次任务",
    prompt: "只触发一次",
    schedule: { kind: "once", runAt: clock.now() + 1_000 },
    target: { kind: "existing-session", sessionId },
  });
  await clock.advance(1_000);
  await waitFor(() => service.snapshot().history.length === 1);
  await clock.advance(10_000);
  assert.equal(service.snapshot().history.filter((item) => item.scheduleId === once.id).length, 1);
  assert.equal(service.snapshot().definitions.find((item) => item.id === once.id)?.nextRunAt, undefined);
  assert.equal(await service.delete(once.id), true);
  assert.equal(await service.runNow(once.id), false);

  const interval = await service.create({
    name: "间隔任务",
    prompt: "间隔执行",
    schedule: { kind: "interval", everyMs: 2_000 },
    target: { kind: "existing-session", sessionId },
  });
  await service.setEnabled(interval.id, false);
  await clock.advance(4_000);
  assert.equal(service.snapshot().history.some((item) => item.scheduleId === interval.id), false);
  await service.setEnabled(interval.id, true);
  await service.runNow(interval.id);
  assert.equal(service.snapshot().history.some((item) => item.scheduleId === interval.id && item.source === "manual"), true);

  service.dispose();
  const beforeRecovery = store.history.length;
  const laterClock = new FakeClock(clock.now() + 20_000);
  const recovered = new SchedulerService(store, runtime, "D:\\Agent", laterClock);
  await recovered.initialize();
  assert.equal(recovered.snapshot().history.length, beforeRecovery + 1);
  assert.equal(recovered.snapshot().history[0].source, "recovery");
  recovered.dispose();
});

test("scheduler calculates daily and weekly occurrences in local application time", () => {
  const from = new Date(2026, 7, 12, 10, 30, 0, 0);
  assert.equal(
    nextOccurrence({ kind: "daily", hour: 11, minute: 0 }, from.getTime()),
    new Date(2026, 7, 12, 11, 0, 0, 0).getTime(),
  );
  assert.equal(
    nextOccurrence({ kind: "daily", hour: 10, minute: 0 }, from.getTime()),
    new Date(2026, 7, 13, 10, 0, 0, 0).getTime(),
  );

  const weekday = from.getDay();
  assert.equal(
    nextOccurrence({ kind: "weekly", weekday, hour: 11, minute: 0 }, from.getTime()),
    new Date(2026, 7, 12, 11, 0, 0, 0).getTime(),
  );
  assert.equal(
    nextOccurrence({ kind: "weekly", weekday, hour: 10, minute: 0 }, from.getTime()),
    new Date(2026, 7, 19, 10, 0, 0, 0).getTime(),
  );
});

test("scheduler freezes fixed-model and smart-routing choices into the runtime intent", async () => {
  const store = new MemorySchedulerStore();
  const runtime = new FakeRuntime();
  const clock = new FakeClock(2_000_000);
  const service = new SchedulerService(store, runtime, "D:\\Agent", clock);
  await service.initialize();
  const sessionId = [...runtime.sessions.keys()][0];

  const fixed = await service.create({
    name: "固定模型",
    prompt: "检查项目",
    schedule: { kind: "once", runAt: clock.now() + 60_000 },
    target: { kind: "existing-session", sessionId },
    modelSelection: { mode: "fixed", providerId: "deepseek", modelId: "deepseek-chat" },
  });
  assert.equal((await service.runNow(fixed.id)), true);
  assert.deepEqual(runtime.intents.at(-1)?.routing, {
    mode: "fixed",
    providerId: "deepseek",
    modelId: "deepseek-chat",
  });

  const smart = await service.create({
    name: "智能模型",
    prompt: "整理摘要",
    schedule: { kind: "once", runAt: clock.now() + 60_000 },
    target: { kind: "existing-session", sessionId },
    modelSelection: { mode: "smart", strategy: "balanced" },
  });
  assert.equal((await service.runNow(smart.id)), true);
  assert.deepEqual(runtime.intents.at(-1)?.routing, { mode: "smart", strategy: "balanced" });
  assert.deepEqual(store.definitions.find((item) => item.id === smart.id)?.modelSelection, {
    mode: "smart",
    strategy: "balanced",
  });
  service.dispose();
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 500) throw new Error("scheduler test timeout");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
