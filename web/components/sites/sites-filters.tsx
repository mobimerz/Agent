"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ALL = "__all";

const STATUS_OPTIONS = [
  ["down", "Down"],
  ["checking", "Failing · re-checking"],
  ["degraded", "Degraded"],
  ["blocked", "Blocked"],
  ["up", "Up"],
  ["unknown", "Pending"],
  ["paused", "Paused"],
] as const;

export function SitesFilters({ clients, tags }: { clients: string[]; tags: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [, startTransition] = useTransition();

  function update(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    startTransition(() => router.replace((qs ? `${pathname}?${qs}` : pathname) as Route, { scroll: false }));
  }

  // Debounced search
  useEffect(() => {
    if ((params.get("q") ?? "") === q) return;
    const t = setTimeout(() => update("q", q.trim() || null), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const hasFilters = ["q", "client", "tag", "status"].some((k) => params.get(k));

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative sm:w-64">
        <SearchIcon className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, URL, client…" className="pl-8" aria-label="Search sites" />
      </div>
      <div className="grid grid-cols-3 gap-2 sm:flex">
        <Select value={params.get("status") ?? ALL} onValueChange={(v) => update("status", v === ALL ? null : v)}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any status</SelectItem>
            {STATUS_OPTIONS.map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={params.get("client") ?? ALL} onValueChange={(v) => update("client", v === ALL ? null : v)} disabled={!clients.length}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Filter by client">
            <SelectValue placeholder="Client" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any client</SelectItem>
            {clients.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={params.get("tag") ?? ALL} onValueChange={(v) => update("tag", v === ALL ? null : v)} disabled={!tags.length}>
          <SelectTrigger className="w-full sm:w-36" aria-label="Filter by tag">
            <SelectValue placeholder="Tag" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any tag</SelectItem>
            {tags.map((t) => (
              <SelectItem key={t} value={t}>
                #{t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ("");
            const next = new URLSearchParams(params);
            ["q", "client", "tag", "status"].forEach((k) => next.delete(k));
            const qs = next.toString();
            router.replace((qs ? `${pathname}?${qs}` : pathname) as Route, { scroll: false });
          }}
        >
          <XIcon /> Clear
        </Button>
      )}
    </div>
  );
}
