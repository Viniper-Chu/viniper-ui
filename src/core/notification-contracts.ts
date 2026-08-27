export type NotificationKind = "ordinary-status" | "completion" | "failure" | "approval-waiting" | "delegation-result" | "automated-result";
export type NotificationDelivery = "app-only" | "sent" | "failed";

export interface NotificationInput {
  kind: NotificationKind;
  title: string;
  body?: string;
  sessionId?: string;
  runId?: string;
}

export interface NotificationRecord extends NotificationInput {
  id: string;
  createdAt: number;
  delivery: NotificationDelivery;
  read: boolean;
  deliveryError?: string;
}

export interface NotificationSnapshot {
  items: NotificationRecord[];
  soundEnabled: boolean;
  lockScreenBody: boolean;
}

export interface SystemNotificationRequest {
  title: string;
  body?: string;
  sound: boolean;
  lockScreenBody: boolean;
}

export interface SystemNotificationAdapter {
  deliver(request: SystemNotificationRequest): Promise<void>;
}
