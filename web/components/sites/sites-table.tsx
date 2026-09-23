import type { Route } from "next";
import Link from "next/link";
import { ArrowDownIcon, ArrowUpIcon, ArrowUpDownIcon, GlobeIcon } from "lucide-react";
import { reasonLabel } from "@siteguard/core";
import { EmptyState } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMs, timeAgo } from "@/lib/format";
import type { SiteFilters, SiteRow, SortKey } from "@/lib/queries/sites";
import { cn } from "@/lib/utils";
import { Sparkline } from "./sparkline";
import { StatusBadge } from "./status-badge";

function SortHeader({ label, sortKey, filters, basePath, className }: { label: string; sortKey: SortKey; filters: SiteFilters; basePath: string; className?: string }) {
  const active = filters.sort === sortKey;
  const nextDir = active && filters.dir === "asc" ? "desc" : "asc";
  const params = new URLSearchParams();
  for (const k of ["q", "client", "tag", "status"] as const) if (filters[k]) params.set(k, filters[k]!);
  params.set("sort", sortKey);
  params.set("dir", nextDir);
  const Icon = !active ? ArrowUpDownIcon : filters.dir === "asc" ? ArrowUpIcon : ArrowDownIcon;
  return (
    <TableHead className={className}>
      <Link href={`${basePath}?${params}` as Route} scroll={false} className={cn("hover:text-foreground inline-flex items-center gap-1", active && "text-foreground")}>
        {label}
        <Icon className="size-3" />
      </Link>
    </TableHead>
  );
}

function responseClass(ms: number | null) {
  if (ms == null) return "text-muted-foreground";
  if (ms > 3000) return "text-destructive";
  if (ms > 1000) return "text-warning-foreground dark:text-warning";
  return "";
}

function problemText(row: SiteRow) {
  if (row.status === "up" || row.status === "paused" || row.status === "unknown") return null;
  return row.uptimeReason && row.uptimeReason !== "ok" ? reasonLabel(row.uptimeReason) : row.uptimeMessage;
}

export function SitesTable({ rows, filters, basePath }: { rows: SiteRow[]; filters: SiteFilters; basePath: string }) {
  if (!rows.length) {
    const filtered = Boolean(filters.q || filters.client || filters.tag || filters.status);
    return (
      <EmptyState icon={<GlobeIcon />} title={filtered ? "No sites match these filters" : "No websites yet"}>
        {filtered ? "Try clearing a filter." : "Add your first site or import a CSV."}
      </EmptyState>
    );
  }

  return (
    <>
      {/* Mobile: cards */}
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 md:hidden">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/sites/${r.id}` as Route} className="bg-card hover:bg-accent/40 block rounded-lg border p-3 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.name}</div>
                  <div className="text-muted-foreground truncate text-xs">{r.url.replace(/^https?:\/\//, "")}</div>
                </div>
                <StatusBadge status={r.status} />
              </div>
              {problemText(r) && <div className="text-destructive mt-2 truncate text-xs">{problemText(r)}</div>}
              <div className="text-muted-foreground mt-2 flex items-center justify-between gap-2 text-xs">
                <span className={cn("tabular-nums", responseClass(r.responseTimeMs))}>{formatMs(r.responseTimeMs)}</span>
                <Sparkline values={r.spark} width={80} height={18} />
                <span>{timeAgo(r.lastCheckedAt)}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {/* Desktop: table */}
      <div className="hidden overflow-hidden rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHeader label="Site" sortKey="name" filters={filters} basePath={basePath} className="pl-4" />
              <SortHeader label="Client" sortKey="client" filters={filters} basePath={basePath} className="hidden xl:table-cell" />
              <SortHeader label="Status" sortKey="status" filters={filters} basePath={basePath} />
              <SortHeader label="Response" sortKey="response" filters={filters} basePath={basePath} className="text-right" />
              <TableHead className="hidden lg:table-cell">24 h</TableHead>
              <SortHeader label="Checked" sortKey="checked" filters={filters} basePath={basePath} className="pr-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className="group relative">
                <TableCell className="max-w-64 pl-4">
                  <Link href={`/sites/${r.id}` as Route} className="font-medium after:absolute after:inset-0 group-hover:underline">
                    {r.name}
                  </Link>
                  <div className="text-muted-foreground truncate text-xs">{r.url.replace(/^https?:\/\//, "")}</div>
                  {r.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.tags.slice(0, 4).map((t) => (
                        <span key={t} className="bg-muted text-muted-foreground rounded px-1.5 text-[11px]">
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground hidden max-w-40 truncate xl:table-cell">{r.clientName || "—"}</TableCell>
                <TableCell>
                  <StatusBadge status={r.status} />
                  {problemText(r) && <div className="text-muted-foreground mt-1 max-w-56 truncate text-xs" title={r.uptimeMessage}>{problemText(r)}</div>}
                </TableCell>
                <TableCell className={cn("text-right tabular-nums", responseClass(r.responseTimeMs))}>{formatMs(r.responseTimeMs)}</TableCell>
                <TableCell className="hidden lg:table-cell">
                  <Sparkline values={r.spark} />
                </TableCell>
                <TableCell className="text-muted-foreground pr-4 text-xs whitespace-nowrap">{timeAgo(r.lastCheckedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
