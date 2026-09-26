import { BlockList, isIP } from "node:net";
import { domainInfo } from "@siteguard/core";
import { FallbackResolver } from "../lib/doh";
import type { CheckModule, CheckRunResult } from "./types";

export const DNS_RECORD_TYPES = ["a", "aaaa", "cname", "ns", "mx"] as const;
export type DnsRecordType = (typeof DNS_RECORD_TYPES)[number];
export type DnsRecords = Record<DnsRecordType, string[]>;

export interface DnsChange {
  type: DnsRecordType;
  added: string[];
  removed: string[];
}

/** Minimal resolver surface (node:dns/promises Resolver), injectable for tests. */
export interface DnsResolver {
  resolve4(host: string): Promise<string[]>;
  resolve6(host: string): Promise<string[]>;
  resolveCname(host: string): Promise<string[]>;
  resolveNs(host: string): Promise<string[]>;
  resolveMx(host: string): Promise<{ priority: number; exchange: string }[]>;
}

/** https://www.cloudflare.com/ips/ (stable for years; update if Cloudflare announces new ranges). */
export const CLOUDFLARE_RANGES = {
  v4: [
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
    "162.158.0.0/15",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "172.64.0.0/13",
    "131.0.72.0/22",
  ],
  v6: ["2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32"],
};

const cloudflare = new BlockList();
for (const cidr of CLOUDFLARE_RANGES.v4) {
  const [net, bits] = cidr.split("/");
  cloudflare.addSubnet(net!, Number(bits), "ipv4");
}
for (const cidr of CLOUDFLARE_RANGES.v6) {
  const [net, bits] = cidr.split("/");
  cloudflare.addSubnet(net!, Number(bits), "ipv6");
}

export function isCloudflareIp(ip: string): boolean {
  const v = isIP(ip);
  return v ? cloudflare.check(ip, v === 4 ? "ipv4" : "ipv6") : false;
}

const allCloudflare = (ips: string[]) => ips.length > 0 && ips.every(isCloudflareIp);

/** Record values normalised for set comparison: lowercase, no trailing dot, sorted, unique. TTLs are never fetched. */
export function normalizeRecords(r: Partial<DnsRecords>): DnsRecords {
  const norm = (v: string[] | undefined) => [...new Set((v ?? []).map((s) => s.trim().toLowerCase().replace(/\.$/, "").trim()).filter(Boolean))].sort();
  return { a: norm(r.a), aaaa: norm(r.aaaa), cname: norm(r.cname), ns: norm(r.ns), mx: norm(r.mx) };
}

export function diffRecords(baseline: DnsRecords, current: DnsRecords): DnsChange[] {
  const out: DnsChange[] = [];
  for (const type of DNS_RECORD_TYPES) {
    const before = new Set(baseline[type]);
    const after = new Set(current[type]);
    const added = [...after].filter((v) => !before.has(v));
    const removed = [...before].filter((v) => !after.has(v));
    if (added.length || removed.length) out.push({ type, added, removed });
  }
  return out;
}

export function isBehindCloudflare(r: DnsRecords): boolean {
  return (r.ns.length > 0 && r.ns.every((n) => n.endsWith(".ns.cloudflare.com"))) || allCloudflare([...r.a, ...r.aaaa]);
}

/**
 * Which changes are worth an alert.
 * - A/AAAA moving *within* Cloudflare's ranges is Cloudflare's anycast housekeeping → ignored.
 * - A/AAAA changing under an unchanged CNAME is the target platform's load balancing → ignored.
 * - NS changes always count (incl. behind Cloudflare), as do CNAME and MX.
 */
export function meaningfulChanges(baseline: DnsRecords, current: DnsRecords): { alert: DnsChange[]; ignored: DnsChange[] } {
  const changes = diffRecords(baseline, current);
  const alert: DnsChange[] = [];
  const ignored: DnsChange[] = [];
  const cnameSame = baseline.cname.length > 0 && !changes.some((c) => c.type === "cname");
  for (const c of changes) {
    if (c.type === "a" || c.type === "aaaa") {
      const inCf = allCloudflare(baseline[c.type]) && allCloudflare(current[c.type]);
      if (inCf || cnameSame) {
        ignored.push(c);
        continue;
      }
    }
    alert.push(c);
  }
  return { alert, ignored };
}

const EMPTY_CODES = new Set(["ENODATA", "ENOTFOUND", "NODATA", "NOTFOUND"]);

type Safe<T> = { values: T[]; error?: string };

async function safe<T>(p: Promise<T[]>): Promise<Safe<T>> {
  try {
    return { values: await p };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "ERROR";
    return EMPTY_CODES.has(code) ? { values: [] } : { values: [], error: code };
  }
}

