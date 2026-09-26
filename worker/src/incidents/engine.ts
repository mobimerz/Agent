import {
  CHECK_LABELS,
  DEFAULTS,
  PSI,
  SEO_CONFIRM_RUNS,
  formatDuration,
  type AlertData,
  type AlertType,
  type CheckType,
  type Severity,
} from "@siteguard/core";
import { CheckResult, Incident, MaintenanceWindow, Site, type IncidentLean, type SettingsDoc, type SiteLean } from "@siteguard/db";
import { createInAppNotification, incidentLink, queueAlert, siteLink, type NotifyConfig } from "@siteguard/notify";
import type { CheckRunResult } from "../checks/types";
import type { Logger } from "../logger";

// ─── Classification ──────────────────────────────────────────────────

export interface Problem {
  severity: Severity;
  title: string;
  email: boolean;
  telegram: boolean;
  reminders: boolean;
  /** Bypass email grouping/digest. */
  priority?: boolean;
  /** WARN runs in a row before opening (overrides settings.alerts.warnConfirmRuns for this check). */
  confirmRuns?: number;
}

const RANK: Record<Severity, number> = { INFO: 0, WARNING: 1, CRITICAL: 2 };

/** Which results are incident-worthy, and how loudly. null = healthy (or undecidable). */
export function classify(type: CheckType, o: Pick<CheckRunResult, "status" | "reason">): Problem | null {
  if (o.status === "OK" || o.status === "UNKNOWN") return null;
  const loud = { email: true, telegram: true, reminders: true };

  if (type === "uptime") {
    if (o.status === "FAIL") return { severity: "CRITICAL", title: "Site is down", ...loud };
    if (o.reason === "blocked") return { severity: "WARNING", title: "Monitoring blocked by bot protection", email: false, telegram: true, reminders: false };
    if (o.reason === "slow") return { severity: "WARNING", title: "Slow response", ...loud };
    if (o.reason === "page_error") return { severity: "WARNING", title: "Important page failing", ...loud };
    return { severity: "WARNING", title: "Uptime warning", ...loud };
  }
  if (type === "content") {
    if (o.reason === "spam_detected") return { severity: "CRITICAL", title: "Possible hacked site — spam/hack content found", ...loud, priority: true };
    if (o.reason === "keyword_missing") return { severity: "WARNING", title: "Required keyword missing", ...loud };
    if (o.reason === "size_changed") return { severity: "INFO", title: "Page size changed drastically", email: false, telegram: false, reminders: false };
  }
  // Loud but no 2-hourly reminders: these need a fix, not someone woken up again.
  const noRemind = { email: true, telegram: true, reminders: false };
  if (type === "ssl") {
    if (o.reason === "ssl_expired") return { severity: "CRITICAL", title: "SSL certificate expired", ...loud };
    if (o.reason === "ssl_hostname") return { severity: "CRITICAL", title: "SSL certificate hostname mismatch", ...loud };
    if (o.reason === "ssl_untrusted") return { severity: "CRITICAL", title: "Untrusted SSL certificate", ...loud };
    if (o.reason === "ssl_expiring") {
      return o.status === "FAIL"
        ? { severity: "CRITICAL", title: "SSL certificate expires within days", ...loud }
        : { severity: "WARNING", title: "SSL certificate expiring soon", ...noRemind };
    }
    if (o.reason === "ssl_chain") return { severity: "WARNING", title: "Incomplete SSL certificate chain", ...noRemind };
    if (o.reason === "no_https") return { severity: "WARNING", title: "HTTPS not available", ...noRemind };
  }
  if (type === "domain") {
    if (o.reason === "domain_expired") return { severity: "CRITICAL", title: "Domain expired", ...loud, priority: true };
    if (o.status === "FAIL") return { severity: "CRITICAL", title: "Domain expires within days", ...loud };
    return { severity: "WARNING", title: "Domain expiring soon", ...noRemind };
  }
  if (type === "dns" && o.reason === "dns_changed") {
    // A DNS change is a fact, not a flaky reading: alert on the first run.
    return { severity: "WARNING", title: "DNS records changed", ...noRemind, confirmRuns: 1 };
  }
  if (type === "pagespeed") {
    // The check already alerts on the median of the last 3 runs; plus 2 runs in a row here.
    const title = o.reason === "low_seo" ? "Lighthouse SEO score below threshold" : "PageSpeed performance below threshold";
    return { severity: "WARNING", title, ...noRemind, confirmRuns: PSI.confirmRuns };
  }
  if (type === "seo") {
    if (o.status === "FAIL") {
      const title = o.reason === "robots_blocked" ? "robots.txt blocks search engines" : o.reason === "canonical_mismatch" ? "Canonical URL points to another domain" : "Site hidden from Google (noindex)";
      return { severity: "WARNING", title, ...noRemind };
    }
    return { severity: "INFO", title: "On-page SEO issues", email: false, telegram: false, reminders: false, confirmRuns: SEO_CONFIRM_RUNS };
  }
  // Checks added in later phases fall back to: FAIL → WARNING, WARN → INFO (refined per check then).
  return o.status === "FAIL"
    ? { severity: "WARNING", title: `${CHECK_LABELS[type]} failing`, ...loud }
    : { severity: "INFO", title: `${CHECK_LABELS[type]} warning`, email: false, telegram: false, reminders: false };
}

