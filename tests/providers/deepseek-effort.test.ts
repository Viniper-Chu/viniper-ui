import assert from "node:assert/strict";
import test from "node:test";
import { deepSeekEffort } from "../../src/features/providers/protocols/shared/deepseek-effort";

test("DeepSeek effort follows the transport and is scoped to the selected official connection", () => {
  const endpoint = "https://api.deepseek.com/chat/completions";
  for (const effort of ["low", "high", "max"]) {
    assert.deepEqual(deepSeekEffort(endpoint, "deepseek-flash", effort, "openai-chat"), {
      thinking: {type: "enabled"}, reasoning_effort: effort,
    });
    assert.deepEqual(deepSeekEffort("https://api.deepseek.com/anthropic/v1/messages", "deepseek-flash", effort, "anthropic-messages"), {
      thinking: {type: "enabled"}, output_config: {effort},
    });
  }
  assert.deepEqual(deepSeekEffort(endpoint, "deepseek-flash", "off", "openai-chat"), {thinking: {type: "disabled"}});
  assert.deepEqual(deepSeekEffort("http://localhost/v1", "deepseek-flash", "max", "openai-chat"), {});
  assert.deepEqual(deepSeekEffort(endpoint, "other-model", "max", "openai-chat"), {});
});
