import assert from "node:assert/strict";
import test from "node:test";
import { ProductSettingsService } from "../../src/features/settings/product-settings-service";
import { UpdateService } from "../../src/features/updates/update-service";

test("CP7 update center separates Preview/stable and is unavailable without an official source", async () => {
  const unavailable = new UpdateService();
  const result = await unavailable.check("preview");
  assert.equal(result.status, "unavailable");
  assert.equal(result.officialSourceConfigured, false);
  const service = new UpdateService({
    transport: {
      fetchFeed: async (channel: "preview" | "stable") => ({ channel, version: "0.0.2", notes: "fixture", asset: "fixture.vh" }),
      download: async () => ({ path: "fixture.vh" }),
    },
  });
  const ready = await service.check("preview");
  assert.equal(ready.status, "available");
  assert.equal((await service.check("stable")).channel, "stable");
  service.setActiveRunCount(1);
  assert.equal((await service.download()).status, "waiting-idle");
});

test("CP7 failed local update keeps the current version and exposes failure instead of replacing it", async () => {
  const service = new UpdateService({
    officialEndpoint: "http://127.0.0.1:47991/update",
    transport: {
      fetchFeed: async (channel) => ({ channel, version: "0.0.2", notes: "fixture", asset: "fixture.vh" }),
      download: async () => ({ path: "fixture.vh" }),
      install: async () => { throw new Error("fixture install failed"); },
    },
  });
  await service.check("preview");
  await service.download();
  const result = await service.confirmInstall();
  assert.equal(result.status, "failed");
  assert.equal(result.currentVersion, "1.6.0");
  assert.match(result.failure ?? "", /fixture install failed/u);
});

test("CP7 settings center persists close, runtime, diagnostics, network, local model, and update choices", async () => {
  const values = new Map<string, unknown>();
  const service = new ProductSettingsService({
    load: async (key: string) => values.get(key),
    save: async (key: string, value: unknown) => { values.set(key, value); },
  });
  const initial = service.snapshot();
  assert.equal(initial.closeBehavior, "ask");
  await service.update({ closeBehavior: "keep_running", maxConcurrentRuns: 4, diagnosticsConsent: false, updateChannel: "preview" });
  const restored = new ProductSettingsService({ load: async (key: string) => values.get(key), save: async (key, value) => { values.set(key, value); } });
  await restored.initialize();
  assert.equal(restored.snapshot().closeBehavior, "keep_running");
  assert.equal(restored.snapshot().maxConcurrentRuns, 4);
  assert.equal(restored.snapshot().diagnosticsConsent, false);
  assert.equal(restored.snapshot().updateChannel, "preview");
});
