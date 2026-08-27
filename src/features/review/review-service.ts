import { newId } from "../../core/ids";
import { FrozenProviderSnapshot, ReviewOutcome, ReviewResultSummary, ReviewPolicy } from "../../core/programming-contracts";
import { REVIEW_READ_ONLY_TOOLS, ReviewRunInput, ReviewServicePort } from "./contracts";

export class ReviewService implements ReviewServicePort {
  private readonly results: ReviewResultSummary[] = [];
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  shouldRun(policy: ReviewPolicy, input: { changed: boolean }): boolean {
    return policy === "on" || (policy === "auto" && input.changed);
  }

  async run(input: ReviewRunInput): Promise<ReviewResultSummary> {
    const frozen = input.frozenProvider;
    const base = {
      id: newId("review"),
      round: input.round,
      providerId: frozen.providerId,
      profileId: frozen.profileId,
      modelId: frozen.modelId,
      ...(frozen.reasoning ? { reasoning: frozen.reasoning } : {}),
      findings: [] as string[],
      suggestions: [] as string[],
      executionCounts: { write: 0, terminal: 0, commit: 0, merge: 0 },
      allowedToolNames: [...REVIEW_READ_ONLY_TOOLS],
      createdAt: this.now(),
    };
    if (input.round > 2) {
      return this.store({ ...base, outcome: "REVIEW_STOPPED", stoppedReason: "审查轮数上限为 2；未执行第三轮。" });
    }
    if (input.policy === "off") {
      return this.store({ ...base, outcome: "REVIEW_STOPPED", stoppedReason: "审查策略为 off；未执行审查。" });
    }

    let output: { text: string; usage?: { input: number; output: number; total: number }; cache?: { hit: number | null; miss: number | null } } | undefined;
    if (input.execute) output = await input.execute({
      allowedToolNames: REVIEW_READ_ONLY_TOOLS,
      evidence: input.evidence.map((item) => ({ ...item, relativePaths: item.relativePaths ? [...item.relativePaths] : undefined })),
      frozenProvider: clone(frozen),
    });
    if (!output) {
      return this.store({ ...base, outcome: "UNPROVEN", stoppedReason: "缺少只读审查执行器；只生成结构化未证明结果。" });
    }
    const parsed = parseReview(output.text);
    return this.store({
      ...base,
      outcome: parsed.outcome,
      findings: parsed.findings,
      suggestions: parsed.suggestions,
      ...(output.usage ? { usage: output.usage } : {}),
      ...(output.cache ? { cache: output.cache } : {}),
    });
  }

  list(): ReviewResultSummary[] { return this.results.map(clone); }
  latest(): ReviewResultSummary | undefined { return this.results.at(-1) ? clone(this.results.at(-1)!) : undefined; }

  private store(result: ReviewResultSummary): ReviewResultSummary {
    this.results.push(clone(result));
    return clone(result);
  }
}

function parseReview(text: string): { outcome: ReviewOutcome; findings: string[]; suggestions: string[] } {
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const first = lines[0]?.toUpperCase() ?? "";
  const outcome: ReviewOutcome = first.startsWith("PASS")
    ? "PASS"
    : first.startsWith("ISSUES")
      ? "ISSUES"
      : "UNPROVEN";
  const findings = lines.filter((line) => /^finding[:：]/iu.test(line)).map(stripLabel);
  const suggestions = lines.filter((line) => /^(suggestion|建议)[:：]/iu.test(line)).map(stripLabel);
  return { outcome, findings, suggestions };
}

function stripLabel(line: string): string { return line.replace(/^[^:：]+[:：]\s*/u, "").slice(0, 2000); }

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
