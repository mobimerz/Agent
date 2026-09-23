"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ALL = "__all";

export function IncidentFilters({ sites }: { sites: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function update(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    router.replace((qs ? `${pathname}?${qs}` : pathname) as Route, { scroll: false });
  }

  return (
    <div className="grid grid-cols-3 gap-2 sm:flex">
      <Select value={params.get("status") ?? "active"} onValueChange={(v) => update("status", v === "active" ? null : v)}>
        <SelectTrigger className="w-full sm:w-44" aria-label="Filter by status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active">Open + acknowledged</SelectItem>
          <SelectItem value="OPEN">Open</SelectItem>
          <SelectItem value="ACKNOWLEDGED">Acknowledged</SelectItem>
          <SelectItem value="RESOLVED">Resolved</SelectItem>
          <SelectItem value="all">All</SelectItem>
        </SelectContent>
      </Select>
      <Select value={params.get("severity") ?? ALL} onValueChange={(v) => update("severity", v === ALL ? null : v)}>
        <SelectTrigger className="w-full sm:w-36" aria-label="Filter by severity">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Any severity</SelectItem>
          <SelectItem value="CRITICAL">Critical</SelectItem>
          <SelectItem value="WARNING">Warning</SelectItem>
          <SelectItem value="INFO">Info</SelectItem>
        </SelectContent>
      </Select>
      <Select value={params.get("site") ?? ALL} onValueChange={(v) => update("site", v === ALL ? null : v)} disabled={!sites.length}>
        <SelectTrigger className="w-full sm:w-48" aria-label="Filter by site">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Any site</SelectItem>
          {sites.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
