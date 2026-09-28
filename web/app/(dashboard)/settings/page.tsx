import Link from "next/link";
import { BellRingIcon, ChevronRightIcon, ServerIcon, SlidersHorizontalIcon, UsersIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession, roleOf } from "@/lib/session";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await requireSession();
  const isAdmin = roleOf(session) === "admin";

  return (
    <>
      <PageHeader title="Settings" description="Alerting, reports, thresholds and team." />
      <div className="grid gap-3 md:grid-cols-2">
        {isAdmin && (
          <Link href="/settings/users" className="group">
            <Card className="group-hover:border-foreground/20 transition-colors">
              <CardHeader className="flex flex-row items-center gap-3">
                <UsersIcon className="text-muted-foreground size-5" />
                <div className="flex-1">
                  <CardTitle>Users & invites</CardTitle>
                  <CardDescription>Invite teammates and manage roles.</CardDescription>
                </div>
                <ChevronRightIcon className="text-muted-foreground size-4" />
              </CardHeader>
            </Card>
          </Link>
        )}
        {isAdmin && (
          <Link href="/settings/notifications" className="group">
            <Card className="group-hover:border-foreground/20 transition-colors">
              <CardHeader className="flex flex-row items-center gap-3">
                <BellRingIcon className="text-muted-foreground size-5" />
                <div className="flex-1">
                  <CardTitle>Notifications</CardTitle>
                  <CardDescription>Email &amp; Telegram status, test messages, email quota, previews.</CardDescription>
                </div>
                <ChevronRightIcon className="text-muted-foreground size-4" />
              </CardHeader>
            </Card>
          </Link>
        )}
        {isAdmin && (
          <Link href="/settings/alerts" className="group">
            <Card className="group-hover:border-foreground/20 transition-colors">
              <CardHeader className="flex flex-row items-center gap-3">
                <SlidersHorizontalIcon className="text-muted-foreground size-5" />
                <div className="flex-1">
                  <CardTitle>Alerts, reports &amp; thresholds</CardTitle>
                  <CardDescription>Report times, recipients, default thresholds.</CardDescription>
                </div>
                <ChevronRightIcon className="text-muted-foreground size-4" />
              </CardHeader>
            </Card>
          </Link>
        )}
        {isAdmin && (
          <Link href="/settings/system" className="group">
            <Card className="group-hover:border-foreground/20 transition-colors">
              <CardHeader className="flex flex-row items-center gap-3">
                <ServerIcon className="text-muted-foreground size-5" />
                <div className="flex-1">
                  <CardTitle>System</CardTitle>
                  <CardDescription>Backups, background jobs, data retention.</CardDescription>
                </div>
                <ChevronRightIcon className="text-muted-foreground size-4" />
              </CardHeader>
            </Card>
          </Link>
        )}
      </div>
    </>
  );
}
