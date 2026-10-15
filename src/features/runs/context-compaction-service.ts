import { ContextCompactionSnapshot, ContextSummaryGeneration, CompactionInput } from "../../core/compaction-contracts";
import { Phase8Cp3Persistence } from "../../core/ports";
import { ProviderHistoryEntry } from "../../core/provider-contracts";
import { emptyUsage, estimateTokens } from "../telemetry/token-ledger";
import { newId } from "../../core/ids";

export type SummaryGenerator = (history: ProviderHistoryEntry[]) => Promise<string>;

export class ContextCompactionService {
  private readonly generations: ContextSummaryGeneration[] = [];
  private lastStatus: ContextCompactionSnapshot["lastStatus"];

  constructor(
    private readonly persistence?: Phase8Cp3Persistence,
    private readonly generator?: SummaryGenerator,
    private readonly now: () => number = Date.now,
  ) {}

  async initialize(): Promise<void> {
    this.generations.push(...((await this.persistence?.loadCompactionGenerations()) ?? []).map(clone));
    if (this.generations.length > 0) this.lastStatus = "generated";
  }

  snapshot(): ContextCompactionSnapshot {
    return clone({ generations: this.generations, ...(this.lastStatus ? { lastStatus: this.lastStatus } : {}) });
  }

  async maybeCompact(input: CompactionInput): Promise<{
    status: "not-needed" | "generated" | "fallback";
    generation?: ContextSummaryGeneration;
    history: ProviderHistoryEntry[];
  }> {
    const threshold = Math.max(100, input.thresholdChars ?? defaultCompactionThresholdChars(input.providerId, input.modelId));
    const projected = this.projectHistory(input.sessionId, input.history, input.providerId, input.modelId);
    const chars = projected.reduce((total, entry) => total + JSON.stringify(entry).length, 0);
    const latestTurn = lastUserIndex(projected);
    if (chars <= threshold || latestTurn <= 0) {
      this.lastStatus = "not-needed";
      return { status: "not-needed", history: projected };
    }
    // Retain a whole user turn: cutting the final two entries can leave a tool
    // result without its assistant call, or discard the user's actual request.
    const source = projected.slice(0, latestTurn);
    const retainedIds = new Set(projected.slice(latestTurn).map((entry) => entry.id));
    const sourceHistoryIds = input.history.filter((entry) => !retainedIds.has(entry.id)).map((entry) => entry.id);
    // An oversized latest turn must not re-summarize the same prefix each run.
    if (source.length === 1 && this.generations.some((item) => item.id === source[0].id)) {
      this.lastStatus = "not-needed";
      return { status: "not-needed", history: projected };
    }
    try {
      const text = (await (this.generator?.(source) ?? Promise.resolve(defaultSummary(source)))).trim();
      if (!text) throw new Error("摘要生成结果为空。");
      const usage = emptyUsage("estimated");
      usage.input = estimateTokens(source.map((entry) => JSON.stringify(entry)).join("\n"));
      usage.output = estimateTokens(text);
      usage.total = usage.input + usage.output;
      const generation: ContextSummaryGeneration = {
        id: newId("context-summary"),
        sessionId: input.sessionId,
        providerId: input.providerId,
        modelId: input.modelId,
        generation: this.nextGeneration(input.sessionId),
        sourceHistoryIds,
        text,
        createdAt: this.now(),
        immutable: true,
        usage,
        cache: { read: null, write: null, miss: null },
        status: "ready",
      };
      this.generations.push(generation);
      await this.persistence?.saveCompactionGeneration(clone(generation));
      this.lastStatus = "generated";
      return { status: "generated", generation: clone(generation), history: this.projectHistory(input.sessionId, input.history, input.providerId, input.modelId) };
    } catch {
      this.lastStatus = "fallback";
      return { status: "fallback", history: projected };
    }
  }

  projectHistory(sessionId: string, history: ProviderHistoryEntry[], providerId?: string, modelId?: string): ProviderHistoryEntry[] {
    const generation = [...this.generations].reverse().find((item) => item.sessionId === sessionId
      && item.status === "ready"
      && (!providerId || item.providerId === providerId)
      && (!modelId || item.modelId === modelId));
    if (!generation || generation.sourceHistoryIds.length === 0) return clone(history);
    const sourceIds = new Set(generation.sourceHistoryIds);
    const tail = history.filter((entry) => !sourceIds.has(entry.id));
    const summaryEntry: ProviderHistoryEntry = {
      id: generation.id,
      role: "assistant",
      items: [{ type: "text", text: `不可变上下文摘要（原始历史仍保留）：\n${generation.text}` }],
    };
    return [summaryEntry, ...tail].map(clone);
  }

  private nextGeneration(sessionId: string): number {
    return 1 + this.generations.filter((item) => item.sessionId === sessionId).reduce((max, item) => Math.max(max, item.generation), 0);
  }
}

/**
 * DeepSeek V4 exposes a long context window and its automatic cache only
 * reuses an unchanged prefix.  Compacting at the generic 32k-character mark
 * rewrote the beginning of otherwise healthy conversations after roughly
 * 8k tokens.  Preserve append-only history until about 96k estimated input
 * tokens, leaving substantial room for the current turn and output.
 */
export function defaultCompactionThresholdChars(providerId: string, modelId: string): number {
  if (providerId === "deepseek" && /^(deepseek-flash|deepseek-v4-)/u.test(modelId)) return 384_000;
  return 32_000;
}

function defaultSummary(history: ProviderHistoryEntry[]): string {
  const facts = history.flatMap((entry) => entry.items.flatMap((item) => {
    if (item.type === "text") return [`${entry.role === "user" ? "用户请求" : "助手报告"}：${item.text.slice(0, 600)}`];
    if (item.type === "tool-call") return [`操作 ${item.name}：${JSON.stringify(item.arguments).slice(0, 350)}`];
    if (item.type === "tool-result") return [`${item.isError ? "失败" : "工具返回"} ${item.name}：${item.content.slice(0, 500)}`];
    return []; // Reasoning is not a verified task outcome.
  }));
  const selected: string[] = [];
  let length = 0;
  for (const fact of facts.reverse()) {
    if (length + fact.length + 1 > 3_900) break;
    selected.unshift(fact);
    length += fact.length + 1;
  }
  return `历史摘录，可能省略细节；以最近用户要求及当前文件为准。\n${selected.join("\n")}`;
}

function lastUserIndex(history: ProviderHistoryEntry[]): number {
  for (let index = history.length - 1; index >= 0; index -= 1) if (history[index].role === "user") return index;
  return -1;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
