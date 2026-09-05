import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { AgentMessage, RuntimeEvent } from "../../src/core/contracts";
import { ProviderEvent, ProviderHistoryEntry, ProviderRequest } from "../../src/core/provider-contracts";
import { ModelProvider } from "../../src/features/providers/model-provider";
import { createHarnessApplication } from "../../src/platform/bootstrap/create-harness-application";
import { createRuntimeClient, startRuntimeOwner } from "../../src/platform/runtime-host/local-runtime-host";
import { UnavailableSecretVault } from "../../src/platform/security/unavailable-secret-vault";
import { waitFor } from "../runs/runtime-fixture";

const outputRoot = join(process.cwd(), "codex", "运行残留");

test("one data root exposes one Runtime owner and a revisioned local IPC client", async () => {
  const root = await freshRoot("cp2-owner-");
  const bundle = await createHarnessApplication({
    dataRoot: root,
    workingDirectory: process.cwd(),
    assetsRoot: process.cwd(),
    secretVault: new UnavailableSecretVault(),
  });
  const owner = await startRuntimeOwner({ dataRoot: root, service: bundle.application, ownerId: "fixture-owner" });
  const client = await createRuntimeClient(root);
  try {
    const before = await client.getSnapshot();
    const created = await client.createSession();
    const after = await client.getSnapshot();
    assert.notEqual(created, undefined);
    assert.equal(after.sessions.length, before.sessions.length + 1);
    assert.ok(after.revision > before.revision, "client snapshots must advance by owner revision");
    await assert.rejects(
      startRuntimeOwner({ dataRoot: root, service: bundle.application, ownerId: "second-owner" }),
      /RUNTIME_OWNER_BUSY/u,
    );
  } finally {
    await client.dispose();
    await owner.dispose();
    await bundle.application.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("same-session explicit manual and delegated runs overlap with independent run ids", async () => {
  const root = await freshRoot("cp2-overlap-");
  const bundle = await createHarnessApplication({
    dataRoot: root,
    workingDirectory: process.cwd(),
    assetsRoot: process.cwd(),
    secretVault: new UnavailableSecretVault(),
    demoDelayMs: 30,
  });
  const provider = new OverlapProvider();
  bundle.runtime.providerRegistry().register(provider);
  const session = bundle.runtime.snapshot().sessions[0];
  await bundle.runtime.setProviderModel(session.id, provider.descriptor.id, provider.descriptor.models[0].id);
  try {
    await Promise.all([
      bundle.runtime.send({
        sessionId: session.id,
        text: "手动运行",
        attachments: [],
        selectedModel: provider.descriptor.models[0].id,
        permissionMode: session.permissionMode,
        origin: { kind: "user" },
      }),
      bundle.runtime.send({
        sessionId: session.id,
        text: "委派运行",
        attachments: [],
        selectedModel: provider.descriptor.models[0].id,
        permissionMode: session.permissionMode,
        origin: { kind: "delegation", sourceSessionId: session.id, envelopeId: "delegation-1" },
      }),
    ]);
    await waitFor(() => provider.activeRunIds.size === 2);
    const runs = bundle.runtime.listRuns(session.id).filter((run) => run.status === "running");
    assert.equal(runs.length, 2);
    assert.notEqual(runs[0].runId, runs[1].runId);
    assert.equal(await bundle.runtime.cancelRun(runs[0].runId), true);
    await waitFor(() => provider.activeRunIds.size === 1);
    assert.equal(provider.activeRunIds.size, 1, "target cancellation must not cancel the sibling run");
    provider.release();
    await waitFor(() => bundle.runtime.listRuns(session.id).every((run) => ["completed", "cancelled", "failed"].includes(run.status)));
  } finally {
    provider.release();
    await bundle.runtime.flushPersistence();
    await bundle.application.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("IPC client reconnects to a handed-off owner and receives the canonical snapshot", async () => {
  const root = await freshRoot("cp2-handoff-");
  const bundle = await createHarnessApplication({
    dataRoot: root,
    workingDirectory: process.cwd(),
    assetsRoot: process.cwd(),
    secretVault: new UnavailableSecretVault(),
  });
  const firstOwner = await startRuntimeOwner({ dataRoot: root, service: bundle.application, ownerId: "handoff-owner-1" });
  const client = await createRuntimeClient(root);
  let updates = 0;
  const unsubscribe = client.subscribe(() => { updates += 1; });
  try {
    const before = await client.getSnapshot();
    await firstOwner.dispose();
    const secondOwner = await startRuntimeOwner({ dataRoot: root, service: bundle.application, ownerId: "handoff-owner-2" });
    try {
      await waitFor(() => updates >= 2, 5_000);
      const after = await client.getSnapshot();
      assert.ok(after.revision >= before.revision);
      assert.equal(after.sessions[0].id, before.sessions[0].id);
    } finally {
      await secondOwner.dispose();
    }
  } finally {
    unsubscribe();
    await client.dispose();
    await bundle.application.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("global capacity queues without sharing cancellation and preserves run checkpoints", async () => {
  const root = await freshRoot("cp2-capacity-");
  const bundle = await createHarnessApplication({
    dataRoot: root,
    workingDirectory: process.cwd(),
    assetsRoot: process.cwd(),
    secretVault: new UnavailableSecretVault(),
    maxConcurrentRuns: 1,
  });
  const provider = new OverlapProvider();
  bundle.runtime.providerRegistry().register(provider);
  const session = bundle.runtime.snapshot().sessions[0];
  await bundle.runtime.setProviderModel(session.id, provider.descriptor.id, provider.descriptor.models[0].id);
  try {
    await bundle.runtime.send({
      sessionId: session.id,
      text: "容量中的第一个",
      attachments: [],
      selectedModel: provider.descriptor.models[0].id,
      permissionMode: session.permissionMode,
      origin: { kind: "user" },
    });
    await waitFor(() => provider.activeRunIds.size === 1);
    const queued = await bundle.runtime.send({
      sessionId: session.id,
      text: "容量中的第二个",
      attachments: [],
      selectedModel: provider.descriptor.models[0].id,
      permissionMode: session.permissionMode,
      origin: { kind: "scheduler", scheduleId: "capacity-test" },
    });
    assert.equal(queued.queued, true);
    const queuedRun = bundle.runtime.listRuns(session.id).find((run) => run.text === "容量中的第二个");
    assert.equal(queuedRun?.status, "queued");
    assert.equal(await bundle.runtime.cancelRun(queuedRun!.runId), true);
    assert.equal(bundle.runtime.listRuns(session.id).find((run) => run.runId === queuedRun!.runId)?.status, "cancelled");
    provider.release();
    await waitFor(() => provider.activeRunIds.size === 0);
    await waitFor(() => !bundle.runtime.isRunning(session.id));
    assert.ok(bundle.runtime.listRuns(session.id).every((run) => ["completed", "cancelled", "failed"].includes(run.status)));
    const events = bundle.runtime.getSession(session.id)!.events;
    assert.ok(events.some((event) => event.type === "run.checkpoint" && (event.payload as { phase?: string }).phase === "provider"));
    assert.ok(events.some((event) => event.type === "run.queued"));
  } finally {
    provider.release();
    await bundle.runtime.flushPersistence();
    await bundle.application.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("restart resumes an unknown run once with visible recovering and replay events", async () => {
  const root = await freshRoot("cp2-recovery-");
  const first = await createHarnessApplication({
    dataRoot: root,
    workingDirectory: process.cwd(),
    assetsRoot: process.cwd(),
    secretVault: new UnavailableSecretVault(),
  });
  const session = first.runtime.snapshot().sessions[0];
  const runId = "crashed-run-1";
  const message: AgentMessage = {
    id: "crashed-user-message",
    role: "user",
    text: "恢复这个未知步骤",
    createdAt: Date.now(),
    status: "completed",
  };
  const history: ProviderHistoryEntry = {
    id: "crashed-provider-user",
    role: "user",
    items: [{ type: "text", text: message.text }],
  };
  const persisted = {
    ...session,
    status: "running" as const,
    activeRunId: runId,
    activeRunIds: [runId],
    messages: [message],
    providerHistory: [history],
  };
  const started: RuntimeEvent = {
    id: "crashed-run-started",
    sessionId: session.id,
    type: "run.started",
    timestamp: message.createdAt,
    payload: {
      runId,
      origin: { kind: "user" },
      inputText: message.text,
      permissionMode: session.permissionMode,
      projectAccess: false,
    },
  };
  try {
    await first.storage.saveSnapshot({
      schemaVersion: 3,
      productVersion: "1.8.1",
      activeSessionId: session.id,
      sessions: [persisted],
    });
    await first.storage.appendEvent(started);
    await first.storage.appendEvent({
      id: "crashed-user-event",
      sessionId: session.id,
      type: "message.user",
      timestamp: message.createdAt,
      payload: { runId, origin: { kind: "user" }, message },
    });
    await first.application.dispose();

    const resumed = await createHarnessApplication({
      dataRoot: root,
      workingDirectory: process.cwd(),
      assetsRoot: process.cwd(),
      secretVault: new UnavailableSecretVault(),
    });
    try {
      await waitFor(() => resumed.runtime.listRuns(session.id).some((run) => run.runId === runId && run.status === "completed"), 5_000);
      const events = resumed.runtime.getSession(session.id)!.events;
      assert.ok(events.some((event) => event.type === "run.recovering" && (event.payload as { runId?: string }).runId === runId));
      assert.ok(events.some((event) => event.type === "run.replaying" && (event.payload as { runId?: string }).runId === runId));
      assert.ok(events.some((event) => event.type === "run.completed" && (event.payload as { runId?: string }).runId === runId));
    } finally {
      await resumed.runtime.flushPersistence();
      await resumed.application.dispose();
    }
  } finally {
    await first.application.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("restart does not replay a run with a terminal success event", async () => {
  const root = await freshRoot("cp2-success-");
  const first = await createHarnessApplication({
    dataRoot: root,
    workingDirectory: process.cwd(),
    assetsRoot: process.cwd(),
    secretVault: new UnavailableSecretVault(),
  });
  const session = first.runtime.snapshot().sessions[0];
  const runId = "successful-run-1";
  const now = Date.now();
  try {
    await first.storage.saveSnapshot({
      schemaVersion: 3,
      productVersion: "1.8.1",
      activeSessionId: session.id,
      sessions: [{ ...session, status: "running", activeRunId: runId, activeRunIds: [runId] }],
    });
    await first.storage.appendEvent({
      id: "successful-run-started",
      sessionId: session.id,
      type: "run.started",
      timestamp: now,
      payload: { runId, origin: { kind: "user" }, inputText: "已成功的运行", permissionMode: session.permissionMode },
    });
    await first.storage.appendEvent({
      id: "successful-provider-checkpoint",
      sessionId: session.id,
      type: "run.checkpoint",
      timestamp: now + 1,
      payload: { runId, phase: "provider", status: "succeeded" },
    });
    await first.storage.appendEvent({
      id: "successful-run-completed",
      sessionId: session.id,
      type: "run.completed",
      timestamp: now + 2,
      payload: { runId },
    });
    await first.application.dispose();

    const resumed = await createHarnessApplication({
      dataRoot: root,
      workingDirectory: process.cwd(),
      assetsRoot: process.cwd(),
      secretVault: new UnavailableSecretVault(),
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(resumed.runtime.listRuns(session.id).length, 0);
      const events = resumed.runtime.getSession(session.id)!.events;
      assert.ok(events.some((event) => event.type === "run.completed"));
      assert.equal(events.some((event) => event.type === "run.recovering"), false);
    } finally {
      await resumed.application.dispose();
    }
  } finally {
    await first.application.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

class OverlapProvider implements ModelProvider {
  readonly descriptor = {
    id: "cp2-overlap-provider",
    name: "CP2 Overlap Provider",
    label: "CP2 Overlap Provider · 本地",
    configuration: "demo" as const,
    available: true,
    realCallsEnabled: false,
    capabilities: ["streaming"],
    models: [{ id: "cp2-overlap-model", label: "CP2 Overlap Model" }],
  };
  readonly activeRunIds = new Set<string>();
  private releaseGate!: () => void;
  private readonly gate = new Promise<void>((resolve) => { this.releaseGate = resolve; });

  async *stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    this.activeRunIds.add(request.runId ?? request.sessionId);
    try {
      await Promise.race([this.gate, abortPromise(signal)]);
      if (signal.aborted) throw new Error("CP2 overlap cancelled");
      yield { kind: "text.delta", text: "CP2 overlap complete" };
    } finally {
      this.activeRunIds.delete(request.runId ?? request.sessionId);
    }
  }

  release(): void { this.releaseGate(); }
}

function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new Error("CP2 overlap cancelled"));
      return;
    }
    signal.addEventListener("abort", () => reject(new Error("CP2 overlap cancelled")), { once: true });
  });
}

async function freshRoot(prefix: string): Promise<string> {
  await mkdir(outputRoot, { recursive: true });
  return mkdtemp(join(outputRoot, prefix));
}
