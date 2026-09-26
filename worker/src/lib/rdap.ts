import { connect } from "node:net";
import { USER_AGENT } from "@siteguard/core";

export interface RegistrationData {
  domain: string;
  registrar: string | null;
  expiresAt: Date | null;
  registeredAt: Date | null;
  nameservers: string[];
  source: "rdap" | "whois";
  server: string;
}

export class LookupError extends Error {
  constructor(
    message: string,
    readonly notFound = false,
  ) {
    super(message);
  }
}

export const IANA_RDAP_BOOTSTRAP = "https://data.iana.org/rdap/dns.json";
const BOOTSTRAP_TTL_MS = 24 * 3600_000;
let bootstrap: { at: number; map: Map<string, string> } | null = null;

/** For tests. */
export function resetRdapBootstrap() {
  bootstrap = null;
}

async function getJson(url: string, timeoutMs: number): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, {
    headers: { accept: "application/rdap+json, application/json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

/** TLD → RDAP base URL, from the IANA bootstrap registry (cached for a day). */
export async function rdapBaseFor(tld: string, timeoutMs = 15_000): Promise<string | null> {
  if (!bootstrap || Date.now() - bootstrap.at > BOOTSTRAP_TTL_MS) {
    const { status, body } = await getJson(IANA_RDAP_BOOTSTRAP, timeoutMs);
    if (status !== 200 || !body) throw new LookupError(`IANA RDAP bootstrap returned HTTP ${status}`);
    const map = new Map<string, string>();
    for (const [tlds, urls] of (body as { services: [string[], string[]][] }).services ?? []) {
      const url = urls.find((u) => u.startsWith("https://")) ?? urls[0];
      if (url) for (const t of tlds) map.set(t.toLowerCase(), url.endsWith("/") ? url : `${url}/`);
    }
    bootstrap = { at: Date.now(), map };
  }
  return bootstrap.map.get(tld.toLowerCase()) ?? null;
}

interface RdapEntity {
  roles?: string[];
  vcardArray?: [string, [string, unknown, string, unknown][]];
  publicIds?: { type: string; identifier: string }[];
  handle?: string;
  entities?: RdapEntity[];
}
interface RdapDomain {
  ldhName?: string;
  events?: { eventAction: string; eventDate: string }[];
  entities?: RdapEntity[];
  nameservers?: { ldhName?: string }[];
  links?: { rel?: string; href?: string; type?: string }[];
}

function vcardName(e: RdapEntity): string | null {
  const fn = e.vcardArray?.[1]?.find((f) => f[0] === "fn");
  const v = typeof fn?.[3] === "string" ? fn[3].trim() : "";
  return v || null;
}

/** Pull registrar / dates / nameservers out of an RDAP domain object. */
export function parseRdapDomain(domain: string, body: RdapDomain, server: string): RegistrationData {
  const event = (action: string) => {
    const e = body.events?.find((ev) => ev.eventAction?.toLowerCase() === action);
    const d = e ? new Date(e.eventDate) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  };
  const registrarEntity = body.entities?.find((e) => e.roles?.includes("registrar"));
  const registrar = registrarEntity
    ? (vcardName(registrarEntity) ?? registrarEntity.publicIds?.[0]?.identifier ?? registrarEntity.handle ?? null)
    : null;
  return {
    domain,
    registrar,
    expiresAt: event("expiration"),
    registeredAt: event("registration"),
    nameservers: (body.nameservers ?? []).map((n) => (n.ldhName ?? "").toLowerCase().replace(/\.$/, "")).filter(Boolean),
    source: "rdap",
    server,
  };
}

export async function rdapLookup(domain: string, timeoutMs = 15_000): Promise<RegistrationData> {
  const tld = domain.split(".").pop()!;
  const base = await rdapBaseFor(tld, timeoutMs);
  if (!base) throw new LookupError(`No RDAP server for .${tld}`);
  const { status, body } = await getJson(`${base}domain/${encodeURIComponent(domain)}`, timeoutMs);
  if (status === 404) throw new LookupError(`${domain} not found in the .${tld} registry (RDAP 404)`, true);
  if (status !== 200 || !body) throw new LookupError(`RDAP ${new URL(base).host} returned HTTP ${status}`);
  const data = parseRdapDomain(domain, body as RdapDomain, base);

  // Some registries leave registrar/expiry to the registrar's own RDAP server.
  if (!data.expiresAt || !data.registrar) {
    const related = (body as RdapDomain).links?.find((l) => l.rel === "related" && l.href && (l.type ?? "").includes("rdap"));
    if (related?.href) {
      const r = await getJson(related.href, timeoutMs).catch(() => null);
      if (r?.status === 200 && r.body) {
        const more = parseRdapDomain(domain, r.body as RdapDomain, related.href);
        data.expiresAt ??= more.expiresAt;
        data.registrar ??= more.registrar;
      }
    }
  }
  return data;
}

// ─── WHOIS (port 43) fallback for TLDs without RDAP ─────────────────

export type WhoisQuery = (server: string, query: string) => Promise<string>;

export const whoisQuery: WhoisQuery = (server, query) =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = connect({ host: server, port: 43 });
    socket.setTimeout(15_000, () => socket.destroy(new Error(`WHOIS ${server} timed out`)));
    socket.on("connect", () => socket.write(`${query}\r\n`));
    socket.on("data", (c: Buffer) => chunks.push(c));
    socket.on("error", reject);
    socket.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });

