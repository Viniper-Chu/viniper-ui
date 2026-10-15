import { AgentIntent, SessionSnapshot } from "../../core/contracts";
import { newId } from "../../core/ids";
import { SchedulerPersistence } from "../../core/ports";
import {
  ScheduleDefinition,
  ScheduleDraft,
  ScheduleHistoryRecord,
  SchedulePattern,
  SchedulePreview,
  SchedulerSnapshot,
} from "../../core/scheduler-contracts";

export interface SchedulerRuntimePort {
  getSession(sessionId: string): SessionSnapshot | undefined;
  createSession(workingDirectory?: string): Promise<SessionSnapshot>;
  send(intent: AgentIntent): Promise<{ accepted: boolean; queued: boolean; reason?: string }>;
  hasActiveScheduleRun?(scheduleId: string): boolean;
}

export interface SchedulerClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type SchedulerListener = (snapshot: SchedulerSnapshot) => void;

const SYSTEM_CLOCK: SchedulerClock = {
  now: Date.now,
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export class SchedulerService {
  private readonly definitions = new Map<string, ScheduleDefinition>();
  private history: ScheduleHistoryRecord[] = [];
  private readonly listeners = new Set<SchedulerListener>();
  private timer?: unknown;

  constructor(
    private readonly persistence: SchedulerPersistence,
    private readonly runtime: SchedulerRuntimePort,
    private readonly defaultWorkingDirectory: string,
    private readonly clock: SchedulerClock = SYSTEM_CLOCK,
    private readonly externalDispatch = false,
  ) {}

  async initialize(): Promise<void> {
    const saved = await this.persistence.loadSchedules();
    this.history = saved.history;
    for (const definition of saved.definitions) {
      const normalized = clone(definition);
      this.pauseMissingTarget(normalized);
      if ((normalized.schedule.kind === "daily" || normalized.schedule.kind === "weekly")
        && !normalized.schedule.timeZone) {
        normalized.schedule.timeZone = systemTimeZone();
        normalized.importedTimeZone = true;
        normalized.status = "imported-timezone";
      }
      this.definitions.set(normalized.id, normalized);
    }
    const now = this.clock.now();
    for (const definition of this.definitions.values()) {
      if (!definition.enabled) continue;
      if (definition.nextRunAt === undefined) definition.nextRunAt = nextOccurrence(definition.schedule, now, definition);
      if (definition.nextRunAt !== undefined && definition.nextRunAt <= now) {
        if (this.externalDispatch) {
          definition.overlapPending = false;
          if (definition.schedule.kind === "once") { definition.enabled = false; definition.nextRunAt = undefined; definition.status = "paused"; }
          else definition.nextRunAt = nextOccurrence(definition.schedule, now, definition);
          const skipped: ScheduleHistoryRecord = { id: newId("schedule-history"), scheduleId: definition.id,
            triggeredAt: now, source: "recovery", status: "pending", detail: "应用离线期间错过的执行时刻已跳过，后续按计划运行。" };
          this.history.push(skipped);
          await this.persistence.appendScheduleHistory(skipped);
          continue;
        }
        const missedCount = missedOccurrences(definition.schedule, definition.nextRunAt, now);
        await this.trigger(definition, "recovery", missedCount);
        definition.nextRunAt = definition.overlapPending
          ? now + 1_000
          : nextOccurrence(definition.schedule, now, definition);
      }
    }
    await this.persistDefinitions();
    this.armTimer();
    this.publish();
  }

  dispose(): void {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Desktop host claims due work and starts it through its normal chat coordinator. */
  async claimDue(): Promise<ScheduleDefinition[]> {
    if (!this.externalDispatch) throw new Error("此调度器由 Runtime 自动执行");
    let changed = false;
    for (const definition of this.definitions.values()) changed = this.pauseMissingTarget(definition) || changed;
    if (changed) await this.persistDefinitions();
    const now = this.clock.now();
    const due = [...this.definitions.values()].filter(d => d.enabled && d.status !== "deleted" && d.nextRunAt !== undefined && d.nextRunAt <= now);
    for (const d of due) {
      d.lastRunAt = now;
      d.nextRunAt = nextOccurrence(d.schedule, now, d);
      if (d.schedule.kind === "once") d.enabled = false;
    }
    if (due.length) await this.persistDefinitions();
    return due.map(clone);
  }

  async recordExternal(id: string, accepted: boolean, detail: string): Promise<void> {
    const definition = this.definitions.get(id);
    if (definition) { definition.overlapPending = false; definition.status = "active"; }
    const record: ScheduleHistoryRecord = { id: newId("schedule-history"), scheduleId: id,
      triggeredAt: this.clock.now(), source: "timer", status: accepted ? "accepted" : "failed", detail };
    this.history.push(record);
    await this.persistence.appendScheduleHistory(record);
    await this.persistDefinitions();
  }

  async deferExternal(id: string): Promise<void> {
    const definition = this.definitions.get(id);
    if (!definition || !definition.enabled) return;
    if (!definition.overlapPending) {
      const record: ScheduleHistoryRecord = { id: newId("schedule-history"), scheduleId: id,
        triggeredAt: this.clock.now(), source: "timer", status: "pending", detail: "会话忙碌，本次任务等待空闲后执行一次。" };
      this.history.push(record);
      await this.persistence.appendScheduleHistory(record);
    }
    definition.overlapPending = true;
    definition.status = "overlap-pending";
    definition.nextRunAt = this.clock.now() + 10_000;
    await this.persistDefinitions();
  }

  async update(id: string, changes: Pick<ScheduleDraft, "name" | "prompt" | "schedule">): Promise<boolean> {
    const definition = this.definitions.get(id);
    if (!definition || definition.status === "deleted") return false;
    if (!changes.name.trim() || !changes.prompt.trim()) throw new Error("名称和任务内容不能为空。");
    validatePattern(changes.schedule);
    Object.assign(definition, clone(changes), { updatedAt: this.clock.now(), overlapPending: false });
    definition.nextRunAt = definition.enabled ? nextOccurrence(changes.schedule, this.clock.now()) : undefined;
    await this.persistDefinitions();
    this.armTimer();
    return true;
  }

  subscribe(listener: SchedulerListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  async create(draft: ScheduleDraft): Promise<ScheduleDefinition> {
    if (!draft.name.trim() || !draft.prompt.trim()) throw new Error("自动任务名称和内容不能为空。 ");
    if (draft.target.kind === "existing-session" && !this.runtime.getSession(draft.target.sessionId)) throw new Error("目标会话已不存在，请选择现有会话。");
    validatePattern(draft.schedule);
    const now = this.clock.now();
    const definition: ScheduleDefinition = {
      id: newId("schedule"),
      name: draft.name.trim(),
      prompt: draft.prompt.trim(),
      schedule: clone(draft.schedule),
      target: clone(draft.target),
      modelSelection: clone(draft.modelSelection ?? { mode: "inherit" as const }),
      enabled: true,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    definition.nextRunAt = nextOccurrence(definition.schedule, now, definition);
    this.definitions.set(definition.id, definition);
    await this.persistDefinitions();
    this.armTimer();
    this.publish();
    return clone(definition);
  }

  async setEnabled(id: string, enabled: boolean): Promise<boolean> {
    const definition = this.definitions.get(id);
    if (!definition || definition.status === "deleted") return false;
    if (enabled && definition.target.kind === "existing-session" && !this.runtime.getSession(definition.target.sessionId)) return false;
    definition.enabled = enabled;
    definition.status = enabled ? "active" : "paused";
    definition.updatedAt = this.clock.now();
    definition.nextRunAt = enabled ? nextOccurrence(definition.schedule, this.clock.now(), definition) : undefined;
    await this.persistDefinitions();
    this.armTimer();
    this.publish();
    return true;
  }

  async runNow(id: string): Promise<boolean> {
    const definition = this.definitions.get(id);
    if (!definition || definition.status === "deleted") return false;
    await this.trigger(definition, "manual", 1);
    definition.nextRunAt = definition.overlapPending
      ? this.clock.now() + 1_000
      : definition.enabled
        ? nextOccurrence(definition.schedule, this.clock.now(), definition)
        : undefined;
    await this.persistDefinitions();
    this.armTimer();
    this.publish();
    return true;
  }

  async delete(id: string): Promise<boolean> {
    const definition = this.definitions.get(id);
    if (!definition) return false;
    definition.enabled = false;
    definition.status = "deleted";
    definition.deletedAt = this.clock.now();
    definition.nextRunAt = undefined;
    await this.persistDefinitions();
    this.armTimer();
    this.publish();
    return true;
  }

  async restore(id: string): Promise<boolean> {
    const definition = this.definitions.get(id);
    if (!definition || definition.status !== "deleted") return false;
    if (definition.target.kind === "existing-session" && !this.runtime.getSession(definition.target.sessionId)) return false;
    definition.enabled = true;
    definition.status = "active";
    delete definition.deletedAt;
    definition.updatedAt = this.clock.now();
    definition.nextRunAt = nextOccurrence(definition.schedule, this.clock.now(), definition);
    await this.persistDefinitions();
    this.armTimer();
    this.publish();
    return true;
  }

  snapshot(): SchedulerSnapshot {
    return clone({
      runtimeScope: "application-runtime" as const,
      definitions: [...this.definitions.values()].sort((left, right) => left.createdAt - right.createdAt),
      history: this.history.slice(-50).reverse(),
      previews: Object.fromEntries([...this.definitions.values()].map((definition) => [
        definition.id,
        definition.enabled ? previewScheduleOccurrences(definition.schedule, this.clock.now(), 3, definition).map((at) => ({
          at,
          source: definition.overlapPending ? "catch-up" : "normal",
        })) : [],
      ])),
    });
  }

  private armTimer(): void {
    if (this.externalDispatch) return;
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
    const next = [...this.definitions.values()]
      .filter((definition) => definition.enabled && definition.status !== "deleted" && definition.nextRunAt !== undefined)
      .sort((left, right) => left.nextRunAt! - right.nextRunAt!)[0];
    if (!next?.nextRunAt) return;
    const delay = Math.max(0, Math.min(next.nextRunAt - this.clock.now(), 2_147_000_000));
    this.timer = this.clock.setTimeout(() => void this.fireDue(), delay);
  }

  private async fireDue(): Promise<void> {
    this.timer = undefined;
    const now = this.clock.now();
    const due = [...this.definitions.values()].filter(
      (definition) => definition.enabled && definition.status !== "deleted" && definition.nextRunAt !== undefined && definition.nextRunAt <= now,
    );
    for (const definition of due) {
      await this.trigger(definition, "timer", missedOccurrences(definition.schedule, definition.nextRunAt!, now));
      definition.nextRunAt = definition.overlapPending
        ? now + 1_000
        : nextOccurrence(definition.schedule, now, definition);
    }
    await this.persistDefinitions();
    this.armTimer();
    this.publish();
  }

  private async trigger(definition: ScheduleDefinition, source: ScheduleHistoryRecord["source"], missedCount: number): Promise<void> {
    const triggeredAt = this.clock.now();
    const alreadyActive = this.runtime.hasActiveScheduleRun?.(definition.id) === true;
    if (alreadyActive) {
      if (!definition.overlapPending) {
        definition.overlapPending = true;
        definition.status = "overlap-pending";
        const pending: ScheduleHistoryRecord = {
          id: newId("schedule-history"),
          scheduleId: definition.id,
          triggeredAt,
          source,
          status: "pending",
          detail: "同一计划已有运行；已合并为一个待补跑，不再叠加。",
          missedCount,
        };
        this.history.push(pending);
        await this.persistence.appendScheduleHistory(pending);
      }
      return;
    }
    if (definition.overlapPending) definition.overlapPending = false;
    let session: SessionSnapshot | undefined;
    let status: ScheduleHistoryRecord["status"] = "failed";
    let detail = "目标会话不存在。";
    try {
      session = definition.target.kind === "existing-session"
        ? this.runtime.getSession(definition.target.sessionId)
        : await this.runtime.createSession(definition.target.workingDirectory ?? this.defaultWorkingDirectory);
      if (session) {
        const result = await this.runtime.send({
          sessionId: session.id,
          text: definition.prompt,
          attachments: [],
          selectedModel: session.selectedModel,
          permissionMode: session.permissionMode,
          origin: { kind: "scheduler", scheduleId: definition.id },
          ...(definition.modelSelection && definition.modelSelection.mode !== "inherit"
            ? { routing: clone(definition.modelSelection) }
            : {}),
        });
        status = result.accepted ? "accepted" : "failed";
        detail = result.accepted
          ? result.queued ? "已进入目标会话队列。" : "已进入 Agent Runtime。"
          : `未进入 Agent Runtime：${result.reason ?? "未知原因"}`;
        definition.status = result.accepted
          ? "active"
          : /权限|批准|approval/iu.test(result.reason ?? "") ? "waiting-permission" : "active";
      } else {
        definition.status = "project-invalid";
      }
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
      definition.status = /项目|project|目录/iu.test(detail) ? "project-invalid" : "active";
    }
    definition.lastRunAt = triggeredAt;
    definition.updatedAt = triggeredAt;
    if (definition.schedule.kind === "once") {
      definition.enabled = false;
      definition.status = "paused";
    }
    const history: ScheduleHistoryRecord = {
      id: newId("schedule-history"),
      scheduleId: definition.id,
      sessionId: session?.id,
      triggeredAt,
      source,
      status,
      detail,
      missedCount,
    };
    this.history.push(history);
    await this.persistence.appendScheduleHistory(history);
  }

  private pauseMissingTarget(definition: ScheduleDefinition): boolean {
    if (definition.status === "deleted" || definition.target.kind !== "existing-session" || this.runtime.getSession(definition.target.sessionId)) return false;
    if (!definition.enabled && definition.status === "project-invalid") return false;
    definition.enabled = false;
    definition.status = "project-invalid";
    definition.nextRunAt = undefined;
    definition.overlapPending = false;
    return true;
  }

  private persistDefinitions(): Promise<void> {
    for (const definition of this.definitions.values()) this.pauseMissingTarget(definition);
    return this.persistence.saveSchedules([...this.definitions.values()].map(clone));
  }

  private publish(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

export function nextOccurrence(pattern: SchedulePattern, from: number, definition?: ScheduleDefinition): number | undefined {
  if (pattern.kind === "cron") return nextCron(pattern.expression, pattern.timeZone, from);
  if (pattern.kind === "once") return definition?.lastRunAt ? undefined : pattern.runAt;
  if (pattern.kind === "interval") return from + pattern.everyMs;
  if (pattern.timeZone) return nextZonedOccurrence(pattern, from);
  const date = new Date(from);
  const candidate = new Date(date);
  candidate.setHours(pattern.hour, pattern.minute, 0, 0);
  if (pattern.kind === "daily") {
    if (candidate.getTime() <= from) candidate.setDate(candidate.getDate() + 1);
    return candidate.getTime();
  }
  const days = (pattern.weekday - candidate.getDay() + 7) % 7;
  candidate.setDate(candidate.getDate() + days);
  if (candidate.getTime() <= from) candidate.setDate(candidate.getDate() + 7);
  return candidate.getTime();
}

export function previewScheduleOccurrences(
  pattern: SchedulePattern,
  from: number,
  count: number,
  definition?: ScheduleDefinition,
): number[] {
  const output: number[] = [];
  let cursor = from;
  let current = definition;
  for (let index = 0; index < count; index += 1) {
    const next = nextOccurrence(pattern, cursor, current);
    if (next === undefined) break;
    output.push(next);
    cursor = next;
    current = current ? { ...current, lastRunAt: next } : undefined;
  }
  return output;
}

function validatePattern(pattern: SchedulePattern): void {
  if (pattern.kind === "cron") { parseCron(pattern.expression); assertTimeZone(pattern.timeZone); }
  if (pattern.kind === "once" && !Number.isFinite(pattern.runAt)) throw new Error("单次执行时间无效。 ");
  if (pattern.kind === "interval" && pattern.everyMs < 1_000) throw new Error("间隔至少为 1 秒。 ");
  if ((pattern.kind === "daily" || pattern.kind === "weekly")
    && (pattern.hour < 0 || pattern.hour > 23 || pattern.minute < 0 || pattern.minute > 59)) {
    throw new Error("每日或每周时间无效。 ");
  }
  if (pattern.kind === "weekly" && (pattern.weekday < 0 || pattern.weekday > 6)) {
    throw new Error("每周日期无效。 ");
  }
  if ((pattern.kind === "daily" || pattern.kind === "weekly") && pattern.timeZone) assertTimeZone(pattern.timeZone);
}

function nextZonedOccurrence(pattern: Extract<SchedulePattern, { kind: "daily" | "weekly" }>, from: number): number | undefined {
  const zone = pattern.timeZone!;
  const current = localParts(from, zone);
  const candidate = { year: current.year, month: current.month, day: current.day, hour: pattern.hour, minute: pattern.minute };
  if (pattern.kind === "daily") {
    let at = resolveLocal(candidate, zone);
    if (at <= from) {
      const tomorrow = addDays(candidate, 1);
      at = resolveLocal(tomorrow, zone);
    }
    return at;
  }
  const weekday = weekdayFor(candidate);
  let days = (pattern.weekday - weekday + 7) % 7;
  let at = resolveLocal(addDays(candidate, days), zone);
  if (at <= from) at = resolveLocal(addDays(candidate, days + 7), zone);
  return at;
}

type LocalDateTime = { year: number; month: number; day: number; hour: number; minute: number };

function localParts(timestamp: number, timeZone: string): LocalDateTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(timestamp);
  const value = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return { year: value.year, month: value.month, day: value.day, hour: value.hour, minute: value.minute };
}

function resolveLocal(value: LocalDateTime, timeZone: string): number {
  const wall = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, 0, 0);
  const offsets = new Set<number>();
  for (const delta of [0, -60, 60, -360, 360, -1440, 1440]) offsets.add(timeZoneOffset(wall + delta * 60_000, timeZone));
  const candidates = [...offsets]
    .map((offset) => wall - offset)
    .filter((candidate) => sameLocal(candidate, value, timeZone))
    .sort((left, right) => left - right);
  if (candidates.length > 0) return candidates[0];
  const before = timeZoneOffset(wall - 6 * 60 * 60_000, timeZone);
  const after = timeZoneOffset(wall + 6 * 60 * 60_000, timeZone);
  const shifted = wall + Math.max(0, after - before);
  const shiftedCandidates = [...offsets]
    .map((offset) => shifted - offset)
    .filter((candidate) => sameLocal(candidate, addMinutes(value, Math.max(0, after - before) / 60_000), timeZone))
    .sort((left, right) => left - right);
  if (shiftedCandidates.length > 0) return shiftedCandidates[0];
  for (let minute = 1; minute <= 180; minute += 1) {
    const probe = addMinutes(value, minute);
    const probeWall = Date.UTC(probe.year, probe.month - 1, probe.day, probe.hour, probe.minute);
    for (const offset of offsets) {
      const candidate = probeWall - offset;
      if (sameLocal(candidate, probe, timeZone)) return candidate;
    }
  }
  throw new Error(`无法解析时区 ${timeZone} 中的本地时间。`);
}

function timeZoneOffset(timestamp: number, timeZone: string): number {
  const value = localParts(timestamp, timeZone);
  const wall = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute);
  return wall - timestamp;
}

function sameLocal(timestamp: number, value: LocalDateTime, timeZone: string): boolean {
  const actual = localParts(timestamp, timeZone);
  return actual.year === value.year && actual.month === value.month && actual.day === value.day
    && actual.hour === value.hour && actual.minute === value.minute;
}

function addDays(value: LocalDateTime, days: number): LocalDateTime {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day + days, value.hour, value.minute));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: date.getUTCHours(), minute: date.getUTCMinutes() };
}

