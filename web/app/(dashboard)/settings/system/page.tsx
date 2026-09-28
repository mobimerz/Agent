import { resolveFromRoot } from "@siteguard/core/env";
import { JobState, jobKeys, listBackups, UptimeHourly } from "@siteguard/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDateTime, timeAgo } from "@/lib/format";
import { requireAdmin } from "@/lib/session";
import { BackupButton } from "./backup-button";

export const metadata = { title: "System" };

const kb = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export default async function SystemPage() {
  await requireAdmin();
  await db();
  const dir = resolveFromRoot(env.BACKUP_DIR);
  const [backups, jobs, rollupHours] = await Promise.all([
    listBackups(dir),
    JobState.find({ key: { $in: [jobKeys.heartbeat, jobKeys.global("rollup"), jobKeys.global("backup")] } }).lean(),
    UptimeHourly.estimatedDocumentCount(),
  ]);
  const job = (k: string) => jobs.find((j) => j.key === k);
  const heartbeat = job(jobKeys.heartbeat);
  const rollup = job(jobKeys.global("rollup"));
  const backup = job(jobKeys.global("backup"));

  const rows = [
    { name: "Worker heartbeat", last: heartbeat?.lastRunAt, note: "every minute — the web app alerts if it is 15+ min old" },
    { name: "Uptime rollups", last: rollup?.lastRunAt, note: `hourly at :05 · ${rollupHours} site-hours kept (1 year)` },
    {
      name: "Database backup",
      last: backup?.lastRunAt,
      note: backup?.lastStatus === "FAIL" ? `FAILED: ${backup.lastError}` : `nightly at 02:30 · keeps ${env.BACKUP_KEEP_DAYS} days`,
      bad: backup?.lastStatus === "FAIL",
    },
  ];

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <PageHeader title="System" description="Background jobs, data retention and backups." />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Background jobs</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.name}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-xs">{r.last ? timeAgo(r.last) : <span className="text-muted-foreground">never</span>}</TableCell>
                  <TableCell className={r.bad ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>{r.note}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-muted-foreground mt-3 text-xs">
            Retention: raw check results 30 days · hourly uptime 1 year · reports 1 year · notifications 90 days · screenshots last 7 per site.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div className="grid gap-1">
            <CardTitle className="text-sm">Backups ({backups.length})</CardTitle>
            <CardDescription className="font-mono text-xs break-all">{dir}</CardDescription>
          </div>
          <BackupButton />
        </CardHeader>
        <CardContent className="grid gap-3">
          {backups.length === 0 ? (
            <p className="text-muted-foreground text-sm">No backups yet. The worker makes one every night at 02:30, or click “Back up now”.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Backup</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Documents</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {backups.map((b) => (
                  <TableRow key={b.name}>
                    <TableCell className="font-mono text-xs">{b.name}</TableCell>
                    <TableCell className="text-xs">{formatDateTime(b.createdAt)}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{b.documents.toLocaleString("en-IN")}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{kb(b.bytes)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="bg-muted/50 rounded-md p-3 text-xs">
            <p className="font-medium">Restore (replaces all data — stop the worker first)</p>
            <p className="text-muted-foreground mt-1">
              List: <code>pnpm db:restore</code> · restore: <code>pnpm db:restore {backups[0]?.name ?? "siteguard-YYYY-MM-DD_HHMM"} --yes</code>
            </p>
            <p className="text-muted-foreground mt-1">Backups live on the same server — copy them off-site regularly (see GO-LIVE-CHECKLIST).</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
