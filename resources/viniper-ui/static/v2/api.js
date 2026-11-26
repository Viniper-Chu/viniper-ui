export async function api(path, { method = "GET", body, signal } = {}) {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const result = await response
    .json()
    .catch(() => ({ detail: `请求失败 (${response.status})` }));
  if (!response.ok)
    throw new Error(
      typeof result.detail === "string"
        ? result.detail
        : result.error || `请求失败 (${response.status})`,
    );
  return result;
}
export const query = (values) =>
  new URLSearchParams(
    Object.entries(values).filter(([, v]) => v !== undefined && v !== null),
  ).toString();
export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const timeLabel = (seconds) => {
  const n = Math.max(0, Math.floor(Number(seconds) || 0));
  return n < 60 ? `${n} 秒` : `${Math.floor(n / 60)} 分 ${n % 60} 秒`;
};
export const state = {
  view: "chat",
  status: null,
  session: null,
  sessions: [],
  runs: new Map(),
  drafts: new Map(),
  composerDrafts: new Map(),
  queues: new Map(),
  attachments: [],
  mode: "execute",
  model: "",
  reasoning: null,
  workdir: "",
  skills: [],
  plugins: [],
  goals: [],
  schedules: [],
  selectedSkills: [],
};

export function composerContextUsage() {
  const run = state.runs.get(state.session?.session_id);
  if (run?.active && run.usage) return run.usage;
  const saved = state.session?.context_usage;
  if (saved && (!saved.model || saved.model === state.model || state.session?.discussion)) return saved;
  const model = state.status?.models?.find(item => item.id === state.model);
  return {used_tokens: state.session ? undefined : 0, context_limit: model?.context_window || undefined};
}
