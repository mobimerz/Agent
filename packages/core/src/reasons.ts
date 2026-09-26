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
  // generic
  "not_applicable",
  // pagespeed
  "rate_limited",
  "psi_error",
  "low_performance",
  "low_seo",
  // ssl
  "ssl_expired",
  "ssl_expiring",
  "ssl_hostname",
  "ssl_chain",
  "ssl_untrusted",
  "no_https",
  // domain
  "domain_expired",
  "domain_expiring",
  "platform_managed",
  "lookup_failed",
  // dns
  "dns_changed",
  // seo
  "noindex",
  "robots_blocked",
  "canonical_mismatch",
  "seo_issues",
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
  not_applicable: "Not applicable",
  rate_limited: "Skipped – rate limited",
  psi_error: "PageSpeed could not test the page",
  low_performance: "Performance score below threshold",
  low_seo: "SEO score below threshold",
  ssl_expired: "SSL certificate expired",
  ssl_expiring: "SSL certificate expiring soon",
  ssl_hostname: "SSL hostname mismatch",
  ssl_chain: "Incomplete certificate chain",
  ssl_untrusted: "Untrusted SSL certificate",
  no_https: "HTTPS not available",
  domain_expired: "Domain expired",
  domain_expiring: "Domain expiring soon",
  platform_managed: "Managed by platform",
  lookup_failed: "Lookup failed",
  dns_changed: "DNS records changed",
  noindex: "Page blocked from Google (noindex)",
  robots_blocked: "robots.txt blocks all crawlers",
  canonical_mismatch: "Canonical URL points to another domain",
  seo_issues: "SEO issues found",
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
  rate_limited:
    "Google PageSpeed refused the request (HTTP 429 quota). Not a site problem — SiteGuard retries later. Add PSI_API_KEY for a 25,000/day quota.",
  psi_error: "PageSpeed Insights could not load the page (it must be publicly reachable). Not counted as a failure.",
  low_performance:
    "Median of the last 3 Lighthouse runs is below the threshold. Check the top opportunities below: large images, render-blocking JS/CSS, slow server response (TTFB), too many plugins/scripts.",
  low_seo: "Median Lighthouse SEO score is below the threshold. See the SEO checklist for the exact items to fix.",
  ssl_expired: "The certificate has expired — visitors see a full-page security warning. Renew it now (Let's Encrypt/cPanel AutoSSL/hosting panel) and check auto-renewal.",
  ssl_expiring: "Renew the certificate before it expires. With Let's Encrypt/AutoSSL, check why auto-renewal hasn't happened (DNS pointing elsewhere, blocked /.well-known/acme-challenge, failed cron).",
  ssl_hostname:
    "The certificate does not cover this hostname (e.g. issued for example.com but served on www.example.com). Re-issue it including every hostname (apex + www).",
  ssl_chain:
    "The server sends the certificate without its intermediate certificate. Desktop Chrome may hide it, but Android, Firefox, curl and payment/API integrations fail. Install the full chain (fullchain.pem / CA bundle) in the server or hosting SSL settings.",
  ssl_untrusted: "The certificate is self-signed or issued by an untrusted CA. Install a certificate from a public CA (Let's Encrypt is free).",
  no_https: "Nothing answers HTTPS on port 443. Enable SSL in the hosting panel / Cloudflare, then redirect http → https.",
  domain_expired: "The domain has expired — the site and email will stop working. Renew it at the registrar immediately.",
  domain_expiring: "Renew the domain at the registrar (or turn on auto-renew and check the saved payment card).",
  lookup_failed: "RDAP/WHOIS did not return data for this domain. This is not an alert; it is retried on the next run.",
  dns_changed:
    "A/AAAA/CNAME/NS/MX records differ from the saved baseline. If you (or the client) changed hosting/DNS on purpose, press “Accept this change”. If not, the domain may have been hijacked or DNS was edited by mistake.",
  noindex:
    "Google will drop this page from search. Remove the noindex: WordPress → Settings → Reading → untick “Discourage search engines from indexing this site”; check SEO plugins (Yoast/RankMath) and any X-Robots-Tag header in the server/CDN config.",
  robots_blocked:
    "robots.txt has “User-agent: *” + “Disallow: /”, so no search engine may crawl the site (often left over from staging). Change it to “Disallow:” (empty) and keep the Sitemap line.",
  canonical_mismatch:
    "The canonical tag tells Google the real page lives on another domain (often a staging or old domain), so this site can drop out of search. Point canonical URLs at this site's own domain (SEO plugin → site URL settings).",
  seo_issues: "Some on-page SEO items failed. See the SEO checklist for each item and how to fix it.",
};

export function reasonLabel(reason: string | null | undefined): string {
  return (reason && REASON_LABELS[reason as CheckReason]) || "Unknown";
}