// ─── Engine ──────────────────────────────────────────────────────────

export interface CheckEvent {
  site: SiteLean;
  checkType: CheckType;
  outcome: CheckRunResult;
  checkedAt: Date;
  /** Streak counters AFTER this run. */
  fails: number;
  oks: number;
  warns: number;
  /** FAIL confirmed by re-checks after this run. */
  confirmed: boolean;
  problemSince: Date | null;
  okSince: Date | null;
}

export interface EngineDeps {
  settings: SettingsDoc;
  config: NotifyConfig;
  log: Logger;
  now?: () => Date;
}

type Suppression = "maintenance" | "unstable" | null;

async function inMaintenance(siteId: SiteLean["_id"], at: Date): Promise<boolean> {
  return Boolean(await MaintenanceWindow.exists({ siteId, startsAt: { $lte: at }, endsAt: { $gte: at } }));
}

async function lastOkBefore(siteId: SiteLean["_id"], type: CheckType, before: Date): Promise<Date | null> {
  const r = await CheckResult.findOne({ "meta.siteId": siteId, "meta.checkType": type, status: "OK", checkedAt: { $lt: before } }, { checkedAt: 1 })
    .sort({ checkedAt: -1 })
    .lean();
  return r?.checkedAt ?? null;
}

async function refreshOpenCount(siteId: SiteLean["_id"]) {
  const n = await Incident.countDocuments({ siteId, isOpen: true });
  await Site.updateOne({ _id: siteId }, { $set: { "current.openIncidents": n } });
}

/**
 * Record an up/down transition. ≥ flapThreshold transitions in flapWindowMin →
 * the site becomes "unstable": ONE alert, then up/down alerts are suppressed
 * until it has been quiet for stableAfterMin (see checkStability()).
 */
export async function recordTransition(siteId: SiteLean["_id"], now: Date, settings: SettingsDoc): Promise<{ becameUnstable: boolean; unstable: boolean; count: number }> {
  const windowMs = (settings.alerts?.flapWindowMin ?? DEFAULTS.flapWindowMin) * 60_000;
  const threshold = settings.alerts?.flapThreshold ?? DEFAULTS.flapThreshold;
  const site = await Site.findById(siteId, { alerting: 1 }).lean();
  const recent = [...(site?.alerting?.transitions ?? []), now].filter((t) => now.getTime() - new Date(t as unknown as Date).getTime() <= windowMs);
  const wasUnstable = site?.alerting?.unstable ?? false;
  const unstable = wasUnstable || recent.length >= threshold;
  await Site.updateOne(
    { _id: siteId },
    { $set: { "alerting.transitions": recent, "alerting.unstable": unstable, ...(unstable && !wasUnstable ? { "alerting.unstableSince": now } : {}) } },
  );
  return { becameUnstable: unstable && !wasUnstable, unstable, count: recent.length };
}

function baseData(site: SiteLean, type: CheckType, config: NotifyConfig): Pick<AlertData, "siteName" | "clientName" | "siteUrl" | "checkType" | "checkLabel" | "link"> {
  return {
    siteName: site.name,
    clientName: site.clientName || undefined,
    siteUrl: site.url,
    checkType: type,
    checkLabel: CHECK_LABELS[type],
    link: siteLink(config, String(site._id)),
  };
}

