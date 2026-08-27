import { ClaudeCodeCommandSpec } from "../../core/agent-engine-contracts";
import { ProviderEvent, ProviderRequest } from "../../core/provider-contracts";
import { TokenUsage } from "../../core/telemetry-contracts";
import { ModelProvider } from "./model-provider";

export interface ClaudeCodeProviderOptions {
  command: ClaudeCodeCommandSpec;
  processHost: ClaudeCodeProcessHost;
  /** Resolves an official Anthropic API key from the host-owned secure vault at run time. */
  resolveApiKey?: () => Promise<string | null>;
  /** Resolves an Anthropic-compatible gateway token from the host-owned secure vault at run time. */
  resolveAuthToken?: () => Promise<string | null>;
  /** Resolves one secret from the host-owned secure vault; the selected auth mode decides its env name. */
  resolveSecret?: () => Promise<string | null>;
  /** Selects which single Claude Code credential variable may be populated. */
  resolveAuthMode?: () => ClaudeCodeAuthMode;
  /** Resolves the configured Anthropic base URL without exposing it to the renderer. */
  resolveBaseUrl?: () => string | null | undefined;
  /** Resolves the host-owned default model alias without exposing credentials to the renderer. */
  resolveModel?: () => string | null | undefined;
  /** Resolves the host-owned small/fast sub-agent model alias without exposing credentials to the renderer. */
  resolveSmallFastModel?: () => string | null | undefined;
  /** Resolves the complete host-owned Claude model alias set without exposing credentials to the renderer. */
  resolveModelAliases?: () => ClaudeCodeModelAliases;
}

export type ClaudeCodeAuthMode = "api-key" | "auth-token";

export interface ClaudeCodeModelAliases {
  model?: string | null;
  defaultSonnetModel?: string | null;
  defaultOpusModel?: string | null;
  defaultHaikuModel?: string | null;
  smallFastModel?: string | null;
  subagentModel?: string | null;
}

export interface ClaudeCodeAuthEnvironment {
  apiKey?: string | null;
  authToken?: string | null;
  authMode?: ClaudeCodeAuthMode;
  baseUrl?: string | null;
  model?: string | null;
  smallFastModel?: string | null;
  defaultSonnetModel?: string | null;
  defaultOpusModel?: string | null;
  defaultHaikuModel?: string | null;
  subagentModel?: string | null;
}

export interface ClaudeCodeProcessHost {
  lines(
    invocation: ReturnType<typeof buildClaudeCodeInvocation>,
    signal: AbortSignal,
  ): AsyncIterable<string>;
}

export class ClaudeCodeProvider implements ModelProvider {
  readonly descriptor = {
    id: "claude-code",
    name: "Claude code",
    label: "Claude code · 本机 CLI Adapter",
    configuration: "configured" as const,
    available: true,
    realCallsEnabled: true,
    capabilities: ["stream", "tools", "reasoning"],
    models: [{ id: "claude-code-default", label: "Claude Code 默认模型" }],
  };

  constructor(private readonly options: ClaudeCodeProviderOptions) {}

  async *stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    const authMode = this.options.resolveAuthMode?.()
      ?? (this.options.resolveAuthToken && !this.options.resolveApiKey ? "auth-token" : "api-key");
    const resolveSecret = authMode === "auth-token"
      ? (this.options.resolveAuthToken ?? this.options.resolveSecret ?? this.options.resolveApiKey)
      : (this.options.resolveApiKey ?? this.options.resolveSecret ?? this.options.resolveAuthToken);
    const secret = await resolveSecret?.();
    if (resolveSecret && !secret?.trim()) {
      throw new Error(`CLAUDE_CODE_AUTHENTICATION_MISSING: Claude Code ${authMode === "auth-token" ? "网关 Token" : "API Key"} 未配置。`);
    }
    const aliases = this.options.resolveModelAliases?.() ?? {};
    const invocation = buildClaudeCodeInvocation(request, this.options.command, {
      authMode,
      ...(authMode === "auth-token" ? { authToken: secret } : { apiKey: secret }),
      baseUrl: this.options.resolveBaseUrl?.(),
      ...aliases,
      model: this.options.resolveModel?.() ?? aliases.model,
      smallFastModel: this.options.resolveSmallFastModel?.() ?? aliases.smallFastModel,
    });
    let emittedText = false;
    yield { kind: "thinking.started" };
    for await (const line of this.options.processHost.lines(invocation, signal)) {
      for (const event of projectClaudeCodeLine(line)) {
        if (event.kind === "provider.failed") {
          throw new Error(`${event.code}: ${event.message}`);
        }
        if (event.kind === "text.delta") emittedText = true;
        yield event;
      }
    }
    if (!emittedText) throw new Error("CLAUDE_CODE_EMPTY_RESPONSE: CLI 未返回可显示文本。");
    yield { kind: "thinking.completed" };
  }
}

