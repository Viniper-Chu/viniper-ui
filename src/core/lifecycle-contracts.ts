export type LifecyclePhase =
  | "run/pre-step"
  | "provider/pre-request"
  | "tool/pre-execute"
  | "tool/execute"
  | "tool/post-execute"
  | "tool/result"
  | "run/pre-stop"
  | "run/completed";

export type LifecycleScope = "global" | "session" | "run";

export interface LifecycleContext {
  runId: string;
  sessionId: string;
  phase?: LifecyclePhase;
  payload: unknown;
}

export interface LifecycleDecision {
  decision: "continue" | "reject";
  reason?: string;
  patch?: Record<string, unknown>;
}

export interface LifecycleInterceptorDefinition {
  id: string;
  version?: string;
  source: string;
  phase: LifecyclePhase;
  order?: number;
  scope: LifecycleScope;
  handle(context: LifecycleContext): Promise<LifecycleDecision | void> | LifecycleDecision | void;
}

export interface LifecycleFailure {
  interceptorId: string;
  source: string;
  detail: string;
}

export interface LifecycleDispatchResult {
  phase: LifecyclePhase;
  decision: "continue" | "reject";
  reason?: string;
  patch?: Record<string, unknown>;
  invoked: string[];
  failures: LifecycleFailure[];
}
