import { FrozenProviderSnapshot, ReviewOutcome, ReviewPolicy, ReviewResultSummary } from "../../core/programming-contracts";

export const REVIEW_READ_ONLY_TOOLS = [
  "project.list",
  "project.read",
  "project.search",
  "git.status",
  "git.diff",
  "git.log",
  "terminal.output",
] as const;

export interface ReviewEvidence {
  kind: string;
  summary: string;
  relativePaths?: string[];
}

export interface ReviewExecutionResult {
  text: string;
  usage?: { input: number; output: number; total: number };
  cache?: { hit: number | null; miss: number | null };
}

export interface ReviewRunInput {
  policy: ReviewPolicy;
  changed: boolean;
  round: number;
  frozenProvider: FrozenProviderSnapshot;
  evidence: ReviewEvidence[];
  execute?: (input: {
    allowedToolNames: readonly string[];
    evidence: ReviewEvidence[];
    frozenProvider: FrozenProviderSnapshot;
  }) => Promise<ReviewExecutionResult>;
}

export interface ReviewServicePort {
  shouldRun(policy: ReviewPolicy, input: { changed: boolean }): boolean;
  run(input: ReviewRunInput): Promise<ReviewResultSummary>;
}

export type { ReviewOutcome, ReviewPolicy, ReviewResultSummary };
