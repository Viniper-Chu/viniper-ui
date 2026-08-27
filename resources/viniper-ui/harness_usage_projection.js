"use strict";

const USAGE_FIELDS = [
  ["input_tokens", "input"],
  ["output_tokens", "output"],
  ["cache_read_input_tokens", "cacheHitInput"],
  ["cache_creation_input_tokens", "cacheWriteInput"],
  ["reasoning_tokens", "reasoning"],
  ["tool_use_tokens", "toolUse"],
];

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function projectLatestRunUsage(snapshot, sessionId, runId) {
  const telemetry = snapshot && typeof snapshot === "object" ? snapshot.telemetry : null;
  const sessions = Array.isArray(telemetry?.sessions) ? telemetry.sessions : [];
  const summary = sessions.find((item) => String(item?.sessionId || "") === String(sessionId || ""));
  const latest = summary?.latestRun;
  if (!latest || (runId && String(latest.runId || "") !== String(runId || ""))) return null;

  const raw = latest.usage && typeof latest.usage === "object" ? latest.usage : {};
  const usage = {};
  for (const [providerName, ledgerName] of USAGE_FIELDS) usage[providerName] = nonNegativeNumber(raw[ledgerName]);
  usage.total_tokens = nonNegativeNumber(raw.total) || Object.values(usage).reduce((sum, value) => sum + value, 0);
  const source = latest.status === "reconciled" && raw.source === "provider" ? "provider" : "estimated";
  usage.source = source;
  return {
    type: "runtime.usage",
    session_id: String(sessionId || ""),
    run_id: String(runId || ""),
    status: String(latest.status || "unreconciled"),
    source,
    usage,
  };
}

function usageProjectionSignature(event) {
  if (!event?.usage) return "";
  return JSON.stringify({
    run_id: String(event.run_id || ""),
    status: String(event.status || ""),
    source: String(event.source || ""),
    usage: event.usage,
  });
}

module.exports = { projectLatestRunUsage, usageProjectionSignature };
