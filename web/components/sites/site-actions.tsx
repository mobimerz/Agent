"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MoreHorizontalIcon, PauseIcon, PencilIcon, PlayCircleIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { deleteSite, setSitePaused } from "@/app/(dashboard)/sites/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function SiteActions({ siteId, siteName, paused, isAdmin }: { siteId: string; siteName: string; paused: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  function togglePause() {
    startTransition(async () => {
      const res = await setSitePaused(siteId, !paused);
      if (!res.ok) return void toast.error(res.error);
      toast.success(paused ? "Monitoring resumed" : "Monitoring paused");
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await deleteSite(siteId);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${siteName} deleted`);
      router.push("/sites");
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" asChild>
        <Link href={`/sites/${siteId}/edit` as Route}>
          <PencilIcon /> Edit
        </Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" className="size-8" aria-label="More actions" disabled={pending}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={togglePause}>
            {paused ? <PlayCircleIcon /> : <PauseIcon />} {paused ? "Resume monitoring" : "Pause monitoring"}
          </DropdownMenuItem>
          {isAdmin && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                <Trash2Icon /> Delete site
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {siteName}?</DialogTitle>
            <DialogDescription>This removes the site and all its check history, incidents and schedules. It cannot be undone. To stop monitoring temporarily, pause it instead.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={remove} disabled={pending}>
              {pending ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
