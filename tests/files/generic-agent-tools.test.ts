import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
