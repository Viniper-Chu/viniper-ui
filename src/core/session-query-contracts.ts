import { SessionSnapshot, SessionStatus } from "./contracts";

export interface SessionQuery {
  search?: string;
  project?: string | "open" | "none";
  providerId?: string;
  status?: SessionStatus;
  pinnedOnly?: boolean;
  offset?: number;
  limit?: number;
}

export interface SessionQueryResult {
  items: SessionSnapshot[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}
