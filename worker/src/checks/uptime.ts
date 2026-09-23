import type { CheckReason, CheckStatus } from "@siteguard/core";
import { detectBotProtection } from "../lib/bot-protection";
import { httpGet, type HttpResult } from "../lib/http";
import type { CheckModule, CheckRunResult } from "./types";

export interface PageProbe {
  url: string;
  status: CheckStatus;
  reason: CheckReason;
  statusCode?: number;
  responseTimeMs?: number;
  message: string;
}

/** Turn one HTTP result into status/reason/message. Exported for tests. */
export function evaluateResponse(res: HttpResult, slowMs: number): Omit<PageProbe, "url"> & { blockedBy?: string } {
  if (!res.ok) return { status: "FAIL", reason: res.reason, message: res.message };

  const block = detectBotProtection(res.status, res.headers, res.body);
  if (block) {
    return {
      status: "WARN",
      reason: "blocked",
      statusCode: res.status,
      responseTimeMs: res.responseTimeMs,
      message: `${block.detail} — whitelist SiteGuard`,
      blockedBy: block.provider,
    };
  }
  if (res.status >= 500) {
    return { status: "FAIL", reason: "http_5xx", statusCode: res.status, responseTimeMs: res.responseTimeMs, message: `HTTP ${res.status} server error` };
  }
  if (res.status >= 400) {
    return { status: "FAIL", reason: "http_4xx", statusCode: res.status, responseTimeMs: res.responseTimeMs, message: `HTTP ${res.status} client error` };
  }
  if (res.responseTimeMs > slowMs) {
    return {
      status: "WARN",
      reason: "slow",
      statusCode: res.status,
      responseTimeMs: res.responseTimeMs,
      message: `Slow: ${res.responseTimeMs} ms (threshold ${slowMs} ms)`,
    };
  }
  return { status: "OK", reason: "ok", statusCode: res.status, responseTimeMs: res.responseTimeMs, message: `HTTP ${res.status} in ${res.responseTimeMs} ms` };
}

function resolvePage(siteUrl: string, page: string): string {
  return new URL(page, siteUrl).toString();
}

export const uptimeCheck: CheckModule = {
  type: "uptime",
  queue: "http",
  maxRunMs: 5 * 60_000,

  async run(site, ctx): Promise<CheckRunResult> {
    const timeoutMs = ctx.timeoutMs ?? 30_000;
    const slowMs = ctx.thresholds.responseTimeWarnMs;
    const res = await httpGet(site.url, { timeoutMs, maxRedirects: 5, maxBodyBytes: 256 * 1024 });
    const main = evaluateResponse(res, slowMs);

    // Extra important pages (only meaningful when the homepage itself answered).
    const pages: PageProbe[] = [];
    if (main.status !== "FAIL" || main.reason === "http_4xx") {
      for (const page of site.importantPages ?? []) {
        const url = resolvePage(site.url, page);
        const r = await httpGet(url, { timeoutMs, maxRedirects: 5, maxBodyBytes: 128 * 1024 });
        pages.push({ url, ...evaluateResponse(r, slowMs) });
      }
    }
    const failingPages = pages.filter((p) => p.status === "FAIL");

    let status = main.status;
    let reason = main.reason;
    let message = main.message;
    // A broken important page degrades the site, but the homepage decides "down".
    if (status !== "FAIL" && failingPages.length) {
      const pagesMsg = `${failingPages.length} important page(s) failing: ${failingPages
        .map((p) => `${new URL(p.url).pathname} (${p.message})`)
        .join(", ")}`;
      // Keep a "slow" / "blocked" finding visible alongside the page failures.
      message = status === "WARN" ? `${message}; ${pagesMsg}` : pagesMsg;
      status = "WARN";
      reason = "page_error";
    }

    return {
      status,
      reason,
      message,
      metrics: {
        statusCode: main.statusCode ?? null,
        responseTimeMs: main.responseTimeMs ?? null,
        ttfbMs: res.ok ? res.ttfbMs : null,
        redirects: res.redirects.length,
        bytes: res.ok ? res.bytes : null,
      },
      details: {
        finalUrl: res.ok ? res.finalUrl : res.url,
        redirectChain: res.redirects,
        errorCode: res.ok ? undefined : res.code,
        blockedBy: main.blockedBy,
        server: res.ok ? (res.headers.get("server") ?? undefined) : undefined,
        pages,
      },
    };
  },
};
