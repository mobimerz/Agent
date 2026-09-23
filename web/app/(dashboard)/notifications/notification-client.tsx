"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CheckCheckIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { markAllNotificationsRead, markNotificationRead } from "./actions";

interface Item {
  id: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  read: boolean;
}

const DOT = { CRITICAL: "bg-destructive", WARNING: "bg-warning", INFO: "bg-primary/60" } as const;

export function NotificationItem({ n }: { n: Item }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  function open() {
    startTransition(async () => {
      if (!n.read) await markNotificationRead(n.id);
      if (n.link) router.push(new URL(n.link, location.origin).pathname as Route);
      else router.refresh();
    });
  }

  return (
    <li>
      <button
        type="button"
        onClick={open}
        className={cn("hover:bg-accent/50 flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors", !n.read && "bg-accent/30 border-primary/20")}
      >
        <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-muted-foreground/30" : DOT[n.severity])} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className={cn("block text-sm", !n.read && "font-semibold")}>{n.title}</span>
          {n.body && <span className="text-muted-foreground block text-xs break-words">{n.body}</span>}
          <span className="text-muted-foreground mt-1 block text-xs">{timeAgo(n.createdAt)}</span>
        </span>
        {!n.read && <span className="sr-only">unread</span>}
      </button>
    </li>
  );
}

export function MarkAllReadButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await markAllNotificationsRead();
          toast.success(`Marked ${r.updated} as read`);
          router.refresh();
        })
      }
    >
      <CheckCheckIcon /> Mark all read
    </Button>
  );
}
