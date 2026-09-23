"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BellIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { NotificationPayload } from "@/lib/notification-hub";

const POLL_MS = 30_000;

/**
 * Real-time unread count via SSE (Change Stream on `notifications`), with a
 * polling fallback. New alerts also pop a toast and soft-refresh the page so
 * dashboards update without reloading.
 */
export function NotificationBell() {
  const router = useRouter();
  const [count, setCount] = useState<number | null>(null);
  const lastRefresh = useRef(0);

  useEffect(() => {
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let failures = 0;
    let closed = false;

    const startPolling = () => {
      if (poll) return;
      const load = () =>
        fetch("/api/notifications/unread", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .then((d: { count: number } | null) => d && setCount(d.count))
          .catch(() => {});
      void load();
      poll = setInterval(load, POLL_MS);
    };

    const connect = () => {
      es = new EventSource("/api/notifications/stream");
      es.addEventListener("unread", (e) => {
        failures = 0;
        setCount((JSON.parse((e as MessageEvent).data) as { count: number }).count);
      });
      es.addEventListener("notification", (e) => {
        const n = JSON.parse((e as MessageEvent).data) as NotificationPayload;
        const opts = {
          description: n.body,
          action: n.link ? { label: "Open", onClick: () => router.push(new URL(n.link!, location.origin).pathname as Route) } : undefined,
          duration: n.severity === "CRITICAL" ? 15_000 : 6_000,
        };
        if (n.severity === "CRITICAL") toast.error(n.title, opts);
        else if (n.severity === "WARNING") toast.warning(n.title, opts);
        else toast.info(n.title, opts);
        // Refresh server data at most every 5 s during bursts.
        if (Date.now() - lastRefresh.current > 5000) {
          lastRefresh.current = Date.now();
          router.refresh();
        }
      });
      es.onerror = () => {
        failures++;
        // EventSource auto-reconnects; after repeated failures switch to polling.
        if (failures >= 3 && !closed) {
          es?.close();
          startPolling();
        }
      };
    };

    if (typeof EventSource === "undefined") startPolling();
    else connect();

    return () => {
      closed = true;
      es?.close();
      if (poll) clearInterval(poll);
    };
  }, [router]);

  const label = count ? `Notifications (${count} unread)` : "Notifications";
  return (
    <Button variant="ghost" size="icon" asChild aria-label={label} className="relative">
      <Link href="/notifications">
        <BellIcon className="size-4" />
        {count ? (
          <span className="bg-destructive text-destructive-foreground absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] leading-none font-semibold text-white tabular-nums">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}
