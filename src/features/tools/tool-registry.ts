import { ToolAuthorizationScope, ToolPresentation, ToolRequest } from "../../core/contracts";
import { JsonSchema, ProviderActivityEvent, ProviderToolDefinition } from "../../core/provider-contracts";
import { ToolResourceClaim } from "./resource-lock";
import { FrozenProviderSnapshot } from "../../core/programming-contracts";
import type { FrozenRunContext } from "../../core/composition-contracts";
import type { CodeSubcallInput, CodeSubcallResult } from "../../core/code-mode-contracts";
import type { ExtensionRunSnapshot } from "../extensions/extension-manager";

export interface ToolResult {
  toolId: string;
  text: string;
  data?: unknown;
  displayText?: string;
  presentation?: ToolPresentation;
  isError?: boolean;
  cancelled?: boolean;
  providerUsage?: import("../../core/telemetry-contracts").TokenUsage;
}

export interface ToolExecutionContext {
  sessionId: string;
  runId: string;
  projectRoot?: string;
  taskDirectory?: string;
  workspaceId?: string;
  commitRequested?: boolean;
  providerSnapshot?: FrozenProviderSnapshot;
  extensionSnapshot?: ExtensionRunSnapshot;
  frozenRunContext?: FrozenRunContext;
  codeSubcallInvoker?: (input: CodeSubcallInput) => Promise<CodeSubcallResult>;
  onProviderActivity?: (event: ProviderActivityEvent) => Promise<void>;
  signal: AbortSignal;
}

export interface ToolExecutor {
  readonly name: string;
  readonly description: string;
  readonly readOnly: boolean;
  readonly authorizationScope?: ToolAuthorizationScope;
  readonly inputSchema: JsonSchema;
  resourceClaims?(request: ToolRequest, context: ToolExecutionContext): ToolResourceClaim[];
  execute(request: ToolRequest, context: ToolExecutionContext): Promise<ToolResult>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolExecutor>();
  private readonly managedOwners = new Map<string, string>();

  register(tool: ToolExecutor): void {
    if (this.tools.has(tool.name)) throw new Error(`工具 '${tool.name}' 已注册。`);
    this.tools.set(tool.name, tool);
  }

  registerManaged(tool: ToolExecutor, extensionId: string): void {
    this.register(tool);
    this.managedOwners.set(tool.name, extensionId);
  }

  unregister(name: string): boolean {
    this.managedOwners.delete(name);
    return this.tools.delete(name);
  }

  managedOwner(name: string): string | undefined {
    return this.managedOwners.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): ToolExecutor {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`工具 '${name}' 未注册。`);
    return tool;
  }

  descriptors(): ProviderToolDefinition[] {
    return this.buildDescriptors([...this.tools.values()]);
  }

  descriptorsForRun(extensionSnapshot?: ExtensionRunSnapshot): ProviderToolDefinition[] {
    return this.buildDescriptors([...this.tools.values()].filter((tool) => {
      const owner = this.managedOwners.get(tool.name);
      if (!owner) return true;
      const state = extensionSnapshot?.[owner];
      return state?.trusted === true && state.enabled === true && state.tools.includes(tool.name);
    }));
  }

  private buildDescriptors(tools: ToolExecutor[]): ProviderToolDefinition[] {
    return tools
      .map(({ name, description, inputSchema, readOnly }) => ({
        name,
        description,
        inputSchema: clone(inputSchema),
        readOnly,
        permission: readOnly ? "auto-read-only" as const : "approval-required" as const,
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
