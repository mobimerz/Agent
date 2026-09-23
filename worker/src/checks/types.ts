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
}

/** Every module in /worker/checks implements this. */
export interface CheckModule {
  type: CheckType;
  queue: QueueName;
  /** Hard cap for one run; the runner aborts and records FAIL/UNKNOWN beyond it. */
  maxRunMs: number;
  run(site: SiteLean, ctx: CheckContext): Promise<CheckRunResult>;
}
