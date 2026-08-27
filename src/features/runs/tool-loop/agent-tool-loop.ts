import { ActivityRecord, RuntimeEventType, RuntimePlanSnapshot, ToolRequest } from "../../../core/contracts";
import {
  ProviderContentItem,
  ProviderEvent,
  ProviderHistoryEntry,
  ProviderReasoningItem,
  ProviderRequest,
  ProviderToolCallItem,
  ProviderToolResultItem,
} from "../../../core/provider-contracts";
import { newId } from "../../../core/ids";
import { ModelProvider } from "../../providers/model-provider";
import { PermissionPolicy } from "../../permissions/permission-policy";
import { ToolRegistry } from "../../tools/tool-registry";
import { ToolResourceCoordinator, ToolResourceLease } from "../../tools/resource-lock";
import { validateToolInput } from "./tool-input-validator";
import { ManagedArtifactService } from "../../tool-output/managed-artifact-service";
import { runProviderWithRetries } from "../../providers/provider-retry";
import type { ExtensionRunSnapshot } from "../../extensions/extension-manager";
import type { FrozenRunContext } from "../../../core/composition-contracts";
import { LifecycleInterceptorService } from "../../composition/lifecycle-interceptors";
import { RunSteeringService } from "../../composition/run-steering";
import type { CodeSubcallInput, CodeSubcallResult } from "../../../core/code-mode-contracts";
import { engineScopedId, engineScopeOf } from "../../../core/engine-identity";

export interface AgentToolLoopOptions {
  provider: ModelProvider;
  request: ProviderRequest;
  toolRegistry: ToolRegistry;
  projectRoot?: string;
  authorizationProjectRoot?: string;
  workspaceId?: string;
  commitRequested?: boolean;
  extensionSnapshot?: ExtensionRunSnapshot;
  frozenRunContext?: FrozenRunContext;
  lifecycle?: LifecycleInterceptorService;
  steering?: RunSteeringService;
  codeSubcallInvoker?: (input: CodeSubcallInput) => Promise<CodeSubcallResult>;
  signal: AbortSignal;
  now: () => number;
  maxRounds?: number;
  maxProviderRequests?: number;
  reviewPlan?: ReviewExecutionPlan;
  onProviderEvent(event: ProviderEvent): Promise<void>;
  appendHistory(entries: ProviderHistoryEntry[]): Promise<void>;
  emit(type: RuntimeEventType, payload: unknown): Promise<void>;
  runId?: string;
  permissionPolicy?: PermissionPolicy;
  resourceCoordinator?: ToolResourceCoordinator;
  onToolResult?(call: ProviderToolCallItem, result: ProviderToolResultItem): Promise<void>;
  artifactService?: ManagedArtifactService;
  onProviderAttempt?(
    attempt: number,
    budget: { ordinal: number; limit: number; remaining: number },
  ): Promise<void> | void;
  onProviderRetry?(input: { attempt: number; nextAttempt: number; error: unknown }): Promise<void> | void;
  providerRetryDelayMs?: number | ((retryNumber: number) => number);
}

export interface ReviewExecutionPlan {
  id: string;
  checkpointId: string;
  steps: Array<{
    id: string;
    title: string;
    status: "pending" | "in_progress" | "completed" | "blocked";
  }>;
}

/**
 * Narrow internal seam shared by normal Provider tool calls and Code Mode
 * SDK subcalls.  A subcall must re-enter this pipeline instead of calling a
 * registry executor directly.
 */
export type ToolDispatchOptions = Pick<AgentToolLoopOptions,
  | "request"
  | "toolRegistry"
  | "projectRoot"
  | "authorizationProjectRoot"
  | "workspaceId"
  | "commitRequested"
  | "extensionSnapshot"
  | "frozenRunContext"
  | "codeSubcallInvoker"
  | "signal"
  | "now"
  | "lifecycle"
  | "permissionPolicy"
  | "resourceCoordinator"
  | "artifactService"
  | "runId"
  | "emit">;

export interface AgentToolLoopResult {
  assistantText: string;
  rounds: number;
}

