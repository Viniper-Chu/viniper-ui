import { MenuItemConstructorOptions } from "electron";
import { AppSnapshot, SessionSnapshot, SessionStatus } from "../../core/contracts";

export interface TraySessionSummary {
  id: string;
  title: string;
  status: SessionStatus;
  unread: boolean;
  pinned: boolean;
  updatedAt: number;
  projectName?: string;
  typeSummary?: string;
}

export interface TrayMenuCallbacks {
  onSelect: (sessionId: string) => void;
  onNewAgent: () => void;
  onToggleWindow: () => void;
  onQuit: () => void;
}

export interface TrayMenuInput extends TrayMenuCallbacks {
  sessions: TraySessionSummary[];
  windowVisible: boolean;
}

const GROUPS: Array<{ label: string; matches: (session: TraySessionSummary) => boolean }> = [
  { label: "正在运行", matches: (session) => session.status === "running" || session.status === "queued" || session.status === "waiting" },
  { label: "未读", matches: (session) => session.unread },
  { label: "已固定", matches: (session) => session.pinned },
  { label: "最近", matches: () => true },
];

/**
 * Builds only native Electron menu template data. The source of truth remains
 * the canonical AppSnapshot supplied by the desktop host.
 */
export function buildTrayMenuTemplate(input: TrayMenuInput): MenuItemConstructorOptions[] {
  const sessions = [...input.sessions].sort(compareRecent);
  const template: MenuItemConstructorOptions[] = [];

  GROUPS.forEach((group, groupIndex) => {
    if (groupIndex > 0) template.push({ type: "separator" });
    template.push({ label: group.label, enabled: false });
    const matching = sessions.filter(group.matches);
    const visible = matching.slice(0, 3);
    const overflow = matching.slice(3);
    if (visible.length === 0) {
      template.push({ label: "暂无", enabled: false });
    } else {
      template.push(...visible.map((session) => sessionMenuItem(session, input.onSelect)));
      if (overflow.length > 0) {
        template.push({
          label: "更多",
          submenu: overflow.map((session) => sessionMenuItem(session, input.onSelect)),
        });
      }
    }
  });

  template.push({ type: "separator" });
  template.push({ label: "新建 Agent", click: () => input.onNewAgent() });
  template.push({
    label: input.windowVisible ? "隐藏 Viniper" : "打开 Viniper",
    click: () => input.onToggleWindow(),
  });
  template.push({ label: "完全退出 Viniper", click: () => input.onQuit() });
  return template;
}

export function traySessionsFromSnapshot(snapshot: AppSnapshot): TraySessionSummary[] {
  return snapshot.sessions.map((session) => fromSessionSnapshot(session));
}

function fromSessionSnapshot(session: SessionSnapshot): TraySessionSummary {
  return {
    id: session.id,
    title: safeText(session.title, "未命名 Agent"),
    status: session.status,
    unread: session.unread,
    pinned: session.pinned,
    updatedAt: session.updatedAt,
    projectName: session.projectAccess?.enabled ? safeProjectName(session.workingDirectory) : "未打开项目",
    typeSummary: session.engineId === "claude-code" ? "Claude code" : "Viniper",
  };
}

function sessionMenuItem(session: TraySessionSummary, onSelect: (sessionId: string) => void): MenuItemConstructorOptions {
  return {
    label: `${safeText(session.title, "未命名 Agent")} — ${safeSummary(session)}`,
    click: () => onSelect(session.id),
  };
}

function safeSummary(session: TraySessionSummary): string {
  const parts = [session.projectName ? safeProjectName(session.projectName) : "", session.typeSummary]
    .map((value) => safeText(value ?? "", ""))
    .filter(Boolean);
  return parts.join(" · ") || "Agent";
}

function safeProjectName(value: string): string {
  const normalized = value.replace(/[\\/]+$/u, "");
  const leaf = normalized.split(/[\\/]/u).pop() ?? "";
  return safeText(leaf, "已打开项目");
}

function safeText(value: string, fallback: string): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  return cleaned.slice(0, 80) || fallback;
}

function compareRecent(left: TraySessionSummary, right: TraySessionSummary): number {
  return right.updatedAt - left.updatedAt || left.title.localeCompare(right.title, "zh-CN");
}
