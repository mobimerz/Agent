import { XMLValidator } from "fast-xml-parser";
import { SEO_ITEM_DEFS, SEO_ITEMS, sameSiteHost, type CheckReason, type SeoChecklistItem, type SeoItemId, type SeoItemStatus } from "@siteguard/core";
import { detectBotProtection } from "../lib/bot-protection";
import { decodeEntities } from "../lib/html";
import { httpGet } from "../lib/http";
import type { CheckModule, CheckRunResult } from "./types";

// ─── HTML helpers (regex-based: we only need a handful of head tags) ──

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    out[m[1]!.toLowerCase()] = decodeEntities((m[3] ?? m[4] ?? m[5] ?? "").trim());
  }
  return out;
}

function stripComments(html: string) {
  return html.replace(/<!--[\s\S]*?-->/g, " ");
}

function metaTags(html: string): Record<string, string>[] {
  return [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrs(m[0]));
}

export interface PageSeo {
  url: string;
  finalUrl?: string;
  error?: string;
  robotsMeta: string | null;
  noindexMeta: boolean;
  xRobotsTag: string | null;
  noindexHeader: boolean;
  canonical: string | null;
  title: string | null;
  description: string | null;
  h1Count: number;
  viewport: boolean;
  lang: string | null;
}

/** Robots directives that keep a page out of Google. */
const NOINDEX = /\b(noindex|none)\b/i;

/**
 * X-Robots-Tag noindex that applies to Google (or all bots).
 * "otherbot: noindex" is ignored; "googlebot: noindex" and bare "noindex" count.
 */
export function headerNoindex(value: string | null): boolean {
  if (!value) return false;
  // Several headers arrive joined by ", "; split on agent prefixes as well.
  return value.split(/,(?=\s*[a-z-]+\s*:)|\n/i).some((part) => {
    const m = /^\s*([a-z][a-z0-9_-]*)\s*:\s*(.*)$/i.exec(part);
    if (m && !/^(unavailable_after|max-snippet|max-image-preview|max-video-preview)$/i.test(m[1]!)) {
      return /^(googlebot|bingbot|\*)$/i.test(m[1]!) && NOINDEX.test(m[2]!);
    }
    return NOINDEX.test(part);
  });
}

export function analyzeHtml(url: string, html: string, headers: Headers): PageSeo {
  const clean = stripComments(html);
  const metas = metaTags(clean);
  const robots = metas.filter((m) => /^(robots|googlebot)$/i.test(m.name ?? ""));
  const robotsMeta = robots.map((m) => m.content ?? "").join(", ") || null;
  const canonicalTag = [...clean.matchAll(/<link\b[^>]*>/gi)].map((m) => attrs(m[0])).find((a) => (a.rel ?? "").toLowerCase().split(/\s+/).includes("canonical"));
  let canonical: string | null = null;
  if (canonicalTag?.href) {
    try {
      canonical = new URL(canonicalTag.href, url).toString();
    } catch {
      canonical = canonicalTag.href;
    }
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(clean)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
  const xRobotsTag = headers.get("x-robots-tag");
  return {
    url,
    robotsMeta,
    noindexMeta: robots.some((m) => NOINDEX.test(m.content ?? "")),
    xRobotsTag,
    noindexHeader: headerNoindex(xRobotsTag),
    canonical,
    title: title || null,
    description: metas.find((m) => (m.name ?? "").toLowerCase() === "description")?.content?.trim() || null,
    h1Count: (clean.match(/<h1\b/gi) ?? []).length,
    viewport: metas.some((m) => (m.name ?? "").toLowerCase() === "viewport" && /width\s*=/.test(m.content ?? "")),
    lang: /<html\b[^>]*\blang\s*=\s*["']?([^"'\s>]+)/i.exec(clean)?.[1] ?? null,
  };
}

// ─── robots.txt ──────────────────────────────────────────────────────

export interface RobotsInfo {
  status: number | null;
  found: boolean;
  blocksAll: boolean;
  sitemaps: string[];
  /** The offending lines, for the UI. */
  evidence?: string;
}

/** Does the `User-agent: *` group disallow the whole site? */
export function parseRobots(text: string, base: string): Omit<RobotsInfo, "status" | "found"> {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim());
  const sitemaps: string[] = [];
  let agents: string[] = [];
  let inRules = false;
  const star = { disallowAll: false, allowRoot: false };
  for (const line of lines) {
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "sitemap") {
      try {
        sitemaps.push(new URL(value, base).toString());
      } catch {
        /* ignore malformed */
      }
      continue;
    }
    if (key === "user-agent") {
      if (inRules) agents = [];
      inRules = false;
      agents.push(value.toLowerCase());
      continue;
    }
    if (key === "allow" || key === "disallow") {
      inRules = true;
      if (!agents.includes("*")) continue;
      if (key === "disallow" && (value === "/" || value === "/*")) star.disallowAll = true;
      if (key === "allow" && (value === "/" || value === "/*" || value === "/$")) star.allowRoot = true;
    }
  }
  const blocksAll = star.disallowAll && !star.allowRoot;
  return { blocksAll, sitemaps: [...new Set(sitemaps)], evidence: blocksAll ? "User-agent: * → Disallow: /" : undefined };
}

