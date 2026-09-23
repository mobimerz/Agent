import { DEFAULTS, type AlertData, type AlertType, type CheckType, type EmailCategory, type NotificationType, type Severity } from "@siteguard/core";
import { renderAlertEmail, renderDigestEmail } from "@siteguard/emails";
import { AlertEvent, EmailLog, Notification, Types, type AlertEventLean } from "@siteguard/db";
import type { NotifyContext } from "./context";
import { getEmailQuota } from "./quota";
import { sendEmail, sendTelegram, type SendOutcome } from "./send";
import { formatAlertTelegram, formatGroupedTelegram } from "./telegram-format";

// ─── In-app ──────────────────────────────────────────────────────────

const NOTIFICATION_TYPE: Record<AlertType, NotificationType> = {
  opened: "incident_opened",
  escalated: "incident_escalated",
  resolved: "incident_resolved",
  reminder: "incident_reminder",
  unstable: "site_unstable",
  stable: "site_stable",
  worker_offline: "worker_offline",
  worker_online: "worker_online",
};

/** Broadcast in-app notification (Change Stream → SSE picks it up instantly). */
export async function createInAppNotification(args: {
  type: NotificationType;
  severity: Severity;
  title: string;
  body: string;
  link?: string;
  siteId?: Types.ObjectId | string;
  incidentId?: Types.ObjectId | string;
}) {
  return Notification.create({ ...args, userId: null });
}

export function inAppFromAlert(data: AlertData, ids: { siteId?: Types.ObjectId | string; incidentId?: Types.ObjectId | string }) {
  const prefix = data.siteName ? `${data.siteName}: ` : "";
  return createInAppNotification({
    type: NOTIFICATION_TYPE[data.type],
    severity: data.type === "resolved" || data.type === "stable" || data.type === "worker_online" ? "INFO" : data.severity,
    title: `${prefix}${data.type === "resolved" ? `Resolved — ${data.title}` : data.title}`,
    body: data.message,
    link: data.incidentLink ?? data.link,
    ...ids,
  });
}

// ─── Alert events (email + Telegram fan-out) ─────────────────────────

export interface QueueAlertArgs {
  data: AlertData;
  siteId?: Types.ObjectId | string;
  incidentId?: Types.ObjectId | string;
  checkType?: CheckType;
  channels: { email: boolean; telegram: boolean; inApp: boolean };
  /** Skip grouping/digest (hacked site, worker offline). */
  priority?: boolean;
  /** Maintenance window / flapping: record but don't send. */
  suppressed?: boolean;
}

/** Record an alert; in-app is written now, email/Telegram are delivered by the dispatcher. */
export async function queueAlert(args: QueueAlertArgs) {
  const state = (on: boolean) => (args.suppressed ? "suppressed" : on ? "pending" : "none");
  const event = await AlertEvent.create({
    type: args.data.type,
    severity: args.data.severity,
    siteId: args.siteId,
    incidentId: args.incidentId,
    checkType: args.checkType ?? null,
    data: args.data,
    priority: args.priority ?? false,
    channels: { email: state(args.channels.email), telegram: state(args.channels.telegram) },
  });
  if (args.channels.inApp && !args.suppressed) await inAppFromAlert(args.data, { siteId: args.siteId, incidentId: args.incidentId });
  return event;
}

export function emailCategory(type: AlertType): EmailCategory {
  if (type === "resolved" || type === "stable") return "resolved";
  if (type === "reminder") return "reminder";
  if (type === "worker_offline" || type === "worker_online") return "system";
  return "alert";
}

function stateOf(o: SendOutcome, groupedState?: "grouped") {
  if (o.state === "sent") return groupedState ?? "sent";
  if (o.state === "preview") return groupedState ?? "preview";
  return o.state; // skipped | failed
}

async function markEmail(ids: unknown[], o: SendOutcome, grouped?: boolean) {
  await AlertEvent.updateMany(
    { _id: { $in: ids } },
    { $set: { "channels.email": stateOf(o, grouped ? "grouped" : undefined), "deliveryErrors.email": o.error?.message ?? null, processedAt: new Date() } },
  );
}
async function markTelegram(ids: unknown[], o: SendOutcome, grouped?: boolean) {
  await AlertEvent.updateMany(
    { _id: { $in: ids } },
    { $set: { "channels.telegram": stateOf(o, grouped ? "grouped" : undefined), "deliveryErrors.telegram": o.error?.message ?? null, processedAt: new Date() } },
  );
}

/** Render errors must only fail that one alert, never the whole dispatch batch. */
async function renderOrFail<T>(fn: () => Promise<T>): Promise<T | SendOutcome> {
  try {
    return await fn();
  } catch (err) {
    return { state: "failed", error: { kind: "render", message: `Could not render message: ${(err as Error).message}` } };
  }
}
const isOutcome = (x: unknown): x is SendOutcome => typeof x === "object" && x !== null && "state" in x;

async function emailOne(ctx: NotifyContext, data: AlertData, bypassQuota = false): Promise<SendOutcome> {
  const rendered = await renderOrFail(() => renderAlertEmail(data, ctx.config.timeZone));
  if (isOutcome(rendered)) return rendered;
  return sendEmail(ctx, { category: emailCategory(data.type), rendered, bypassQuota });
}

