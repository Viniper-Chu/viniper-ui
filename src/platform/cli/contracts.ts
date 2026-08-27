import type { CompositionPreset } from "../../core/composition-contracts";

export const CLI_EVENT_SCHEMA_VERSION = 1 as const;

export const CLI_EXIT_CODE = {
  completed: 0,
  runFailed: 1,
  configurationMissing: 2,
  usageError: 64,
  cancelled: 130,
} as const;

export type CliExitCode = (typeof CLI_EXIT_CODE)[keyof typeof CLI_EXIT_CODE];
export type CliOutputMode = "tty" | "plain" | "jsonl";

export type CliInvocation =
  | { kind: "interactive"; output: CliOutputMode }
  | { kind: "help"; output: CliOutputMode }
  | { kind: "run"; output: CliOutputMode; prompt: string };

export type CliCommand =
  | { kind: "empty" }
  | { kind: "help" }
  | { kind: "new"; name?: string }
  | { kind: "sessions"; query?: string; filters?: { search?: string; project?: string; status?: string; providerId?: string; offset?: number; limit?: number } }
  | { kind: "session-delete"; sessionId: string }
  | { kind: "routing" }
  | { kind: "capabilities" }
  | { kind: "preset"; preset?: CompositionPreset; name?: string }
  | { kind: "preset-copy"; source: CompositionPreset; name: string }
  | { kind: "preset-toggle"; name: string; capabilityId: string; enabled: boolean }
  | { kind: "preset-order"; name: string; order: string[] }
  | { kind: "preset-restore" }
  | { kind: "steer"; runId: string; message: string }
  | { kind: "workflow"; workflowId?: string; input?: string }
  | { kind: "workflow-cancel"; workflowRunId: string }
  | { kind: "workflow-recover"; workflowRunId: string; decision: "reconfirm" }
  | { kind: "memory" }
  | { kind: "memory-create"; scope: "session-auto" | "project" | "personal"; text: string }
  | { kind: "memory-update"; id: string; text: string }
  | { kind: "memory-enable"; id: string; enabled: boolean }
  | { kind: "memory-delete"; id: string }
  | { kind: "index"; action?: "build" | "search" | "semantic"; value?: string | boolean }
  | { kind: "runs" }
  | { kind: "run-select"; runId: string }
  | { kind: "run-cancel"; runId: string }
  | { kind: "use"; session: string }
  | { kind: "rename"; name: string }
  | { kind: "run"; prompt: string }
  | { kind: "cancel" }
  | { kind: "tokens" }
  | { kind: "inbox" }
  | { kind: "send"; target: string; message: string }
  | { kind: "delegate"; target: string; task: string }
  | { kind: "wait"; source?: string }
  | { kind: "schedules" }
  | { kind: "schedule-create"; draft: string }
  | { kind: "schedule-enable"; id: string; enabled: boolean }
  | { kind: "schedule-run"; id: string }
  | { kind: "schedule-delete"; id: string }
  | { kind: "schedule-restore"; id: string }
  | { kind: "notifications" }
  | { kind: "artifacts" }
  | { kind: "artifact-read"; input: { artifactId: string; runId: string; offset?: number; maxBytes?: number } }
  | { kind: "skills" }
  | { kind: "extensions" }
  | { kind: "extension-stage"; location: string; source?: "local" | "custom" | "official" | "community" | "marketplace-fixture" }
  | { kind: "extension-install"; stagingId: string }
  | { kind: "extension-trust"; id: string; version: string }
  | { kind: "extension-enable"; id: string; enabled: boolean }
  | { kind: "extension-update"; id: string; stagingId: string }
  | { kind: "extension-update-confirm"; id: string }
  | { kind: "extension-rollback"; id: string }
  | { kind: "extension-rollback-confirm"; id: string }
  | { kind: "mcp-config"; id: string; endpoint: string }
  | { kind: "mcp-connect"; id: string }
  | { kind: "providers" }
  | { kind: "provider"; profile: string; model: string }
  | { kind: "provider-endpoint"; profile: string; endpoint: string }
  | { kind: "provider-manual-model"; profile: string; model: string }
  | { kind: "provider-capabilities"; profile: string; capabilities: string }
  | { kind: "local-models" }
  | { kind: "local-model-register"; registration: string }
  | { kind: "local-model-confirm"; id: string; version: string }
  | { kind: "local-model-update"; id: string; version: string }
  | { kind: "local-model-update-confirm"; id: string }
  | { kind: "permission"; selection: "ask" | "auto" | "full" }
  | { kind: "restore"; receiptId: string }
  | { kind: "terminal-output"; executionId: string; stream: "stdout" | "stderr"; offset?: number; maxBytes?: number }
  | { kind: "workspace" }
  | { kind: "review" }
  | { kind: "settings" }
  | { kind: "diagnostics"; runId?: string }
  | { kind: "diagnostics-consent"; enabled: boolean }
  | { kind: "updates"; channel: "preview" | "stable" }
  | { kind: "update-download" }
  | { kind: "update-install" }
  | { kind: "setting"; key: string; value: string }
  | { kind: "archive-export"; path: string }
  | { kind: "archive-import"; path: string }
  | { kind: "credential-export"; path: string }
  | { kind: "credential-import"; path: string }
  | { kind: "quit" };

export type CliParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "CLI_USAGE"; message: string; output?: CliOutputMode };

export type CliEventType =
  | "ready"
  | "help"
  | "error"
  | "sessions"
  | "routing"
  | "capabilities"
  | "capabilities.changed"
  | "steering.updated"
  | "workflows"
  | "workflow.changed"
  | "memory"
  | "memory.changed"
  | "index"
  | "index.changed"
  | "runs"
  | "run.selected"
  | "run.cancel.requested"
  | "session.created"
  | "session.selected"
  | "session.renamed"
  | "session.deleted"
  | "message.user"
  | "message.delta"
  | "message.completed"
  | "message.cancelled"
  | "thinking.started"
  | "thinking.delta"
  | "thinking.completed"
  | "tool.requested"
  | "tool.completed"
  | "tool.cancelled"
  | "tool.failed"
  | "interaction.requested"
  | "run.started"
  | "run.queued"
  | "run.completed"
  | "run.cancelled"
  | "run.failed"
  | "run.listener-failed"
  | "queue.updated"
  | "cancel.requested"
  | "tokens"
  | "inbox"
  | "coordination.sent"
  | "coordination.delegated"
  | "coordination.waiting"
  | "coordination.matched"
  | "schedules"
  | "schedule.changed"
  | "notifications"
  | "artifacts"
  | "artifact.output"
  | "skills"
  | "extensions"
  | "extension.changed"
  | "mcp.changed"
  | "providers"
  | "provider.changed"
  | "local-models"
  | "provider.selected"
  | "permission.selected"
  | "terminal.output"
  | "workspace"
  | "review"
  | "settings"
  | "setting.changed"
  | "diagnostics"
  | "diagnostics.consent"
  | "updates"
  | "update.changed"
  | "archive.exported"
  | "archive.preview"
  | "credential.boundary"
  | "quit";

export interface CliEvent {
  schemaVersion: typeof CLI_EVENT_SCHEMA_VERSION;
  type: CliEventType;
  timestamp: number;
  sessionId?: string;
  data: Readonly<Record<string, unknown>>;
}

export interface CliPresenter {
  present(event: CliEvent): void;
}

export interface CliCommandOutcome {
  exitRequested: boolean;
  exitCode?: CliExitCode;
}
