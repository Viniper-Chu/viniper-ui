import assert from "node:assert/strict";
import { test } from "node:test";
import { createGitHubRepositoryTools, GitHubRepositoryService } from "../../src/features/web/github-repository-service";

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
}

test("GitHub repository reader verifies identity, README, SKILL, packages and optional release through one ToolRegistry executor", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input); calls.push(url);
    if (url.endsWith("/repos/Viniper-Chu/universal-agent-workflow-skill")) return json({ default_branch: "main", description: "workflow skill" });
    if (url.endsWith("/readme")) return json({ encoding: "base64", content: Buffer.from("README body").toString("base64") });
    if (url.includes("/git/trees/main")) return json({ tree: [{ path: "packages/universal-agent-workflow/SKILL.md" }, { path: "packages/universal-agent-workflow/package.json" }] });
    if (url.includes("/contents/packages/universal-agent-workflow/SKILL.md")) return json({ encoding: "base64", content: Buffer.from("Skill body").toString("base64") });
    if (url.endsWith("/releases/latest")) return json({ tag_name: "v0.1.0" });
    return json({}, 404);
  };
  const tool = createGitHubRepositoryTools(new GitHubRepositoryService(fetchImpl))[0];
  const result = await tool.execute({
    id: "github-1",
    name: tool.name,
    summary: "read public repository",
    readOnly: false,
    scope: "external",
    input: { repository_url: "https://github.com/Viniper-Chu/universal-agent-workflow-skill" },
  }, { runId: "r14", sessionId: "s14", signal: new AbortController().signal });
  const data = result.data as Awaited<ReturnType<GitHubRepositoryService["read"]>>;
  assert.equal(result.isError, false);
  assert.equal(data.repository, "Viniper-Chu/universal-agent-workflow-skill");
  assert.equal(data.readme, "README body");
  assert.equal(data.skillPath, "packages/universal-agent-workflow/SKILL.md");
  assert.equal(data.skillText, "Skill body");
  assert.deepEqual(data.packagePaths, ["packages/universal-agent-workflow/package.json"]);
  assert.equal(data.release.tag, "v0.1.0");
  assert.equal(calls.length, 5);
});

test("GitHub reader classifies rate limit, not found, parse and unsupported repository without login", async () => {
  const limited = new GitHubRepositoryService(async () => json({}, 403, { "x-ratelimit-remaining": "0" }));
  assert.equal((await limited.read("https://github.com/o/r")).error?.class, "rate-limit");
  const missing = new GitHubRepositoryService(async () => json({}, 404));
  assert.equal((await missing.read("https://github.com/o/r")).error?.class, "not-found");
  const malformed = new GitHubRepositoryService(async () => new Response("not-json", { status: 200 }));
  assert.equal((await malformed.read("https://github.com/o/r")).error?.class, "parse");
  assert.equal((await limited.read("https://example.com/o/r")).error?.class, "unsupported-repository");
});
