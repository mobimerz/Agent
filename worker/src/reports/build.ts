import {
  dayKey,
  displayStatus,
  reportHeadline,
  REPORT_EXPIRY_DAYS,
  type CheckSummary,
  type CheckType,
  type DisplayStatus,
  type LatestChecks,
  type ReportChange,
  type ReportIncidentLine,
  type ReportKind,
  type ReportSiteRow,
  type ReportSnapshot,
} from "@siteguard/core";
import { CheckResult, Incident, Report, Site, type IncidentLean, type Types } from "@siteguard/db";

/** A report covers the time since the previous one, but never more than this. */
const MAX_PERIOD_MS = 36 * 3_600_000;
const DEFAULT_PERIOD_MS = 12 * 3_600_000;
/** Lighthouse drop worth mentioning (scores naturally move 5–10 points). */
const SCORE_DROP_POINTS = 15;

const SEVERITY_RANK = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;

const BAD: DisplayStatus[] = ["down", "checking"];
const WARNISH: DisplayStatus[] = ["degraded", "blocked"];

function incidentLine(i: Pick<IncidentLean, "_id" | "title" | "severity" | "startedAt" | "resolvedAt" | "durationSec">, siteName: string): ReportIncidentLine {
  return {
    id: String(i._id),
    siteName,
    title: i.title,
    severity: i.severity,
    startedAt: i.startedAt.toISOString(),
    resolvedAt: i.resolvedAt?.toISOString() ?? null,
    durationSec: i.durationSec ?? null,
  };
}

async function uptimeInPeriod(from: Date, to: Date): Promise<Map<string, { pct: number | null; avgMs: number | null }>> {
  const rows = await CheckResult.aggregate<{ _id: Types.ObjectId; total: number; down: number; avg: number | null }>([
    { $match: { "meta.checkType": "uptime", checkedAt: { $gte: from, $lt: to }, attempt: { $in: [0, null] }, status: { $ne: "UNKNOWN" }, skipped: { $ne: true } } },
    { $group: { _id: "$meta.siteId", total: { $sum: 1 }, down: { $sum: { $cond: [{ $eq: ["$status", "FAIL"] }, 1, 0] } }, avg: { $avg: "$metrics.responseTimeMs" } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), { pct: r.total ? ((r.total - r.down) / r.total) * 100 : null, avgMs: r.avg != null ? Math.round(r.avg) : null }]));
}

/** What changed since the previous report's snapshot (status flips, new expiries, score drops, sites added/paused). */
export function diffSnapshots(prev: ReportSiteRow[] | null, now: ReportSiteRow[]): ReportChange[] {
  if (!prev) return [];
  const before = new Map(prev.map((s) => [s.id, s]));
  const out: ReportChange[] = [];
  for (const s of now) {
    const p = before.get(s.id);
    const base = { siteId: s.id, siteName: s.name };
    if (!p) {
      out.push({ ...base, kind: "added", tone: "info", text: "added to monitoring" });
      continue;
    }
    if (p.status !== s.status) {
      if (s.status === "paused") out.push({ ...base, kind: "paused", tone: "info", text: "monitoring paused" });
      else if (p.status === "paused") out.push({ ...base, kind: "resumed", tone: "info", text: "monitoring resumed" });
      else if (BAD.includes(s.status) && !BAD.includes(p.status)) out.push({ ...base, kind: "down", tone: "bad", text: `went DOWN (was ${p.status})` });
      else if (!BAD.includes(s.status) && BAD.includes(p.status)) out.push({ ...base, kind: "recovered", tone: "good", text: `recovered — now ${s.status}` });
      else if (WARNISH.includes(s.status) && p.status === "up") out.push({ ...base, kind: "degraded", tone: "bad", text: `now ${s.status}${s.issues[0] ? ` (${s.issues[0].message})` : ""}` });
      else if (s.status === "up" && WARNISH.includes(p.status)) out.push({ ...base, kind: "improved", tone: "good", text: `back to normal (was ${p.status})` });
    }
    for (const [what, d, pd] of [
      ["SSL certificate", s.sslDaysLeft, p.sslDaysLeft],
      ["Domain", s.domainDaysLeft, p.domainDaysLeft],
    ] as const) {
      if (d != null && d <= REPORT_EXPIRY_DAYS && (pd == null || pd > REPORT_EXPIRY_DAYS)) {
        out.push({ ...base, kind: "expiring", tone: "bad", text: `${what} expires in ${d} day${d === 1 ? "" : "s"}` });
      }
    }
    if (s.perfMobile != null && p.perfMobile != null && p.perfMobile - s.perfMobile >= SCORE_DROP_POINTS) {
      out.push({ ...base, kind: "score_drop", tone: "bad", text: `mobile performance ${p.perfMobile} → ${s.perfMobile}` });
    }
  }
  const order = { bad: 0, good: 1, info: 2 } as const;
  return out.sort((a, b) => order[a.tone] - order[b.tone] || a.siteName.localeCompare(b.siteName));
}

