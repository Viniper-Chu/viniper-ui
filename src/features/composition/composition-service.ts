import {
  CapabilityDefinition,
  CompositionCenterSnapshot,
  CompositionCompileInput,
  CompositionHost,
  CompositionPlan,
  CompositionPresetDescriptor,
  CompositionPreset,
  CompositionSessionScope,
  CustomCompositionPreset,
} from "../../core/composition-contracts";
import { CompositionCompiler, createDefaultCompositionDefinitions } from "./composition-compiler";

export interface CompositionPersistence {
  load(): Promise<{ preset?: CompositionPreset; sessionScope?: CompositionSessionScope; customSelected?: string; custom?: CustomCompositionPreset[] } | undefined>;
  save(value: { preset: CompositionPreset; sessionScope: CompositionSessionScope; customSelected?: string; custom: CustomCompositionPreset[] }): Promise<void>;
}

/** Runtime-owned facade: desktop and CLI read the same compiled plan. */
export class CompositionService {
  private preset: CompositionPreset = "standard";
  private sessionScope: CompositionSessionScope = "all";
  private customSelected?: string;
  private readonly compiler: CompositionCompiler;

  constructor(compiler = new CompositionCompiler(createDefaultCompositionDefinitions()), private readonly persistence?: CompositionPersistence) {
    this.compiler = compiler;
  }

  async initialize(): Promise<void> {
    const saved = await this.persistence?.load();
    if (!saved) return;
    this.preset = saved.preset ?? this.preset;
    this.sessionScope = saved.sessionScope ?? this.sessionScope;
    this.customSelected = saved.customSelected;
    for (const custom of saved.custom ?? []) this.compiler.saveCustomPreset(custom.name, custom);
  }

  register(definition: CapabilityDefinition): () => void {
    return this.compiler.register(definition);
  }

  setPreset(preset: CompositionPreset, sessionScope: CompositionSessionScope = this.sessionScope): void {
    this.preset = preset;
    this.sessionScope = sessionScope;
    void this.persist();
  }

  selectCustom(name: string): void {
    if (!this.compiler.restoreCustomPreset(name)) throw new Error("自定义能力方案不存在。");
    this.customSelected = name;
    this.preset = "custom";
    void this.persist();
  }

  snapshot(host: CompositionHost = "any"): CompositionPlan {
    return this.compiler.compile({ host, preset: this.preset, sessionScope: this.sessionScope, customPreset: this.customSelected });
  }

  compileForRun(input: Omit<CompositionCompileInput, "preset" | "sessionScope"> & Partial<Pick<CompositionCompileInput, "preset" | "sessionScope">>): CompositionPlan {
    return this.compiler.compile({
      host: input.host,
      preset: input.preset ?? this.preset,
      sessionScope: input.sessionScope ?? this.sessionScope,
      enabledIds: input.enabledIds,
      customPreset: input.customPreset ?? this.customSelected,
    });
  }

  centerSnapshot(host: CompositionHost = "any"): CompositionCenterSnapshot {
    const presets: CompositionPresetDescriptor[] = (["standard", "deepseek-efficient", "minimal", "custom"] as CompositionPreset[]).map((id) => {
      const plan = id === "custom" && !this.customSelected ? this.compiler.compile({ host, preset: "custom", sessionScope: this.sessionScope }) : this.compiler.compile({ host, preset: id, sessionScope: this.sessionScope, customPreset: this.customSelected });
      const definitions = new Map(this.compiler.listDefinitions().map((definition) => [definition.id, definition]));
      const selected = [...plan.enabled, ...plan.blocked];
      const capabilityNames = selected.map((decision) => decision.presentation?.label ?? decision.id);
      const dependencies = [...new Set(selected.flatMap((decision) => definitions.get(decision.id)?.dependencies ?? []))];
      const conflicts = [...new Set(selected.flatMap((decision) => definitions.get(decision.id)?.conflicts ?? []))];
      const blockers = plan.blocked.map((decision) => `${decision.id}：${decision.reason}`);
      return {
        id,
        label: id === "standard" ? "标准 Agent" : id === "deepseek-efficient" ? "高效 Code Mode" : id === "minimal" ? "轻量执行" : "自定义方案",
        purpose: id === "standard" ? "日常 Agent 执行与只读工具" : id === "deepseek-efficient" ? "适合代码规划与受管 SDK 子调用" : id === "minimal" ? "减少上下文与能力，优先轻量任务" : "由你保存的能力组合",
        modelRecommendations: id === "deepseek-efficient" ? ["DeepSeek V4 高效模型", "具备工具能力的模型"] : ["Demo · 默认模型"],
        capabilities: capabilityNames,
        dependencies,
        conflicts,
        blockers,
        trust: "builtin",
        permissionNeeds: id === "deepseek-efficient" ? ["Code Mode 子调用仍逐次经过权限批准"] : ["只读工具可按当前权限自动执行"],
        frozen: id === this.preset ? "current-run" : "next-run",
      };
    });
    return { current: this.snapshot(host), presets, custom: this.compiler.listCustomPresets(), ...(this.customSelected ? { customSelected: this.customSelected } : {}) };
  }

  async copyPreset(source: CompositionPreset, name: string): Promise<CompositionCenterSnapshot> {
    const plan = this.compiler.compile({ host: "any", preset: source, sessionScope: this.sessionScope, customPreset: this.customSelected });
    this.compiler.saveCustomPreset(name, { enabledIds: plan.enabled.map((item) => item.id), order: plan.order });
    this.customSelected = name;
    this.preset = "custom";
    await this.persist();
    return this.centerSnapshot();
  }

  async setCustomCapability(name: string, id: string, enabled: boolean): Promise<CompositionCenterSnapshot> {
    const current = this.compiler.restoreCustomPreset(name);
    if (!current) throw new Error("自定义能力方案不存在。");
    const enabledIds = enabled ? [...new Set([...current.enabledIds, id])] : current.enabledIds.filter((item) => item !== id);
    this.compiler.saveCustomPreset(name, { enabledIds, order: current.order });
    this.customSelected = name;
    this.preset = "custom";
    await this.persist();
    return this.centerSnapshot();
  }

  async reorderCustom(name: string, order: string[]): Promise<CompositionCenterSnapshot> {
    const current = this.compiler.restoreCustomPreset(name);
    if (!current) throw new Error("自定义能力方案不存在。");
    const allowed = new Set(current.enabledIds);
    const normalized = [...new Set(order.filter((id) => allowed.has(id)))].concat(current.enabledIds.filter((id) => !order.includes(id)));
    this.compiler.saveCustomPreset(name, { enabledIds: current.enabledIds, order: normalized });
    this.customSelected = name;
    this.preset = "custom";
    await this.persist();
    return this.centerSnapshot();
  }

  restoreDefault(): CompositionCenterSnapshot {
    this.preset = "standard";
    this.customSelected = undefined;
    void this.persist();
    return this.centerSnapshot();
  }

  private persist(): Promise<void> {
    return this.persistence?.save({ preset: this.preset, sessionScope: this.sessionScope, ...(this.customSelected ? { customSelected: this.customSelected } : {}), custom: this.compiler.listCustomPresets() }) ?? Promise.resolve();
  }
}
