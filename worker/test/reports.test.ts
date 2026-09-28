import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ReportSiteRow, ReportSnapshot } from "@siteguard/core";
import { CheckResult, getSettings, Incident, JobState, Notification, Outbox, Report, Site, Types, UptimeHourly, type SettingsDoc } from "@siteguard/db";
import { formatReportTelegram } from "@siteguard/notify";
import { renderReportEmail } from "@siteguard/emails";
import { startTestDb } from "../../packages/db/test/setup-mongo";
import { rollupUptime, runRollup } from "../src/jobs/rollup";
import { buildReport, diffSnapshots } from "../src/reports/build";
import { dueKinds, localClock, REPORT_REQUEST_KEY, reportTick, runReport } from "../src/reports";
import { silentLog, testNotifyConfig } from "./helpers";

let db: Awaited<ReturnType<typeof startTestDb>>;
let settings: SettingsDoc;

beforeAll(async () => {
  db = await startTestDb();
  settings = await getSettings();
});
afterAll(async () => {
  await db?.stop();
});
beforeEach(async () => {
  await Promise.all([Site.deleteMany({}), CheckResult.deleteMany({}), UptimeHourly.deleteMany({}), Incident.deleteMany({}), Report.deleteMany({}), Notification.deleteMany({}), Outbox.deleteMany({}), JobState.deleteMany({})]);
});

const H = 3_600_000;
const T0 = new Date("2026-09-28T00:00:00Z");
const at = (h: number, m = 0) => new Date(T0.getTime() + h * H + m * 60_000);

async function uptime(siteId: Types.ObjectId, checkedAt: Date, status: "OK" | "FAIL" | "WARN", ms: number | null, attempt = 0) {
  await CheckResult.create({ checkedAt, meta: { siteId, checkType: "uptime" }, status, attempt, metrics: { responseTimeMs: ms } });
}

describe("hourly uptime rollup", () => {
  it("aggregates scheduled runs per site-hour (re-checks excluded), idempotently", async () => {
    const site = await Site.create({ name: "Acme", url: "https://acme.example" });
    for (let m = 0; m < 60; m += 5) await uptime(site._id, at(1, m), m === 30 ? "FAIL" : m === 35 ? "WARN" : "OK", 100 + m);
    await uptime(site._id, at(1, 31), "FAIL", null, 1); // confirmation re-check: not counted
    await uptime(site._id, at(2, 0), "OK", 50);

    expect(await rollupUptime(at(0), at(2))).toBe(1); // hour 2 is still open
    await rollupUptime(at(0), at(2)); // re-run: same result, no duplicates
    const rows = await UptimeHourly.find({ siteId: site._id }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ hour: at(1), total: 12, up: 11, down: 1, warn: 1, minResponseMs: 100, maxResponseMs: 155 });
    expect(rows[0]!.avgResponseMs).toBe(128);
    expect(rows[0]!.p95ResponseMs).toBeGreaterThanOrEqual(150);
  });

  it("first run backfills 30 days, later runs only the last hours", async () => {
    const site = await Site.create({ name: "Acme", url: "https://acme.example" });
    const now = new Date();
    await uptime(site._id, new Date(now.getTime() - 20 * 24 * H), "OK", 100);
    await uptime(site._id, new Date(now.getTime() - 2 * H), "OK", 100);
    expect(await runRollup(now)).toMatchObject({ backfilled: true, hours: 2 });
    expect(await runRollup(now)).toMatchObject({ backfilled: false, hours: 1 });
  });
});

describe("report scheduling", () => {
  it("uses the configured timezone and a 3-hour late window", () => {
    const s = { ...settings, reports: { ...settings.reports, morning: "09:00", night: "21:00" } } as SettingsDoc;
    // 03:40 UTC = 09:10 IST
    expect(localClock(new Date("2026-09-28T03:40:00Z"), "Asia/Kolkata")).toEqual({ date: "2026-09-28", minutes: 9 * 60 + 10 });
    expect(dueKinds(new Date("2026-09-28T03:40:00Z"), s, "Asia/Kolkata")).toEqual([{ kind: "morning", date: "2026-09-28" }]);
    expect(dueKinds(new Date("2026-09-28T03:20:00Z"), s, "Asia/Kolkata")).toEqual([]); // 08:50
    expect(dueKinds(new Date("2026-09-28T07:00:00Z"), s, "Asia/Kolkata")).toEqual([]); // 12:30: too late, skip
    expect(dueKinds(new Date("2026-09-28T15:31:00Z"), s, "Asia/Kolkata")).toEqual([{ kind: "night", date: "2026-09-28" }]); // 21:01
  });

  it("sends each scheduled report exactly once per day, plus manual requests", async () => {
    await Site.create({ name: "Acme", url: "https://acme.example" });
    const deps = { settings, config: testNotifyConfig, log: silentLog, now: () => new Date("2026-09-28T03:40:00Z") };
    expect(await reportTick(deps)).toHaveLength(1);
    expect(await reportTick(deps)).toHaveLength(0);
    expect(await Report.countDocuments({ kind: "morning", manual: false })).toBe(1);

    await JobState.updateOne({ key: REPORT_REQUEST_KEY }, { $set: { kind: "global", data: { kind: "night", requestedBy: "Admin" } } }, { upsert: true });
    expect(await reportTick(deps)).toHaveLength(1);
    expect(await reportTick(deps)).toHaveLength(0); // request consumed
    expect(await Report.findOne({ manual: true }).lean()).toMatchObject({ kind: "night" });
  });
});