/** Build the snapshot for a report generated at `now` (not persisted here). */
export async function buildReport(kind: ReportKind, now: Date, timeZone: string, opts: { manual?: boolean } = {}): Promise<ReportSnapshot> {
  const prev = await Report.findOne({ generatedAt: { $lt: now } }, { generatedAt: 1, sites: 1 }).sort({ generatedAt: -1 }).lean();
  const prevAt = prev?.generatedAt?.getTime();
  const periodStart = new Date(prevAt && now.getTime() - prevAt <= MAX_PERIOD_MS ? prevAt : now.getTime() - (prevAt ? MAX_PERIOD_MS : DEFAULT_PERIOD_MS));

  const [sites, uptime, opened, resolved, open] = await Promise.all([
    Site.find({}, { name: 1, clientName: 1, url: 1, status: 1, current: 1 }).sort({ name: 1 }).lean(),
    uptimeInPeriod(periodStart, now),
    Incident.find({ startedAt: { $gte: periodStart, $lt: now } }).sort({ startedAt: -1 }).limit(50).lean(),
    Incident.find({ status: "RESOLVED", resolvedAt: { $gte: periodStart, $lt: now } }).sort({ resolvedAt: -1 }).limit(50).lean(),
    Incident.find({ isOpen: true }).sort({ startedAt: 1 }).limit(50).lean(),
  ]);
  const names = new Map(sites.map((s) => [String(s._id), s.name]));
  const siteName = (id: Types.ObjectId) => names.get(String(id)) ?? "(deleted site)";

  const rows: ReportSiteRow[] = sites.map((s) => {
    const checks = (s.current?.checks ?? {}) as LatestChecks;
    const status = displayStatus({ status: s.status, current: { health: s.current?.health, checks } });
    const u = uptime.get(String(s._id));
    const issues = (Object.entries(checks) as [CheckType, CheckSummary][])
      .filter(([, c]) => c && (c.status === "FAIL" || c.status === "WARN"))
      .map(([check, c]) => ({ check, status: c.status, reason: c.reason, message: c.message }));
    return {
      id: String(s._id),
      name: s.name,
      clientName: s.clientName ?? "",
      url: s.url,
      status,
      uptimePct: u?.pct ?? null,
      avgResponseMs: u?.avgMs ?? null,
      issues: s.status === "paused" ? [] : issues,
      sslDaysLeft: s.current?.sslDaysLeft ?? null,
      domainDaysLeft: s.current?.domainDaysLeft ?? null,
      perfMobile: s.current?.perfMobile ?? null,
      seoScore: s.current?.seoScore ?? null,
      openIncidents: s.current?.openIncidents ?? 0,
    };
  });

  const active = rows.filter((r) => r.status !== "paused");
  const count = (st: DisplayStatus[]) => active.filter((r) => st.includes(r.status)).length;
  const uptimes = active.map((r) => r.uptimePct).filter((v): v is number => v != null);
  const summary = {
    total: active.length,
    up: count(["up"]),
    down: count(["down", "checking"]),
    degraded: count(["degraded"]),
    blocked: count(["blocked"]),
    paused: rows.length - active.length,
    openIncidents: open.length,
    avgUptime: uptimes.length ? uptimes.reduce((a, b) => a + b, 0) / uptimes.length : null,
    headline: "",
  };
  summary.headline = reportHeadline(summary);

  return {
    kind,
    date: dayKey(now, timeZone),
    generatedAt: now.toISOString(),
    periodStart: periodStart.toISOString(),
    periodEnd: now.toISOString(),
    manual: opts.manual ?? false,
    summary,
    changes: diffSnapshots((prev?.sites as ReportSiteRow[] | undefined) ?? null, rows),
    incidents: {
      opened: opened.map((i) => incidentLine(i, siteName(i.siteId))),
      resolved: resolved.map((i) => incidentLine(i, siteName(i.siteId))),
      open: open.map((i) => incidentLine(i, siteName(i.siteId))).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]),
    },
    sites: rows,
  };
}
