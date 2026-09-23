import type { AlertType, CheckType, Severity } from "./enums";
import type { CheckReason } from "./reasons";

/**
 * Everything needed to render one alert in any channel. Stored as a snapshot on
 * the AlertEvent so a message can be (re)rendered later without joins.
 */
export interface AlertData {
  type: AlertType;
  severity: Severity;
  title: string;
  siteName?: string;
  clientName?: string;
  siteUrl?: string;
  checkType?: CheckType;
  checkLabel?: string;
  reason?: CheckReason;
  /** Exact human reason, e.g. "Timeout after 30 s", "HTTP 503 server error". */
  message: string;
  /** ISO strings (JSON-safe). */
  startedAt?: string;
  lastOkAt?: string | null;
  resolvedAt?: string;
  durationSec?: number;
  /** Deep link to the site page (or the relevant page). */
  link: string;
  incidentLink?: string;
  /** Extra free-form lines (flap count, worker last seen…). */
  extra?: { label: string; value: string }[];
}

const TZ_LABEL: Record<string, string> = { "Asia/Kolkata": "IST" };

/** "23 Sept 2026, 12:15 pm IST" in the configured timezone. */
export function formatAlertTime(iso: string | Date | null | undefined, timeZone: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const s = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone }).format(d);
  return `${s} ${TZ_LABEL[timeZone] ?? timeZone}`;
}

/** 42 s · 12 min · 3 h 5 min · 2 d 4 h */
export function formatDuration(totalSec: number | null | undefined): string {
  if (totalSec == null || !Number.isFinite(totalSec)) return "—";
  const s = Math.max(0, Math.round(totalSec));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h} h ${rm} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d} d ${rh} h` : `${d} d`;
}

export const SEVERITY_EMOJI: Record<Severity | "RESOLVED", string> = {
  CRITICAL: "🔴",
  WARNING: "🟠",
  INFO: "🔵",
  RESOLVED: "🟢",
};

/** Emoji for an alert: green for good news, otherwise by severity. */
export function alertEmoji(type: AlertType, severity: Severity): string {
  return type === "resolved" || type === "stable" || type === "worker_online" ? SEVERITY_EMOJI.RESOLVED : SEVERITY_EMOJI[severity];
}
