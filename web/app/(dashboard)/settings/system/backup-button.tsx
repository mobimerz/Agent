"use client";

import { useTransition } from "react";
import { DatabaseBackupIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { backupNow } from "./actions";

export function BackupButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await backupNow();
          if (res.ok) toast.success(`Backup ${res.name} created (${res.documents} documents)`);
          else toast.error(`Backup failed: ${res.error}`);
        })
      }
    >
      {pending ? <Loader2Icon className="animate-spin" /> : <DatabaseBackupIcon />}
      Back up now
    </Button>
  );
}
