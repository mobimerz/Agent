import "server-only";
import {
  DISPLAY_STATUS_RANK,
  displayStatus,
  type CheckReason,
  type CheckStatus,
  type CheckType,
  type DisplayStatus,
  type LatestChecks,
} from "@siteguard/core";
import { CheckResult, JobState, MaintenanceWindow, Site, Types, UptimeHourly, mongoose, type SiteLean } from "@siteguard/db";
import { db } from "../db";

// ─── List ─────────────────────────────────────────────────────────────

export const SORT_KEYS = ["status", "response", "name", "client", "checked"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const STATUS_FILTERS = ["down", "checking", "degraded", "blocked", "up", "unknown", "paused"] as const;

export interface SiteFilters {
  q?: string;
  client?: string;
  tag?: string;
  status?: DisplayStatus;
  sort?: SortKey;
  dir?: "asc" | "desc";
}

export function parseSiteFilters(sp: Record<string, string | string[] | undefined>): SiteFilters {
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const sort = one("sort") as SortKey | undefined;
  const status = one("status") as DisplayStatus | undefined;
  return {
    q: one("q"),
    client: one("client"),
    tag: one("tag"),
    status: status && (STATUS_FILTERS as readonly string[]).includes(status) ? status : undefined,
    sort: sort && SORT_KEYS.includes(sort) ? sort : "status",
    dir: one("dir") === "desc" ? "desc" : "asc",
  };
}

/** Plain, client-safe row. */
export interface SiteRow {
  id: string;
  name: string;
  url: string;
  clientName: string;
  tags: string[];
  status: DisplayStatus;
  paused: boolean;
  responseTimeMs: number | null;
  statusCode: number | null;
  lastCheckedAt: string | null;
  uptimeReason: CheckReason | null;
  uptimeMessage: string;
  spark: (number | null)[];
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function listSites(filters: SiteFilters): Promise<SiteRow[]> {
  await db();
  const query: Record<string, unknown> = {};
  if (filters.q) {
    const rx = new RegExp(escapeRegex(filters.q), "i");
    query.$or = [{ name: rx }, { url: rx }, { clientName: rx }, { tags: rx }];
  }
  if (filters.client) query.clientName = filters.client;
  if (filters.tag) query.tags = filters.tag;

  const sites = await Site.find(query, { name: 1, url: 1, clientName: 1, tags: 1, status: 1, current: 1 }).lean();
  const sparks = await getSparklines(sites.map((s) => s._id));

  let rows: SiteRow[] = sites.map((s) => {
    const checks = (s.current?.checks ?? {}) as LatestChecks;
    return {
      id: String(s._id),
      name: s.name,
      url: s.url,
      clientName: s.clientName ?? "",
      tags: s.tags ?? [],
      status: displayStatus({ status: s.status, current: { health: s.current?.health, checks } }),
      paused: s.status === "paused",
      responseTimeMs: s.current?.responseTimeMs ?? null,
      statusCode: s.current?.statusCode ?? null,
      lastCheckedAt: s.current?.lastCheckedAt?.toISOString() ?? null,
      uptimeReason: checks.uptime?.reason ?? null,
      uptimeMessage: checks.uptime?.message ?? "",
      spark: sparks.get(String(s._id)) ?? [],
    };
  });

  if (filters.status) rows = rows.filter((r) => r.status === filters.status);

  const dir = filters.dir === "desc" ? -1 : 1;
  const byName = (a: SiteRow, b: SiteRow) => a.name.localeCompare(b.name);
  const cmp: Record<SortKey, (a: SiteRow, b: SiteRow) => number> = {
    status: (a, b) => DISPLAY_STATUS_RANK[a.status] - DISPLAY_STATUS_RANK[b.status],
    response: (a, b) => a.responseTimeMs! - b.responseTimeMs!,
    name: byName,
    client: (a, b) => a.clientName.localeCompare(b.clientName),
    checked: (a, b) => (a.lastCheckedAt ?? "").localeCompare(b.lastCheckedAt ?? ""),
  };
  const sortKey = filters.sort ?? "status";
  rows.sort((a, b) => {
    // Sites without a response time always sink to the bottom, whatever the direction.
    if (sortKey === "response" && (a.responseTimeMs == null || b.responseTimeMs == null)) {
      if (a.responseTimeMs == null && b.responseTimeMs == null) return byName(a, b);
      return a.responseTimeMs == null ? 1 : -1;
    }
    return cmp[sortKey](a, b) * dir || byName(a, b);
  });
  return rows;
}

export async function getFilterOptions(): Promise<{ clients: string[]; tags: string[] }> {
  await db();
  const [clients, tags] = await Promise.all([Site.distinct("clientName"), Site.distinct("tags")]);
  return {
    clients: (clients as string[]).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    tags: (tags as string[]).filter(Boolean).sort(),
  };
}

/** Hourly average response time over the last 24 h, per site (24 points). */
async function getSparklines(siteIds: Types.ObjectId[]): Promise<Map<string, (number | null)[]>> {
  const out = new Map<string, (number | null)[]>();
  if (!siteIds.length) return out;
  const since = new Date(Date.now() - 24 * 3600_000);
  const startHour = Math.floor(since.getTime() / 3600_000);
  const rows = await CheckResult.aggregate<{ _id: { site: Types.ObjectId; hour: Date }; avg: number }>([
    { $match: { "meta.siteId": { $in: siteIds }, "meta.checkType": "uptime", checkedAt: { $gte: since }, "metrics.responseTimeMs": { $ne: null } } },
    {
      $group: {
        _id: { site: "$meta.siteId", hour: { $dateTrunc: { date: "$checkedAt", unit: "hour" } } },
        avg: { $avg: "$metrics.responseTimeMs" },
      },
    },
  ]);
  for (const r of rows) {
    const key = String(r._id.site);
    const arr = out.get(key) ?? Array<number | null>(25).fill(null);
    const idx = Math.floor(r._id.hour.getTime() / 3600_000) - startHour;
    if (idx >= 0 && idx < arr.length) arr[idx] = Math.round(r.avg);
    out.set(key, arr);
  }
  return out;
}

// ─── Detail ───────────────────────────────────────────────────────────

export async function getSite(id: string): Promise<SiteLean | null> {
  if (!mongoose.isValidObjectId(id)) return null;
  await db();
  return Site.findById(id).lean();
}

export interface ResultRow {
  id: string;
  checkedAt: string;
  status: CheckStatus;
  reason: CheckReason;
  message: string;
  attempt: number;
  durationMs: number | null;
  metrics: Record<string, unknown>;
  details: Record<string, unknown> | null;
}

function toRow(r: {
  _id: unknown;
  checkedAt: Date;
  status: CheckStatus;
  reason?: CheckReason | null;
  message?: string | null;
  attempt?: number | null;
  durationMs?: number | null;
  metrics?: unknown;
  details?: unknown;
}): ResultRow {
  return {
    id: String(r._id),
    checkedAt: r.checkedAt.toISOString(),
    status: r.status,
    reason: r.reason ?? "ok",
    message: r.message ?? "",
    attempt: r.attempt ?? 0,
    durationMs: r.durationMs ?? null,
    // Round-trip through JSON: strips ObjectIds/Dates for client components.
    metrics: JSON.parse(JSON.stringify(r.metrics ?? {})),
    details: r.details ? JSON.parse(JSON.stringify(r.details)) : null,
  };
}

export async function getRecentResults(siteId: Types.ObjectId, type: CheckType, limit = 20): Promise<ResultRow[]> {
  const rows = await CheckResult.find({ "meta.siteId": siteId, "meta.checkType": type }).sort({ checkedAt: -1 }).limit(limit).lean();
  return rows.map(toRow);
}

export async function getLatestResultAfter(siteId: Types.ObjectId, type: CheckType, after: Date): Promise<ResultRow | null> {
  const r = await CheckResult.findOne({ "meta.siteId": siteId, "meta.checkType": type, checkedAt: { $gte: after } })
    .sort({ checkedAt: -1 })
    .lean();
  return r ? toRow(r) : null;
}

/**
 * Uptime % over windows. Confirmation re-checks (attempt > 0) are excluded so a
 * single blip isn't counted three times; BLOCKED/slow count as up.
 */
export async function getUptimeStats(siteId: Types.ObjectId): Promise<{ h24: number | null; d7: number | null; d30: number | null; avgMs24: number | null }> {
  const now = Date.now();
  const [r] = await CheckResult.aggregate<{
    t24: number; u24: number; t7: number; u7: number; t30: number; u30: number; avg24: number | null;
  }>([
    { $match: { "meta.siteId": siteId, "meta.checkType": "uptime", attempt: { $in: [0, null] }, status: { $ne: "UNKNOWN" }, checkedAt: { $gte: new Date(now - 30 * 86400_000) } } },
    {
      $project: {
        up: { $cond: [{ $eq: ["$status", "FAIL"] }, 0, 1] },
        in24: { $gte: ["$checkedAt", new Date(now - 86400_000)] },
        in7: { $gte: ["$checkedAt", new Date(now - 7 * 86400_000)] },
        rt: "$metrics.responseTimeMs",
      },
    },
    {
      $group: {
        _id: null,
        t30: { $sum: 1 },
        u30: { $sum: "$up" },
        t7: { $sum: { $cond: ["$in7", 1, 0] } },
        u7: { $sum: { $cond: ["$in7", "$up", 0] } },
        t24: { $sum: { $cond: ["$in24", 1, 0] } },
        u24: { $sum: { $cond: ["$in24", "$up", 0] } },
        avg24: { $avg: { $cond: ["$in24", "$rt", null] } },
      },
    },
  ]);
  const pct = (u?: number, t?: number) => (t ? (u! / t) * 100 : null);
  return { h24: pct(r?.u24, r?.t24), d7: pct(r?.u7, r?.t7), d30: pct(r?.u30, r?.t30), avgMs24: r?.avg24 != null ? Math.round(r.avg24) : null };
}

export interface ChartPoint {
  t: number;
  ms: number | null;
  fail: number;
}

/** Response-time series: raw points for 24 h, hourly averages for 7 d. */
export async function getResponseSeries(siteId: Types.ObjectId, range: "24h" | "7d"): Promise<ChartPoint[]> {
  const since = new Date(Date.now() - (range === "24h" ? 86400_000 : 7 * 86400_000));
  const rows = await CheckResult.aggregate<{ _id: Date; ms: number | null; fail: number }>([
    { $match: { "meta.siteId": siteId, "meta.checkType": "uptime", checkedAt: { $gte: since } } },
    {
      $group: {
        _id: range === "24h" ? { $dateTrunc: { date: "$checkedAt", unit: "minute", binSize: 5 } } : { $dateTrunc: { date: "$checkedAt", unit: "hour" } },
        ms: { $avg: "$metrics.responseTimeMs" },
        fail: { $sum: { $cond: [{ $eq: ["$status", "FAIL"] }, 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  return rows.map((r) => ({ t: r._id.getTime(), ms: r.ms != null ? Math.round(r.ms) : null, fail: r.fail }));
}

export interface DayStatus {
  day: string;
  total: number;
  down: number;
  warn: number;
}

/**
 * Per-day status for the status bar. Completed hours come from the hourly
 * rollups (kept 1 year), the current hour from raw results — so 90 days work
 * even though raw results expire after 30.
 */
export async function getDailyStatus(siteId: Types.ObjectId, days = 90, tz = process.env.TIMEZONE ?? "Asia/Kolkata"): Promise<DayStatus[]> {
  const since = new Date(Date.now() - days * 86400_000);
  const hourStart = new Date(Math.floor(Date.now() / 3600_000) * 3600_000);
  const dayOf = (field: string) => ({ $dateToString: { date: field, format: "%Y-%m-%d", timezone: tz } });
  const [rolled, live] = await Promise.all([
    UptimeHourly.aggregate<{ _id: string; total: number; down: number; warn: number }>([
      { $match: { siteId, hour: { $gte: since, $lt: hourStart } } },
      { $group: { _id: dayOf("$hour"), total: { $sum: "$total" }, down: { $sum: "$down" }, warn: { $sum: { $ifNull: ["$warn", 0] } } } },
    ]),
    CheckResult.aggregate<{ _id: string; total: number; down: number; warn: number }>([
      { $match: { "meta.siteId": siteId, "meta.checkType": "uptime", checkedAt: { $gte: hourStart }, attempt: { $in: [0, null] }, status: { $ne: "UNKNOWN" } } },
      {
        $group: {
          _id: dayOf("$checkedAt"),
          total: { $sum: 1 },
          down: { $sum: { $cond: [{ $eq: ["$status", "FAIL"] }, 1, 0] } },
          warn: { $sum: { $cond: [{ $eq: ["$status", "WARN"] }, 1, 0] } },
        },
      },
    ]),
  ]);
  const byDay = new Map<string, { total: number; down: number; warn: number }>();
  for (const r of [...rolled, ...live]) {
    const cur = byDay.get(r._id) ?? { total: 0, down: 0, warn: 0 };
    byDay.set(r._id, { total: cur.total + r.total, down: cur.down + r.down, warn: cur.warn + r.warn });
  }
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const out: DayStatus[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = fmt.format(new Date(Date.now() - i * 86400_000));
    const r = byDay.get(day);
    out.push({ day, total: r?.total ?? 0, down: r?.down ?? 0, warn: r?.warn ?? 0 });
  }
  return out;
}

/** Uptime % over 90 days from the hourly rollups (null = no data yet). */
export async function getUptime90d(siteId: Types.ObjectId): Promise<number | null> {
  const [r] = await UptimeHourly.aggregate<{ total: number; up: number }>([
    { $match: { siteId, hour: { $gte: new Date(Date.now() - 90 * 86400_000) } } },
    { $group: { _id: null, total: { $sum: "$total" }, up: { $sum: "$up" } } },
  ]);
  return r?.total ? (r.up / r.total) * 100 : null;
}

export async function getJobs(siteId: Types.ObjectId) {
  const jobs = await JobState.find({ siteId }, { checkType: 1, enabled: 1, intervalSec: 1, nextRunAt: 1, lastRunAt: 1, consecutiveFails: 1, retryAttempt: 1 }).lean();
  return new Map(jobs.map((j) => [j.checkType as CheckType, j]));
}

/** Active + upcoming windows, then the last few past ones. */
export async function getMaintenanceWindows(siteId: Types.ObjectId) {
  const now = new Date();
  const [upcoming, past] = await Promise.all([
    MaintenanceWindow.find({ siteId, endsAt: { $gte: now } }).sort({ startsAt: 1 }).lean(),
    MaintenanceWindow.find({ siteId, endsAt: { $lt: now } }).sort({ endsAt: -1 }).limit(3).lean(),
  ]);
  return [...upcoming, ...past].map((w) => ({
    id: String(w._id),
    startsAt: w.startsAt.toISOString(),
    endsAt: w.endsAt.toISOString(),
    reason: w.reason ?? "",
    createdBy: w.createdBy ?? null,
    state: (w.endsAt < now ? "past" : w.startsAt <= now ? "active" : "scheduled") as "past" | "active" | "scheduled",
  }));
}
