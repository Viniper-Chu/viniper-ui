import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ProviderRequest } from "../../core/provider-contracts";

export interface LocalAgentPolicy {
  endpoint: string;
  model: string;
  contextTokens: number;
  compactAtTokens: number;
  outputTokens: number;
  maxIterations: number;
  defaultReasoning: string;
  reasoningBudgets: Record<string, number>;
  parallelToolCalls: boolean;
  structuredToolsJson: boolean;
  proofFirstJson?: boolean;
  helperRevision: string;
  visionEnabled: boolean;
  visionMaxTokens?: number;
  mathOutputGuidance?: string;
  thinkingSampling?: { temperature?: number; top_p?: number; top_k?: number };
}

/** Read only the matching local deployment's public contract, never credentials. */
export function loadLocalAgentPolicy(endpoint: string, path = process.env.VINIPER_LOCAL_AGENT_PROFILE
  ?? join(homedir(), "本地模型", "开发维护", "server-profile.json")): LocalAgentPolicy | undefined {
  try {
    const url = new URL(endpoint);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return undefined;
    const contract = JSON.parse(readFileSync(path, "utf8"));
    if (!contract.endpoint || normalizeEndpoint(endpoint) !== normalizeEndpoint(contract.endpoint)) return undefined;
    const positive = (value: unknown): value is number => Number.isInteger(value) && Number(value) > 0;
    if (![contract.context_tokens, contract.compaction_trigger_tokens, contract.output_limit, contract.max_iterations].every(positive)
      || typeof contract.api_model !== "string") return undefined;
    return {
      endpoint: normalizeEndpoint(endpoint), model: contract.api_model,
      contextTokens: contract.context_tokens, compactAtTokens: contract.compaction_trigger_tokens,
      outputTokens: contract.output_limit, maxIterations: contract.max_iterations,
      defaultReasoning: contract.thinking_control?.default ?? "medium",
      reasoningBudgets: contract.thinking_control?.budget_tokens ?? { low: 256, medium: 512, high_and_above: 1024 },
      parallelToolCalls: contract.parallel_tool_calls === true,
      structuredToolsJson: contract.structured_tools_json === true,
      proofFirstJson: contract.proof_first_json === true,
      helperRevision: String(contract.helper_revision ?? "unavailable"),
      visionEnabled: contract.vision?.enabled === true,
      visionMaxTokens: positive(contract.vision?.image_max_tokens) ? contract.vision.image_max_tokens : undefined,
      mathOutputGuidance: typeof contract.math_output_guidance === "string" ? contract.math_output_guidance : undefined,
      thinkingSampling: contract.thinking_sampling ? Object.fromEntries(["temperature", "top_p", "top_k"]
        .filter((key) => typeof contract.thinking_sampling[key] === "number")
        .map((key) => [key, contract.thinking_sampling[key]])) : undefined,
    };
  } catch { return undefined; }
}

export function localRequestOverrides(request: ProviderRequest, policy?: LocalAgentPolicy): Record<string, unknown> {
  if (!policy || request.selectedModel !== policy.model) return {};
  const effort = request.reasoning || policy.defaultReasoning;
  const thinking = !["off", "none"].includes(effort.toLowerCase());
  const user = [...request.history].reverse().find((entry) => entry.role === "user");
  const text = request.currentUserText ?? user?.items.filter((item) => item.type === "text").map((item) => item.text).join("\n") ?? "";
  const json = requestsStrictJsonObject(text) && (!request.tools.length || policy.structuredToolsJson);
  const proofFirst = json && !request.tools.length && policy.proofFirstJson === true && requestsProofFieldFirst(text);
  return {
    max_tokens: policy.outputTokens,
    reasoning_effort: thinking ? effort : "none",
    reasoning_budget_tokens: thinking ? policy.reasoningBudgets[effort] ?? policy.reasoningBudgets.high_and_above : 0,
    reasoning_format: "deepseek",
    chat_template_kwargs: { enable_thinking: thinking },
    parallel_tool_calls: policy.parallelToolCalls,
    ...(thinking && policy.thinkingSampling ? policy.thinkingSampling : {}),
    ...(json ? { response_format: proofFirst ? { type: "json_schema", json_schema: {
      name: "proof_before_fields", schema: { type: "object", properties: { proof: {} }, required: ["proof"], additionalProperties: true },
    } } : { type: "json_object" } } : {}),
  };
}

export function requestsStrictJsonObject(text: string): boolean {
  const prose = text.split("<runtime_context>", 1)[0].replace(/```[\s\S]*?```|`[^`]*`|"[^"\n]*"|“[^”]*”|'[^'\n]*'|^\s*>[^\n]*/gmu, " ");
  return /(?:返回|输出)\s*(?:一个\s*)?严格\s*JSON\s*(?:对象|[，,])|\b(?:return|output)\s+(?:a\s+)?strict\s+JSON\s+object/iu.test(prose)
    && !/JSON\s*(?:数组|array)/iu.test(prose);
}

/** Match only an explicitly requested proof field, preserving user field order. */
export function requestsProofFieldFirst(text: string): boolean {
  if (!requestsStrictJsonObject(text)) return false;
  const prose = text.split("<runtime_context>", 1)[0].replace(/```[\s\S]*?```|`[^`]*`|"[^"\n]*"|“[^”]*”|'[^'\n]*'|^\s*>[^\n]*/gmu, " ");
  if (/顺序|次序|开头|结尾|最前|末尾|最后|放在|置于|排在|子对象|嵌套|内层|\b(?:order|first|last|before|after|nested)\b|先.{0,20}(?:字段|键)|(?:字段|键).{0,20}先/iu.test(prose)) return false;
  if (/(?:不要(?:包含)?|不(?:包含|需要|含)|禁止|不能(?:包含)?|排除)\s*proof\b/u.test(prose)) return false;
  const declarations = [
    ...prose.matchAll(/(?:只有|顶层(?:仅)?(?:包含|含))\s*([A-Za-z0-9_、,\s和与及]+?)(?:[一二两三四五六七八九十0-9]+个)?(?:键|字段)/gu),
    ...prose.matchAll(/(?:^|[。；，,])\s*(?:顶层)?(?:键|字段)(?:为|是)\s*([A-Za-z0-9_、,\s和与及]+)(?=[。；\n]|$)/gu),
  ];
  return declarations.length === 1 && /\bproof\b/u.test(declarations[0][1]) && /证明|推导|解|计算|方程|函数|不等式/u.test(prose);
}

function normalizeEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  return `${url.origin}${url.pathname.replace(/\/(?:chat\/completions)?\/?$/u, "").replace(/\/$/u, "")}`;
}
