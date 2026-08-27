import assert from "node:assert/strict";
import { test } from "node:test";
import { ProviderEvent, ProviderRequest } from "../../src/core/provider-contracts";
import { CoordinationService } from "../../src/features/coordination/coordination-service";
import { ModelProvider } from "../../src/features/providers/model-provider";
import { createRuntimeFixture, waitFor } from "../runs/runtime-fixture";

class OverlapProbeProvider implements ModelProvider {
  readonly descriptor = {
    id: "coordination-overlap-probe",
    name: "Coordination Overlap Probe",
    label: "Coordination Overlap Probe · 本地",
    configuration: "demo" as const,
    available: true,
    realCallsEnabled: false,
    capabilities: ["streaming"],
    models: [{ id: "overlap-probe-model", label: "Overlap Probe Model" }],
  };
  readonly activeSessions = new Set<string>();
  maxActive = 0;
  private release!: () => void;
  private readonly released = new Promise<void>((resolve) => { this.release = resolve; });

  async *stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    this.activeSessions.add(request.sessionId);
    this.maxActive = Math.max(this.maxActive, this.activeSessions.size);
    try {
      await Promise.race([this.released, abortPromise(signal)]);
      if (signal.aborted) throw new Error("Overlap probe cancelled");
      yield { kind: "text.delta", text: `并行完成：${request.sessionId}` };
    } finally {
      this.activeSessions.delete(request.sessionId);
    }
  }

  releaseRemaining(): void { this.release(); }
}

test("message, delegation, result and wait use envelopes without sharing ordinary history", async () => {
  const fixture = await createRuntimeFixture();
  const coordination = new CoordinationService(fixture.store, fixture.runtime);
  await coordination.initialize();
  try {
    const source = fixture.runtime.snapshot().sessions[0];
    const target = await fixture.runtime.createSession();

    const message = await coordination.sendMessage(source.id, target.id, "只进入收件箱");
    assert.equal(message.status, "delivered");
    assert.equal(coordination.snapshot().envelopes.find((envelope) => envelope.id === message.id)?.revision, 2);
    assert.equal(coordination.snapshot().unreadBySession.find((item) => item.sessionId === target.id)?.count, 1);
    assert.equal(fixture.runtime.getSession(source.id)?.messages.length, 0);
    assert.equal(fixture.runtime.getSession(target.id)?.messages.length, 0);
    assert.equal(await coordination.markRead(target.id, message.id), true);
    assert.equal(coordination.snapshot().envelopes.find((envelope) => envelope.id === message.id)?.revision, 3);

    const cancellableWait = await coordination.waitForMessage(source.id, {
      fromSessionId: target.id,
      envelopeType: "delegation",
    });
    assert.equal(cancellableWait.waiting, true);
    assert.equal(await coordination.cancelWait(source.id), true);
    assert.equal(fixture.runtime.getSession(source.id)?.waitingFor, undefined);

    const delegation = await coordination.delegateTask(source.id, target.id, "请完成委派任务");
    assert.equal(coordination.snapshot().envelopes.find((envelope) => envelope.id === delegation.id)?.revision, 2);
    const waiting = await coordination.waitForMessage(source.id, {
      fromSessionId: target.id,
      envelopeType: "result",
      correlationId: delegation.id,
    });
    assert.equal(waiting.waiting, true);
    assert.equal(fixture.runtime.getSession(source.id)?.status, "waiting");

    await waitFor(() => coordination.snapshot().envelopes.some(
      (envelope) => envelope.type === "result" && envelope.correlationId === delegation.id,
    ), 2400);
    await waitFor(() => fixture.runtime.getSession(source.id)?.waitingFor === undefined);

    const snapshot = coordination.snapshot();
    assert.equal(snapshot.envelopes.find((envelope) => envelope.id === delegation.id)?.status, "completed");
    assert.equal(snapshot.envelopes.find((envelope) => envelope.id === delegation.id)?.revision, 3);
    assert.equal(snapshot.envelopes.filter((envelope) => envelope.type === "result" && envelope.correlationId === delegation.id).length, 1);
    assert.equal(fixture.runtime.getSession(target.id)?.messages.some((item) => item.text === "请完成委派任务"), true);
    assert.equal(fixture.runtime.getSession(source.id)?.messages.some((item) => item.text === "请完成委派任务"), false);
  } finally {
    coordination.dispose();
    await fixture.dispose();
  }
});

