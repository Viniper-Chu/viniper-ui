import { LifecycleDecision, LifecyclePhase } from "../../core/lifecycle-contracts";
import { LifecycleInterceptorService } from "./lifecycle-interceptors";

export interface ManagedHookDefinition {
  id: string;
  source: string;
  phase: LifecyclePhase;
  order?: number;
  invoke(input: {
    phase: LifecyclePhase;
    runId: string;
    sessionId: string;
    payload: unknown;
  }): Promise<LifecycleDecision | void> | LifecycleDecision | void;
}

/** Narrow compatibility seam for declarative Claude/Codex-style hook events. */
export class ManagedHookBridge {
  private readonly hooks = new Map<string, () => void>();

  constructor(private readonly lifecycle: LifecycleInterceptorService) {}

  register(definition: ManagedHookDefinition): () => void {
    if (this.hooks.has(definition.id)) throw new Error(`受管 Hook '${definition.id}' 已注册。`);
    const dispose = this.lifecycle.register({
      id: `hook:${definition.id}`,
      source: definition.source,
      phase: definition.phase,
      order: definition.order,
      scope: "run",
      handle: (context) => definition.invoke({
        phase: definition.phase,
        runId: context.runId,
        sessionId: context.sessionId,
        payload: context.payload,
      }),
    });
    this.hooks.set(definition.id, dispose);
    return () => {
      const current = this.hooks.get(definition.id);
      if (!current) return;
      current();
      this.hooks.delete(definition.id);
    };
  }

  dispose(): void {
    for (const dispose of this.hooks.values()) dispose();
    this.hooks.clear();
  }
}