// ─── sitemap ─────────────────────────────────────────────────────────

export interface SitemapInfo {
  url: string;
  status: number | null;
  valid: boolean;
  kind?: "urlset" | "sitemapindex";
  entries?: number;
  error?: string;
}

export function validateSitemapXml(body: string): Pick<SitemapInfo, "valid" | "kind" | "entries" | "error"> {
  const trimmed = body.trimStart(); // also strips a UTF-8 BOM (U+FEFF counts as whitespace)
  if (!trimmed.startsWith("<")) return { valid: false, error: "Response is not XML" };
  if (/^<!doctype html|^<html/i.test(trimmed)) return { valid: false, error: "Returns an HTML page instead of XML" };
  const res = XMLValidator.validate(trimmed);
  if (res !== true) return { valid: false, error: `Invalid XML: ${res.err.msg} (line ${res.err.line})` };
  const root = /<(?:[a-z0-9_-]+:)?(urlset|sitemapindex)\b/i.exec(trimmed.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, ""));
  if (!root) return { valid: false, error: "XML root is not <urlset> or <sitemapindex>" };
  const kind = root[1]!.toLowerCase() as "urlset" | "sitemapindex";
  const entries = (trimmed.match(kind === "urlset" ? /<(?:[a-z0-9_-]+:)?url>/gi : /<(?:[a-z0-9_-]+:)?sitemap>/gi) ?? []).length;
  return { valid: true, kind, entries };
}

async function checkSitemap(url: string, timeoutMs: number): Promise<SitemapInfo> {
  if (/\.gz($|\?)/i.test(url)) return { url, status: null, valid: true, error: "gzipped sitemap — not validated" };
  const res = await httpGet(url, { timeoutMs, maxBodyBytes: 5 * 1024 * 1024 });
  if (!res.ok) return { url, status: null, valid: false, error: res.message };
  if (res.status !== 200) return { url, status: res.status, valid: false, error: `HTTP ${res.status}` };
  if (res.truncated) {
    const head = /<(?:[a-z0-9_-]+:)?(urlset|sitemapindex)\b/i.exec(res.body);
    return { url, status: 200, valid: Boolean(head), kind: head?.[1]?.toLowerCase() as SitemapInfo["kind"], error: head ? "Larger than 5 MB — only the start was checked" : "Not a sitemap" };
  }
  return { url, status: 200, ...validateSitemapXml(res.body) };
}

// ─── Checklist ───────────────────────────────────────────────────────

function item(id: SeoItemId, ok: boolean | null, detail?: string, pages?: string[]): SeoChecklistItem {
  const status: SeoItemStatus = ok === null ? "na" : ok ? "pass" : SEO_ITEM_DEFS[id].level;
  return { id, status, ...(detail ? { detail } : {}), ...(pages?.length ? { pages } : {}) };
}

