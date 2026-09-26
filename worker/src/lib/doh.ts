import { Resolver } from "node:dns/promises";
import { USER_AGENT } from "@siteguard/core";
import type { DnsResolver } from "../checks/dns";

const TYPE_CODES = { A: 1, NS: 2, CNAME: 5, MX: 15, AAAA: 28 } as const;
type RecordType = keyof typeof TYPE_CODES;

const dnsError = (code: string, host: string) => Object.assign(new Error(`${code} ${host}`), { code });

/**
 * DNS-over-HTTPS (JSON API, Cloudflare then Google). Used when the machine's
 * resolver can't be queried directly — e.g. a local DNS proxy on 127.0.0.1
 * that answers the OS but refuses raw queries (common on Windows / VPNs).
 */
export class DohResolver implements DnsResolver {
  constructor(
    private readonly endpoints = ["https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"],
    private readonly timeoutMs = 8000,
  ) {}

  private async query(host: string, type: RecordType): Promise<string[]> {
    let lastErr: unknown;
    for (const endpoint of this.endpoints) {
      try {
        const url = `${endpoint}?name=${encodeURIComponent(host)}&type=${type}`;
        const res = await fetch(url, { headers: { accept: "application/dns-json", "user-agent": USER_AGENT }, signal: AbortSignal.timeout(this.timeoutMs) });
        if (!res.ok) throw dnsError("ESERVFAIL", host);
        const body = (await res.json()) as { Status: number; Answer?: { type: number; data: string }[] };
        if (body.Status === 3) throw dnsError("ENOTFOUND", host);
        if (body.Status !== 0) throw dnsError("ESERVFAIL", host);
        const values = (body.Answer ?? []).filter((a) => a.type === TYPE_CODES[type]).map((a) => a.data);
        if (!values.length) throw dnsError("ENODATA", host);
        return values;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "ENOTFOUND" || code === "ENODATA") throw err; // a real answer, don't ask the next server
        lastErr = err;
      }
    }
    throw Object.assign(new Error(`DoH failed for ${host}`), { code: (lastErr as { code?: string })?.code ?? "ETIMEOUT" });
  }

  resolve4(host: string) {
    return this.query(host, "A");
  }
  resolve6(host: string) {
    return this.query(host, "AAAA");
  }
  resolveCname(host: string) {
    return this.query(host, "CNAME");
  }
  resolveNs(host: string) {
    return this.query(host, "NS");
  }
  async resolveMx(host: string) {
    return (await this.query(host, "MX")).map((v) => {
      const [priority, exchange = ""] = v.split(/\s+/);
      return { priority: Number(priority), exchange };
    });
  }
}

/** The system resolver couldn't be reached (not "no such record"). */
const UNREACHABLE = new Set(["ECONNREFUSED", "ETIMEOUT", "ECONNRESET", "EREFUSED", "ECANCELLED"]);
const SKIP_SYSTEM_MS = 10 * 60_000;

/**
 * System resolver first (what the site's visitors see), DoH when the system
 * resolver is unreachable. After one such failure, DoH is used directly for
 * 10 minutes so every check doesn't wait on a dead resolver.
 */
export class FallbackResolver implements DnsResolver {
  private systemDownUntil = 0;
  private readonly system = new Resolver({ timeout: 5000, tries: 2 });
  private readonly doh = new DohResolver();

  private async run<T>(fn: (r: DnsResolver) => Promise<T>): Promise<T> {
    if (Date.now() >= this.systemDownUntil) {
      try {
        return await fn(this.system);
      } catch (err) {
        if (!UNREACHABLE.has((err as { code?: string }).code ?? "")) throw err;
        this.systemDownUntil = Date.now() + SKIP_SYSTEM_MS;
      }
    }
    return fn(this.doh);
  }

  resolve4(host: string) {
    return this.run((r) => r.resolve4(host));
  }
  resolve6(host: string) {
    return this.run((r) => r.resolve6(host));
  }
  resolveCname(host: string) {
    return this.run((r) => r.resolveCname(host));
  }
  resolveNs(host: string) {
    return this.run((r) => r.resolveNs(host));
  }
  resolveMx(host: string) {
    return this.run((r) => r.resolveMx(host));
  }
}
