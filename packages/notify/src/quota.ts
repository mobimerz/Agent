import { dayKey, DEFAULTS, type EmailCategory } from "@siteguard/core";
import { EmailLog } from "@siteguard/db";
import type { NotifyContext } from "./context";

export interface EmailQuota {
  day: string;
  /** Emails counted today (sent + preview). */
  used: number;
  dailyLimit: number;
  /** Always kept free for the morning/night reports. */
  reservedForReports: number;
  /** used ≥ this → alert emails are batched into a digest. */
  digestAfter: number;
  remainingForAlerts: number;
  remainingTotal: number;
  digestMode: boolean;
}

/**
 * Brevo free plan = 300/day. We cap ourselves at `dailyLimit` (250) and always
 * keep `reservedForReports` (10) of those for the daily reports, so alerts can
 * never consume the report budget. Preview sends count too, so the limits
 * behave identically before and after going live.
 */
export async function getEmailQuota(ctx: NotifyContext): Promise<EmailQuota> {
  const s = ctx.settings.email;
  const dailyLimit = s?.dailyLimit ?? DEFAULTS.emailDailyLimit;
  const reservedForReports = s?.reservedForReports ?? DEFAULTS.emailReservedForReports;
  const digestAfter = s?.digestAfter ?? DEFAULTS.emailDigestAfter;
  const day = dayKey(ctx.now(), ctx.config.timeZone);
  const used = await EmailLog.countDocuments({ day, status: { $in: ["sent", "preview"] } });
  return {
    day,
    used,
    dailyLimit,
    reservedForReports,
    digestAfter,
    remainingForAlerts: Math.max(0, dailyLimit - reservedForReports - used),
    remainingTotal: Math.max(0, dailyLimit - used),
    digestMode: used >= digestAfter,
  };
}

/** Reports may use the reserved slice; everything else may not. */
export function quotaAllows(q: EmailQuota, category: EmailCategory): boolean {
  return category === "report" ? q.remainingTotal > 0 : q.remainingForAlerts > 0;
}
