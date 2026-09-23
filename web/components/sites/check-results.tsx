import { REASON_HINTS, reasonLabel, type CheckReason, type CheckStatus } from "@siteguard/core";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDay, formatMs, formatShort, timeAgo } from "@/lib/format";
import type { DayStatus, ResultRow } from "@/lib/queries/sites";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<CheckStatus, string> = {
  OK: "text-success",
  WARN: "text-warning-foreground dark:text-warning",
  FAIL: "text-destructive",
  UNKNOWN: "text-muted-foreground",
};

export function StatusText({ status, reason }: { status: CheckStatus; reason: CheckReason }) {
  return <span className={cn("font-medium", STATUS_TONE[status])}>{status === "OK" ? "OK" : reasonLabel(reason)}</span>;
}

/** Per-day bars: green all good, amber some warnings, red any failure, grey no data. */
export function DailyBars({ days }: { days: DayStatus[] }) {
  return (
    <div>
      <div className="flex h-8 items-stretch gap-[2px]" role="img" aria-label={`Daily status for the last ${days.length} days`}>
        {days.map((d) => {
          const tone = !d.total ? "bg-muted" : d.down ? "bg-destructive" : d.warn ? "bg-warning" : "bg-success";
          const pct = d.total ? (((d.total - d.down) / d.total) * 100).toFixed(2) : null;
          return (
            <Tooltip key={d.day}>
              <TooltipTrigger asChild>
                <div className={cn("min-w-0 flex-1 rounded-[2px] opacity-85 hover:opacity-100", tone)} />
              </TooltipTrigger>
              <TooltipContent>
                {formatDay(d.day)}: {pct ? `${pct}% up · ${d.down} failed · ${d.warn} warnings` : "no data"}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <div className="text-muted-foreground mt-1 flex justify-between text-xs">
        <span>{days.length} days ago</span>
        <span>Today</span>
      </div>
    </div>
  );
}

interface Hop {
  url: string;
  status: number;
}
interface Page {
  url: string;
  status: CheckStatus;
  reason: CheckReason;
  statusCode?: number;
  responseTimeMs?: number;
  message: string;
}

/** Full breakdown of the latest uptime result. */
export function UptimeResultDetail({ result }: { result: ResultRow }) {
  const d = result.details ?? {};
  const chain = (d.redirectChain as Hop[] | undefined) ?? [];
  const pages = (d.pages as Page[] | undefined) ?? [];
  const hint = REASON_HINTS[result.reason];
  const m = result.metrics as { statusCode?: number | null; responseTimeMs?: number | null; ttfbMs?: number | null; bytes?: number | null };

  return (
    <div className="grid gap-4 text-sm">
      <div className="grid gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <StatusText status={result.status} reason={result.reason} />
          <span className="text-muted-foreground">— {result.message}</span>
        </div>
        {hint && result.status !== "OK" && <p className="text-muted-foreground text-xs">{hint}</p>}
        {typeof d.errorCode === "string" && <p className="text-muted-foreground font-mono text-xs">Error code: {d.errorCode}</p>}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground text-xs">HTTP status</dt>
          <dd className="font-medium tabular-nums">{m.statusCode ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Response time</dt>
          <dd className="font-medium tabular-nums">{formatMs(m.responseTimeMs)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">TTFB (final hop)</dt>
          <dd className="font-medium tabular-nums">{formatMs(m.ttfbMs)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Checked</dt>
          <dd className="font-medium">{timeAgo(result.checkedAt)}</dd>
        </div>
      </dl>

      <div>
        <div className="text-muted-foreground mb-1 text-xs">Final URL</div>
        <div className="font-mono text-xs break-all">{String(d.finalUrl ?? "—")}</div>
        {chain.length > 0 && (
          <ol className="text-muted-foreground mt-2 grid gap-0.5 font-mono text-xs">
            {chain.map((h, i) => (
              <li key={i} className="break-all">
                <span className="text-foreground">{h.status}</span> {h.url} →
              </li>
            ))}
          </ol>
        )}
      </div>

      {pages.length > 0 && (
        <div>
          <div className="text-muted-foreground mb-1 text-xs">Important pages</div>
          <ul className="grid gap-1">
            {pages.map((p) => (
              <li key={p.url} className="flex flex-wrap items-baseline justify-between gap-x-3 rounded border px-2 py-1.5">
                <span className="font-mono text-xs break-all">{new URL(p.url).pathname}</span>
                <span className="text-xs">
                  <StatusText status={p.status} reason={p.reason} /> <span className="text-muted-foreground">{p.statusCode ?? ""} · {formatMs(p.responseTimeMs)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function RecentResultsTable({ results, showResponse = true }: { results: ResultRow[]; showResponse?: boolean }) {
  if (!results.length) return <p className="text-muted-foreground text-sm">No checks yet.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          <TableHead>Result</TableHead>
          {showResponse && <TableHead className="text-right">Response</TableHead>}
          <TableHead className="hidden 2xl:table-cell">Details</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {results.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="text-xs whitespace-nowrap">
              {formatShort(r.checkedAt)}
              {r.attempt > 0 && <span className="text-muted-foreground ml-1">· re-check {r.attempt}</span>}
            </TableCell>
            <TableCell className="text-xs">
              <StatusText status={r.status} reason={r.reason} />
            </TableCell>
            {showResponse && <TableCell className="text-right text-xs tabular-nums">{formatMs(r.metrics.responseTimeMs as number | null)}</TableCell>}
            <TableCell className="text-muted-foreground hidden max-w-md truncate text-xs 2xl:table-cell" title={r.message}>
              {r.message}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
