import {
  CapabilityDefinition,
  CompositionCompileInput,
  CompositionDecision,
  CompositionHost,
  CompositionPlan,
  CompositionPreset,
  CompositionSessionScope,
  CustomCompositionPreset,
} from "../../core/composition-contracts";

const STANDARD_IDS = [
  "core.agent",
  "providers.registry",
  "programming.tools",
  "skills.progressive",
  "coordination.service",
  "token.ledger",
  "workflow.engine",
  "semantic.navigation",
];

const MINIMAL_IDS = ["core.agent", "providers.registry", "programming.tools", "token.ledger"];

export function createDefaultCompositionDefinitions(): CapabilityDefinition[] {
  return [
    capability("core.agent", "interceptor", "Agent 核心运行时"),
    capability("providers.registry", "model-provider", "Provider 注册表", ["core.agent"]),
    capability("programming.tools", "tool", "受管编程工具", ["core.agent"]),
    capability("skills.progressive", "skill-source", "渐进式 Skill", ["core.agent"]),
    capability("coordination.service", "workflow", "会话协作", ["core.agent"]),
    capability("token.ledger", "interceptor", "Token 对账", ["core.agent"]),
    capability("workflow.engine", "workflow", "工作流编排", ["core.agent", "coordination.service"]),
    capability("semantic.navigation", "semantic-navigation", "只读语义导航", ["programming.tools"]),
    capability("code-mode.worker", "workflow", "Code Mode 受管 Worker", ["programming.tools"], ["deepseek-efficient"]),
  ];
}

export class CompositionCompiler {
  private readonly definitions = new Map<string, CapabilityDefinition>();
  private readonly customPresets = new Map<string, CustomCompositionPreset>();
  private revision = 1;

