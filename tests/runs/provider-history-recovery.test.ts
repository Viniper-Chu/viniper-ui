import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { PRODUCT_VERSION } from "../../src/core/contracts";
import { ProviderHistoryEntry } from "../../src/core/provider-contracts";
import { recoverDanglingToolCalls } from "../../src/features/runs/provider-history-recovery";
import { AgentRuntime } from "../../src/features/runs/agent-runtime";
import { ProviderRegistry } from "../../src/features/providers/provider-registry";
import { TokenLedger } from "../../src/features/telemetry/token-ledger";
import { ToolRegistry } from "../../src/features/tools/tool-registry";
import { createSessionSnapshot } from "../../src/features/sessions/session-factory";
import { FileStore } from "../../src/platform/persistence/file-store";
import { sanitizeAnthropicHistory, serializeAnthropicMessages } from "../../src/features/providers/protocols/anthropic-messages/anthropic-messages-provider";
import { protocolRequest, testProfile } from "../providers/protocol-test-kit";

test("dangling Anthropic tool calls recover to one deterministic failed result and remain idempotent", () => {
  const history = danglingHistory();
  const first = recoverDanglingToolCalls(history);
  assert.equal(first.changed, true);
  assert.deepEqual(first.recoveredCallIds, ["call-restart-1"]);
  assert.deepEqual(first.history.map((entry) => entry.role), ["assistant", "tool", "user"]);
  const result = first.history[1]?.items[0];
  assert.equal(result?.type, "tool-result");
  assert.equal(result?.callId, "call-restart-1");
  assert.equal(result?.isError, true);
  const second = recoverDanglingToolCalls(first.history);
  assert.equal(second.changed, false);
  assert.deepEqual(second.history, first.history);
});

test("Anthropic serializer closes a persisted tool-use before the next user message", () => {
  const profile = testProfile("anthropic-messages", "http://127.0.0.1:1/fake");
  const request = {
    ...protocolRequest(profile),
    profileId: profile.id,
    history: [
      ...danglingHistory(),
      { id: "user-after-recovery", role: "user" as const, items: [{ type: "text" as const, text: "second user turn" }] },
    ],
  };
  const body = serializeAnthropicMessages(request, profile);
  const toolResult = (body.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>)
    .flatMap((message) => message.content)
    .find((item) => item.type === "tool_result" && item.tool_use_id === "call-restart-1");
  assert.ok(toolResult);
  assert.deepEqual((body.messages as Array<{ role: string }>).map((message) => message.role), ["assistant", "user"]);
  const userContent = (body.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>)[1].content;
  assert.equal(userContent[0].type, "tool_result");
  assert.equal(userContent[1].type, "text");
  assert.equal(userContent[2].type, "text");
});

test("AgentRuntime restart persists recovered history without duplicating the result", async () => {
  const root = await mkdtemp(join(process.cwd(), "codex", "运行残留", "history-recovery-"));
  try {
    const store = new FileStore(root);
    const session = createSessionSnapshot("D:\\fixture", 100);
    session.providerHistory = danglingHistory();
    const { events: _events, ...persisted } = session;
    await store.saveSnapshot({ schemaVersion: 3, productVersion: PRODUCT_VERSION, activeSessionId: session.id, sessions: [persisted] });
    const ledger = new TokenLedger(store);
    await ledger.initialize();
    const first = new AgentRuntime({ persistence: store, defaultWorkingDirectory: "D:\\fixture", registry: new ProviderRegistry(20), toolRegistry: new ToolRegistry(), tokenLedger: ledger });
    await first.initialize();
    const recovered = first.snapshot().sessions[0].providerHistory;
    assert.equal(recovered.filter((entry) => entry.role === "tool").flatMap((entry) => entry.items).filter((item) => item.type === "tool-result").length, 1);
    await first.flushPersistence();
    const persistedRaw = JSON.parse(await readFile(store.snapshotPath, "utf8")) as { sessions: Array<{ providerHistory: ProviderHistoryEntry[] }> };
    assert.equal(persistedRaw.sessions[0].providerHistory.filter((entry) => entry.role === "tool").flatMap((entry) => entry.items).filter((item) => item.type === "tool-result").length, 1);
    const secondLedger = new TokenLedger(store);
    await secondLedger.initialize();
    const second = new AgentRuntime({ persistence: store, defaultWorkingDirectory: "D:\\fixture", registry: new ProviderRegistry(20), toolRegistry: new ToolRegistry(), tokenLedger: secondLedger });
    await second.initialize();
    assert.equal(second.snapshot().sessions[0].providerHistory.filter((entry) => entry.role === "tool").flatMap((entry) => entry.items).filter((item) => item.type === "tool-result").length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Anthropic history sanitizer drops empty/orphan blocks and closes a failed assistant before the next user", () => {
  const profile = testProfile("anthropic-messages", "http://127.0.0.1:1/fake");
  const history: ProviderHistoryEntry[] = [
    { id: "user-before", role: "user", items: [{ type: "text", text: "before" }] },
    { id: "failed-empty", role: "assistant", items: [] },
    { id: "orphan-tool", role: "tool", items: [{ type: "tool-result", callId: "orphan", name: "demo.inspect", content: "orphan", isError: true }] },
    {
      id: "assistant-tool",
      role: "assistant",
      items: [{ type: "tool-call", callId: "call-sanitize-1", name: "demo.inspect", arguments: {}, argumentsText: "{}" }],
    },
    { id: "user-after", role: "user", items: [{ type: "text", text: "after" }] },
  ];
  const sanitized = sanitizeAnthropicHistory(history);
  assert.equal(sanitized.some((entry) => entry.id === "failed-empty"), false);
  assert.equal(sanitized.some((entry) => entry.id === "orphan-tool"), false);
  const body = serializeAnthropicMessages({
    ...protocolRequest(profile),
    profileId: profile.id,
    history,
  }, profile);
  const messages = body.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
  assert.deepEqual(messages.map((message) => message.role), ["user", "assistant", "user"]);
  assert.equal(messages[2]?.content[0]?.type, "tool_result");
  assert.equal(messages[2]?.content[0]?.tool_use_id, "call-sanitize-1");
  assert.equal(messages[2]?.content.at(-1)?.type, "text");
});

test("Anthropic history sanitizer is idempotent across restart projections", () => {
  const history = danglingHistory();
  const first = sanitizeAnthropicHistory(history);
  const second = sanitizeAnthropicHistory(first);
  assert.deepEqual(second, first);
  assert.deepEqual(first.map((entry) => entry.role), ["assistant", "tool", "user"]);
});

function danglingHistory(): ProviderHistoryEntry[] {
  return [
    {
      id: "assistant-restart-1",
      role: "assistant",
      items: [
        { type: "provider-step", protocol: "anthropic-messages", step: { type: "tool_use", id: "call-restart-1", name: "vh_dGVybWluYWwucnVu", input: {} } },
        { type: "tool-call", callId: "call-restart-1", name: "terminal.run", arguments: {}, argumentsText: "{}" },
      ],
    },
    { id: "user-restart-2", role: "user", items: [{ type: "text", text: "继续任务" }] },
  ];
}
