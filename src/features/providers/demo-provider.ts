import { ProviderDescriptor, ProviderEvent, ProviderRequest } from "../../core/provider-contracts";
import { ModelProvider } from "./model-provider";
import { IDENTITY_RESPONSE, isIdentityQuestion } from "../instructions/identity-contract";

const DEMO_DESCRIPTOR: ProviderDescriptor = {
  id: "demo",
  name: "Demo Provider",
  label: "Demo Provider · 仅本地演示",
  configuration: "demo",
  available: true,
  realCallsEnabled: false,
  capabilities: ["streaming", "agent", "read-only-demo-tool", "project-read-tools", "cache-plan-metrics"],
  models: [
    { id: "demo-default", label: "Demo · 默认模型" },
    { id: "demo-concise", label: "Demo · 简洁回复" },
  ],
};

const pendingToolFixtureEnabled = process.env.VINIPER_DEMO_FIXTURE === "pending-tool";

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Demo stream cancelled"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Demo stream cancelled"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export class DemoProvider implements ModelProvider {
  readonly descriptor = DEMO_DESCRIPTOR;

  constructor(private readonly delayMs = 500) {}

  async *stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    const currentText = latestUserText(request);
    const latest = request.history.at(-1);
    yield { kind: "thinking.started" };
    yield { kind: "reasoning.delta", text: "本地 Demo 正在整理上下文。" };
    await pause(this.delayMs, signal);
    if (isIdentityQuestion(currentText)) {
      yield { kind: "text.delta", text: IDENTITY_RESPONSE };
      yield {
        kind: "usage.completed",
        usage: {
          input: tokenCount(request.cachePlan.reusablePrefix + currentText),
          cacheHitInput: tokenCount(request.cachePlan.reusablePrefix),
          cacheMissInput: tokenCount(currentText),
          cacheWriteInput: 0,
          output: tokenCount(IDENTITY_RESPONSE),
          reasoning: 0,
          toolUse: 0,
          total: tokenCount(request.cachePlan.reusablePrefix + currentText) + tokenCount(IDENTITY_RESPONSE),
          source: "provider",
        },
      };
      yield { kind: "thinking.completed" };
      return;
    }
    const skillMarker = requestedSkillMarker(currentText, request);
    if (skillMarker) {
      const response = `[Demo Provider] Agent 回复：技能标记：${skillMarker}`;
      yield { kind: "text.delta", text: response };
      yield {
        kind: "usage.completed",
        usage: {
          input: tokenCount(request.cachePlan.reusablePrefix + currentText),
          cacheHitInput: tokenCount(request.cachePlan.reusablePrefix),
          cacheMissInput: tokenCount(currentText),
          cacheWriteInput: 0,
          output: tokenCount(response),
          reasoning: 0,
          toolUse: 0,
          total: tokenCount(request.cachePlan.reusablePrefix + currentText) + tokenCount(response),
          source: "provider",
        },
      };
      yield { kind: "thinking.completed" };
      return;
    }
    if (latest?.role !== "tool") {
      const projectTool = requestedProjectTool(currentText, request);
      const fixture = pendingToolFixtureEnabled ? { fixture: "pending-tool" } : {};
      yield {
        kind: "tool-call.completed",
        call: {
          type: "tool-call",
          callId: `demo-call-${request.sessionId}-${request.history.length}`,
          name: projectTool?.name ?? "demo.read-only-preview",
          arguments: { ...(projectTool?.arguments ?? {}), ...fixture },
          argumentsText: JSON.stringify({ ...(projectTool?.arguments ?? {}), ...fixture }),
        },
      };
      yield { kind: "thinking.completed" };
      return;
    }

    const skillNames = request.contextProfile.enabledSkills.map((skill) => skill.name);
    const skillProof = skillNames.length ? ` 已按需加载 Skill：${skillNames.join("、")}。` : "";
    const localEvidence = summarizeLocalToolResult(latest);
    const response = localEvidence
      ? `[Demo Provider] Agent 回复：${localEvidence}${skillProof}`
      : `[Demo Provider] Agent 回复：${currentText}${skillProof}`;
    const input = tokenCount(request.cachePlan.reusablePrefix + currentText);
    const cacheHitInput = tokenCount(request.cachePlan.reusablePrefix);
    let emitted = "";
    for (const chunk of response.match(/.{1,12}/gu) ?? [response]) {
      await pause(Math.max(20, Math.round(this.delayMs * 0.6)), signal);
      emitted += chunk;
      yield { kind: "text.delta", text: chunk };
      const output = tokenCount(emitted);
      yield {
        kind: "usage.estimated",
        usage: {
          input,
          cacheHitInput: 0,
          cacheMissInput: input,
          cacheWriteInput: 0,
          output,
          reasoning: 0,
          toolUse: 0,
          total: input + output,
          source: "estimated",
        },
      };
    }
    const output = tokenCount(response);
    yield {
      kind: "usage.completed",
      usage: {
        input,
        cacheHitInput,
        cacheMissInput: Math.max(0, input - cacheHitInput),
        cacheWriteInput: 0,
        output,
        reasoning: 3,
        toolUse: 0,
        total: input + output,
        source: "provider",
      },
    };
    yield { kind: "thinking.completed" };
  }
}

