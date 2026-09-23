import type { DisplayStatus } from "@siteguard/core";
import { cn } from "@/lib/utils";

const STYLES: Record<DisplayStatus, { label: string; dot: string; badge: string }> = {
  up: { label: "Up", dot: "bg-success", badge: "bg-success/10 text-success border-success/30" },
  down: { label: "Down", dot: "bg-destructive", badge: "bg-destructive/10 text-destructive border-destructive/30" },
  checking: { label: "Failing · re-checking", dot: "bg-destructive animate-pulse", badge: "bg-destructive/10 text-destructive border-destructive/30" },
  degraded: { label: "Degraded", dot: "bg-warning", badge: "bg-warning/15 text-warning-foreground dark:text-warning border-warning/40" },
  blocked: { label: "Blocked", dot: "bg-warning", badge: "bg-warning/15 text-warning-foreground dark:text-warning border-warning/40" },
  unknown: { label: "Pending", dot: "bg-muted-foreground/50", badge: "bg-muted text-muted-foreground border-border" },
  paused: { label: "Paused", dot: "bg-muted-foreground/50", badge: "bg-muted text-muted-foreground border-border" },
};

export function StatusBadge({ status, className }: { status: DisplayStatus; className?: string }) {
  const s = STYLES[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", s.badge, className)}>
      <span className={cn("size-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

export function statusLabel(status: DisplayStatus) {
  return STYLES[status].label;
}
