import { alertEmoji, formatAlertTime, formatDuration, type AlertData } from "@siteguard/core";
import { TELEGRAM_MAX_LENGTH } from "./telegram";

/** Telegram HTML mode: only &, < and > must be escaped (plus " inside href). */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const attr = (s: string) => escapeHtml(s).replace(/"/g, "&quot;");

const LABEL: Record<AlertData["type"], string> = {
  opened: "",
  escalated: "ESCALATED",
  resolved: "RESOLVED",
  reminder: "STILL OPEN",
  unstable: "UNSTABLE",
  stable: "STABLE AGAIN",
  worker_offline: "MONITORING OFFLINE",
  worker_online: "MONITORING BACK ONLINE",
};

/** Short, scannable message for one alert. */
export function formatAlertTelegram(d: AlertData, timeZone: string): string {
  const e = alertEmoji(d.type, d.severity);
  const tag = LABEL[d.type] || (d.severity === "CRITICAL" ? "CRITICAL" : d.severity);
  const lines: string[] = [`${e} <b>${tag}</b> · ${escapeHtml(d.siteName ?? "SiteGuard")}`, `<b>${escapeHtml(d.title)}</b>`];

  if (d.clientName) lines.push(`Client: ${escapeHtml(d.clientName)}`);
  if (d.siteUrl) lines.push(`URL: ${escapeHtml(d.siteUrl)}`);
  if (d.checkLabel) lines.push(`Check: ${escapeHtml(d.checkLabel)}`);
  lines.push(`${d.type === "resolved" ? "Was" : "Reason"}: ${escapeHtml(d.message)}`);
  if (d.startedAt) lines.push(`Since: ${formatAlertTime(d.startedAt, timeZone)}`);
  if (d.type === "resolved") {
    lines.push(`Downtime: <b>${formatDuration(d.durationSec)}</b>`);
  } else if (d.startedAt) {
    lines.push(`Last OK: ${d.lastOkAt ? formatAlertTime(d.lastOkAt, timeZone) : "none recorded"}`);
    if (d.type === "reminder") lines.push(`Open for: ${formatDuration(d.durationSec)}`);
  }
  for (const x of d.extra ?? []) lines.push(`${escapeHtml(x.label)}: ${escapeHtml(x.value)}`);
  lines.push(`<a href="${attr(d.link)}">Open in SiteGuard</a>`);
  return truncate(lines.join("\n"));
}

/** One message for a burst of alerts (5+ at once). */
export function formatGroupedTelegram(items: AlertData[], timeZone: string, appUrl: string): string {
  const critical = items.filter((i) => i.severity === "CRITICAL" && i.type !== "resolved").length;
  const head = `${critical ? "🔴" : "🟠"} <b>${items.length} alerts</b>${critical ? ` · ${critical} critical` : ""}`;
  const body = items.map((d) => {
    const time = d.startedAt ? ` (${formatAlertTime(d.startedAt, timeZone).replace(/^\d+ \w+ \d{4}, /, "")})` : "";
    const what = d.type === "resolved" ? `resolved after ${formatDuration(d.durationSec)}` : escapeHtml(d.message);
    return `${alertEmoji(d.type, d.severity)} <a href="${attr(d.link)}">${escapeHtml(d.siteName ?? d.title)}</a> — ${what}${time}`;
  });
  return truncate([head, "", ...body, "", `<a href="${attr(appUrl)}">Open dashboard</a>`].join("\n"));
}

/** Keep under Telegram's 4096 limit without cutting an HTML tag in half. */
export function truncate(text: string, max = TELEGRAM_MAX_LENGTH): string {
  if (text.length <= max) return text;
  const lines = text.split("\n");
  const out: string[] = [];
  let len = 0;
  for (const l of lines) {
    if (len + l.length + 1 > max - 40) break;
    out.push(l);
    len += l.length + 1;
  }
  return `${out.join("\n")}\n… (${lines.length - out.length} more lines)`;
}
