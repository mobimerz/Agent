import { describe, expect, it } from "vitest";
import { createDnsCheck, diffRecords, isCloudflareIp, meaningfulChanges, normalizeRecords, type DnsRecords, type DnsResolver } from "../src/checks/dns";
import type { CheckRunResult } from "../src/checks/types";
import { makeCtx, makeSite } from "./helpers";

type Zone = Partial<DnsRecords> & { mxRaw?: { priority: number; exchange: string }[]; fail?: string };

function fakeResolver(zone: () => Zone): DnsResolver {
  const get = async <T>(v: T[] | undefined): Promise<T[]> => {
    const z = zone();
    if (z.fail) throw Object.assign(new Error(z.fail), { code: z.fail });
    if (!v?.length) throw Object.assign(new Error("ENODATA"), { code: "ENODATA" });
    return v;
  };
  return {
    resolve4: () => get(zone().a),
    resolve6: () => get(zone().aaaa),
    resolveCname: () => get(zone().cname),
    resolveNs: () => get(zone().ns),
    resolveMx: () => get(zone().mxRaw),
  };
}

/** Run the check repeatedly like the scheduler does, carrying jobData forward. */
function runner(zone: () => Zone, url = "https://acme.co.in") {
  const check = createDnsCheck({ resolver: fakeResolver(zone) });
  let jobData: Record<string, unknown> = {};
  return async (): Promise<CheckRunResult> => {
    const r = await check.run(makeSite(url), makeCtx({ jobData }));
    if (r.jobData) jobData = r.jobData;
    return r;
  };
}

const base: Zone = {
  a: ["203.0.113.10", "203.0.113.11"],
  ns: ["ns1.hostinger.in.", "NS2.hostinger.in"],
  mxRaw: [
    { priority: 10, exchange: "mx1.hostinger.in" },
    { priority: 20, exchange: "mx2.hostinger.in." },
  ],
};

describe("record comparison", () => {
  it("compares as sets: order, case and trailing dots don't matter (TTL is never read)", () => {
    const a = normalizeRecords({ a: ["1.1.1.1", "2.2.2.2"], ns: ["NS1.X.COM."] });
    const b = normalizeRecords({ a: ["2.2.2.2", "1.1.1.1", "1.1.1.1"], ns: ["ns1.x.com"] });
    expect(diffRecords(a, b)).toEqual([]);
  });

  it("knows Cloudflare ranges", () => {
    expect(isCloudflareIp("104.21.32.1")).toBe(true);
    expect(isCloudflareIp("172.67.1.1")).toBe(true);
    expect(isCloudflareIp("2606:4700:3030::6815:2001")).toBe(true);
    expect(isCloudflareIp("203.0.113.10")).toBe(false);
  });

  it("ignores A/AAAA moves within Cloudflare, but not NS changes", () => {
    const before = normalizeRecords({ a: ["104.21.32.1", "172.67.1.1"], ns: ["kate.ns.cloudflare.com", "rob.ns.cloudflare.com"] });
    const moved = normalizeRecords({ a: ["104.21.80.9", "172.67.200.2"], ns: ["kate.ns.cloudflare.com", "rob.ns.cloudflare.com"] });
    expect(meaningfulChanges(before, moved).alert).toEqual([]);

    const nsChanged = normalizeRecords({ ...moved, ns: ["ns1.evil-dns.com", "ns2.evil-dns.com"] });
    expect(meaningfulChanges(before, nsChanged).alert.map((c) => c.type)).toEqual(["ns"]);

    // Leaving Cloudflare (proxy off / origin exposed) is meaningful.
    const offCf = normalizeRecords({ ...before, a: ["203.0.113.10"] });
    expect(meaningfulChanges(before, offCf).alert.map((c) => c.type)).toEqual(["a"]);
  });

  it("ignores A changes behind an unchanged CNAME (platform load balancing)", () => {
    const before = normalizeRecords({ cname: ["cname.vercel-dns.com"], a: ["76.76.21.21"] });
    const after = normalizeRecords({ cname: ["cname.vercel-dns.com"], a: ["76.76.21.98"] });
    expect(meaningfulChanges(before, after).alert).toEqual([]);
    const moved = normalizeRecords({ cname: ["acme.netlify.app"], a: ["75.2.60.5"] });
    expect(meaningfulChanges(before, moved).alert.map((c) => c.type).sort()).toEqual(["a", "cname"]);
  });
});

describe("dns check", () => {
  it("records a baseline, then stays OK when only the order changes", async () => {
    let zone = { ...base };
    const run = runner(() => zone);
    const first = await run();
    expect(first).toMatchObject({ status: "OK" });
    expect(first.message).toContain("Baseline saved");

    zone = { ...base, a: ["203.0.113.11", "203.0.113.10"], mxRaw: [...base.mxRaw!].reverse() };
    expect((await run()).status).toBe("OK");
  });

  it("alerts on a real change and keeps alerting until accepted", async () => {
    let zone = { ...base };
    const run = runner(() => zone);
    await run();
    zone = { ...base, a: ["198.51.100.7"], mxRaw: [{ priority: 1, exchange: "smtp.google.com" }] };
    const r = await run();
    expect(r).toMatchObject({ status: "WARN", reason: "dns_changed" });
    expect(r.message).toContain("A +198.51.100.7");
    expect(r.message).toContain("MX +1 smtp.google.com");
    expect((await run()).status).toBe("WARN");

    // Change reverted → OK again.
    zone = { ...base };
    expect((await run()).status).toBe("OK");
  });

  it("accepting a change = baseline becomes the observed records", async () => {
    let zone = { ...base };
    const check = createDnsCheck({ resolver: fakeResolver(() => zone) });
    const site = makeSite("https://acme.co.in");
    let jobData = (await check.run(site, makeCtx())).jobData!;
    zone = { ...base, a: ["198.51.100.7"] };
    const changed = await check.run(site, makeCtx({ jobData }));
    expect(changed.status).toBe("WARN");
    // What the web "Accept this change" action does:
    jobData = { ...changed.jobData!, baseline: changed.jobData!.observed, pending: [] };
    expect((await check.run(site, makeCtx({ jobData }))).status).toBe("OK");
  });

  it("a resolver failure is UNKNOWN, never 'records removed'", async () => {
    let zone: Zone = { ...base };
    const run = runner(() => zone);
    await run();
    zone = { fail: "ETIMEOUT" };
    expect(await run()).toMatchObject({ status: "UNKNOWN", reason: "lookup_failed" });
    zone = { ...base };
    expect((await run()).status).toBe("OK");
  });

  it("platform subdomains watch A/AAAA/CNAME only (no NS/MX of the platform)", async () => {
    const queried: string[] = [];
    const resolver: DnsResolver = {
      resolve4: async () => ["76.76.21.21"],
      resolve6: async () => [],
      resolveCname: async () => ["cname.vercel-dns.com"],
      resolveNs: async (h) => (queried.push(h), []),
      resolveMx: async (h) => (queried.push(h), []),
    };
    const r = await createDnsCheck({ resolver }).run(makeSite("https://acme.vercel.app"), makeCtx());
    expect(r.status).toBe("OK");
    expect(queried).toEqual([]);
  });
});
