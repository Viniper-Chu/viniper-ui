import assert from "node:assert/strict";
import { test } from "node:test";
import { ProviderTransportError } from "../../src/features/providers/protocols/shared/provider-transport";
import { runProviderWithRetries } from "../../src/features/providers/provider-retry";

test("CP6 provider retry stops at five attempts and exposes each attempt", async () => {
  let calls = 0;
  const attempts: number[] = [];
  const result = await runProviderWithRetries({
    maxAttempts: 5,
    onAttempt: (attempt) => { attempts.push(attempt); },
    stream: async function* () {
      calls += 1;
      throw new ProviderTransportError("server");
    },
    hasSemanticOutput: () => false,
  });
  assert.equal(result.ok, false);
  assert.equal(calls, 5);
  assert.deepEqual(attempts, [1, 2, 3, 4, 5]);
});

test("CP6 provider retry never repeats after semantic output", async () => {
  let calls = 0;
  await assert.rejects(runProviderWithRetries({
    maxAttempts: 5,
    onAttempt: () => undefined,
    stream: async function* () {
      calls += 1;
      yield { kind: "text.delta", text: "已经有语义输出" };
      throw new ProviderTransportError("server");
    },
    hasSemanticOutput: () => true,
  }));
  assert.equal(calls, 1);
});
