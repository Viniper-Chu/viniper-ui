import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { buildTrayMenuTemplate, TraySessionSummary } from "../../src/platform/desktop/tray-menu";

function session(index: number, overrides: Partial<TraySessionSummary> = {}): TraySessionSummary {
  return {
    id: `session-${index}`,
    title: `任务 ${index}`,
    status: "idle",
    unread: false,
    pinned: false,
    updatedAt: index,
    projectName: `项目 ${index}`,
    typeSummary: "Agent",
    ...overrides,
  };
}

test("native tray template has fixed groups, bounded entries and overflow submenus", () => {
  const template = buildTrayMenuTemplate({
    sessions: [
      session(1, { status: "running" }),
      session(2, { status: "queued" }),
      session(3, { status: "waiting" }),
      session(4, { status: "running" }),
      session(5, { unread: true }),
      session(6, { pinned: true }),
      session(7),
    ],
    windowVisible: true,
    onSelect: () => undefined,
    onNewAgent: () => undefined,
    onToggleWindow: () => undefined,
    onQuit: () => undefined,
  });

  const labels = template.map((item) => item.label).filter((label): label is string => typeof label === "string");
  assert.deepEqual(labels.slice(0, 4), ["正在运行", "任务 4 — 项目 4 · Agent", "任务 3 — 项目 3 · Agent", "任务 2 — 项目 2 · Agent"]);
  assert.equal(labels.filter((label) => label === "更多").length, 2);
  assert.deepEqual(labels.slice(-3), ["新建 Agent", "隐藏 Viniper", "完全退出 Viniper"]);
  assert.equal(template.filter((item) => item.type === "separator").length, 4);
  const more = template.find((item) => item.label === "更多");
  assert.ok(more && Array.isArray(more.submenu));
  assert.equal((more.submenu as Array<{ label?: string }>).length, 1);
});

test("empty tray groups are disabled and summary never exposes absolute paths", () => {
  const template = buildTrayMenuTemplate({
    sessions: [session(1, { projectName: "C:\\Users\\person\\secret-project", typeSummary: "Agent" })],
    windowVisible: false,
    onSelect: () => undefined,
    onNewAgent: () => undefined,
    onToggleWindow: () => undefined,
    onQuit: () => undefined,
  });
  const text = JSON.stringify(template, (_key, value) => typeof value === "function" ? "callback" : value);
  assert.match(text, /打开 Viniper/u);
  assert.match(text, /暂无/u);
  assert.doesNotMatch(text, /C:\\\\Users/u);
  assert.doesNotMatch(text, /New Chat|Chats|消息正文|API Key|powershell|git\.commit/u);
  const emptyItems = template.filter((item) => item.label === "暂无");
  assert.equal(emptyItems.length, 3);
  assert.ok(emptyItems.every((item) => item.enabled === false));
});

test("tray actions select, create, toggle and quit through injected callbacks", () => {
  const calls: string[] = [];
  const template = buildTrayMenuTemplate({
    sessions: [session(1)],
    windowVisible: true,
    onSelect: (id) => calls.push(`select:${id}`),
    onNewAgent: () => calls.push("new"),
    onToggleWindow: () => calls.push("toggle"),
    onQuit: () => calls.push("quit"),
  });
  const item = template.find((candidate) => candidate.label === "任务 1 — 项目 1 · Agent");
  assert.ok(item && typeof item.click === "function");
  item.click?.({} as never, {} as never, {} as never);
  template.find((candidate) => candidate.label === "新建 Agent")?.click?.({} as never, {} as never, {} as never);
  template.find((candidate) => candidate.label === "隐藏 Viniper")?.click?.({} as never, {} as never, {} as never);
  template.find((candidate) => candidate.label === "完全退出 Viniper")?.click?.({} as never, {} as never, {} as never);
  assert.deepEqual(calls, ["select:session-1", "new", "toggle", "quit"]);
});

test("desktop host owns one native Tray lifecycle and delegates right-click to setContextMenu", async () => {
  const mainSource = await readFile(join(process.cwd(), "src", "platform", "desktop", "main.ts"), "utf8");
  assert.match(mainSource, /new Tray\(/u);
  assert.match(mainSource, /tray\.setContextMenu\(/u);
  assert.match(mainSource, /tray\.destroy\(/u);
  assert.doesNotMatch(mainSource, /popUpContextMenu|right-click/u);
});
