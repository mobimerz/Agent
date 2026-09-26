import { readFileSync } from "node:fs";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PSI, type CheckReason, type CheckStatus } from "@siteguard/core";
import { CheckResult, getSettings, Incident, JobState, jobKeys, Site, type SettingsDoc, type SiteLean } from "@siteguard/db";
import { startTestDb } from "../../packages/db/test/setup-mongo";
import { createPagespeedCheck, median, rollingMedians, type ScoreSample } from "../src/checks/pagespeed";
import type { CheckRunResult } from "../src/checks/types";
import { processCheckEvent } from "../src/incidents/engine";
import { parsePsiResponse, PsiClient } from "../src/lib/psi";
import { runCheckJob } from "../src/scheduler/runner";
import { makeCtx, makeSite, silentLog, testNotifyConfig } from "./helpers";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/psi/${name}`, import.meta.url), "utf8"));
const MOBILE = fixture("mobile-ok.json");
const DESKTOP = fixture("desktop-ok.json");

const requests: URL[] = [];
type Reply = (strategy: string) => Response;
let reply: Reply = (s) => HttpResponse.json(s === "mobile" ? MOBILE : DESKTOP);

const server = setupServer(
  http.get(PSI.endpoint, ({ request }) => {
    const url = new URL(request.url);
    requests.push(url);
    return reply(url.searchParams.get("strategy") ?? "");
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  requests.length = 0;
  reply = (s) => HttpResponse.json(s === "mobile" ? MOBILE : DESKTOP);
});
afterEach(() => server.resetHandlers());

const noWait = { minGapMs: 0, sleep: async () => {} };

describe("parsePsiResponse", () => {
  it("keeps scores, lab CWV, field data and top opportunities only", () => {
    const r = parsePsiResponse(MOBILE, "mobile");
    expect(r.scores).toEqual({ performance: 42, seo: 92, accessibility: 91, bestPractices: 78 });
    expect(r.lab).toMatchObject({ lcpMs: 6100, cls: 0.08, tbtMs: 640, fcpMs: 2900, ttfbMs: 420 });
    expect(r.field).toEqual({ scope: "url", lcpMs: 3100, inpMs: 210, cls: 0.06, category: "AVERAGE" });
    expect(r.opportunities.map((o) => o.id)).toEqual(["render-blocking-resources", "uses-optimized-images", "unused-javascript"]);
    expect(JSON.stringify(r).length).toBeLessThan(2000); // never raw Lighthouse JSON
  });

  it("throws on a Lighthouse runtime error", () => {
    expect(() => parsePsiResponse(fixture("runtime-error.json"), "mobile")).toThrow(/unable to reliably load/);
  });
});

describe("PsiClient", () => {
  it("works without an API key (no key param) and adds PSI_API_KEY automatically when set", async () => {
    await new PsiClient(noWait).run("https://acme.example/", "mobile");
    expect(requests[0]!.searchParams.has("key")).toBe(false);
    expect(requests[0]!.searchParams.getAll("category")).toEqual(["performance", "seo", "accessibility", "best-practices"]);

    await new PsiClient({ ...noWait, apiKey: "AIza-test" }).run("https://acme.example/", "desktop");
    expect(requests[1]!.searchParams.get("key")).toBe("AIza-test");
  });

  it("429 → rate_limited + backoff: later calls don't hit Google until the pause ends", async () => {
    reply = () => HttpResponse.json(fixture("429-keyless-quota.json"), { status: 429 });
    let now = 1_000_000;
    const client = new PsiClient({ ...noWait, now: () => now });
    const first = await client.run("https://a.example/", "mobile");
    expect(first).toMatchObject({ ok: false, kind: "rate_limited", retryAfterSec: PSI.rateLimitBackoffSecNoKey });
    expect(requests).toHaveLength(1);

    const second = await client.run("https://b.example/", "mobile");
    expect(second).toMatchObject({ ok: false, kind: "rate_limited" });
    expect(requests).toHaveLength(1); // served from the backoff, no request

    now += PSI.rateLimitBackoffSecNoKey * 1000 + 1;
    reply = (s) => HttpResponse.json(s === "mobile" ? MOBILE : DESKTOP);
    expect((await client.run("https://b.example/", "mobile")).ok).toBe(true);
  });

  it("honours Retry-After", async () => {
    reply = () => HttpResponse.json(fixture("429-keyless-quota.json"), { status: 429, headers: { "retry-after": "120" } });
    const r = await new PsiClient(noWait).run("https://a.example/", "mobile");
    expect(r).toMatchObject({ kind: "rate_limited", retryAfterSec: 120 });
  });

  it("spaces calls out when keyless", async () => {
    const waits: number[] = [];
    let now = 0;
    const client = new PsiClient({ now: () => now, sleep: async (ms) => void waits.push(ms) });
    await client.run("https://a.example/", "mobile");
    now += 1000;
    await client.run("https://a.example/", "desktop");
    expect(waits).toEqual([PSI.minGapMsNoKey - 1000]);
  });

  it("errors: page unreachable (500), bad key (400)", async () => {
    reply = () => HttpResponse.json(fixture("500-unreachable.json"), { status: 500 });
    expect(await new PsiClient(noWait).run("https://a.example/", "mobile")).toMatchObject({ ok: false, kind: "error", status: 500 });
    reply = () => HttpResponse.json(fixture("400-bad-key.json"), { status: 400 });
    const bad = await new PsiClient({ ...noWait, apiKey: "wrong" }).run("https://a.example/", "mobile");
    expect(bad).toMatchObject({ ok: false, kind: "error" });
    expect(bad.ok ? "" : bad.message).toContain("PSI_API_KEY rejected");
  });
});

describe("median of the last 3 runs", () => {
  it("median helper", () => {
    expect(median([50, 40, 60])).toBe(50);
    expect(median([40, 60])).toBe(50);
    expect(median([null, 70])).toBe(70);
    expect(median([])).toBeNull();
  });

  it("uses only the last 3 samples", () => {
    const s = (p: number): ScoreSample => ({ at: "", mobile: { performance: p, seo: 90 }, desktop: { performance: 90, seo: 90 } });
    expect(rollingMedians([s(10), s(80), s(40), s(60)]).perfMobile).toBe(60);
  });

  it("one bad run among good ones doesn't trip the threshold", async () => {
    const check = createPagespeedCheck(new PsiClient(noWait));
    const withPerf = (p: number) => ({ ...MOBILE, lighthouseResult: { ...MOBILE.lighthouseResult, categories: { ...MOBILE.lighthouseResult.categories, performance: { score: p / 100 } } } });
    let jobData: Record<string, unknown> = {};
    const results: CheckRunResult[] = [];
    for (const p of [72, 71, 38, 70, 45, 41]) {
      reply = (s) => HttpResponse.json(s === "mobile" ? withPerf(p) : DESKTOP);
      const r = await check.run(makeSite("https://acme.example"), makeCtx({ jobData }));
      jobData = r.jobData!;
      results.push(r);
    }
    // medians: 72, 72(avg 72/71→72), 71, 70, 45, 45
    expect(results.map((r) => r.metrics.medPerfMobile)).toEqual([72, 72, 71, 70, 45, 45]);
    expect(results.map((r) => r.status)).toEqual(["OK", "OK", "OK", "OK", "WARN", "WARN"]);
    expect(results[4]).toMatchObject({ reason: "low_performance" });
    expect(results[4]!.message).toContain("mobile performance 45");
  });

  it("rate limit → skipped (UNKNOWN), jobData untouched, retry scheduled", async () => {
    reply = () => HttpResponse.json(fixture("429-keyless-quota.json"), { status: 429 });
    const check = createPagespeedCheck(new PsiClient(noWait));
    const r = await check.run(makeSite("https://acme.example"), makeCtx({ jobData: { samples: [] } }));
    expect(r).toMatchObject({ status: "UNKNOWN", reason: "rate_limited", skipped: true });
    expect(r.message).toMatch(/^Skipped – rate limited/);
    expect(r.jobData).toBeUndefined();
    expect(r.nextRunInSec).toBeGreaterThan(PSI.rateLimitBackoffSecNoKey);
  });

  it("local targets are not sent to Google", async () => {
    const r = await createPagespeedCheck(new PsiClient(noWait)).run(makeSite("http://localhost:3000/api/dev/test-target"), makeCtx());
    expect(r.reason).toBe("not_applicable");
    expect(requests).toHaveLength(0);
  });
});

describe("with the database", () => {
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
    await Promise.all([Site.deleteMany({}), Incident.deleteMany({}), CheckResult.deleteMany({}), JobState.deleteMany({})]);
    site = (await Site.create({ name: "Acme", url: "https://acme.example" })).toObject() as unknown as SiteLean;
  });

  it("runner: a rate-limited run is stored as skipped and never touches site status or incidents", async () => {
    reply = () => HttpResponse.json(fixture("429-keyless-quota.json"), { status: 429 });
    await Site.updateOne({ _id: site._id }, { $set: { "current.checks.pagespeed": { status: "WARN", reason: "low_performance", message: "old", checkedAt: new Date() }, "current.perfMobile": 45 } });
    const job = (await JobState.create({ key: jobKeys.check(String(site._id), "pagespeed"), kind: "check", siteId: site._id, checkType: "pagespeed", intervalSec: 43200, consecutiveWarns: 1, lockedBy: "x" })).toObject();
    // runCheckJob only updates jobs it holds the lock for.
    const { WORKER_ID } = await import("../src/worker-id");
    await JobState.updateOne({ _id: job._id }, { $set: { lockedBy: WORKER_ID } });

    const before = Date.now();
    const out = await runCheckJob({ ...job, lockedBy: WORKER_ID } as never, { settings, config: testNotifyConfig, log: silentLog });
    expect(out).toMatchObject({ reason: "rate_limited", skipped: true });

    const stored = await CheckResult.findOne({ "meta.checkType": "pagespeed" }).lean();
    expect(stored).toMatchObject({ status: "UNKNOWN", reason: "rate_limited", skipped: true });
    const s = (await Site.findById(site._id).lean())!;
    expect((s.current?.checks as unknown as Record<string, { message: string }>).pagespeed!.message).toBe("old");
    expect(s.current?.perfMobile).toBe(45);
    const j = (await JobState.findById(job._id).lean())!;
    expect(j.consecutiveWarns).toBe(1); // streak untouched
    expect(j.nextRunAt!.getTime() - before).toBeGreaterThan(PSI.rateLimitBackoffSecNoKey * 1000 - 5000);
    expect(await Incident.countDocuments()).toBe(0);
  });

  it("engine: PSI needs 2 consecutive below-threshold runs; DNS alerts on the first change", async () => {
    const ev = (type: "pagespeed" | "dns", status: CheckStatus, reason: CheckReason, warns: number) => ({
      site,
      checkType: type,
      outcome: { status, reason, message: reason, metrics: {} },
      checkedAt: new Date(),
      fails: 0,
      oks: 0,
      warns,
      confirmed: false,
      problemSince: new Date(),
      okSince: null,
    });
    const deps = { settings, config: testNotifyConfig, log: silentLog };
    await processCheckEvent(ev("pagespeed", "WARN", "low_performance", 1), deps);
    expect(await Incident.countDocuments({ checkType: "pagespeed" })).toBe(0);
    await processCheckEvent(ev("pagespeed", "WARN", "low_performance", 2), deps);
    expect(await Incident.findOne({ checkType: "pagespeed" }).lean()).toMatchObject({ severity: "WARNING", title: "PageSpeed performance below threshold" });

    await processCheckEvent(ev("dns", "WARN", "dns_changed", 1), deps);
    expect(await Incident.findOne({ checkType: "dns" }).lean()).toMatchObject({ severity: "WARNING", title: "DNS records changed" });
  });
});