export function buildChecklist(pages: PageSeo[], robots: RobotsInfo, sitemap: SitemapInfo | null): SeoChecklistItem[] {
  const ok = pages.filter((p) => !p.error);
  const path = (u: string) => {
    try {
      const x = new URL(u);
      return x.pathname + x.search;
    } catch {
      return u;
    }
  };
  const failing = (pred: (p: PageSeo) => boolean) => ok.filter(pred).map((p) => path(p.url));

  const noindexMeta = failing((p) => p.noindexMeta);
  const noindexHeader = failing((p) => p.noindexHeader);
  // Compare with the host the page was actually served from (an important page may redirect elsewhere).
  const badCanonical = ok.filter((p) => p.canonical && !sameSiteHost(safeHost(p.canonical), safeHost(p.finalUrl ?? p.url)));
  const badTitle = failing((p) => !p.title || p.title.length < 10 || p.title.length > 70);
  const noDesc = failing((p) => !p.description);
  const badH1 = failing((p) => p.h1Count !== 1);
  const noViewport = failing((p) => !p.viewport);
  const noLang = failing((p) => !p.lang);
  const home = ok[0];

  const items: SeoChecklistItem[] = [
    item("noindex_meta", ok.length ? !noindexMeta.length : null, noindexMeta.length ? `content="${ok.find((p) => p.noindexMeta)?.robotsMeta}"` : undefined, noindexMeta),
    item("noindex_header", ok.length ? !noindexHeader.length : null, noindexHeader.length ? `X-Robots-Tag: ${ok.find((p) => p.noindexHeader)?.xRobotsTag}` : undefined, noindexHeader),
    item("robots_txt", robots.status === null ? null : robots.found, robots.found ? undefined : robots.status ? `HTTP ${robots.status}` : undefined),
    item("robots_block_all", robots.found ? !robots.blocksAll : null, robots.evidence),
    item("sitemap_in_robots", robots.found ? robots.sitemaps.length > 0 : robots.status === null ? null : false, robots.sitemaps[0]),
    item("sitemap_valid", sitemap ? sitemap.valid : false, sitemap ? `${sitemap.url}${sitemap.error ? ` — ${sitemap.error}` : sitemap.entries != null ? ` — ${sitemap.entries} ${sitemap.kind === "sitemapindex" ? "sitemaps" : "URLs"}` : ""}` : "No sitemap found (robots.txt, /sitemap.xml, /sitemap_index.xml)"),
    item("canonical", ok.length ? !badCanonical.length : null, badCanonical[0]?.canonical ?? undefined, badCanonical.map((p) => path(p.url))),
    item("title", ok.length ? !badTitle.length : null, home?.title ? `“${home.title}” (${home.title.length} chars)` : "missing", badTitle),
    item("meta_description", ok.length ? !noDesc.length : null, undefined, noDesc),
    item("h1", ok.length ? !badH1.length : null, badH1.length ? `${ok.find((p) => p.h1Count !== 1)?.h1Count} H1 tags` : undefined, badH1),
    item("viewport", ok.length ? !noViewport.length : null, undefined, noViewport),
    item("lang", ok.length ? !noLang.length : null, home?.lang ?? undefined, noLang),
  ];
  return SEO_ITEMS.map((id) => items.find((i) => i.id === id)!);
}

function safeHost(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
}

/** FAIL reason priority when several indexing blockers are present. */
const FAIL_REASON: [SeoItemId, CheckReason][] = [
  ["noindex_meta", "noindex"],
  ["noindex_header", "noindex"],
  ["robots_block_all", "robots_blocked"],
  ["canonical", "canonical_mismatch"],
];

