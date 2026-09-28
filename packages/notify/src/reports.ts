import { formatDuration, REPORT_KIND_LABEL, upcomingExpiries, type ReportSnapshot, type Severity } from "@siteguard/core";
import { renderReportEmail } from "@siteguard/emails";
import { createInAppNotification } from "./alerts";
import type { NotifyContext } from "./context";
import { sendEmail, sendTelegram, type SendState } from "./send";
import { escapeHtml, truncate } from "./telegram-format";

const MAX_LINES = 12;

/** Short Telegram version: headline, counts, what changed, what needs attention. */
export function formatReportTelegram(r: ReportSnapshot, reportUrl: string, timeZone: string): string {
  const s = r.summary;
  const e = s.down ? "🔴" : s.degraded || s.blocked || s.openIncidents ? "🟠" : "🟢";
  const date = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone }).format(new Date(r.generatedAt));
  const lines = [
    `${r.kind === "morning" ? "☀️" : "🌙"} <b>${REPORT_KIND_LABEL[r.kind]} · ${date}</b>`,
    `${e} <b>${escapeHtml(s.headline)}</b>`,
    `🟢 ${s.up} up · 🔴 ${s.down} down · 🟠 ${s.degraded + s.blocked} degraded${s.paused ? ` · ⏸ ${s.paused} paused` : ""}`,
  ];

  const changes = [
    ...r.changes.map((c) => `${c.tone === "bad" ? "🔴" : c.tone === "good" ? "🟢" : "🔵"} ${escapeHtml(c.siteName)} ${escapeHtml(c.text)}`),
    ...r.incidents.resolved.map((i) => `✅ ${escapeHtml(i.siteName)} resolved: ${escapeHtml(i.title)} (${formatDuration(i.durationSec)})`),
  ];
  if (changes.length) {
    lines.push("", "<b>Since last report</b>", ...changes.slice(0, MAX_LINES));
    if (changes.length > MAX_LINES) lines.push(`… and ${changes.length - MAX_LINES} more`);
  }

  if (r.incidents.open.length) {
    lines.push("", `<b>Open incidents (${r.incidents.open.length})</b>`);
    for (const i of r.incidents.open.slice(0, MAX_LINES)) lines.push(`${i.severity === "CRITICAL" ? "🔴" : i.severity === "WARNING" ? "🟠" : "🔵"} ${escapeHtml(i.siteName)} — ${escapeHtml(i.title)}`);
  }

  const expiries = upcomingExpiries(r.sites);
  if (expiries.length) {
    lines.push("", "<b>Renewals due</b>");
    for (const x of expiries.slice(0, MAX_LINES)) lines.push(`${x.daysLeft <= 7 ? "🔴" : "🟠"} ${escapeHtml(x.siteName)} — ${x.what} ${x.daysLeft < 0 ? "EXPIRED" : `in ${x.daysLeft} d`}`);
  }

  lines.push("", `<a href="${escapeHtml(reportUrl).replace(/"/g, "&quot;")}">Open full report</a>`);
  return truncate(lines.join("\n"));
}

export interface ReportDelivery {
  email: SendState | null;
  telegram: SendState | null;
  inApp: boolean;
  errors: string[];
}

/**
 * Send a report on every enabled channel. Emails use the "report" category, so
 * they may use the slice of the daily quota reserved for reports. Never throws.
 */
export async function deliverReport(ctx: NotifyContext, report: ReportSnapshot, reportId: string): Promise<ReportDelivery> {
  const reportUrl = `${ctx.config.appUrl}/reports/${reportId}`;
  const cfg = ctx.settings.reports;
  const out: ReportDelivery = { email: null, telegram: null, inApp: false, errors: [] };

  if (cfg?.emailEnabled ?? true) {
    const rendered = await renderReportEmail({ report, timeZone: ctx.config.timeZone, appUrl: ctx.config.appUrl, reportUrl });
    const res = await sendEmail(ctx, { category: "report", rendered });
    out.email = res.state;
    if (res.error) out.errors.push(`email: ${res.error.message}`);
  }
  if (cfg?.telegramEnabled ?? true) {
    // Reports are routine: deliver silently (no notification sound) unless something is down.
    const res = await sendTelegram(ctx, { category: "report", text: formatReportTelegram(report, reportUrl, ctx.config.timeZone), silent: report.summary.down === 0 });
    out.telegram = res.state;
    if (res.error) out.errors.push(`telegram: ${res.error.message}`);
  }

  const severity: Severity = report.summary.down ? "CRITICAL" : report.summary.degraded || report.summary.blocked || report.summary.openIncidents ? "WARNING" : "INFO";
  await createInAppNotification({ type: "report", severity, title: `${REPORT_KIND_LABEL[report.kind]}: ${report.summary.headline}`, body: `${report.changes.length} change(s) since the last report.`, link: `/reports/${reportId}` });
  out.inApp = true;
  return out;
}
