import { notFound } from "next/navigation";
import { ExternalLinkIcon, ShieldAlertIcon } from "lucide-react";
import { CHECK_PHASE, DEFAULT_THRESHOLDS, displayStatus, USER_AGENT, type CheckType, type LatestChecks } from "@siteguard/core";
import { AutoRefresh } from "@/components/auto-refresh";
import { DailyBars, RecentResultsTable, StatusText, UptimeResultDetail } from "@/components/sites/check-results";
import { ResponseChart } from "@/components/sites/response-chart";
import { RunCheckButton } from "@/components/sites/run-check-button";
import { SiteActions } from "@/components/sites/site-actions";
import { StatusBadge } from "@/components/sites/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatInterval, formatMs, formatPct, formatTime, timeAgo } from "@/lib/format";
import { listIncidents } from "@/lib/queries/incidents";
import { getDailyStatus, getJobs, getRecentResults, getResponseSeries, getSite, getUptimeStats } from "@/lib/queries/sites";
import { IncidentStatusText, SeverityBadge } from "@/components/incidents/severity-badge";
import Link from "next/link";
import type { Route } from "next";
import { formatDuration } from "@siteguard/core";
import { formatShort } from "@/lib/format";
import { requireSession, roleOf } from "@/lib/session";

export async function generateMetadata({ params }: PageProps<"/sites/[id]">) {
  const site = await getSite((await params).id);
  return { title: site?.name ?? "Site" };
}

const FUTURE_TABS: { value: string; label: string; types: CheckType[] }[] = [
  { value: "performance", label: "Performance", types: ["pagespeed"] },
  { value: "seo", label: "SEO", types: ["seo"] },
  { value: "ssl", label: "SSL & Domain", types: ["ssl", "domain", "dns"] },
  { value: "forms", label: "Forms", types: ["form"] },
  { value: "security", label: "Security", types: ["headers"] },
  { value: "screenshots", label: "Screenshots", types: ["browser"] },
];

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-muted-foreground text-xs">{sub}</div>}
    </div>
  );
}

