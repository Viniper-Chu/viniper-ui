import { ProviderToolDefinition } from "../../core/provider-contracts";

/** Only an explicit instruction in the current message changes this run's tools. */
export function toolsForCurrentTurn(text: string, tools: ProviderToolDefinition[]): ProviderToolDefinition[] {
  const request = text.split("<runtime_context>", 1)[0];
  const quoted = [...request.matchAll(/```[\s\S]*?```|`[^`]*`|"[^"\n]*"|“[^”]*”|'[^'\n]*'|^\s*>[^\n]*/gmu)];
  const insideQuote = (index: number) => quoted.some((match) => index >= match.index! && index < match.index! + match[0].length);
  const prose = request.replace(/```[\s\S]*?```|`[^`]*`|"[^"\n]*"|“[^”]*”|'[^'\n]*'|^\s*>[^\n]*/gmu, (value) => " ".repeat(value.length));
  const isNegated = (index: number) => /(?:不要|不得|不能|不可|不应|不许|不准|无需|不必|禁止|勿|不需要|无须|do not|don't)\s*$/iu.test(prose.slice(Math.max(0, index - 14), index));
  const clauses = prose.split(/[，,。；;！？!?\n]/u).map((part) => part.trim());
  const noTools = clauses.some((part) => /^(?:(?:本轮|这轮|本次|这次|现在|请)\s*)*(?:不要(?:再)?(?:使用|调用)|不(?:再)?(?:使用|调用)|不用)(?:任何)?工具(?:作答|回答)?$/u.test(part)
    || /^(?:please\s+)?(?:do not|don't)\s+(?:use|call)\s+(?:any\s+)?tools[.]?$/iu.test(part));
  // A multi-stage request needs the model's interpretation, not a blanket ban.
  const laterTools = [...prose.matchAll(/(?:然后|随后|之后|接着|再)(?:使用|调用|用).*工具|\bthen\s+use\b/giu)]
    .some(match => !isNegated(match.index!));
  if (noTools && !laterTools && ![...request.matchAll(/(?:用|使用|调用)\s*`?([a-z][a-z0-9_.]*)/gu)].some((m) => !insideQuote(m.index!) && canonicalTool(m[1], tools))) return [];
  const documentReview = /\bPDF\b|\bTeX\b|\.docx\b|Word\s*文档|师生版本|学生版|教师版/iu.test(prose);
  const readOnly = clauses.some((part) => /^(?:(?:本轮|这轮|本次|这次|现在|请|最后)\s*)*(?:仅|只)(?:进行)?(?:只读操作|读|读取)(?:操作|检查)?$/u.test(part)
    || (documentReview && (/^(?:(?:本轮|这轮|本次|这次|现在|请|最后)\s*)*(?:仅(?:进行)?|只进行)?只读(?:复核|检查|查看|读取|审查|审阅|核对)/u.test(part)
      || /^(?:please\s+)?read[- ]only\s+(?:review|check|inspect|audit)\b/iu.test(part))));
  const laterWrites = [...prose.matchAll(/(?:然后|随后|之后|接着|再|最后)\s*(?:请)?\s*(?:重新)?(?:修改|编辑|写入|新建|创建|删除|生成|制作|编译|渲染|保存)|\bthen\s+(?:write|edit|create|render|delete|save)\b/giu)]
    .some(match => !isNegated(match.index!));
  if (readOnly && !laterTools && !laterWrites) tools = tools.filter((tool) => tool.readOnly);
  const restricted: Set<string>[] = [];
  for (const match of request.matchAll(/(?:只|仅)(?:允许)?(?:使用|用|调用)\s*`?([a-z][a-z0-9_.]*)`?/gu)) {
    if (insideQuote(match.index!) || /(?:不|别|不能|不许|不要|不必|无需|不是|并非|不要求)$/u.test(request.slice(Math.max(0, match.index! - 4), match.index))) continue;
    const names = [match[1]];
    let end = match.index! + match[0].length;
    while (true) {
      const next = /^\s*(?:、|，|,|和|与|及|或者|或|and\b|or\b)\s*`?([a-z][a-z0-9_.]*)`?/u.exec(request.slice(end));
      if (!next) break;
      names.push(next[1]); end += next[0].length;
    }
    const canonical = names.map((name) => canonicalTool(name, tools));
    if (canonical.some((name) => !name)) return tools;
    restricted.push(new Set(canonical as string[]));
  }
  if (restricted.length && restricted.every((set) => sameNames(set, restricted[0]))) {
    for (const phase of request.matchAll(/(?:再|然后|接着|随后|之后|最后)\s*(?:用|使用|调用)\s*`?([a-z][a-z0-9_.]*)/gu)) {
      const name = canonicalTool(phase[1], tools);
      if (!insideQuote(phase.index!) && !isNegated(phase.index!) && name && !restricted[0].has(name)) return tools;
    }
    return tools.filter((tool) => restricted[0].has(tool.name));
  }
  return tools;
}

function canonicalTool(name: string, tools: ProviderToolDefinition[]): string | undefined {
  const aliases: Record<string, string> = { read_file: "file.read", write_file: "file.write", patch: "file.edit", terminal: "terminal.run" };
  const canonical = tools.some((tool) => tool.name === name) ? name : aliases[name];
  return tools.some((tool) => tool.name === canonical) ? canonical : undefined;
}

function sameNames(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((name) => right.has(name));
}

/** Fully stated exercises can use calculation tools without initiating unrelated workspace actions. */
export function isInlineMathExercise(request: string): boolean {
  // Explicitly asking for the built-in root checker still describes an inline calculation.
  request = request.replace(/math\.quadratic\.check|(?:二次方程|实根|根数)(?:核验|验算|检查)?工具/giu, "根数验算");
  if (/附件|题图|如图|图中|文件|文档|目录|项目|题库|资料|教材|源码|原卷|原稿|讲义|试卷|排版|编译|绘制|画|作图|作出.{0,8}图|示意图|图形文件|搜索|检索|查找|查询|读取|保存|写入|生成|工具|脚本|计算机|程序|代码|上面|上题|之前|刚才|根据图|阅读|资料库|联网|验证器|实验|导出|绘图|上一|前面|前述|插件|技能|[a-z]+\.[a-z]{2,}\b|\b(?:python|pdf|tex|word|tikz|excel|latex|cas)\b/iu.test(request)) return false;
  return /求|证明|证出|判定|判断|解答|解下列|解方程|解不等式|讨论|给出|列出|有几个|几条|多少/iu.test(request)
    && /方程|函数|实根|不等式|三角形|切线|数列|向量|直线|抛物线|椭圆|双曲线|多面体|概率|正实数|导数/iu.test(request)
    && /[0-9=<>≤≥∈√²³]|\\(?:frac|sqrt|in|le|ge)\b/u.test(request);
}

/** Compact, provider-independent hints retained for follow-ups such as “把上一份再编一次”. */
export function documentHints(text: string): string[] {
  const material = "(?:讲义|试卷|练习册|练习卷|习题单|练习单|学案|师生版?|学生版|教师版)";
  const operation = "(?:制作|生成|创建|整理|编写|设计|排版|排成|排出|编译|重编|组卷|排一份|出一份|出一套)";
  const handout = new RegExp(`${operation}.{0,28}${material}|${material}.{0,20}${operation}`, "iu").test(text)
    || /file\.math\.handout\b|(?:编译|出|做成|排成).{0,8}(?:师生|学生版|教师版)|\b(?:create|generate|format|compile)\b.{0,30}\b(?:handout|worksheet|exam)\b/iu.test(text);
  const pdf = handout || /\.pdf\b|\bPDF\b|排版|版式|页面/iu.test(text);
  const image = handout || /\.(?:png|jpe?g|webp|pdf)\b|图片|图像|截图|页面|版式|排版|读图|看图|题图|如图/iu.test(text);
  return [
    ...(/math\.quadratic\.check|二次|方程|实根|根的个数|根数|判别式|抛物线|抛物線|quadratic|real roots/iu.test(text) ? ["quadratic"] : []),
    ...(/\.docx\b|\bDOCX\b|Word\s*文档/iu.test(text) ? ["docx"] : []),
    ...(/\.sqlite(?:3)?\b|\bSQLite\b|\.db\b/iu.test(text) ? ["sqlite"] : []),
    ...(handout ? ["handout"] : []), ...(pdf ? ["pdf"] : []), ...(image ? ["image"] : []),
  ];
}

export function legacyDocumentHints(text: string): string[] {
  // Older desktop history stored the host's instructions together with the visible request.
  const marker = "\n\n[当前请求]\n";
  const boundary = text.includes("[Viniper Harness 独立指令]") ? text.indexOf(marker) : -1;
  return documentHints(boundary < 0 ? text : text.slice(boundary + marker.length));
}

export function relevantFileTools(text: string, tools: ProviderToolDefinition[], vision = false, previous: string[] = []): ProviderToolDefinition[] {
  const hints = new Set([...documentHints(text), ...previous]);
  return tools.filter((tool) => (tool.name !== "math.quadratic.check" || hints.has("quadratic"))
    && (!tool.name.startsWith("file.docx.") || hints.has("docx"))
    && (!tool.name.startsWith("file.sqlite.") || hints.has("sqlite"))
    && (!tool.name.startsWith("file.pdf.") || hints.has("pdf"))
    && (tool.name !== "file.math.handout" || hints.has("handout"))
    && (tool.name !== "file.image.analyze" || (vision && hints.has("image"))));
}