export class ToolLoopLimitError extends Error {
  constructor(readonly maxRounds: number) {
    super(`工具续轮已达到上限（${maxRounds} 轮），已停止以避免无限循环。`);
  }
}

export class ProviderRequestBudgetExceededError extends Error {
  constructor(readonly limit: number, readonly started: number) {
    super(`Provider 请求预算已耗尽（${started}/${limit}）；未启动下一次请求。`);
  }
}

export class ProviderFinalAnswerMissingError extends Error {
  readonly retryable = true;

  constructor(readonly round: number) {
    super(`Provider 在第 ${round} 轮结束时没有返回可见终答。`);
    this.name = "ProviderFinalAnswerMissingError";
  }
}

export class ReviewNoProgressError extends Error {
  constructor(readonly checkpointId: string, readonly fingerprint: string) {
    super(`规划检查点 ${checkpointId} 出现等价只读动作且没有新产物或计划推进；已停止下一次 Provider 请求。`);
  }
}

class ProviderRequestBudget {
  private started = 0;

  constructor(readonly limit: number) {}

  reserve(): number {
    if (this.started >= this.limit) throw new ProviderRequestBudgetExceededError(this.limit, this.started);
    this.started += 1;
    return this.started;
  }
}

export async function runAgentToolLoop(options: AgentToolLoopOptions): Promise<AgentToolLoopResult> {
  const maxRounds = options.maxRounds ?? 24;
  const requestBudget = new ProviderRequestBudget(options.maxProviderRequests ?? maxRounds);
  const frozenTools = [...(options.frozenRunContext?.toolDescriptors ?? options.request.tools)];
  const history = clone(options.request.history);
  const completedToolResults = new Map<string, ProviderToolResultItem>();
  const reviewFingerprints = new Set<string>();
  let reviewNoProgress: { checkpointId: string; fingerprint: string } | undefined;
  let completeText = "";

  if (options.reviewPlan) {
    await options.emit("plan.updated", { plan: projectReviewPlan(options.reviewPlan) });
    await options.emit("run.checkpoint", {
      phase: "review",
      status: "started",
      reviewPlan: clone(options.reviewPlan),
    });
  }

  for (let round = 1; round <= maxRounds; round += 1) {
    if (reviewNoProgress) {
      await options.emit("interaction.requested", {
        ...activity({
        kind: "error",
        title: "规划无进展，已停止续轮",
        detail: `检查点 ${reviewNoProgress.checkpointId} 重复了等价只读动作；未继续请求 Provider。`,
        status: "failed",
        now: options.now,
        }),
        reason: "review_no_progress",
      });
      throw new ReviewNoProgressError(reviewNoProgress.checkpointId, reviewNoProgress.fingerprint);
    }
    const preStep = await options.lifecycle?.dispatch("run/pre-step", {
      runId: options.runId ?? `standalone-${options.request.sessionId}`,
      sessionId: options.request.sessionId,
      payload: { round },
    });
    await emitLifecycleOutcome(options, preStep);
    if (preStep?.decision === "reject") throw new Error(preStep.reason ?? "运行前步骤被生命周期拦截器拒绝。");
    const steering = options.runId ? options.steering?.claimForPreStep(options.runId) ?? [] : [];
    for (const receipt of steering) {
      const text = receipt.kind === "steer"
        ? String(receipt.payload)
        : `运行中注入上下文：${JSON.stringify(receipt.payload)}`;
      const entry: ProviderHistoryEntry = {
        id: newId(`provider-${receipt.kind}`),
        role: "user",
        items: [{ type: "text", text }],
      };
      history.push(entry);
      await options.appendHistory([entry]);
      await options.emit("steering.updated", { receipt });
    }
    const roundItems: ProviderContentItem[] = [];
    const toolCalls: ProviderToolCallItem[] = [];
    // Text emitted in a tool-calling round is provisional context for the
    // follow-up request.  It must not satisfy the final-answer gate on a
    // later round that produced no new visible answer.
    let roundText = "";
    let reasoningText = "";
    let reasoningItemId: string | undefined;

    const preRequest = await options.lifecycle?.dispatch("provider/pre-request", {
      runId: options.runId ?? `standalone-${options.request.sessionId}`,
      sessionId: options.request.sessionId,
      payload: { round, request: options.request },
    });
    await emitLifecycleOutcome(options, preRequest);
    if (preRequest?.decision === "reject") throw new Error(preRequest.reason ?? "Provider 请求被生命周期拦截器拒绝。");
    let providerResult;
    try {
      providerResult = await runProviderWithRetries({
        stream: () => options.provider.stream({
          ...options.request,
          tools: clone(frozenTools),
          frozenRunContext: options.frozenRunContext,
          history: clone(history),
        }, options.signal),
        onAttempt: async (attempt) => {
          const ordinal = requestBudget.reserve();
          await options.onProviderAttempt?.(attempt, {
            ordinal,
            limit: requestBudget.limit,
            remaining: requestBudget.limit - ordinal,
          });
        },
        onRetry: options.onProviderRetry,
        retryDelayMs: options.providerRetryDelayMs,
      });
    } catch (error) {
      if (!(error instanceof ProviderRequestBudgetExceededError)) throw error;
      await options.emit("interaction.requested", {
        ...activity({
        kind: "error",
        title: "Provider 请求预算已耗尽",
        detail: error.message,
        status: "failed",
        now: options.now,
        }),
        reason: "budget_exhausted",
      });
      throw error;
    }
    if (!providerResult.ok) throw providerResult.error;
    for (const event of providerResult.events) {
      if (options.signal.aborted) throw new Error("Provider 请求已取消。");
      await options.onProviderEvent(event);
      switch (event.kind) {
        case "text.delta":
          completeText += event.text;
          roundText += event.text;
          appendAdjacentText(roundItems, event.text);
          break;
        case "reasoning.delta":
          reasoningText += event.text;
          reasoningItemId = event.itemId ?? reasoningItemId;
          appendAdjacentReasoning(roundItems, event.text, reasoningItemId, options.request.profileId);
          break;
        case "reasoning.completed":
          replaceReasoning(roundItems, event.item);
          reasoningText = event.item.text;
          reasoningItemId = event.item.itemId;
          break;
        case "tool-call.completed":
          toolCalls.push(clone(event.call));
          roundItems.push(clone(event.call));
          break;
        case "continuation.updated":
          roundItems.push(clone(event.item));
          break;
        case "model-step.completed":
          roundItems.push(clone(event.item));
          break;
        default:
          break;
      }
    }

    if (reasoningText && !roundItems.some((item) => item.type === "reasoning")) {
      roundItems.unshift({
        type: "reasoning",
        text: reasoningText,
        itemId: reasoningItemId,
        providerId: options.request.profileId,
      });
    }
    if (roundItems.length) {
      const assistantEntry: ProviderHistoryEntry = {
        id: newId("provider-assistant"),
        role: "assistant",
        items: clone(roundItems),
      };
      history.push(assistantEntry);
      await options.appendHistory([assistantEntry]);
    }

    if (toolCalls.length === 0) {
      if (!roundText.trim()) throw new ProviderFinalAnswerMissingError(round);
      if (options.reviewPlan) {
        completeReviewPlan(options.reviewPlan);
        await options.emit("plan.updated", { plan: projectReviewPlan(options.reviewPlan) });
      }
      return { assistantText: completeText, rounds: round };
    }
    if (round === maxRounds) {
      await options.emit("interaction.requested", activity({
        kind: "error",
        title: "工具续轮已停止",
        detail: `已达到 ${maxRounds} 轮上限；未继续请求 Provider。`,
        status: "failed",
        now: options.now,
      }));
      throw new ToolLoopLimitError(maxRounds);
    }

    for (const call of toolCalls) {
      const previous = completedToolResults.get(call.callId);
      const result = previous ? clone(previous) : await dispatchToolCall(call, options, frozenTools);
      completedToolResults.set(call.callId, clone(result));
      await options.onToolResult?.(call, clone(result));
      const toolEntry: ProviderHistoryEntry = {
        id: newId("provider-tool"),
        role: "tool",
        items: [result],
      };
      history.push(toolEntry);
      await options.appendHistory([toolEntry]);
      if (options.reviewPlan) {
        const tool = options.toolRegistry.has(call.name) ? options.toolRegistry.get(call.name) : undefined;
        if (tool?.readOnly) {
          const fingerprint = reviewToolFingerprint(call);
          if (reviewFingerprints.has(fingerprint)) {
            reviewNoProgress = { checkpointId: options.reviewPlan.checkpointId, fingerprint };
          } else {
            reviewFingerprints.add(fingerprint);
          }
        } else if (!result.isError) {
          reviewFingerprints.clear();
          advanceReviewPlan(options.reviewPlan);
          await options.emit("plan.updated", { plan: projectReviewPlan(options.reviewPlan) });
          await options.emit("run.checkpoint", {
            phase: "review",
            status: "started",
            reviewPlan: clone(options.reviewPlan),
          });
        }
      }
      if (options.signal.aborted) throw new Error("当前运行已取消。");
    }
  }

  return { assistantText: completeText, rounds: maxRounds };
}

