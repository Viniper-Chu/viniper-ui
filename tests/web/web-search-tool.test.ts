import test from "node:test";
import assert from "node:assert/strict";
import { WebSearchTool } from "../../src/features/web/web-search-tool";
import type { ToolExecutionContext } from "../../src/features/tools/tool-registry";
const context = { signal: new AbortController().signal } as ToolExecutionContext;
const request = { id: "s", name: "web.search", input: { query: "a & b" }, readOnly: false, summary: "search", scope: "external" as const };
test("web search respects offline mode and returns bounded public RSS results with their provenance", async () => {
  const requests: string[] = [];
  const fetchImpl: typeof fetch = async input => {
    const url = new URL(String(input)); requests.push(url.hostname);
    assert.equal(url.searchParams.get("q"), "a & b");
    return new Response("<rss><channel>" + "<item><title>A &amp; B</title><link>https://example.org/math</link><description>Geometry</description></item>".repeat(9) + "</channel></rss>");
  };
  assert.equal((await new WebSearchTool(false, fetchImpl).execute(request, context)).isError, true);
  assert.equal(requests.length, 0);
  const results = JSON.parse((await new WebSearchTool(true, fetchImpl).execute(request, context)).text);
  assert.deepEqual(requests, ["www.bing.com"]); assert.equal(results.results.length, 6);
  assert.equal(results.results[0].title, "A & B"); assert.equal(results.contentTrustedAsInstructions, false);
});
