import type { Route } from "next";
import Link from "next/link";
import { AlertTriangleIcon, BellOffIcon } from "lucide-react";
import { CHECK_LABELS, formatDuration } from "@siteguard/core";
import { AutoRefresh } from "@/components/auto-refresh";
import { IncidentFilters } from "@/components/incidents/incident-filters";
import { IncidentStatusText, SeverityBadge } from "@/components/incidents/severity-badge";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatShort } from "@/lib/format";
import { incidentSiteOptions, listIncidents, parseIncidentFilters } from "@/lib/queries/incidents";

export const metadata = { title: "Incidents" };

export default async function IncidentsPage({ searchParams }: PageProps<"/incidents">) {
  const filters = parseIncidentFilters(await searchParams);
  const [rows, sites] = await Promise.all([listIncidents(filters), incidentSiteOptions()]);

  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader title="Incidents" description="Confirmed problems. Opened after 3 failed checks, resolved after 2 successful ones." />
      <div className="mb-4">
        <IncidentFilters sites={sites} />
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<AlertTriangleIcon />} title={filters.status === "active" ? "No open incidents 🎉" : "No incidents match"}>
          {filters.status === "active" ? "Everything is running. Past incidents are under “All”." : "Try another filter."}
        </EmptyState>
      ) : (
        <>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 md:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/incidents/${r.id}` as Route} className="bg-card block rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <SeverityBadge severity={r.severity} />
                    <IncidentStatusText status={r.status} />
                  </div>
                  <div className="mt-2 truncate font-medium">{r.siteName}</div>
                  <div className="truncate text-sm">{r.title}</div>
                  <div className="text-muted-foreground truncate text-xs">{r.message}</div>
                  <div className="text-muted-foreground mt-1 text-xs">
                    {formatShort(r.startedAt)} · {formatDuration(r.durationSec)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Severity</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Problem</TableHead>
                  <TableHead className="hidden xl:table-cell">Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead className="pr-4">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className="group relative">
                    <TableCell className="pl-4">
                      <SeverityBadge severity={r.severity} />
                    </TableCell>
                    <TableCell className="max-w-44">
                      <div className="truncate font-medium">{r.siteName}</div>
                      <div className="text-muted-foreground truncate text-xs">{CHECK_LABELS[r.checkType]}</div>
                    </TableCell>
                    <TableCell className="max-w-72">
                      <Link href={`/incidents/${r.id}` as Route} className="font-medium after:absolute after:inset-0 group-hover:underline">
                        {r.title}
                      </Link>
                      <div className="text-muted-foreground truncate text-xs">{r.message}</div>
                    </TableCell>
                    <TableCell className="hidden text-xs whitespace-nowrap xl:table-cell">{formatShort(r.startedAt)}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap tabular-nums">{formatDuration(r.durationSec)}</TableCell>
                    <TableCell className="pr-4">
                      <IncidentStatusText status={r.status} />
                      {r.suppressed && (
                        <span className="text-muted-foreground ml-1 inline-flex items-center gap-0.5 text-[11px]" title={`Alerts suppressed: ${r.suppressed}`}>
                          <BellOffIcon className="size-3" /> {r.suppressed}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </>
  );
}
