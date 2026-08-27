import { ExtensionPersistence, SkillSource } from "../../core/ports";
import { LoadedSkill, SkillMetadata, SkillState } from "../../core/extension-contracts";

export type SkillCatalogListener = () => void;

export class SkillCatalog {
  private readonly metadata = new Map<string, SkillMetadata>();
  private readonly enabledBySession = new Map<string, Set<string>>();
  private readonly loaded = new Map<string, LoadedSkill>();
  private readonly listeners = new Set<SkillCatalogListener>();

  constructor(
    private readonly source: SkillSource,
    private readonly persistence: ExtensionPersistence,
    private readonly isSessionRunning: (sessionId: string) => boolean,
  ) {}

  async initialize(): Promise<void> {
    const saved = await this.persistence.loadExtensionMetadata();
    this.enabledBySession.clear();
    for (const [sessionId, ids] of Object.entries(saved.enabledSkillsBySession ?? {})) {
      this.enabledBySession.set(sessionId, new Set(ids));
    }
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const discovered = await this.source.listMetadata();
    this.metadata.clear();
    for (const skill of discovered) this.metadata.set(skill.id, skill);
    for (const id of this.loaded.keys()) {
      if (!this.metadata.has(id)) this.loaded.delete(id);
    }
    let pruned = false;
    for (const ids of this.enabledBySession.values()) {
      for (const id of ids) {
        if (this.metadata.has(id)) continue;
        ids.delete(id);
        pruned = true;
      }
    }
    if (pruned) await this.persist();
    this.publish();
  }

  subscribe(listener: SkillCatalogListener): () => void {
    this.listeners.add(listener);
    listener();
    return () => this.listeners.delete(listener);
  }

  list(): SkillState[] {
    return [...this.metadata.values()]
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
      .map((skill) => ({
        ...skill,
        enabledSessionIds: [...this.enabledBySession.entries()]
          .filter(([, ids]) => ids.has(skill.id))
          .map(([sessionId]) => sessionId),
        loaded: this.loaded.has(skill.id),
      }));
  }

  async setEnabled(sessionId: string, skillId: string, enabled: boolean): Promise<boolean> {
    if (this.isSessionRunning(sessionId) || !this.metadata.has(skillId)) return false;
    const ids = this.enabledBySession.get(sessionId) ?? new Set<string>();
    if (enabled) ids.add(skillId);
    else ids.delete(skillId);
    this.enabledBySession.set(sessionId, ids);
    await this.persist();
    this.publish();
    return true;
  }

  enabledIds(sessionId: string): string[] {
    return [...(this.enabledBySession.get(sessionId) ?? new Set<string>())];
  }

  async loadForRun(sessionId: string): Promise<LoadedSkill[]> {
    const result: LoadedSkill[] = [];
    for (const id of this.enabledIds(sessionId)) {
      let skill = this.loaded.get(id);
      if (!skill) {
        skill = await this.source.load(id);
        this.loaded.set(id, skill);
        this.publish();
      }
      result.push({ ...skill });
    }
    return result;
  }

  private async persist(): Promise<void> {
    const current = await this.persistence.loadExtensionMetadata();
    await this.persistence.saveExtensionMetadata({
      ...current,
      enabledSkillsBySession: Object.fromEntries(
        [...this.enabledBySession.entries()].map(([sessionId, ids]) => [sessionId, [...ids]]),
      ),
    });
  }

  private publish(): void {
    for (const listener of this.listeners) listener();
  }
}
