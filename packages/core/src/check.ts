import type { CheckStatus, CheckType } from "./enums";

/** What every check module in /worker/checks returns. */
export interface CheckOutcome<M extends Record<string, unknown> = Record<string, unknown>> {
  status: CheckStatus;
  /** Small numeric/string facts that are charted or compared (responseTimeMs, scores, daysLeft…). */
  metrics: M;
  /** One-line human summary, used in alerts. */
  message: string;
  /** Trimmed extra data for the UI (failed audits, broken links…). Never raw Lighthouse JSON. */
  details?: Record<string, unknown>;
  /** Specific URL the result is about, when not the homepage. */
  target?: string;
}

export interface CheckSummary {
  status: CheckStatus;
  message: string;
  checkedAt: Date;
}

export type LatestChecks = Partial<Record<CheckType, CheckSummary>>;
