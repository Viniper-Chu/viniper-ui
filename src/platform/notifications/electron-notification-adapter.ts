import { Notification } from "electron";
import { SystemNotificationAdapter, SystemNotificationRequest } from "../../core/notification-contracts";

/** Native adapter: the body is intentionally omitted so lock-screen previews cannot expose run text. */
export class ElectronNotificationAdapter implements SystemNotificationAdapter {
  async deliver(request: SystemNotificationRequest): Promise<void> {
    if (!Notification.isSupported()) throw new Error("当前 Windows 环境不支持系统通知。");
    new Notification({ title: request.title }).show();
  }
}