function incidentData(type: AlertType, inc: Pick<IncidentLean, "_id" | "severity" | "title" | "message" | "reason" | "startedAt" | "lastOkAt" | "resolvedAt" | "durationSec">, site: SiteLean, checkType: CheckType, config: NotifyConfig): AlertData {
  return {
    ...baseData(site, checkType, config),
    type,
    severity: inc.severity,
    title: inc.title,
    reason: inc.reason ?? undefined,
    message: inc.message ?? "",
    startedAt: inc.startedAt.toISOString(),
    lastOkAt: inc.lastOkAt?.toISOString() ?? null,
    resolvedAt: inc.resolvedAt?.toISOString(),
    durationSec: inc.durationSec ?? undefined,
    incidentLink: incidentLink(config, String(inc._id)),
  };
}

async function sendUnstableAlert(site: SiteLean, count: number, deps: EngineDeps) {
  const windowMin = deps.settings.alerts?.flapWindowMin ?? DEFAULTS.flapWindowMin;
  const stableMin = deps.settings.alerts?.stableAfterMin ?? DEFAULTS.stableAfterMin;
  await queueAlert({
    data: {
      siteName: site.name,
      clientName: site.clientName || undefined,
      siteUrl: site.url,
      link: siteLink(deps.config, String(site._id)),
      type: "unstable",
      severity: "WARNING",
      title: "Site is unstable (flapping up/down)",
      message: `${count} up/down changes in the last ${windowMin} min. Further up/down alerts are paused until it has been stable for ${stableMin} min.`,
    },
    siteId: site._id,
    channels: { email: true, telegram: true, inApp: true },
  });
}

/**
 * Called after every check result. Opens / escalates / de-escalates / resolves
 * the incident for (site, checkType) and queues the matching alerts.
 */
export async function processCheckEvent(ev: CheckEvent, deps: EngineDeps): Promise<void> {
  const { site, checkType, outcome } = ev;
  const now = deps.now?.() ?? ev.checkedAt;
  const log = deps.log.child({ site: site.name, check: checkType });
  const problem = classify(checkType, outcome);
  const open = await Incident.findOne({ siteId: site._id, checkType, isOpen: true }).lean();
  const warnRuns = deps.settings.alerts?.warnConfirmRuns ?? DEFAULTS.warnConfirmRuns;
  const resolveAfter = deps.settings.alerts?.resolveAfterOks ?? DEFAULTS.resolveAfterOks;

  const qualifies = problem ? (outcome.status === "FAIL" ? ev.confirmed : ev.warns >= (problem.confirmRuns ?? warnRuns)) : false;

  // ── Healthy → maybe resolve
  if (!problem) {
    if (open && outcome.status === "OK" && ev.oks >= resolveAfter) await resolveIncident(open, ev, deps, now, log);
    return;
  }

  // ── Problem, no open incident → open once confirmed
  if (!open) {
    if (qualifies) await openIncident(problem, ev, deps, now, log);
    return;
  }

  // ── Problem, incident already open
  const up = RANK[problem.severity] > RANK[open.severity];
  const down = RANK[problem.severity] < RANK[open.severity];
  const policy = { email: problem.email, telegram: problem.telegram, reminders: problem.reminders };

  if (up) {
    // Escalation is urgent: don't wait for the WARN confirmation streak.
    const updated = await Incident.findOneAndUpdate(
      { _id: open._id, isOpen: true },
      {
        $set: { severity: problem.severity, title: problem.title, reason: outcome.reason, message: outcome.message, policy, lastMetrics: outcome.metrics },
        $push: { timeline: { at: now, type: "escalated", message: `${open.severity} → ${problem.severity}: ${outcome.message}` } },
      },
      { returnDocument: "after" },
    ).lean();
    if (updated && !updated.suppressed) {
      await queueAlert({
        data: incidentData("escalated", updated, site, checkType, deps.config),
        siteId: site._id,
        incidentId: updated._id,
        checkType,
        channels: { email: problem.email, telegram: problem.telegram, inApp: true },
        priority: problem.priority,
      });
    }
    log.warn({ from: open.severity, to: problem.severity }, "incident escalated");
    return;
  }

  if (down && qualifies) {
    // e.g. DOWN → now only slow/blocked: keep one incident, lower it quietly (in-app only).
    await Incident.updateOne(
      { _id: open._id, isOpen: true },
      {
        $set: { severity: problem.severity, title: problem.title, reason: outcome.reason, message: outcome.message, policy, lastMetrics: outcome.metrics },
        $push: { timeline: { at: now, type: "deescalated", message: `${open.severity} → ${problem.severity}: ${outcome.message}` } },
      },
    );
    await createInAppNotification({
      type: "incident_updated",
      severity: "INFO",
      title: `${site.name}: partially recovered — now ${problem.title.toLowerCase()}`,
      body: outcome.message,
      link: incidentLink(deps.config, String(open._id)),
      siteId: site._id,
      incidentId: open._id,
    });
    return;
  }

  // Same severity: keep the latest detail on the incident.
  await Incident.updateOne({ _id: open._id, isOpen: true }, { $set: { reason: outcome.reason, message: outcome.message, lastMetrics: outcome.metrics } });
}

