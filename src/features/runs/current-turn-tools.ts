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

/** Specialized schemas are advertised only when the task uses that document family. */
export function relevantFileTools(text: string, tools: ProviderToolDefinition[], vision = false): ProviderToolDefinition[] {
  const docx = /\.docx\b|\bDOCX\b|Word\s*文档/iu.test(text);
  const sqlite = /\.sqlite(?:3)?\b|\bSQLite\b|\.db\b/iu.test(text);
  const handout = /file\.math\.handout\b|(?:制作|生成|创建|整理|编写|设计|排版|排成).{0,24}(?:讲义|师生|学生版|教师版)|(?:讲义|师生|学生版|教师版).{0,16}(?:制作|生成|排版)|\b(?:create|generate|format)\b.{0,30}\b(?:handout|worksheet)\b/iu.test(text);
  const pdf = handout || /\.pdf\b|\bPDF\b|排版|版式|页面/iu.test(text);
  // Page verification starts before the PDF has been rendered into images.
  const image = vision && /\.(?:png|jpe?g|webp|pdf)\b|图片|图像|截图|页面|版式|排版/iu.test(text);
  return tools.filter((tool) => (!tool.name.startsWith("file.docx.") || docx)
    && (!tool.name.startsWith("file.sqlite.") || sqlite)
    && (!tool.name.startsWith("file.pdf.") || pdf)
    && (tool.name !== "file.math.handout" || handout)
    && (tool.name !== "file.image.analyze" || image));
}
