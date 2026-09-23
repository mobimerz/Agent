import { DEFAULT_TIMEZONE, type AlertData } from "@siteguard/core";
import { getSettings, type SettingsDoc } from "@siteguard/db";
import { BrevoClient } from "./brevo";
import { realSleep, type Sleep } from "./errors";
import type { EmailProvider } from "./provider";
import { TelegramClient } from "./telegram";

/** Static configuration, usually built from process.env. */
export interface NotifyConfig {
  appUrl: string;
  timeZone: string;
  dryRun: boolean;
  brevoApiKey?: string;
  fromEmail?: string;
  fromName: string;
  envAlertEmails: string[];
  telegramBotToken?: string;
  envTelegramChatIds: string[];
}

export function notifyConfigFromEnv(env: {
  APP_URL: string;
  TIMEZONE?: string;
  DRY_RUN: boolean;
  BREVO_API_KEY?: string;
  ALERT_FROM_EMAIL?: string;
  ALERT_FROM_NAME: string;
  ALERT_TO_EMAILS: string[];
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID: string[];
}): NotifyConfig {
  return {
    appUrl: env.APP_URL.replace(/\/$/, ""),
    timeZone: env.TIMEZONE ?? DEFAULT_TIMEZONE,
    dryRun: env.DRY_RUN,
    brevoApiKey: env.BREVO_API_KEY,
    fromEmail: env.ALERT_FROM_EMAIL,
    fromName: env.ALERT_FROM_NAME,
    envAlertEmails: env.ALERT_TO_EMAILS,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    envTelegramChatIds: env.TELEGRAM_CHAT_ID,
  };
}

export interface ChannelStatus {
  mode: "live" | "preview";
  /** Why the channel is in preview (empty when live). */
  reasons: string[];
  recipients: string[];
}

/** Recipients: Settings (UI) win over .env. */
export function emailRecipients(config: NotifyConfig, settings: SettingsDoc): string[] {
  return settings.alertEmails?.length ? settings.alertEmails : config.envAlertEmails;
}
export function telegramChatIds(config: NotifyConfig, settings: SettingsDoc): string[] {
  return settings.telegramChatIds?.length ? settings.telegramChatIds : config.envTelegramChatIds;
}

/** Preview when DRY_RUN is on OR the credentials are missing — never crash on missing keys. */
export function emailStatus(config: NotifyConfig, settings: SettingsDoc): ChannelStatus {
  const reasons: string[] = [];
  if (config.dryRun) reasons.push("DRY_RUN is on");
  if (!config.brevoApiKey) reasons.push("BREVO_API_KEY is not set");
  if (!config.fromEmail) reasons.push("ALERT_FROM_EMAIL is not set");
  return { mode: reasons.length ? "preview" : "live", reasons, recipients: emailRecipients(config, settings) };
}

export function telegramStatus(config: NotifyConfig, settings: SettingsDoc): ChannelStatus {
  const reasons: string[] = [];
  if (config.dryRun) reasons.push("DRY_RUN is on");
  if (!config.telegramBotToken) reasons.push("TELEGRAM_BOT_TOKEN is not set");
  return { mode: reasons.length ? "preview" : "live", reasons, recipients: telegramChatIds(config, settings) };
}

/** Everything the send/dispatch functions need; injectable for tests. */
export interface NotifyContext {
  config: NotifyConfig;
  settings: SettingsDoc;
  /** null → email stays in preview mode. */
  email: EmailProvider | null;
  telegram: TelegramClient | null;
  now: () => Date;
  log?: { info: (o: object, m?: string) => void; warn: (o: object, m?: string) => void; error: (o: object, m?: string) => void };
}

export async function createNotifyContext(
  config: NotifyConfig,
  opts: { fetch?: typeof fetch; sleep?: Sleep; now?: () => Date; settings?: SettingsDoc; log?: NotifyContext["log"] } = {},
): Promise<NotifyContext> {
  const settings = opts.settings ?? (await getSettings());
  const sleep = opts.sleep ?? realSleep;
  return {
    config,
    settings,
    email: config.brevoApiKey ? new BrevoClient({ apiKey: config.brevoApiKey, fetch: opts.fetch, sleep }) : null,
    telegram: config.telegramBotToken ? new TelegramClient({ botToken: config.telegramBotToken, fetch: opts.fetch, sleep }) : null,
    now: opts.now ?? (() => new Date()),
    log: opts.log,
  };
}

export const siteLink = (config: NotifyConfig, siteId: string) => `${config.appUrl}/sites/${siteId}`;
export const incidentLink = (config: NotifyConfig, incidentId: string) => `${config.appUrl}/incidents/${incidentId}`;

export type { AlertData };
