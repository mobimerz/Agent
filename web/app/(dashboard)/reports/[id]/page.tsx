import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDuration, REPORT_KIND_LABEL, upcomingExpiries } from "@siteguard/core";
import { SeverityBadge } from "@/components/incidents/severity-badge";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/sites/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatMs, formatPct, formatShort } from "@/lib/format";
import { getReport } from "@/lib/queries/reports";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: PageProps<"/reports/[id]">) {
  const r = await getReport((await params).id);
  return { title: r ? `${REPORT_KIND_LABEL[r.kind]} ${r.date}` : "Report" };
}

function Tile({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className={cn("mt-0.5 text-2xl font-semibold tabular-nums", tone)}>{value}</div>
    </div>
  );
}

const TONE = { bad: "text-destructive", good: "text-success", info: "text-muted-foreground" } as const;
const DOT = { bad: "🔴", good: "🟢", info: "🔵" } as const;

export default async function ReportPage({ params }: PageProps<"/reports/[id]">) {
  const r = await getReport((await params).id);
  if (!r) notFound();
  const s = r.summary;
  const expiries = upcomingExpiries(r.sites);

  return (
    <div className="grid gap-4">
      <PageHeader
        title={`${REPORT_KIND_LABEL[r.kind]} · ${r.date}`}
        description={`${formatDateTime(r.periodStart)} → ${formatDateTime(r.periodEnd)}${r.manual ? " · sent manually" : ""} · email: ${r.delivery.email ?? "off"} · Telegram: ${r.delivery.telegram ?? "off"}`}
        actions={
          <Link href={"/reports" as Route} className="text-muted-foreground text-sm hover:underline">
            ← All reports
          </Link>
        }
      />

      <p className={cn("text-lg font-semibold", s.down ? "text-destructive" : s.degraded || s.blocked || s.openIncidents ? "text-warning-foreground dark:text-warning" : "text-success")}>{s.headline}</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label="Up" value={s.up} tone="text-success" />
        <Tile label="Down" value={s.down} tone={s.down ? "text-destructive" : undefined} />
        <Tile label="Degraded / blocked" value={s.degraded + s.blocked} tone={s.degraded + s.blocked ? "text-warning-foreground dark:text-warning" : undefined} />
        <Tile label="Open incidents" value={s.openIncidents} />
        <Tile label="Avg uptime (period)" value={formatPct(s.avgUptime)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Since the previous report</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1.5 text-sm">
            {r.changes.length === 0 && r.incidents.resolved.length === 0 && r.incidents.opened.length === 0 && <p className="text-muted-foreground">No changes.</p>}
            {r.changes.map((c, i) => (
              <p key={i}>
                {DOT[c.tone]}{" "}
                <Link href={`/sites/${c.siteId}` as Route} className="font-medium hover:underline">
                  {c.siteName}
                </Link>{" "}
                <span className={TONE[c.tone]}>{c.text}</span>
              </p>
            ))}
            {r.incidents.resolved.map((i) => (
              <p key={`r${i.id}`}>
                ✅ <span className="font-medium">{i.siteName}</span> resolved: {i.title} <span className="text-muted-foreground">({formatDuration(i.durationSec)})</span>
              </p>
            ))}
            {r.incidents.opened
              .filter((i) => !i.resolvedAt)
              .map((i) => (
                <p key={`o${i.id}`}>
                  {i.severity === "CRITICAL" ? "🔴" : "🟠"} <span className="font-medium">{i.siteName}</span> new incident: {i.title} <span className="text-muted-foreground">since {formatShort(i.startedAt)}</span>
                </p>
              ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Open incidents & renewals</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1.5 text-sm">
            {r.incidents.open.length === 0 && expiries.length === 0 && <p className="text-muted-foreground">Nothing open, no renewals due within 30 days.</p>}
            {r.incidents.open.map((i) => (
              <Link key={i.id} href={`/incidents/${i.id}` as Route} className="flex flex-wrap items-center gap-2 hover:underline">
                <SeverityBadge severity={i.severity} />
                <span className="font-medium">{i.siteName}</span> — {i.title}
              </Link>
            ))}
            {expiries.map((e, i) => (
              <p key={i} className={e.daysLeft <= 7 ? "text-destructive" : undefined}>
                {e.daysLeft <= 7 ? "🔴" : "🟠"} <span className="font-medium">{e.siteName}</span> — {e.what} {e.daysLeft < 0 ? "expired" : `expires in ${e.daysLeft} days`}
              </p>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">All sites at report time ({r.sites.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Site</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Uptime</TableHead>
                <TableHead className="hidden text-right md:table-cell">Avg response</TableHead>
                <TableHead className="hidden lg:table-cell">Issues</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.sites.map((x) => (
                <TableRow key={x.id}>
                  <TableCell>
                    <Link href={`/sites/${x.id}` as Route} className="font-medium hover:underline">
                      {x.name}
                    </Link>
                    {x.clientName && <div className="text-muted-foreground text-xs">{x.clientName}</div>}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={x.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatPct(x.uptimePct)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">{formatMs(x.avgResponseMs)}</TableCell>
                  <TableCell className="text-muted-foreground hidden max-w-md truncate text-xs lg:table-cell" title={x.issues.map((i) => i.message).join("\n")}>
                    {x.issues.map((i) => i.message).join(" · ") || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
