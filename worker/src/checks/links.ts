import { DEFAULTS, sameSiteHost } from "@siteguard/core";
import { detectBotProtection } from "../lib/bot-protection";
import { decodeEntities } from "../lib/html";
import { httpGet, type HttpResult } from "../lib/http";
import type { CheckModule, CheckRunResult } from "./types";

export type LinkKind = "page" | "link" | "image" | "script" | "style";

export interface FoundLink {
  url: string;
  kind: LinkKind;
  internal: boolean;
}

export interface BrokenLink {
  url: string;
  kind: LinkKind;
  internal: boolean;
  /** HTTP status, or the network failure reason. */
  status: number | null;
  error?: string;
  /** Pages that link to it (first few). */
  foundOn: string[];
}

/** Hard caps so one big site can't eat the worker. */
const MAX_URLS = 400;
const CONCURRENCY = 5;
const LINK_TIMEOUT_MS = 15_000;

/** Never GET these: they change state (logout, add to cart) or are admin areas. */
const SKIP = /\/wp-admin|\/wp-login|logout|log-out|signout|add-to-cart|\/cart\/?(\?|$)|\/checkout|[?&]action=|replytocom=|\/feed\/?$|\/xmlrpc\.php/i;
/** Hrefs that look like documents to crawl further (not files). */
const FILE_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|rar|docx?|xlsx?|pptx?|mp4|mp3|webm|avi|mov|css|js|json|xml|txt|woff2?|ttf|eot)(\?|$)/i;

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  return m ? decodeEntities((m[2] ?? m[3] ?? m[4] ?? "").trim()) : null;
}

