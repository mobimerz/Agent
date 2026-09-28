import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULTS, sameSiteHost } from "@siteguard/core";
import { resolveFromRoot } from "@siteguard/core/env";
import { env } from "../env";
import { BrowserUnavailableError, withBrowserContext } from "../lib/browser";
import type { CheckModule, CheckRunResult } from "./types";

export interface FailedResource {
  url: string;
  type: string;
  status: number | null;
  error?: string;
  sameSite: boolean;
}

export interface BrowserProbe {
  status: number | null;
  finalUrl: string;
  title: string;
  loadMs: number;
  textLength: number;
  mediaCount: number;
  pageErrors: string[];
  consoleErrors: string[];
  failed: FailedResource[];
  screenshot: Buffer | null;
  challenge: boolean;
}

/** Resource types whose failure visibly breaks a page. */
const IMPORTANT_TYPES = new Set(["script", "stylesheet", "image", "font", "document"]);
/** Noise: aborted by navigation, ad blockers, beacons. */
const IGNORED_ERRORS = /ERR_ABORTED|ERR_BLOCKED_BY_CLIENT|ERR_BLOCKED_BY_ORB|NS_BINDING_ABORTED/i;

export async function probePage(url: string, opts: { timeoutMs?: number; screenshot?: boolean } = {}): Promise<BrowserProbe> {
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const siteHost = new URL(url).hostname;
  return withBrowserContext(async (context) => {
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    const failed = new Map<string, FailedResource>();
    const push = (arr: string[], s: string) => arr.length < 20 && !arr.includes(s) && arr.push(s.slice(0, 300));

    page.on("pageerror", (e) => push(pageErrors, e.message));
    page.on("console", (m) => m.type() === "error" && push(consoleErrors, m.text()));
    page.on("requestfailed", (r) => {
      const error = r.failure()?.errorText ?? "failed";
      if (IGNORED_ERRORS.test(error) || !IMPORTANT_TYPES.has(r.resourceType()) || r.isNavigationRequest()) return;
      failed.set(r.url(), { url: r.url(), type: r.resourceType(), status: null, error, sameSite: safeSameSite(r.url(), siteHost) });
    });
    page.on("response", (r) => {
      const req = r.request();
      if (r.status() < 400 || req.isNavigationRequest() || !IMPORTANT_TYPES.has(req.resourceType())) return;
      failed.set(r.url(), { url: r.url(), type: req.resourceType(), status: r.status(), sameSite: safeSameSite(r.url(), siteHost) });
    });

    const started = Date.now();
    const res = await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
    const loadMs = Date.now() - started;
    // Let late scripts run (SPAs render after load); don't wait forever on chatty pages.
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});

    const facts = await page.evaluate(() => {
      const body = document.body;
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect();
        return r.width > 20 && r.height > 20;
      };
      return {
        title: document.title,
        textLength: (body?.innerText ?? "").replace(/\s+/g, " ").trim().length,
        mediaCount: [...document.querySelectorAll("img, svg, video, canvas, iframe, picture")].filter(visible).length,
        challenge: /just a moment|checking your browser|verify you are human/i.test(document.title + " " + (body?.innerText ?? "").slice(0, 500)),
      };
    });
    const screenshot = opts.screenshot === false ? null : await page.screenshot({ type: "jpeg", quality: 60, fullPage: false }).catch(() => null);
    return { status: res?.status() ?? null, finalUrl: page.url(), loadMs, ...facts, pageErrors, consoleErrors, failed: [...failed.values()].slice(0, 30), screenshot };
  });
}

function safeSameSite(url: string, host: string): boolean {
  try {
    return sameSiteHost(new URL(url).hostname, host);
  } catch {
    return false;
  }
}

// ─── Screenshots on disk: <SCREENSHOT_DIR>/<siteId>/<timestamp>.jpg, newest N kept ─

export function screenshotRoot(): string {
  return resolveFromRoot(env.SCREENSHOT_DIR);
}

