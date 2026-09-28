import type { Route } from "next";
import Link from "next/link";
import { FileTextIcon, MoonIcon, SunIcon } from "lucide-react";
import { DEFAULTS, REPORT_KIND_LABEL } from "@siteguard/core";
import { getSettings } from "@siteguard/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { listReports } from "@/lib/queries/reports";
import { requireSession, roleOf } from "@/lib/session";
import { SendReportButton } from "./send-report-button";

export const metadata = { title: "Reports" };

function Delivery({ state }: { state: string | null }) {
  if (!state) return <span className="text-muted-foreground">off</span>;
  const tone = state === "sent" ? "text-success" : state === "failed" ? "text-destructive" : "text-muted-foreground";
  return <span className={tone}>{state}</span>;
}

export default async function ReportsPage() {
  const session = await requireSession();
  await db();
  const [rows, settings] = await Promise.all([listReports(), getSettings()]);
  const morning = settings.reports?.morning ?? DEFAULTS.reportMorning;
  const night = settings.reports?.night ?? DEFAULTS.reportNight;

  return (
    <>
      <AutoRefresh seconds={60} />
      <PageHeader
        title="Reports"
        description={`Morning report at ${morning}, night report at ${night} (${settings.timezone}) — by email, Telegram and in-app. Kept for a year.`}
        actions={
          roleOf(session) === "admin" ? (
            <>
              <SendReportButton kind="morning" label="Send morning report now" />
              <SendReportButton kind="night" label="Send night report now" />
            </>
          ) : undefined
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon={<FileTextIcon />} title="No reports yet">
          The first one is sent at {morning} or {night}. Use “Send … now” to generate one immediately.
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Report</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead className="hidden md:table-cell">Changes</TableHead>
                <TableHead className="hidden lg:table-cell">Email</TableHead>
                <TableHead className="hidden lg:table-cell pr-4">Telegram</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="pl-4">
                    <Link href={`/reports/${r.id}` as Route} className="flex items-center gap-2 font-medium hover:underline">
                      {r.kind === "morning" ? <SunIcon className="size-4 text-amber-500" /> : <MoonIcon className="size-4 text-indigo-400" />}
                      {REPORT_KIND_LABEL[r.kind]}
                    </Link>
                    <div className="text-muted-foreground text-xs">
                      {formatDateTime(r.generatedAt)}
                      {r.manual && (
                        <Badge variant="outline" className="ml-1.5 text-[10px]">
                          manual
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className={r.down ? "text-destructive font-medium" : r.degraded || r.openIncidents ? "text-warning-foreground dark:text-warning" : ""}>{r.headline}</TableCell>
                  <TableCell className="hidden tabular-nums md:table-cell">{r.changes}</TableCell>
                  <TableCell className="hidden text-xs lg:table-cell">
                    <Delivery state={r.delivery.email} />
                  </TableCell>
                  <TableCell className="hidden pr-4 text-xs lg:table-cell">
                    <Delivery state={r.delivery.telegram} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
