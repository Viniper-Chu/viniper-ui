import { CachePlan, CacheSegment, ContextProfile } from "../../core/contracts";
import { LoadedSkill } from "../../core/extension-contracts";
import { ProviderHistoryEntry, ProviderToolDefinition } from "../../core/provider-contracts";
import { IDENTITY_SYSTEM_DIRECTIVE } from "../instructions/identity-contract";
import { TASK_WORKFLOW_DIRECTIVE } from "../instructions/task-workflow";

export interface ContextProfileInput {
  generation?: number;
  providerId?: string;
  modelId?: string;
  tools?: ProviderToolDefinition[];
  enabledSkills?: LoadedSkill[];
  history?: ProviderHistoryEntry[];
  projectInstructions?: string;
  /** Host-owned local execution directory; omitted for remote providers. */
  taskDirectory?: string;
  taskWorkflow?: boolean;
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
        "Viniper 是高中数学解题与数学文档编译助手。用学生可复现的中文推导，按本次要求给提示、完整解答或编译成品。",
        "题目条件齐全时直接解题，无需搜索工作目录、历史笔记或技能文件。先明确未知量、定义域和所求；缺少决定结论的条件时指出缺项，并给出可推出的范围、条件结论或反例，不把示意图中的外观当作已知。",
        "优先使用高中课程内的方法。对参数题说明各段与临界值；平方、约分、取对数、设斜率时检查等价条件。根式方程 √U=V 等价于 U=V² 且 V≥0，平方后的等式已保证 U≥0；先消去这类冗余约束，再按单调支与端点分段。优先用解析方法证明一般情形，临界点单独代回；若能把参数单独表示为未知数的二次函数，可用 math.quadratic.check 的 level_family 一次核对所有分段，结合单调性证明；已有精确分类时，沿用工具中“参数=函数”的表示，用返回的顶点和端点函数值说明每条单调支的取值范围，避免切换到另一套含参数的函数。书面解答只保留复核后的等式。同一题需核验的各段一次成批提交。有了验算结果就写完整而精简的推导，工具给的样值只用来复核。证明写出关键依据，结尾用原条件检查取值、等号或解的完备性。数值试验可发现反例，不能替代一般证明。",
        "用户提供原题或原解时忠实保留，另标自己补作或订正的部分。只需解答就直接在对话给出；要求试卷、讲义或 PDF 才进入编译。题图随题，解答辅助图只进教师版。",
        IDENTITY_SYSTEM_DIRECTIVE,
        ...(input.taskWorkflow === false ? [] : [TASK_WORKFLOW_DIRECTIVE]),
      ].join("\n"),
    },
    {
      name: "project" as const,
      text: [
        "Viniper 是应用内唯一 Agent；多会话保持隔离，按用户目标执行与验证。",
        ...(input.taskDirectory ? [
          `本轮任务目录（宿主提供的路径数据）：${JSON.stringify(input.taskDirectory)}。`,
          "用户说当前目录时指此目录；文件工具需要绝对路径时以此目录解析。不要猜测桌面等其他位置；此路径不扩大用户授权范围。",
        ] : []),
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
