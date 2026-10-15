import assert from "node:assert/strict";
import { test } from "node:test";
import { ContextCompactionService } from "../../src/features/runs/context-compaction-service";
import { ProviderHistoryEntry } from "../../src/core/provider-contracts";

test("compaction retains the latest whole task and its matching tool calls and results", async () => {
  const service = new ContextCompactionService();
  const history: ProviderHistoryEntry[] = [
    { id: "old-user", role: "user", items: [{ type: "text", text: "以前任务".repeat(4000) }] },
    { id: "old-answer", role: "assistant", items: [{ type: "text", text: "已完成旧任务" }] },
    { id: "current-user", role: "user", items: [{ type: "text", text: "修改 /项目/中文.md，保留标题" }] },
    { id: "call", role: "assistant", items: [{ type: "tool-call", name: "file.edit", callId: "edit", arguments: { path: "/项目/中文.md" }, argumentsText: "{}" }] },
    { id: "result", role: "tool", items: [{ type: "tool-result", name: "file.edit", callId: "edit", content: "成功", isError: false }] },
    { id: "answer", role: "assistant", items: [{ type: "text", text: "已修改，等待核验" }] },
  ];
  const input = { sessionId: "s", providerId: "p", modelId: "m", history, thresholdChars: 100 };
  const first = await service.maybeCompact(input);
  assert.equal(first.status, "generated");
  assert.deepEqual(first.history.slice(1), history.slice(2));
  assert.deepEqual(first.generation?.sourceHistoryIds, ["old-user", "old-answer"]);
  assert.equal((await service.maybeCompact(input)).status, "not-needed");
  assert.equal(service.snapshot().generations.length, 1);
  history.push({ id: "new-user", role: "user", items: [{ type: "text", text: "继续核验" }] });
  const second = await service.maybeCompact(input);
  assert.equal(second.status, "generated");
  assert.deepEqual(second.history.map((entry) => entry.id), [second.generation?.id, "new-user"]);
  assert.match(second.generation?.text ?? "", /中文\.md/u);
  assert.equal(history.length, 7);
});