export function buildClaudeCodeInvocation(
  request: ProviderRequest,
  command: ClaudeCodeCommandSpec,
  auth: ClaudeCodeAuthEnvironment = {},
): { executable: string; args: string[]; cwd?: string; env?: Record<string, string>; transport?: ClaudeCodeCommandSpec["transport"] } {
  const prompt = renderPrompt(request);
  const claudeArgs = [
    "--print",
    "--output-format", "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--permission-mode", permissionMode(request.permissionMode),
  ];
  if (request.selectedModel !== "claude-code-default") claudeArgs.push("--model", request.selectedModel);
  claudeArgs.push(prompt);
  const projectRoot = request.workingDirectory;
  const environment = buildClaudeCodeEnvironment(auth);
  let prefix = [...command.prefixArgs];
  if (!command.useSpawnCwd && projectRoot) {
    const separator = prefix.indexOf("--");
    const launcher = separator >= 0 ? prefix.slice(0, separator) : prefix;
    const delegatedCommand = separator >= 0 ? prefix.slice(separator + 1) : [];
    prefix = [...launcher, "--cd", projectRoot, "--", ...delegatedCommand];
  }
  return {
    executable: command.executable,
    args: [...prefix, ...claudeArgs],
    transport: command.transport,
    ...(command.useSpawnCwd && projectRoot ? { cwd: projectRoot } : {}),
    ...(Object.keys(environment).length ? { env: environment } : {}),
  };
}

export function buildClaudeCodeEnvironment(auth: ClaudeCodeAuthEnvironment): Record<string, string> {
  const environment: Record<string, string> = {};
  const mode = auth.authMode ?? (auth.authToken?.trim() && !auth.apiKey?.trim() ? "auth-token" : "api-key");
  const credential = (mode === "auth-token" ? auth.authToken : auth.apiKey)?.trim();
  const baseUrl = auth.baseUrl?.trim();
  if (credential) environment[mode === "auth-token" ? "ANTHROPIC_AUTH_TOKEN" : "ANTHROPIC_API_KEY"] = credential;
  if (baseUrl) environment.ANTHROPIC_BASE_URL = normalizeAnthropicBaseUrl(baseUrl);
  const model = auth.model?.trim();
  const defaultSonnetModel = auth.defaultSonnetModel?.trim();
  const defaultOpusModel = auth.defaultOpusModel?.trim();
  const defaultHaikuModel = auth.defaultHaikuModel?.trim();
  const smallFastModel = auth.smallFastModel?.trim();
  const subagentModel = auth.subagentModel?.trim();
  if (model) environment.ANTHROPIC_MODEL = model;
  if (defaultSonnetModel) environment.ANTHROPIC_DEFAULT_SONNET_MODEL = defaultSonnetModel;
  if (defaultOpusModel) environment.ANTHROPIC_DEFAULT_OPUS_MODEL = defaultOpusModel;
  if (defaultHaikuModel) environment.ANTHROPIC_DEFAULT_HAIKU_MODEL = defaultHaikuModel;
  if (smallFastModel) environment.ANTHROPIC_SMALL_FAST_MODEL = smallFastModel;
  if (subagentModel) environment.CLAUDE_CODE_SUBAGENT_MODEL = subagentModel;
  return environment;
}

function normalizeAnthropicBaseUrl(value: string): string {
  return value.replace(/\/v1\/messages\/?$/u, "");
}

