import assert from "node:assert/strict";
import test from "node:test";
import { createCliApplicationPort } from "../../src/platform/cli/application-port";

test("CP7 CLI remains an application-port consumer for transfer, diagnostics, updates, and settings", async () => {
  const calls: string[] = [];
  const port = createCliApplicationPort({
    snapshot: () => ({}) as never,
    subscribe: () => () => undefined,
    createSession: async () => undefined,
    createCliProjectSession: async () => undefined,
    openProjectSession: async () => undefined,
    setActiveSession: async () => true,
    deleteSession: async () => true,
    listRuns: () => [],
    selectRun: async () => true,
    cancelRun: async () => true,
    renameSession: async () => true,
    setProviderModel: async () => true,
    setPermissionMode: async () => true,
    setPermissionAccess: async () => true,
    restoreProjectChange: async () => undefined,
    readTerminalOutput: async () => ({ ok: true, executionId: "fixture", stream: "stdout", status: "completed", offset: 0, bytes: 0, totalBytes: 0, nextOffset: null, truncated: false, complete: true, text: "" }),
    send: async () => ({ accepted: true, queued: false }),
    cancel: async () => true,
    sendMessage: async () => undefined,
    delegateTask: async () => undefined,
    waitForMessage: async () => undefined,
    cancelWait: async () => true,
    setProductSetting: async (key: string) => { calls.push(key); return {
      closeBehavior: "ask", maxConcurrentRuns: 3, notificationsEnabled: true, soundEnabled: false,
      retentionDays: "never", memoryWarningRatio: 0.8, memoryStaleDays: 90, diagnosticsConsent: false,
      providerNetworkMode: "system", providerStatusVisible: true, localModelsEnabled: true,
      localModelConcurrency: 1, updateChannel: "preview", geminiServerStateEnabled: false,
    }; },
    getDiagnosticsPreview: async () => ({ fields: [], containsMessageBodies: false, containsCommandBodies: false, containsCredentialValues: false }),
    checkUpdates: async () => ({ status: "unavailable" }),
  });
  await port.setProductSetting!("diagnosticsConsent", false);
  assert.deepEqual(await port.getDiagnosticsPreview!("run-1"), { fields: [], containsMessageBodies: false, containsCommandBodies: false, containsCredentialValues: false });
  assert.equal((await port.checkUpdates!("preview") as { status: string }).status, "unavailable");
  assert.deepEqual(calls, ["diagnosticsConsent"]);
});
