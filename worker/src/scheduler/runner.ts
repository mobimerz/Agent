import { DEFAULT_THRESHOLDS, type CheckSummary, type CheckType, type Thresholds } from "@siteguard/core";
import { CheckResult, isCheckEnabled, JobState, Site, type JobStateLean, type SettingsDoc, type SiteLean } from "@siteguard/db";
import type { NotifyConfig } from "@siteguard/notify";
import { CHECKS } from "../checks";
import type { CheckRunResult } from "../checks/types";
import { onCheckResult } from "../incidents/hook";
import type { Logger } from "../logger";
import { WORKER_ID } from "../worker-id";

export function mergeThresholds(settings: SettingsDoc, site: Pick<SiteLean, "thresholds">): Thresholds {
  const out: Thresholds = { ...DEFAULT_THRESHOLDS, ...(settings.thresholds as Partial<Thresholds>) };
  for (const [k, v] of Object.entries(site.thresholds ?? {})) {
    if (typeof v === "number" && Number.isFinite(v)) out[k as keyof Thresholds] = v;
  }
  return out;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`check exceeded ${Math.round(ms / 1000)} s`)), ms);
    }),
  ]);
}

/** ±5% jitter (max 30 s) so sites added together don't stay in lock-step. */
function jitterMs(intervalSec: number): number {
  const span = Math.min(intervalSec * 50, 30_000);
  return Math.round((Math.random() * 2 - 1) * span);
}

/**
 * Write this check's summary into `site.current` and recompute `health` from
 * ALL latest check summaries — atomically, in one pipeline update, so two
 * checks of the same site finishing together can't overwrite each other's view.
 * (Mirrors computeHealth() in @siteguard/core.)
 */
async function updateSiteCurrent(site: SiteLean, type: CheckType, outcome: CheckRunResult, checkedAt: Date, confirmed: boolean) {
  const summary: CheckSummary = { status: outcome.status, reason: outcome.reason, message: outcome.message, checkedAt };
  const set: Record<string, unknown> = {
    // $literal: messages may contain "$…" which a pipeline would treat as a field path.
    [`current.checks.${type}`]: { $literal: summary },
    "current.lastCheckedAt": checkedAt,
  };
  if (type === "uptime") {
    const wasDown = site.current?.uptimeDown ?? false;
    if (outcome.status !== "UNKNOWN") set["current.uptimeDown"] = outcome.status === "FAIL" && (confirmed || wasDown);
    set["current.statusCode"] = { $literal: outcome.metrics.statusCode ?? null };
    set["current.responseTimeMs"] = { $literal: outcome.metrics.responseTimeMs ?? null };
    set["current.finalUrl"] = { $literal: (outcome.details?.finalUrl as string | undefined) ?? null };
  }
  // Headline numbers for the overview (UNKNOWN keeps the last known value).
  if (outcome.status !== "UNKNOWN") {
    const m = outcome.metrics as Record<string, unknown>;
    const n = (v: unknown) => ({ $literal: typeof v === "number" ? v : null });
    if (type === "pagespeed") {
      set["current.perfMobile"] = n(m.perfMobile);
      set["current.perfDesktop"] = n(m.perfDesktop);
      set["current.seoScore"] = n(m.seoMobile);
    }
    if (type === "ssl") set["current.sslDaysLeft"] = n(m.daysLeft);
    if (type === "domain") set["current.domainDaysLeft"] = n(m.daysLeft);
  }

  const statuses = { $map: { input: { $objectToArray: { $ifNull: ["$current.checks", {}] } }, in: "$$this.v.status" } };
  await Site.collection.updateOne({ _id: site._id }, [
    { $set: set },
    {
      $set: {
        "current.health": {
          $switch: {
            branches: [
              { case: { $eq: ["$current.uptimeDown", true] }, then: "down" },
              { case: { $eq: [{ $type: "$current.checks.uptime" }, "missing"] }, then: "unknown" },
              { case: { $gt: [{ $size: { $setIntersection: [statuses, ["FAIL", "WARN"]] } }, 0] }, then: "degraded" },
            ],
            default: "up",
          },
        },
      },
    },
  ]);
}

/**
 * A run without a verdict (e.g. PSI rate limited): keep it in history, schedule
 * the retry, but leave site.current, streaks and incidents exactly as they were.
 */
async function recordSkipped(job: JobStateLean, siteId: SiteLean["_id"], type: CheckType, outcome: CheckRunResult, startedAt: Date, finishedAt: Date, log: Logger): Promise<CheckRunResult> {
  const intervalSec = job.intervalSec ?? 300;
  const delaySec = outcome.nextRunInSec ?? intervalSec;
  await CheckResult.create({
    checkedAt: startedAt,
    meta: { siteId, checkType: type },
    status: outcome.status,
    reason: outcome.reason,
    message: outcome.message,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    attempt: 0,
    skipped: true,
    metrics: outcome.metrics,
    details: outcome.details,
  });
  await JobState.updateOne(
    { _id: job._id, lockedBy: WORKER_ID },
    {
      $set: {
        lastRunAt: startedAt,
        lastFinishedAt: finishedAt,
        lastDurationMs: finishedAt.getTime() - startedAt.getTime(),
        lastError: outcome.message,
        nextRunAt: new Date(finishedAt.getTime() + delaySec * 1000),
        lockedUntil: new Date(0),
        lockedBy: null,
        ...(outcome.jobData ? { data: outcome.jobData } : {}),
      },
      $inc: { runCount: 1 },
    },
  );
  log.info({ reason: outcome.reason, retryInSec: delaySec }, outcome.message);
  return outcome;
}

