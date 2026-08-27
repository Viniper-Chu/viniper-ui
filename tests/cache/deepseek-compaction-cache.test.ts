import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ContextCompactionService,
  defaultCompactionThresholdChars,
} from "../../src/features/runs/context-compaction-service";
import { ProviderHistoryEntry } from "../../src/core/provider-contracts";

test("DeepSeek V4 does not rewrite a healthy append-only prefix at the generic 32k-character threshold", async () => {
  assert.equal(defaultCompactionThresholdChars("deepseek", "deepseek-v4-flash"), 384_000);
  assert.equal(defaultCompactionThresholdChars("other", "model"), 32_000);
  const history = longHistory(140_000);
  const deepseek = new ContextCompactionService();
  const deepseekResult = await deepseek.maybeCompact({
    sessionId: "deepseek-session",
    providerId: "deepseek",
    modelId: "deepseek-v4-flash",
    history,
  });
  assert.equal(deepseekResult.status, "not-needed");
  assert.deepEqual(deepseekResult.history, history);

  const generic = new ContextCompactionService();
  const genericResult = await generic.maybeCompact({
    sessionId: "generic-session",
    providerId: "generic",
    modelId: "generic-model",
    history,
  });
  assert.equal(genericResult.status, "generated");
});

function longHistory(chars: number): ProviderHistoryEntry[] {
  const piece = "稳定的追加式历史。".repeat(Math.ceil(chars / 9));
  return [
    { id: "user-1", role: "user", items: [{ type: "text", text: piece }] },
    { id: "assistant-1", role: "assistant", items: [{ type: "text", text: "已记录。" }] },
    { id: "user-2", role: "user", items: [{ type: "text", text: "继续。" }] },
  ];
}
