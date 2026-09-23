import type { CheckType } from "@siteguard/core";
import type { SiteLean } from "@siteguard/db";
import type { CheckRunResult } from "../checks/types";
import type { Logger } from "../logger";

export interface CheckEvent {
  site: SiteLean;
  checkType: CheckType;
  outcome: CheckRunResult;
  /** Consecutive FAILs before / after this run. */
  prevFails: number;
  fails: number;
  /** FAIL confirmed by re-checks (fails > confirmRetries) after this run / before it. */
  confirmed: boolean;
  wasConfirmed: boolean;
  /** 0 = scheduled run, 1..n = confirmation re-check. */
  attempt: number;
  log: Logger;
}

/**
 * Single integration point for the incident engine.
 * Phase 2: logs what WOULD happen. Phase 3 replaces the body with
 * open / resolve / remind + email, Telegram and in-app notifications.
 */
export async function onCheckResult(e: CheckEvent): Promise<void> {
  const ctx = { site: e.site.name, check: e.checkType, reason: e.outcome.reason };
  if (e.confirmed && !e.wasConfirmed) {
    e.log.warn({ ...ctx, fails: e.fails }, `[incident] would OPEN: ${e.outcome.message}`);
  } else if (e.wasConfirmed && e.outcome.status !== "FAIL" && e.outcome.status !== "UNKNOWN") {
    e.log.info(ctx, "[incident] would RESOLVE");
  } else if (e.outcome.status === "FAIL" && !e.confirmed) {
    e.log.info({ ...ctx, attempt: e.fails }, "FAIL — scheduling confirmation re-check");
  }
}
