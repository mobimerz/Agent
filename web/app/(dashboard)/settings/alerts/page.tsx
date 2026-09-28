import { DEFAULTS, DEFAULT_THRESHOLDS } from "@siteguard/core";
import { getSettings } from "@siteguard/db";
import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireAdmin } from "@/lib/session";
import { AlertSettingsForm, type AlertSettingsValues } from "./alert-settings-form";

export const metadata = { title: "Alerts, reports & thresholds" };

export default async function AlertSettingsPage() {
  await requireAdmin();
  await db();
  const s = await getSettings();
  const t = { ...DEFAULT_THRESHOLDS, ...(s.thresholds ?? {}) };
  const initial: AlertSettingsValues = {
    morning: s.reports?.morning ?? DEFAULTS.reportMorning,
    night: s.reports?.night ?? DEFAULTS.reportNight,
    reportEmail: s.reports?.emailEnabled ?? true,
    reportTelegram: s.reports?.telegramEnabled ?? true,
    alertEmails: (s.alertEmails ?? []).join(", "),
    telegramChatIds: (s.telegramChatIds ?? []).join(", "),
    responseTimeWarnMs: String(t.responseTimeWarnMs),
    minPerformance: String(t.minPerformance),
    minSeo: String(t.minSeo),
    sslWarnDays: String(t.sslWarnDays),
    sslFailDays: String(t.sslFailDays),
    domainWarnDays: String(t.domainWarnDays),
    domainFailDays: String(t.domainFailDays),
    reminderAfterMin: String(s.alerts?.reminderAfterMin ?? DEFAULTS.reminderAfterMin),
  };
  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <PageHeader title="Alerts, reports & thresholds" description="Report schedule, who gets alerts, and the default limits every check uses." />
      <AlertSettingsForm initial={initial} envEmails={env.ALERT_TO_EMAILS} envChats={env.TELEGRAM_CHAT_ID} timeZone={s.timezone || env.TIMEZONE} />
    </div>
  );
}