function addMinutes(value: LocalDateTime, minutes: number): LocalDateTime {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute + minutes));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: date.getUTCHours(), minute: date.getUTCMinutes() };
}

function weekdayFor(value: LocalDateTime): number {
  return new Date(Date.UTC(value.year, value.month - 1, value.day)).getUTCDay();
}

function assertTimeZone(timeZone: string): void {
  try { new Intl.DateTimeFormat("en-US", { timeZone }).format(); }
  catch { throw new Error(`IANA 时区无效：${timeZone}`); }
}

function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function missedOccurrences(pattern: SchedulePattern, next: number, now: number): number {
  if (pattern.kind === "interval") return Math.max(1, Math.floor((now - next) / pattern.everyMs) + 1);
  return 1;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseCron(expression: string): number[][] {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error("Cron 需要 5 个字段：分 时 日 月 星期。");
  return fields.map((field, index) => {
    const [min, max] = [[0,59],[0,23],[1,31],[1,12],[0,7]][index];
    const values = new Set<number>();
    for (const part of field.split(',')) {
      const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
      if (!match) throw new Error("Cron 字段无效。");
      const step = Number(match[2] || 1);
      const range = match[1] === '*' ? [min,max] : match[1].split('-').map(Number);
      const start = range[0], end = range[1] ?? (match[2] ? max : start);
      if (step < 1 || start < min || end > max || start > end) throw new Error("Cron 数值超出范围。");
      for (let n = start; n <= end; n += step) values.add(index === 4 && n === 7 ? 0 : n);
    }
    return [...values].sort((a,b)=>a-b);
  });
}

function nextCron(expression: string, zone: string, from: number): number | undefined {
  const [minutes,hours,days,months,weekdays] = parseCron(expression);
  const raw = expression.trim().split(/\s+/);
  const today = localParts(from, zone);
  for (let offset=0; offset<366*5; offset++) {
    const date = addDays({...today,hour:0,minute:0}, offset);
    if (!months.includes(date.month)) continue;
    const day = days.includes(date.day), week = weekdays.includes(weekdayFor(date));
    if (!(raw[2] === '*' ? week : raw[4] === '*' ? day : day || week)) continue;
    for (const hour of hours) for (const minute of minutes) {
      if (!offset && (hour < today.hour || hour === today.hour && minute <= today.minute)) continue;
      const local = {...date,hour,minute};
      const at = resolveLocal(local, zone);
      if (at > from && sameLocal(at, local, zone)) return at;
    }
  }
  throw new Error("未来五年内没有符合该 Cron 的执行时间。");
}
