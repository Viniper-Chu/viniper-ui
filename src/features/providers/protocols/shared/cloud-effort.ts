// Only distinct levels documented for these model IDs on their official endpoints.
// The desktop catalog is generated from these same rows in copy-assets.mjs.
type EffortGroup = { models: string[]; levels: string[]; default: string };
const basic = ["low", "medium", "high"];
const extended = [...basic, "xhigh"];
const full = [...extended, "max"];

// https://developers.openai.com/api/docs/guides/reasoning
// https://platform.claude.com/docs/en/build-with-claude/effort
export const cloudEffortGroups: Record<string, EffortGroup[]> = {
  openai: [
    {models: ["gpt-6.2-astra", "gpt-6.2-sol", "gpt-6.1-sol", "gpt-6-astra"], levels: full, default: "medium"},
    {models: ["gpt-6.1-terra", "gpt-6-sol", "gpt-6-luna"], levels: ["none", ...full], default: "medium"},
    {models: ["gpt-5.5"], levels: ["none", ...extended], default: "medium"},
    {models: ["gpt-5.4", "gpt-5.2"], levels: ["none", ...extended], default: "none"},
    {models: ["gpt-5.1"], levels: ["none", ...basic], default: "none"},
    {models: ["gpt-5", "gpt-5-mini", "gpt-5-nano"], levels: ["minimal", ...basic], default: "medium"},
    {models: ["o3", "o3-mini", "o4-mini"], levels: basic, default: "medium"},
  ],
  anthropic: [
    {models: ["claude-opus-5-5", "claude-haiku-5-5"], levels: full, default: "medium"},
    {models: ["claude-fable-5-2", "claude-fable-5-1", "claude-fable-5", "claude-mythos-5-2", "claude-mythos-5-1",
      "claude-mythos-5", "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-sonnet-5-5", "claude-sonnet-5"], levels: full, default: "high"},
    {models: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-mythos-preview"], levels: [...basic, "max"], default: "high"},
    {models: ["claude-opus-4-5"], levels: basic, default: "high"},
  ],
};

export function cloudEffort(endpoint: string, model: string, effort: string | undefined, service: "openai" | "anthropic"): Record<string, unknown> {
  const expected = service === "openai" ? "https://api.openai.com/v1/responses" : "https://api.anthropic.com/v1/messages";
  if (!effort || endpoint.replace(/\/+$/u, "") !== expected) return {};
  const id = model.replace(/-(?:\d{4}-\d{2}-\d{2}|\d{8})$/u, "");
  if (!cloudEffortGroups[service].some(row => row.models.includes(id) && row.levels.includes(effort))) return {};
  if (service === "openai") return {reasoning: {effort}};
  return {
    output_config: {effort},
    ...(["claude-opus-4-6", "claude-sonnet-4-6", "claude-opus-4-7", "claude-opus-4-8"].includes(id)
      ? {thinking: {type: "adaptive"}} : {}),
  };
}