/** Deliver one event on its pending channels right now (no grouping). */
export async function deliverAlertNow(ctx: NotifyContext, event: AlertEventLean): Promise<{ email?: SendOutcome; telegram?: SendOutcome }> {
  const data = event.data as AlertData;
  const out: { email?: SendOutcome; telegram?: SendOutcome } = {};
  if (event.channels?.telegram === "pending") {
    out.telegram = await sendTelegram(ctx, { text: formatAlertTelegram(data, ctx.config.timeZone), category: emailCategory(data.type) });
    await markTelegram([event._id], out.telegram);
  }
  if (event.channels?.email === "pending") {
    // Worker-offline must get through even when the alert budget is spent.
    out.email = await emailOne(ctx, data, data.type === "worker_offline");
    await markEmail([event._id], out.email);
  }
  return out;
}

/**
 * Process pending alert events (runs every 15 s in the worker).
 *
 * Telegram: individually, or ONE combined message when ≥ groupThreshold are pending.
 * Email (Brevo quota is precious):
 *  - priority events → sent individually right away
 *  - quota for alerts used up → skipped (Telegram + in-app still deliver)
 *  - digest mode (≥ digestAfter emails today) → one digest at most every digestIntervalMin
 *  - burst: pending + alert emails in the last groupWindow ≥ groupThreshold →
 *    ONE grouped email (at most one per window; the rest wait for the next one)
 *  - otherwise individually
 */
export async function dispatchPendingAlerts(ctx: NotifyContext): Promise<{ telegram: number; email: number }> {
  const threshold = ctx.settings.alerts?.groupThreshold ?? DEFAULTS.groupThreshold;
  const windowMs = (ctx.settings.alerts?.groupWindowMin ?? DEFAULTS.groupWindowMin) * 60_000;
  const now = ctx.now();
  const tz = ctx.config.timeZone;
  let tgCount = 0;
  let emailCount = 0;

  // ── Telegram
  const tg = await AlertEvent.find({ "channels.telegram": "pending" }).sort({ createdAt: 1 }).limit(200).lean();
  if (tg.length >= threshold) {
    const o = await sendTelegram(ctx, { text: formatGroupedTelegram(tg.map((e) => e.data as AlertData), tz, ctx.config.appUrl), category: "alert" });
    await markTelegram(tg.map((e) => e._id), o, true);
    tgCount = 1;
  } else {
    for (const e of tg) {
      const o = await sendTelegram(ctx, { text: formatAlertTelegram(e.data as AlertData, tz), category: emailCategory(e.type) });
      await markTelegram([e._id], o);
      tgCount++;
    }
  }

  // ── Email
  const pending = await AlertEvent.find({ "channels.email": "pending" }).sort({ createdAt: 1 }).limit(200).lean();
  const priority = pending.filter((e) => e.priority);
  const normal = pending.filter((e) => !e.priority);

  for (const e of priority) {
    await markEmail([e._id], await emailOne(ctx, e.data as AlertData, e.type === "worker_offline"));
    emailCount++;
  }
  if (!normal.length) return { telegram: tgCount, email: emailCount };

  const quota = await getEmailQuota(ctx);
  const sendGroup = async (events: typeof normal, reason: "grouped" | "digest") => {
    const rendered = await renderOrFail(() => renderDigestEmail(events.map((e) => e.data as AlertData), tz, reason));
    const outcome = isOutcome(rendered) ? rendered : await sendEmail(ctx, { category: "digest", rendered, items: events.length });
    await markEmail(events.map((e) => e._id), outcome, true);
    emailCount++;
  };

  if (quota.remainingForAlerts <= 0) {
    await markEmail(
      normal.map((e) => e._id),
      { state: "skipped", error: { kind: "quota", message: `Alert email budget used (${quota.used}/${quota.dailyLimit}; ${quota.reservedForReports} kept for reports)` } },
    );
    return { telegram: tgCount, email: emailCount };
  }

  if (quota.digestMode) {
    const digestMs = (ctx.settings.email?.digestIntervalMin ?? DEFAULTS.digestIntervalMin) * 60_000;
    const recentDigest = await EmailLog.exists({ category: "digest", status: { $in: ["sent", "preview"] }, sentAt: { $gte: new Date(now.getTime() - digestMs) } });
    if (!recentDigest) await sendGroup(normal, "digest");
    return { telegram: tgCount, email: emailCount };
  }

  const recentIndividual = await EmailLog.countDocuments({
    category: { $in: ["alert", "resolved", "reminder"] },
    status: { $in: ["sent", "preview"] },
    sentAt: { $gte: new Date(now.getTime() - windowMs) },
  });
  if (normal.length + recentIndividual >= threshold) {
    const recentGroup = await EmailLog.exists({ category: "digest", status: { $in: ["sent", "preview"] }, sentAt: { $gte: new Date(now.getTime() - windowMs) } });
    if (!recentGroup) await sendGroup(normal, "grouped");
    // else: hold — they go out together in the next grouped email after the window.
    return { telegram: tgCount, email: emailCount };
  }

  for (const e of normal) {
    await markEmail([e._id], await emailOne(ctx, e.data as AlertData));
    emailCount++;
  }
  return { telegram: tgCount, email: emailCount };
}
