import assert from "node:assert/strict";
import test from "node:test";
import {
  CompositionCompiler,
  createDefaultCompositionDefinitions,
} from "../../src/features/composition/composition-compiler";
import { freezeRunContext } from "../../src/features/composition/frozen-run-context";

test("CP1：能力组合按依赖与声明顺序确定性编译，并解释阻断原因", () => {
  const compiler = new CompositionCompiler(createDefaultCompositionDefinitions());
  const first = compiler.compile({ host: "desktop", preset: "standard" });
  const second = compiler.compile({ host: "desktop", preset: "standard" });

  assert.deepEqual(first.order, second.order);
  assert.ok(first.enabled.some((item) => item.id === "core.agent"));
  assert.ok(first.enabled.some((item) => item.id === "programming.tools"));

  const custom = new CompositionCompiler([
    {
      id: "custom.consumer",
      version: "1.0.0",
      kind: "workflow",
      source: "test",
      required: true,
      dependencies: ["custom.missing"],
    },
    {
      id: "custom.cycle-a",
      version: "1.0.0",
      kind: "prompt-section",
      source: "test",
      after: ["custom.cycle-b"],
    },
    {
      id: "custom.cycle-b",
      version: "1.0.0",
      kind: "prompt-section",
      source: "test",
      after: ["custom.cycle-a"],
    },
  ]);
  const blocked = custom.compile({ host: "desktop", preset: "custom", enabledIds: [
    "custom.consumer",
    "custom.cycle-a",
    "custom.cycle-b",
  ] });
  assert.equal(blocked.enabled.length, 0);
  assert.match(blocked.blocked.find((item) => item.id === "custom.consumer")?.reason ?? "", /依赖/);
  assert.match(blocked.blocked.find((item) => item.id === "custom.cycle-a")?.reason ?? "", /循环|cycle/i);
});

test("CP1：来源 disposer 只卸载自己的能力，旧计划保持可读", () => {
  const compiler = new CompositionCompiler(createDefaultCompositionDefinitions());
  const dispose = compiler.register({
    id: "test.transient",
    version: "1.0.0",
    kind: "tool",
    source: "test-source",
  });
  const before = compiler.compile({ host: "desktop", preset: "custom", enabledIds: ["test.transient"] });
  dispose();
  const after = compiler.compile({ host: "desktop", preset: "custom", enabledIds: ["test.transient"] });
  assert.ok(before.enabled.some((item) => item.id === "test.transient"));
  assert.equal(after.enabled.some((item) => item.id === "test.transient"), false);
});

test("CP1：FrozenRunContext 深冻结一次运行使用的组合、工具、Skill 与 Provider 快照", () => {
  const input = {
    runId: "run-cp1",
    sessionId: "session-cp1",
    provider: {
      providerId: "demo",
      profileId: "demo",
      modelId: "demo-model",
      permissionMode: "ask" as const,
      reasoning: "balanced",
    },
    composition: new CompositionCompiler(createDefaultCompositionDefinitions()).compile({ host: "desktop", preset: "standard" }),
    toolDescriptors: [],
    skills: [{ id: "skill.cp1", version: "1.0.0", body: "唯一标记 CP1" }],
    extensions: {},
    projectInstructions: { status: "not-configured" as const },
    permission: { mode: "ask" as const, access: "none" as const },
    review: { policy: "off" as const },
    cache: { stablePrefix: "stable", generation: 1 },
    workflow: { enabled: true },
    steering: { inboxId: "inbox-cp1" },
  };
  const frozen = freezeRunContext(input);
  input.provider.modelId = "mutated";
  input.skills[0].body = "mutated";
  assert.equal(frozen.provider.modelId, "demo-model");
  assert.equal(frozen.skills[0].body, "唯一标记 CP1");
  assert.equal(Object.isFrozen(frozen), true);
  assert.equal(Object.isFrozen(frozen.composition), true);
});
