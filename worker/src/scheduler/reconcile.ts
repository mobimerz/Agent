import { JobState, Site, syncSiteJobs } from "@siteguard/db";
import type { Logger } from "../logger";
import { getSettingsCached } from "../settings-cache";

/**
 * Safety net: make jobsState match all sites (the web app already syncs on
 * every save) and drop jobs whose site no longer exists.
 */
export async function reconcileJobs(log: Logger): Promise<void> {
  const settings = await getSettingsCached();
  const sites = await Site.find({}, { status: 1, checks: 1 }).lean();
  for (const site of sites) await syncSiteJobs(site, settings);

  const ids = sites.map((s) => s._id);
  const orphans = await JobState.deleteMany({ kind: "check", siteId: { $nin: ids } });
  log.debug({ sites: sites.length, orphansRemoved: orphans.deletedCount }, "jobs reconciled");
}