function requestedProjectTool(
  text: string,
  request: ProviderRequest,
): { name: "project.list" | "project.search" | "project.read"; arguments: Record<string, unknown> } | undefined {
  const available = new Set(request.tools.map((tool) => tool.name));
  const read = /(?:P1\s*)?读取(?:文件)?\s*[：:]\s*(.+)$/iu.exec(text);
  if (read && available.has("project.read")) {
    return { name: "project.read", arguments: { path: read[1].trim() } };
  }
  const search = /(?:P1\s*)?搜索(?:项目)?\s*[：:]\s*(.+)$/iu.exec(text);
  if (search && available.has("project.search")) {
    return { name: "project.search", arguments: { query: search[1].trim() } };
  }
  if (/(?:P1\s*)?(?:列出项目|查看项目目录)/iu.test(text) && available.has("project.list")) {
    return { name: "project.list", arguments: {} };
  }
  return undefined;
}

function requestedSkillMarker(text: string, request: ProviderRequest): string | undefined {
  if (!/(?:技能标记|skill marker|marker)/iu.test(text)) return undefined;
  for (const skill of request.contextProfile.enabledSkills) {
    const match = /\bV13_[A-Z0-9_]{4,}\b/u.exec(skill.body);
    if (match) return match[0];
  }
  return undefined;
}

function summarizeLocalToolResult(entry: ProviderRequest["history"][number]): string | undefined {
  const result = entry.items.find((item) => item.type === "tool-result");
  if (!result || result.type !== "tool-result") return undefined;
  if (result.name === "demo.read-only-preview") return undefined;
  try {
    const data = JSON.parse(result.content) as Record<string, unknown>;
    if (data.ok !== true) {
      const error = data.error as Record<string, unknown> | undefined;
      return `项目工具未完成：${typeof error?.message === "string" ? error.message : "未提供详情"}`;
    }
    if (Array.isArray(data.lines)) {
      const lines = data.lines as Array<{ number?: unknown; text?: unknown }>;
      const evidence = lines.slice(0, 8).map((line) => `${line.number ?? "?"}: ${String(line.text ?? "")}`).join(" / ");
      return `已依据 project.read 的实时结果回答：${evidence || "文件为空"}`;
    }
    if (Array.isArray(data.results)) {
      return `已依据 project.search 的实时结果回答：${boundedJson(data.results)}`;
    }
    if (Array.isArray(data.entries)) {
      return `已依据 project.list 的实时结果回答：${boundedJson(data.entries)}`;
    }
    if (typeof data.ok === "boolean") return `已依据 ${entry.items.find((item) => item.type === "tool-result")?.name ?? "工具"} 结果回答：${boundedJson(data)}`;
  } catch {
    return "已收到本地只读工具结果。";
  }
  return "已收到本地只读工具结果。";
}

function boundedJson(value: unknown): string {
  const text = JSON.stringify(value);
  return text.length <= 480 ? text : `${text.slice(0, 479)}…`;
}

function latestUserText(request: ProviderRequest): string {
  const entry = [...request.history].reverse().find((item) => item.role === "user");
  return entry?.items.filter((item) => item.type === "text").map((item) => item.text).join("") ?? "";
}

function tokenCount(text: string): number {
  return text.length === 0 ? 0 : Math.max(1, Math.ceil([...text].length / 3));
}
