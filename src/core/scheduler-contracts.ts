export type SchedulePattern =
  | { kind: "cron"; expression: string; timeZone: string }
  | { kind: "once"; runAt: number }
  | { kind: "interval"; everyMs: number }
  | { kind: "daily"; hour: number; minute: number; timeZone?: string }
  | { kind: "weekly"; weekday: number; hour: number; minute: number; timeZone?: string };

export type ScheduleStatus =
  | "active"
  | "paused"
  | "deleted"
  | "waiting-permission"
  | "project-invalid"
  | "imported-timezone"
  | "overlap-pending";

export interface SchedulePreview {
  at: number;
  source: "normal" | "catch-up";
}

export type ScheduleTarget =
  | { kind: "existing-session"; sessionId: string }
  | { kind: "new-session"; workingDirectory?: string };

export type ScheduleModelSelection =
  | { mode: "inherit" }
  | { mode: "fixed"; providerId: string; modelId: string }
  | { mode: "smart"; strategy: "quality" | "balanced" | "lightweight" };

export interface ScheduleDefinition {
  id: string;
  name: string;
  prompt: string;
  schedule: SchedulePattern;
  target: ScheduleTarget;
  modelSelection?: ScheduleModelSelection;
  enabled: boolean;
  nextRunAt?: number;
  lastRunAt?: number;
  status?: ScheduleStatus;
  overlapPending?: boolean;
  importedTimeZone?: boolean;
  deletedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduleDraft {
  name: string;
  prompt: string;
  schedule: SchedulePattern;
  target: ScheduleTarget;
  modelSelection?: ScheduleModelSelection;
  timeZone?: string;
}

export interface ScheduleHistoryRecord {
  id: string;
  scheduleId: string;
  sessionId?: string;
  triggeredAt: number;
  source: "timer" | "manual" | "recovery";
  status: "accepted" | "failed" | "pending";
  detail: string;
  missedCount?: number;
}

export interface SchedulerSnapshot {
  runtimeScope: "application-runtime";
  definitions: ScheduleDefinition[];
  history: ScheduleHistoryRecord[];
  previews?: Record<string, SchedulePreview[]>;
}
