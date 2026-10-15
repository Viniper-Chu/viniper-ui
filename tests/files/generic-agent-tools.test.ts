import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createFileTools } from "../../src/features/files/file-tools";

test("generic Viniper file tools expose absolute-path read/write/edit/move/delete consumers", async () => {
  const root = await mkdtemp(join(tmpdir(), "viniper-generic-tools-"));
  const recovery = join(root, "recovery");
  const path = join(root, "desktop.md");
  const moved = join(root, "moved.md");
  const tools = createFileTools({ open: async (value) => ({ ok: true, path: value }) }, { recoveryRoot: recovery });
  assert.deepEqual(tools.map((tool) => tool.name), ["file.open", "file.list", "file.read", "file.write", "file.edit", "file.move", "file.delete"]);
  const context = { sessionId: "s", runId: "r", signal: new AbortController().signal };
  const listed = await tools.find((tool) => tool.name === "file.list")!.execute({ id: "l", name: "file.list", summary: "list", readOnly: true, scope: "computer", input: { path: root } }, context);
  assert.equal(listed.isError, false);
  assert.deepEqual((listed.data as { entries: Array<unknown> }).entries, []);
  const write = await tools.find((tool) => tool.name === "file.write")!.execute({ id: "w", name: "file.write", summary: "write", readOnly: false, scope: "computer", input: { path, content: "alpha\n", mode: "create" } }, context);
  assert.equal(write.isError, false);
  const edit = await tools.find((tool) => tool.name === "file.edit")!.execute({ id: "e", name: "file.edit", summary: "edit", readOnly: false, scope: "computer", input: { path, oldText: "alpha", newText: "beta", expectedMatches: 1 } }, context);
  assert.equal(edit.isError, false);
  assert.equal(await readFile(path, "utf8"), "beta\n");
  const move = await tools.find((tool) => tool.name === "file.move")!.execute({ id: "m", name: "file.move", summary: "move", readOnly: false, scope: "computer", input: { sourcePath: path, targetPath: moved } }, context);
  assert.equal(move.isError, false);
  const remove = await tools.find((tool) => tool.name === "file.delete")!.execute({ id: "d", name: "file.delete", summary: "delete", readOnly: false, scope: "computer", input: { path: moved } }, context);
  assert.equal(remove.isError, false);
  await rm(root, { recursive: true, force: true });
});

test("text read returns a line window and resumes an exact UTF-8 text without dropping characters", async () => {
  const maintenance = join(process.cwd(), "codex", "运行残留");
  await mkdir(maintenance, { recursive: true });
  const root = await mkdtemp(join(maintenance, "file-window-"));
  try {
    const path = join(root, "中文 空格.md");
    const source = "标题\r\n甲😀乙\r\n保留的末行\n";
    await writeFile(path, source);
    const tool = createFileTools({ open: async (value) => ({ ok: true, path: value }) }).find((item) => item.name === "file.read")!;
    const read = async (input: Record<string, unknown>) => tool.execute({ id: "read", name: tool.name, summary: "read", readOnly: true, scope: "computer", input: { path, ...input } }, { sessionId: "s", runId: "r", signal: new AbortController().signal });
    const window = (await read({ startLine: 2, lineCount: 1 })).data as any;
    assert.equal(window.content, "甲😀乙\r\n");
    assert.equal(window.totalLines, 3);
    assert.equal(window.startLine, 2);
    assert.equal(window.truncated, true);
    assert.equal(((await read({ offset: window.nextOffset })).data as any).content, "保留的末行\n");
    let collected = "", offset = 0;
    while (true) {
      const chunk = (await read({ offset, maxChars: 2 })).data as any;
      assert.equal(chunk.content.includes("\uFFFD"), false);
      collected += chunk.content;
      if (!chunk.truncated) break;
      offset = chunk.nextOffset;
    }
    assert.equal(collected, source);
    assert.equal(((await read({ maxChars: source.length })).data as any).truncated, false);
    await writeFile(join(root, "文档.docx"), Buffer.from([80, 75, 0, 1]));
    assert.equal((await read({ path: join(root, "文档.docx") })).isError, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
