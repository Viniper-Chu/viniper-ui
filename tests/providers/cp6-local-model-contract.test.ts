import assert from "node:assert/strict";
import { test } from "node:test";
import { LocalModelService } from "../../src/features/local-models/local-model-service";

test("CP6 local models stay cloud-default, require explicit adoption, and retain old versions", async () => {
  const service = new LocalModelService();
  assert.equal(service.snapshot().cloudDefault, true);
  assert.equal(service.snapshot().maxConcurrency, 1);
  assert.equal(await service.registerLoopback({
    id: "local-fixture",
    label: "本地 Fixture",
    endpoint: "http://127.0.0.1:47833/v1",
    source: "custom",
    license: "fixture",
    sizeBytes: 1024,
    format: "openai-compatible",
    compatibility: "fixture",
    toolCapability: "none",
    version: "1.0.0",
  }), true);
  assert.equal(await service.confirmAdoption("local-fixture", "1.0.0"), true);
  assert.equal(await service.requestUpdate("local-fixture", "1.1.0"), true);
  assert.equal(await service.confirmUpdate("local-fixture"), true);
  const record = service.snapshot().records.find((item) => item.id === "local-fixture")!;
  assert.equal(record.activeVersionId, "1.1.0");
  assert.equal(record.versions.length, 2);
  assert.equal(await service.registerLoopback({
    id: "remote-fixture",
    label: "错误远端",
    endpoint: "https://example.invalid/v1",
    source: "custom",
    license: "fixture",
    format: "openai-compatible",
    compatibility: "fixture",
    toolCapability: "none",
    version: "1.0.0",
  }), false);
});
