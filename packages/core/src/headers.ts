/**
 * Security-headers checklist shared by the worker (produces it) and the web app
 * (renders pass/fail + a short "how to fix" hint per item).
 */
export const HEADER_ITEMS = [
  "hsts",
  "csp",
  "frame_options",
  "content_type_options",
  "referrer_policy",
  "permissions_policy",
  "mixed_content",
  "server_disclosure",
] as const;
export type HeaderItemId = (typeof HEADER_ITEMS)[number];

/** fail = breaks the page · warn = should fix · info = nice to have. */
export type HeaderItemLevel = "fail" | "warn" | "info";
export type HeaderItemStatus = "pass" | HeaderItemLevel | "na";

export interface HeaderItemDef {
  label: string;
  level: HeaderItemLevel;
  fix: string;
}

export const HEADER_ITEM_DEFS: Record<HeaderItemId, HeaderItemDef> = {
  hsts: {
    label: "Strict-Transport-Security (HSTS)",
    level: "warn",
    fix: "Send “Strict-Transport-Security: max-age=31536000; includeSubDomains” on https responses (Cloudflare: SSL/TLS → Edge Certificates → HSTS; nginx: add_header; Apache: Header always set).",
  },
  csp: {
    label: "Content-Security-Policy",
    level: "info",
    fix: "Start with “Content-Security-Policy: frame-ancestors 'self'; upgrade-insecure-requests” and tighten over time. Test with Content-Security-Policy-Report-Only first — a strict CSP can break plugins.",
  },
  frame_options: {
    label: "Clickjacking protection (X-Frame-Options / frame-ancestors)",
    level: "warn",
    fix: "Send “X-Frame-Options: SAMEORIGIN” (or CSP “frame-ancestors 'self'”) so other sites can't embed the page in a hidden frame.",
  },
  content_type_options: {
    label: "X-Content-Type-Options: nosniff",
    level: "warn",
    fix: "Send “X-Content-Type-Options: nosniff” on every response.",
  },
  referrer_policy: {
    label: "Referrer-Policy",
    level: "info",
    fix: "Send “Referrer-Policy: strict-origin-when-cross-origin” so full URLs (with query strings) aren't leaked to other sites.",
  },
  permissions_policy: {
    label: "Permissions-Policy",
    level: "info",
    fix: "Send e.g. “Permissions-Policy: camera=(), microphone=(), geolocation=()” to disable browser features the site doesn't use.",
  },
  mixed_content: {
    label: "No mixed content (http resources on an https page)",
    level: "fail",
    fix: "Load every script, stylesheet, iframe and image over https. WordPress: update the site URL and run Better Search Replace http:// → https://; hard-coded theme URLs need editing.",
  },
  server_disclosure: {
    label: "No server/framework version disclosure",
    level: "info",
    fix: "Hide version numbers in Server / X-Powered-By headers (PHP: expose_php = Off; nginx: server_tokens off; Apache: ServerTokens Prod).",
  },
};

export interface HeaderChecklistItem {
  id: HeaderItemId;
  status: HeaderItemStatus;
  /** The header value seen, or the offending URLs. */
  detail?: string;
}