export const seoCheck: CheckModule = {
  type: "seo",
  queue: "http",
  maxRunMs: 3 * 60_000,

  async run(site, ctx): Promise<CheckRunResult> {
    const timeoutMs = ctx.timeoutMs ?? 30_000;
    const home = await httpGet(site.url, { timeoutMs, maxBodyBytes: 2 * 1024 * 1024 });
    if (!home.ok || home.status >= 400 || detectBotProtection(home.status, home.headers, home.body)) {
      return {
        status: "UNKNOWN",
        reason: "unreachable",
        message: home.ok ? `Homepage not readable (HTTP ${home.status}) — see uptime check` : `Homepage unreachable (${home.message})`,
        metrics: {},
      };
    }
    const siteHost = new URL(home.finalUrl).hostname;
    const pages: PageSeo[] = [{ ...analyzeHtml(site.url, home.body, home.headers), finalUrl: home.finalUrl }];

    for (const p of site.importantPages ?? []) {
      const url = new URL(p, site.url).toString();
      const res = await httpGet(url, { timeoutMs, maxBodyBytes: 2 * 1024 * 1024 });
      if (!res.ok || res.status >= 400) {
        pages.push({ ...analyzeHtml(url, "", new Headers()), error: res.ok ? `HTTP ${res.status}` : res.message });
        continue;
      }
      pages.push({ ...analyzeHtml(url, res.body, res.headers), finalUrl: res.finalUrl });
    }

    const origin = new URL(home.finalUrl).origin;
    const robotsRes = await httpGet(`${origin}/robots.txt`, { timeoutMs, maxBodyBytes: 512 * 1024 });
    const robotsOk = robotsRes.ok && robotsRes.status === 200 && !/^\s*<(!doctype|html)/i.test(robotsRes.body);
    const robots: RobotsInfo = robotsOk
      ? { status: 200, found: true, ...parseRobots(robotsRes.body, origin) }
      : { status: robotsRes.ok ? (robotsRes.status >= 500 ? null : robotsRes.status) : null, found: false, blocksAll: false, sitemaps: [] };

    let sitemap: SitemapInfo | null = null;
    const candidates = robots.sitemaps.length ? robots.sitemaps.slice(0, 1) : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
    for (const url of candidates) {
      const s = await checkSitemap(url, timeoutMs);
      if (robots.sitemaps.length || s.valid) {
        sitemap = s;
        break;
      }
    }

    const checklist = buildChecklist(pages, robots, sitemap);
    const failed = checklist.filter((i) => i.status === "fail");
    const warned = checklist.filter((i) => i.status === "warn");
    const passed = checklist.filter((i) => i.status === "pass").length;
    const applicable = checklist.filter((i) => i.status !== "na").length;

    const metrics = { failCount: failed.length, warnCount: warned.length, passed, applicable, pagesChecked: pages.length };
    const details = {
      checklist,
      pages,
      robots,
      sitemap,
      siteHost,
    };
    const label = (i: SeoChecklistItem) => `${SEO_ITEM_DEFS[i.id].label.replace(/^No /, "")}${i.pages?.length ? ` on ${i.pages.slice(0, 3).join(", ")}` : ""}`;

    if (failed.length) {
      const reason = FAIL_REASON.find(([id]) => failed.some((f) => f.id === id))?.[1] ?? "seo_issues";
      const msg = failed
        .map((f) => {
          if (f.id === "noindex_meta") return `noindex robots meta tag on ${f.pages?.join(", ")}`;
          if (f.id === "noindex_header") return `X-Robots-Tag noindex header on ${f.pages?.join(", ")}`;
          if (f.id === "robots_block_all") return "robots.txt blocks all crawlers (User-agent: * Disallow: /)";
          if (f.id === "canonical") return `canonical points to ${safeHost(f.detail ?? "")}`;
          return label(f);
        })
        .join("; ");
      return { status: "FAIL", reason, message: `Google indexing blocked: ${msg}`, metrics, details };
    }
    if (warned.length) {
      return { status: "WARN", reason: "seo_issues", message: `${warned.length} SEO item(s) to fix: ${warned.map((w) => SEO_ITEM_DEFS[w.id].label).join(", ")}`, metrics, details };
    }
    return { status: "OK", reason: "ok", message: `All ${passed} SEO checks passed on ${pages.length} page(s)`, metrics, details };
  },
};