async function openIncident(problem: Problem, ev: CheckEvent, deps: EngineDeps, now: Date, log: Logger) {
  const { site, checkType, outcome } = ev;
  const startedAt = ev.problemSince ?? ev.checkedAt;
  const lastOkAt = await lastOkBefore(site._id, checkType, startedAt);

  let suppressed: Suppression = (await inMaintenance(site._id, now)) ? "maintenance" : null;
  const flap = await recordTransition(site._id, now, deps.settings);
  if (!suppressed && flap.unstable) suppressed = "unstable";

  let incident: IncidentLean;
  try {
    incident = (
      await Incident.create({
        siteId: site._id,
        checkType,
        severity: problem.severity,
        title: problem.title,
        reason: outcome.reason,
        message: outcome.message,
        target: outcome.target,
        startedAt,
        lastOkAt,
        policy: { email: problem.email, telegram: problem.telegram, reminders: problem.reminders },
        suppressed,
        lastMetrics: outcome.metrics,
        timeline: [
          { at: startedAt, type: "opened", message: outcome.message },
          ...(suppressed ? [{ at: now, type: "suppressed", message: suppressed === "maintenance" ? "In maintenance window — no alerts sent" : "Site is flapping — alerts paused" }] : []),
        ],
      })
    ).toObject() as IncidentLean;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return; // another run opened it first
    throw err;
  }
  await refreshOpenCount(site._id);
  log.warn({ severity: problem.severity, suppressed }, `incident OPENED: ${problem.title} — ${outcome.message}`);

  if (flap.becameUnstable && suppressed === "unstable") await sendUnstableAlert(site, flap.count, deps);

  await queueAlert({
    data: incidentData("opened", incident, site, checkType, deps.config),
    siteId: site._id,
    incidentId: incident._id,
    checkType,
    channels: { email: problem.email, telegram: problem.telegram, inApp: true },
    priority: problem.priority,
    suppressed: Boolean(suppressed),
  });
}

async function resolveIncident(open: IncidentLean, ev: CheckEvent, deps: EngineDeps, now: Date, log: Logger) {
  const { site, checkType } = ev;
  const resolvedAt = ev.okSince ?? ev.checkedAt;
  const durationSec = Math.max(0, Math.round((resolvedAt.getTime() - open.startedAt.getTime()) / 1000));

  const resolved = await Incident.findOneAndUpdate(
    { _id: open._id, isOpen: true },
    {
      $set: { status: "RESOLVED", isOpen: false, resolvedAt, durationSec, resolvedBy: "auto" },
      $push: { timeline: { at: now, type: "resolved", message: `Recovered — total ${formatDuration(durationSec)}` } },
    },
    { returnDocument: "after" },
  ).lean();
  if (!resolved) return;
  await refreshOpenCount(site._id);
  log.info({ durationSec }, `incident RESOLVED after ${formatDuration(durationSec)}`);

  let suppressed: Suppression = (await inMaintenance(site._id, now)) ? "maintenance" : null;
  const flap = await recordTransition(site._id, now, deps.settings);
  if (!suppressed && flap.unstable) suppressed = "unstable";
  if (flap.becameUnstable) await sendUnstableAlert(site, flap.count, deps);

  // An incident whose opening was never announced (suppressed) resolves silently too.
  const silent = Boolean(suppressed) || Boolean(open.suppressed);
  await queueAlert({
    data: incidentData("resolved", resolved, site, checkType, deps.config),
    siteId: site._id,
    incidentId: resolved._id,
    checkType,
    channels: { email: resolved.policy?.email ?? true, telegram: resolved.policy?.telegram ?? true, inApp: true },
    suppressed: silent,
  });
}

