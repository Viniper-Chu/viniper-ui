import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { ProviderRegistry } from "../../src/features/providers/provider-registry";
import { ToolRegistry } from "../../src/features/tools/tool-registry";
import { createFileTools } from "../../src/features/files/file-tools";
import { ProviderEvent, ProviderRequest } from "../../src/core/provider-contracts";
import { LocalAgentPolicy } from "../../src/features/local-models/local-agent-policy";
import { createRuntimeFixture, waitFor } from "./runtime-fixture";

test("local Runtime follows 13 actual file dependencies and stops unchanged reads without exhausting 96 rounds", async () => {
  const registry = new ProviderRegistry(0, []), tools = new ToolRegistry();
  for (const tool of createFileTools({ open: async (path) => ({ ok: true, path }) })) tools.register(tool);
  const requests: ProviderRequest[] = [];
  const policy: LocalAgentPolicy = { endpoint: "http://127.0.0.1:18080/v1", model: "demo-default", contextTokens: 16384,
    compactAtTokens: 12288, outputTokens: 4096, maxIterations: 96, defaultReasoning: "medium", reasoningBudgets: { medium: 512 },
    parallelToolCalls: false, structuredToolsJson: false, helperRevision: "fixture", visionEnabled: false };
  let firstPath = "", mode = "chain", ordinal = 0;
  registry.register({ descriptor: { ...registry.get("demo").descriptor }, runtimePolicyFor: () => policy,
    async *stream(request): AsyncIterable<ProviderEvent> {
      requests.push(request); ordinal += 1;
      const previous = request.history.at(-1)?.items[0];
      let path = firstPath;
      if (previous?.type === "tool-result" && mode === "chain") {
        const data = JSON.parse(previous.content);
        if (data.content === "END") {
          assert.equal(data.read_progress.successful_read_calls, 13);
          assert.equal(data.read_progress.distinct_read_paths, 13);
          yield { kind: "text.delta", text: "13 个文件已读完" }; return;
        }
        path = data.content;
      }
      yield { kind: "tool-call.completed", call: { type: "tool-call", callId: `chain-${ordinal}`, name: "file.read", arguments: { path }, argumentsText: JSON.stringify({ path }) } };
    },
  });
  const fixture = await createRuntimeFixture({ registry, toolRegistry: tools });
  try {
    firstPath = join(fixture.root, "第0个.md");
    for (let index = 0; index < 13; index += 1) await writeFile(join(fixture.root, `第${index}个.md`), index === 12 ? "END" : join(fixture.root, `第${index + 1}个.md`));
    const session = fixture.runtime.snapshot().sessions[0];
    await fixture.runtime.setReasoning(session.id, "off");
    const send = async (text: string) => {
      assert.equal((await fixture.runtime.send({ sessionId: session.id, text, selectedModel: session.selectedModel, permissionMode: session.permissionMode, attachments: [] })).accepted, true);
      await waitFor(() => !fixture.runtime.isRunning(session.id), 15000);
    };
    await send("只用 file.read 完成文件依赖链。");
    assert.equal(requests.length, 14);
    assert.equal(requests[0].reasoning, "off");
    assert.equal(fixture.runtime.snapshot().sessions[0].messages.at(-1)?.text, "13 个文件已读完");
    mode = "repeat"; requests.length = 0;
    await send("读取当前文件。");
    assert.equal(requests.length, 3);
    const after = fixture.runtime.snapshot().sessions[0];
    assert.ok(after.events.some((event) => event.type === "run.failed"));
    assert.match(JSON.stringify(after.events.filter((event) => event.type === "run.failed")), /相同结果|没有进展/u);
  } finally { await fixture.dispose(); }
});