export interface RunDeps {
  settings: SettingsDoc;
  config: NotifyConfig;
  log: Logger;
}

/**
 * Execute one claimed job end to end: run the check, store the result,
 * update the site's denormalized `current`, apply the FAIL-confirmation
 * schedule, release the lock and notify the incident hook. Never throws.
 */
export async function runCheckJob(job: JobStateLean, { settings, config, log }: RunDeps): Promise<CheckRunResult | null> {
  const type = job.checkType as CheckType;
  const module = CHECKS[type];
  const startedAt = new Date();
  const jobLog = log.child({ job: job.key });

  try {
    const site = job.siteId ? await Site.findById(job.siteId).lean() : null;
    if (!site || !module || !isCheckEnabled(site, type)) {
      await JobState.updateOne({ _id: job._id }, { $set: { enabled: false, lockedUntil: new Date(0), lockedBy: null } });
      jobLog.info("job disabled (site removed, paused or check off)");
      return null;
    }

    let outcome: CheckRunResult;
    try {
      outcome = await withTimeout(
        module.run(site, {
          settings,
          thresholds: mergeThresholds(settings, site),
          jobData: (job.data as Record<string, unknown>) ?? {},
          log: jobLog,
        }),
        module.maxRunMs,
      );
    } catch (err) {
      jobLog.error({ err }, "check crashed");
      outcome = { status: "UNKNOWN", reason: "network", message: `Check error: ${(err as Error).message}`, metrics: {} };
    }

    const finishedAt = new Date();
    if (outcome.skipped) return await recordSkipped(job, site._id, type, outcome, startedAt, finishedAt, jobLog);

    const retries = settings.alerts?.confirmRetries ?? 2;
    const retryDelaySec = settings.alerts?.confirmRetryDelaySec ?? 60;
    const prevFails = job.consecutiveFails ?? 0;
    // UNKNOWN (couldn't decide) neither confirms nor clears a failure streak.
    const fails = outcome.status === "FAIL" ? prevFails + 1 : outcome.status === "UNKNOWN" ? prevFails : 0;
    const confirmed = fails > retries;
    // Streaks for WARNING incidents and anti-flap resolution. UNKNOWN keeps them unchanged.
    const s = outcome.status;
    const prevOks = job.consecutiveOks ?? 0;
    const oks = s === "OK" ? prevOks + 1 : s === "UNKNOWN" ? prevOks : 0;
    const warns = s === "WARN" ? (job.consecutiveWarns ?? 0) + 1 : s === "UNKNOWN" ? (job.consecutiveWarns ?? 0) : 0;
    const problemSince = s === "FAIL" || s === "WARN" ? (job.problemSince ?? startedAt) : s === "OK" ? null : (job.problemSince ?? null);
    const okSince = s === "OK" ? (prevOks === 0 ? startedAt : (job.okSince ?? startedAt)) : s === "UNKNOWN" ? (job.okSince ?? null) : null;
    const inRetry = outcome.status === "FAIL" && !confirmed;
    const intervalSec = job.intervalSec ?? 300;
    const nextRunAt = inRetry
      ? new Date(finishedAt.getTime() + retryDelaySec * 1000)
      : outcome.nextRunInSec
        ? new Date(finishedAt.getTime() + outcome.nextRunInSec * 1000)
        : new Date(finishedAt.getTime() + intervalSec * 1000 + jitterMs(intervalSec));
    const attempt = job.retryAttempt ?? 0;

    await CheckResult.create({
      checkedAt: startedAt,
      meta: { siteId: site._id, checkType: type },
      status: outcome.status,
      reason: outcome.reason,
      message: outcome.message,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      target: outcome.target,
      attempt,
      metrics: outcome.metrics,
      details: outcome.details,
    });

    await updateSiteCurrent(site, type, outcome, startedAt, confirmed);

    await JobState.updateOne(
      { _id: job._id, lockedBy: WORKER_ID },
      {
        $set: {
          lastRunAt: startedAt,
          lastFinishedAt: finishedAt,
          lastDurationMs: finishedAt.getTime() - startedAt.getTime(),
          lastStatus: outcome.status,
          lastError: outcome.status === "OK" ? null : outcome.message,
          consecutiveFails: fails,
          consecutiveOks: oks,
          consecutiveWarns: warns,
          problemSince,
          okSince,
          retryAttempt: inRetry ? fails : 0,
          nextRunAt,
          lockedUntil: new Date(0),
          lockedBy: null,
          ...(outcome.jobData ? { data: outcome.jobData } : {}),
        },
        $inc: { runCount: 1 },
      },
    );
    // "Run check now" pressed while this run was in flight → run again right away.
    await JobState.updateOne({ _id: job._id, manualRequestedAt: { $gt: startedAt } }, { $set: { nextRunAt: new Date() } });

    jobLog.debug({ status: outcome.status, reason: outcome.reason, ms: finishedAt.getTime() - startedAt.getTime() }, outcome.message);

    await onCheckResult(
      { site, checkType: type, outcome, checkedAt: startedAt, fails, oks, warns, confirmed, problemSince, okSince },
      { settings, config, log: jobLog },
    ).catch((err: unknown) => jobLog.error({ err }, "incident engine failed"));
    return outcome;
  } catch (err) {
    jobLog.error({ err }, "job failed");
    // Release the lock and retry later; never leave a job stuck.
    await JobState.updateOne(
      { _id: job._id },
      { $set: { lockedUntil: new Date(0), lockedBy: null, lastError: (err as Error).message, nextRunAt: new Date(Date.now() + 60_000) } },
    ).catch(() => {});
    return null;
  }
}