// ─── Periodic jobs ───────────────────────────────────────────────────

/** Re-alert incidents still OPEN (not acknowledged) after reminderAfterMin; repeat every reminderAfterMin. */
export async function sendReminders(deps: EngineDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const everyMs = (deps.settings.alerts?.reminderAfterMin ?? DEFAULTS.reminderAfterMin) * 60_000;
  const candidates = await Incident.find({ status: "OPEN", isOpen: true, "policy.reminders": true, suppressed: null }).lean();
  let sent = 0;
  for (const inc of candidates) {
    const last = inc.lastRemindedAt ?? inc.startedAt;
    if (now.getTime() - last.getTime() < everyMs) continue;
    const site = await Site.findById(inc.siteId).lean();
    if (!site || site.status === "paused" || site.alerting?.unstable || (await inMaintenance(site._id, now))) continue;

    const updated = await Incident.findOneAndUpdate(
      { _id: inc._id, status: "OPEN", lastRemindedAt: inc.lastRemindedAt ?? null },
      { $set: { lastRemindedAt: now }, $inc: { remindersSent: 1 }, $push: { timeline: { at: now, type: "reminder", message: "Reminder sent" } } },
      { returnDocument: "after" },
    ).lean();
    if (!updated) continue;
    const openFor = Math.round((now.getTime() - inc.startedAt.getTime()) / 1000);
    await queueAlert({
      data: { ...incidentData("reminder", updated, site, inc.checkType as CheckType, deps.config), durationSec: openFor },
      siteId: site._id,
      incidentId: inc._id,
      checkType: inc.checkType as CheckType,
      // Email reminders only for CRITICAL (quota); WARNING reminders go to Telegram.
      channels: { email: inc.severity === "CRITICAL" && (inc.policy?.email ?? true), telegram: inc.policy?.telegram ?? true, inApp: true },
    });
    sent++;
  }
  return sent;
}

/** Unstable sites that have been quiet for stableAfterMin → "stable again" (alerts resume). */
export async function checkStability(deps: EngineDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const quietMs = (deps.settings.alerts?.stableAfterMin ?? DEFAULTS.stableAfterMin) * 60_000;
  const sites = await Site.find({ "alerting.unstable": true }).lean();
  let n = 0;
  for (const site of sites) {
    const last = (site.alerting?.transitions ?? []).map((t) => new Date(t as unknown as Date).getTime()).sort((a, b) => b - a)[0] ?? 0;
    if (now.getTime() - last < quietMs) continue;
    await Site.updateOne({ _id: site._id }, { $set: { "alerting.unstable": false, "alerting.transitions": [] }, $unset: { "alerting.unstableSince": 1 } });
    const openNow = await Incident.find({ siteId: site._id, isOpen: true }, { title: 1, severity: 1 }).lean();
    // Incidents opened while flapping were never announced — allow their resolution to be.
    await Incident.updateMany({ siteId: site._id, isOpen: true, suppressed: "unstable" }, { $set: { suppressed: null } });
    await queueAlert({
      data: {
        siteName: site.name,
        clientName: site.clientName || undefined,
        siteUrl: site.url,
        link: siteLink(deps.config, String(site._id)),
        type: "stable",
        severity: openNow.some((i) => i.severity === "CRITICAL") ? "CRITICAL" : "INFO",
        title: "Site is stable again — alerts resumed",
        message: openNow.length ? `Still open: ${openNow.map((i) => i.title).join(", ")}` : "Currently up with no open incidents.",
      },
      siteId: site._id,
      channels: { email: true, telegram: true, inApp: true },
    });
    n++;
  }
  return n;
}
