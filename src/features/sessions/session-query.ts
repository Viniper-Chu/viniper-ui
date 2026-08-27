import { SessionSnapshot } from "../../core/contracts";
import { SessionQuery, SessionQueryResult } from "../../core/session-query-contracts";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Bounded session projection used by both the desktop rail and CLI. The
 * canonical catalog remains complete; this function only creates a viewport.
 */
export function querySessions(sessions: readonly SessionSnapshot[], query: SessionQuery = {}): SessionQueryResult {
  const search = query.search?.trim().toLocaleLowerCase("zh-CN") ?? "";
  const project = typeof query.project === "string" && query.project !== "open" && query.project !== "none"
    ? query.project.trim().toLocaleLowerCase("zh-CN") : "";
  const filtered = sessions
    .filter((session) => !search || [session.title, session.workingDirectory, session.selectedModel, session.selectedProviderId]
      .some((value) => value.toLocaleLowerCase("zh-CN").includes(search)))
    .filter((session) => !project || session.workingDirectory.toLocaleLowerCase("zh-CN").includes(project))
    .filter((session) => query.project !== "open" || session.projectAccess?.enabled === true)
    .filter((session) => query.project !== "none" || session.projectAccess?.enabled !== true)
    .filter((session) => !query.providerId || session.selectedProviderId === query.providerId)
    .filter((session) => !query.status || session.status === query.status)
    .filter((session) => !query.pinnedOnly || session.pinned)
    .sort((left, right) => (left.pinned === right.pinned ? right.updatedAt - left.updatedAt : left.pinned ? -1 : 1));
  const offset = Math.max(0, Math.trunc(query.offset ?? 0));
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(query.limit ?? DEFAULT_LIMIT)));
  const items = filtered.slice(offset, offset + limit).map(clone);
  return { items, total: filtered.length, offset, limit, hasMore: offset + items.length < filtered.length };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
