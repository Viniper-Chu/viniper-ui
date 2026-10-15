import assert from "node:assert/strict";
import { test } from "node:test";
import { ProviderTransportError } from "../../src/features/providers/protocols/shared/provider-transport";
import { runProviderWithRetries } from "../../src/features/providers/provider-retry";

test("local request-start immediately reaches the host without committing a retryable attempt", async () => {
  const received: string[] = [];
  let attempts = 0;
  const result = await runProviderWithRetries({
    onEvent: (event) => { received.push(event.kind); },
    stream: async function* () {
      attempts++;
      yield { kind: "context.budget", inputCount: 12000, windowSize: 16384, outputReserved: 4096 };
      yield { kind: "provider.request.started", phase: "local-prefill", timeoutSeconds: 300, inputCount: 12000 };
      assert.equal(received.at(-1), "provider.request.started");
      if (attempts === 1) throw new ProviderTransportError("network");
      yield { kind: "text.delta", text: "done" };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(attempts, 2);
  assert.deepEqual(received, ["context.budget", "provider.request.started", "context.budget", "provider.request.started", "text.delta"]);
});

test("tool input progress reaches the host before a complete call without committing a failed attempt", async () => {
  let attempts = 0;
  const received: string[] = [];
  const result = await runProviderWithRetries({
    onEvent: (event) => { received.push(event.kind); },
    stream: async function* () {
      attempts++;
      yield { kind: "provider.activity", phase: "tool-input", receivedCharacters: 128 };
      assert.equal(received.at(-1), "provider.activity", "activity must not wait for semantic output");
      if (attempts === 1) throw new ProviderTransportError("network");
      yield { kind: "tool-call.completed", call: { type: "tool-call", callId: "one", name: "file.write", argumentsText: "{}", arguments: {} } };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(attempts, 2);
  assert.deepEqual(received, ["provider.activity", "provider.activity", "tool-call.completed"]);
  if (result.ok) assert.deepEqual(result.events.map((e) => e.kind), ["tool-call.completed"]);
});

test("a progress consumer failure does not retry the model", async () => {
  let calls = 0;
  await assert.rejects(runProviderWithRetries({
    onEvent: () => { throw new ProviderTransportError("network"); },
    stream: async function* () { calls++; yield { kind: "provider.activity", phase: "tool-input", receivedCharacters: 1 }; },
  }), ProviderTransportError);
  assert.equal(calls, 1);
});

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

test("pre-output metadata from a failed attempt is not published twice", async () => {
  let calls = 0;
  const received: string[] = [];
  const result = await runProviderWithRetries({
    onEvent: (event) => { received.push(event.kind); },
    stream: async function* () {
      calls += 1;
      yield { kind: "thinking.started" };
      if (calls === 1) throw new ProviderTransportError("server");
      yield { kind: "text.delta", text: "成功" };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
  assert.deepEqual(received, ["thinking.started", "text.delta"]);
});

test("an event consumer error never triggers another Provider request", async () => {
  let calls = 0;
  await assert.rejects(runProviderWithRetries({
    onEvent: () => { throw new ProviderTransportError("network"); },
    stream: async function* () {
      calls += 1;
      yield { kind: "thinking.started" };
    },
  }), ProviderTransportError);
  assert.equal(calls, 1);
});
