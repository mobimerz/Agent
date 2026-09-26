import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { checkServerIdentity, connect, type DetailedPeerCertificate } from "node:tls";
import { sslHostVariants, type CheckReason, type CheckStatus, type Thresholds } from "@siteguard/core";
import type { CheckModule, CheckRunResult } from "./types";

export interface CertProbe {
  host: string;
  /** TLS handshake completed. */
  connected: boolean;
  /** Connection-level error code (ECONNREFUSED, ETIMEDOUT, ERR_SSL_…). */
  errorCode?: string;
  error?: string;
  subject?: string;
  issuer?: string;
  validFrom?: string;
  validTo?: string;
  daysLeft?: number;
  altNames?: string[];
  hostnameMatch?: boolean;
  /** Server sent every intermediate needed to reach a trusted root. */
  chainComplete?: boolean;
  /** Chain verifies against the trust store (ignoring hostname). */
  trusted?: boolean;
  /** OpenSSL verification error, e.g. UNABLE_TO_VERIFY_LEAF_SIGNATURE. */
  authError?: string;
  selfSigned?: boolean;
  /** Certificates in the chain as sent/built (leaf first). */
  chain?: { subject: string; issuer: string }[];
  protocol?: string;
}

export interface ProbeOptions {
  port?: number;
  timeoutMs?: number;
  /** Trust store override (tests). */
  ca?: string | string[];
  /** Resolve a hostname to an address; null = does not resolve. */
  resolve?: (host: string) => Promise<string | null>;
}

/** Verification errors that mean "the server did not send the intermediate certificate". */
const MISSING_INTERMEDIATE = new Set(["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_GET_ISSUER_CERT"]);
const SELF_SIGNED = new Set(["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN"]);

const DAY_MS = 86_400_000;

async function defaultResolve(host: string): Promise<string | null> {
  if (isIP(host)) return host;
  try {
    return (await dnsLookup(host)).address;
  } catch {
    return null;
  }
}

function name(x: Record<string, string | string[] | undefined> | undefined): string {
  const cn = x?.CN ?? x?.O;
  return Array.isArray(cn) ? cn.join(", ") : (cn ?? "");
}

/** Open a TLS connection (never trusting blindly: we inspect, not reject) and describe the certificate. */
export function probeCertificate(host: string, address: string, opts: ProbeOptions = {}): Promise<CertProbe> {
  const { port = 443, timeoutMs = 15_000, ca } = opts;
  return new Promise((resolve) => {
    let settled = false;
    const done = (p: CertProbe) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(p);
    };
    const socket = connect({
      host: address,
      port,
      servername: isIP(host) ? undefined : host,
      rejectUnauthorized: false,
      ca,
      ALPNProtocols: ["http/1.1"],
    });
    socket.setTimeout(timeoutMs, () => done({ host, connected: false, errorCode: "ETIMEDOUT", error: `No TLS answer within ${Math.round(timeoutMs / 1000)} s` }));
    socket.once("error", (err: NodeJS.ErrnoException) => done({ host, connected: false, errorCode: err.code ?? "UNKNOWN", error: err.message }));
    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate(true) as DetailedPeerCertificate;
      if (!cert || !cert.raw) return done({ host, connected: true, errorCode: "NO_CERT", error: "Server sent no certificate" });

      const chain: { subject: string; issuer: string }[] = [];
      const seen = new Set<string>();
      for (let c: DetailedPeerCertificate | undefined = cert; c && !seen.has(c.fingerprint256); c = c.issuerCertificate) {
        seen.add(c.fingerprint256);
        chain.push({ subject: name(c.subject as never), issuer: name(c.issuer as never) });
      }

      const authError = socket.authorizationError ? String((socket.authorizationError as Error & { code?: string }).code ?? socket.authorizationError) : undefined;
      const validTo = new Date(cert.valid_to);
      const identity = isIP(host) ? undefined : checkServerIdentity(host, cert);
      const selfSigned = authError ? SELF_SIGNED.has(authError) : false;

      done({
        host,
        connected: true,
        subject: name(cert.subject as never),
        issuer: name(cert.issuer as never),
        validFrom: new Date(cert.valid_from).toISOString(),
        validTo: validTo.toISOString(),
        daysLeft: Math.floor((validTo.getTime() - Date.now()) / DAY_MS),
        altNames: (cert.subjectaltname ?? "")
          .split(",")
          .map((s) => s.trim().replace(/^DNS:/, ""))
          .filter(Boolean),
        hostnameMatch: !identity,
        chainComplete: !(authError && MISSING_INTERMEDIATE.has(authError)),
        // Node reports a hostname mismatch as an authorization error too; that is hostnameMatch's job.
        trusted: !authError || authError === "ERR_TLS_CERT_ALTNAME_INVALID",
        authError,
        selfSigned,
        chain,
        protocol: socket.getProtocol() ?? undefined,
      });
    });
  });
}

export interface HostVerdict {
  status: CheckStatus;
  reason: CheckReason;
  message: string;
}

