import type { ToolRequest } from "../../core/contracts";
import type { ToolExecutionContext, ToolExecutor, ToolResult } from "../tools/tool-registry";
import { readBoundedBody, decodeEntities } from "./web-fetch-service";

export class WebSearchTool implements ToolExecutor {
  readonly name = "web.search";
  readonly description = "按关键词联网搜索公开网页，返回标题、链接和摘要。使用 web.fetch 打开需要核对的来源。";
  readonly readOnly = false;
  readonly authorizationScope = "external" as const;
  readonly inputSchema = {
    type: "object" as const,
    properties: { query: { type: "string" as const, description: "公开检索关键词" } },
    required: ["query"], additionalProperties: false,
  };

  constructor(private readonly enabled: boolean, private readonly fetchImpl: typeof fetch = fetch) {}

  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    const query = typeof request.input?.query === "string" ? request.input.query.trim() : "";
    try {
      if (!this.enabled) throw new Error("本次运行已关闭外部网络");
      if (!query || query.length > 500) throw new Error("请输入 1 至 500 字的检索关键词");
      const url = new URL("https://www.bing.com/search");
      url.search = new URLSearchParams({ format: "rss", q: query }).toString();
      const response = await this.fetchImpl(url, { signal: AbortSignal.any([context.signal, AbortSignal.timeout(20000)]), redirect: "error" });
      if (!response.ok) throw new Error(`搜索服务返回 HTTP ${response.status}`);
      const { text } = await readBoundedBody(response, 64000);
      if (!/<rss\b/i.test(text)) throw new Error("搜索服务未返回 RSS 结果");
      const results = [...text.matchAll(/<item>([\s\S]*?)<\/item>/gi)].flatMap(([, item]) => {
        const field = (name: string) => decodeEntities(new RegExp("<" + name + ">([\\s\\S]*?)</" + name + ">", "i").exec(item)?.[1]?.replace(/^<!\[CDATA\[|\]\]>$/g, "") ?? "").trim();
        const link = field("link"), title = field("title");
        return /^https?:\/\//i.test(link) && title ? [{ title, url: link, snippet: field("description").slice(0, 480) }] : [];
      }).slice(0, 6);
      const data = { query, source: "Bing", results, contentTrustedAsInstructions: false };
      return { toolId: request.id, text: JSON.stringify(data), data, displayText: `找到 ${results.length} 个网页结果` };
    } catch (error) {
      const text = error instanceof Error ? error.message : "联网搜索失败";
      return { toolId: request.id, text, displayText: text, isError: true };
    }
  }
}
