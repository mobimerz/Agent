import { CheckResult, JobState, jobKeys, UptimeHourly, type Types } from "@siteguard/db";

const HOUR = 3_600_000;
export const floorHour = (d: Date) => new Date(Math.floor(d.getTime() / HOUR) * HOUR);

interface HourRow {
  _id: { siteId: Types.ObjectId; hour: Date };
  total: number;
  down: number;
  warn: number;
  avg: number | null;
  p95: (number | null)[] | null;
  min: number | null;
  max: number | null;
}

/**
 * Roll uptime results in [from, to) into `uptimeHourly` (kept 1 year; raw
 * results expire after 30 days). Scheduled runs only — confirmation re-checks
 * would count one outage three times. Idempotent: re-running an hour overwrites it.
 */
export async function rollupUptime(from: Date, to: Date): Promise<number> {
  const rows = await CheckResult.aggregate<HourRow>([
    {
      $match: {
        "meta.checkType": "uptime",
        checkedAt: { $gte: floorHour(from), $lt: to },
        attempt: { $in: [0, null] },
        status: { $ne: "UNKNOWN" },
        skipped: { $ne: true },
      },
    },
    {
      $group: {
        _id: { siteId: "$meta.siteId", hour: { $dateTrunc: { date: "$checkedAt", unit: "hour" } } },
        total: { $sum: 1 },
        down: { $sum: { $cond: [{ $eq: ["$status", "FAIL"] }, 1, 0] } },
        warn: { $sum: { $cond: [{ $eq: ["$status", "WARN"] }, 1, 0] } },
        avg: { $avg: "$metrics.responseTimeMs" },
        p95: { $percentile: { input: "$metrics.responseTimeMs", p: [0.95], method: "approximate" } },
        min: { $min: "$metrics.responseTimeMs" },
        max: { $max: "$metrics.responseTimeMs" },
      },
    },
  ]);
  if (!rows.length) return 0;
  const round = (v: number | null | undefined) => (typeof v === "number" ? Math.round(v) : null);
  await UptimeHourly.bulkWrite(
    rows.map((r) => ({
      updateOne: {
        filter: { siteId: r._id.siteId, hour: r._id.hour },
        update: {
          $set: {
            total: r.total,
            up: r.total - r.down,
            down: r.down,
            warn: r.warn,
            avgResponseMs: round(r.avg),
            p95ResponseMs: round(r.p95?.[0]),
            minResponseMs: round(r.min),
            maxResponseMs: round(r.max),
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  return rows.length;
}

/**
 * Hourly job: re-roll the last few completed hours (late results, confirmation
 * re-checks landing after the hour). First run ever backfills everything still
 * in raw retention (30 days).
 */
export async function runRollup(now = new Date()): Promise<{ hours: number; backfilled: boolean }> {
  const key = jobKeys.global("rollup");
  const state = await JobState.findOne({ key }, { data: 1 }).lean();
  const backfilled = !(state?.data as { backfilledAt?: string } | undefined)?.backfilledAt;
  const to = floorHour(now);
  const from = backfilled ? new Date(to.getTime() - 31 * 24 * HOUR) : new Date(to.getTime() - 3 * HOUR);
  const hours = await rollupUptime(from, to);
  await JobState.updateOne(
    { key },
    {
      $set: { kind: "global", lastRunAt: now, lastFinishedAt: new Date(), lastStatus: "OK", ...(backfilled ? { "data.backfilledAt": now.toISOString() } : {}) },
      $inc: { runCount: 1 },
    },
    { upsert: true },
  );
  return { hours, backfilled };
}