function advanceReviewPlan(plan: ReviewExecutionPlan): void {
  const currentIndex = plan.steps.findIndex((step) => step.id === plan.checkpointId);
  if (currentIndex < 0) return;
  plan.steps[currentIndex].status = "completed";
  const next = plan.steps[currentIndex + 1];
  if (next) {
    next.status = "in_progress";
    plan.checkpointId = next.id;
  }
}

function projectReviewPlan(plan: ReviewExecutionPlan): RuntimePlanSnapshot {
  return {
    explanation: "规划自动审核会按完成状态推进；超出计划范围的动作仍转为人工确认。",
    steps: plan.steps.map((step) => ({ id: step.id, step: step.title, status: step.status })),
  };
}

function completeReviewPlan(plan: ReviewExecutionPlan): void {
  const current = plan.steps.find((step) => step.id === plan.checkpointId);
  if (current) current.status = "completed";
}

function reviewToolFingerprint(call: ProviderToolCallItem): string {
  return `${call.name}:${stableJson(call.arguments)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function dispatchToolCall(
  call: ProviderToolCallItem,
  options: ToolDispatchOptions,
  frozenTools: ProviderRequest["tools"],
): Promise<ProviderToolResultItem> {
  const engineId = engineScopeOf(options.request.sessionId) ?? "viniper";
  const activityId = engineScopedId(engineId, "item", newId("tool-activity"));
  if (!frozenTools.some((tool) => tool.name === call.name)) {
    const message = `工具 ${call.name} 未向本次运行开放或广告；未执行。`;
    await options.emit("tool.requested", activity({
      id: activityId,
      kind: "tool",
      title: `未开放工具：${call.name}`,
      detail: message,
      status: "failed",
      callId: call.callId,
      parentCallId: call.parentCallId,
      toolName: call.name,
      now: options.now,
    }));
    await options.emit("interaction.requested", activity({
      kind: "interaction",
      title: "工具未获执行",
      detail: message,
      status: "failed",
      callId: call.callId,
      parentCallId: call.parentCallId,
      toolName: call.name,
      now: options.now,
    }));
    return toolResult(call, message, true);
  }
  if (!options.toolRegistry.has(call.name)) {
    const message = `Provider 请求了未注册工具 ${call.name}；未执行。`;
    await options.emit("tool.requested", activity({
      id: activityId,
      kind: "tool",
      title: `未知工具：${call.name}`,
      detail: message,
      status: "failed",
      now: options.now,
    }));
    await options.emit("interaction.requested", activity({
      kind: "interaction",
      title: "工具未获执行",
      detail: message,
      status: "waiting",
      now: options.now,
    }));
    return toolResult(call, message, true);
  }

  const owner = options.toolRegistry.managedOwner(call.name);
  if (owner) {
    const frozenExtension = options.extensionSnapshot?.[owner]
      ?? options.frozenRunContext?.extensions[owner];
    if (!frozenExtension
      || !frozenExtension.trusted
      || !frozenExtension.enabled
      || !frozenExtension.tools.includes(call.name)) {
      const message = `工具 ${call.name} 不属于本次运行冻结的受管扩展版本；未执行。`;
      await options.emit("tool.requested", activity({
        id: activityId,
        kind: "tool",
        title: `冻结版本不匹配：${call.name}`,
        detail: message,
        status: "failed",
        callId: call.callId,
        parentCallId: call.parentCallId,
        toolName: call.name,
        now: options.now,
      }));
      await options.emit("tool.failed", { activityId, result: message });
      return toolResult(call, message, true);
    }
  }

  const tool = options.toolRegistry.get(call.name);
  const preExecute = await options.lifecycle?.dispatch("tool/pre-execute", {
    runId: options.runId ?? `standalone-${options.request.sessionId}`,
    sessionId: options.request.sessionId,
    payload: { callId: call.callId, parentCallId: call.parentCallId, toolName: call.name, arguments: call.arguments },
  });
  await emitLifecycleOutcome(options, preExecute);
  if (preExecute?.decision === "reject") {
    const message = preExecute.reason ?? "工具被生命周期拦截器拒绝。";
    await options.emit("tool.failed", { result: message, callId: call.callId, parentCallId: call.parentCallId });
    return toolResult(call, message, true);
  }
  const validation = validateToolInput(tool.inputSchema, call.arguments);
  const request: ToolRequest = {
    id: call.callId,
    parentCallId: call.parentCallId,
    name: call.name,
    summary: call.argumentsText || JSON.stringify(call.arguments),
    readOnly: tool.readOnly,
    scope: tool.authorizationScope ?? "computer",
    input: clone(call.arguments),
  };
  const permissionPolicy = options.permissionPolicy ?? new PermissionPolicy("fail-closed", options.now);
  const authorization = validation.valid
    ? permissionPolicy.begin({
        engineId,
        sessionId: options.request.sessionId,
        runId: options.runId ?? `standalone-${options.request.sessionId}`,
        permissionMode: options.request.permissionMode,
        projectRoot: options.authorizationProjectRoot ?? options.projectRoot,
        tool: request,
        signal: options.signal,
      })
    : undefined;
  const immediateResolution = authorization && authorization.state !== "pending"
    ? await authorization.resolution
    : undefined;
  await options.emit("tool.requested", activity({
    id: activityId,
    kind: "tool",
    title: tool.description,
    detail: immediateResolution && options.request.permissionMode === "review"
      ? `${request.summary}\n${permissionDecisionDetail(immediateResolution)}`
      : request.summary,
    status: validation.valid && authorization?.state === "allowed" ? "running" : "waiting",
    readOnly: tool.readOnly,
    callId: call.callId,
    parentCallId: call.parentCallId,
    toolName: call.name,
    now: options.now,
  }));

  if (!validation.valid) {
    const message = `工具参数校验失败：${validation.message}`;
    await options.emit("tool.failed", { activityId, result: message });
    return toolResult(call, message, true);
  }
  const pendingRequest = authorization?.request;
  if (authorization?.state === "pending" && pendingRequest) {
    await options.emit("interaction.requested", activity({
      id: pendingRequest.id,
      kind: "interaction",
      title: "等待工具权限",
      detail: tool.readOnly ? "只读工具等待本次批准。" : "此工具会改变本地应用状态，等待本次批准。",
      status: "waiting",
      readOnly: tool.readOnly,
      callId: call.callId,
      parentCallId: call.parentCallId,
      toolName: call.name,
      now: options.now,
    }));
  }
  const resolution = immediateResolution ?? await authorization!.resolution;
  if (pendingRequest) {
    await options.emit("interaction.resolved", {
      activityId: pendingRequest.id,
      callId: call.callId,
      toolName: call.name,
      decision: resolution.allowed ? "allow-once" : "reject",
      detail: resolution.allowed ? "已仅允许本次工具调用。" : resolution.message,
    });
  }
  if (!resolution.allowed) {
    const message = resolution.message;
    if (authorization?.state === "rejected") {
      await options.emit("interaction.requested", activity({
        kind: "interaction",
        title: "工具已安全拒绝",
        detail: message,
        status: "failed",
        readOnly: tool.readOnly,
        callId: call.callId,
        parentCallId: call.parentCallId,
        toolName: call.name,
        now: options.now,
      }));
    }
    await options.emit("tool.failed", {
      activityId,
      callId: call.callId,
      toolName: call.name,
      result: message,
      reason: resolution.reason,
      detail: permissionDecisionDetail(resolution),
    });
    return toolResult(call, message, true);
  }

  let lease: ToolResourceLease | undefined;
  try {
    const executionContext = {
      engineId,
      sessionId: options.request.sessionId,
      runId: options.runId ?? `standalone-${options.request.sessionId}`,
      projectRoot: options.projectRoot,
      workspaceId: options.workspaceId,
      commitRequested: options.commitRequested,
      extensionSnapshot: options.extensionSnapshot,
      frozenRunContext: options.frozenRunContext,
      codeSubcallInvoker: options.codeSubcallInvoker,
      providerSnapshot: {
        providerId: options.request.profileId,
        profileId: options.request.profileId,
        modelId: options.request.selectedModel,
        permissionMode: options.request.permissionMode,
        reasoning: options.request.reasoning,
      },
      signal: options.signal,
    };
    const claims = tool.resourceClaims?.(request, executionContext) ?? [];
    const resourceCoordinator = options.resourceCoordinator;
    if (resourceCoordinator && claims.length > 0) {
      let waitActivityId: string | undefined;
      if (!resourceCoordinator.canAcquire(claims)) {
        waitActivityId = engineScopedId(engineId, "item", newId("resource-wait"));
        await options.emit("interaction.requested", activity({
          id: waitActivityId,
          kind: "interaction",
          title: "等待项目资源",
          detail: "另一个会话正在使用相同路径；本次调用等待资源锁，不并发写入。",
          status: "waiting",
          readOnly: tool.readOnly,
          callId: call.callId,
          parentCallId: call.parentCallId,
          toolName: call.name,
          now: options.now,
        }));
      }
      lease = await resourceCoordinator.acquire(claims, options.signal);
      if (waitActivityId) {
        await options.emit("interaction.resolved", {
          activityId: waitActivityId,
          decision: "allow-once",
          detail: "资源锁已取得，继续本次工具调用。",
        });
      }
    }
    const executeDecision = await options.lifecycle?.dispatch("tool/execute", {
      runId: executionContext.runId,
      sessionId: executionContext.sessionId,
      payload: { request },
    });
    await emitLifecycleOutcome(options, executeDecision);
    if (executeDecision?.decision === "reject") {
      const message = executeDecision.reason ?? "工具执行被生命周期拦截器拒绝。";
      await options.emit("tool.failed", { activityId, result: message });
      return toolResult(call, message, true);
    }
    const result = await tool.execute(request, {
      ...executionContext,
    });
    const postExecute = await options.lifecycle?.dispatch("tool/post-execute", {
      runId: executionContext.runId,
      sessionId: executionContext.sessionId,
      payload: { request, result },
    });
    await emitLifecycleOutcome(options, postExecute);
    const displayText = result.displayText ?? result.text;
    const artifact = await options.artifactService?.captureToolResult({
      sessionId: options.request.sessionId,
      runId: executionContext.runId,
      toolName: call.name,
      text: result.text,
      isError: result.isError === true,
    });
    const modelText = !options.artifactService
      ? result.text
      : artifact?.ok === true
        ? await options.artifactService.modelProjection(artifact.record)
        : "工具结果未能写入受管产物；为避免丢失或越权，未向 Provider 传送完整结果。";
    if (result.cancelled) await options.emit("tool.cancelled", {
      activityId,
      result: displayText,
      ...(result.presentation ? { presentation: clone(result.presentation) } : {}),
    });
    else if (result.isError) await options.emit("tool.failed", {
      activityId,
      result: displayText,
      ...(result.presentation ? { presentation: clone(result.presentation) } : {}),
    });
    else await options.emit("tool.completed", {
      activityId,
      result: displayText,
      ...(result.presentation ? { presentation: clone(result.presentation) } : {}),
    });
    const finalResult = toolResult(call, modelText, result.isError === true);
    const resultDecision = await options.lifecycle?.dispatch("tool/result", {
      runId: executionContext.runId,
      sessionId: executionContext.sessionId,
      payload: { request, result: finalResult },
    });
    await emitLifecycleOutcome(options, resultDecision);
    return finalResult;
  } catch (error) {
    if (options.signal.aborted) throw error;
    const message = `工具执行失败：${error instanceof Error ? error.message : String(error)}`;
    await options.emit("tool.failed", { activityId, result: message });
    return toolResult(call, message, true);
  } finally {
    lease?.release();
  }
}

async function emitLifecycleOutcome(
  options: Pick<ToolDispatchOptions, "lifecycle" | "emit">,
  result: Awaited<ReturnType<LifecycleInterceptorService["dispatch"]>> | undefined,
): Promise<void> {
  if (!result) return;
  if (result.failures.length > 0) await options.emit("lifecycle.failed", { phase: result.phase, failures: result.failures });
  if (result.decision === "reject") await options.emit("lifecycle.rejected", { phase: result.phase, reason: result.reason });
}

function permissionDecisionDetail(resolution: { allowed: boolean; reason: string; message?: string }): string {
  const labels: Record<string, string> = {
    "auto-read-only": "自动审核按只读元数据放行",
    "auto-approved": "自动审核按工具元数据放行",
    "review-read-only": "规划自动审核按只读元数据放行",
    "review-project-approved": "规划自动审核按本轮项目范围放行",
    "full-access": "完全访问按本轮权限放行",
    "project-full-access": "项目范围授权按本轮权限放行",
    "computer-full-access": "电脑范围授权按本轮权限放行",
    "review-risk-rejected": "规划自动审核拒绝越界或高风险动作",
    "host-fail-closed": "权限宿主不可交互，已关闭执行",
    "plan-read-only": "计划模式拒绝副作用工具",
  };
  const label = labels[resolution.reason] ?? (resolution.allowed ? "权限策略已放行" : "权限策略已拒绝");
  return `权限决策：${label}（${resolution.reason}）。${resolution.message ?? ""}`.trim();
}

function toolResult(call: ProviderToolCallItem, content: string, isError: boolean): ProviderToolResultItem {
  return { type: "tool-result", callId: call.callId, name: call.name, content, isError };
}

function appendAdjacentText(items: ProviderContentItem[], text: string): void {
  const last = items.at(-1);
  if (last?.type === "text") last.text += text;
  else items.push({ type: "text", text });
}

function appendAdjacentReasoning(
  items: ProviderContentItem[],
  text: string,
  itemId: string | undefined,
  providerId: string,
): void {
  const last = items.at(-1);
  if (last?.type === "reasoning" && (!itemId || last.itemId === itemId)) last.text += text;
  else items.push({ type: "reasoning", text, itemId, providerId });
}

function replaceReasoning(items: ProviderContentItem[], item: ProviderReasoningItem): void {
  const index = [...items].reverse().findIndex((candidate) => candidate.type === "reasoning");
  if (index < 0) items.push(clone(item));
  else items[items.length - 1 - index] = clone(item);
}

function activity(input: {
  id?: string;
  kind: ActivityRecord["kind"];
  title: string;
  detail: string;
  status: ActivityRecord["status"];
  readOnly?: boolean;
  callId?: string;
  parentCallId?: string;
  toolName?: string;
  now: () => number;
}): ActivityRecord {
  return {
    id: input.id ?? newId(input.kind),
    kind: input.kind,
    title: input.title,
    detail: input.detail,
    status: input.status,
    readOnly: input.readOnly,
    callId: input.callId,
    parentCallId: input.parentCallId,
    toolName: input.toolName,
    createdAt: input.now(),
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
