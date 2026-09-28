import { HEADER_ITEM_DEFS, HEADER_ITEMS, type HeaderChecklistItem, type HeaderItemId, type HeaderItemStatus } from "@siteguard/core";
import { detectBotProtection } from "../lib/bot-protection";
import { httpGet } from "../lib/http";
import type { CheckModule, CheckRunResult } from "./types";

/** HSTS below ~6 months is weak (browsers' preload list wants ≥ 1 year). */
const HSTS_MIN_SECONDS = 180 * 24 * 3600;

export interface MixedContent {
  /** Scripts, stylesheets, iframes: blocked by browsers → the page breaks. */
  active: string[];
  /** Images, media: auto-upgraded or shown with a warning. */
  passive: string[];
}

/** http:// resources referenced by an https page (comments stripped). */
export function findMixedContent(html: string): MixedContent {
  const clean = html.replace(/<!--[\s\S]*?-->/g, " ");
  const active = new Set<string>();
  const passive = new Set<string>();
  for (const m of clean.matchAll(/<(script|iframe|img|source|video|audio|embed|object|link)\b[^>]*>/gi)) {
    const tag = m[1]!.toLowerCase();
    const attrs = m[0];
    if (tag === "link" && !/\brel\s*=\s*["']?[^"'>]*stylesheet/i.test(attrs)) continue;
    const url = /\b(?:src|href|data)\s*=\s*["']?(http:\/\/[^"'\s>]+)/i.exec(attrs)?.[1];
    if (!url) continue;
    (["script", "iframe", "link", "embed", "object"].includes(tag) ? active : passive).add(url);
  }
  return { active: [...active], passive: [...passive] };
}

function item(id: HeaderItemId, status: HeaderItemStatus, detail?: string): HeaderChecklistItem {
  return { id, status, ...(detail ? { detail } : {}) };
}
const fail = (id: HeaderItemId) => HEADER_ITEM_DEFS[id].level;

export function evaluateHeaders(headers: Headers, html: string, isHttps: boolean): HeaderChecklistItem[] {
  const h = (n: string) => headers.get(n)?.trim() || null;
  const hsts = h("strict-transport-security");
  const csp = h("content-security-policy");
  const cspRo = h("content-security-policy-report-only");
  const xfo = h("x-frame-options");
  const xcto = h("x-content-type-options");
  const referrer = h("referrer-policy");
  const permissions = h("permissions-policy") ?? h("feature-policy");
  const server = h("server");
  const poweredBy = h("x-powered-by");

  const maxAge = Number(/max-age\s*=\s*"?(\d+)/i.exec(hsts ?? "")?.[1] ?? NaN);
  const frameAncestors = /frame-ancestors/i.test(csp ?? "");
  const mixed = isHttps ? findMixedContent(html) : { active: [], passive: [] };
  const versionRx = /\d+\.\d+/;
  const disclosed = [server && versionRx.test(server) ? `Server: ${server}` : null, poweredBy && versionRx.test(poweredBy) ? `X-Powered-By: ${poweredBy}` : null].filter(Boolean);

  const items: HeaderChecklistItem[] = [
    !isHttps
      ? item("hsts", "na", "Site is not served over https")
      : !hsts
        ? item("hsts", fail("hsts"))
        : maxAge >= HSTS_MIN_SECONDS
          ? item("hsts", "pass", hsts)
          : item("hsts", "warn", `${hsts} — max-age below 180 days`),
    csp ? item("csp", "pass", csp.slice(0, 160)) : cspRo ? item("csp", "info", `Report-Only: ${cspRo.slice(0, 140)}`) : item("csp", fail("csp")),
    xfo && /^(deny|sameorigin)$/i.test(xfo) ? item("frame_options", "pass", `X-Frame-Options: ${xfo}`) : frameAncestors ? item("frame_options", "pass", "CSP frame-ancestors") : item("frame_options", fail("frame_options"), xfo ?? undefined),
    xcto && /nosniff/i.test(xcto) ? item("content_type_options", "pass") : item("content_type_options", fail("content_type_options"), xcto ?? undefined),
    referrer && !/unsafe-url/i.test(referrer) ? item("referrer_policy", "pass", referrer) : item("referrer_policy", fail("referrer_policy"), referrer ?? undefined),
    permissions ? item("permissions_policy", "pass", permissions.slice(0, 120)) : item("permissions_policy", fail("permissions_policy")),
    !isHttps
      ? item("mixed_content", "na")
      : mixed.active.length
        ? item("mixed_content", "fail", mixed.active.slice(0, 5).join(" "))
        : mixed.passive.length
          ? item("mixed_content", "warn", `images/media: ${mixed.passive.slice(0, 5).join(" ")}`)
          : item("mixed_content", "pass"),
    disclosed.length ? item("server_disclosure", fail("server_disclosure"), disclosed.join(" · ")) : item("server_disclosure", "pass"),
  ];
  return HEADER_ITEMS.map((id) => items.find((i) => i.id === id)!);
}

/** A–F from the share of applicable items that pass (info items count half). */
export function headerGrade(items: HeaderChecklistItem[]): { score: number; grade: string } {
  const weight = (i: HeaderChecklistItem) => (HEADER_ITEM_DEFS[i.id].level === "info" ? 0.5 : 1);
  const applicable = items.filter((i) => i.status !== "na");
  const total = applicable.reduce((n, i) => n + weight(i), 0);
  const got = applicable.filter((i) => i.status === "pass").reduce((n, i) => n + weight(i), 0);
  const score = total ? Math.round((got / total) * 100) : 100;
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  return { score, grade };
}

export const headersCheck: CheckModule = {
  type: "headers",
  queue: "http",
  maxRunMs: 2 * 60_000,

  async run(site, ctx): Promise<CheckRunResult> {
    const res = await httpGet(site.url, { timeoutMs: ctx.timeoutMs ?? 30_000, maxBodyBytes: 2 * 1024 * 1024 });
    if (!res.ok || res.status >= 400 || detectBotProtection(res.status, res.headers, res.body)) {
      return { status: "UNKNOWN", reason: "unreachable", message: res.ok ? `Page not readable (HTTP ${res.status}) — see uptime check` : `Page unreachable (${res.message})`, metrics: {} };
    }
    const isHttps = new URL(res.finalUrl).protocol === "https:";
    const checklist = evaluateHeaders(res.headers, res.body, isHttps);
    const { score, grade } = headerGrade(checklist);
    const missing = checklist.filter((i) => i.status === "warn");
    const broken = checklist.filter((i) => i.status === "fail");
    const metrics = { score, grade, missing: missing.length, mixedActive: broken.length ? 1 : 0 };
    const details = { checklist, finalUrl: res.finalUrl };

    if (broken.length) {
      return { status: "WARN", reason: "mixed_content", message: `Mixed content blocked by browsers: ${broken[0]!.detail}`, metrics, details };
    }
    if (missing.length) {
      return { status: "WARN", reason: "headers_missing", message: `Grade ${grade} (${score}/100) — missing: ${missing.map((m) => HEADER_ITEM_DEFS[m.id].label.split(" (")[0]).join(", ")}`, metrics, details };
    }
    return { status: "OK", reason: "ok", message: `Grade ${grade} (${score}/100)`, metrics, details };
  },
};
