import "server-only";
import type { CheckType } from "@siteguard/core";
import { CheckResult, JobState, jobKeys, type Types } from "@siteguard/db";
import type { ResultRow } from "./sites";

/** One PageSpeed run, flattened for charts (null = metric missing that run). */
export interface PsiPoint {
  t: number;
  perfMobile: number | null;
  perfDesktop: number | null;
  seoMobile: number | null;
  seoDesktop: number | null;
  lcpMobile: number | null;
  lcpDesktop: number | null;
  clsMobile: number | null;
  clsDesktop: number | null;
  tbtMobile: number | null;
  tbtDesktop: number | null;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Real (non-skipped) PageSpeed runs, oldest first. Raw results are kept 30 days. */
export async function getPsiHistory(siteId: Types.ObjectId, days = 30): Promise<PsiPoint[]> {
  const rows = await CheckResult.find(
    { "meta.siteId": siteId, "meta.checkType": "pagespeed", checkedAt: { $gte: new Date(Date.now() - days * 86400_000) }, status: { $ne: "UNKNOWN" }, skipped: { $ne: true } },
    { checkedAt: 1, metrics: 1 },
  )
    .sort({ checkedAt: 1 })
    .lean();
  return rows.map((r) => {
    const m = (r.metrics ?? {}) as Record<string, unknown>;
    const s = (v: unknown) => (num(v) == null ? null : Math.round((v as number) / 100) / 10); // ms → s, 1 decimal
    return {
      t: r.checkedAt.getTime(),
      perfMobile: num(m.perfMobile),
      perfDesktop: num(m.perfDesktop),
      seoMobile: num(m.seoMobile),
      seoDesktop: num(m.seoDesktop),
      lcpMobile: s(m.lcpMobileMs),
      lcpDesktop: s(m.lcpDesktopMs),
      clsMobile: num(m.clsMobile),
      clsDesktop: num(m.clsDesktop),
      tbtMobile: num(m.tbtMobileMs),
      tbtDesktop: num(m.tbtDesktopMs),
    };
  });
}

function toRow(r: { _id: unknown; checkedAt: Date; status: ResultRow["status"]; reason?: ResultRow["reason"] | null; message?: string | null; attempt?: number | null; durationMs?: number | null; metrics?: unknown; details?: unknown }): ResultRow {
  return {
    id: String(r._id),
    checkedAt: r.checkedAt.toISOString(),
    status: r.status,
    reason: r.reason ?? "ok",
    message: r.message ?? "",
    attempt: r.attempt ?? 0,
    durationMs: r.durationMs ?? null,
    metrics: JSON.parse(JSON.stringify(r.metrics ?? {})),
    details: r.details ? JSON.parse(JSON.stringify(r.details)) : null,
  };
}

/** Latest result that produced a verdict (skips "rate limited" runs), plus the latest skip if newer. */
export async function getLatestVerdict(siteId: Types.ObjectId, type: CheckType): Promise<{ result: ResultRow | null; skippedAfter: ResultRow | null }> {
  const [real, skipped] = await Promise.all([
    CheckResult.findOne({ "meta.siteId": siteId, "meta.checkType": type, skipped: { $ne: true } }).sort({ checkedAt: -1 }).lean(),
    CheckResult.findOne({ "meta.siteId": siteId, "meta.checkType": type, skipped: true }).sort({ checkedAt: -1 }).lean(),
  ]);
  return {
    result: real ? toRow(real) : null,
    skippedAfter: skipped && (!real || skipped.checkedAt > real.checkedAt) ? toRow(skipped) : null,
  };
}

/** Per-job memory the worker keeps (DNS baseline / observed records). */
export async function getJobData(siteId: Types.ObjectId, type: CheckType): Promise<Record<string, unknown> | null> {
  const job = await JobState.findOne({ key: jobKeys.check(String(siteId), type) }, { data: 1 }).lean();
  return job?.data ? JSON.parse(JSON.stringify(job.data)) : null;
}