export async function saveScreenshot(siteId: string, image: Buffer, keep: number, root = screenshotRoot()): Promise<string> {
  const dir = join(root, siteId);
  await mkdir(dir, { recursive: true });
  const name = `${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`;
  await writeFile(join(dir, name), image);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".jpg")).sort();
  for (const old of files.slice(0, Math.max(0, files.length - keep))) await rm(join(dir, old), { force: true });
  return `${siteId}/${name}`;
}

/** Nearly no text and no visible media = the page rendered blank (crashed SPA, hidden PHP fatal…). */
export function isBlank(p: Pick<BrowserProbe, "textLength" | "mediaCount">): boolean {
  return p.textLength < 20 && p.mediaCount === 0;
}

export function createBrowserCheck(opts: { screenshotRoot?: string } = {}): CheckModule {
  return {
    type: "browser",
    queue: "browser",
    maxRunMs: 3 * 60_000,

    async run(site, ctx): Promise<CheckRunResult> {
      let p: BrowserProbe;
      try {
        p = await probePage(site.url, { timeoutMs: ctx.timeoutMs ?? 45_000 });
      } catch (err) {
        if (err instanceof BrowserUnavailableError) return { status: "UNKNOWN", reason: "not_applicable", message: err.message, metrics: {} };
        // Navigation failures are the uptime check's alert.
        return { status: "UNKNOWN", reason: "unreachable", message: `Page did not load in the browser: ${(err as Error).message.split("\n")[0]}`, metrics: {} };
      }

      const keep = ctx.settings.screenshotsKeep ?? DEFAULTS.screenshotsKeep;
      const screenshot = p.screenshot ? await saveScreenshot(String(site._id), p.screenshot, keep, opts.screenshotRoot).catch(() => null) : null;
      const failedSameSite = p.failed.filter((f) => f.sameSite && (f.type === "script" || f.type === "stylesheet"));
      const metrics = {
        loadMs: p.loadMs,
        pageErrors: p.pageErrors.length,
        consoleErrors: p.consoleErrors.length,
        failedResources: p.failed.length,
        textLength: p.textLength,
      };
      const details = { finalUrl: p.finalUrl, title: p.title, status: p.status, pageErrors: p.pageErrors, consoleErrors: p.consoleErrors, failed: p.failed, screenshot };

      if ((p.status ?? 0) >= 400 || p.challenge) {
        return { status: "UNKNOWN", reason: "unreachable", message: p.challenge ? "Bot challenge shown to the browser — see uptime check" : `HTTP ${p.status} — see uptime check`, metrics, details };
      }
      if (isBlank(p)) {
        return { status: "WARN", reason: "blank_page", message: `Page renders blank in a real browser (${p.textLength} characters of text, no images)${p.pageErrors[0] ? ` — JS error: ${p.pageErrors[0]}` : ""}`, metrics, details };
      }
      if (failedSameSite.length) {
        return {
          status: "WARN",
          reason: "resource_errors",
          message: `${failedSameSite.length} script/stylesheet file(s) failing: ${failedSameSite
            .slice(0, 3)
            .map((f) => `${new URL(f.url).pathname} (${f.status ?? f.error})`)
            .join(", ")}`,
          metrics,
          details,
        };
      }
      if (p.pageErrors.length) {
        return { status: "WARN", reason: "js_errors", message: `${p.pageErrors.length} JavaScript error(s): ${p.pageErrors[0]}`, metrics, details };
      }
      const notes = [p.consoleErrors.length ? `${p.consoleErrors.length} console error(s)` : "", p.failed.length ? `${p.failed.length} resource(s) failed` : ""].filter(Boolean).join(", ");
      return { status: "OK", reason: "ok", message: `Rendered in ${(p.loadMs / 1000).toFixed(1)} s${notes ? ` · ${notes}` : " · no errors"}`, metrics, details };
    },
  };
}

export const browserCheck = createBrowserCheck();
