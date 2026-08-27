import {
  LifecycleContext,
  LifecycleDecision,
  LifecycleDispatchResult,
  LifecycleFailure,
  LifecycleInterceptorDefinition,
  LifecyclePhase,
} from "../../core/lifecycle-contracts";

export class LifecycleInterceptorService {
  private readonly interceptors = new Map<string, LifecycleInterceptorDefinition>();

  register(definition: LifecycleInterceptorDefinition): () => void {
    if (this.interceptors.has(definition.id)) throw new Error(`生命周期拦截器 '${definition.id}' 已注册。`);
    this.interceptors.set(definition.id, definition);
    return () => { this.interceptors.delete(definition.id); };
  }

  async dispatch(phase: LifecyclePhase, context: Omit<LifecycleContext, "phase">): Promise<LifecycleDispatchResult> {
    const invoked: string[] = [];
    const failures: LifecycleFailure[] = [];
    let decision: LifecycleDispatchResult["decision"] = "continue";
    let reason: string | undefined;
    let patch: Record<string, unknown> | undefined;
    const items = [...this.interceptors.values()]
      .filter((item) => item.phase === phase)
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id, "en"));
    for (const interceptor of items) {
      invoked.push(interceptor.id);
      try {
        const result = await interceptor.handle({ ...context, phase });
        if (!result) continue;
        if (result.patch) patch = { ...(patch ?? {}), ...result.patch };
        if (result.decision === "reject") {
          decision = "reject";
          reason = result.reason;
          break;
        }
      } catch (error) {
        failures.push({
          interceptorId: interceptor.id,
          source: interceptor.source,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { phase, decision, ...(reason ? { reason } : {}), ...(patch ? { patch } : {}), invoked, failures };
  }

  snapshot(): LifecycleInterceptorDefinition[] {
    return [...this.interceptors.values()].sort((left, right) => left.id.localeCompare(right.id, "en")).map((item) => ({ ...item }));
  }
}