export async function lookupRecords(resolver: DnsResolver, host: string, zone: string | null): Promise<{ records: DnsRecords; errors: string[]; nxdomain: boolean }> {
  const [a, aaaa, cname, ns, mx] = await Promise.all([
    safe(resolver.resolve4(host)),
    safe(resolver.resolve6(host)),
    safe(resolver.resolveCname(host)),
    zone ? safe(resolver.resolveNs(zone)) : Promise.resolve<Safe<string>>({ values: [] }),
    zone ? safe(resolver.resolveMx(zone)) : Promise.resolve<Safe<{ priority: number; exchange: string }>>({ values: [] }),
  ]);
  const errors = [a, aaaa, cname, ns, mx].flatMap((r, i) => (r.error ? [`${DNS_RECORD_TYPES[i]!.toUpperCase()}: ${r.error}`] : []));
  const records = normalizeRecords({
    a: a.values,
    aaaa: aaaa.values,
    cname: cname.values,
    ns: ns.values,
    mx: mx.values.map((m) => `${m.priority} ${m.exchange}`),
  });
  const nxdomain = !records.a.length && !records.aaaa.length && !records.cname.length;
  return { records, errors, nxdomain };
}

function describe(changes: DnsChange[]): string {
  return changes
    .map((c) => {
      const parts = [c.added.length ? `+${c.added.join(", +")}` : "", c.removed.length ? `−${c.removed.join(", −")}` : ""].filter(Boolean);
      return `${c.type.toUpperCase()} ${parts.join(" ")}`;
    })
    .join("; ");
}

/** Shared: remembers when the system resolver is unreachable (see FallbackResolver). */
const defaultResolver = new FallbackResolver();

export function createDnsCheck(opts: { resolver?: DnsResolver } = {}): CheckModule {
  return {
    type: "dns",
    queue: "http",
    maxRunMs: 60_000,

    async run(site, ctx): Promise<CheckRunResult> {
      const info = domainInfo(site.url);
      if (info.local) return { status: "UNKNOWN", reason: "not_applicable", message: "Local/IP target — no DNS to watch", metrics: {} };

      // NS/MX belong to the client's zone; a platform subdomain has none of its own.
      const zone = info.platform ? null : info.registrable;
      const { records, errors } = await lookupRecords(opts.resolver ?? defaultResolver, info.hostname, zone);
      const prev = ctx.jobData as { baseline?: DnsRecords; baselineAt?: string };
      const now = new Date().toISOString();
      const behindCloudflare = isBehindCloudflare(records);
      const metrics = { behindCloudflare, recordCount: DNS_RECORD_TYPES.reduce((n, t) => n + records[t].length, 0) };

      if (errors.length) {
        // A resolver hiccup must not look like "records removed".
        return { status: "UNKNOWN", reason: "lookup_failed", message: `DNS lookup failed (${errors.join(", ")})`, metrics, details: { records, errors } };
      }

      if (!prev.baseline) {
        return {
          status: "OK",
          reason: "ok",
          message: `Baseline saved: ${summary(records)}`,
          metrics,
          details: { records, baseline: records, changes: [], ignored: [], behindCloudflare, zone },
          jobData: { baseline: records, baselineAt: now, observed: records, observedAt: now },
        };
      }

      const baseline = normalizeRecords(prev.baseline);
      const { alert, ignored } = meaningfulChanges(baseline, records);
      // Silently follow ignorable moves (Cloudflare anycast / CNAME target IPs) so they never pile up.
      const nextBaseline = { ...baseline };
      for (const c of ignored) nextBaseline[c.type] = records[c.type];
      const jobData = { baseline: nextBaseline, baselineAt: prev.baselineAt ?? now, observed: records, observedAt: now, pending: alert };
      const details = { records, baseline: nextBaseline, baselineAt: prev.baselineAt, changes: alert, ignored, behindCloudflare, zone };

      if (alert.length) {
        return { status: "WARN", reason: "dns_changed", message: `DNS changed: ${describe(alert)}`, metrics: { ...metrics, changes: alert.length }, details, jobData };
      }
      return {
        status: "OK",
        reason: "ok",
        message: ignored.length ? `No meaningful change (${behindCloudflare ? "Cloudflare" : "CNAME target"} IPs rotated) · ${summary(records)}` : `Unchanged · ${summary(records)}`,
        metrics: { ...metrics, changes: 0 },
        details,
        jobData,
      };
    },
  };
}

function summary(r: DnsRecords): string {
  return DNS_RECORD_TYPES.filter((t) => r[t].length)
    .map((t) => `${t.toUpperCase()} ${r[t].length}`)
    .join(", ") || "no records";
}

export const dnsCheck = createDnsCheck();
