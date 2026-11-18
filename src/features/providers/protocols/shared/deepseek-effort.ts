/** Distinct effort settings accepted by DeepSeek's two desktop transports. */
export function deepSeekEffort(endpoint: string, model: string, reasoning: string | undefined, protocol: "openai-chat" | "anthropic-messages"): Record<string, unknown> {
  if (!endpoint.startsWith("https://api.deepseek.com/") || !["deepseek-flash", "deepseek-v4-pro"].includes(model)) return {};
  if (reasoning === "off" || reasoning === "none") return {thinking: {type: "disabled"}};
  const effort = reasoning === "minimal" ? "low" : reasoning === "medium" || reasoning === "xhigh" ? "high" : reasoning;
  if (!effort || !["low", "high", "max"].includes(effort)) return {};
  return protocol === "openai-chat"
    ? {thinking: {type: "enabled"}, reasoning_effort: effort}
    : {thinking: {type: "enabled"}, output_config: {effort}};
}
