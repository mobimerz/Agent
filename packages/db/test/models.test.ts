import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_INTERVALS, RETENTION } from "@siteguard/core";
import { CheckResult, Incident, Settings, Site, ensureIndexes, getSettings, mongoose, Types } from "../src";
import { startTestDb } from "./setup-mongo";

let db: Awaited<ReturnType<typeof startTestDb>>;

beforeAll(async () => {
  db = await startTestDb();
  await ensureIndexes();
});

afterAll(async () => {
  await db?.stop();
});

describe("ensureIndexes", () => {
  it("creates checkResults as a time-series collection with 30-day TTL", async () => {
    const [info] = await mongoose.connection.db!.listCollections({ name: "checkResults" }, { nameOnly: false }).toArray();
    expect(info?.type).toBe("timeseries");
    const options = (info as { options?: Record<string, unknown> } | undefined)?.options ?? {};
    expect(options.timeseries).toMatchObject({ timeField: "checkedAt", metaField: "meta", granularity: "minutes" });
    expect(options.expireAfterSeconds).toBe(RETENTION.checkResultsDays * 86400);
  });

  it("is idempotent", async () => {
    const dropped = await ensureIndexes();
    expect(Object.values(dropped).flat()).toEqual([]);
  });

  it("puts a 90-day TTL on notifications", async () => {
    const idx = await mongoose.connection.db!.collection("notifications").indexes();
    expect(idx.find((i) => i.key.createdAt === 1)?.expireAfterSeconds).toBe(90 * 86400);
  });
});

describe("Incident: one open incident per site + check type", () => {
  const siteId = new Types.ObjectId();
  const base = { siteId, checkType: "uptime" as const, severity: "CRITICAL" as const, title: "Site down", startedAt: new Date() };

  beforeEach(async () => {
    await Incident.deleteMany({});
  });

  it("rejects a second OPEN incident for the same site + check", async () => {
    await Incident.create(base);
    await expect(Incident.create(base)).rejects.toMatchObject({ code: 11000 });
  });

  it("treats ACKNOWLEDGED as still open", async () => {
    await Incident.create({ ...base, status: "ACKNOWLEDGED" });
    await expect(Incident.create(base)).rejects.toMatchObject({ code: 11000 });
  });

  it("allows a new incident once the previous one is RESOLVED", async () => {
    const first = await Incident.create(base);
    first.status = "RESOLVED";
    first.resolvedAt = new Date();
    await first.save();
    expect(first.isOpen).toBe(false);
    await expect(Incident.create(base)).resolves.toBeTruthy();
  });

  it("allows parallel open incidents for different check types", async () => {
    await Incident.create(base);
    await expect(Incident.create({ ...base, checkType: "ssl", severity: "WARNING" })).resolves.toBeTruthy();
  });
});

describe("Site", () => {
  it("enforces unique URLs and applies check defaults", async () => {
    const site = await Site.create({ name: "Demo", url: "https://example.com" });
    expect(site.checks?.uptime?.enabled).toBe(true);
    expect(site.checks?.form?.enabled).toBe(false); // browser form check is opt-in
    expect(site.current?.health).toBe("unknown");
    await expect(Site.create({ name: "Dup", url: "https://example.com" })).rejects.toMatchObject({ code: 11000 });
  });
});

describe("CheckResult", () => {
  it("stores and queries results by meta", async () => {
    const siteId = new Types.ObjectId();
    await CheckResult.insertMany([
      { checkedAt: new Date(Date.now() - 60_000), meta: { siteId, checkType: "uptime" }, status: "OK", metrics: { responseTimeMs: 120 } },
      { checkedAt: new Date(), meta: { siteId, checkType: "uptime" }, status: "FAIL", metrics: { statusCode: 500 } },
    ]);
    const latest = await CheckResult.findOne({ "meta.siteId": siteId, "meta.checkType": "uptime" }).sort({ checkedAt: -1 }).lean();
    expect(latest?.status).toBe("FAIL");
  });
});

describe("getSettings", () => {
  it("creates the singleton with defaults exactly once", async () => {
    const [a, b] = await Promise.all([getSettings(), getSettings()]);
    expect(a._id).toBe("global");
    expect(b.intervals?.uptime).toBe(DEFAULT_INTERVALS.uptime);
    expect(a.email?.reservedForReports).toBe(10);
    expect(await Settings.countDocuments()).toBe(1);
  });
});
