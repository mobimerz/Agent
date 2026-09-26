import { DOMAIN_CACHE_HOURS, domainInfo } from "@siteguard/core";
import { DomainCache, type DomainCacheLean } from "@siteguard/db";
import { LookupError, lookupRegistration, type RegistrationData, type WhoisQuery } from "../lib/rdap";
import type { CheckModule, CheckRunResult } from "./types";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface DomainCheckOptions {
  whois?: WhoisQuery;
  now?: () => Date;
}

/**
 * Cached registration data for a registrable domain. Refreshed after
 * DOMAIN_CACHE_HOURS — or hourly while expiry is near, so a renewal clears the
 * alert quickly. A failed lookup keeps serving the last good data.
 */
export async function getRegistration(
  domain: string,
  warnDays: number,
  opts: DomainCheckOptions = {},
): Promise<{ data: Omit<RegistrationData, "domain"> & { domain: string }; cached: boolean; fetchedAt: Date; staleError?: string }> {
  const now = opts.now?.() ?? new Date();
  const cached = await DomainCache.findOne({ domain }).lean();
  const nearExpiry = cached?.expiresAt && cached.expiresAt.getTime() - now.getTime() < warnDays * DAY_MS;
  const ttl = nearExpiry ? HOUR_MS : DOMAIN_CACHE_HOURS * HOUR_MS;
  if (cached && !cached.error && now.getTime() - cached.fetchedAt.getTime() < ttl) {
    return { data: fromCache(cached), cached: true, fetchedAt: cached.fetchedAt };
  }

  try {
    const data = await lookupRegistration(domain, { whois: opts.whois });
    await DomainCache.updateOne(
      { domain },
      {
        $set: {
          registrar: data.registrar,
          expiresAt: data.expiresAt,
          registeredAt: data.registeredAt,
          nameservers: data.nameservers,
          source: data.source,
          server: data.server,
          fetchedAt: now,
        },
        $unset: { error: 1 },
      },
      { upsert: true },
    );
    return { data, cached: false, fetchedAt: now };
  } catch (err) {
    const message = (err as Error).message;
    await DomainCache.updateOne({ domain }, { $set: { error: message, fetchedAt: now } }, { upsert: true });
    if (cached?.expiresAt) return { data: fromCache(cached), cached: true, fetchedAt: cached.fetchedAt, staleError: message };
    throw err;
  }
}

function fromCache(c: DomainCacheLean): RegistrationData {
  return {
    domain: c.domain,
    registrar: c.registrar ?? null,
    expiresAt: c.expiresAt ?? null,
    registeredAt: c.registeredAt ?? null,
    nameservers: c.nameservers ?? [],
    source: (c.source as RegistrationData["source"]) ?? "rdap",
    server: c.server ?? "",
  };
}

export function createDomainCheck(opts: DomainCheckOptions = {}): CheckModule {
  return {
    type: "domain",
    queue: "http",
    maxRunMs: 2 * 60_000,

    async run(site, ctx): Promise<CheckRunResult> {
      const info = domainInfo(site.url);
      if (info.local) return { status: "UNKNOWN", reason: "not_applicable", message: "Local/IP target — no domain to check", metrics: {} };
      if (info.platform) {
        return {
          status: "OK",
          reason: "platform_managed",
          message: `Managed by platform (${info.platform}) — no domain renewal needed`,
          metrics: { daysLeft: null },
          details: { platform: info.platform, hostname: info.hostname },
        };
      }
      const domain = info.registrable!;

      let reg: Awaited<ReturnType<typeof getRegistration>>;
      try {
        reg = await getRegistration(domain, ctx.thresholds.domainWarnDays, opts);
      } catch (err) {
        const notFound = err instanceof LookupError && err.notFound;
        return {
          status: "UNKNOWN",
          reason: "lookup_failed",
          message: notFound ? `${domain}: not found in the registry (unregistered or deleted?)` : `${domain}: lookup failed — ${(err as Error).message}`,
          metrics: {},
          details: { domain },
        };
      }

      const { data } = reg;
      const details = {
        domain,
        registrar: data.registrar,
        expiresAt: data.expiresAt?.toISOString() ?? null,
        registeredAt: data.registeredAt?.toISOString() ?? null,
        nameservers: data.nameservers,
        source: data.source,
        server: data.server,
        cached: reg.cached,
        fetchedAt: reg.fetchedAt.toISOString(),
        staleError: reg.staleError,
      };
      const registrar = data.registrar ? ` · ${data.registrar}` : "";

      if (!data.expiresAt) {
        return {
          status: "UNKNOWN",
          reason: "lookup_failed",
          message: `${domain}: the registry does not publish an expiry date${registrar}`,
          metrics: { daysLeft: null },
          details,
        };
      }

      const now = opts.now?.() ?? new Date();
      const daysLeft = Math.floor((data.expiresAt.getTime() - now.getTime()) / DAY_MS);
      const date = data.expiresAt.toISOString().slice(0, 10);
      const metrics = { daysLeft, expiresAt: data.expiresAt.toISOString(), registrar: data.registrar };
      const t = ctx.thresholds;

      if (daysLeft < 0) return { status: "FAIL", reason: "domain_expired", message: `${domain} expired on ${date}${registrar}`, metrics, details };
      if (daysLeft <= t.domainFailDays) return { status: "FAIL", reason: "domain_expiring", message: `${domain} expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"} (${date})${registrar}`, metrics, details };
      if (daysLeft <= t.domainWarnDays) return { status: "WARN", reason: "domain_expiring", message: `${domain} expires in ${daysLeft} days (${date})${registrar}`, metrics, details };
      return { status: "OK", reason: "ok", message: `${domain} registered until ${date} (${daysLeft} days)${registrar}`, metrics, details };
    },
  };
}

export const domainCheck = createDomainCheck();
