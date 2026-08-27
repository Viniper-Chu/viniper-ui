import assert from "node:assert/strict";
import { test } from "node:test";
import { projectProviderEvent } from "../../src/features/runs/provider-event-projector";

test("shared provider projection uses engine metadata instead of Claude branding", async () => {
  const emitted: Array<{ type: string; payload: any }> = [];
  const session: any = { activities: [] };
  const context = {
    session,
    assistantMessageId: "message-1",
    thinkingActivityId: "thinking-1",
    now: () => 1,
    appendText: () => {},
    providerLabel: "Viniper Harness",
    emit: async (type: any, payload: any) => { emitted.push({ type, payload }); },
  };
  await projectProviderEvent({ kind: "provider-tool.completed", callId: "call-1", isError: false } as any, context);
  await projectProviderEvent({ kind: "provider-permission.confirmed", mode: "review" } as any, context);
  await projectProviderEvent({ kind: "provider-permission.completed", deniedCount: 0 } as any, context);
  const serialized = JSON.stringify(emitted);
  assert.match(serialized, /Viniper Harness/u);
  assert.doesNotMatch(serialized, /Claude code/u);
});