describe("report content", () => {
  const row = (over: Partial<ReportSiteRow>): ReportSiteRow => ({
    id: "s1",
    name: "Acme",
    clientName: "",
    url: "https://acme.example",
    status: "up",
    uptimePct: 100,
    avgResponseMs: 300,
    issues: [],
    sslDaysLeft: 90,
    domainDaysLeft: 200,
    perfMobile: 80,
    seoScore: 95,
    openIncidents: 0,
    ...over,
  });

  it("diffs against the previous snapshot", () => {
    const prev = [row({}), row({ id: "s2", name: "Beta", status: "down" }), row({ id: "s3", name: "Gamma" })];
    const now = [
      row({ status: "down" }),
      row({ id: "s2", name: "Beta", status: "up" }),
      row({ id: "s3", name: "Gamma", sslDaysLeft: 20, perfMobile: 55 }),
      row({ id: "s4", name: "Delta" }),
    ];
    expect(diffSnapshots(prev, now).map((c) => `${c.tone} ${c.siteName}: ${c.text}`)).toEqual([
      "bad Acme: went DOWN (was up)",
      "bad Gamma: SSL certificate expires in 20 days",
      "bad Gamma: mobile performance 80 → 55",
      "good Beta: recovered — now up",
      "info Delta: added to monitoring",
    ]);
    expect(diffSnapshots(null, now)).toEqual([]);
  });

  it("builds a snapshot from live data and delivers it (preview) on email, Telegram and in-app", async () => {
    const acme = await Site.create({ name: "Acme Dental", url: "https://acme.example", current: { health: "up", sslDaysLeft: 12, checks: { uptime: { status: "OK", reason: "ok", message: "HTTP 200", checkedAt: at(10) } } } });
    const beta = await Site.create({
      name: "Beta Clinic",
      url: "https://beta.example",
      current: { health: "down", uptimeDown: true, openIncidents: 1, checks: { uptime: { status: "FAIL", reason: "http_5xx", message: "HTTP 503 server error", checkedAt: at(11) } } },
    });
    await Site.create({ name: "Paused Co", url: "https://paused.example", status: "paused" });
    for (let m = 0; m < 60; m += 10) {
      await uptime(acme._id, at(10, m), "OK", 200);
      await uptime(beta._id, at(10, m), m < 30 ? "OK" : "FAIL", 400);
    }
    await Incident.create({ siteId: beta._id, checkType: "uptime", severity: "CRITICAL", title: "Site is down", startedAt: at(10, 30) });

    const now = at(12);
    const snap = await buildReport("morning", now, "Asia/Kolkata");
    expect(snap.summary).toMatchObject({ total: 2, up: 1, down: 1, paused: 1, openIncidents: 1, headline: "1 down · 1 open incident" });
    expect(snap.sites.find((s) => s.name === "Beta Clinic")).toMatchObject({ status: "down", uptimePct: 50, issues: [{ check: "uptime", message: "HTTP 503 server error" }] });
    expect(snap.incidents.opened.map((i) => i.title)).toEqual(["Site is down"]);

    const id = await runReport("morning", { settings, config: testNotifyConfig, log: silentLog, now: () => now });
    const stored = (await Report.findById(id).lean())!;
    expect(stored.delivery).toMatchObject({ email: "preview", telegram: "preview", inApp: true });
    const email = await Outbox.findOne({ channel: "email", category: "report" }).lean();
    expect(email!.subject).toBe("🔴 Morning report 28 Sept — 1 down · 1 open incident");
    expect(email!.html).toContain("Renewals due within 30 days");
    expect(email!.html).toContain("Beta Clinic");
    const tg = await Outbox.findOne({ channel: "telegram", category: "report" }).lean();
    expect(tg!.text).toContain("<b>Open incidents (1)</b>");
    expect(tg!.text).toContain(`/reports/${id}`);
    expect(await Notification.findOne({ type: "report" }).lean()).toMatchObject({ severity: "CRITICAL", link: `/reports/${id}` });
  });

  it("an all-green report is short and calm", async () => {
    const snap: ReportSnapshot = {
      kind: "night",
      date: "2026-09-28",
      generatedAt: at(15, 30).toISOString(),
      periodStart: at(3, 30).toISOString(),
      periodEnd: at(15, 30).toISOString(),
      manual: false,
      summary: { total: 3, up: 3, down: 0, degraded: 0, blocked: 0, paused: 0, openIncidents: 0, avgUptime: 100, headline: "All 3 sites up" },
      changes: [],
      incidents: { opened: [], resolved: [], open: [] },
      sites: [row({}), row({ id: "s2", name: "B" }), row({ id: "s3", name: "C" })],
    };
    const text = formatReportTelegram(snap, "http://x/reports/1", "Asia/Kolkata");
    expect(text).toContain("🟢 <b>All 3 sites up</b>");
    expect(text).not.toContain("Open incidents");
    const email = await renderReportEmail({ report: snap, timeZone: "Asia/Kolkata", appUrl: "http://x", reportUrl: "http://x/reports/1" });
    expect(email.subject).toBe("🟢 Night report 28 Sept — All 3 sites up");
    expect(email.text).toContain("No changes.");
  });
});
