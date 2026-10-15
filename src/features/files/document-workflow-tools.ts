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
    description: "制作独立短师生数学讲义，直接传结构化题目，勿再把 JSON 拼进终端命令。先读完整原稿及实际规范；使用已安装模板完成 A4/20mm/12pt18pt、三字体、学生留白、教师黑题红解、真实页码映射、编译与每页 PNG。保留完整原解，不替模型解题。成功仅代表编译和渲染；须用 file.image.analyze 逐页检查后才报告页面通过。现有项目的专用模板继续用其编译入口。",
    inputSchema: { type: "object", properties: {
      directory: { type: "string", description: "已存在且位于当前工作目录内的输出目录；省略使用当前工作目录。" },
      title_tex: { type: "string", description: "讲义标题，不含文档模板。" },
      student_name: { type: "string", description: "学生版文件名，不带目录和.pdf。" },
      teacher_name: { type: "string", description: "教师版文件名，不带目录和.pdf。" },
      answer_space_cm: { type: "number", description: "每题连续作答空间厘米数，按用户要求提供，默认6。" },
      questions: { type: "array", description: "按原稿顺序的全部题目，每项 {question_tex:完整题干,answer_tex:答案,solution_tex:完整原解的段落字符串数组}。也支持solution_tex为字符串。TeX反斜杠按JSON转义；不传documentclass或宏模板。" },
    }, required: ["title_tex", "student_name", "teacher_name", "questions"], additionalProperties: false } satisfies JsonSchema,
    resourceClaims(request, context) { return [{ key: resolve(context.taskDirectory ?? context.projectRoot ?? ".", String(request.input?.directory ?? ".")), access: "write" }]; },
    async execute(request, context) {
      try {
        const directory = await taskDirectory(context, request.input?.directory);
        const data = await host.execute("handout", { ...request.input, directory }, context.signal);
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