test("R15 Strong-0 rejects cross-engine message, delegation and wait routes", async () => {
  const fixture = await createRuntimeFixture();
  const coordination = new CoordinationService(fixture.store, fixture.runtime);
  await coordination.initialize();
  try {
    const viniper = fixture.runtime.snapshot().sessions[0];
    const claude = await fixture.runtime.createSession("D:\\Agent", undefined, "claude-code");
    await assert.rejects(
      coordination.sendMessage(viniper.id, claude.id, "must not cross"),
      /ENGINE_COORDINATION_MISMATCH/u,
    );
    await assert.rejects(
      coordination.delegateTask(viniper.id, claude.id, "must not cross"),
      /ENGINE_COORDINATION_MISMATCH/u,
    );
    await assert.rejects(
      coordination.waitForMessage(viniper.id, { fromSessionId: claude.id }),
      /ENGINE_COORDINATION_MISMATCH/u,
    );
    assert.equal(coordination.snapshot().envelopes.length, 0);
    assert.equal(fixture.runtime.getSession(viniper.id)?.waitingFor, undefined);
    assert.equal(fixture.runtime.getSession(claude.id)?.waitingFor, undefined);
  } finally {
    coordination.dispose();
    await fixture.dispose();
  }
});

test("different sessions run concurrently and cancelling one does not affect the other", async () => {
  const fixture = await createRuntimeFixture();
  try {
    const provider = new OverlapProbeProvider();
    fixture.runtime.providerRegistry().register(provider);
    const first = fixture.runtime.snapshot().sessions[0];
    const second = await fixture.runtime.createSession();
    for (const session of [first, second]) {
      assert.equal(await fixture.runtime.setProviderModel(session.id, provider.descriptor.id, "overlap-probe-model"), true);
    }
    await Promise.all([
      fixture.runtime.send({ sessionId: first.id, text: "并行 A", attachments: [], selectedModel: "overlap-probe-model", permissionMode: first.permissionMode }),
      fixture.runtime.send({ sessionId: second.id, text: "并行 B", attachments: [], selectedModel: "overlap-probe-model", permissionMode: second.permissionMode }),
    ]);
    await waitFor(() => provider.activeSessions.size === 2);
    assert.equal(provider.maxActive, 2, "both Provider streams must overlap; a global serial queue cannot satisfy this oracle");
    assert.equal(await fixture.runtime.cancel(first.id), true);
    await waitFor(() => !provider.activeSessions.has(first.id));
    assert.equal(provider.activeSessions.has(second.id), true);
    assert.equal(fixture.runtime.isRunning(second.id), true, "cancelling one session must not cancel the overlapping session");
    provider.releaseRemaining();
    await waitFor(() => fixture.runtime.getSession(second.id)?.status === "idle");
    assert.equal(fixture.runtime.getSession(first.id)?.events.some((event) => event.type === "run.cancelled"), true);
    assert.equal(fixture.runtime.getSession(second.id)?.events.some((event) => event.type === "run.completed"), true);
    assert.equal(fixture.telemetry.snapshot().sessions.length, 2);
  } finally {
    await fixture.dispose();
  }
});

test("wait filters are correlation-safe, time out, and only the target can consume results", async () => {
  let now = 10_000;
  const fixture = await createRuntimeFixture();
  const coordination = new CoordinationService(fixture.store, fixture.runtime, () => now);
  await coordination.initialize();
  try {
    const source = fixture.runtime.snapshot().sessions[0];
    const target = await fixture.runtime.createSession();
    const stranger = await fixture.runtime.createSession();
    const delegation = await coordination.delegateTask(source.id, target.id, "完成相关任务");
    const wait = await coordination.waitForMessage(source.id, {
      fromSessionId: target.id,
      envelopeType: "result",
      correlationId: `${delegation.id}-wrong`,
      timeoutMs: 20,
    });
    assert.equal(wait.waiting, true);
    assert.equal(await coordination.cancelWait(stranger.id, wait.wait?.id), false, "unrelated session cannot cancel the owner wait");
    await waitFor(
      () => fixture.runtime.getSession(source.id)?.waitingFor === undefined,
      2400,
    );
    assert.equal(fixture.runtime.getSession(source.id)?.waitingFor, undefined, "expired wait must clear after its persisted state transition");

    await waitFor(() => coordination.snapshot().envelopes.some((item) => item.type === "result" && item.correlationId === delegation.id), 2400);
    const result = coordination.snapshot().envelopes.find((item) => item.type === "result" && item.correlationId === delegation.id)!;
    assert.equal(await coordination.readEnvelope(stranger.id, result.id), undefined, "wrong session cannot consume a result");
    const consumed = await coordination.readEnvelope(source.id, result.id);
    assert.equal(consumed?.status, "read");
    assert.equal(await coordination.readEnvelope(source.id, result.id).then((item) => item?.id), result.id, "re-reading is idempotent");
    now += 100;
  } finally {
    coordination.dispose();
    await fixture.dispose();
  }
});

function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new Error("Overlap probe cancelled"));
      return;
    }
    signal.addEventListener("abort", () => reject(new Error("Overlap probe cancelled")), { once: true });
  });
}
