import Link from "next/link";
import { AlertTriangleIcon, ArrowDownCircleIcon, CheckCircle2Icon, GaugeIcon, GlobeIcon, PlusIcon } from "lucide-react";
import { Incident, JobState, jobKeys } from "@siteguard/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { PageHeader } from "@/components/page-header";
import { SitesFilters } from "@/components/sites/sites-filters";
import { SitesTable } from "@/components/sites/sites-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { getFilterOptions, listSites, parseSiteFilters, type SiteRow } from "@/lib/queries/sites";

export const metadata = { title: "Overview" };

async function getWorkerOnline() {
  await db();
  const hb = await JobState.findOne({ key: jobKeys.heartbeat }, { lastRunAt: 1 }).lean();
  return hb?.lastRunAt ? Date.now() - hb.lastRunAt.getTime() < 180_000 : false;
}

function summarize(all: SiteRow[]) {
  const active = all.filter((r) => !r.paused);
  const ms = active.map((r) => r.responseTimeMs).filter((v): v is number => v != null);
  return {
    total: active.length,
    up: active.filter((r) => r.status === "up").length,
    down: active.filter((r) => r.status === "down").length,
    attention: active.filter((r) => ["degraded", "blocked", "checking"].includes(r.status)).length,
    avgMs: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null,
  };
}

function StatCard({ title, value, icon, tone, hint }: { title: string; value: string | number; icon: React.ReactNode; tone?: string; hint?: string }) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="flex flex-row items-center justify-between px-4">
        <CardTitle className="text-muted-foreground text-sm font-medium">{title}</CardTitle>
        <span className={tone ?? "text-muted-foreground"}>{icon}</span>
      </CardHeader>
      <CardContent className="px-4">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {hint && <div className="text-muted-foreground mt-0.5 text-xs">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export default async function OverviewPage({ searchParams }: PageProps<"/">) {
  const filters = parseSiteFilters(await searchParams);
  const [allRows, rows, options, openIncidents, workerOnline] = await Promise.all([
    listSites({}),
    listSites(filters),
    getFilterOptions(),
    db().then(() => Incident.countDocuments({ isOpen: true })),
    getWorkerOnline(),
  ]);
  const s = summarize(allRows);

  const headline =
    s.total === 0
      ? "No websites monitored yet."
      : s.down + s.attention === 0
        ? `All ${s.total} websites running perfectly ✅`
        : `${s.down + s.attention} website${s.down + s.attention === 1 ? " needs" : "s need"} attention ⚠️`;

  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader
        title="Overview"
        description={headline}
        actions={
          <Badge variant="outline" className="gap-1.5">
            <span className={`size-2 rounded-full ${workerOnline ? "bg-success" : "bg-destructive"}`} />
            Worker {workerOnline ? "online" : "offline"}
          </Badge>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard title="Total sites" value={s.total} icon={<GlobeIcon className="size-4" />} hint={s.attention ? `${s.attention} degraded / blocked` : undefined} />
        <StatCard title="Up" value={s.up} icon={<CheckCircle2Icon className="size-4" />} tone="text-success" />
        <StatCard title="Down" value={s.down} icon={<ArrowDownCircleIcon className="size-4" />} tone={s.down ? "text-destructive" : undefined} />
        <StatCard
          title="Open incidents"
          value={openIncidents}
          icon={<AlertTriangleIcon className="size-4" />}
          tone={openIncidents ? "text-warning" : undefined}
          hint="Incident engine: Phase 3"
        />
        <StatCard title="Avg response" value={s.avgMs == null ? "—" : `${s.avgMs} ms`} icon={<GaugeIcon className="size-4" />} hint="Performance score: Phase 4" />
      </div>

      <div className="mt-6 mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SitesFilters clients={options.clients} tags={options.tags} />
        <Button asChild size="sm" className="self-start sm:self-auto">
          <Link href="/sites/new">
            <PlusIcon /> Add site
          </Link>
        </Button>
      </div>
      <SitesTable rows={rows} filters={filters} basePath="/" />
    </>
  );
}
