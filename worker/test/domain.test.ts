import { readFileSync } from "node:fs";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { domainInfo, sslHostVariants } from "@siteguard/core";
import { DomainCache } from "@siteguard/db";
import { startTestDb } from "../../packages/db/test/setup-mongo";
import { createDomainCheck } from "../src/checks/domain";
import { parseWhois, resetRdapBootstrap, type WhoisQuery } from "../src/lib/rdap";
import { makeCtx, makeSite } from "./helpers";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/rdap/${name}`, import.meta.url), "utf8"));

const NOW = new Date("2026-09-24T06:00:00Z");
const calls: string[] = [];
const server = setupServer(
  http.get("https://data.iana.org/rdap/dns.json", ({ request }) => {
    calls.push(request.url);
    return HttpResponse.json(fixture("iana-bootstrap.json"));
  }),
  http.get("https://rdap.verisign.com/com/v1/domain/:name", ({ params, request }) => {
    calls.push(request.url);
    return params.name === "acmedental.com" ? HttpResponse.json(fixture("com-acme.json")) : HttpResponse.json({ errorCode: 404 }, { status: 404 });
  }),
  http.get("https://rdap.registry.in/domain/:name", ({ params, request }) => {
    calls.push(request.url);
    if (params.name === "acmeclinic.in") return HttpResponse.json(fixture("in-acme.json"));
    if (params.name === "client.co.in") return HttpResponse.json(fixture("coin-client.json"));
    return HttpResponse.json({ errorCode: 404, title: "Not Found" }, { status: 404 });
  }),
);

let db: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  server.listen({ onUnhandledRequest: "error" });
  db = await startTestDb();
});
afterAll(async () => {
  server.close();
  await db?.stop();
});
beforeEach(async () => {
  calls.length = 0;
  resetRdapBootstrap();
  await DomainCache.deleteMany({});
});
afterEach(() => server.resetHandlers());

const noWhois: WhoisQuery = async () => {
  throw new Error("whois must not be called");
};
const check = createDomainCheck({ now: () => NOW, whois: noWhois });

describe("domainInfo (Public Suffix List)", () => {
  it("finds the registrable domain for .com, .in and .co.in", () => {
    expect(domainInfo("https://www.acmedental.com").registrable).toBe("acmedental.com");
    expect(domainInfo("https://shop.acmeclinic.in/x").registrable).toBe("acmeclinic.in");
    expect(domainInfo("https://blog.client.co.in").registrable).toBe("client.co.in");
    expect(domainInfo("https://client.co.in").publicSuffix).toBe("co.in");
  });

  it("marks platform subdomains as managed by the platform", () => {
    for (const host of ["acme.vercel.app", "acme.netlify.app", "acme.github.io", "acme.pages.dev", "acme.onrender.com", "shop.myshopify.com"]) {
      const info = domainInfo(host);
      expect(info.platform, host).toBeTruthy();
      expect(info.registrable, host).toBeNull();
    }
    // A custom domain on the same platform is the client's own.
    expect(domainInfo("acme.com").platform).toBeNull();
  });

  it("treats localhost / IPs as local", () => {
    expect(domainInfo("http://localhost:3000").local).toBe(true);
    expect(domainInfo("http://127.0.0.1:3000").local).toBe(true);
  });

  it("SSL checks apex + www only for apex/www sites", () => {
    expect(sslHostVariants("www.acme.co.in")).toEqual(["acme.co.in", "www.acme.co.in"]);
    expect(sslHostVariants("acme.com")).toEqual(["acme.com", "www.acme.com"]);
    expect(sslHostVariants("blog.acme.com")).toEqual(["blog.acme.com"]);
    expect(sslHostVariants("acme.vercel.app")).toEqual(["acme.vercel.app"]);
  });
});

describe("domain expiry check (RDAP)", () => {
  it(".com: registrar + expiry, OK", async () => {
    const r = await check.run(makeSite("https://www.acmedental.com"), makeCtx());
    expect(r.status).toBe("OK");
    expect(r.details).toMatchObject({ domain: "acmedental.com", registrar: "GoDaddy.com, LLC", expiresAt: "2027-03-10T08:12:33.000Z", source: "rdap" });
    expect(r.metrics.daysLeft).toBe(167);
    expect(r.message).toContain("GoDaddy.com, LLC");
  });

  it(".in: expiring within 30 days → WARN", async () => {
    const r = await check.run(makeSite("https://acmeclinic.in"), makeCtx());
    expect(r).toMatchObject({ status: "WARN", reason: "domain_expiring" });
    expect(r.metrics.daysLeft).toBe(16);
    expect(r.details).toMatchObject({ registrar: "ERA Infotech Limited", nameservers: ["dns1.hostinger.in", "dns2.hostinger.in"] });
  });

  it(".co.in: a subdomain site checks the registrable domain; ≤ 7 days → FAIL", async () => {
    const r = await check.run(makeSite("https://blog.client.co.in"), makeCtx());
    expect(r).toMatchObject({ status: "FAIL", reason: "domain_expiring" });
    expect(r.details).toMatchObject({ domain: "client.co.in", registrar: "GoDaddy.com, LLC" });
    expect(calls.some((u) => u.endsWith("/domain/client.co.in"))).toBe(true);
    expect(calls.some((u) => u.includes("co.in") && !u.endsWith("client.co.in"))).toBe(false);
  });

  it("expired → FAIL domain_expired", async () => {
    const later = createDomainCheck({ now: () => new Date("2026-10-12T00:00:00Z"), whois: noWhois });
    const r = await later.run(makeSite("https://acmeclinic.in"), makeCtx());
    expect(r).toMatchObject({ status: "FAIL", reason: "domain_expired" });
  });

  it("caches per registrable domain: several sites → one lookup", async () => {
    await check.run(makeSite("https://www.acmedental.com"), makeCtx());
    const lookups = calls.filter((u) => u.includes("/domain/")).length;
    const r2 = await check.run(makeSite("https://shop.acmedental.com"), makeCtx());
    const r3 = await check.run(makeSite("https://blog.acmedental.com"), makeCtx());
    expect(calls.filter((u) => u.includes("/domain/")).length).toBe(lookups);
    expect(r2.details).toMatchObject({ cached: true, registrar: "GoDaddy.com, LLC" });
    expect(r3.status).toBe("OK");
    expect(await DomainCache.countDocuments({ domain: "acmedental.com" })).toBe(1);
  });

  it("platform subdomain → OK 'Managed by platform', no lookup", async () => {
    const r = await check.run(makeSite("https://acme-dental.vercel.app"), makeCtx());
    expect(r).toMatchObject({ status: "OK", reason: "platform_managed" });
    expect(r.message).toContain("Managed by platform");
    expect(calls).toHaveLength(0);
  });

  it("unknown domain → UNKNOWN (never alerts)", async () => {
    const r = await check.run(makeSite("https://not-registered-xyz.com"), makeCtx());
    expect(r).toMatchObject({ status: "UNKNOWN", reason: "lookup_failed" });
  });

  it("falls back to WHOIS when the TLD has no RDAP server", async () => {
    const queries: string[] = [];
    const whois: WhoisQuery = async (srv, q) => {
      queries.push(`${srv} ${q}`);
      if (srv === "whois.iana.org") return "domain:       XYZ\nwhois:        whois.nic.xyz\n";
      return "Domain Name: ACME.XYZ\nRegistrar: Namecheap, Inc.\nRegistry Expiry Date: 2027-01-15T10:00:00Z\nName Server: NS1.ACME.XYZ\n";
    };
    const r = await createDomainCheck({ now: () => NOW, whois }).run(makeSite("https://acme.xyz"), makeCtx());
    expect(r.status).toBe("OK");
    expect(r.details).toMatchObject({ registrar: "Namecheap, Inc.", source: "whois", expiresAt: "2027-01-15T10:00:00.000Z" });
    expect(queries).toEqual(["whois.iana.org xyz", "whois.nic.xyz acme.xyz"]);
  });
});

describe("parseWhois", () => {
  it("reads common formats", () => {
    const d = parseWhois("x.in", "Registrar: ERA Infotech Limited\nExpiry Date: 2027-02-01T00:00:00Z\nCreation Date: 2019-01-01\n", "whois.registry.in");
    expect(d.registrar).toBe("ERA Infotech Limited");
    expect(d.expiresAt?.toISOString()).toBe("2027-02-01T00:00:00.000Z");
  });
});