export default async function SiteDetailPage({ params }: PageProps<"/sites/[id]">) {
  const session = await requireSession();
  const site = await getSite((await params).id);
  if (!site) notFound();

  const [uptimeResults, contentResults, stats, day, week, days, jobs, incidents] = await Promise.all([
    getRecentResults(site._id, "uptime", 20),
    getRecentResults(site._id, "content", 10),
    getUptimeStats(site._id),
    getResponseSeries(site._id, "24h"),
    getResponseSeries(site._id, "7d"),
    getDailyStatus(site._id, 30),
    getJobs(site._id),
    listIncidents({ site: String(site._id) }, 50),
  ]);
  const openIncidents = incidents.filter((i) => i.status !== "RESOLVED");

  const id = String(site._id);
  const checks = (site.current?.checks ?? {}) as LatestChecks;
  const status = displayStatus({ status: site.status, current: { health: site.current?.health, checks } });
  const latestUptime = uptimeResults[0];
  const latestContent = contentResults[0];
  const slowMs = site.thresholds?.responseTimeWarnMs ?? DEFAULT_THRESHOLDS.responseTimeWarnMs;
  const uptimeJob = jobs.get("uptime");
  const paused = site.status === "paused";

  return (
    <>
      <AutoRefresh seconds={30} />

      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{site.name}</h1>
            <StatusBadge status={status} />
          </div>
          <a href={site.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground mt-1 inline-flex items-center gap-1 text-sm break-all">
            {site.url} <ExternalLinkIcon className="size-3 shrink-0" />
          </a>
          <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-xs">
            {site.clientName && <span>Client: <span className="text-foreground">{site.clientName}</span></span>}
            {site.framework && <Badge variant="secondary">{site.framework}</Badge>}
            {site.tags?.map((t) => (
              <Badge key={t} variant="outline">#{t}</Badge>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!paused && <RunCheckButton siteId={id} type="uptime" variant="default" />}
          {!paused && site.checks?.content?.enabled !== false && <RunCheckButton siteId={id} type="content" />}
          <SiteActions siteId={id} siteName={site.name} paused={paused} isAdmin={roleOf(session) === "admin"} />
        </div>
      </div>

      {openIncidents.length > 0 && (
        <Alert className="border-destructive/40 mb-4">
          <AlertTitle>{openIncidents.length} open incident{openIncidents.length > 1 ? "s" : ""}</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 grid gap-1">
              {openIncidents.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={i.severity} />
                  <Link href={`/incidents/${i.id}` as Route} className="font-medium underline underline-offset-4">
                    {i.title}
                  </Link>
                  <span className="text-muted-foreground text-xs">since {formatShort(i.startedAt)} · {formatDuration(i.durationSec)}</span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {paused && (
        <Alert className="mb-4">
          <AlertTitle>Monitoring paused</AlertTitle>
          <AlertDescription>No checks run and no alerts are sent until you resume it (⋯ menu).</AlertDescription>
        </Alert>
      )}

      {checks.uptime?.reason === "blocked" && (
        <Alert className="border-warning/50 mb-4">
          <ShieldAlertIcon className="text-warning" />
          <AlertTitle>Monitoring is being blocked by bot protection</AlertTitle>
          <AlertDescription>
            <p>{checks.uptime.message}. This is shown as a warning, not downtime — the site is probably fine for visitors.</p>
            <p className="mt-1">
              Fix: allow the User-Agent <code className="bg-muted rounded px-1">{USER_AGENT}</code>
              {" "}and your SiteGuard server&apos;s public IP. In Cloudflare: <em>Security → WAF → Custom rules → Skip</em> (or an IP Access Rule “Allow”). In cPanel/Wordfence/Sucuri: add the IP to the allowlist.
            </p>
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="uptime">
        <div className="-mx-4 overflow-x-auto overflow-y-hidden px-4 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden">
          <TabsList>
            <TabsTrigger value="uptime">Uptime</TabsTrigger>
            <TabsTrigger value="content">Content</TabsTrigger>
            <TabsTrigger value="incidents">Incidents{openIncidents.length ? ` (${openIncidents.length})` : ""}</TabsTrigger>
            {FUTURE_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="uptime" className="mt-4 grid gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Uptime 24 h" value={formatPct(stats.h24)} />
            <Stat label="Uptime 7 d" value={formatPct(stats.d7)} />
            <Stat label="Uptime 30 d" value={formatPct(stats.d30)} />
            <Stat label="Avg response 24 h" value={formatMs(stats.avgMs24)} />
            <Stat
              label="Schedule"
              value={uptimeJob?.enabled ? `every ${formatInterval(uptimeJob.intervalSec ?? 300)}` : "off"}
              sub={uptimeJob?.enabled && uptimeJob.nextRunAt ? `next ${uptimeJob.nextRunAt > new Date() ? `at ${formatTime(uptimeJob.nextRunAt)}` : "now"}` : undefined}
            />
          </div>

          <Card>
            <CardContent className="pt-0">
              <ResponseChart day={day} week={week} slowMs={slowMs} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Last 30 days</CardTitle>
            </CardHeader>
            <CardContent>
              <DailyBars days={days} />
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Latest result</CardTitle>
              </CardHeader>
              <CardContent>
                {latestUptime ? <UptimeResultDetail result={latestUptime} /> : <p className="text-muted-foreground text-sm">Waiting for the first check…</p>}
                {(uptimeJob?.retryAttempt ?? 0) > 0 && (
                  <p className="text-destructive mt-3 text-xs">
                    Failing — confirmation re-check {uptimeJob!.retryAttempt} of 2 runs in ~60 s. An incident is raised only after 3 consecutive failures.
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Recent checks</CardTitle>
              </CardHeader>
              <CardContent>
                <RecentResultsTable results={uptimeResults.slice(0, 12)} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="content" className="mt-4 grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Content & defacement</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {latestContent ? (
                <>
                  <div>
                    <StatusText status={latestContent.status} reason={latestContent.reason} />
                    <span className="text-muted-foreground"> — {latestContent.message}</span>
                  </div>
                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div>
                      <dt className="text-muted-foreground text-xs">Required keyword</dt>
                      <dd>{site.content?.requiredKeyword ? `“${site.content.requiredKeyword}” ${latestContent.metrics.keywordFound ? "✓" : "✗"}` : "not set"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">Spam words found</dt>
                      <dd>{((latestContent.details?.spamFound as string[] | undefined) ?? []).join(", ") || "none"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">Page size</dt>
                      <dd className="tabular-nums">{latestContent.metrics.bytes ? `${Math.round(Number(latestContent.metrics.bytes) / 1024)} KB` : "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">vs. usual</dt>
                      <dd className="tabular-nums">{latestContent.metrics.sizeChangePct != null ? `${Number(latestContent.metrics.sizeChangePct) > 0 ? "+" : ""}${latestContent.metrics.sizeChangePct}%` : "baseline"}</dd>
                    </div>
                  </dl>
                  <p className="text-muted-foreground text-xs">Checked {timeAgo(latestContent.checkedAt)}. Runs every {formatInterval(jobs.get("content")?.intervalSec ?? 1800)}.</p>
                </>
              ) : (
                <p className="text-muted-foreground">{site.checks?.content?.enabled === false ? "Content check is disabled for this site." : "Waiting for the first content check…"}</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">History</CardTitle>
            </CardHeader>
            <CardContent>
              <RecentResultsTable results={contentResults} showResponse={false} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="incidents" className="mt-4">
          {incidents.length === 0 ? (
            <div className="text-muted-foreground rounded-xl border border-dashed px-6 py-12 text-center text-sm">No incidents for this site.</div>
          ) : (
            <ul className="grid gap-2">
              {incidents.map((i) => (
                <li key={i.id}>
                  <Link href={`/incidents/${i.id}` as Route} className="hover:bg-accent/40 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-3">
                    <SeverityBadge severity={i.severity} />
                    <span className="font-medium">{i.title}</span>
                    <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">{i.message}</span>
                    <span className="text-muted-foreground text-xs">{formatShort(i.startedAt)} · {formatDuration(i.durationSec)}</span>
                    <IncidentStatusText status={i.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {FUTURE_TABS.map((t) => (
          <TabsContent key={t.value} value={t.value} className="mt-4">
            <div className="text-muted-foreground rounded-xl border border-dashed px-6 py-12 text-center text-sm">
              {t.label} checks arrive in Phase {CHECK_PHASE[t.types[0]!]}.
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}
