import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AlertType, CheckReason, CheckStatus, CheckType } from "@siteguard/core";
import { AlertEvent, CheckResult, getSettings, Incident, MaintenanceWindow, Notification, Site, type SettingsDoc, type SiteLean } from "@siteguard/db";
import { startTestDb } from "../../packages/db/test/setup-mongo";
import { checkStability, classify, processCheckEvent, sendReminders, type CheckEvent } from "../src/incidents/engine";
import { silentLog, testNotifyConfig } from "./helpers";

let db: Awaited<ReturnType<typeof startTestDb>>;
let settings: SettingsDoc;
let site: SiteLean;

beforeAll(async () => {
  db = await startTestDb();
  settings = await getSettings();
});
afterAll(async () => {
  await db?.stop();
});
beforeEach(async () => {
  await Promise.all([Site.deleteMany({}), Incident.deleteMany({}), AlertEvent.deleteMany({}), Notification.deleteMany({}), CheckResult.deleteMany({}), MaintenanceWindow.deleteMany({})]);
  site = (await Site.create({ name: "Acme Dental", clientName: "Acme Clinic", url: "https://acme.example" })).toObject() as unknown as SiteLean;
});

const T0 = new Date("2026-09-23T06:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

/** Drive the engine like the runner does, keeping streak counters. */
function driver(type: CheckType = "uptime") {
  let fails = 0;
  let oks = 0;
  let warns = 0;
  let problemSince: Date | null = null;
  let okSince: Date | null = null;
  return async (minute: number, status: CheckStatus, reason: CheckReason = status === "OK" ? "ok" : "http_5xx", message: string = reason) => {
    const checkedAt = at(minute);
    fails = status === "FAIL" ? fails + 1 : 0;
    warns = status === "WARN" ? warns + 1 : 0;
    oks = status === "OK" ? oks + 1 : 0;
    problemSince = status === "OK" ? null : (problemSince ?? checkedAt);
    okSince = status === "OK" ? (oks === 1 ? checkedAt : okSince) : null;
    await CheckResult.create({ checkedAt, meta: { siteId: site._id, checkType: type }, status, reason, message });
    const ev: CheckEvent = { site, checkType: type, outcome: { status, reason, message, metrics: {} }, checkedAt, fails, oks, warns, confirmed: fails > 2, problemSince, okSince };
    await processCheckEvent(ev, { settings, config: testNotifyConfig, log: silentLog, now: () => checkedAt });
  };
}

const openIncident = () => Incident.findOne({ siteId: site._id, isOpen: true }).lean();
const events = (type?: AlertType) => AlertEvent.find(type ? { type } : {}).sort({ createdAt: 1 }).lean();

describe("classify", () => {
  it("maps results to severities and channel policy", () => {
    expect(classify("uptime", { status: "FAIL", reason: "timeout" })).toMatchObject({ severity: "CRITICAL", email: true });
    expect(classify("uptime", { status: "WARN", reason: "blocked" })).toMatchObject({ severity: "WARNING", email: false, telegram: true, reminders: false });
    expect(classify("content", { status: "FAIL", reason: "spam_detected" })).toMatchObject({ severity: "CRITICAL", priority: true, email: true });
    expect(classify("uptime", { status: "OK", reason: "ok" })).toBeNull();
    expect(classify("content", { status: "UNKNOWN", reason: "unreachable" })).toBeNull();
  });
});

describe("down → incident → resolve", () => {
  it("opens only after 3 FAILs, resolves only after 2 OKs, with correct times", async () => {
    const run = driver();
    await run(-10, "OK");
    await run(0, "FAIL", "http_5xx", "HTTP 503 server error");
    await run(1, "FAIL", "http_5xx", "HTTP 503 server error");
    expect(await openIncident()).toBeNull();
    await run(2, "FAIL", "http_5xx", "HTTP 503 server error");

    const inc = (await openIncident())!;
    expect(inc).toMatchObject({ severity: "CRITICAL", title: "Site is down", reason: "http_5xx", message: "HTTP 503 server error" });
    expect(inc.startedAt).toEqual(at(0)); // first failure, not confirmation time
    expect(inc.lastOkAt).toEqual(at(-10));

    const [opened] = await events("opened");
    expect(opened!.channels).toEqual({ email: "pending", telegram: "pending" });
    expect(opened!.data).toMatchObject({ siteName: "Acme Dental", clientName: "Acme Clinic", siteUrl: "https://acme.example", checkLabel: "Uptime / HTTP", message: "HTTP 503 server error" });
    expect((opened!.data as { link: string }).link).toBe(`http://localhost:3000/sites/${site._id}`);
    expect(await Notification.countDocuments({ type: "incident_opened" })).toBe(1);
    expect((await Site.findById(site._id).lean())!.current?.openIncidents).toBe(1);

    await run(5, "OK");
    expect(await openIncident()).not.toBeNull(); // 1 OK is not enough (anti-flap)
    await run(10, "OK");
    expect(await openIncident()).toBeNull();

    const resolved = (await Incident.findById(inc._id).lean())!;
    expect(resolved.resolvedAt).toEqual(at(5)); // first OK = real recovery time
    expect(resolved.durationSec).toBe(5 * 60);
    const [r] = await events("resolved");
    expect(r!.data).toMatchObject({ durationSec: 300 });
    expect(r!.channels).toEqual({ email: "pending", telegram: "pending" });
  });

  it("a FAIL between the two OKs keeps the incident open", async () => {
    const run = driver();
    for (const m of [0, 1, 2]) await run(m, "FAIL");
    await run(5, "OK");
    await run(6, "FAIL");
    await run(7, "OK");
    expect(await openIncident()).not.toBeNull();
  });
});

describe("BLOCKED", () => {
  it("WARNING after 2 blocked results; Telegram + in-app only, no email, no reminders", async () => {
    const run = driver();
    await run(0, "WARN", "blocked", "Cloudflare challenge (HTTP 403)");
    expect(await openIncident()).toBeNull();
    await run(5, "WARN", "blocked", "Cloudflare challenge (HTTP 403)");
    const inc = (await openIncident())!;
    expect(inc).toMatchObject({ severity: "WARNING", policy: { email: false, telegram: true, reminders: false } });
    const [e] = await events("opened");
    expect(e!.channels).toEqual({ email: "none", telegram: "pending" });

    await Incident.updateOne({ _id: inc._id }, { $set: { startedAt: at(-600) } });
    expect(await sendReminders({ settings, config: testNotifyConfig, log: silentLog, now: () => at(10) })).toBe(0);
  });
});

describe("hacked content", () => {
  it("spam/hack text → CRITICAL, priority, always email", async () => {
    const run = driver("content");
    for (const m of [0, 1, 2]) await run(m, "FAIL", "spam_detected", 'Possible hack/spam content: "hacked by"');
    const inc = (await openIncident())!;
    expect(inc.severity).toBe("CRITICAL");
    const [e] = await events("opened");
    expect(e).toMatchObject({ priority: true, channels: { email: "pending", telegram: "pending" } });
  });
});

describe("escalation", () => {
  it("slow (WARNING) → down (CRITICAL) escalates the same incident and alerts", async () => {
    const run = driver();
    await run(0, "WARN", "slow", "Slow: 4200 ms");
    await run(5, "WARN", "slow", "Slow: 4300 ms");
    const first = (await openIncident())!;
    expect(first.severity).toBe("WARNING");
    for (const m of [10, 11, 12]) await run(m, "FAIL", "timeout", "Timed out waiting for the server");
    const inc = (await openIncident())!;
    expect(String(inc._id)).toBe(String(first._id));
    expect(inc).toMatchObject({ severity: "CRITICAL", title: "Site is down" });
    expect(await events("escalated")).toHaveLength(1);
  });
});

describe("flap detection", () => {
  it("4 transitions in 30 min → ONE unstable alert, then silence until stable for 30 min", async () => {
    const run = driver();
    const cycle = async (start: number) => {
      for (const m of [0, 1, 2]) await run(start + m, "FAIL");
      await run(start + 3, "OK");
      await run(start + 4, "OK");
    };
    await cycle(0); // open + resolve = 2 transitions
    await cycle(5); // 4 transitions → unstable
    expect(await events("unstable")).toHaveLength(1);
    expect((await Site.findById(site._id).lean())!.alerting?.unstable).toBe(true);

    const beforeCount = await AlertEvent.countDocuments({ "channels.email": "pending" });
    await cycle(10); // more flapping: recorded but suppressed
    expect(await events("unstable")).toHaveLength(1);
    expect(await AlertEvent.countDocuments({ "channels.email": "pending" })).toBe(beforeCount);
    expect(await AlertEvent.countDocuments({ "channels.email": "suppressed" })).toBeGreaterThanOrEqual(2);

    const deps = { settings, config: testNotifyConfig, log: silentLog };
    expect(await checkStability({ ...deps, now: () => at(20) })).toBe(0); // quiet only 6 min
    expect(await checkStability({ ...deps, now: () => at(50) })).toBe(1); // quiet 36 min
    expect(await events("stable")).toHaveLength(1);
    expect((await Site.findById(site._id).lean())!.alerting?.unstable).toBe(false);
  });
});

describe("reminders", () => {
  it("reminds open incidents after 2 h, not acknowledged ones; email only for CRITICAL", async () => {
    const run = driver();
    for (const m of [0, 1, 2]) await run(m, "FAIL");
    const deps = { settings, config: testNotifyConfig, log: silentLog };
    expect(await sendReminders({ ...deps, now: () => at(60) })).toBe(0);
    expect(await sendReminders({ ...deps, now: () => at(121) })).toBe(1);
    expect(await sendReminders({ ...deps, now: () => at(122) })).toBe(0); // not again right away
    const [rem] = await events("reminder");
    expect(rem!.channels).toEqual({ email: "pending", telegram: "pending" });

    await Incident.updateOne({ isOpen: true }, { $set: { status: "ACKNOWLEDGED" } });
    expect(await sendReminders({ ...deps, now: () => at(300) })).toBe(0);
  });
});

describe("maintenance window", () => {
  it("records the incident but suppresses alerts", async () => {
    await MaintenanceWindow.create({ siteId: site._id, startsAt: at(-5), endsAt: at(60), reason: "deploy" });
    const run = driver();
    for (const m of [0, 1, 2]) await run(m, "FAIL");
    expect((await openIncident())!.suppressed).toBe("maintenance");
    const [e] = await events("opened");
    expect(e!.channels).toEqual({ email: "suppressed", telegram: "suppressed" });
    expect(await Notification.countDocuments()).toBe(0);
  });
});
