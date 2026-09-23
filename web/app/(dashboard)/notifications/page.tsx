import { BellIcon } from "lucide-react";
import { Notification } from "@siteguard/db";
import { EmptyState, PageHeader } from "@/components/page-header";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { MarkAllReadButton, NotificationItem } from "./notification-client";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  const session = await requireSession();
  const unreadOnly = (await searchParams).filter === "unread";
  await db();
  const uid = session.user.id;
  const query = { userId: null, ...(unreadOnly ? { readBy: { $ne: uid } } : {}) };
  const [items, unread] = await Promise.all([
    Notification.find(query).sort({ createdAt: -1 }).limit(100).lean(),
    Notification.countDocuments({ userId: null, readBy: { $ne: uid } }),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        description={`${unread} unread · kept for 90 days`}
        actions={unread > 0 ? <MarkAllReadButton /> : undefined}
      />
      <div className="mb-3 flex gap-2 text-sm">
        <a href="/notifications" className={!unreadOnly ? "font-medium underline underline-offset-4" : "text-muted-foreground"}>
          All
        </a>
        <a href="/notifications?filter=unread" className={unreadOnly ? "font-medium underline underline-offset-4" : "text-muted-foreground"}>
          Unread
        </a>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={<BellIcon />} title={unreadOnly ? "All caught up" : "No notifications yet"}>
          Incidents, recoveries and system alerts appear here in real time.
        </EmptyState>
      ) : (
        <ul className="grid gap-2">
          {items.map((n) => (
            <NotificationItem
              key={String(n._id)}
              n={{
                id: String(n._id),
                severity: n.severity,
                title: n.title,
                body: n.body ?? "",
                link: n.link ?? null,
                createdAt: n.createdAt.toISOString(),
                read: (n.readBy ?? []).includes(uid),
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
