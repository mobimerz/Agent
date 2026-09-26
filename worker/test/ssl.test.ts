import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS } from "@siteguard/core";
import { createSslCheck, evaluateProbe, probeCertificate, type CertProbe } from "../src/checks/ssl";
import { makeCtx, makeSite } from "./helpers";

const pem = (f: string) => readFileSync(new URL(`./fixtures/tls/${f}`, import.meta.url), "utf8");
const CA = pem("ca.crt");

/** TLS server presenting `cert` (optionally + chain) for every SNI name. */
async function tlsServer(cert: string, key: string): Promise<{ port: number; server: Server }> {
  const server = createServer({ cert, key }, (s) => s.end());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { port: (server.address() as AddressInfo).port, server };
}

const servers: Server[] = [];
let full: number, leafOnly: number, other: number, self: number;

beforeAll(async () => {
  const mk = async (cert: string, key: string) => {
    const s = await tlsServer(cert, key);
    servers.push(s.server);
    return s.port;
  };
  full = await mk(pem("leaf.crt") + pem("int.crt"), pem("leaf.key"));
  leafOnly = await mk(pem("leaf.crt"), pem("leaf.key"));
  other = await mk(pem("other.crt") + pem("int.crt"), pem("other.key"));
  self = await mk(pem("self.crt"), pem("self.key"));
});
afterAll(() => {
  for (const s of servers) s.close();
});

const probe = (host: string, port: number) => probeCertificate(host, "127.0.0.1", { port, ca: CA, timeoutMs: 3000 });

describe("probeCertificate", () => {
  it("complete chain, matching host → trusted", async () => {
    const p = await probe("siteguard.test", full);
    expect(p).toMatchObject({ connected: true, hostnameMatch: true, chainComplete: true, trusted: true, subject: "siteguard.test", issuer: "SiteGuard Test Intermediate CA" });
    expect(p.altNames).toEqual(["siteguard.test", "www.siteguard.test"]);
    expect(p.daysLeft).toBeGreaterThan(30_000);
  });

  it("detects a missing intermediate certificate", async () => {
    const p = await probe("siteguard.test", leafOnly);
    expect(p.chainComplete).toBe(false);
    expect(p.authError).toBe("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    expect(evaluateProbe(p, DEFAULT_THRESHOLDS, { primary: true, siteIsHttps: true })).toMatchObject({ status: "FAIL", reason: "ssl_chain" });
  });

  it("detects a hostname mismatch", async () => {
    const p = await probe("siteguard.test", other);
    expect(p).toMatchObject({ hostnameMatch: false, trusted: true });
    expect(evaluateProbe(p, DEFAULT_THRESHOLDS, { primary: true, siteIsHttps: true })).toMatchObject({ status: "FAIL", reason: "ssl_hostname" });
  });

  it("detects a self-signed certificate", async () => {
    const p = await probe("siteguard.test", self);
    expect(p.selfSigned).toBe(true);
    expect(evaluateProbe(p, DEFAULT_THRESHOLDS, { primary: true, siteIsHttps: true })).toMatchObject({ status: "FAIL", reason: "ssl_untrusted" });
  });

  it("reports a closed port as a connection error", async () => {
    const p = await probeCertificate("siteguard.test", "127.0.0.1", { port: 1, timeoutMs: 2000 });
    expect(p.connected).toBe(false);
    // Primary https host unreachable → uptime owns it; a www twin without HTTPS → WARN.
    expect(evaluateProbe(p, DEFAULT_THRESHOLDS, { primary: true, siteIsHttps: true }).status).toBe("UNKNOWN");
    expect(evaluateProbe(p, DEFAULT_THRESHOLDS, { primary: false, siteIsHttps: true })).toMatchObject({ status: "WARN", reason: "no_https" });
  });
});

describe("evaluateProbe expiry", () => {
  const base: CertProbe = { host: "a.test", connected: true, hostnameMatch: true, chainComplete: true, trusted: true, selfSigned: false, validTo: "2026-10-01T00:00:00.000Z" };
  const t = { sslWarnDays: 30, sslFailDays: 7 };
  const opts = { primary: true, siteIsHttps: true };
  it("maps days left to OK / WARN / FAIL / expired", () => {
    expect(evaluateProbe({ ...base, daysLeft: 80 }, t, opts).status).toBe("OK");
    expect(evaluateProbe({ ...base, daysLeft: 20 }, t, opts)).toMatchObject({ status: "WARN", reason: "ssl_expiring" });
    expect(evaluateProbe({ ...base, daysLeft: 5 }, t, opts)).toMatchObject({ status: "FAIL", reason: "ssl_expiring" });
    expect(evaluateProbe({ ...base, daysLeft: -1, trusted: false, authError: "CERT_HAS_EXPIRED" }, t, opts)).toMatchObject({ status: "FAIL", reason: "ssl_expired" });
  });
});

describe("ssl check: apex + www", () => {
  const siteCtx = () => makeCtx({ timeoutMs: 3000 });

  it("checks both apex and www when both resolve", async () => {
    const check = createSslCheck({ port: full, ca: CA, resolve: async () => "127.0.0.1" });
    const r = await check.run(makeSite("https://siteguard.test"), siteCtx());
    expect(r.status).toBe("OK");
    expect((r.details!.hosts as CertProbe[]).map((h) => h.host)).toEqual(["siteguard.test", "www.siteguard.test"]);
    expect(r.message).toContain("siteguard.test + www.siteguard.test");
  });

  it("skips www when it does not resolve", async () => {
    const check = createSslCheck({ port: full, ca: CA, resolve: async (h) => (h.startsWith("www.") ? null : "127.0.0.1") });
    const r = await check.run(makeSite("https://siteguard.test"), siteCtx());
    expect(r.status).toBe("OK");
    expect(r.details!.skipped).toEqual(["www.siteguard.test"]);
  });

  it("flags www when its certificate doesn't cover it", async () => {
    // Serve other.test's certificate: both names mismatch; the result lists each host.
    const check = createSslCheck({ port: other, ca: CA, resolve: async () => "127.0.0.1" });
    const r = await check.run(makeSite("https://www.siteguard.test"), siteCtx());
    expect(r).toMatchObject({ status: "FAIL", reason: "ssl_hostname" });
    expect(r.message).toContain("www.siteguard.test");
  });

  it("local http targets are not applicable", async () => {
    const r = await createSslCheck().run(makeSite("http://localhost:3000"), siteCtx());
    expect(r).toMatchObject({ status: "UNKNOWN", reason: "not_applicable" });
  });
});
