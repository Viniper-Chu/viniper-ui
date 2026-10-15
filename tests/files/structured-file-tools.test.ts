import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { createStructuredFileTools } from "../../src/features/files/structured-file-tools";
import { LocalFileHelperHost } from "../../src/platform/process/local-file-helper-host";
import { decideToolPermission } from "../../src/features/permissions/permission-policy";
import { createFileTools } from "../../src/features/files/file-tools";

test("Harness DOCX and SQLite tools preserve parts, bind literal values, roll back and retain commit receipts", async () => {
  const maintenance = join(process.cwd(), "codex", "运行残留");
  await mkdir(maintenance, { recursive: true });
  const root = await mkdtemp(join(maintenance, "structured-files-"));
  const python = process.env.VINIPER_HARNESS_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  const tools = createStructuredFileTools(new LocalFileHelperHost(join(process.cwd(), "agent-helpers"), python));
  const context = { sessionId: "s", runId: "r", signal: new AbortController().signal };
  const call = async (name: string, input: Record<string, unknown>) => {
    const tool = tools.find((item) => item.name === `file.${name}`)!;
    const request = { id: name, name: tool.name, input, readOnly: tool.readOnly, scope: "computer" as const, summary: name };
    if (!tool.readOnly) assert.equal(decideToolPermission("auto", request).allowed, false);
    const result = await tool.execute(request, context);
    return { result, data: result.data as any };
  };
  try {
    execFileSync(python, ["-I", "-c", String.raw`
from pathlib import Path
from zipfile import ZipFile
import sqlite3,sys
root=Path(sys.argv[1])
with sqlite3.connect(root/'中文 库.sqlite') as con:
 con.executescript('CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT, qty INTEGER CHECK(qty>=0)); INSERT INTO notes VALUES(1,"old",4); INSERT INTO notes VALUES(2,"keep",0);')
with ZipFile(root/'中文 文档.docx','w') as z:
 z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>保留标题</w:t></w:r></w:p><w:p><w:r><w:rPr><w:i/></w:rPr><w:t>旧文字</w:t></w:r><w:r><w:t>后缀</w:t></w:r></w:p><w:p><w:r><w:rPr><w:i/></w:rPr><w:t>待</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>核查</w:t></w:r></w:p></w:body></w:document>')
 z.writestr('customXml/item1.xml','DO_NOT_DROP')
`, root]);
    const docx = join(root, "中文 文档.docx"), db = join(root, "中文 库.sqlite");
    const inspected = (await call("docx.inspect", { path: docx })).data;
    assert.equal(inspected.paragraphs[1].text, "旧文字后缀");
    assert.equal(inspected.paragraphs[0].style_id, "Title");
    assert.match(inspected.paragraph_indexing, /include titles and headings/u);
    const edit = (await call("docx.edit", { path: docx, paragraph: 1, expect: "旧文字后缀", runs: { "0": "O'Brien $HOME `literal` 新文字" } })).data;
    assert.equal(edit.verified, true);
    assert.equal(edit.text, "O'Brien $HOME `literal` 新文字后缀");
    execFileSync(python, ["-I", "-c", "from zipfile import ZipFile; import sys; z=ZipFile(sys.argv[1]); assert z.read('customXml/item1.xml')==b'DO_NOT_DROP'; assert b'<w:i/>' in z.read('word/document.xml')", docx]);
    const replacement = await call("docx.replace", { path: docx, paragraph: 2, expect: "待核查", old_text: "待核查", new_text: "已确认" });
    assert.equal(replacement.data.verified, true);
    assert.match(replacement.result.displayText!, /待核查 → 已确认/u);
    const changed = (await call("docx.inspect", { path: docx })).data.paragraphs[2];
    assert.deepEqual(changed.runs.map((run: any) => run.text), ["已", "确认"]);
    assert.match(changed.runs[0].rpr_xml, /<w:i\//u);
    assert.match(changed.runs[1].rpr_xml, /<w:b\//u);
    const unchanged = await readFile(docx);
    assert.equal((await call("docx.replace", { path: docx, paragraph: 2, expect: "已确认", old_text: "已确认", new_text: "审核已经完成" })).result.isError, true);
    assert.deepEqual(await readFile(docx), unchanged);
    const before = await readFile(docx);
    const plainWrite = createFileTools({ open: async (path) => ({ ok: true, path }) }).find((tool) => tool.name === "file.write")!;
    assert.equal((await plainWrite.execute({ id: "wrong-format", name: plainWrite.name, summary: "write", scope: "computer", readOnly: false, input: { path: docx, content: "bad text", mode: "replace" } }, context)).isError, true);
    assert.deepEqual(await readFile(docx), before);
    assert.equal((await call("docx.edit", { path: docx, paragraph: 1, expect: "wrong", runs: { "0": "bad" } })).result.isError, true);
    assert.deepEqual(await readFile(docx), before);
    assert.ok((await call("sqlite.inspect", { path: db })).data.schema[0].sql.includes("notes"));
    const literal = "O'Brien $HOME `literal` 中文";
    const applied = (await call("sqlite.apply", { path: db, transactions: [
      { allow_failure: true, statements: [{ sql: "UPDATE notes SET qty=-1 WHERE id=?", params: [1], expect_rows: 1 }] },
      { statements: [{ sql: "UPDATE notes SET body=?,qty=qty-? WHERE id=?", params: [literal, 2, 1], expect_rows: 1 }] },
    ], queries: [{ sql: "SELECT * FROM notes ORDER BY id" }] })).data;
    assert.deepEqual(applied.transactions.map((item: any) => item.status), ["rolled_back", "committed"]);
    assert.deepEqual(applied.readback[0].rows, [[1, literal, 2], [2, "keep", 0]]);
    const failedRead = (await call("sqlite.apply", { path: db, transactions: [{ statements: [{ sql: "UPDATE notes SET qty=qty+1 WHERE id=1", expect_rows: 1 }] }], queries: [{ sql: "SELECT missing FROM notes" }] })).data;
    assert.equal(failedRead.ok, false);
    assert.equal(failedRead.transactions[0].status, "committed");
    assert.deepEqual((await call("sqlite.query", { path: db, queries: [{ sql: "SELECT qty FROM notes WHERE id=1" }] })).data.results[0].rows, [[3]]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Harness exposes omitted DOCX formula objects in both model and visible receipts", async () => {
  const maintenance = join(process.cwd(), "codex", "运行残留");
  await mkdir(maintenance, { recursive: true });
  const root = await mkdtemp(join(maintenance, "docx-coverage-"));
  const python = process.env.VINIPER_HARNESS_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  const path = join(root, "公式题.docx");
  try {
    execFileSync(python, ["-I", "-c", String.raw`
from zipfile import ZipFile
import sys
with ZipFile(sys.argv[1],'w') as z:
 z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:o="urn:schemas-microsoft-com:office:office"><w:body><w:p><w:r><w:t>已知</w:t><w:drawing/><w:object><o:OLEObject/></w:object></w:r><m:oMath><m:r><m:t>x=2</m:t></m:r></m:oMath></w:p></w:body></w:document>')
`, path]);
    const tool = createStructuredFileTools(new LocalFileHelperHost(join(process.cwd(), "agent-helpers"), python)).find((item) => item.name === "file.docx.inspect")!;
    const result = await tool.execute({ id: "inspect", name: tool.name, input: { path }, readOnly: true, scope: "computer", summary: "read" }, { sessionId: "s", runId: "r", signal: new AbortController().signal });
    assert.equal(result.isError, false);
    for (const text of [result.text, result.displayText!]) {
      const receipt = JSON.parse(text);
      assert.equal(receipt.paragraphs[0].text, "已知");
      assert.equal(receipt.content_coverage.ole_objects, 1);
      assert.equal(receipt.content_coverage.office_math, 1);
      assert.equal(receipt.content_coverage.drawings, 1);
      assert.equal(receipt.content_coverage.text_only_incomplete, true);
      assert.match(receipt.content_coverage.warning, /不能据此认定原题完整/u);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
