import type { CheckStatus, CheckType, ReportKind, Severity } from "./enums";
import type { CheckReason } from "./reasons";
import type { DisplayStatus } from "./health";

/** One site's line in a morning/night report. */
export interface ReportSiteRow {
  id: string;
  name: string;
  clientName: string;
  url: string;
  status: DisplayStatus;
  /** Uptime % over the report period (null = no data). */
  uptimePct: number | null;
  avgResponseMs: number | null;
  /** Checks currently not OK (for "needs attention"). */
  issues: { check: CheckType; status: CheckStatus; reason?: CheckReason; message: string }[];
  sslDaysLeft: number | null;
  domainDaysLeft: number | null;
  perfMobile: number | null;
  seoScore: number | null;
  openIncidents: number;
}

export type ReportChangeKind = "down" | "recovered" | "degraded" | "improved" | "expiring" | "score_drop" | "added" | "paused" | "resumed";

export interface ReportChange {
  kind: ReportChangeKind;
  siteId: string;
  siteName: string;
  text: string;
  /** good = green news, bad = needs attention, info = neutral. */
  tone: "good" | "bad" | "info";
}

export interface ReportIncidentLine {
  id: string;
  siteName: string;
  title: string;
  severity: Severity;
  startedAt: string;
  resolvedAt?: string | null;
  durationSec?: number | null;
}

export interface ReportSnapshot {
  kind: ReportKind;
  /** YYYY-MM-DD in the report timezone. */
  date: string;
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  manual: boolean;
  summary: {
    total: number;
    up: number;
    down: number;
    degraded: number;
    blocked: number;
    paused: number;
    openIncidents: number;
    avgUptime: number | null;
    headline: string;
  };
  changes: ReportChange[];
  incidents: { opened: ReportIncidentLine[]; resolved: ReportIncidentLine[]; open: ReportIncidentLine[] };
  sites: ReportSiteRow[];
}

/** Renewals worth mentioning in every report. */
export const REPORT_EXPIRY_DAYS = 30;

export const REPORT_KIND_LABEL: Record<ReportKind, string> = { morning: "Morning report", night: "Night report" };

/** "All 12 sites up" · "2 down, 1 degraded · 3 open incidents". */
export function reportHeadline(s: Pick<ReportSnapshot["summary"], "total" | "up" | "down" | "degraded" | "blocked" | "openIncidents">): string {
  if (!s.total) return "No sites monitored yet";
  const problems = [s.down && `${s.down} down`, s.degraded && `${s.degraded} degraded`, s.blocked && `${s.blocked} blocked`].filter(Boolean);
  const open = s.openIncidents ? ` · ${s.openIncidents} open incident${s.openIncidents === 1 ? "" : "s"}` : "";
  return problems.length ? `${problems.join(", ")}${open}` : `All ${s.total} site${s.total === 1 ? "" : "s"} up${open}`;
}

/** Items that expire soon (SSL or domain), soonest first. */
export function upcomingExpiries(sites: ReportSiteRow[], days = REPORT_EXPIRY_DAYS): { siteName: string; what: "SSL" | "Domain"; daysLeft: number }[] {
  const out: { siteName: string; what: "SSL" | "Domain"; daysLeft: number }[] = [];
  for (const s of sites) {
    if (s.sslDaysLeft != null && s.sslDaysLeft <= days) out.push({ siteName: s.name, what: "SSL", daysLeft: s.sslDaysLeft });
    if (s.domainDaysLeft != null && s.domainDaysLeft <= days) out.push({ siteName: s.name, what: "Domain", daysLeft: s.domainDaysLeft });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}
