export const CHECK_TYPES = [
  "uptime",
  "content",
  "ssl",
  "domain",
  "dns",
  "pagespeed",
  "seo",
  "links",
  "form",
  "browser",
  "headers",
] as const;
export type CheckType = (typeof CHECK_TYPES)[number];

/** UNKNOWN = the check could not decide (e.g. no RDAP/WHOIS data). Never alerts. */
export const CHECK_STATUSES = ["OK", "WARN", "FAIL", "UNKNOWN"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export const SEVERITIES = ["CRITICAL", "WARNING", "INFO"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const INCIDENT_STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** Whether the site is being monitored at all. */
export const SITE_STATUSES = ["active", "paused"] as const;
export type SiteStatus = (typeof SITE_STATUSES)[number];

/** Aggregated health shown on the dashboard. */
export const SITE_HEALTH = ["up", "degraded", "down", "unknown"] as const;
export type SiteHealth = (typeof SITE_HEALTH)[number];

export const ROLES = ["admin", "member"] as const;
export type Role = (typeof ROLES)[number];

export const NOTIFICATION_TYPES = [
  "incident_opened",
  "incident_escalated",
  "incident_updated",
  "incident_resolved",
  "incident_reminder",
  "site_unstable",
  "site_stable",
  "worker_offline",
  "worker_online",
  "report",
  "system",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const EMAIL_CATEGORIES = ["alert", "resolved", "reminder", "digest", "report", "invite", "test", "system"] as const;

/** Things that fan out to email / Telegram. */
export const ALERT_TYPES = ["opened", "escalated", "resolved", "reminder", "unstable", "stable", "worker_offline", "worker_online"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

/** Per-channel delivery state of an alert event. */
export const DELIVERY_STATES = ["pending", "sent", "preview", "grouped", "skipped", "suppressed", "failed", "none"] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

export const REPORT_KINDS = ["morning", "night"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const FRAMEWORKS = ["nextjs", "react", "wordpress", "html", "laravel", "shopify", "other"] as const;
export type Framework = (typeof FRAMEWORKS)[number];
