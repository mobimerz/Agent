import { PSI, USER_AGENT, type PsiStrategy } from "@siteguard/core";

export interface PsiScores {
  performance: number | null;
  seo: number | null;
  accessibility: number | null;
  bestPractices: number | null;
}

/** Lighthouse lab metrics (one run, simulated device). */
export interface PsiLab {
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  fcpMs: number | null;
  siMs: number | null;
  ttfbMs: number | null;
}

/** Chrome UX Report p75 values (real visitors, 28 days) — only for sites with enough traffic. */
export interface PsiField {
  scope: "url" | "origin";
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
  category: string | null;
}

export interface PsiOpportunity {
  id: string;
  title: string;
  displayValue?: string;
  savingsMs?: number;
}

export interface PsiResult {
  strategy: PsiStrategy;
  finalUrl: string;
  lighthouseVersion: string | null;
  scores: PsiScores;
  lab: PsiLab;
  field: PsiField | null;
  opportunities: PsiOpportunity[];
}

export type PsiResponse =
  | { ok: true; result: PsiResult }
  | { ok: false; kind: "rate_limited"; retryAfterSec: number; message: string }
  | { ok: false; kind: "error"; status: number | null; message: string };

// ─── Parsing ─────────────────────────────────────────────────────────

interface LhAudit {
  id?: string;
  title?: string;
  score?: number | null;
  numericValue?: number;
  displayValue?: string;
  details?: { type?: string; overallSavingsMs?: number };
  metricSavings?: Record<string, number>;
}
interface PsiBody {
  id?: string;
  loadingExperience?: { id?: string; initial_url?: string; overall_category?: string; metrics?: Record<string, { percentile?: number }>; origin_fallback?: boolean };
  originLoadingExperience?: PsiBody["loadingExperience"];
  lighthouseResult?: {
    finalUrl?: string;
    finalDisplayedUrl?: string;
    lighthouseVersion?: string;
    runtimeError?: { code?: string; message?: string };
    categories?: Record<string, { score?: number | null }>;
    audits?: Record<string, LhAudit>;
  };
  error?: { code?: number; message?: string; status?: string; errors?: { reason?: string; message?: string }[] };
}

const score = (s: number | null | undefined) => (typeof s === "number" ? Math.round(s * 100) : null);
const num = (v: number | undefined, digits = 0) => (typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(digits)) : null);

function parseField(le: PsiBody["loadingExperience"], scope: "url" | "origin"): PsiField | null {
  const m = le?.metrics;
  if (!m || !Object.keys(m).length) return null;
  const cls = m.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile;
  return {
    scope,
    lcpMs: m.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null,
    inpMs: m.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
    cls: typeof cls === "number" ? cls / 100 : null,
    category: le?.overall_category ?? null,
  };
}

/** Trim a (huge) PSI v5 response down to what we store. Throws on a Lighthouse runtime error. */
export function parsePsiResponse(body: PsiBody, strategy: PsiStrategy): PsiResult {
  const lh = body.lighthouseResult;
  if (!lh) throw new Error("PSI response has no lighthouseResult");
  if (lh.runtimeError?.code && lh.runtimeError.code !== "NO_ERROR") throw new Error(`Lighthouse: ${lh.runtimeError.message ?? lh.runtimeError.code}`);
  const cats = lh.categories ?? {};
  const a = lh.audits ?? {};

  const savings = (x: LhAudit) => x.details?.overallSavingsMs ?? Math.max(0, ...Object.values(x.metricSavings ?? {}).filter((v) => typeof v === "number"));
  const opportunities = Object.entries(a)
    .map(([id, x]) => ({ id, x, ms: savings(x) }))
    .filter(({ x, ms }) => typeof x.score === "number" && x.score < 0.9 && (x.details?.type === "opportunity" || ms > 0))
    .sort((p, q) => q.ms - p.ms)
    .slice(0, 6)
    .map(({ id, x, ms }) => ({ id, title: x.title ?? id, displayValue: x.displayValue || undefined, savingsMs: ms > 0 ? Math.round(ms) : undefined }));

  const urlField = parseField(body.loadingExperience, body.loadingExperience?.origin_fallback ? "origin" : "url");
  return {
    strategy,
    finalUrl: lh.finalDisplayedUrl ?? lh.finalUrl ?? body.id ?? "",
    lighthouseVersion: lh.lighthouseVersion ?? null,
    scores: {
      performance: score(cats.performance?.score),
      seo: score(cats.seo?.score),
      accessibility: score(cats.accessibility?.score),
      bestPractices: score(cats["best-practices"]?.score),
    },
    lab: {
      lcpMs: num(a["largest-contentful-paint"]?.numericValue),
      cls: num(a["cumulative-layout-shift"]?.numericValue, 3),
      tbtMs: num(a["total-blocking-time"]?.numericValue),
      fcpMs: num(a["first-contentful-paint"]?.numericValue),
      siMs: num(a["speed-index"]?.numericValue),
      ttfbMs: num(a["server-response-time"]?.numericValue),
    },
    field: urlField ?? parseField(body.originLoadingExperience, "origin"),
    opportunities,
  };
}

