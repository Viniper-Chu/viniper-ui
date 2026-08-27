export const DEMO_MODELS = [
  { id: "demo-default", label: "Demo · 默认模型" },
  { id: "demo-concise", label: "Demo · 简洁回复" },
] as const;

export function isKnownDemoModel(modelId: string): boolean {
  return DEMO_MODELS.some((model) => model.id === modelId);
}

