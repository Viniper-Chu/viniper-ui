import { CachePlan, CacheSegment, ContextProfile } from "../../core/contracts";
import { LoadedSkill } from "../../core/extension-contracts";
import { ProviderHistoryEntry, ProviderToolDefinition } from "../../core/provider-contracts";
import { IDENTITY_SYSTEM_DIRECTIVE } from "../instructions/identity-contract";

export interface ContextProfileInput {
  generation?: number;
  providerId?: string;
  modelId?: string;
  tools?: ProviderToolDefinition[];
  enabledSkills?: LoadedSkill[];
  history?: ProviderHistoryEntry[];
  projectInstructions?: string;
}

export function buildContextProfile(input: ContextProfileInput = {}): ContextProfile {
  const enabledSkills = stableContextSkills(input.enabledSkills ?? []);
  const tools = stableContextTools(input.tools ?? []);
  const history = input.history ?? [];
  const stableSegments: CacheSegment[] = [
    {
      name: "tool-schemas" as const,
      text: stableJson(tools),
    },
    {
      name: "system" as const,
      text: [
        "Viniper workstation：清楚回复，并以 canonical 会话状态作为唯一真源。",
        IDENTITY_SYSTEM_DIRECTIVE,
      ].join("\n"),
    },
    {
      name: "project" as const,
      text: [
        "Viniper workstation Preview：双 Agent、多会话隔离、显式协作与应用运行时调度。",
        input.projectInstructions === undefined
          ? "项目 AGENTS.md：未设置。"
          : `项目 AGENTS.md 指令：\n${input.projectInstructions}`,
      ].join("\n\n"),
    },
    {
      name: "skills" as const,
      text: enabledSkills.map((skill) => `Skill ${skill.name}:\n${skill.body}`).join("\n\n"),
    },
    {
      name: "stable-history" as const,
      text: stableJson(history),
    },
  ];
  return {
    generation: input.generation ?? 1,
    providerId: input.providerId ?? "demo",
    modelId: input.modelId ?? "demo-default",
    toolSchemaVersion: tools.map((tool) => tool.name).join("|") || "no-tools",
    enabledSkills: enabledSkills.map((skill) => ({ ...skill })),
    tools: clone(tools),
    history: clone(history),
    stableSegments,
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Provider-visible tool schemas are part of the cached request prefix.  Keep
 * their order independent from plugin discovery/registration timing so that
 * an unchanged capability set remains byte-identical between runs.
 */
export function stableContextTools(tools: ProviderToolDefinition[]): ProviderToolDefinition[] {
  return clone(tools).sort((left, right) => left.name.localeCompare(right.name, "en"));
}

/** Skills use the same stable-prefix rule as tool schemas. */
export function stableContextSkills(skills: LoadedSkill[]): LoadedSkill[] {
  return clone(skills).sort((left, right) => {
    const idOrder = left.id.localeCompare(right.id, "en");
    return idOrder || left.name.localeCompare(right.name, "zh-CN");
  });
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function buildCachePlan(text: string, profile = buildContextProfile()): CachePlan {
  const stableSegments = profile.stableSegments;
  const reusablePrefix = stableSegments.map((segment) => `${segment.name}: ${segment.text}`).join("\n");
  return {
    stableSegments,
    reusablePrefix,
    currentTurn: text,
    reusedContextChars: reusablePrefix.length,
    addedContextChars: text.length,
    profileGeneration: profile.generation,
  };
}
