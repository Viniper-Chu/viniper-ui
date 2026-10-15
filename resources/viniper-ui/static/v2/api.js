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
  attachments: [],
  mode: "execute",
  permission: "ask",
  model: "",
  reasoning: "medium",
  workdir: "",
  skills: [],
  plugins: [],
  goals: [],
  schedules: [],
  selectedSkills: [],
};
