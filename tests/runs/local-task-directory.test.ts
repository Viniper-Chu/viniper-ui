import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { ProviderRequest } from "../../src/core/provider-contracts";
import { LocalAgentPolicy } from "../../src/features/local-models/local-agent-policy";
import { ProviderRegistry } from "../../src/features/providers/provider-registry";
import { createRuntimeFixture, waitFor } from "./runtime-fixture";

test("local task context follows the selected directory without exposing it to other providers", async () => {
  const registry = new ProviderRegistry(0, []);
  const requests: ProviderRequest[] = [];
  const policy: LocalAgentPolicy = {
    endpoint: "http://127.0.0.1:18080/v1", model: "demo-default", contextTokens: 24576,
    compactAtTokens: 18000, outputTokens: 4096, maxIterations: "unlimited",
    defaultReasoning: "medium", reasoningBudgets: { medium: 512 }, parallelToolCalls: false,
    structuredToolsJson: false, helperRevision: "fixture", visionEnabled: false,
  };
  let local = true;
  registry.register({
    descriptor: { ...registry.get("demo").descriptor },
    runtimePolicyFor: () => local ? policy : undefined,
    async *stream(request) {
      requests.push(structuredClone(request));
      yield { kind: "text.delta" as const, text: "完成" };
    },
  });
  const fixture = await createRuntimeFixture({ registry });
  try {
    const send = async (sessionId: string) => {
      const session = fixture.runtime.snapshot().sessions.find(s => s.id === sessionId)!;
      const sent = await fixture.runtime.send({ sessionId, text: "读取当前目录中的材料。", selectedModel: session.selectedModel, permissionMode: session.permissionMode, attachments: [] });
      assert.equal(sent.accepted, true);
      await waitFor(() => !fixture.runtime.isRunning(sessionId));
      return requests.at(-1)!.contextProfile.stableSegments.find(s => s.name === "project")!.text;
    };
    const original = fixture.runtime.snapshot().sessions[0];
    assert.ok((await send(original.id)).includes(JSON.stringify(original.workingDirectory)));
    const selected = await fixture.runtime.createSession(join(fixture.root, "另一目录"));
    const next = await send(selected.id);
    assert.ok(next.includes(JSON.stringify(selected.workingDirectory)));
    assert.ok(!next.includes(JSON.stringify(original.workingDirectory)));
    assert.equal(requests.at(-1)!.workingDirectory, undefined, "directory is model context, not a process launch override");
    local = false;
    const remote = await send(selected.id);
    assert.ok(!remote.includes(selected.workingDirectory));
  } finally { await fixture.dispose(); }
});
