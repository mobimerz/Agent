import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CheckResult, getSettings, JobState, jobKeys, requestRunNow, Site, syncSiteJobs } from "@siteguard/db";
import { startTestDb } from "../../packages/db/test/setup-mongo";
import { claimNextJob } from "../src/scheduler/dispatcher";
import { runCheckJob } from "../src/scheduler/runner";
import { silentLog, startServer, testNotifyConfig } from "./helpers";

let db: Awaited<ReturnType<typeof startTestDb>>;
let srv: Awaited<ReturnType<typeof startServer>>;
let failing = true;

beforeAll(async () => {
  db = await startTestDb();
  srv = await startServer({
    "/": (_req, res) => {
      res.statusCode = failing ? 500 : 200;
      res.end(failing ? "down" : "<html>ok</html>");
    },
  });
});

afterAll(async () => {
  await srv?.close();
  await db?.stop();
});

beforeEach(async () => {
  await Promise.all([Site.deleteMany({}), JobState.deleteMany({}), CheckResult.deleteMany({})]);
});

async function setup() {
  const site = await Site.create({ name: "Flaky", url: srv.url, checks: { content: { enabled: false } } });
  await syncSiteJobs(site.toObject());
  const key = jobKeys.check(String(site._id), "uptime");
  await JobState.updateOne({ key }, { $set: { nextRunAt: new Date(0) } });
  return { site, key };
}

/** Claim the (only) due uptime job and run it, as the dispatcher would. */
async function runOnce(key: string) {
  await JobState.updateOne({ key }, { $set: { nextRunAt: new Date(0) } }); // make it due now
  const job = await claimNextJob(["uptime"]);
  expect(job?.key).toBe(key);
  const settings = await getSettings();
  const outcome = await runCheckJob(job!, { settings, config: testNotifyConfig, log: silentLog });
  return { outcome, job: (await JobState.findOne({ key }).lean())! };
}

describe("syncSiteJobs", () => {
  it("creates jobs only for active, implemented, enabled checks", async () => {
    const site = await Site.create({ name: "A", url: "https://a.example.com", checks: { content: { enabled: false } } });
    await syncSiteJobs(site.toObject());
    const jobs = await JobState.find({ siteId: site._id }).lean();
    expect(jobs.map((j) => j.checkType)).toEqual(["uptime"]);
    expect(jobs[0]!.intervalSec).toBe(300);

    site.status = "paused";
    await site.save();
    await syncSiteJobs(site.toObject());
    expect((await JobState.findOne({ siteId: site._id }).lean())!.enabled).toBe(false);
  });

  it("uses the per-site interval override", async () => {
    const site = await Site.create({ name: "B", url: "https://b.example.com", checks: { uptime: { enabled: true, intervalSec: 120 } } });
    await syncSiteJobs(site.toObject());
    expect((await JobState.findOne({ siteId: site._id, checkType: "uptime" }).lean())!.intervalSec).toBe(120);
  });
});

describe("FAIL confirmation (2 re-checks, 60 s apart)", () => {
  it("re-checks after 60 s, confirms DOWN on the 3rd consecutive FAIL, then recovers", async () => {
    failing = true;
    const { site, key } = await setup();

    // 1st FAIL → retry in ~60 s, not down yet
    let r = await runOnce(key);
    expect(r.outcome?.status).toBe("FAIL");
    expect(r.job.consecutiveFails).toBe(1);
    expect(r.job.retryAttempt).toBe(1);
    const delay = r.job.nextRunAt!.getTime() - r.job.lastFinishedAt!.getTime();
    expect(delay).toBe(60_000);
    let s = (await Site.findById(site._id).lean())!;
    expect(s.current?.uptimeDown).toBe(false);
    expect(s.current?.health).toBe("degraded");

    // 2nd FAIL → still retrying
    r = await runOnce(key);
    expect(r.job.consecutiveFails).toBe(2);
    expect(r.job.retryAttempt).toBe(2);

    // 3rd FAIL → confirmed down, back to the normal interval
    r = await runOnce(key);
    expect(r.job.consecutiveFails).toBe(3);
    expect(r.job.retryAttempt).toBe(0);
    expect(r.job.nextRunAt!.getTime() - r.job.lastFinishedAt!.getTime()).toBeGreaterThan(250_000);
    s = (await Site.findById(site._id).lean())!;
    expect(s.current?.uptimeDown).toBe(true);
    expect(s.current?.health).toBe("down");
    expect(s.current?.statusCode).toBe(500);

    // Result attempts recorded 0,1,2
    const attempts = (await CheckResult.find({ "meta.siteId": site._id }).sort({ checkedAt: 1 }).lean()).map((c) => c.attempt);
    expect(attempts).toEqual([0, 1, 2]);

    // Recovery
    failing = false;
    r = await runOnce(key);
    expect(r.job.consecutiveFails).toBe(0);
    s = (await Site.findById(site._id).lean())!;
    expect(s.current?.uptimeDown).toBe(false);
    expect(s.current?.health).toBe("up");
    expect(s.current?.checks?.uptime?.reason).toBe("ok");
  });
});

describe("site health", () => {
  it("stays correct when two checks of the same site finish at the same time", async () => {
    failing = false;
    const site = await Site.create({ name: "Both", url: srv.url });
    await syncSiteJobs(site.toObject());
    await JobState.updateMany({ siteId: site._id }, { $set: { nextRunAt: new Date(0) } });
    const settings = await getSettings();
    const jobs = [await claimNextJob(["uptime", "content"]), await claimNextJob(["uptime", "content"])];
    expect(jobs.map((j) => j?.checkType).sort()).toEqual(["content", "uptime"]);
    // Both read the site before either writes — the old read-modify-write lost one summary.
    await Promise.all(jobs.map((j) => runCheckJob(j!, { settings, config: testNotifyConfig, log: silentLog })));
    const s = (await Site.findById(site._id).lean())!;
    expect(Object.keys(s.current?.checks ?? {}).sort()).toEqual(["content", "uptime"]);
    expect(s.current?.health).toBe("up");
  });
});

describe("claiming", () => {
  it("never hands the same job to two claimers", async () => {
    const { key } = await setup();
    const [a, b] = await Promise.all([claimNextJob(["uptime"]), claimNextJob(["uptime"])]);
    expect([a?.key, b?.key].filter(Boolean)).toEqual([key]);
  });

  it("run-now makes a job due immediately", async () => {
    failing = false;
    const { site, key } = await setup();
    await runOnce(key);
    expect(await claimNextJob(["uptime"])).toBeNull(); // not due
    expect(await requestRunNow(site._id, "uptime")).toBeInstanceOf(Date);
    expect((await claimNextJob(["uptime"]))?.key).toBe(key);
  });
});