  constructor(definitions: CapabilityDefinition[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition: CapabilityDefinition): () => void {
    if (this.definitions.has(definition.id)) throw new Error(`能力 '${definition.id}' 已注册。`);
    this.definitions.set(definition.id, clone(definition));
    this.revision += 1;
    return () => {
      if (this.definitions.delete(definition.id)) this.revision += 1;
    };
  }

  saveCustomPreset(name: string, preset: Omit<CustomCompositionPreset, "name">): void {
    if (!name.trim()) throw new Error("自定义能力组合名称不能为空。");
    this.customPresets.set(name, { name, enabledIds: [...preset.enabledIds], order: preset.order ? [...preset.order] : undefined });
    this.revision += 1;
  }

  restoreCustomPreset(name: string): CustomCompositionPreset | undefined {
    const preset = this.customPresets.get(name);
    return preset ? clone(preset) : undefined;
  }

  listDefinitions(): CapabilityDefinition[] {
    return [...this.definitions.values()].map(clone);
  }

  listCustomPresets(): CustomCompositionPreset[] {
    return [...this.customPresets.values()].map(clone);
  }

  compile(input: CompositionCompileInput): CompositionPlan {
    const sessionScope = input.sessionScope ?? "all";
    const selected = this.selectedIds(input);
    const decisions = new Map<string, CompositionDecision>();
    const definitions = [...this.definitions.values()].sort((left, right) => left.id.localeCompare(right.id, "en"));

    for (const id of selected) {
      const definition = this.definitions.get(id);
      if (!definition) {
        decisions.set(id, { id, enabled: false, reason: "能力未注册，未激活。" });
        continue;
      }
      if (!supportsHost(definition.hostScope, input.host)) {
        decisions.set(id, decision(definition, false, `当前宿主 ${input.host} 不支持该能力。`));
        continue;
      }
      if (definition.sessionScope && definition.sessionScope !== "all" && definition.sessionScope !== sessionScope) {
        decisions.set(id, decision(definition, false, `当前会话范围 ${sessionScope} 不满足能力要求。`));
        continue;
      }
      decisions.set(id, decision(definition, true, "已纳入当前能力组合。"));
    }

    for (const definition of definitions) {
      if (!decisions.get(definition.id)?.enabled) continue;
      for (const dependency of definition.dependencies ?? []) {
        const dependencyDecision = decisions.get(dependency);
        if (!dependencyDecision || !dependencyDecision.enabled) {
          const current = decisions.get(definition.id)!;
          current.enabled = false;
          current.reason = `依赖 ${dependency} 未激活，能力未激活。`;
          break;
        }
      }
    }

    for (const definition of definitions) {
      const current = decisions.get(definition.id);
      if (!current?.enabled) continue;
      const conflict = (definition.conflicts ?? []).find((id) => decisions.get(id)?.enabled);
      if (conflict) {
        current.enabled = false;
        current.reason = `与 ${conflict} 冲突，能力未激活。`;
      }
    }

    const order = topologicalOrder(definitions.filter((definition) => decisions.get(definition.id)?.enabled));
    for (const id of order.cycle) {
      const current = decisions.get(id);
      if (current) {
        current.enabled = false;
        current.reason = "能力声明存在循环依赖，未激活。";
      }
    }

    const enabledIds = order.ids.filter((id) => decisions.get(id)?.enabled);
    const enabled = enabledIds.map((id, index) => ({ ...decisions.get(id)!, order: index }));
    const blocked = [...decisions.values()]
      .filter((item) => !item.enabled)
      .sort((left, right) => left.id.localeCompare(right.id, "en"));
    return {
      revision: this.revision,
      preset: input.preset,
      ...(input.preset === "custom" && input.customPreset ? { customName: input.customPreset } : {}),
      host: input.host,
      sessionScope,
      enabled,
      blocked,
      order: enabledIds,
      presentation: {
        label: `能力组合 · ${input.preset}`,
        summary: `${enabled.length} 项已启用，${blocked.length} 项被阻断或未选中。`,
        enabledCount: enabled.length,
        blockedCount: blocked.length,
      },
    };
  }

  private selectedIds(input: CompositionCompileInput): string[] {
    if (input.preset === "custom") {
      const saved = input.customPreset ? this.customPresets.get(input.customPreset) : undefined;
      const selected = unique(input.enabledIds ?? saved?.enabledIds ?? []);
      if (!saved?.order) return selected;
      return unique([...saved.order.filter((id) => selected.includes(id)), ...selected]);
    }
    const presetIds = input.preset === "minimal"
      ? MINIMAL_IDS
      : input.preset === "deepseek-efficient"
        ? [...STANDARD_IDS, "code-mode.worker"]
        : STANDARD_IDS;
    const explicit = input.enabledIds ? new Set(input.enabledIds) : undefined;
    return unique(presetIds.filter((id) => !explicit || explicit.has(id)).concat(input.enabledIds?.filter((id) => !presetIds.includes(id)) ?? []));
  }
}

function capability(
  id: string,
  kind: CapabilityDefinition["kind"],
  label: string,
  dependencies: string[] = [],
  presets?: CompositionPreset[],
): CapabilityDefinition {
  return {
    id,
    version: "1.0.0",
    kind,
    source: "viniper-harness",
    dependencies,
    trust: "builtin",
    presets,
    presentation: { label, category: kind },
  };
}

function decision(definition: CapabilityDefinition, enabled: boolean, reason: string): CompositionDecision {
  return {
    id: definition.id,
    version: definition.version,
    kind: definition.kind,
    source: definition.source,
    enabled,
    reason,
    presentation: definition.presentation,
  };
}

function supportsHost(hostScope: CompositionHost[] | undefined, host: CompositionHost): boolean {
  return !hostScope || hostScope.includes("any") || hostScope.includes(host);
}

function topologicalOrder(definitions: CapabilityDefinition[]): { ids: string[]; cycle: string[] } {
  const ids = new Set(definitions.map((definition) => definition.id));
  const edges = new Map<string, Set<string>>([...ids].map((id) => [id, new Set()]));
  const indegree = new Map<string, number>([...ids].map((id) => [id, 0]));
  for (const definition of definitions) {
    for (const dependency of definition.dependencies ?? []) if (ids.has(dependency)) addEdge(dependency, definition.id, edges, indegree);
    for (const target of definition.before ?? []) if (ids.has(target)) addEdge(definition.id, target, edges, indegree);
    for (const target of definition.after ?? []) if (ids.has(target)) addEdge(target, definition.id, edges, indegree);
  }
  const ready = [...ids].filter((id) => indegree.get(id) === 0).sort((left, right) => left.localeCompare(right, "en"));
  const output: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    output.push(id);
    for (const next of edges.get(id) ?? []) {
      indegree.set(next, indegree.get(next)! - 1);
      if (indegree.get(next) === 0) ready.push(next);
    }
    ready.sort((left, right) => left.localeCompare(right, "en"));
  }
  return { ids: output, cycle: [...ids].filter((id) => !output.includes(id)).sort((left, right) => left.localeCompare(right, "en")) };
}

function addEdge(from: string, to: string, edges: Map<string, Set<string>>, indegree: Map<string, number>): void {
  const outgoing = edges.get(from)!;
  if (outgoing.has(to)) return;
  outgoing.add(to);
  indegree.set(to, indegree.get(to)! + 1);
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
