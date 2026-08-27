import { LoadedSkill, SkillMetadata } from "../../core/extension-contracts";
import { SkillSource } from "../../core/ports";
import { ExtensionManager } from "../extensions/extension-manager";

/**
 * Joins built-in file Skills with the effective projection of managed
 * extensions.  ExtensionManager remains the lifecycle source of truth while
 * SkillCatalog remains the session/run enablement source of truth.
 */
export class ExtensionSkillSource implements SkillSource {
  constructor(
    private readonly builtIn: SkillSource,
    private readonly extensions: ExtensionManager,
  ) {}

  async listMetadata(): Promise<SkillMetadata[]> {
    const merged = new Map<string, SkillMetadata>();
    for (const skill of await this.builtIn.listMetadata()) merged.set(skill.id, skill);
    for (const skill of this.extensions.listSkillMetadata()) merged.set(skill.id, skill);
    return [...merged.values()];
  }

  async load(id: string): Promise<LoadedSkill> {
    if (this.extensions.listSkillMetadata().some((skill) => skill.id === id)) {
      return this.extensions.loadSkill(id);
    }
    return this.builtIn.load(id);
  }
}
