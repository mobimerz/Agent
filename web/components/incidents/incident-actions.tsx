"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCheckIcon, CheckIcon, MessageSquarePlusIcon } from "lucide-react";
import { toast } from "sonner";
import type { IncidentStatus } from "@siteguard/core";
import { acknowledgeIncident, addIncidentNote, resolveIncidentManually } from "@/app/(dashboard)/incidents/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export function IncidentActions({ incidentId, status }: { incidentId: string; status: IncidentStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [confirmResolve, setConfirmResolve] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error);
      toast.success(success);
      after?.();
      router.refresh();
    });

  return (
    <div className="flex flex-wrap gap-2">
      {status === "OPEN" && (
        <Button size="sm" onClick={() => run(() => acknowledgeIncident(incidentId), "Acknowledged — reminders stopped")} disabled={pending}>
          <CheckIcon /> Acknowledge
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={() => setNoteOpen(true)} disabled={pending}>
        <MessageSquarePlusIcon /> Add note
      </Button>
      {status !== "RESOLVED" && (
        <Button size="sm" variant="outline" onClick={() => setConfirmResolve(true)} disabled={pending}>
          <CheckCheckIcon /> Resolve
        </Button>
      )}

      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add note</DialogTitle>
            <DialogDescription>Visible to the whole team on this incident’s timeline.</DialogDescription>
          </DialogHeader>
          <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Hosting provider confirmed a server outage, ETA 30 min." autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending || !note.trim()}
              onClick={() =>
                run(() => addIncidentNote(incidentId, note), "Note added", () => {
                  setNote("");
                  setNoteOpen(false);
                })
              }
            >
              Save note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmResolve} onOpenChange={setConfirmResolve}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve manually?</DialogTitle>
            <DialogDescription>
              Use this for false alarms or issues fixed outside monitoring. If the check still fails, SiteGuard opens a new incident after the next confirmed failure. No resolved email/Telegram is sent.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmResolve(false)}>
              Cancel
            </Button>
            <Button disabled={pending} onClick={() => run(() => resolveIncidentManually(incidentId), "Incident resolved", () => setConfirmResolve(false))}>
              Resolve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
