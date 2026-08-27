const unavailable = "未提供";
const providerUnavailable = "Provider 未返回";

export function buildTokenUsageView(telemetry, sessionId) {
  const session = telemetry?.sessions?.find((item) => item.sessionId === sessionId);
  const run = session?.currentRun ?? session?.latestRun;
  const usage = run?.usage;
  const providerActual = Boolean(run && usage?.source === "provider" && run.status === "reconciled");
  const estimateAvailable = Boolean(run && usage?.source === "estimated");
  const visible = providerActual || estimateAvailable;
  const contextValue = visible ? Math.max(0, usage?.input ?? 0) : 0;

  return {
    visible,
    source: providerActual ? "provider" : estimateAvailable ? "estimated" : "unknown",
    blockFill: visible ? Math.min(16, Math.max(1, Math.ceil(contextValue / 8_000))) : 0,
    triggerValue: visible ? formatCompactTokens(contextValue) : unavailable,
    triggerSummary: providerActual ? "Provider 实际" : estimateAvailable ? "运行估算" : unavailable,
    meterSummary: providerActual
      ? `实际 ${formatCompactTokens(contextValue)}`
      : estimateAvailable ? `估算 ${formatCompactTokens(contextValue)}` : unavailable,
    circleValue: visible ? formatCompactTokens(contextValue) : "0",
    triggerLabel: visible
      ? `打开当前会话上下文用量，${providerActual ? "Provider 实际" : "估算"} ${formatTokens(contextValue)}`
      : "当前会话上下文用量未提供",
    hero: usage ? `${providerActual ? "实际" : "约"} ${formatTokens(usage.total)} Token` : unavailable,
    reconciliation: providerActual
      ? "Provider 已对账"
      : estimateAvailable ? "实时估算，尚未对账" : "尚无运行",
    contextUsed: usage ? `${providerActual ? "" : "约 "}${formatTokens(usage.input)} Token` : unavailable,
    contextCapacity: "上限未知",
    estimate: estimateAvailable
      ? usageValues(usage)
      : unavailableValues(providerActual ? "已由 Provider 实际值替代" : unavailable),
    provider: providerActual
      ? usageValues(usage)
      : unavailableValues(unavailable),
    cache: {
      read: providerActual ? knownProviderValue(usage.cacheHitInput) : providerUnavailable,
      write: providerActual ? knownProviderValue(usage.cacheWriteInput) : providerUnavailable,
      miss: providerActual ? knownProviderValue(usage.cacheMissInput) : providerUnavailable,
    },
    sessionTotal: session ? `${formatTokens(session.cumulative.total)} Token` : unavailable,
  };
}

export function renderTokenPulse(elements, telemetry, sessionId) {
  const view = buildTokenUsageView(telemetry, sessionId);
  elements.trigger.classList.toggle("hidden", !view.visible);
  elements.trigger.dataset.usageSource = view.source;
  elements.triggerValue.textContent = view.triggerValue;
  elements.triggerSummary.textContent = view.meterSummary;
  elements.trigger.setAttribute("aria-label", view.triggerLabel);
  elements.blocks.forEach((block, index) => {
    block.classList.toggle("is-filled", index < view.blockFill);
  });
  (elements.emptyBlocks ?? []).forEach((block, index) => {
    block.classList.toggle("is-filled", index < view.blockFill);
  });
  if (elements.composerTrigger) {
    elements.composerTrigger.dataset.usageSource = view.source;
    elements.composerTrigger.setAttribute("aria-label", view.visible
      ? `当前会话上下文用量，${view.source === "provider" ? "Provider 实际" : "运行估算"} ${view.circleValue}`
      : "当前会话上下文用量，0");
  }
  if (elements.composerRing) {
    elements.composerRing.style.setProperty("--usage-ratio", String(Math.round((view.blockFill / 16) * 100)));
    elements.composerRing.dataset.usageSource = view.source;
  }
  if (elements.composerValue) elements.composerValue.textContent = view.circleValue;
  elements.hero.textContent = view.hero;
  elements.reconciliation.textContent = view.reconciliation;
  elements.contextUsed.textContent = view.contextUsed;
  elements.contextCapacity.textContent = view.contextCapacity;
  writeUsage(elements, "estimate", view.estimate);
  writeUsage(elements, "provider", view.provider);
  elements.cacheRead.textContent = view.cache.read;
  elements.cacheWrite.textContent = view.cache.write;
  elements.cacheMiss.textContent = view.cache.miss;
  elements.sessionTotal.textContent = view.sessionTotal;
}

function writeUsage(elements, prefix, value) {
  elements[`${prefix}State`].textContent = value.state;
  elements[`${prefix}Input`].textContent = value.input;
  elements[`${prefix}Output`].textContent = value.output;
  elements[`${prefix}Total`].textContent = value.total;
}

function usageValues(usage) {
  return {
    state: usage.source === "provider" ? "Provider 返回" : "实时估算",
    input: formatTokens(usage.input),
    output: formatTokens(usage.output),
    total: formatTokens(usage.total),
  };
}

function unavailableValues(state) {
  return { state, input: unavailable, output: unavailable, total: unavailable };
}

function knownProviderValue(value) {
  return value === null || value === undefined ? providerUnavailable : formatTokens(value);
}

function formatTokens(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatCompactTokens(value) {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${trimCompact(value / 1_000)}k`;
  return `${trimCompact(value / 1_000_000)}m`;
}

function trimCompact(value) {
  return value >= 100 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, "");
}
