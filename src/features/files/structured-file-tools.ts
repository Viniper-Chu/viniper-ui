import { isAbsolute, resolve } from "node:path";
import { ToolRequest } from "../../core/contracts";
import { JsonSchema } from "../../core/provider-contracts";
import { ToolExecutionContext, ToolExecutor, ToolResult } from "../tools/tool-registry";

export interface StructuredFileHost {
  execute(operation: string, input: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>>;
}

const pathProperty = { type: "string" as const, description: "已有文件的完整绝对路径，保留中文、空格、引号和完整文件名。" };
const verifiedDocxReadback = "返回 verified=true 表示工具已重新打开文档核验本次修改；没有新修改且用户未另要求独立读取时，不必重复 inspect。后续明确的只读复核仍需执行。";
const queriesProperty = { type: "array" as const, description: '查询数组，每项 {sql:"SELECT ... WHERE id = ?",params:[值]}；值通过绑定参数传入。' };

export function createStructuredFileTools(options: StructuredFileHost): ToolExecutor[] {
  const tool = (operation: string, readOnly: boolean, description: string, properties: NonNullable<JsonSchema["properties"]> = {}, required: string[] = []) =>
    new StructuredFileTool(operation, readOnly, description, { type: "object", properties: { path: pathProperty, ...properties }, required: ["path", ...required], additionalProperties: false }, options);
  return [
    tool("docx.inspect", true, "读取 DOCX 普通文字、表格及带格式的文本 run，返回从 0 开始的位置、style_id 和 content_coverage。段落索引包含标题，不等于正文序号；按样式与内容定位用户所说的正文段落，不能直接用正文序号减一。检测到公式/嵌入对象/图形时文字视图不完整，须核对原页面或已有 TeX，不能据缺失公式的文字编造题目。"),
    tool("docx.replace", false, "优先用此工具局部替换 DOCX 文字。先 inspect 定位真实段落，提供该段完整原文 expect 和待替换 old_text/new_text；自动保留各文本片段的格式并回读。不等长替换跨越多个格式片段时会说明需显式映射，再用 docx.edit。" + verifiedDocxReadback, {
      paragraph: { type: "number", description: "inspect 返回的段落索引，包含标题；不是正文序号。" },
      table: { type: "number", description: "表格索引，修改表格时与 row/col 一起提供。" },
      row: { type: "number", description: "表格行索引。" },
      col: { type: "number", description: "实际单元格索引，不展开合并单元格。" },
      expect: { type: "string", description: "inspect 中目标段落的当前完整文字。" },
      old_text: { type: "string", description: "目标段落中恰好出现一次的原文字。" },
      new_text: { type: "string", description: "替换后的文字，允许为空以删除原文字。" },
    }, ["paragraph", "expect", "old_text", "new_text"]),
    tool("docx.edit", false, "高级格式映射：只在 docx.replace 无法表达所需格式时使用。按 inspect 返回的位置精确修改现有纯文本 run，未列出的格式和包部件保持不变并回读；不新增段落或修改图形。" + verifiedDocxReadback, {
      paragraph: { type: "number", description: "inspect 返回的从 0 开始的真实段落索引，包含标题；不是正文序号。" },
      table: { type: "number", description: "表格索引，修改表格时与 row/col 一起提供。" },
      row: { type: "number", description: "表格行索引。" },
      col: { type: "number", description: "实际单元格索引，不展开合并单元格。" },
      expect: { type: "string", description: "inspect 中该段落当前完整文字，用于精确匹配。" },
      runs: { type: "object", description: '仅列需修改的 run，例如 {"1":"新文字"}；未列的 run 保持不变。' },
    }, ["paragraph", "expect", "runs"]),
    tool("sqlite.inspect", true, "只读检查已有 SQLite 数据库的实际表结构；先读取结构再选择列名。"),
    tool("sqlite.query", true, "通过只读连接查询 SQLite 数据库；使用已核实的列名和绑定参数。与 NULL 用 = 或 <> 比较得到 UNKNOWN（查询结果为 null），不是 FALSE；WHERE 仅保留 TRUE，FALSE 和 UNKNOWN 都过滤。空值常用 IS NULL / IS NOT NULL；x ISNULL、x IS NOT DISTINCT FROM NULL 也合法，IS NULL 不是唯一语法。IS / IS NOT 也可比较非空值。以实际查询结果汇报。", { queries: queriesProperty }, ["queries"]),
    tool("sqlite.apply", false, "参数化增删改已有 SQLite 数据库。每组 statements 独立事务，检查行数、失败回滚；所有事务结束后执行 queries 回读。已提交但回读失败时不要重放事务。", {
      transactions: { type: "array", description: '数组，每组 {statements:[{sql:"UPDATE ...",params:[],expect_rows:1}],allow_failure:false}。仅用户预期的业务失败可设 allow_failure:true。' },
      queries: queriesProperty,
    }, ["transactions", "queries"]),
  ];
}

class StructuredFileTool implements ToolExecutor {
  readonly name: string;
  readonly authorizationScope = "computer" as const;
  constructor(private readonly operation: string, readonly readOnly: boolean, readonly description: string,
    readonly inputSchema: JsonSchema, private readonly options: StructuredFileHost) {
    this.name = `file.${operation}`;
  }

  resourceClaims(request: ToolRequest) {
    return typeof request.input?.path === "string" ? [{ key: resolve(request.input.path), access: this.readOnly ? "read" as const : "write" as const }] : [];
  }

  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    const input = request.input ?? {};
    if (typeof input.path !== "string" || !isAbsolute(input.path)) return this.result(request, { ok: false, error: "需要现有文件的绝对路径。" });
    try {
      const data = await this.options.execute(this.operation, input, context.signal);
      return this.result(request, data);
    } catch (error) {
      return { ...this.result(request, { ok: false, error: error instanceof Error ? error.message : String(error) }), cancelled: context.signal.aborted };
    }
  }

  private result(request: ToolRequest, data: Record<string, unknown>): ToolResult {
    const ok = data.ok === true;
    const detail = ["docx.edit", "docx.replace"].includes(this.operation) && ok ? `${String(data.old_text)} → ${String(data.text)}（已回读）`
      : this.operation === "sqlite.apply" ? JSON.stringify({ transactions: data.transactions, readback: data.readback, readback_error: data.readback_error, error: data.error }, null, 2)
      : ok ? JSON.stringify(data, null, 2) : String(data.error ?? data.readback_error ?? "操作失败，请查看工具回执。");
    return { toolId: request.id, text: JSON.stringify(data), data, displayText: detail, isError: !ok };
  }
}
