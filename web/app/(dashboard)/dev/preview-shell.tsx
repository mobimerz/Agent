import type { Route } from "next";
import Link from "next/link";
import { EyeIcon } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { formatShort } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface PreviewListItem {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  createdAt: string;
}

/** Shared list + detail layout for /dev/emails and /dev/telegram. */
export function PreviewShell({
  kind,
  items,
  selectedId,
  live,
  children,
}: {
  kind: "emails" | "telegram";
  items: PreviewListItem[];
  selectedId?: string;
  live: boolean;
  children: React.ReactNode;
}) {
  const other = kind === "emails" ? { href: "/dev/telegram", label: "Telegram previews" } : { href: "/dev/emails", label: "Email previews" };
  return (
    <>
      <PageHeader
        title={kind === "emails" ? "Email previews" : "Telegram previews"}
        description="Messages rendered in preview (DRY_RUN) mode — exactly what would have been sent. Kept 14 days."
        actions={
          <Link href={other.href as Route} className="text-sm underline underline-offset-4">
            {other.label} →
          </Link>
        }
      />
      {live && (
        <p className="text-muted-foreground mb-4 text-sm">
          This channel is <strong>live</strong> now — new messages are really sent and are no longer stored here.
        </p>
      )}
      {items.length === 0 ? (
        <EmptyState icon={<EyeIcon />} title="Nothing previewed yet">
          Trigger an alert (e.g. add a failing test site) or use “Send test” in Settings → Notifications.
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <ul className="grid max-h-[70vh] grid-cols-[minmax(0,1fr)] content-start gap-1 overflow-x-hidden overflow-y-auto rounded-lg border p-1">
            {items.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/dev/${kind}?id=${m.id}` as Route}
                  scroll={false}
                  className={cn("hover:bg-accent block rounded-md px-3 py-2", m.id === selectedId && "bg-accent")}
                >
                  <div className="truncate text-sm font-medium">{m.title}</div>
                  <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
                    <span className="truncate">{m.subtitle}</span>
                    <span className="shrink-0">{formatShort(m.createdAt)}</span>
                  </div>
                  <Badge variant="outline" className="mt-1 text-[10px]">
                    {m.category}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
          <div className="min-w-0">{children}</div>
        </div>
      )}
    </>
  );
}
