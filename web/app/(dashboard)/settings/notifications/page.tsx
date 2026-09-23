import Link from "next/link";
import { EyeIcon, MailIcon, SendIcon } from "lucide-react";
import { emailStatus, getEmailQuota, telegramStatus, type ChannelStatus } from "@siteguard/notify";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { notifyContext } from "@/lib/notify";
import { requireAdmin } from "@/lib/session";
import { TestButton } from "./test-button";

export const metadata = { title: "Notifications settings" };

function ModeBadge({ status }: { status: ChannelStatus }) {
  return status.mode === "live" ? (
    <Badge className="bg-success text-success-foreground">Live</Badge>
  ) : (
    <Badge variant="outline" className="border-warning/50 text-warning-foreground dark:text-warning">
      Preview mode
    </Badge>
  );
}

export default async function NotificationSettingsPage() {
  await requireAdmin();
  const ctx = await notifyContext();
  const email = emailStatus(ctx.config, ctx.settings);
  const telegram = telegramStatus(ctx.config, ctx.settings);
  const quota = await getEmailQuota(ctx);
  const anyPreview = email.mode === "preview" || telegram.mode === "preview";
  const pct = Math.min(100, Math.round((quota.used / quota.dailyLimit) * 100));

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <PageHeader title="Notifications" description="Where alerts go, and whether they are really being sent." />

      {anyPreview && (
        <Alert className="border-warning/50">
          <EyeIcon className="text-warning" />
          <AlertTitle>
            {email.mode === "preview" && telegram.mode === "preview" ? "Email & Telegram" : email.mode === "preview" ? "Email" : "Telegram"} not configured — running in preview mode
          </AlertTitle>
          <AlertDescription>
            <p>Nothing is actually sent. Every alert is rendered exactly as it would be and saved so you can inspect it.</p>
            <p className="mt-1 flex flex-wrap gap-3">
              <Link href="/dev/emails" className="font-medium underline underline-offset-4">
                View email previews →
              </Link>
              <Link href="/dev/telegram" className="font-medium underline underline-offset-4">
                View Telegram previews →
              </Link>
            </p>
            <p className="text-muted-foreground mt-1 text-xs">To go live: set the keys in <code>.env</code>, set <code>DRY_RUN=false</code> and restart (see docs/GO-LIVE-CHECKLIST.md).</p>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MailIcon className="size-4" /> Email (Brevo)
            </CardTitle>
            <CardDescription>Incidents, recoveries, reminders and daily reports.</CardDescription>
          </div>
          <ModeBadge status={email} />
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {email.reasons.length > 0 && <p className="text-muted-foreground text-xs">Preview because: {email.reasons.join(" · ")}</p>}
          <div>
            <div className="text-muted-foreground text-xs">From</div>
            <div>{ctx.config.fromEmail ? `${ctx.config.fromName} <${ctx.config.fromEmail}>` : <span className="text-muted-foreground">not set (ALERT_FROM_EMAIL)</span>}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Recipients</div>
            <div>{email.recipients.length ? email.recipients.join(", ") : <span className="text-muted-foreground">none (ALERT_TO_EMAILS)</span>}</div>
          </div>
          <div>
            <div className="text-muted-foreground mb-1 flex justify-between text-xs">
              <span>Emails today (Brevo free plan: 300/day)</span>
              <span className="tabular-nums">
                {quota.used} / {quota.dailyLimit}
              </span>
            </div>
            <div className="bg-muted h-2 overflow-hidden rounded-full">
              <div className={`h-full ${quota.remainingForAlerts === 0 ? "bg-destructive" : quota.digestMode ? "bg-warning" : "bg-success"}`} style={{ width: `${pct}%` }} />
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              {quota.reservedForReports} always reserved for the morning/night reports. After {quota.digestAfter} alert emails, alerts are batched into an hourly digest.
              {quota.remainingForAlerts === 0 && " Alert budget used up today — alerts continue on Telegram and in-app."}
            </p>
          </div>
          <TestButton channel="email" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <SendIcon className="size-4" /> Telegram
            </CardTitle>
            <CardDescription>Instant, short alerts on your phone. No daily limit.</CardDescription>
          </div>
          <ModeBadge status={telegram} />
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {telegram.reasons.length > 0 && <p className="text-muted-foreground text-xs">Preview because: {telegram.reasons.join(" · ")}</p>}
          <div>
            <div className="text-muted-foreground text-xs">Chat IDs</div>
            <div className="font-mono text-xs">{telegram.recipients.length ? telegram.recipients.join(", ") : <span className="text-muted-foreground font-sans">none (TELEGRAM_CHAT_ID)</span>}</div>
          </div>
          <TestButton channel="telegram" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Alert rules</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground grid gap-1 text-xs">
          <p>• Incident opens after 3 consecutive failures (2 re-checks, 60 s apart); warnings after 2 in a row.</p>
          <p>• Resolves only after 2 consecutive OK results.</p>
          <p>• 4+ up/down changes in 30 min → one “unstable” alert, then silence until stable for 30 min.</p>
          <p>• Bot-protection blocks: Telegram + in-app only, no email, no reminders.</p>
          <p>• Hacked/spam content: critical, always emailed immediately.</p>
          <p>• 5+ alerts within 10 min → one grouped email. Reminders every 2 h until acknowledged.</p>
          <p>• Worker offline 15+ min → critical alert sent directly by the web app.</p>
        </CardContent>
      </Card>
    </div>
  );
}
