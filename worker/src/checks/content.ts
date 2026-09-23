import { DEFAULT_SPAM_WORDS } from "@siteguard/core";
import { detectBotProtection } from "../lib/bot-protection";
import { httpGet } from "../lib/http";
import type { CheckModule, CheckRunResult } from "./types";

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/** Rough visible text: drop scripts/styles/comments and tags, decode common entities. */
export function visibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

/** Exponential moving average weight for the page-size baseline. */
const BASELINE_ALPHA = 0.3;

export const contentCheck: CheckModule = {
  type: "content",
  queue: "http",
  maxRunMs: 2 * 60_000,

  async run(site, ctx): Promise<CheckRunResult> {
    const res = await httpGet(site.url, { timeoutMs: ctx.timeoutMs ?? 30_000, maxBodyBytes: 3 * 1024 * 1024 });

    // Availability is the uptime check's job; don't double-alert here.
    if (!res.ok || res.status >= 400 || detectBotProtection(res.status, res.headers, res.body)) {
      return {
        status: "UNKNOWN",
        reason: "unreachable",
        message: res.ok ? `Page not readable (HTTP ${res.status}) — see uptime check` : `Page unreachable (${res.message})`,
        metrics: { statusCode: res.ok ? res.status : null },
      };
    }

    const text = visibleText(res.body).toLowerCase();
    const keyword = site.content?.requiredKeyword?.trim() ?? "";
    const keywordFound = keyword ? text.includes(keyword.toLowerCase()) : null;

    const spamWords = [...DEFAULT_SPAM_WORDS, ...(site.content?.extraSpamWords ?? [])];
    const spamFound = [...new Set(spamWords.filter((w) => w && text.includes(w.toLowerCase())))];

    const bytes = res.bytes;
    const baseline = typeof ctx.jobData.sizeBaseline === "number" ? ctx.jobData.sizeBaseline : null;
    const ratio = ctx.thresholds.pageSizeChangeRatio;
    const change = baseline ? (bytes - baseline) / baseline : 0;
    const sizeChanged = baseline !== null && Math.abs(change) > ratio;
    const nextBaseline = baseline === null ? bytes : Math.round(baseline + BASELINE_ALPHA * (bytes - baseline));

    const metrics = {
      bytes,
      sizeBaseline: baseline,
      sizeChangePct: baseline ? Math.round(change * 100) : null,
      keywordFound,
      spamCount: spamFound.length,
    };
    const details = { keyword: keyword || undefined, spamFound, finalUrl: res.finalUrl, truncated: res.truncated };
    const jobData = { ...ctx.jobData, sizeBaseline: nextBaseline };

    if (spamFound.length) {
      return {
        status: "FAIL",
        reason: "spam_detected",
        message: `Possible hack/spam content: ${spamFound.slice(0, 5).map((w) => `"${w}"`).join(", ")}`,
        metrics,
        details,
        jobData,
      };
    }
    if (keywordFound === false) {
      return { status: "FAIL", reason: "keyword_missing", message: `Required keyword "${keyword}" not found on the page`, metrics, details, jobData };
    }
    if (sizeChanged) {
      return {
        status: "WARN",
        reason: "size_changed",
        message: `Page size changed ${change > 0 ? "+" : ""}${Math.round(change * 100)}% (${formatKb(baseline!)} → ${formatKb(bytes)})`,
        metrics,
        details,
        jobData,
      };
    }
    return {
      status: "OK",
      reason: "ok",
      message: keyword ? `Keyword "${keyword}" present, no spam detected` : "No spam detected",
      metrics,
      details,
      jobData,
    };
  },
};

function formatKb(bytes: number) {
  return `${Math.round(bytes / 1024)} KB`;
}
