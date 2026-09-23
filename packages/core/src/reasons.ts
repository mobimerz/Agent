/**
 * Machine-readable reason attached to every check result, so the UI can show
 * the exact cause ("DNS failure", "Blocked by Cloudflare"…) instead of just "down".
 */
export const CHECK_REASONS = [
  "ok",
  // uptime / HTTP
  "slow",
  "blocked",
  "dns",
  "refused",
  "timeout",
  "ssl",
  "reset",
  "network",
  "http_4xx",
  "http_5xx",
  "too_many_redirects",
  "page_error",
  // content
  "keyword_missing",
  "spam_detected",
  "size_changed",
  "unreachable",
] as const;
export type CheckReason = (typeof CHECK_REASONS)[number];

export const REASON_LABELS: Record<CheckReason, string> = {
  ok: "OK",
  slow: "Slow response",
  blocked: "Blocked by bot protection",
  dns: "DNS failure",
  refused: "Connection refused",
  timeout: "Timeout",
  ssl: "SSL/TLS error",
  reset: "Connection reset",
  network: "Network error",
  http_4xx: "HTTP 4xx error",
  http_5xx: "HTTP 5xx error",
  too_many_redirects: "Too many redirects",
  page_error: "Important page failing",
  keyword_missing: "Required keyword missing",
  spam_detected: "Spam / hack content detected",
  size_changed: "Page size changed drastically",
  unreachable: "Page unreachable",
};

/** Short hints shown next to the reason in the UI. */
export const REASON_HINTS: Partial<Record<CheckReason, string>> = {
  blocked:
    "The site's firewall (Cloudflare, Sucuri, hosting WAF…) served a bot challenge instead of the page. Whitelist the SiteGuard User-Agent and the server IP so monitoring sees the real site.",
  dns: "The domain did not resolve. Check DNS records and whether the domain has expired.",
  refused: "Nothing is listening on the port — the web server or hosting may be down.",
  timeout: "The server did not respond in time (30 s). It may be overloaded or unreachable.",
  ssl: "Browsers will show a security warning. Check the certificate (expired, wrong host, incomplete chain).",
  http_5xx: "The server returned an error. Check server/application logs.",
  http_4xx: "The page returned a client error (404/401/403…). Check the URL and access rules.",
  too_many_redirects: "The site redirects more than 5 times (possible redirect loop).",
  slow: "The site responded, but slower than the configured threshold.",
};

export function reasonLabel(reason: string | null | undefined): string {
  return (reason && REASON_LABELS[reason as CheckReason]) || "Unknown";
}