// ─── Client ──────────────────────────────────────────────────────────

export interface PsiClientOptions {
  apiKey?: string;
  endpoint?: string;
  timeoutMs?: number;
  /** Override the throttle (tests). */
  minGapMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const QUOTA_REASONS = /rateLimitExceeded|userRateLimitExceeded|dailyLimitExceeded|quotaExceeded|RESOURCE_EXHAUSTED/i;

/**
 * PageSpeed Insights v5 client. Works without an API key (tiny shared quota,
 * so calls are spaced out and run one at a time) and uses PSI_API_KEY
 * automatically when set. A 429 pauses every PSI call for a while instead of
 * hammering Google — the caller records the run as "skipped – rate limited".
 */
export class PsiClient {
  readonly hasKey: boolean;
  private lastCallAt = Number.NEGATIVE_INFINITY;
  private backoffUntil = 0;
  private readonly minGapMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: PsiClientOptions = {}) {
    this.hasKey = Boolean(opts.apiKey);
    this.minGapMs = opts.minGapMs ?? (this.hasKey ? PSI.minGapMsWithKey : PSI.minGapMsNoKey);
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Seconds left in the current rate-limit pause (0 = none). */
  backoffRemainingSec(): number {
    return Math.max(0, Math.ceil((this.backoffUntil - this.now()) / 1000));
  }

  private startBackoff(retryAfterSec?: number): number {
    const sec = retryAfterSec && retryAfterSec > 0 ? retryAfterSec : this.hasKey ? PSI.rateLimitBackoffSecWithKey : PSI.rateLimitBackoffSecNoKey;
    this.backoffUntil = Math.max(this.backoffUntil, this.now() + sec * 1000);
    return sec;
  }

  async run(url: string, strategy: PsiStrategy): Promise<PsiResponse> {
    const pausedFor = () => this.backoffRemainingSec();
    const paused = (waitBackoff: number): PsiResponse => ({ ok: false, kind: "rate_limited", retryAfterSec: waitBackoff, message: `PSI paused after a rate limit — retry in ${Math.ceil(waitBackoff / 60)} min` });
    if (pausedFor() > 0) return paused(pausedFor());

    // Reserve a start slot synchronously so concurrent jobs stay minGapMs apart.
    const now = this.now();
    const startAt = Math.max(now, this.lastCallAt + this.minGapMs);
    this.lastCallAt = startAt;
    if (startAt > now) await this.sleep(startAt - now);
    // A 429 seen by another job while we waited pauses us too.
    if (pausedFor() > 0) return paused(pausedFor());

    const q = new URL(this.opts.endpoint ?? PSI.endpoint);
    q.searchParams.set("url", url);
    q.searchParams.set("strategy", strategy);
    for (const c of ["performance", "seo", "accessibility", "best-practices"]) q.searchParams.append("category", c);
    if (this.opts.apiKey) q.searchParams.set("key", this.opts.apiKey);

    let res: Response;
    try {
      res = await fetch(q, { headers: { "user-agent": USER_AGENT, accept: "application/json" }, signal: AbortSignal.timeout(this.opts.timeoutMs ?? PSI.timeoutMs) });
    } catch (err) {
      const e = err as Error;
      return { ok: false, kind: "error", status: null, message: e.name === "TimeoutError" ? "PageSpeed Insights timed out" : `PageSpeed Insights unreachable: ${e.message}` };
    }

    let body: PsiBody = {};
    try {
      body = (await res.json()) as PsiBody;
    } catch {
      /* non-JSON error page */
    }

    const errText = [body.error?.message, body.error?.status, ...(body.error?.errors ?? []).map((e) => e.reason)].filter(Boolean).join(" ");
    if (res.status === 429 || (res.status === 403 && QUOTA_REASONS.test(errText))) {
      const retryAfter = Number(res.headers.get("retry-after")) || undefined;
      const sec = this.startBackoff(retryAfter);
      return {
        ok: false,
        kind: "rate_limited",
        retryAfterSec: sec,
        message: this.hasKey ? "PageSpeed API quota exceeded (HTTP 429)" : "PageSpeed rate limit without an API key (HTTP 429) — add PSI_API_KEY",
      };
    }
    if (!res.ok) {
      let message = body.error?.message ?? `HTTP ${res.status}`;
      if (res.status === 400 && /api key/i.test(message)) message = `PSI_API_KEY rejected by Google: ${message}`;
      return { ok: false, kind: "error", status: res.status, message: message.slice(0, 300) };
    }
    try {
      return { ok: true, result: parsePsiResponse(body, strategy) };
    } catch (err) {
      return { ok: false, kind: "error", status: res.status, message: (err as Error).message.slice(0, 300) };
    }
  }
}
