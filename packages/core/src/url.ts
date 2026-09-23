/**
 * Normalize a user-entered site URL: add https:// if missing, lowercase host,
 * drop hash, drop trailing slash on the root path.
 */
export function normalizeSiteUrl(input: string): string {
  const raw = input.trim();
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
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
