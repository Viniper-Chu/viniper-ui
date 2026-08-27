import { newId } from "../../core/ids";
import {
  WorkflowDefinition,
  WorkflowPersistence,
  WorkflowRunInput,
  WorkflowRunSnapshot,
  WorkflowSnapshot,
  WorkflowStepSnapshot,
  WorkflowRuntimePort,
} from "../../core/workflow-contracts";
import { PermissionPolicy } from "../permissions/permission-policy";
import { SubagentService } from "./subagent-service";
import { TokenLedger } from "../telemetry/token-ledger";

export interface WorkflowServiceOptions {
  runtime: WorkflowRuntimePort;
  subagents: SubagentService;
  permission: PermissionPolicy;
  persistence?: WorkflowPersistence;
  tokenLedger?: TokenLedger;
  captureArtifact?: (input: { sessionId: string; runId: string; text: string; isError: boolean }) => Promise<string | undefined>;
  maxConcurrent?: number;
  now?: () => number;
}

interface ActiveWorkflow {
  controller: AbortController;
  childRuns: Set<string>;
}

const EMPTY_SNAPSHOT: WorkflowSnapshot = { revision: 0, definitions: [], runs: [] };

export class WorkflowService {
  private readonly now: () => number;
  private readonly maxConcurrent: number;
  private state: WorkflowSnapshot = clone(EMPTY_SNAPSHOT);
  private readonly active = new Map<string, ActiveWorkflow>();
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly options: WorkflowServiceOptions) {
    this.now = options.now ?? Date.now;
    this.maxConcurrent = clamp(options.maxConcurrent ?? 3, 1, 8);
  }

  async initialize(): Promise<void> {
    this.state = clone(await this.options.persistence?.load() ?? EMPTY_SNAPSHOT);
    for (const run of this.state.runs) {
      if (!["running", "queued"].includes(run.status)) continue;
      run.status = "unknown";
      run.updatedAt = this.now();
      for (const step of run.steps) if (["running", "queued"].includes(step.status)) step.status = "unknown";
    }
    await this.persist();
  }

  dispose(): void {
    for (const active of this.active.values()) active.controller.abort();
    this.active.clear();
  }

  snapshot(): WorkflowSnapshot {
    return clone(this.state);
  }

  async register(definition: WorkflowDefinition): Promise<WorkflowDefinition> {
    validateDefinition(definition);
    const existing = this.state.definitions.findIndex((item) => item.id === definition.id);
    if (existing >= 0 && this.state.definitions[existing].revision > definition.revision) throw new Error("WORKFLOW_REVISION_OLDER");
    if (existing >= 0) this.state.definitions[existing] = clone(definition);
    else this.state.definitions.push(clone(definition));
    this.state.revision += 1;
    await this.persist();
    return clone(definition);
  }

  async run(input: WorkflowRunInput): Promise<WorkflowRunSnapshot> {
    validateDefinition(input.definition);
    await this.register(input.definition);
    const run = createRun(input.definition, input.sessionId, this.now());
    this.state.runs.push(run);
    await this.persist();
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    input.signal?.addEventListener("abort", forwardAbort, { once: true });
    this.active.set(run.id, { controller, childRuns: new Set() });
    let acquired = false;
    try {
      const authorization = this.options.permission.begin({
        sessionId: input.sessionId,
        runId: run.id,
        permissionMode: input.permissionMode,
        tool: { id: run.id, name: "workflow.run", summary: input.definition.name, readOnly: false, scope: "computer" },
        signal: controller.signal,
      });
      const permission = await authorization.resolution;
      if (!permission.allowed) {
        this.active.delete(run.id);
        return this.failRun(run, permission.message);
      }
      await this.acquire(controller.signal);
      acquired = true;
      run.status = "running";
      await this.persist();
      await this.execute(run, input, controller.signal);
      if (run.status === "running") run.status = "completed";
      run.output = run.steps.filter((step) => step.output).map((step) => step.output).join("\n");
      run.updatedAt = this.now();
      await this.persist();
      return clone(run);
    } catch (error) {
      run.status = controller.signal.aborted ? "cancelled" : "failed";
      run.error = controller.signal.aborted ? "工作流已取消。" : error instanceof Error ? error.message : String(error);
      run.updatedAt = this.now();
      await this.persist();
      return clone(run);
    } finally {
      input.signal?.removeEventListener("abort", forwardAbort);
      this.active.delete(run.id);
      if (acquired) this.release();
    }
  }

  async cancel(id: string): Promise<boolean> {
    const active = this.active.get(id);
    const run = this.state.runs.find((item) => item.id === id);
    if (!active || !run) return false;
    active.controller.abort();
    await Promise.all([...active.childRuns].map((runId) => this.options.runtime.cancelRun(runId)));
    run.status = "cancelled";
    run.error = "工作流已取消。";
    run.updatedAt = this.now();
    await this.persist();
    return true;
  }

  async recover(id: string, decision?: "reconfirm"): Promise<WorkflowRunSnapshot> {
    const run = this.state.runs.find((item) => item.id === id);
    const definition = run && this.state.definitions.find((item) => item.id === run.workflowId && item.revision === run.workflowRevision);
    if (!run || !definition || run.status !== "unknown") throw new Error("WORKFLOW_RECOVERY_NOT_AVAILABLE");
    if (decision !== "reconfirm") throw new Error("WORKFLOW_RECOVERY_REQUIRES_REAUTHORIZATION");
    const authorization = this.options.permission.begin({
      sessionId: run.sessionId,
      runId: run.id,
      permissionMode: "auto",
      tool: { id: run.id, name: "workflow.recover", summary: "恢复未知工作流步骤", readOnly: false, scope: "computer" },
      signal: new AbortController().signal,
    });
    const permission = await authorization.resolution;
    if (!permission.allowed) {
      run.error = permission.message;
      await this.persist();
      return clone(run);
    }
    run.status = "running";
    run.error = undefined;
    const controller = new AbortController();
    this.active.set(run.id, { controller, childRuns: new Set() });
    try {
      await this.execute(run, { definition, sessionId: run.sessionId, permissionMode: "auto", input: {} }, controller.signal, true);
      run.status = "completed";
      run.updatedAt = this.now();
      await this.persist();
      return clone(run);
    } catch (error) {
      run.status = controller.signal.aborted ? "cancelled" : "failed";
      run.error = error instanceof Error ? error.message : String(error);
      await this.persist();
      return clone(run);
    } finally {
      this.active.delete(run.id);
    }
  }

  private async execute(run: WorkflowRunSnapshot, input: WorkflowRunInput, signal: AbortSignal, recoveryOnly = false): Promise<void> {
    const definitionById = new Map(input.definition.steps.map((step) => [step.id, step]));
    const outputs = new Map<string, string>();
    const executeOne = async (step: WorkflowStepSnapshot, definition: WorkflowDefinition, promptOverride?: string): Promise<void> => {
      if (recoveryOnly && step.status === "completed") return;
      if (step.status === "completed" || step.status === "skipped") return;
      if (signal.aborted) throw new Error("工作流已取消。");
      const source = definitionById.get(step.id) ?? definition.steps.find((item) => item.id === step.id)!;
      step.status = "running";
      step.attempts += 1;
      const prompt = promptOverride ?? source.prompt;
      step.input = prompt;
      step.updatedAt = this.now();
      await this.persist();
      try {
        if (source.kind === "route") {
          const selected = selectRoute(source, input.input);
          if (!selected) throw new Error("工作流路由没有匹配分支。");
          step.selectedBranch = selected;
          step.output = selected;
        } else if (source.kind === "delegate" || run.mode === "orchestrator-workers") {
          const target = source.targetSessionId;
          if (!target) throw new Error("子 Agent 步骤缺少目标会话。");
          const receipt = await this.options.subagents.spawn({ parentSessionId: run.sessionId, targetSessionId: target, prompt: source.prompt, permissionMode: input.permissionMode, signal });
          if (receipt.status !== "completed") throw new Error(receipt.error ?? "子 Agent 未完成。");
          step.output = receipt.output ?? "";
        } else {
          const result = await this.runAgentStep(run, prompt, input.permissionMode, signal);
          step.runId = result.runId;
          step.output = result.output;
          run.usage.estimatedTokens += estimateTokens(result.output);
          const artifactId = await this.options.captureArtifact?.({ sessionId: run.sessionId, runId: run.id, text: result.output, isError: false });
          if (artifactId) run.artifactIds.push(artifactId);
          const telemetry = this.options.tokenLedger?.snapshot().sessions.find((item) => item.sessionId === run.sessionId)?.latestRun?.usage;
          if (telemetry) {
            run.usage.provider = telemetry.source === "provider" ? telemetry : run.usage.provider;
            run.usage.cacheRead = telemetry.cacheHitInput;
            run.usage.cacheMiss = telemetry.cacheMissInput;
          }
        }
        if (step.output !== undefined) outputs.set(step.id, step.output);
        step.status = "completed";
      } catch (error) {
        step.status = signal.aborted ? "cancelled" : "failed";
        step.error = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        step.updatedAt = this.now();
        await this.persist();
      }
    };
    if (run.mode === "routing") {
      const route = run.steps.find((step) => (definitionById.get(step.id)?.kind ?? step.kind) === "route");
      if (!route) throw new Error("routing 工作流缺少显式 route 步骤。");
      await executeOne(route, input.definition);
      const selected = route.selectedBranch;
      for (const step of run.steps) {
        if (step.id === route.id || step.id === selected) continue;
        if (step.status === "queued" || step.status === "unknown") step.status = "skipped";
      }
      const branch = selected && run.steps.find((step) => step.id === selected);
      if (!branch) throw new Error("工作流路由目标不存在。");
      await executeOne(branch, input.definition, `${definitionById.get(branch.id)?.prompt ?? ""}\n\n路由结果：${selected}`);
      return;
    }
    if (run.mode === "parallelisation") {
      await Promise.all(run.steps.map((step) => executeOne(step, input.definition)));
      return;
    }
    if (run.mode === "evaluator-optimiser") {
      const generator = run.steps.find((step) => definitionById.get(step.id)?.kind !== "evaluate");
      const evaluator = run.steps.find((step) => definitionById.get(step.id)?.kind === "evaluate");
      if (!generator || !evaluator) throw new Error("evaluator-optimiser 需要生成步骤和评估步骤。");
      await executeOne(generator, input.definition);
      await executeOne(evaluator, input.definition, `${definitionById.get(evaluator.id)?.prompt ?? "评估生成结果"}\n\n待评估结果：${generator.output ?? ""}`);
      const needsImprovement = !/(?:pass|通过|ok|无需改进)/iu.test(evaluator.output ?? "");
      const improvementId = definitionById.get(evaluator.id)?.improvementStepId;
      const improvement = improvementId ? run.steps.find((step) => step.id === improvementId) : run.steps.find((step) => step.id !== generator.id && step.id !== evaluator.id && definitionById.get(step.id)?.kind === "prompt");
      if (needsImprovement && improvement) {
        await executeOne(improvement, input.definition, `${definitionById.get(improvement.id)?.prompt ?? "改进结果"}\n\n原结果：${generator.output ?? ""}\n评估：${evaluator.output ?? ""}`);
      } else {
        for (const step of run.steps) if (step.id !== generator.id && step.id !== evaluator.id && step.status === "queued") step.status = "skipped";
      }
      return;
    }
    let previous = "";
    for (const step of run.steps) {
      const source = definitionById.get(step.id);
      const chainedPrompt = run.mode === "prompt-chaining" && previous
        ? `${source?.prompt ?? ""}\n\n上一步输出（工作流上下文）：${previous}`
        : source?.prompt;
      await executeOne(step, input.definition, chainedPrompt);
      previous = step.output ?? previous;
    }
  }

  private async runAgentStep(run: WorkflowRunSnapshot, prompt: string, permissionMode: WorkflowRunInput["permissionMode"], signal: AbortSignal): Promise<{ runId: string; output: string }> {
    let unlisten: (() => void) | undefined;
    let childRunId: string | undefined;
    const completion = new Promise<{ runId: string; output: string }>((resolve, reject) => {
      unlisten = this.options.runtime.onRunCompleted((result) => {
        if (result.origin.workflowRunId !== run.id) return;
        if (childRunId && result.runId !== childRunId) return;
        if (result.status === "completed") resolve({ runId: result.runId, output: result.assistantText });
        else reject(new Error(`工作流 Agent 步骤${result.status === "cancelled" ? "已取消" : "失败"}。`));
      });
    });
    const sent = await this.options.runtime.send({
      sessionId: run.sessionId,
      text: prompt,
      attachments: [],
      selectedModel: this.options.runtime.getSession(run.sessionId)?.selectedModel ?? "demo-default",
      permissionMode,
      origin: { kind: "user", workflowRunId: run.id },
    });
    if (!sent.accepted) throw new Error(sent.reason ?? "工作流 Agent 步骤未接受。");
    childRunId = sent.runId;
    const active = this.active.get(run.id);
    if (sent.runId) active?.childRuns.add(sent.runId);
    try {
      return await raceAbort(completion, signal, () => sent.runId ? this.options.runtime.cancelRun(sent.runId!) : Promise.resolve(false));
    } finally {
      unlisten?.();
    }
  }

  private failRun(run: WorkflowRunSnapshot, error: string): WorkflowRunSnapshot {
    run.status = "failed";
    run.error = error;
    run.updatedAt = this.now();
    void this.persist();
    return clone(run);
  }

  private acquire(signal: AbortSignal): Promise<void> {
    if (this.active.size <= this.maxConcurrent) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const waiter = () => { signal.removeEventListener("abort", abort); resolve(); };
      const abort = () => { const index = this.waiters.indexOf(waiter); if (index >= 0) this.waiters.splice(index, 1); reject(new Error("工作流等待已取消。")); };
      signal.addEventListener("abort", abort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private release(): void { this.waiters.shift()?.(); }
  private async persist(): Promise<void> { await this.options.persistence?.save(clone(this.state)); }
}

function createRun(definition: WorkflowDefinition, sessionId: string, now: number): WorkflowRunSnapshot {
  return {
    id: newId("workflow"),
    workflowId: definition.id,
    workflowRevision: definition.revision,
    sessionId,
    mode: definition.mode,
    status: "queued",
    steps: definition.steps.map((step) => ({ id: step.id, kind: step.kind, status: "queued", attempts: 0, updatedAt: now })),
    usage: { estimatedTokens: 0, cacheRead: null, cacheMiss: null },
    artifactIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

function validateDefinition(definition: WorkflowDefinition): void {
  if (!definition.id.trim() || !definition.steps.length) throw new Error("WORKFLOW_DEFINITION_INVALID");
  if (new Set(definition.steps.map((step) => step.id)).size !== definition.steps.length) throw new Error("WORKFLOW_STEP_DUPLICATE");
  if (definition.mode === "routing") {
    const route = definition.steps.find((step) => step.kind === "route");
    if (!route || !route.routeBranches?.length) throw new Error("WORKFLOW_ROUTE_INVALID");
    const ids = new Set(definition.steps.map((step) => step.id));
    if (route.routeBranches.some((branch) => !ids.has(branch.stepId))) throw new Error("WORKFLOW_ROUTE_TARGET_INVALID");
  }
  if (definition.mode === "evaluator-optimiser") {
    const evaluator = definition.steps.find((step) => step.kind === "evaluate");
    if (!evaluator || !definition.steps.some((step) => step.kind !== "evaluate")) throw new Error("WORKFLOW_EVALUATOR_INVALID");
    if (evaluator.improvementStepId && !idsFor(definition).has(evaluator.improvementStepId)) throw new Error("WORKFLOW_IMPROVEMENT_TARGET_INVALID");
  }
}

function idsFor(definition: WorkflowDefinition): Set<string> {
  return new Set(definition.steps.map((step) => step.id));
}

function selectRoute(step: import("../../core/workflow-contracts").WorkflowStepDefinition, input: Record<string, unknown>): string | undefined {
  const value = String(input[step.inputKey ?? "route"] ?? "");
  return step.routeBranches?.find((branch) => branch.when === value)?.stepId ?? step.defaultBranchStepId;
}

function estimateTokens(text: string): number { return Math.max(1, Math.ceil([...text].length / 3)); }

function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, Math.floor(value))); }

async function raceAbort<T>(promise: Promise<T>, signal: AbortSignal, cancel: () => Promise<unknown>): Promise<T> {
  if (signal.aborted) { await cancel(); throw new Error("工作流已取消。"); }
  return new Promise<T>((resolve, reject) => {
    const abort = () => { void cancel().finally(() => reject(new Error("工作流已取消。"))); };
    signal.addEventListener("abort", abort, { once: true });
    promise.then((value) => { signal.removeEventListener("abort", abort); resolve(value); }, (error) => { signal.removeEventListener("abort", abort); reject(error); });
  });
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
