import assert from "node:assert/strict";
import { test } from "node:test";
import { NotificationService } from "../../src/features/notifications/notification-service";

test("CP4 notification delivery failure preserves canonical in-app state and hides lock-screen body", async () => {
  const requests: Array<{ title: string; body?: string; sound: boolean; lockScreenBody: boolean }> = [];
  const service = new NotificationService({
    deliver: async (request) => { requests.push(request); throw new Error("adapter unavailable"); },
    now: () => 123,
  });
  const notification = await service.notify({
    kind: "approval-waiting",
    title: "等待批准",
    body: "不应进入锁屏正文",
    sessionId: "s",
    runId: "r",
  });
  assert.equal(notification.delivery, "failed");
  assert.equal(service.snapshot().items.length, 1);
  assert.equal(requests[0].sound, false);
  assert.equal(requests[0].lockScreenBody, false);
  assert.equal(requests[0].body, undefined);
});

test("CP4 ordinary status stays app-only", async () => {
  let calls = 0;
  const service = new NotificationService({ deliver: async () => { calls += 1; }, now: () => 1 });
  const notification = await service.notify({ kind: "ordinary-status", title: "运行中", body: "内部状态" });
  assert.equal(notification.delivery, "app-only");
  assert.equal(calls, 0);
});
