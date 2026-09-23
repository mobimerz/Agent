import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BellOffIcon, ExternalLinkIcon } from "lucide-react";
import { CHECK_LABELS, formatDuration, reasonLabel, type CheckType } from "@siteguard/core";
import { IncidentActions } from "@/components/incidents/incident-actions";
import { IncidentStatusText, SeverityBadge } from "@/components/incidents/severity-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { getIncident } from "@/lib/queries/incidents";

export async function generateMetadata({ params }: PageProps<"/incidents/[id]">) {
  const data = await getIncident((await params).id);
  return { title: data ? `${data.inc.title} · ${data.site?.name ?? ""}` : "Incident" };
}

const DELIVERY_LABEL: Record<string, string> = {
  pending: "queued",
  sent: "sent",
  preview: "preview (not sent)",
  grouped: "in grouped email",
  skipped: "skipped",
  suppressed: "suppressed",
  failed: "FAILED",
  none: "—",
};

export default async function IncidentPage({ params }: PageProps<"/incidents/[id]">) {
  const data = await getIncident((await params).id);
  if (!data) notFound();
  const { inc, site, alerts, durationSec: duration } = data;
  const id = String(inc._id);

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={inc.severity} />
            <IncidentStatusText status={inc.status} />
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{inc.title}</h1>
          {site && (
            <Link href={`/sites/${String(site._id)}` as Route} className="text-muted-foreground hover:text-foreground mt-1 inline-flex items-center gap-1 text-sm">
              {site.name}
              {site.clientName ? ` · ${site.clientName}` : ""} <ExternalLinkIcon className="size-3" />
            </Link>
          )}
        </div>
        <IncidentActions incidentId={id} status={inc.status} />
      </div>

      {inc.suppressed && (
        <Alert>
          <BellOffIcon />
          <AlertDescription>
            {inc.suppressed === "maintenance" ? "Opened during a maintenance window — no email/Telegram alerts were sent." : "The site was flapping — up/down alerts are paused until it is stable for 30 minutes."}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="pt-0">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground text-xs">Check</dt>
              <dd>{CHECK_LABELS[inc.checkType as CheckType]}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Reason</dt>
              <dd>{reasonLabel(inc.reason)}</dd>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-muted-foreground text-xs">Detail</dt>
              <dd className="break-words">{inc.message}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Started</dt>
              <dd>{formatDateTime(inc.startedAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Last successful check</dt>
              <dd>{inc.lastOkAt ? formatDateTime(inc.lastOkAt) : "none recorded"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">{inc.resolvedAt ? "Total duration" : "Open for"}</dt>
              <dd className="font-medium">{formatDuration(duration)}</dd>
            </div>
            {inc.acknowledgedAt && (
              <div>
                <dt className="text-muted-foreground text-xs">Acknowledged</dt>
                <dd>
                  {formatDateTime(inc.acknowledgedAt)} by {inc.acknowledgedBy}
                </dd>
              </div>
            )}
            {inc.resolvedAt && (
              <div>
                <dt className="text-muted-foreground text-xs">Resolved</dt>
                <dd>
                  {formatDateTime(inc.resolvedAt)}
                  {inc.resolvedBy && inc.resolvedBy !== "auto" ? ` by ${inc.resolvedBy}` : " (auto)"}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-muted-foreground text-xs">Alert channels</dt>
              <dd>
                {[inc.policy?.email && "Email", inc.policy?.telegram && "Telegram", "In-app"].filter(Boolean).join(" · ")}
                {!inc.policy?.reminders && <span className="text-muted-foreground"> (no reminders)</span>}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-[1fr_18rem]">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="relative grid gap-4 border-l pl-4">
              {[...(inc.timeline ?? [])].reverse().map((t, i) => (
                <li key={i} className="relative">
                  <span className="bg-border absolute top-1.5 -left-[21px] size-2.5 rounded-full ring-4 ring-[var(--card)]" />
                  <div className="text-xs font-medium capitalize">
                    {t.type}
                    {t.by ? <span className="text-muted-foreground font-normal"> · {t.by}</span> : null}
                  </div>
                  <div className="text-sm break-words whitespace-pre-wrap">{t.message}</div>
                  <div className="text-muted-foreground text-xs">{formatDateTime(t.at)}</div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Alerts sent</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-xs">
            {alerts.length === 0 && <p className="text-muted-foreground">None.</p>}
            {alerts.map((a) => (
              <div key={String(a._id)} className="rounded-md border p-2">
                <div className="font-medium capitalize">{a.type}</div>
                <div className="text-muted-foreground">{formatDateTime(a.createdAt)}</div>
                <div className="mt-1">Email: {DELIVERY_LABEL[a.channels?.email ?? "none"]}</div>
                <div>Telegram: {DELIVERY_LABEL[a.channels?.telegram ?? "none"]}</div>
                {a.deliveryErrors?.email && <div className="text-destructive mt-1 break-words">{a.deliveryErrors.email}</div>}
                {a.deliveryErrors?.telegram && <div className="text-destructive mt-1 break-words">{a.deliveryErrors.telegram}</div>}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
