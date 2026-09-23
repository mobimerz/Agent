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
} as const;

export const RETENTION = {
  checkResultsDays: 30,
  uptimeHourlyDays: 365,
  notificationsDays: 90,
  emailLogDays: 30,
  inviteDays: 7,
} as const;

export const SECONDS_PER_DAY = DAY;
