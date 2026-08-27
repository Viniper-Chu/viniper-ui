import assert from "node:assert/strict";
import { test } from "node:test";
import { ProviderRegistry } from "../../src/features/providers/provider-registry";

test("Demo is the only initially callable Provider while all 28 profiles remain visible", () => {
  const registry = new ProviderRegistry();
  const descriptors = registry.list();
  assert.equal(descriptors.find((provider) => provider.id === "demo")?.available, true);
  assert.equal(descriptors.filter((provider) => provider.realCallsEnabled).length, 0);
  assert.equal(descriptors.length, 29);
  assert.equal(descriptors.filter((provider) => provider.configuration === "not-connected").length, 28);
  assert.equal(descriptors.some((provider) => provider.id === "xiaomi-mimo"), true);
  assert.equal(descriptors.some((provider) => provider.id === "ctyun-telechat"), true);
  assert.throws(() => registry.get("openai"), /仅提供配置占位/u);
});
