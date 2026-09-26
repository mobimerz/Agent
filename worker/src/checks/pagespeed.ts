import { domainInfo, PSI, type PsiStrategy } from "@siteguard/core";
import { env } from "../env";
import { PsiClient, type PsiResult } from "../lib/psi";
import type { CheckModule, CheckRunResult } from "./types";

/** Scores kept per run in jobData for the rolling median. */
export interface ScoreSample {
  at: string;
  mobile: { performance: number | null; seo: number | null };
  desktop: { performance: number | null; seo: number | null };
}

export function median(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : Math.round((v[mid - 1]! + v[mid]!) / 2);
}

export interface Medians {
  perfMobile: number | null;
  perfDesktop: number | null;
  seoMobile: number | null;
  seoDesktop: number | null;
  runs: number;
}

export function rollingMedians(samples: ScoreSample[]): Medians {
  const last = samples.slice(-PSI.medianOfRuns);
  return {
    perfMobile: median(last.map((s) => s.mobile.performance)),
    perfDesktop: median(last.map((s) => s.desktop.performance)),
    seoMobile: median(last.map((s) => s.mobile.seo)),
    seoDesktop: median(last.map((s) => s.desktop.seo)),
    runs: last.length,
  };
}

/** Jitter a retry so many sites paused by one 429 don't all retry in the same second. */
const retryDelay = (sec: number) => Math.round(sec + 60 + Math.random() * 300);

export function createPagespeedCheck(client: PsiClient): CheckModule {
  return {
    type: "pagespeed",
    queue: "psi",
    // Two Lighthouse runs (+ keyless spacing) can take a few minutes.
    maxRunMs: 6 * 60_000,

    async run(site, ctx): Promise<CheckRunResult> {
      if (domainInfo(site.url).local) {
        return { status: "UNKNOWN", reason: "not_applicable", message: "Google PageSpeed can't reach local/IP targets", metrics: {} };
      }

      const results: Partial<Record<PsiStrategy, PsiResult>> = {};
      for (const strategy of PSI.strategies) {
        const r = await client.run(site.url, strategy);
        if (!r.ok && r.kind === "rate_limited") {
          return {
            status: "UNKNOWN",
            reason: "rate_limited",
            message: `Skipped – rate limited. ${r.message}. Retrying automatically.`,
            metrics: { keyed: client.hasKey },
            details: { strategy, retryAfterSec: r.retryAfterSec },
            skipped: true,
            nextRunInSec: retryDelay(r.retryAfterSec),
          };
        }
        if (!r.ok) {
          return {
            status: "UNKNOWN",
            reason: "psi_error",
            message: `PageSpeed could not test the page (${strategy}): ${r.message}`,
            metrics: { keyed: client.hasKey },
            details: { strategy, httpStatus: r.status },
          };
        }
        results[strategy] = r.result;
      }

      const mobile = results.mobile!;
      const desktop = results.desktop!;
      const sample: ScoreSample = {
        at: new Date().toISOString(),
        mobile: { performance: mobile.scores.performance, seo: mobile.scores.seo },
        desktop: { performance: desktop.scores.performance, seo: desktop.scores.seo },
      };
      const samples = [...(((ctx.jobData.samples as ScoreSample[] | undefined) ?? []).slice(-(PSI.medianOfRuns - 1))), sample];
      const med = rollingMedians(samples);
      const t = ctx.thresholds;

      const metrics = {
        keyed: client.hasKey,
        perfMobile: mobile.scores.performance,
        perfDesktop: desktop.scores.performance,
        seoMobile: mobile.scores.seo,
        seoDesktop: desktop.scores.seo,
        a11yMobile: mobile.scores.accessibility,
        a11yDesktop: desktop.scores.accessibility,
        bpMobile: mobile.scores.bestPractices,
        bpDesktop: desktop.scores.bestPractices,
        medPerfMobile: med.perfMobile,
        medPerfDesktop: med.perfDesktop,
        medSeoMobile: med.seoMobile,
        medSeoDesktop: med.seoDesktop,
        lcpMobileMs: mobile.lab.lcpMs,
        lcpDesktopMs: desktop.lab.lcpMs,
        clsMobile: mobile.lab.cls,
        clsDesktop: desktop.lab.cls,
        tbtMobileMs: mobile.lab.tbtMs,
        tbtDesktopMs: desktop.lab.tbtMs,
        fcpMobileMs: mobile.lab.fcpMs,
        fcpDesktopMs: desktop.lab.fcpMs,
        fieldLcpMs: mobile.field?.lcpMs ?? null,
        fieldInpMs: mobile.field?.inpMs ?? null,
        fieldCls: mobile.field?.cls ?? null,
      };
      const details = { mobile, desktop, medians: med, thresholds: { minPerformance: t.minPerformance, minSeo: t.minSeo } };
      const jobData = { ...ctx.jobData, samples };

      const low: string[] = [];
      if (med.perfMobile != null && med.perfMobile < t.minPerformance) low.push(`mobile performance ${med.perfMobile}`);
      if (med.perfDesktop != null && med.perfDesktop < t.minPerformance) low.push(`desktop performance ${med.perfDesktop}`);
      const lowPerf = low.length > 0;
      if (med.seoMobile != null && med.seoMobile < t.minSeo) low.push(`mobile SEO ${med.seoMobile}`);
      if (med.seoDesktop != null && med.seoDesktop < t.minSeo) low.push(`desktop SEO ${med.seoDesktop}`);

      const scoresMsg = `Mobile ${mobile.scores.performance ?? "—"} · Desktop ${desktop.scores.performance ?? "—"} · SEO ${mobile.scores.seo ?? "—"}`;
      if (low.length) {
        // Always WARN (never FAIL): FAIL would trigger 60 s re-checks and burn PSI quota.
        return {
          status: "WARN",
          reason: lowPerf ? "low_performance" : "low_seo",
          message: `Median of last ${med.runs} run${med.runs > 1 ? "s" : ""} below threshold: ${low.join(", ")} (min perf ${t.minPerformance}, min SEO ${t.minSeo}). This run: ${scoresMsg}`,
          metrics,
          details,
          jobData,
        };
      }
      return { status: "OK", reason: "ok", message: scoresMsg, metrics, details, jobData };
    },
  };
}

export const psiClient = new PsiClient({ apiKey: env.PSI_API_KEY });
export const pagespeedCheck = createPagespeedCheck(psiClient);
