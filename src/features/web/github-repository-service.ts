import { ToolRequest } from "../../core/contracts";
import { ToolExecutionContext, ToolExecutor, ToolResult } from "../tools/tool-registry";

export type GitHubReadErrorClass = "dns" | "proxy" | "http" | "rate-limit" | "not-found" | "parse" | "unsupported-repository";

export interface GitHubRepositorySnapshot {
  ok: boolean;
  repository: string;
  defaultBranch: string;
  description: string;
  readme: string;
  skillPath: string;
  skillText: string;
  packagePaths: string[];
  release: { available: boolean; tag: string };
  requests: number;
  error?: { class: GitHubReadErrorClass; message: string; status?: number };
}

export class GitHubRepositoryService {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async read(repositoryUrl: string): Promise<GitHubRepositorySnapshot> {
    const parsed = parseRepository(repositoryUrl);
    if (!parsed) return failure(repositoryUrl, 0, "unsupported-repository", "仅支持公开 github.com/<owner>/<repo> 仓库。");
    const repository = `${parsed.owner}/${parsed.repo}`;
    let requests = 0;
    try {
      const request = async (path: string, optional = false): Promise<Response | undefined> => {
        requests += 1;
        const response = await this.fetchImpl(`https://api.github.com/repos/${repository}${path}`, {
          headers: { accept: "application/vnd.github+json", "user-agent": "Viniper-workstation" },
          redirect: "manual",
        });
        if (optional && response.status === 404) return undefined;
        if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
          throw classified("rate-limit", "GitHub 公共 API 速率额度已用尽。", response.status);
        }
        if (response.status === 404) throw classified("not-found", "GitHub 仓库或文件不存在。", response.status);
        if (!response.ok) throw classified("http", `GitHub 返回 HTTP ${response.status}。`, response.status);
        return response;
      };
      const metadata = await jsonObject(await request(""));
      const defaultBranch = stringValue(metadata.default_branch) || "main";
      const readmeDoc = await jsonObject(await request("/readme"));
      const readme = decodeGitHubContent(readmeDoc);
      const treeDoc = await jsonObject(await request(`/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`));
      const paths = Array.isArray(treeDoc.tree)
        ? treeDoc.tree.map((entry) => stringValue((entry as Record<string, unknown>).path)).filter(Boolean)
        : [];
      const skillPath = paths.find((path) => /(?:^|\/)SKILL\.md$/iu.test(path)) ?? "";
      if (!skillPath) throw classified("parse", "仓库树中未找到 SKILL.md。", 200);
      const skillDoc = await jsonObject(await request(`/contents/${skillPath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(defaultBranch)}`));
      const releaseResponse = await request("/releases/latest", true);
      const releaseDoc = releaseResponse ? await jsonObject(releaseResponse) : {};
      return {
        ok: true,
        repository,
        defaultBranch,
        description: stringValue(metadata.description),
        readme,
        skillPath,
        skillText: decodeGitHubContent(skillDoc),
        packagePaths: paths.filter((path) => /(?:^|\/)(?:package\.json|pyproject\.toml|[^/]+\.zip)$/iu.test(path)).slice(0, 32),
        release: { available: Boolean(releaseResponse), tag: stringValue(releaseDoc.tag_name) },
        requests,
      };
    } catch (error) {
      const detail = classifyFailure(error);
      return { ...failure(repository, requests, detail.class, detail.message, detail.status), repository };
    }
  }
}

export function createGitHubRepositoryTools(service: GitHubRepositoryService): ToolExecutor[] {
  return [new GitHubRepositoryReadTool(service)];
}

class GitHubRepositoryReadTool implements ToolExecutor {
  readonly name = "github.repository.read";
  readonly description = "读取公开 GitHub 仓库元数据、README、SKILL.md、package 路径与最新 release 状态；无需登录且不会写入 GitHub。";
  readonly readOnly = false;
  readonly authorizationScope = "external" as const;
  readonly inputSchema = {
    type: "object" as const,
    properties: { repository_url: { type: "string" as const, description: "公开 github.com/<owner>/<repo> URL" } },
    required: ["repository_url"],
    additionalProperties: false,
  };

  constructor(private readonly service: GitHubRepositoryService) {}

  async execute(request: ToolRequest, _context: ToolExecutionContext): Promise<ToolResult> {
    const snapshot = await this.service.read(String((request.input as { repository_url?: unknown })?.repository_url ?? ""));
    return {
      toolId: request.id,
      text: JSON.stringify(snapshot),
      data: snapshot,
      displayText: snapshot.ok
        ? `已读取 GitHub 仓库：${snapshot.repository} · ${snapshot.defaultBranch} · ${snapshot.requests} 个公开请求。`
        : snapshot.error?.message ?? "GitHub 仓库读取失败。",
      isError: !snapshot.ok,
    };
  }
}

function parseRepository(value: string): { owner: string; repo: string } | undefined {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.hostname.toLocaleLowerCase() !== "github.com") return undefined;
    const [owner, rawRepo] = url.pathname.split("/").filter(Boolean);
    const repo = rawRepo?.replace(/\.git$/iu, "");
    return owner && repo && /^[A-Za-z0-9_.-]+$/u.test(owner) && /^[A-Za-z0-9_.-]+$/u.test(repo) ? { owner, repo } : undefined;
  } catch { return undefined; }
}

async function jsonObject(response: Response | undefined): Promise<Record<string, unknown>> {
  if (!response) return {};
  try {
    const value = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not-object");
    return value as Record<string, unknown>;
  } catch { throw classified("parse", "GitHub JSON 响应无法解析。", response.status); }
}

function decodeGitHubContent(value: Record<string, unknown>): string {
  const encoded = stringValue(value.content).replace(/\s+/gu, "");
  if (!encoded || stringValue(value.encoding) !== "base64") throw classified("parse", "GitHub 文件内容缺失或编码不受支持。", 200);
  return Buffer.from(encoded, "base64").toString("utf8").slice(0, 64_000);
}

function classified(kind: GitHubReadErrorClass, message: string, status?: number): Error {
  return Object.assign(new Error(message), { githubClass: kind, githubStatus: status });
}

function classifyFailure(error: unknown): { class: GitHubReadErrorClass; message: string; status?: number } {
  const value = error as { githubClass?: GitHubReadErrorClass; githubStatus?: number; message?: string; cause?: { code?: string } };
  if (value.githubClass) return { class: value.githubClass, message: value.message ?? value.githubClass, status: value.githubStatus };
  const code = String(value.cause?.code ?? "").toUpperCase();
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) return { class: "dns", message: "GitHub DNS 解析失败。" };
  if (["ECONNREFUSED", "ECONNRESET", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) return { class: "proxy", message: "GitHub 代理或网络连接失败。" };
  return { class: "http", message: "GitHub 网络请求失败。" };
}

function failure(repository: string, requests: number, kind: GitHubReadErrorClass, message: string, status?: number): GitHubRepositorySnapshot {
  return { ok: false, repository, defaultBranch: "", description: "", readme: "", skillPath: "", skillText: "", packagePaths: [], release: { available: false, tag: "" }, requests, error: { class: kind, message, ...(status ? { status } : {}) } };
}

function stringValue(value: unknown): string { return typeof value === "string" ? value : ""; }
