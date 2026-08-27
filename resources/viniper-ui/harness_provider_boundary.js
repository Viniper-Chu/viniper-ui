"use strict";

// Provider-boundary normalization is deliberately kept outside the renderer
// and outside the CLI environment builder. The UI keeps its display model and
// SDK-style base URL; only the raw Harness transport sees these values.
const DEEPSEEK_MODEL_ALIASES = new Map([
  ["deepseek-v4-pro[1m]", "deepseek-v4-pro"],
]);

function normalizeRawAnthropicEndpoint(value) {
  const normalized = String(value || "").trim().replace(/\/+$/u, "");
  if (!normalized) return "";
  if (/\/v1\/messages$/u.test(normalized)) return normalized;
  if (/\/anthropic$/u.test(normalized)) return `${normalized}/v1/messages`;
  if (/\/v1$/u.test(normalized)) return `${normalized}/messages`;
  return normalized;
}

function normalizeProviderModel(value) {
  const normalized = String(value || "").trim();
  return DEEPSEEK_MODEL_ALIASES.get(normalized) || normalized;
}

module.exports = {
  normalizeRawAnthropicEndpoint,
  normalizeProviderModel,
};