/** Links, images, scripts and stylesheets on a page, resolved and de-duplicated (no #fragments). */
export function extractLinks(html: string, pageUrl: string, siteHost: string): FoundLink[] {
  const clean = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, (m) => m.slice(0, m.indexOf(">") + 1));
  const base = attr(/<base\b[^>]*>/i.exec(clean)?.[0] ?? "", "href") ?? pageUrl;
  const out = new Map<string, FoundLink>();
  const add = (raw: string | null, kind: LinkKind) => {
    if (!raw || /^(mailto:|tel:|javascript:|data:|#|sms:|whatsapp:)/i.test(raw)) return;
    let url: URL;
    try {
      url = new URL(raw, new URL(base, pageUrl));
    } catch {
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    url.hash = "";
    const s = url.toString();
    if (SKIP.test(s)) return;
    const internal = sameSiteHost(url.hostname, siteHost);
    const k = kind === "link" && internal && !FILE_EXT.test(url.pathname) ? "page" : kind;
    if (!out.has(s)) out.set(s, { url: s, kind: k, internal });
  };
  for (const m of clean.matchAll(/<a\b[^>]*>/gi)) add(attr(m[0], "href"), "link");
  for (const m of clean.matchAll(/<img\b[^>]*>/gi)) add(attr(m[0], "src"), "image");
  for (const m of clean.matchAll(/<script\b[^>]*>/gi)) add(attr(m[0], "src"), "script");
  for (const m of clean.matchAll(/<link\b[^>]*>/gi)) if (/stylesheet/i.test(attr(m[0], "rel") ?? "")) add(attr(m[0], "href"), "style");
  return [...out.values()];
}

type Verdict = { state: "ok" } | { state: "broken"; status: number | null; error?: string } | { state: "unverified"; why: string };

/** Only clear failures count as broken; bot walls, auth and timeouts on other sites are "unverified". */
export function judge(res: HttpResult, internal: boolean): Verdict {
  if (!res.ok) {
    // A slow response isn't a broken link (the uptime check owns slowness).
    if (res.reason === "timeout") return { state: "unverified", why: "timeout" };
    if (res.reason === "dns" || res.reason === "refused" || res.reason === "too_many_redirects" || res.reason === "ssl") return { state: "broken", status: null, error: res.message };
    return { state: "unverified", why: res.message };
  }
  if (detectBotProtection(res.status, res.headers, res.body)) return { state: "unverified", why: `blocked (HTTP ${res.status})` };
  if (res.status === 401 || res.status === 403 || res.status === 429 || res.status === 405 || res.status === 999) return { state: "unverified", why: `HTTP ${res.status}` };
  if (res.status >= 400) return { state: "broken", status: res.status };
  return { state: "ok" };
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}

export const linksCheck: CheckModule = {
  type: "links",
  queue: "http",
  maxRunMs: 20 * 60_000,

  async run(site, ctx): Promise<CheckRunResult> {
    const timeoutMs = Math.min(ctx.timeoutMs ?? LINK_TIMEOUT_MS, LINK_TIMEOUT_MS);
    const maxPages = site.links?.maxPages ?? ctx.settings.linksMaxPages ?? DEFAULTS.linksMaxPages;

    const home = await httpGet(site.url, { timeoutMs: ctx.timeoutMs ?? 30_000, maxBodyBytes: 2 * 1024 * 1024 });
    if (!home.ok || home.status >= 400 || detectBotProtection(home.status, home.headers, home.body)) {
      return { status: "UNKNOWN", reason: "unreachable", message: home.ok ? `Homepage not readable (HTTP ${home.status}) — see uptime check` : `Homepage unreachable (${home.message})`, metrics: {} };
    }
    const siteHost = new URL(home.finalUrl).hostname;

    const foundOn = new Map<string, Set<string>>();
    const meta = new Map<string, FoundLink>();
    const verdicts = new Map<string, Verdict>();
    const redirects: { url: string; to: string; hops: number }[] = [];
    const crawled = new Set<string>();
    let truncated = false;

    const note = (pageUrl: string, links: FoundLink[]) => {
      for (const l of links) {
        if (!meta.has(l.url)) {
          if (meta.size >= MAX_URLS) {
            truncated = true;
            continue;
          }
          meta.set(l.url, l);
        }
        const set = foundOn.get(l.url) ?? new Set<string>();
        if (set.size < 3) set.add(pageUrl);
        foundOn.set(l.url, set);
      }
    };

    // ── Crawl internal pages breadth-first (each page GET doubles as its link check)
    crawled.add(site.url).add(home.finalUrl);
    verdicts.set(site.url, { state: "ok" });
    verdicts.set(home.finalUrl, { state: "ok" });
    note(home.finalUrl, extractLinks(home.body, home.finalUrl, siteHost));
    let frontier = [...meta.values()].filter((l) => l.kind === "page").map((l) => l.url);
    for (const p of site.importantPages ?? []) frontier.push(new URL(p, site.url).toString());

    while (frontier.length && crawled.size < maxPages) {
      const batch = [...new Set(frontier)].filter((u) => !crawled.has(u)).slice(0, maxPages - crawled.size);
      frontier = [];
      for (const u of batch) crawled.add(u);
      await pool(batch, CONCURRENCY, async (url) => {
        const res = await httpGet(url, { timeoutMs, maxBodyBytes: 2 * 1024 * 1024 });
        const v = judge(res, true);
        verdicts.set(url, v);
        if (res.ok && res.redirects.length) redirects.push({ url, to: res.finalUrl, hops: res.redirects.length });
        if (v.state !== "ok" || !res.ok) return;
        // Only follow pages that stayed on the site and are HTML.
        if (!sameSiteHost(new URL(res.finalUrl).hostname, siteHost) || !/html/i.test(res.headers.get("content-type") ?? "html")) return;
        const links = extractLinks(res.body, res.finalUrl, siteHost);
        note(res.finalUrl, links);
        frontier.push(...links.filter((l) => l.kind === "page" && !crawled.has(l.url)).map((l) => l.url));
      });
    }

    // ── Check everything else once (resources, external links, pages beyond the crawl limit)
    const rest = [...meta.values()].filter((l) => !verdicts.has(l.url));
    await pool(rest, CONCURRENCY, async (l) => {
      const res = await httpGet(l.url, { timeoutMs, maxBodyBytes: l.kind === "page" || l.kind === "link" ? 64 * 1024 : 16 * 1024 });
      verdicts.set(l.url, judge(res, l.internal));
      if (res.ok && l.internal && res.redirects.length && l.kind === "page") redirects.push({ url: l.url, to: res.finalUrl, hops: res.redirects.length });
    });

    const broken: BrokenLink[] = [];
    let unverified = 0;
    for (const [url, v] of verdicts) {
      if (v.state === "unverified") unverified++;
      if (v.state !== "broken") continue;
      const m = meta.get(url) ?? { url, kind: "page" as LinkKind, internal: true };
      broken.push({ url, kind: m.kind, internal: m.internal, status: v.status, error: v.error, foundOn: [...(foundOn.get(url) ?? [])] });
    }
    // Internal first, then pages before resources.
    broken.sort((a, b) => Number(b.internal) - Number(a.internal) || a.url.localeCompare(b.url));

    const brokenInternal = broken.filter((b) => b.internal).length;
    const brokenExternal = broken.length - brokenInternal;
    const metrics = { pagesCrawled: crawled.size, urlsChecked: verdicts.size, brokenInternal, brokenExternal, unverified, redirects: redirects.length };
    const details = { broken: broken.slice(0, 100), redirects: redirects.slice(0, 20), truncated, maxPages };

    if (broken.length) {
      const sample = broken
        .slice(0, 3)
        .map((b) => `${b.url} (${b.status ?? b.error})`)
        .join(", ");
      return {
        status: "WARN",
        reason: "broken_links",
        message: `${broken.length} broken link${broken.length > 1 ? "s" : ""} (${brokenInternal} on the site, ${brokenExternal} external) across ${crawled.size} pages: ${sample}`,
        metrics,
        details,
      };
    }
    return { status: "OK", reason: "ok", message: `No broken links — ${verdicts.size} URLs on ${crawled.size} pages checked${truncated ? " (URL limit reached)" : ""}`, metrics, details };
  },
};
