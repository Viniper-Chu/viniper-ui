import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import vm from "node:vm";
import test from "node:test";
import { SQLiteStore } from "../../src/platform/persistence/sqlite-store";

test("SQLiteStore enables WAL mode and updates only the target session during commitEvent", async () => {
  const root = await mkdtemp(join(tmpdir(), "viniper-stage6-sqlite-"));
  try {
    const store = new SQLiteStore(root);
    await store.initialize();
    const baseSession = (id: string, title: string) => ({
      id,
      engineId: "viniper" as const,
      title,
      workingDirectory: process.cwd(),
      selectedModel: "demo-default",
      selectedProviderId: "demo",
      permissionMode: "auto" as const,
      messages: [{ id: `m-${id}`, role: "user" as const, text: "hello", createdAt: 1 }],
      providerHistory: [],
      queue: [],
      activities: [],
      status: "idle" as const,
      unread: false,
      pinned: false,
      createdAt: 1,
      updatedAt: 1,
      cachePlan: { stableSegments: [], reusablePrefix: "", currentTurn: "", reusedContextChars: 0, addedContextChars: 0, profileGeneration: 1 },
    });
    const s1 = baseSession("s1", "会话一");
    const s2 = baseSession("s2", "会话二");
    await store.saveSnapshot({
      schemaVersion: 3,
      productVersion: "3.0.1",
      activeSessionId: "s1",
      sessions: [s1, s2],
    });

    const probe = new DatabaseSync(join(root, "harness.sqlite"));
    const mode = (probe.prepare("PRAGMA journal_mode").get() as { journal_mode?: string })?.journal_mode;
    probe.close();
    assert.equal(String(mode).toLowerCase(), "wal");

    // Mutate only s1 via commitEvent; s2's messages row must remain untouched
    const updatedS1 = { ...s1, title: "会话一已更新", updatedAt: 2 };
    const receipt = await store.commitEvent(
      { id: "ev-1", sessionId: "s1", type: "session.updated", timestamp: 2, payload: { title: "会话一已更新" } },
      { schemaVersion: 3, productVersion: "3.0.1", activeSessionId: "s1", sessions: [updatedS1, s2] },
    );
    assert.equal(receipt.duplicate, false);
    const loaded = await store.load();
    assert.equal(loaded?.application.sessions.find((s) => s.id === "s1")?.title, "会话一已更新");
    assert.equal(loaded?.application.sessions.find((s) => s.id === "s2")?.messages[0].text, "hello");
    await store.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("streaming chunked Markdown matches full non-streaming output on long math prose", () => {
  const ctx = vm.createContext({ console, atob });
  for (const file of ["vendor/markdown-it.js", "vendor/katex/katex.min.js", "conversation-markdown.js"]) {
    vm.runInContext(readFileSync(`resources/viniper-ui/static/${file}`, "utf8"), ctx);
  }
  const paragraphs = Array.from({ length: 18 }, (_, i) =>
    `第 ${i + 1} 步：由导数 $f'(x)=e^x+\\frac{1}{x}-5$ 知区间单调性成立，代入端点得 $f(${i + 1})=${i * i + 1}$。这是一段完整且独立的推导说明文字，用于跨越流式分块阈值。`
  ).join("\n\n");
  const full = ctx.ViniperMarkdown.render(paragraphs, { streaming: false });
  const streamed = ctx.ViniperMarkdown.render(paragraphs, { streaming: true });
  assert.equal(streamed, full);
});

test("waiting placeholder and thought progress labels render cleanly during prefill and after completion", () => {
  const ctx = vm.createContext({ URLSearchParams, console, atob, fetch: async () => ({ ok: true, json: async () => ({ ok: true }) }) });
  for (const file of ["vendor/markdown-it.js", "vendor/katex/katex.min.js", "conversation-markdown.js"]) {
    vm.runInContext(readFileSync(`resources/viniper-ui/static/${file}`, "utf8"), ctx);
  }
  for (const file of ["api", "icons", "conversation"]) {
    const source = readFileSync(`resources/viniper-ui/static/v2/${file}.js`, "utf8").replace(/^import .*;\s*$/gm, "").replace(/\bexport /g, "");
    vm.runInContext(source, ctx);
  }
  const prefillHtml = ctx.messageHtml({
    role: "assistant",
    content: "",
    thinking: "",
    segments: [],
    streaming: true,
    working: "正在读入上下文",
    elapsed: 25,
  });
  assert.match(prefillHtml, /waiting-placeholder/);
  assert.match(prefillHtml, /25 秒/);
  assert.match(prefillHtml, /本地模型首段推理/);

  const thinkingHtml = ctx.messageHtml({
    role: "assistant",
    content: "",
    thinking: "推导分析".repeat(300),
    segments: [{ type: "thinking", content: "推导分析".repeat(300) }],
    streaming: true,
    working: "正在思考",
    elapsed: 14,
  });
  assert.match(thinkingHtml, /正在思考 · 14 秒 · 1\.2k 字/);

  const finishedHtml = ctx.messageHtml({
    role: "assistant",
    content: "最终结论为 $a=0$。",
    thinking: "已核对端点。",
    thinking_elapsed_seconds: 38,
    elapsed_seconds: 42,
    streaming: false,
  });
  assert.match(finishedHtml, /思考过程 · 38 秒/);
});
