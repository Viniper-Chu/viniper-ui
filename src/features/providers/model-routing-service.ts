import { IntentOrigin } from "../../core/contracts";
import { RoutingDecision, RoutingInput, RoutingSnapshot, SmartRoutingStrategy } from "../../core/routing-contracts";
import { Phase8Cp3Persistence } from "../../core/ports";
import { ProviderRegistry } from "./provider-registry";

export class SmartRoutingService {
  private enabled = false;
  private strategy: SmartRoutingStrategy = "balanced";
  private lastDecision?: RoutingDecision;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly now: () => number = Date.now,
    private readonly persistence?: Phase8Cp3Persistence,
  ) {}

  async initialize(): Promise<void> {
    const saved = await this.persistence?.loadRoutingSnapshot();
    if (saved) {
      this.enabled = saved.enabled;
      this.strategy = saved.strategy;
      this.lastDecision = saved.lastDecision;
    }
  }

  snapshot(): RoutingSnapshot {
    return clone({ enabled: this.enabled, strategy: this.strategy, ...(this.lastDecision ? { lastDecision: this.lastDecision } : {}) });
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    await this.persist();
  }

  async setStrategy(strategy: SmartRoutingStrategy): Promise<void> {
    this.strategy = strategy;
    await this.persist();
  }

  decide(
    input: RoutingInput,
    request?: { mode: "fixed"; providerId: string; modelId: string } | { mode: "smart"; strategy: SmartRoutingStrategy },
  ): RoutingDecision {
    const fixed = this.candidate(input.providerId, input.modelId);
    if (request?.mode === "fixed") {
      const available = this.registry.list().some((provider) => provider.id === request.providerId
        && provider.available && provider.models.some((model) => model.id === request.modelId));
      const selected = available ? this.candidate(request.providerId, request.modelId) : fixed;
      return this.remember({
        ...selected,
        mode: "fixed",
        enabled: false,
        eligible: true,
        fallback: !available,
        reason: available ? "自动任务使用已冻结的固定模型。" : "自动任务固定模型已不可用，沿用目标会话模型。",
        frozenAt: this.now(),
      });
    }
    const requestedStrategy = request?.mode === "smart" ? request.strategy : this.strategy;
    if (!this.enabled || input.origin.kind !== "delegation") {
      if (request?.mode === "smart") return this.smartDecision(input, requestedStrategy);
      return this.remember({
        ...fixed,
        mode: "fixed",
        enabled: this.enabled,
        eligible: false,
        fallback: false,
        reason: this.enabled ? "智能分配只作用于尚未开始的委派任务；当前运行保持固定选择。" : "智能分配已关闭，沿用用户固定模型。",
        frozenAt: this.now(),
      });
    }
    return this.smartDecision(input, requestedStrategy);
  }

  private smartDecision(input: RoutingInput, strategy: SmartRoutingStrategy): RoutingDecision {
    const fixed = this.candidate(input.providerId, input.modelId);
    const candidates = this.registry.list()
      .filter((provider) => provider.available && provider.models.length > 0)
      .flatMap((provider) => provider.models.map((model) => this.candidate(provider.id, model.id)));
    const selected = [...candidates].sort((left, right) => this.compare(left, right, input, strategy))[0] ?? fixed;
    return this.remember({
      ...selected,
      mode: "smart",
      enabled: true,
      eligible: true,
      fallback: false,
      reason: this.reason(selected, strategy),
      frozenAt: this.now(),
    });
  }

  private candidate(providerId: string, modelId: string) {
    const provider = this.registry.list().find((item) => item.id === providerId);
    const capabilities = provider?.capabilities ?? [];
    return {
      providerId,
      modelId,
      label: `${provider?.name ?? providerId} · ${modelId}`,
      capabilities,
      cacheImpact: capabilities.includes("cache") ? "reusable" as const : capabilities.length ? "unknown" as const : "none" as const,
    };
  }

  private compare(left: ReturnType<SmartRoutingService["candidate"]>, right: ReturnType<SmartRoutingService["candidate"]>, input: RoutingInput, strategy: SmartRoutingStrategy): number {
    const leftScore = this.score(left, input, strategy);
    const rightScore = this.score(right, input, strategy);
    return rightScore - leftScore || (left.providerId === input.providerId ? -1 : 0) || left.modelId.localeCompare(right.modelId);
  }

  private score(candidate: ReturnType<SmartRoutingService["candidate"]>, input: RoutingInput, strategy: SmartRoutingStrategy): number {
    const quality = candidate.capabilities.includes("reasoning") ? 4 : candidate.capabilities.includes("agent") ? 2 : 0;
    const lightweight = Math.max(0, 4 - candidate.modelId.length / 20);
    if (strategy === "quality") return quality * 10 + (candidate.cacheImpact === "reusable" ? 1 : 0);
    if (strategy === "lightweight") return lightweight * 10 + (candidate.providerId === input.providerId ? 1 : 0);
    return quality * 5 + lightweight + (candidate.cacheImpact === "reusable" ? 2 : 0);
  }

  private reason(candidate: ReturnType<SmartRoutingService["candidate"]>, strategy: SmartRoutingStrategy): string {
    return `任务按${strategy === "quality" ? "质量优先" : strategy === "lightweight" ? "轻量优先" : "均衡"}选择；能力 ${candidate.capabilities.join("、") || "未声明"}；缓存影响 ${candidate.cacheImpact}。`;
  }

  private remember(decision: RoutingDecision): RoutingDecision {
    this.lastDecision = clone(decision);
    return clone(decision);
  }

  private async persist(): Promise<void> {
    await this.persistence?.saveRoutingSnapshot(this.snapshot());
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
