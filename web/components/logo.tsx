import { ShieldCheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span className="bg-primary text-primary-foreground grid size-7 place-items-center rounded-md">
        <ShieldCheckIcon className="size-4" />
      </span>
      SiteGuard
    </span>
  );
}
