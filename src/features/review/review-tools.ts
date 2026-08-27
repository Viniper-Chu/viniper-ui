import { ToolRequest } from "../../core/contracts";
import { FrozenProviderSnapshot } from "../../core/programming-contracts";
import { ToolExecutionContext, ToolExecutor, ToolResult } from "../tools/tool-registry";
import { ReviewService } from "./review-service";

export function createReviewTools(review: ReviewService, providerSnapshot: () => FrozenProviderSnapshot): ToolExecutor[] {
  return [new ReviewRunTool(review, providerSnapshot)];
}

class ReviewRunTool implements ToolExecutor {
  readonly name = "review.run";
  readonly description = "启动只读自动审查；审查只报告，不修复、不运行写工具、不提交或合并。";
  readonly readOnly = true;
  readonly authorizationScope = "project" as const;
  readonly inputSchema = { type: "object" as const, properties: {}, additionalProperties: false };
  constructor(private readonly review: ReviewService, private readonly providerSnapshot: () => FrozenProviderSnapshot) {}
  async execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult> {
    const result = await this.review.run({
      policy: "on",
      changed: true,
      round: 1,
      frozenProvider: context.providerSnapshot ?? this.providerSnapshot(),
      evidence: [{ kind: "runtime", summary: "由当前 run 提供的只读审查证据。" }],
    });
    return { toolId: request.id, text: JSON.stringify(result), data: result, displayText: `审查结果：${result.outcome}。` };
  }
}
