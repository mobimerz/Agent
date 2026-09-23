import { ActivityIcon, AlertTriangleIcon, ArrowDownCircleIcon, CheckCircle2Icon, GaugeIcon, GlobeIcon } from "lucide-react";
import { Incident, JobState, Site, jobKeys } from "@siteguard/db";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";

export const metadata = { title: "Overview" };

async function getOverview() {
  await db();
  const [counts, openIncidents, heartbeat] = await Promise.all([
    Site.aggregate<{ total: number; up: number; down: number; avgPerf: number | null }>([
      { $match: { status: "active" } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          up: { $sum: { $cond: [{ $eq: ["$current.health", "up"] }, 1, 0] } },
          down: { $sum: { $cond: [{ $eq: ["$current.health", "down"] }, 1, 0] } },
          avgPerf: { $avg: "$current.perfMobile" },
        },
      },
    ]),
    Incident.countDocuments({ isOpen: true }),
    JobState.findOne({ key: jobKeys.heartbeat }, { lastRunAt: 1 }).lean(),
  ]);
  const c = counts[0] ?? { total: 0, up: 0, down: 0, avgPerf: null };
  const workerAgeSec = heartbeat?.lastRunAt ? (Date.now() - heartbeat.lastRunAt.getTime()) / 1000 : null;
  return { ...c, openIncidents, workerOnline: workerAgeSec !== null && workerAgeSec < 180 };
}

function StatCard({ title, value, icon, tone }: { title: string; value: string | number; icon: React.ReactNode; tone?: string }) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="flex flex-row items-center justify-between px-4">
        <CardTitle className="text-muted-foreground text-sm font-medium">{title}</CardTitle>
        <span className={tone ?? "text-muted-foreground"}>{icon}</span>
      </CardHeader>
      <CardContent className="px-4">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

export default async function OverviewPage() {
  const o = await getOverview();

  return (
    <>
      <PageHeader
        title="Overview"
        description="Health of all monitored client websites."
        actions={
          <Badge variant="outline" className="gap-1.5">
            <span className={`size-2 rounded-full ${o.workerOnline ? "bg-success" : "bg-destructive"}`} />
            Worker {o.workerOnline ? "online" : "offline"}
          </Badge>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard title="Total sites" value={o.total} icon={<GlobeIcon className="size-4" />} />
        <StatCard title="Up" value={o.up} icon={<CheckCircle2Icon className="size-4" />} tone="text-success" />
        <StatCard title="Down" value={o.down} icon={<ArrowDownCircleIcon className="size-4" />} tone="text-destructive" />
        <StatCard
          title="Open incidents"
          value={o.openIncidents}
          icon={<AlertTriangleIcon className="size-4" />}
          tone={o.openIncidents ? "text-warning" : undefined}
        />
        <StatCard
          title="Avg performance"
          value={o.avgPerf == null ? "—" : Math.round(o.avgPerf)}
          icon={<GaugeIcon className="size-4" />}
        />
      </div>

      <div className="mt-6">
        {o.total === 0 ? (
          <EmptyState icon={<ActivityIcon />} title="No websites yet">
            Site management and uptime monitoring arrive in Phase 2.
          </EmptyState>
        ) : null}
      </div>
    </>
  );
}
