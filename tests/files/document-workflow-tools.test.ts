import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createDocumentWorkflowTools } from "../../src/features/files/document-workflow-tools";
import { LocalDocumentWorkflowHost } from "../../src/platform/process/local-document-workflow-host";
import { relevantFileTools, toolsForCurrentTurn } from "../../src/features/runs/current-turn-tools";
import { ToolRegistry } from "../../src/features/tools/tool-registry";

test("document workflows keep inspection read-only, render in task maintenance, and reject outside output", async () => {
  const maintenance = join(process.cwd(), "codex", "运行残留"); await mkdir(maintenance, { recursive: true });
  const root = await mkdtemp(join(maintenance, "document-scope-"));
  const calls: Array<{ operation: string; input: Record<string, unknown> }> = [];
  const host = { available: () => true, async execute(operation: "handout" | "pdf", input: Record<string, unknown>) { calls.push({ operation, input }); return { success: true }; } };
  const tools = createDocumentWorkflowTools(host), context = { sessionId: "s", runId: "run-1", taskDirectory: root, signal: new AbortController().signal };
  const call = async (name: string, input: Record<string, unknown>) => {
    const tool = tools.find(t => t.name === name)!;
    return tool.execute({ id: name, name, input, readOnly: tool.readOnly, scope: "computer", summary: name }, context);
  };
  try {
    assert.deepEqual(tools.filter(t => t.readOnly).map(t => t.name), ["file.pdf.inspect"]);
    await call("file.pdf.inspect", { path: join(root, "原件.pdf"), first_page: 1, output_dir: "/must-not-forward" });
    assert.equal("output_dir" in calls[0].input, false);
    await call("file.pdf.render", { path: join(root, "原件.pdf"), first_page: 1 });
    assert.ok(String(calls[1].input.output_dir).startsWith(join(root, "编译维护", "PDF检查", "run-1")));
    const denied = await call("file.math.handout", { directory: maintenance });
    assert.equal(denied.isError, true); assert.equal(calls.length, 2);
    await call("file.math.handout", { directory: ".", questions: [] });
    assert.equal(calls[2].input.directory, root);
    assert.equal(tools[0].resourceClaims!({ id: "h", name: "file.math.handout", input: { directory: "." }, readOnly: false, scope: "computer", summary: "create" }, context)[0].key, root);
    const registry = new ToolRegistry(); for (const tool of tools) registry.register(tool);
    registry.register({ name: "file.read", description: "read", readOnly: true, inputSchema: { type: "object" }, async execute(r) { return { toolId: r.id, text: "" }; } });
    const descriptors = registry.descriptors();
    assert.deepEqual(relevantFileTools("你好", descriptors).map(t => t.name), ["file.read"]);
    assert.ok(relevantFileTools("制作师生讲义.pdf", descriptors).some(t => t.name === "file.math.handout"));
    assert.deepEqual(relevantFileTools("检查资料.db中名称为O'Brien的讲义的note", descriptors).map(t => t.name), ["file.read"]);
    assert.deepEqual(toolsForCurrentTurn("只用 file.read 检查讲义.pdf", relevantFileTools("讲义.pdf", descriptors)).map(t => t.name), ["file.read"]);
    assert.deepEqual(createDocumentWorkflowTools({ ...host, available: () => false }), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("document helper host transmits literal JSON without shell quoting and cancels its owned process", { skip: process.platform === "win32" }, async () => {
  const maintenance = join(process.cwd(), "codex", "运行残留"); await mkdir(maintenance, { recursive: true });
  const root = await mkdtemp(join(maintenance, "document-stdin-")), script = join(root, "helper.py");
  await writeFile(script, "import json,sys,time\np=json.load(sys.stdin)\nif p.get('sleep'):time.sleep(20)\nprint(json.dumps({'success':True,'echo':p},ensure_ascii=False))\n");
  const host = new LocalDocumentWorkflowHost({ handout: script, pdf: script });
  try {
    const input = { title_tex: "中文 O'Brien $HOME `literal`", questions: [{ solution_tex: [String.raw`$\frac{1}{2}$`, "第二段\n保留换行"] }] };
    const result = await host.execute("handout", input, new AbortController().signal);
    assert.deepEqual(result.echo, input);
    const control = new AbortController(), pending = host.execute("handout", { sleep: true }, control.signal);
    const timer = setTimeout(() => control.abort(), 50);
    try { await assert.rejects(pending, /已取消/u); } finally { clearTimeout(timer); }
    assert.equal((await host.execute("pdf", { path: "file.pdf" }, new AbortController().signal)).success, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
