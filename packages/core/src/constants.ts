import type { CheckType } from "./enums";

export const APP_NAME = "SiteGuard";
export const USER_AGENT = "SiteGuard-Monitor/1.0";
export const DEFAULT_TIMEZONE = "Asia/Kolkata";

const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Default run interval per check, in seconds. Overridable globally (settings) and per site. */
export const DEFAULT_INTERVALS: Record<CheckType, number> = {
  uptime: 5 * MIN,
  content: 30 * MIN,
  ssl: DAY,
  domain: DAY,
  dns: DAY,
  pagespeed: 12 * HOUR,
  seo: DAY,
  links: 7 * DAY,
  form: DAY,
  browser: DAY,
  headers: 7 * DAY,
};

/** Lowest interval a user may configure per check (protects the small VM and the PSI quota). */
export const MIN_INTERVALS: Record<CheckType, number> = {
  uptime: MIN,
  content: 5 * MIN,
  ssl: HOUR,
  domain: 6 * HOUR,
  dns: HOUR,
  pagespeed: 6 * HOUR,
  seo: HOUR,
  links: DAY,
  form: HOUR,
  browser: HOUR,
  headers: DAY,
};

/**
 * Checks the worker can run today. Grows per build phase; jobs for other
 * types are kept disabled until their module exists.
 */
export const ACTIVE_CHECK_TYPES: readonly CheckType[] = ["uptime", "content"];

/** Phase in which a not-yet-active check type ships (for UI hints). */
export const CHECK_PHASE: Partial<Record<CheckType, number>> = {
  ssl: 4,
  domain: 4,
  dns: 4,
  pagespeed: 4,
  seo: 4,
  links: 5,
  form: 5,
  browser: 5,
  headers: 5,
};

/**
 * High-signal defacement / SEO-spam phrases (matched case-insensitively on
 * visible text). Kept deliberately specific to avoid false positives; sites
 * can add their own via `content.extraSpamWords`.
 */
export const DEFAULT_SPAM_WORDS = [
  "hacked by",
  "h4ck3d",
  "defaced by",
  "owned by hacker",
  "viagra",
  "cialis",
  "online casino",
  "casino online",
  "slot gacor",
  "judi online",
  "situs judi",
  "togel online",
  "replica watches",
  "payday loan",
  "buy cheap pills",
];

export const CHECK_LABELS: Record<CheckType, string> = {
  uptime: "Uptime / HTTP",
  content: "Content / Defacement",
  ssl: "SSL Certificate",
  domain: "Domain Expiry",
  dns: "DNS",
  pagespeed: "PageSpeed",
  seo: "On-page SEO",
  links: "Broken Links",
  form: "Contact Form",
  browser: "Browser Health",
  headers: "Security Headers",
};

export const DEFAULT_THRESHOLDS = {
  responseTimeWarnMs: 3000,
  minPerformance: 50,
  minSeo: 80,
  minAccessibility: 70,
  minBestPractices: 70,
  /** Alert when a score drops more than this vs the 7-day average. */
  scoreDropPoints: 10,
  sslWarnDays: 30,
  sslFailDays: 7,
  domainWarnDays: 30,
  domainFailDays: 7,
  /** Flag drastic page-size change (fraction, 0.5 = ±50%). */
  pageSizeChangeRatio: 0.5,
} as const;
export type Thresholds = { -readonly [K in keyof typeof DEFAULT_THRESHOLDS]: number };

export const DEFAULTS = {
  httpTimeoutMs: 30_000,
  /** FAIL → recheck this many more times before opening an incident. */
  confirmRetries: 2,
  confirmRetryDelaySec: 60,
  reminderAfterMin: 120,
  /** ≥ N new incidents within the window → one grouped email. */
  groupThreshold: 5,
  groupWindowMin: 10,
  linksMaxPages: 50,
  screenshotsKeep: 7,
  reportMorning: "09:00",
  reportNight: "21:00",
  emailDailyLimit: 250,
  emailReservedForReports: 10,
  /** Above this many alert emails in a day, switch to digest mode. */
  emailDigestAfter: 200,
  /** Resolve an incident only after this many consecutive OK results (anti-flapping). */
  resolveAfterOks: 2,
  /** WARN results in a row before a WARNING incident opens (slow, blocked…). */
  warnConfirmRuns: 2,
  /** ≥ N open/resolve transitions within the window → one "unstable" alert, then silence. */
  flapThreshold: 4,
  flapWindowMin: 30,
  /** An unstable site is "stable again" after this long without transitions. */
  stableAfterMin: 30,
  /** Web app alerts when the worker heartbeat is older than this. */
  watchdogStaleMin: 15,
  /** In digest mode (quota nearly used), batch alert emails at most this often. */
  digestIntervalMin: 60,
} as const;

export const RETENTION = {
  checkResultsDays: 30,
  uptimeHourlyDays: 365,
  notificationsDays: 90,
  emailLogDays: 30,
  inviteDays: 7,
} as const;

export const SECONDS_PER_DAY = DAY;
