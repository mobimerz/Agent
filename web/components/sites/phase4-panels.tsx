import { AlertTriangleIcon, CheckCircle2Icon, InfoIcon, KeyRoundIcon, MinusCircleIcon, XCircleIcon } from "lucide-react";
import { REASON_HINTS, SEO_ITEM_DEFS, type SeoChecklistItem, type SeoItemStatus } from "@siteguard/core";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatShort, timeAgo } from "@/lib/format";
import type { PsiPoint } from "@/lib/queries/checks";
import type { ResultRow } from "@/lib/queries/sites";
import { cn } from "@/lib/utils";
import { AcceptDnsButton } from "./accept-dns-button";
import { StatusText } from "./check-results";
import { CwvTrendCharts, ScoreHistoryCharts, SeriesLegend } from "./score-charts";

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-muted-foreground rounded-xl border border-dashed px-6 py-10 text-center text-sm">{children}</div>;
}

function Verdict({ result }: { result: ResultRow }) {
  const hint = REASON_HINTS[result.reason];
  return (
    <div className="grid gap-1 text-sm">
      <div>
        <StatusText status={result.status} reason={result.reason} />
        <span className="text-muted-foreground"> — {result.message}</span>
      </div>
      {hint && result.status !== "OK" && <p className="text-muted-foreground text-xs">{hint}</p>}
      <p className="text-muted-foreground text-xs">Checked {timeAgo(result.checkedAt)}</p>
    </div>
  );
}

// ─── Performance ────────────────────────────────────────────────────

interface Opportunity {
  id: string;
  title: string;
  displayValue?: string;
  savingsMs?: number;
}
interface StrategyDetail {
  scores: { performance: number | null; seo: number | null; accessibility: number | null; bestPractices: number | null };
  lab: { lcpMs: number | null; cls: number | null; tbtMs: number | null; fcpMs: number | null; ttfbMs: number | null };
  field: { scope: "url" | "origin"; lcpMs: number | null; inpMs: number | null; cls: number | null; category: string | null } | null;
  opportunities: Opportunity[];
}

function scoreTone(v: number | null | undefined) {
  if (v == null) return "text-muted-foreground";
  return v >= 90 ? "text-success" : v >= 50 ? "text-warning-foreground dark:text-warning" : "text-destructive";
}

function ScoreTile({ label, mobile, desktop, median }: { label: string; mobile: number | null; desktop: number | null; median?: [number | null, number | null] }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 flex items-baseline gap-3 tabular-nums">
        <span>
          <span className={cn("text-lg font-semibold", scoreTone(mobile))}>{mobile ?? "—"}</span>
          <span className="text-muted-foreground ml-1 text-xs">mobile</span>
        </span>
        <span>
          <span className={cn("text-lg font-semibold", scoreTone(desktop))}>{desktop ?? "—"}</span>
          <span className="text-muted-foreground ml-1 text-xs">desktop</span>
        </span>
      </div>
      {median && <div className="text-muted-foreground text-xs tabular-nums">median (last 3): {median[0] ?? "—"} / {median[1] ?? "—"}</div>}
    </div>
  );
}

const ms = (v: number | null | undefined) => (v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);

