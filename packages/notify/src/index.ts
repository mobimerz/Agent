export * from "./errors";
export * from "./brevo";
export * from "./provider";
export * from "./telegram";
export * from "./telegram-format";
export * from "./context";
export * from "./quota";
export * from "./send";
export * from "./alerts";
export * from "./watchdog";
export * from "./test-messages";

/**
 * Extension point for future channels (Web Push/VAPID, WhatsApp, Slack):
 * implement this and fan out from dispatchPendingAlerts.
 */
export interface NotificationChannel {
  readonly id: string;
  isConfigured(): boolean;
  send(text: string): Promise<void>;
}
