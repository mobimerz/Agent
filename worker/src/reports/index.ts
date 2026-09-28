import { DEFAULTS, parseHm, REPORT_KINDS, type ReportKind } from "@siteguard/core";
import { JobState, jobKeys, Report, type SettingsDoc } from "@siteguard/db";
import { createNotifyContext, deliverReport, type NotifyConfig } from "@siteguard/notify";
import type { Logger } from "../logger";
import { buildReport } from "./build";

/** A report missed by more than this (worker was down) is skipped, not sent late in the day. */
const LATE_WINDOW_MIN = 180;

export const REPORT_REQUEST_KEY = jobKeys.global("report-request");

/** Local date + minutes since midnight in the report timezone. */
export function localClock(now: Date, timeZone: string): { date: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** Kinds whose scheduled time has passed today (within the late window). */
export function dueKinds(now: Date, settings: SettingsDoc, timeZone: string): { kind: ReportKind; date: string }[] {
  const { date, minutes } = localClock(now, timeZone);
  const times: Record<ReportKind, string> = { morning: settings.reports?.morning ?? DEFAULTS.reportMorning, night: settings.reports?.night ?? DEFAULTS.reportNight };
  return REPORT_KINDS.filter((k) => {
    const [h, m] = parseHm(times[k]);
    const at = h * 60 + m;
    return minutes >= at && minutes < at + LATE_WINDOW_MIN;
  }).map((kind) => ({ kind, date }));
}

export interface ReportDeps {
  settings: SettingsDoc;
  config: NotifyConfig;
  log: Logger;
  now?: () => Date;
}

/** Build, store and deliver one report. Returns its id, or null if a scheduled one already exists for today. */
export async function runReport(kind: ReportKind, deps: ReportDeps, opts: { manual?: boolean } = {}): Promise<string | null> {
  const now = deps.now?.() ?? new Date();
  const timeZone = deps.settings.timezone || deps.config.timeZone;
  const snapshot = await buildReport(kind, now, timeZone, opts);
  let id: string;
  try {
    const doc = await Report.create({
      kind,
      date: snapshot.date,
      generatedAt: now,
      periodStart: new Date(snapshot.periodStart),
      periodEnd: now,
      manual: opts.manual ?? false,
      summary: snapshot.summary,
      changes: snapshot.changes,
      incidents: snapshot.incidents,
      sites: snapshot.sites,
    });
    id = String(doc._id);
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return null; // another worker/tick already sent today's
    throw err;
  }

  const ctx = await createNotifyContext(deps.config, { settings: deps.settings, log: deps.log.child({ mod: "reports" }), now: () => now });
  const delivery = await deliverReport(ctx, snapshot, id);
  await Report.updateOne({ _id: id }, { $set: { delivery: { email: delivery.email, telegram: delivery.telegram, inApp: delivery.inApp } } });
  deps.log.info({ kind, id, headline: snapshot.summary.headline, email: delivery.email, telegram: delivery.telegram, errors: delivery.errors }, `${kind} report generated`);
  return id;
}

/**
 * Every minute: send today's scheduled reports once their time has come, and
 * any report requested from the dashboard ("Send report now").
 */
export async function reportTick(deps: ReportDeps): Promise<string[]> {
  const now = deps.now?.() ?? new Date();
  const timeZone = deps.settings.timezone || deps.config.timeZone;
  const sent: string[] = [];

  for (const { kind, date } of dueKinds(now, deps.settings, timeZone)) {
    if (await Report.exists({ kind, date, manual: false })) continue;
    const id = await runReport(kind, deps);
    if (id) sent.push(id);
  }

  // Manual request: claim it atomically so it runs exactly once.
  const req = await JobState.findOneAndUpdate(
    { key: REPORT_REQUEST_KEY, "data.kind": { $in: [...REPORT_KINDS] } },
    { $unset: { data: 1 }, $set: { lastRunAt: now } },
    { returnDocument: "before" },
  ).lean();
  const kind = (req?.data as { kind?: ReportKind } | undefined)?.kind;
  if (kind) {
    const id = await runReport(kind, deps, { manual: true });
    if (id) sent.push(id);
  }
  return sent;
}