/** Status for one probed hostname. `primary` = the site's own host (vs. its apex/www twin). */
export function evaluateProbe(p: CertProbe, t: Pick<Thresholds, "sslWarnDays" | "sslFailDays">, opts: { primary: boolean; siteIsHttps: boolean }): HostVerdict {
  if (!p.connected || p.errorCode === "NO_CERT") {
    const tlsError = p.errorCode?.startsWith("ERR_SSL") || p.errorCode === "EPROTO" || p.errorCode === "NO_CERT" || p.errorCode === "ECONNRESET";
    if (tlsError) return { status: "FAIL", reason: "ssl_untrusted", message: `${p.host}: TLS handshake failed (${p.errorCode})` };
    // The primary https host being unreachable is the uptime check's alert, not ours.
    if (opts.primary && opts.siteIsHttps) return { status: "UNKNOWN", reason: "unreachable", message: `${p.host}: ${p.error ?? p.errorCode} — see uptime check` };
    return { status: "WARN", reason: "no_https", message: `${p.host}: HTTPS not available (${p.errorCode})` };
  }
  const days = p.daysLeft ?? 0;
  const until = p.validTo ? p.validTo.slice(0, 10) : "?";
  if (days < 0) return { status: "FAIL", reason: "ssl_expired", message: `${p.host}: certificate expired on ${until}` };
  if (p.hostnameMatch === false) {
    return { status: "FAIL", reason: "ssl_hostname", message: `${p.host}: certificate is for ${(p.altNames?.length ? p.altNames : [p.subject]).slice(0, 4).join(", ")}, not ${p.host}` };
  }
  if (p.selfSigned) return { status: "FAIL", reason: "ssl_untrusted", message: `${p.host}: self-signed certificate` };
  if (p.chainComplete === false) return { status: "FAIL", reason: "ssl_chain", message: `${p.host}: incomplete certificate chain — intermediate certificate missing (${p.authError})` };
  if (p.trusted === false) return { status: "FAIL", reason: "ssl_untrusted", message: `${p.host}: certificate not trusted (${p.authError})` };
  if (days <= t.sslFailDays) return { status: "FAIL", reason: "ssl_expiring", message: `${p.host}: certificate expires in ${days} day${days === 1 ? "" : "s"} (${until})` };
  if (days <= t.sslWarnDays) return { status: "WARN", reason: "ssl_expiring", message: `${p.host}: certificate expires in ${days} days (${until})` };
  return { status: "OK", reason: "ok", message: `${p.host}: valid until ${until} (${days} days)` };
}

const STATUS_RANK: Record<CheckStatus, number> = { OK: 0, UNKNOWN: 1, WARN: 2, FAIL: 3 };
const REASON_RANK: Partial<Record<CheckReason, number>> = { ssl_expired: 6, ssl_hostname: 5, ssl_untrusted: 4, ssl_chain: 3, ssl_expiring: 2, no_https: 1 };

export function createSslCheck(opts: ProbeOptions = {}): CheckModule {
  const resolveHost = opts.resolve ?? defaultResolve;
  return {
    type: "ssl",
    queue: "http",
    maxRunMs: 2 * 60_000,

    async run(site, ctx): Promise<CheckRunResult> {
      const url = new URL(site.url);
      const siteIsHttps = url.protocol === "https:";
      const primary = url.hostname.replace(/^\[|\]$/g, "");
      if (!siteIsHttps && (primary === "localhost" || isIP(primary))) {
        return { status: "UNKNOWN", reason: "not_applicable", message: "Local http:// target — no certificate to check", metrics: {} };
      }

      const hosts = sslHostVariants(primary);
      const probes: CertProbe[] = [];
      const skipped: string[] = [];
      for (const host of hosts) {
        const address = await resolveHost(host);
        if (!address) {
          if (host === primary) {
            return { status: "UNKNOWN", reason: "unreachable", message: `${host} does not resolve — see uptime check`, metrics: {}, details: { hosts: [], skipped: [host] } };
          }
          skipped.push(host); // e.g. no www record: nothing to check
          continue;
        }
        probes.push(await probeCertificate(host, address, { ...opts, timeoutMs: Math.min(ctx.timeoutMs ?? 15_000, 15_000) }));
      }

      const verdicts = probes.map((p) => ({ probe: p, ...evaluateProbe(p, ctx.thresholds, { primary: p.host === primary, siteIsHttps }) }));
      const worst = verdicts.reduce((a, b) =>
        STATUS_RANK[b.status] > STATUS_RANK[a.status] || (STATUS_RANK[b.status] === STATUS_RANK[a.status] && (REASON_RANK[b.reason] ?? 0) > (REASON_RANK[a.reason] ?? 0)) ? b : a,
      );
      const problems = verdicts.filter((v) => v.status !== "OK");
      const valid = probes.filter((p) => p.connected && p.daysLeft != null);
      const daysLeft = valid.length ? Math.min(...valid.map((p) => p.daysLeft!)) : null;
      const soonest = valid.find((p) => p.daysLeft === daysLeft);

      const message =
        worst.status === "OK"
          ? `Valid until ${soonest?.validTo?.slice(0, 10)} (${daysLeft} days) · ${probes.map((p) => p.host).join(" + ")}`
          : problems.map((v) => v.message).join("; ");

      return {
        status: worst.status,
        reason: worst.reason,
        message,
        metrics: { daysLeft, validTo: soonest?.validTo ?? null, hostsChecked: probes.length },
        details: {
          hosts: verdicts.map((v) => ({ ...v.probe, status: v.status, reason: v.reason, message: v.message })),
          skipped,
          issuer: soonest?.issuer,
        },
      };
    },
  };
}

export const sslCheck = createSslCheck();
