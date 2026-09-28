import type { CheckOutcome, CheckType, Thresholds } from "@siteguard/core";
import type { SettingsDoc, SiteLean } from "@siteguard/db";
import type { Logger } from "../logger";

export type QueueName = "http" | "browser" | "psi";

export interface CheckContext {
  settings: SettingsDoc;
  /** Global thresholds merged with the site's overrides. */
  thresholds: Thresholds;
  /** Per-job memory from the previous run (e.g. page-size baseline). */
  jobData: Record<string, unknown>;
  log: Logger;
  /** Overrides for tests. */
  timeoutMs?: number;
}

export interface CheckRunResult extends CheckOutcome {
  /** Replaces jobState.data after the run (omit to keep it unchanged). */
  jobData?: Record<string, unknown>;
  /**
   * No verdict this time (e.g. PSI rate limited): the result is kept in history,
   * but `site.current`, streaks and incidents are left untouched. Use with UNKNOWN.
   */
  skipped?: boolean;
  /** Run again after this many seconds instead of the normal interval (e.g. rate-limit backoff). */
  nextRunInSec?: number;
}

/** Every module in /worker/checks implements this. */
export interface CheckModule {
  type: CheckType;
  queue: QueueName;
  /** Hard cap for one run; the runner aborts and records FAIL/UNKNOWN beyond it. */
  maxRunMs: number;
  /**
   * FAIL confirmation re-checks for this site (default: settings.alerts.confirmRetries).
   * 0 = a FAIL is confirmed at once — for checks with side effects (a form test
   * submission re-checked every 60 s would email the client again and again).
   */
  confirmRetries?(site: SiteLean): number | undefined;
  run(site: SiteLean, ctx: CheckContext): Promise<CheckRunResult>;
}
