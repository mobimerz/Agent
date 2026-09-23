import type { CheckSummary, LatestChecks } from "./check";
import type { SiteHealth, SiteStatus } from "./enums";

/**
 * Aggregate site health from the latest per-check summaries.
 * - down:     uptime FAIL confirmed by re-checks (`uptimeDown`)
 * - degraded: any check WARN/FAIL (incl. an unconfirmed uptime FAIL being re-checked)
 * - up:       uptime OK/WARN-free
 * - unknown:  no uptime result yet
 */
export function computeHealth(checks: LatestChecks, uptimeDown: boolean): SiteHealth {
  if (uptimeDown) return "down";
  const uptime = checks.uptime;
  if (!uptime) return "unknown";
  const all = Object.values(checks).filter((c): c is CheckSummary => Boolean(c));
  if (all.some((c) => c.status === "FAIL" || c.status === "WARN")) return "degraded";
  return "up";
}

/** What the status badge shows. Adds "paused" and "blocked" on top of health. */
export type DisplayStatus = SiteHealth | "paused" | "blocked" | "checking";

export function displayStatus(site: {
  status: SiteStatus;
  current?: { health?: SiteHealth | null; checks?: LatestChecks | Map<string, CheckSummary> | null } | null;
}): DisplayStatus {
  if (site.status === "paused") return "paused";
  const health = site.current?.health ?? "unknown";
  const checks = site.current?.checks;
  const uptime = checks instanceof Map ? checks.get("uptime") : checks?.uptime;
  if (health === "down") return "down";
  if (uptime?.reason === "blocked") return "blocked";
  if (uptime?.status === "FAIL") return "checking"; // failing, confirmation re-checks in progress
  return health;
}

/** Sort rank: problems first. */
export const DISPLAY_STATUS_RANK: Record<DisplayStatus, number> = {
  down: 0,
  checking: 1,
  degraded: 2,
  blocked: 3,
  unknown: 4,
  up: 5,
  paused: 6,
};
