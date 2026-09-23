import { ACTIVE_CHECK_TYPES, CHECK_TYPES, type CheckType } from "@siteguard/core";
import { CheckResult } from "./models/check-result";
import { Incident } from "./models/incident";
import { JobState, jobKeys } from "./models/job-state";
import { MaintenanceWindow } from "./models/maintenance-window";
import { getSettings, type SettingsDoc } from "./models/settings";
import { Site, type SiteLean } from "./models/site";
import { UptimeHourly } from "./models/uptime-hourly";

type SiteForJobs = Pick<SiteLean, "_id" | "status" | "checks">;

/** Site override → global setting → built-in default. */
export function effectiveInterval(site: SiteForJobs, type: CheckType, settings: SettingsDoc): number {
  const override = site.checks?.[type]?.intervalSec;
  return override ?? settings.intervals?.[type] ?? 300;
}

export function isCheckEnabled(site: SiteForJobs, type: CheckType): boolean {
  return site.status === "active" && ACTIVE_CHECK_TYPES.includes(type) && (site.checks?.[type]?.enabled ?? true);
}

/** Spread first runs over this window so a bulk import doesn't fire everything at once. */
const FIRST_RUN_SPREAD_MS = 30_000;

/**
 * Make `jobsState` match the site's config: one job per check type, enabled or
 * not. Called by the web app on create/update/pause and by the worker's
 * periodic reconcile. Idempotent.
 */
export async function syncSiteJobs(site: SiteForJobs, settings?: SettingsDoc): Promise<void> {
  const s = settings ?? (await getSettings());
  const now = Date.now();
  const siteId = site._id;

  await Promise.all(
    CHECK_TYPES.map(async (type) => {
      const key = jobKeys.check(String(siteId), type);
      const enabled = isCheckEnabled(site, type);
      const intervalSec = effectiveInterval(site, type, s);
      const existing = await JobState.findOne({ key }, { intervalSec: 1, enabled: 1, nextRunAt: 1 }).lean();

      if (!existing) {
        if (!enabled) return; // don't create rows for disabled checks
        await JobState.updateOne(
          { key },
          {
            $setOnInsert: {
              key,
              kind: "check",
              siteId,
              checkType: type,
              nextRunAt: new Date(now + Math.floor(Math.random() * FIRST_RUN_SPREAD_MS)),
            },
            $set: { enabled, intervalSec },
          },
          { upsert: true },
        );
        return;
      }

      const set: Record<string, unknown> = { enabled, intervalSec };
      // Re-enabled, or interval shortened: don't wait for the old (later) slot.
      const latest = new Date(now + intervalSec * 1000);
      if ((enabled && !existing.enabled) || (existing.nextRunAt && existing.nextRunAt > latest)) {
        set.nextRunAt = enabled && !existing.enabled ? new Date(now) : latest;
      }
      if (!enabled) set.consecutiveFails = 0;
      await JobState.updateOne({ key }, { $set: set });
    }),
  );
}

/** Remove a site and everything that belongs to it. */
export async function deleteSiteCascade(siteId: SiteLean["_id"]): Promise<void> {
  await Promise.all([
    JobState.deleteMany({ siteId }),
    CheckResult.deleteMany({ "meta.siteId": siteId }),
    UptimeHourly.deleteMany({ siteId }),
    Incident.deleteMany({ siteId }),
    MaintenanceWindow.deleteMany({ siteId }),
  ]);
  await Site.deleteOne({ _id: siteId });
}

/** Ask the worker to run a check as soon as possible. Returns false if the check isn't scheduled. */
export async function requestRunNow(siteId: SiteLean["_id"], type: CheckType): Promise<Date | null> {
  const now = new Date();
  const res = await JobState.updateOne(
    { key: jobKeys.check(String(siteId), type), enabled: true },
    { $set: { nextRunAt: now, manualRequestedAt: now } },
  );
  return res.matchedCount ? now : null;
}
