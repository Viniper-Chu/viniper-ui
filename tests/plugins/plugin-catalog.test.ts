import assert from "node:assert/strict";
import { test } from "node:test";
import { PluginRecord } from "../../src/core/extension-contracts";
import { PluginSource } from "../../src/core/ports";
import { createCoordinationTools } from "../../src/features/coordination/coordination-tools";
import { CoordinationService } from "../../src/features/coordination/coordination-service";
import { PluginCatalog } from "../../src/features/plugins/plugin-catalog";
import { ToolRegistry } from "../../src/features/tools/tool-registry";
import { createRuntimeFixture } from "../runs/runtime-fixture";

class FakePluginSource implements PluginSource {
  async discover(): Promise<PluginRecord[]> {
    return [
      { id: "built-in.coordination", name: "内置会话协作", version: "1.0.0", classification: "built-in", capabilities: ["session-message"], skills: [], tools: ["coordination.send-message", "coordination.delegate-task", "coordination.wait-for-result", "coordination.read-result"], providers: [], executable: true },
      { id: "external.unknown", name: "外部声明", version: "1.0.0", classification: "external-declarative", capabilities: [], skills: [], tools: ["external.run"], providers: [], executable: false },
      { id: "broken", name: "broken", version: "unknown", classification: "invalid", capabilities: [], skills: [], tools: [], providers: [], executable: false, error: "manifest invalid" },
    ];
  }
}

test("built-in coordination plugin registers executable local tools while external and invalid plugins do not", async () => {
  const fixture = await createRuntimeFixture();
  const coordination = new CoordinationService(fixture.store, fixture.runtime);
  await coordination.initialize();
  try {
    const sourceSession = fixture.runtime.snapshot().sessions[0];
    const targetSession = await fixture.runtime.createSession();
    const tools = new ToolRegistry();
    const catalog = new PluginCatalog(new FakePluginSource(), tools, {
      "built-in.coordination": () => createCoordinationTools(coordination),
    });
    await catalog.initialize();
    assert.equal(tools.has("coordination.send-message"), true);
    assert.equal(tools.has("coordination.wait-for-result"), true);
    assert.equal(tools.has("coordination.read-result"), true);
    assert.equal(tools.has("coordination.delegate-task"), true);
    assert.equal(tools.has("external.run"), false);
    assert.deepEqual(catalog.list().map((item) => item.classification), ["built-in", "external-declarative", "invalid"]);
    const sendDescriptor = tools.descriptors().find((item) => item.name === "coordination.send-message")!;
    assert.deepEqual(sendDescriptor.inputSchema.required, ["targetSessionId", "text"]);
    assert.equal("sourceSessionId" in (sendDescriptor.inputSchema.properties ?? {}), false);

    await tools.get("coordination.send-message").execute({
      id: "tool-1",
      name: "coordination.send-message",
      summary: "本地协作测试",
      readOnly: false,
      scope: "external",
      input: { targetSessionId: targetSession.id, text: "插件消息" },
    }, {
      sessionId: sourceSession.id,
      runId: "plugin-test-run",
      projectRoot: sourceSession.workingDirectory,
      signal: new AbortController().signal,
    });
    assert.equal(coordination.snapshot().envelopes.some((envelope) => envelope.body === "插件消息"), true);
  } finally {
    coordination.dispose();
    await fixture.dispose();
  }
});
