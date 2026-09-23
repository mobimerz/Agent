import type { IncidentStatus, Severity } from "@siteguard/core";
import { cn } from "@/lib/utils";

const SEVERITY: Record<Severity, string> = {
  CRITICAL: "bg-destructive/10 text-destructive border-destructive/30",
  WARNING: "bg-warning/15 text-warning-foreground dark:text-warning border-warning/40",
  INFO: "bg-muted text-muted-foreground border-border",
};

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide", SEVERITY[severity], className)}>{severity}</span>;
}

const STATUS: Record<IncidentStatus, string> = {
  OPEN: "text-destructive",
  ACKNOWLEDGED: "text-warning-foreground dark:text-warning",
  RESOLVED: "text-success",
};

export function IncidentStatusText({ status }: { status: IncidentStatus }) {
  return <span className={cn("text-xs font-medium", STATUS[status])}>{status === "ACKNOWLEDGED" ? "Acknowledged" : status === "OPEN" ? "Open" : "Resolved"}</span>;
}