export function projectClaudeCodeLine(line: string): ProviderEvent[] {
  const value = parseJsonObject(line);
  if (!value) return [];
  const events: ProviderEvent[] = [];
  if (value.type === "system" && value.subtype === "init" && typeof value.permissionMode === "string") {
    events.push({ kind: "provider-permission.confirmed", mode: value.permissionMode });
  }
  if (value.type === "assistant") {
    const message = objectValue(value.message);
    const content = Array.isArray(message?.content) ? message.content : [];
    const failure = claudeCodeFailure(value, content);
    if (failure) return [{ kind: "provider.failed", ...failure }];
    for (const item of content) {
      const entry = objectValue(item);
      if (entry?.type === "text" && typeof entry.text === "string" && entry.text) {
        events.push({ kind: "text.delta", text: entry.text });
      }
      if (entry?.type === "tool_use" && typeof entry.id === "string" && typeof entry.name === "string") {
        events.push({ kind: "provider-tool.started", callId: entry.id, name: entry.name });
      }
    }
  }
  if (value.type === "user") {
    const message = objectValue(value.message);
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const item of content) {
      const entry = objectValue(item);
      if (entry?.type === "tool_result" && typeof entry.tool_use_id === "string") {
        events.push({
          kind: "provider-tool.completed",
          callId: entry.tool_use_id,
          isError: entry.is_error === true,
        });
      }
    }
  }
  if (value.type === "result") {
    const deniedCount = Array.isArray(value.permission_denials) ? value.permission_denials.length : 0;
    events.push({ kind: "provider-permission.completed", deniedCount });
    const failure = claudeCodeFailure(value, []);
    if (failure) events.push({ kind: "provider.failed", ...failure });
    const usage = tokenUsage(objectValue(value.usage));
    if (usage) events.push({ kind: "usage.completed", usage });
  }
  return events;
}

function renderPrompt(request: ProviderRequest): string {
  const turns = request.history.flatMap((entry) => {
    const text = entry.items
      .filter((item): item is Extract<typeof item, { type: "text" }> => item.type === "text")
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join("\n");
    if (!text) return [];
    return [`${entry.role === "assistant" ? "Assistant" : entry.role === "tool" ? "Tool" : "User"}: ${text}`];
  });
  return [
    "你正在 Viniper workstation 的 Claude code Agent 中运行。应用的结构化会话是唯一会话真源。",
    "请完成最后一个 User 请求；不要解释这段适配说明。",
    ...turns,
  ].join("\n\n");
}

function permissionMode(mode: ProviderRequest["permissionMode"]): "manual" | "acceptEdits" | "bypassPermissions" | "plan" {
  if (mode === "full") return "bypassPermissions";
  if (mode === "auto") return "acceptEdits";
  if (mode === "plan") return "plan";
  return "manual";
}

function claudeCodeFailure(
  value: Record<string, unknown>,
  content: unknown[],
): { code: string; message: string } | null {
  const explicit = typeof value.error === "string" ? value.error : "";
  const isError = value.is_error === true || value.is_api_error_message === true || Boolean(explicit);
  if (!isError) return null;
  const code = `CLAUDE_CODE_${normalizeErrorCode(explicit || String(value.terminal_reason ?? "FAILED"))}`;
  const text = content
    .map((item) => objectValue(item))
    .find((item) => item?.type === "text" && typeof item.text === "string")?.text;
  const result = typeof value.result === "string" ? value.result : "";
  return {
    code,
    message: cleanErrorMessage(typeof text === "string" ? text : result),
  };
}

function normalizeErrorCode(value: string): string {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
  return normalized || "FAILED";
}

function cleanErrorMessage(value: string): string {
  return value.replace(/[\r\n\t]+/gu, " ").trim().slice(0, 500) || "Claude Code CLI 返回了受控错误。";
}

function tokenUsage(value: Record<string, unknown> | null): TokenUsage | null {
  if (!value) return null;
  const input = numeric(value.input_tokens);
  const output = numeric(value.output_tokens);
  const cacheRead = optionalNumeric(value.cache_read_input_tokens);
  const cacheWrite = optionalNumeric(value.cache_creation_input_tokens);
  if (input === 0 && output === 0 && cacheRead === null && cacheWrite === null) return null;
  return {
    input,
    cacheHitInput: cacheRead,
    cacheMissInput: cacheRead === null ? null : Math.max(0, input - cacheRead),
    cacheWriteInput: cacheWrite,
    output,
    reasoning: 0,
    toolUse: 0,
    total: input + output,
    source: "provider",
  };
}

function parseJsonObject(line: string): Record<string, unknown> | null {
  try { return objectValue(JSON.parse(line)); } catch { return null; }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function optionalNumeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : null;
}
