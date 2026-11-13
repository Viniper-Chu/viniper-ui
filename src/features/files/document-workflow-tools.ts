import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { JsonSchema } from "../../core/provider-contracts";
import type { ToolExecutionContext, ToolExecutor, ToolResult } from "../tools/tool-registry";

export interface DocumentWorkflowHost {
  available(operation: "handout" | "pdf"): boolean;
  execute(operation: "handout" | "pdf", input: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, any>>;
}

async function taskDirectory(context: ToolExecutionContext, requested?: unknown): Promise<string> {
  const current = context.taskDirectory ?? context.projectRoot;
  if (!current) throw new Error("请先选择本次任务的工作目录。");
  const root = await realpath(current);
  const target = requested === undefined ? root : await realpath(resolve(root, String(requested)));
  const delta = relative(root, target);
  if (delta === ".." || delta.startsWith("../") || isAbsolute(delta)) throw new Error("输出目录必须在本次任务的工作目录内。");
  return target;
}

function receipt(toolId: string, data: Record<string, any>): ToolResult {
  const ok = data.success === true;
  return { toolId, text: JSON.stringify(data), data, displayText: JSON.stringify(data, null, 2), isError: !ok };
}

export function createDocumentWorkflowTools(host: DocumentWorkflowHost): ToolExecutor[] {
  const tools: ToolExecutor[] = [];
  if (host.available("handout")) tools.push({
    name: "file.math.handout", readOnly: false, authorizationScope: "computer",
    description: "生成师生数学文档。长文档先逐题写入JSON/JSONL文件，再传questions_file与原计划expected_question_count；不要把整份长题解塞进一次调用，不得减题或删原解。章节用sections，题干不重复写题号。先读实际规范、完整题源并独立验算；编译成功不是内容验收，须核对范围、题量、完整解析和每页图。现有项目继续用其编译入口。",
    inputSchema: { type: "object", properties: {
      directory: { type: "string", description: "已存在且位于当前工作目录内的输出目录；省略使用当前工作目录。" },
      title_tex: { type: "string", description: "讲义标题，不含文档模板。" },
      student_name: { type: "string", description: "学生版文件名，不带目录和.pdf。" },
      teacher_name: { type: "string", description: "教师版文件名，不带目录和.pdf。" },
      answer_space_cm: { type: "number", description: "每题连续作答空间厘米数，按用户要求提供，默认6。" },
      questions: { type: "array", description: "按原稿顺序的全部题目，每项 {question_tex:完整题干,answer_tex:答案,solution_tex:完整原解的段落字符串数组}。也支持solution_tex字符串；可选figure_tex为两版共用的完整TeX题图，solution_figure_tex仅在教师版解析后出现。可用完整tikzpicture环境，不传文档模板。" },
      questions_file: { type: "string", description: "完整绝对路径，UTF-8 .json题目数组或.jsonl逐行题目，字段与questions相同；先分批写完，与questions二选一。" },
      expected_question_count: { type: "number", description: "原组卷计划的正整数题数。文件模式必填；不得在截断后降低预期题数。" },
      sections: { type: "array", description: "独立分节数组：{before_question:实际题号从1起,title_tex:章节标题}。标题不放入questions，不算题目。" },
    }, required: ["title_tex", "student_name", "teacher_name"], additionalProperties: false } satisfies JsonSchema,
    resourceClaims(request, context) {
      return [{ key: resolve(context.taskDirectory ?? context.projectRoot ?? ".", String(request.input?.directory ?? ".")), access: "write" as const },
        ...(typeof request.input?.questions_file === "string" ? [{ key: resolve(request.input.questions_file), access: "read" as const }] : [])];
    },
    async execute(request, context) {
      try {
        const directory = await taskDirectory(context, request.input?.directory);
        const input: Record<string, unknown> = { ...request.input, directory };
        if (Object.hasOwn(input, "questions") === Object.hasOwn(input, "questions_file")) throw new Error("questions与questions_file必须且只能提供一种；不要省略题目。");
        if (input.questions_file !== undefined) {
          if (typeof input.questions_file !== "string" || !isAbsolute(input.questions_file)) throw new Error("questions_file需要已保存的完整绝对路径。");
          if (!Number.isInteger(input.expected_question_count) || Number(input.expected_question_count) <= 0) throw new Error("文件模式必须提供原计划的expected_question_count正整数；不能自动按现有内容降低题数。");
          input.questions_file = await realpath(input.questions_file);
        }
        const data = await host.execute("handout", input, context.signal);
        const result = receipt(request.id, data);
        if (data.success && data.student?.path && data.teacher?.path && Array.isArray(data.sources)) result.presentation = {
          kind: "document-results",
          files: [data.student.path, data.teacher.path, ...data.sources],
          sourceDirectory: data.source_directory,
          sourceDependencies: data.source_dependencies ?? [],
          intermediateDirectories: [...new Set<string>([
            join(directory, "编译维护", "学生编译"), join(directory, "编译维护", "教师编译"),
            ...[...data.student.pages, ...data.teacher.pages].filter(page => page.image).map(page => dirname(page.image)),
          ])],
          intermediateFiles: [],
        };
        return result;
      } catch (error) { return { ...receipt(request.id, { success: false, error: (error as Error).message }), cancelled: context.signal.aborted }; }
    },
  });
  if (host.available("pdf")) tools.push({
    name: "file.pdf.inspect", readOnly: true, authorizationScope: "computer",
    description: "只读提取现有 PDF 的真实页数、页面文字、字体和颜色，不改原文件，不写入图片。按需指定页码。提取不等于看图；优先用file.image.analyze检查已有页面PNG。只读复核不得调用render或重新编译；没有已有页面图时如实说明视觉证据不足，获准写入后才可用file.pdf.render。",
    inputSchema: { type: "object", properties: {
      path: { type: "string", description: "PDF完整绝对路径。" },
      first_page: { type: "number", description: "起始页，从1开始。" },
      last_page: { type: "number", description: "结束页；省略读取至末页。" },
    }, required: ["path"], additionalProperties: false } satisfies JsonSchema,
    async execute(request, context) {
      try {
        const input = request.input ?? {};
        if (typeof input.path !== "string" || !isAbsolute(input.path)) throw new Error("请提供已有 PDF 的完整绝对路径。");
        return receipt(request.id, await host.execute("pdf", {
          path: input.path, first_page: input.first_page, last_page: input.last_page,
        }, context.signal));
      } catch (error) { return { ...receipt(request.id, { success: false, error: (error as Error).message }), cancelled: context.signal.aborted }; }
    },
  });
  if (host.available("pdf")) tools.push({
    name: "file.pdf.render", readOnly: false, authorizationScope: "computer",
    description: "将已有 PDF 的指定页面渲染为 PNG，写入当前任务的编译维护区；不修改原 PDF。已有本轮图片不重复渲染，渲染后须用file.image.analyze实际检查。",
    inputSchema: { type: "object", properties: {
      path: { type: "string", description: "PDF完整绝对路径。" },
      first_page: { type: "number", description: "起始页，从1开始。" },
      last_page: { type: "number", description: "结束页；省略读取至末页。" },
    }, required: ["path"], additionalProperties: false } satisfies JsonSchema,
    async execute(request, context) {
      try {
        const input = request.input ?? {};
        if (typeof input.path !== "string" || !isAbsolute(input.path)) throw new Error("请提供已有 PDF 的完整绝对路径。");
        const root = await taskDirectory(context);
        const output_dir = join(root, "编译维护", "PDF检查", context.runId.replace(/[^a-zA-Z0-9_-]/g, "_"), request.id.replace(/[^a-zA-Z0-9_-]/g, "_"), basename(input.path, ".pdf"));
        return receipt(request.id, await host.execute("pdf", { ...input, output_dir }, context.signal));
      } catch (error) { return { ...receipt(request.id, { success: false, error: (error as Error).message }), cancelled: context.signal.aborted }; }
    },
  });
  return tools;
}