const EXPIRY_RX =
  /^\s*(?:Registry Expiry Date|Registrar Registration Expiration Date|Expiration Date|Expiry Date|Expiration Time|Expires On|Expires|paid-till|expire)\s*:\s*(.+)$/im;
const CREATED_RX = /^\s*(?:Creation Date|Created On|Registration Time|Registered On|created)\s*:\s*(.+)$/im;
const REGISTRAR_RX = /^\s*(?:Registrar|Registrar Name|Sponsoring Registrar|registrar)\s*:\s*(.+)$/im;
const NS_RX = /^\s*(?:Name Server|nserver)\s*:\s*(\S+)/gim;

function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s.trim().replace(/\s+\(.*\)$/, ""));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseWhois(domain: string, text: string, server: string): RegistrationData {
  if (/no match|not found|no data found|no entries found|status:\s*free|domain not found/i.test(text) && !EXPIRY_RX.test(text)) {
    throw new LookupError(`${domain} not found in WHOIS (${server})`, true);
  }
  return {
    domain,
    registrar: REGISTRAR_RX.exec(text)?.[1]?.trim() ?? null,
    expiresAt: parseDate(EXPIRY_RX.exec(text)?.[1]),
    registeredAt: parseDate(CREATED_RX.exec(text)?.[1]),
    nameservers: [...text.matchAll(NS_RX)].map((m) => m[1]!.toLowerCase().replace(/\.$/, "")),
    source: "whois",
    server,
  };
}

export async function whoisLookup(domain: string, query: WhoisQuery = whoisQuery): Promise<RegistrationData> {
  const tld = domain.split(".").pop()!;
  const iana = await query("whois.iana.org", tld);
  const server = /^\s*whois:\s*(\S+)/im.exec(iana)?.[1];
  if (!server) throw new LookupError(`No WHOIS server for .${tld}`);
  return parseWhois(domain, await query(server, domain), server);
}

/** RDAP first (structured, HTTPS); WHOIS only when the TLD has no RDAP or RDAP is broken. */
export async function lookupRegistration(domain: string, opts: { whois?: WhoisQuery; timeoutMs?: number } = {}): Promise<RegistrationData> {
  try {
    const data = await rdapLookup(domain, opts.timeoutMs);
    if (data.expiresAt) return data;
    // RDAP answered but hides the expiry (some ccTLDs): try WHOIS for the date, keep RDAP data otherwise.
    const w = await whoisLookup(domain, opts.whois).catch(() => null);
    return w?.expiresAt ? { ...data, expiresAt: w.expiresAt, registrar: data.registrar ?? w.registrar } : data;
  } catch (err) {
    if (err instanceof LookupError && err.notFound) throw err;
    try {
      return await whoisLookup(domain, opts.whois);
    } catch (werr) {
      throw new LookupError(`${(err as Error).message}; WHOIS: ${(werr as Error).message}`, werr instanceof LookupError && werr.notFound);
    }
  }
}
