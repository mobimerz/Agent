import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CheckResult, createBackup, Incident, listBackups, mongoose, pruneBackups, restoreBackup, Site, Types } from "../src";
import { startTestDb } from "./setup-mongo";

let db: Awaited<ReturnType<typeof startTestDb>>;
let dir: string;

beforeAll(async () => {
  db = await startTestDb();
  dir = await mkdtemp(join(tmpdir(), "siteguard-backup-"));
});
afterAll(async () => {
  await db?.stop();
  await rm(dir, { recursive: true, force: true });
});

describe("backup & restore", () => {
  it("round-trips every collection with exact types (ObjectId, Date, time-series)", async () => {
    const site = await Site.create({ name: "Acme Dental", url: "https://acme.example", tags: ["dental"] });
    const t = new Date("2026-09-28T01:02:03.456Z");
    await CheckResult.create([
      { checkedAt: t, meta: { siteId: site._id, checkType: "uptime" }, status: "OK", metrics: { responseTimeMs: 321 } },
      { checkedAt: new Date(t.getTime() + 60_000), meta: { siteId: site._id, checkType: "uptime" }, status: "FAIL", reason: "timeout" },
    ]);
    await Incident.create({ siteId: site._id, checkType: "uptime", severity: "CRITICAL", title: "Site is down", startedAt: t });
    // A collection no model knows about (e.g. Better Auth's users) is backed up too.
    await mongoose.connection.db!.collection("user").insertOne({ email: "admin@acme.example", createdAt: t });

    const backup = await createBackup(dir, new Date("2026-09-28T02:30:00Z"));
    expect(backup.name).toBe("siteguard-2026-09-28_0230");
    expect(await readdir(backup.path)).toEqual(expect.arrayContaining(["manifest.json", "sites.jsonl.gz", "checkResults.jsonl.gz", "incidents.jsonl.gz", "user.jsonl.gz"]));

    // Disaster: everything gone.
    await Promise.all([Site.deleteMany({}), CheckResult.deleteMany({}), Incident.deleteMany({}), mongoose.connection.db!.collection("user").deleteMany({})]);
    expect(await Site.countDocuments()).toBe(0);

    const res = await restoreBackup(backup.path);
    expect(res.collections).toMatchObject({ sites: 1, checkResults: 2, incidents: 1, user: 1 });

    const restored = (await Site.findById(site._id).lean())!;
    expect(restored._id).toBeInstanceOf(Types.ObjectId);
    expect(restored.name).toBe("Acme Dental");
    const results = await CheckResult.find({ "meta.siteId": site._id }).sort({ checkedAt: 1 }).lean();
    expect(results.map((r) => r.checkedAt.toISOString())).toEqual([t.toISOString(), new Date(t.getTime() + 60_000).toISOString()]);
    expect(results[0]!.metrics).toEqual({ responseTimeMs: 321 });
    expect((await mongoose.connection.db!.collection("user").findOne({}))!.createdAt).toEqual(t);
  });

  it("lists newest first and prunes by age, always keeping the newest", async () => {
    await createBackup(dir, new Date("2026-09-20T02:30:00Z"));
    await createBackup(dir, new Date("2026-09-27T02:30:00Z"));
    expect((await listBackups(dir)).map((b) => b.name)).toEqual(["siteguard-2026-09-28_0230", "siteguard-2026-09-27_0230", "siteguard-2026-09-20_0230"]);

    const removed = await pruneBackups(dir, 7, new Date("2026-09-28T03:00:00Z"));
    expect(removed).toEqual(["siteguard-2026-09-20_0230"]);
    // Even a very old single backup is never deleted.
    const removedAll = await pruneBackups(dir, 0, new Date("2030-01-01T00:00:00Z"));
    expect(removedAll).toEqual(["siteguard-2026-09-27_0230"]);
    expect((await listBackups(dir)).map((b) => b.name)).toEqual(["siteguard-2026-09-28_0230"]);
  });

  it("refuses a folder that isn't a backup", async () => {
    await expect(restoreBackup(dir)).rejects.toThrow(/not a SiteGuard backup/);
  });
});
