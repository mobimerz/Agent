"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Trash2Icon, WrenchIcon } from "lucide-react";
import { toast } from "sonner";
import { addMaintenanceWindow, deleteMaintenanceWindow } from "@/app/(dashboard)/sites/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface MaintenanceRow {
  id: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  createdBy: string | null;
  /** Computed on the server at render time. */
  state: "active" | "past" | "scheduled";
}

const fmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

/** "YYYY-MM-DDTHH:mm" in the browser's local time, for <input type="datetime-local">. */
function localInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function MaintenanceCard({ siteId, windows }: { siteId: string; windows: MaintenanceRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState(() => {
    const now = new Date();
    return { startsAt: localInput(now), endsAt: localInput(new Date(now.getTime() + 2 * 3600_000)), reason: "" };
  });

  function add(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      // datetime-local is the viewer's local time; send an absolute instant.
      const res = await addMaintenanceWindow(siteId, { startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString(), reason: form.reason });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Maintenance window saved — no alerts during it");
      setForm((f) => ({ ...f, reason: "" }));
      router.refresh();
    });
  }

  function remove(id: string) {
    start(async () => {
      const res = await deleteMaintenanceWindow(siteId, id);
      if (!res.ok) return void toast.error(res.error);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <WrenchIcon className="size-4" /> Maintenance windows
        </CardTitle>
        <CardDescription>Planned work (hosting move, WordPress update…). Checks keep running and are recorded, but no alerts are sent and no reminders go out.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {windows.length > 0 && (
          <ul className="grid gap-1.5 text-sm">
            {windows.map((w) => {
              const active = w.state === "active";
              const past = w.state === "past";
              return (
                <li key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2">
                  <span className={active ? "text-warning-foreground dark:text-warning font-medium" : past ? "text-muted-foreground" : ""}>
                    {active ? "Active now · " : past ? "Past · " : "Scheduled · "}
                    {fmt.format(new Date(w.startsAt))} → {fmt.format(new Date(w.endsAt))}
                  </span>
                  {w.reason && <span className="text-muted-foreground text-xs">{w.reason}</span>}
                  {!past && (
                    <Button size="icon" variant="ghost" className="ml-auto size-7" aria-label="Delete maintenance window" disabled={pending} onClick={() => remove(w.id)}>
                      <Trash2Icon className="size-4" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="mw-start">Starts</Label>
            <Input id="mw-start" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mw-end">Ends</Label>
            <Input id="mw-end" type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mw-reason">Reason</Label>
            <Input id="mw-reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Moving to new hosting" maxLength={200} />
          </div>
          <Button type="submit" disabled={pending}>
            Add
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
