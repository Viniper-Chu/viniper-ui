import { ProviderEvent, ProviderRequest } from "../../core/provider-contracts";
import { AgentEngineId } from "../../core/agent-engine-contracts";
import { engineScopeOf, requireEngineOwnership } from "../../core/engine-identity";
import { ModelProvider } from "../providers/model-provider";
import {
  AgentToolLoopOptions,
  AgentToolLoopResult,
  runAgentToolLoop,
} from "../runs/tool-loop/agent-tool-loop";

export interface ClaudeCodeEngineRunOptions {
  request: ProviderRequest;
  signal: AbortSignal;
  onProviderEvent(event: ProviderEvent): Promise<void>;
  onProviderAttempt?(ordinal: number): Promise<void> | void;
}

/**
 * Viniper owns the self-built provider/tool/permission loop.  Keeping this
 * implementation behind an engine-specific Adapter prevents the outer Runtime
 * owner from becoming the implementation of either Agent.
 */
export class ViniperEngineAdapter {
  readonly engineId = "viniper" as const;

  run(options: AgentToolLoopOptions): Promise<AgentToolLoopResult> {
    assertRequestOwner(this.engineId, options.request);
    return runAgentToolLoop(options);
  }
}

/**
 * Claude Code remains a native CLI Adapter.  CLI tool and permission events are
 * projected into the common event vocabulary, but never re-enter Viniper's
 * ToolRegistry or PermissionPolicy.
 */
export class ClaudeCodeEngineAdapter {
  readonly engineId = "claude-code" as const;

  constructor(private readonly provider: ModelProvider) {
    if (provider.descriptor.id !== "claude-code") {
      throw new Error(`CLAUDE_CODE_ADAPTER_PROVIDER_MISMATCH: ${provider.descriptor.id}`);
    }
  }

  get descriptor(): ModelProvider["descriptor"] {
    return this.provider.descriptor;
  }

  async run(options: ClaudeCodeEngineRunOptions): Promise<void> {
    assertRequestOwner(this.engineId, options.request);
    await options.onProviderAttempt?.(1);
    const request: ProviderRequest = { ...options.request, tools: [] };
    for await (const event of this.provider.stream(request, options.signal)) {
      await options.onProviderEvent(event);
    }
  }
}

function assertRequestOwner(engineId: AgentEngineId, request: ProviderRequest): void {
  if (request.engineId && request.engineId !== engineId) {
    throw new Error(`ENGINE_OWNER_MISMATCH: request belongs to ${request.engineId}, expected ${engineId}`);
  }
  for (const value of [request.sessionId, request.runId]) {
    if (value && engineScopeOf(value)) requireEngineOwnership(engineId, value);
  }
}