export function PerformancePanel({ latest, skippedAfter, history, minPerformance, minSeo }: { latest: ResultRow | null; skippedAfter: ResultRow | null; history: PsiPoint[]; minPerformance: number; minSeo: number }) {
  const keyed = (skippedAfter ?? latest)?.metrics.keyed;
  const m = (latest?.metrics ?? {}) as Record<string, number | null>;
  const d = latest?.details as { mobile?: StrategyDetail; desktop?: StrategyDetail } | null;
  const mobile = d?.mobile;

  return (
    <div className="grid gap-4">
      {keyed === false && (
        <Alert>
          <KeyRoundIcon />
          <AlertTitle>Running without a PageSpeed API key</AlertTitle>
          <AlertDescription>
            Google&apos;s keyless quota is tiny (often zero), so runs are spaced out, one at a time, and are frequently skipped with “rate limited”. That is never counted as a failure. Add a free key as <code className="bg-muted rounded px-1">PSI_API_KEY</code> (see GO-LIVE-CHECKLIST §6) and restart the worker — it is picked up automatically.
          </AlertDescription>
        </Alert>
      )}
      {skippedAfter && (
        <Alert className="border-warning/50">
          <AlertTriangleIcon className="text-warning" />
          <AlertTitle>Last run skipped – rate limited ({formatShort(skippedAfter.checkedAt)})</AlertTitle>
          <AlertDescription>{skippedAfter.message} Scores below are from the last successful run.</AlertDescription>
        </Alert>
      )}

      {!latest ? (
        <Empty>No PageSpeed results yet. Runs every 12 h (mobile + desktop); use “Run pagespeed check” to start one now.</Empty>
      ) : latest.status === "UNKNOWN" ? (
        <Card>
          <CardContent className="pt-6">
            <Verdict result={latest} />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Latest Lighthouse scores</CardTitle>
              <CardDescription>Alerts use the median of the last 3 runs and need 2 runs in a row below the threshold (scores naturally move 5–10 points between runs).</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <ScoreTile label={`Performance (alert < ${minPerformance})`} mobile={m.perfMobile ?? null} desktop={m.perfDesktop ?? null} median={[m.medPerfMobile ?? null, m.medPerfDesktop ?? null]} />
                <ScoreTile label={`SEO (alert < ${minSeo})`} mobile={m.seoMobile ?? null} desktop={m.seoDesktop ?? null} median={[m.medSeoMobile ?? null, m.medSeoDesktop ?? null]} />
                <ScoreTile label="Accessibility" mobile={m.a11yMobile ?? null} desktop={m.a11yDesktop ?? null} />
                <ScoreTile label="Best practices" mobile={m.bpMobile ?? null} desktop={m.bpDesktop ?? null} />
              </div>
              <Verdict result={latest} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm">Score history (30 days)</CardTitle>
              <SeriesLegend />
            </CardHeader>
            <CardContent>
              <ScoreHistoryCharts data={history} minPerformance={minPerformance} minSeo={minSeo} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <div className="grid gap-1">
                <CardTitle className="text-sm">Core Web Vitals trend (lab)</CardTitle>
                <CardDescription>Lighthouse lab values per run. Dashed line = Google&apos;s “good” limit.</CardDescription>
              </div>
              <SeriesLegend />
            </CardHeader>
            <CardContent>
              <CwvTrendCharts data={history} />
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Real visitors (Chrome UX Report, mobile)</CardTitle>
                <CardDescription>28-day p75 from real Chrome users — only available for sites with enough traffic.</CardDescription>
              </CardHeader>
              <CardContent>
                {mobile?.field ? (
                  <dl className="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground text-xs">LCP</dt>
                      <dd className="font-medium tabular-nums">{ms(mobile.field.lcpMs)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">INP</dt>
                      <dd className="font-medium tabular-nums">{ms(mobile.field.inpMs)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">CLS</dt>
                      <dd className="font-medium tabular-nums">{mobile.field.cls?.toFixed(2) ?? "—"}</dd>
                    </div>
                    <p className="text-muted-foreground col-span-3 text-xs">
                      {mobile.field.scope === "origin" ? "Whole-site (origin) data — this page alone has too little traffic." : "Data for this exact page."} Overall: {mobile.field.category ?? "—"}
                    </p>
                  </dl>
                ) : (
                  <p className="text-muted-foreground text-sm">Not enough real-user traffic for CrUX data. The lab charts above still apply.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Top opportunities (mobile)</CardTitle>
              </CardHeader>
              <CardContent>
                {mobile?.opportunities.length ? (
                  <ul className="grid gap-1.5 text-sm">
                    {mobile.opportunities.map((o) => (
                      <li key={o.id} className="flex items-baseline justify-between gap-3">
                        <span>{o.title}</span>
                        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{o.savingsMs ? `≈ ${ms(o.savingsMs)}` : (o.displayValue ?? "")}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-sm">No major opportunities reported.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// ─── SEO ────────────────────────────────────────────────────────────

const ITEM_ICON: Record<SeoItemStatus, { icon: typeof CheckCircle2Icon; tone: string; label: string }> = {
  pass: { icon: CheckCircle2Icon, tone: "text-success", label: "Pass" },
  fail: { icon: XCircleIcon, tone: "text-destructive", label: "Fail" },
  warn: { icon: AlertTriangleIcon, tone: "text-warning-foreground dark:text-warning", label: "Fix" },
  info: { icon: InfoIcon, tone: "text-muted-foreground", label: "Tip" },
  na: { icon: MinusCircleIcon, tone: "text-muted-foreground", label: "n/a" },
};

interface PageSeoRow {
  url: string;
  error?: string;
  robotsMeta: string | null;
  noindexMeta: boolean;
  xRobotsTag: string | null;
  noindexHeader: boolean;
  canonical: string | null;
}

export function SeoPanel({ latest }: { latest: ResultRow | null }) {
  if (!latest) return <Empty>No SEO results yet. The SEO check runs daily; use “Run seo check” to start one now.</Empty>;
  const d = (latest.details ?? {}) as { checklist?: SeoChecklistItem[]; pages?: PageSeoRow[]; robots?: { found: boolean; sitemaps: string[] } };
  const checklist = d.checklist ?? [];
  const passed = checklist.filter((i) => i.status === "pass").length;
  const applicable = checklist.filter((i) => i.status !== "na").length;

  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="pt-6">
          <Verdict result={latest} />
        </CardContent>
      </Card>

      {checklist.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              SEO checklist · {passed}/{applicable} passed
            </CardTitle>
            <CardDescription>Homepage + every important page. Red items keep the site out of Google and raise an alert.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {checklist.map((item) => {
                const def = SEO_ITEM_DEFS[item.id];
                const s = ITEM_ICON[item.status];
                const Icon = s.icon;
                const failed = item.status === "fail" || item.status === "warn" || item.status === "info";
                return (
                  <li key={item.id} className="flex gap-3 py-2.5">
                    <Icon className={cn("mt-0.5 size-4 shrink-0", s.tone)} aria-hidden />
                    <div className="grid min-w-0 flex-1 gap-0.5 text-sm">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium">{def.label}</span>
                        <span className={cn("text-xs font-medium", s.tone)}>{s.label}</span>
                        {item.pages?.length ? <span className="text-muted-foreground font-mono text-xs break-all">{item.pages.join(", ")}</span> : null}
                      </div>
                      {item.detail && <div className="text-muted-foreground font-mono text-xs break-all">{item.detail}</div>}
                      {failed && <p className="text-muted-foreground text-xs">How to fix: {def.fix}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {d.pages && d.pages.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Indexing per page</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Page</TableHead>
                  <TableHead>robots meta</TableHead>
                  <TableHead>X-Robots-Tag</TableHead>
                  <TableHead className="hidden md:table-cell">Canonical</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.pages.map((p) => (
                  <TableRow key={p.url}>
                    <TableCell className="font-mono text-xs">{new URL(p.url).pathname}</TableCell>
                    {p.error ? (
                      <TableCell colSpan={3} className="text-muted-foreground text-xs">
                        Not checked: {p.error}
                      </TableCell>
                    ) : (
                      <>
                        <TableCell className={cn("text-xs", p.noindexMeta && "text-destructive font-medium")}>{p.robotsMeta ?? "—"}</TableCell>
                        <TableCell className={cn("text-xs", p.noindexHeader && "text-destructive font-medium")}>{p.xRobotsTag ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground hidden max-w-xs truncate font-mono text-xs md:table-cell" title={p.canonical ?? ""}>
                          {p.canonical ?? "—"}
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── SSL, domain, DNS ───────────────────────────────────────────────

interface SslHost {
  host: string;
  connected: boolean;
  status: ResultRow["status"];
  reason: ResultRow["reason"];
  message: string;
  issuer?: string;
  validTo?: string;
  daysLeft?: number;
  hostnameMatch?: boolean;
  chainComplete?: boolean;
  altNames?: string[];
}

function YesNo({ ok, yes = "Yes", no = "No" }: { ok: boolean | undefined; yes?: string; no?: string }) {
  if (ok === undefined) return <span className="text-muted-foreground">—</span>;
  return ok ? <span className="text-success">✓ {yes}</span> : <span className="text-destructive font-medium">✗ {no}</span>;
}

export function SslCard({ latest }: { latest: ResultRow | null }) {
  const hosts = ((latest?.details?.hosts as SslHost[] | undefined) ?? []).filter(Boolean);
  const skipped = (latest?.details?.skipped as string[] | undefined) ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">SSL certificate</CardTitle>
        <CardDescription>Expiry, hostname match and full chain (missing intermediate) — apex and www are both checked when both resolve.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {!latest ? (
          <p className="text-muted-foreground text-sm">Waiting for the first SSL check…</p>
        ) : (
          <>
            <Verdict result={latest} />
            {hosts.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Host</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Hostname</TableHead>
                    <TableHead>Chain</TableHead>
                    <TableHead className="hidden lg:table-cell">Issuer</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hosts.map((h) => (
                    <TableRow key={h.host}>
                      <TableCell className="font-mono text-xs">{h.host}</TableCell>
                      <TableCell className="text-xs tabular-nums">{h.connected && h.validTo ? `${h.validTo.slice(0, 10)} (${h.daysLeft} d)` : <span className="text-muted-foreground">{h.message}</span>}</TableCell>
                      <TableCell className="text-xs">{h.connected ? <YesNo ok={h.hostnameMatch} yes="Match" no="Mismatch" /> : "—"}</TableCell>
                      <TableCell className="text-xs">{h.connected ? <YesNo ok={h.chainComplete} yes="Complete" no="Intermediate missing" /> : "—"}</TableCell>
                      <TableCell className="text-muted-foreground hidden text-xs lg:table-cell">{h.issuer ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {skipped.length > 0 && <p className="text-muted-foreground text-xs">Not checked (no DNS record): {skipped.join(", ")}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function DomainCard({ latest }: { latest: ResultRow | null }) {
  const d = (latest?.details ?? {}) as { domain?: string; registrar?: string | null; expiresAt?: string | null; registeredAt?: string | null; nameservers?: string[]; source?: string; cached?: boolean; fetchedAt?: string; staleError?: string; platform?: string };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Domain registration</CardTitle>
        <CardDescription>RDAP (WHOIS fallback) for the registrable domain, cached and shared by every site on that domain.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {!latest ? (
          <p className="text-muted-foreground">Waiting for the first domain check…</p>
        ) : latest.reason === "platform_managed" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Managed by platform</Badge>
            <span className="text-muted-foreground">{d.platform} renews its own domain — nothing to track.</span>
          </div>
        ) : (
          <>
            <Verdict result={latest} />
            {d.domain && (
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground text-xs">Domain</dt>
                  <dd className="font-medium">{d.domain}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Registrar</dt>
                  <dd className="font-medium">{d.registrar ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Expires</dt>
                  <dd className="font-medium tabular-nums">{d.expiresAt ? `${d.expiresAt.slice(0, 10)}${latest.metrics.daysLeft != null ? ` (${latest.metrics.daysLeft} d)` : ""}` : "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Registered</dt>
                  <dd className="tabular-nums">{d.registeredAt?.slice(0, 10) ?? "—"}</dd>
                </div>
              </dl>
            )}
            {d.fetchedAt && (
              <p className="text-muted-foreground text-xs">
                Source: {d.source?.toUpperCase()} · looked up {timeAgo(d.fetchedAt)}
                {d.cached ? " (cached)" : ""}
                {d.staleError ? ` · last refresh failed: ${d.staleError}` : ""}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

const DNS_TYPES = ["a", "aaaa", "cname", "ns", "mx"] as const;
type Records = Record<(typeof DNS_TYPES)[number], string[]>;
interface DnsChange {
  type: (typeof DNS_TYPES)[number];
  added: string[];
  removed: string[];
}

export function DnsCard({ siteId, latest, jobData }: { siteId: string; latest: ResultRow | null; jobData: Record<string, unknown> | null }) {
  const d = (latest?.details ?? {}) as { records?: Records; baseline?: Records; changes?: DnsChange[]; ignored?: DnsChange[]; behindCloudflare?: boolean; zone?: string | null };
  const baseline = (jobData?.baseline as Records | undefined) ?? d.baseline;
  const observed = (jobData?.observed as Records | undefined) ?? d.records;
  const changes = latest?.reason === "dns_changed" ? (d.changes ?? []) : [];
  const changed = new Map(changes.map((c) => [c.type, c]));

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <CardTitle className="text-sm">DNS records</CardTitle>
          <CardDescription>
            A/AAAA/CNAME for the site host, NS/MX for {d.zone ?? "the domain"}. Compared as sets (order and TTL ignored).
            {d.behindCloudflare ? " Behind Cloudflare: IP moves inside Cloudflare's ranges are ignored; NS changes still alert." : ""}
          </CardDescription>
        </div>
        {changes.length > 0 && <AcceptDnsButton siteId={siteId} />}
      </CardHeader>
      <CardContent className="grid gap-3">
        {!latest ? (
          <p className="text-muted-foreground text-sm">Waiting for the first DNS check…</p>
        ) : (
          <>
            <Verdict result={latest} />
            {observed && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Type</TableHead>
                    <TableHead>Current</TableHead>
                    <TableHead className="hidden md:table-cell">Baseline</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {DNS_TYPES.map((t) => {
                    const c = changed.get(t);
                    return (
                      <TableRow key={t}>
                        <TableCell className="text-xs font-medium uppercase">
                          {t}
                          {c && (
                            <Badge variant="destructive" className="ml-1 text-[10px]">
                              changed
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {observed[t]?.length ? (
                            observed[t].map((v) => (
                              <div key={v} className={cn(c?.added.includes(v) && "text-destructive font-medium")}>
                                {c?.added.includes(v) ? "+ " : ""}
                                {v}
                              </div>
                            ))
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground hidden font-mono text-xs md:table-cell">
                          {baseline?.[t]?.length
                            ? baseline[t].map((v) => (
                                <div key={v} className={cn(c?.removed.includes(v) && "line-through")}>
                                  {v}
                                </div>
                              ))
                            : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            {typeof jobData?.baselineAt === "string" && (
              <p className="text-muted-foreground text-xs">
                Baseline since {formatDateTime(jobData.baselineAt)}
                {typeof jobData.acceptedBy === "string" ? ` (accepted by ${jobData.acceptedBy})` : ""}.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
