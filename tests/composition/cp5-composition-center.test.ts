import assert from "node:assert/strict";
import { test } from "node:test";
import { CompositionService } from "../../src/features/composition/composition-service";
import { freezeRunContext } from "../../src/features/composition/frozen-run-context";

test("CP5：能力中心描述用途、模型、阻塞与当前 run/下次生效边界", () => {
  const service = new CompositionService();
  const center = service.centerSnapshot("any");
  assert.equal(center.presets.length, 4);
  assert.ok(center.presets.every((preset) => preset.purpose && preset.modelRecommendations.length > 0));
  assert.ok(center.presets.some((preset) => preset.id === "deepseek-efficient" && preset.capabilities.some((item) => item.includes("Code"))));
  assert.equal(center.presets.find((preset) => preset.id === center.current.preset)?.frozen, "current-run");
  assert.ok(center.presets.some((preset) => preset.frozen === "next-run"));
});

test("CP5：自定义方案复制、启停、排序与恢复会保留具体名称并进入下一次冻结计划", async () => {
  const service = new CompositionService();
  const copied = await service.copyPreset("deepseek-efficient", "我的代码方案");
  assert.equal(copied.current.preset, "custom");
  assert.equal((copied.current as typeof copied.current & { customName?: string }).customName, "我的代码方案");
  const frozen = freezeRunContext({
    runId: "run-cp5",
    sessionId: "session-cp5",
    provider: { providerId: "demo", profileId: "demo", modelId: "demo-model", permissionMode: "ask", reasoning: "balanced" },
    composition: service.compileForRun({ host: "any" }),
    toolDescriptors: [],
    skills: [],
    extensions: {},
    projectInstructions: { status: "not-configured" },
    permission: { mode: "ask", access: "none" },
    review: { policy: "off" },
    cache: { stablePrefix: "cp5", generation: 1 },
    workflow: { enabled: false },
    steering: { inboxId: "inbox-cp5" },
  });
  assert.equal((frozen.composition as typeof frozen.composition & { customName?: string }).customName, "我的代码方案");
  const disabled = await service.setCustomCapability("我的代码方案", "code-mode.worker", false);
  assert.equal((disabled.current as typeof disabled.current & { customName?: string }).customName, "我的代码方案");
  const reordered = await service.reorderCustom("我的代码方案", ["token.ledger", "core.agent"]);
  assert.equal((reordered.current as typeof reordered.current & { customName?: string }).customName, "我的代码方案");
  const restored = service.restoreDefault();
  assert.equal(restored.current.preset, "standard");
  assert.equal((restored.current as typeof restored.current & { customName?: string }).customName, undefined);
});
