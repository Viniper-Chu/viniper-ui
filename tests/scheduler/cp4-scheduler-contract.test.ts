import assert from "node:assert/strict";
import { test } from "node:test";
import { previewScheduleOccurrences } from "../../src/features/scheduler/scheduler-service";
import { ScheduleDefinition, ScheduleHistoryRecord } from "../../src/core/scheduler-contracts";
import { SchedulerPersistence } from "../../src/core/ports";
import { SessionSnapshot } from "../../src/core/contracts";
import { SchedulerRuntimePort, SchedulerService } from "../../src/features/scheduler/scheduler-service";

class OverlapStore implements SchedulerPersistence {
  definitions: ScheduleDefinition[] = [];
  history: ScheduleHistoryRecord[] = [];
  async loadSchedules() { return { definitions: structuredClone(this.definitions), history: structuredClone(this.history) }; }
  async saveSchedules(definitions: ScheduleDefinition[]) { this.definitions = structuredClone(definitions); }
  async appendScheduleHistory(record: ScheduleHistoryRecord) { this.history.push(structuredClone(record)); }
}

class OverlapRuntime implements SchedulerRuntimePort {
  active = true;
  getSession() { return undefined; }
  async createSession(): Promise<SessionSnapshot> { throw new Error("not used"); }
  async send() { return { accepted: true, queued: false }; }
  hasActiveScheduleRun() { return this.active; }
}

test("CP4 scheduler previews use an IANA zone and keep the first fall-back occurrence", () => {
  const spring = previewScheduleOccurrences(
    { kind: "daily", hour: 2, minute: 30, timeZone: "America/New_York" },
    Date.parse("2026-03-07T10:00:00.000Z"),
    3,
  );
  assert.equal(new Date(spring[0]).toISOString(), "2026-03-08T07:30:00.000Z");

  const fall = previewScheduleOccurrences(
    { kind: "daily", hour: 1, minute: 30, timeZone: "America/New_York" },
    Date.parse("2026-10-31T10:00:00.000Z"),
    1,
  );
  assert.equal(new Date(fall[0]).toISOString(), "2026-11-01T05:30:00.000Z");
});

test("CP4 scheduler exposes three future previews for interval schedules", () => {
  const previews = previewScheduleOccurrences(
    { kind: "interval", everyMs: 5_000 },
    1_000,
    3,
  );
  assert.deepEqual(previews, [6_000, 11_000, 16_000]);
});

test("CP4 scheduler merges same-plan overlap into one pending recovery", async () => {
  const store = new OverlapStore();
  const runtime = new OverlapRuntime();
  const service = new SchedulerService(store, runtime, "D:\\Agent", { now: () => 10_000, setTimeout: () => 1, clearTimeout: () => undefined });
  await service.initialize();
  const session = await service.create({
    name: "重叠",
    prompt: "合并",
    schedule: { kind: "interval", everyMs: 1_000 },
    target: { kind: "new-session" },
  });
  await service.runNow(session.id);
  await service.runNow(session.id);
  await service.runNow(session.id);
  assert.equal(service.snapshot().history.filter((item) => item.status === "pending").length, 1);
  assert.equal(service.snapshot().definitions[0].overlapPending, true);
  service.dispose();
});
