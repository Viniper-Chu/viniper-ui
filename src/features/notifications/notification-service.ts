import { newId } from "../../core/ids";
import { NotificationDelivery, NotificationInput, NotificationKind, NotificationRecord, NotificationSnapshot, SystemNotificationAdapter, SystemNotificationRequest } from "../../core/notification-contracts";
export type { NotificationDelivery, NotificationInput, NotificationKind, NotificationRecord, NotificationSnapshot, SystemNotificationAdapter, SystemNotificationRequest } from "../../core/notification-contracts";

const SYSTEM_KINDS = new Set<NotificationKind>(["completion", "failure", "approval-waiting", "delegation-result", "automated-result"]);

export class NotificationService {
  private readonly items: NotificationRecord[] = [];
  private readonly now: () => number;
  private notificationsEnabled = true;
  private soundEnabled = false;

  constructor(private readonly options: { deliver: (request: SystemNotificationRequest) => Promise<void>; now?: () => number }) {
    this.now = options.now ?? Date.now;
  }

  setPreferences(input: { notificationsEnabled?: boolean; soundEnabled?: boolean }): void {
    if (typeof input.notificationsEnabled === "boolean") this.notificationsEnabled = input.notificationsEnabled;
    if (typeof input.soundEnabled === "boolean") this.soundEnabled = input.soundEnabled;
  }

  async notify(input: NotificationInput): Promise<NotificationRecord> {
    const record: NotificationRecord = {
      ...input,
      id: newId("notification"),
      createdAt: this.now(),
      delivery: "app-only",
      read: false,
    };
    this.items.unshift(record);
    if (SYSTEM_KINDS.has(input.kind) && this.notificationsEnabled) {
      try {
        await this.options.deliver({
          title: input.title,
          sound: this.soundEnabled,
          lockScreenBody: false,
        });
        record.delivery = "sent";
      } catch (error) {
        record.delivery = "failed";
        record.deliveryError = error instanceof Error ? error.message : String(error);
      }
    }
    return structuredClone(record);
  }

  markRead(id: string): boolean {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) return false;
    item.read = true;
    return true;
  }

  snapshot(): NotificationSnapshot {
    return {
      items: this.items.map((item) => structuredClone(item)),
      soundEnabled: this.soundEnabled,
      lockScreenBody: false,
    };
  }
}
