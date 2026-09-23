/**
 * Normalize a user-entered site URL: add https:// if missing, lowercase host,
 * drop hash, drop trailing slash on the root path.
 */
export function normalizeSiteUrl(input: string): string {
  const raw = input.trim();
  // Real sites default to https; local dev targets (localhost / loopback) to http.
  const isLocal = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?([/?#]|$)/i.test(raw);
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `${isLocal ? "http" : "https"}://${raw}`;
  const url = new URL(withScheme);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  let out = url.toString();
  if (url.pathname === "/" && !url.search) out = out.replace(/\/$/, "");
  return out;
}

/** Registrable-ish hostname without leading "www." (used for SSL/DNS/RDAP checks). */
export function siteHostname(siteUrl: string): string {
  return new URL(siteUrl).hostname.replace(/^www\./, "");
}
