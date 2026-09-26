import { parse } from "tldts";

/**
 * Hosting platforms whose subdomains are owned and renewed by the platform, not
 * the client. Most are in the Public Suffix List's private section already; this
 * list is the safety net (and documents the intent).
 */
export const PLATFORM_SUFFIXES = [
  "vercel.app",
  "netlify.app",
  "github.io",
  "pages.dev",
  "workers.dev",
  "onrender.com",
  "herokuapp.com",
  "web.app",
  "firebaseapp.com",
  "azurewebsites.net",
  "azurestaticapps.net",
  "amplifyapp.com",
  "fly.dev",
  "railway.app",
  "up.railway.app",
  "surge.sh",
  "glitch.me",
  "replit.app",
  "myshopify.com",
  "wpengine.com",
  "wpenginepowered.com",
  "wordpress.com",
  "blogspot.com",
  "wixsite.com",
  "webflow.io",
  "framer.website",
  "framer.app",
  "carrd.co",
] as const;

export interface DomainInfo {
  /** Lowercased hostname of the site. */
  hostname: string;
  /** Registrable domain from the Public Suffix List (ICANN section), e.g. client.co.in. null for IPs/localhost. */
  registrable: string | null;
  /** e.g. "co.in", "com". */
  publicSuffix: string | null;
  /** Hosted on a platform subdomain (vercel.app, github.io…): domain expiry is the platform's job. */
  platform: string | null;
  /** localhost / IP address / single-label host: domain & DNS checks don't apply. */
  local: boolean;
}

// No node:net here: this module is also bundled into client components.
function isIpAddress(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

function matchPlatform(hostname: string): string | null {
  for (const s of PLATFORM_SUFFIXES) if (hostname === s || hostname.endsWith(`.${s}`)) return s;
  return null;
}

/**
 * Work out which domain a site really lives on.
 * - sub.client.com → client.com, www.client.co.in → client.co.in
 * - acme.vercel.app → platform "vercel.app" (no registrable domain to renew)
 */
export function domainInfo(hostnameOrUrl: string): DomainInfo {
  let hostname = hostnameOrUrl.trim().toLowerCase();
  if (/^https?:\/\//.test(hostname)) hostname = new URL(hostname).hostname;
  hostname = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");

  if (hostname === "localhost" || hostname.endsWith(".localhost") || isIpAddress(hostname) || !hostname.includes(".")) {
    return { hostname, registrable: null, publicSuffix: null, platform: null, local: true };
  }

  const priv = parse(hostname, { allowPrivateDomains: true });
  const icann = parse(hostname, { allowPrivateDomains: false });
  const platform = matchPlatform(hostname) ?? (priv.isPrivate && priv.publicSuffix ? priv.publicSuffix : null);

  return {
    hostname,
    registrable: platform ? null : icann.domain,
    publicSuffix: icann.publicSuffix,
    platform,
    local: false,
  };
}

/**
 * Hostnames the SSL check should cover: the site host plus its apex/www twin
 * when the site is on the apex or www (sub.client.com is checked on its own).
 */
export function sslHostVariants(hostname: string): string[] {
  const info = domainInfo(hostname);
  if (info.local || info.platform || !info.registrable) return [info.hostname];
  const apex = info.registrable;
  if (info.hostname === apex || info.hostname === `www.${apex}`) return [apex, `www.${apex}`];
  return [info.hostname];
}

/** Compare hosts ignoring a leading "www." (canonical/staging checks). */
export function sameSiteHost(a: string, b: string): boolean {
  const n = (h: string) => h.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  return n(a) === n(b);
}
