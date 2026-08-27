export const PROVIDER_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

export interface ToolNameProjection {
  toProvider(canonicalName: string): string;
  toCanonical(providerName: string): string;
  hasProvider(providerName: string): boolean;
  hasCanonical(canonicalName: string): boolean;
}

/** Convert a Harness tool name to the reversible provider-safe alphabet. */
export function encodeProviderToolName(canonicalName: string, prefix = "vh_"): string {
  const value = String(canonicalName ?? "");
  if (!value) throw new Error("工具名不能为空，无法投射。");
  if (PROVIDER_TOOL_NAME_PATTERN.test(value)) return value;
  const encoded = `${prefix}${Buffer.from(value, "utf8").toString("base64url")}`;
  if (!PROVIDER_TOOL_NAME_PATTERN.test(encoded)) {
    throw new Error(`工具名 '${value}' 无法在 Provider 64 字符限制内安全投射。`);
  }
  const decoded = Buffer.from(encoded.slice(prefix.length), "base64url").toString("utf8");
  if (decoded !== value) throw new Error(`工具名 '${value}' 的 Provider 投射不可逆。`);
  return encoded;
}

export function assertProviderToolName(providerName: string): string {
  const value = String(providerName ?? "");
  if (!PROVIDER_TOOL_NAME_PATTERN.test(value)) {
    throw new Error(`Provider 工具名 '${value}' 不符合 Anthropic/OpenAI 工具名约束。`);
  }
  return value;
}

export function createToolNameProjection(
  tools: Array<{ name: string } | string>,
  options: { prefix?: string; strictReverse?: boolean; projectUnsafe?: boolean } = {},
): ToolNameProjection {
  const prefix = options.prefix ?? "vh_";
  const strictReverse = options.strictReverse !== false;
  const projectUnsafe = options.projectUnsafe !== false;
  const providerByCanonical = new Map<string, string>();
  const canonicalByProvider = new Map<string, string>();
  for (const input of tools ?? []) {
    const canonical = typeof input === "string" ? input : input?.name;
    if (typeof canonical !== "string" || !canonical.trim()) throw new Error("工具名不能为空，无法建立投射表。");
    const normalized = canonical.trim();
    const providerName = projectUnsafe ? encodeProviderToolName(normalized, prefix) : assertProviderToolName(normalized);
    const existingCanonical = canonicalByProvider.get(providerName);
    if (existingCanonical && existingCanonical !== normalized) {
      throw new Error(`工具名投射冲突：${existingCanonical} / ${normalized} -> ${providerName}。`);
    }
    const existingProvider = providerByCanonical.get(normalized);
    if (existingProvider && existingProvider !== providerName) {
      throw new Error(`工具名投射不稳定：${normalized} -> ${existingProvider} / ${providerName}。`);
    }
    providerByCanonical.set(normalized, providerName);
    canonicalByProvider.set(providerName, normalized);
  }
  return {
    toProvider(canonicalName) {
      const normalized = String(canonicalName ?? "");
      const mapped = providerByCanonical.get(normalized);
      if (mapped) return mapped;
      if (!strictReverse && projectUnsafe) return encodeProviderToolName(normalized, prefix);
      throw new Error(`未注册 Harness 工具名 '${normalized}'，拒绝发送 Provider 请求。`);
    },
    toCanonical(providerName) {
      const normalized = assertProviderToolName(providerName);
      const mapped = canonicalByProvider.get(normalized);
      if (mapped) return mapped;
      if (!strictReverse) return normalized;
      throw new Error(`Provider 返回未注册工具名 '${normalized}'，拒绝执行工具。`);
    },
    hasProvider(providerName) { return canonicalByProvider.has(String(providerName ?? "")); },
    hasCanonical(canonicalName) { return providerByCanonical.has(String(canonicalName ?? "")); },
  };
}

export function identityToolNameProjection(options: { strictReverse?: boolean } = {}): ToolNameProjection {
  void options;
  return {
    toProvider: (name) => String(name ?? ""),
    toCanonical: (name) => String(name ?? ""),
    hasProvider: () => true,
    hasCanonical: () => true,
  };
}
